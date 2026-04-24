'use strict';
const express = require('express');
const { db }  = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Campos que el revisor debe evaluar
const REVIEW_FIELDS = [
  { name: 'gestion_asistencia',          label: 'Gestión de la asistencia y acompañamiento',       group: 'Asistencia' },
  { name: 'firma_gestor',                label: 'Firma del gestor',                                 group: 'Asistencia' },
  { name: 'precio_ubicacion_descripcion',label: 'Precio, ubicación y descripción del producto',     group: 'Vitrina virtual' },
  { name: 'catalogo',                    label: 'Catálogo',                                         group: 'Vitrina virtual' },
  { name: 'resenas_calificaciones',      label: 'Reseñas y calificaciones',                         group: 'Vitrina virtual' },
  { name: 'vinculo_chatbot',             label: 'Vínculo del chatbot',                              group: 'Vitrina virtual' },
  { name: 'precios_referencia',          label: 'Precios de referencia - Productos relacionados',   group: 'Vitrina virtual' },
  { name: 'preguntas_producto',          label: 'Preguntas acerca de este producto',                group: 'Vitrina virtual' },
];

const VALID_NAMES = new Set(REVIEW_FIELDS.map(f => f.name));

// ── GET /api/reviews/fields ── Obtener definición de campos ──────────────────
router.get('/fields', (_req, res) => {
  res.json({ fields: REVIEW_FIELDS });
});

// ── POST /api/reviews/:id ── Enviar revisión (revisor) ────────────────────────
router.post('/:id', authenticateToken, requireRole('revisor'), (req, res) => {
  const subId = parseInt(req.params.id, 10);
  if (isNaN(subId)) return res.status(400).json({ error: 'ID inválido.' });

  const sub = db.prepare('SELECT id, status FROM submissions WHERE id = ?').get(subId);
  if (!sub) return res.status(404).json({ error: 'Envío no encontrado.' });
  if (sub.status !== 'pendiente_revision') {
    return res.status(400).json({ error: 'Este envío ya fue revisado o no está en revisión.' });
  }

  const { fields } = req.body;
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'El cuerpo debe incluir un array "fields".' });

  // Verificar que todos los campos requeridos estén presentes
  const received = new Set(fields.map(f => f.name));
  const missing  = [...VALID_NAMES].filter(n => !received.has(n));
  if (missing.length) {
    return res.status(400).json({ error: `Campos faltantes en la revisión: ${missing.join(', ')}.` });
  }

  // Validar cada campo
  for (const f of fields) {
    if (!VALID_NAMES.has(f.name)) {
      return res.status(400).json({ error: `Campo desconocido: ${f.name}.` });
    }
    if (!['cumple', 'no_cumple'].includes(f.status)) {
      return res.status(400).json({ error: `Estado inválido en "${f.name}". Debe ser "cumple" o "no_cumple".` });
    }
    if (f.status === 'no_cumple' && !f.comment?.trim()) {
      const lbl = REVIEW_FIELDS.find(r => r.name === f.name)?.label ?? f.name;
      return res.status(400).json({ error: `El campo "${lbl}" marcado como "no cumple" requiere un comentario.` });
    }
  }

  const hasRejected = fields.some(f => f.status === 'no_cumple');
  const newStatus   = hasRejected ? 'rechazado' : 'aprobado';

  const upsert = db.prepare(`
    INSERT INTO review_fields (submission_id, reviewer_id, field_name, status, comment, reviewed_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(submission_id, field_name) DO UPDATE SET
      reviewer_id = excluded.reviewer_id,
      status      = excluded.status,
      comment     = excluded.comment,
      reviewed_at = excluded.reviewed_at
  `);

  const save = db.transaction(() => {
    for (const f of fields) {
      upsert.run(subId, req.user.id, f.name, f.status, f.comment?.trim() || null);
    }
    db.prepare(`
      UPDATE submissions
      SET    status = ?, reviewed_at = CURRENT_TIMESTAMP,
             reviewer_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE  id = ?
    `).run(newStatus, req.user.id, subId);
  });

  save();

  return res.json({
    message: newStatus === 'aprobado'
      ? 'Envío aprobado exitosamente.'
      : 'Envío rechazado y devuelto al operador con anotaciones.',
    newStatus,
  });
});

// ── GET /api/reviews/:id ── Obtener revisión de un envío ─────────────────────
router.get('/:id', authenticateToken, (req, res) => {
  const subId = parseInt(req.params.id, 10);
  if (isNaN(subId)) return res.status(400).json({ error: 'ID inválido.' });

  const sub = db.prepare('SELECT operator_id FROM submissions WHERE id = ?').get(subId);
  if (!sub) return res.status(404).json({ error: 'Envío no encontrado.' });

  const { role, id: uid } = req.user;
  if (role === 'operador' && sub.operator_id !== uid) {
    return res.status(403).json({ error: 'Sin permisos.' });
  }

  const reviews = db.prepare(
    'SELECT field_name, status, comment, reviewed_at FROM review_fields WHERE submission_id = ? ORDER BY id'
  ).all(subId);

  return res.json({ reviews, fields: REVIEW_FIELDS });
});

module.exports = router;
