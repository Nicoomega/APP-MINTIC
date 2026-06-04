'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const ExcelJS  = require('exceljs');
const archiver = require('archiver');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { body, param, query, validationResult } = require('express-validator');
const { db }  = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router     = express.Router();
const SALT_ROUNDS = 12;
const ROLES      = ['admin', 'revisor', 'operador'];

// Todas las rutas requieren sesión y rol admin
router.use(authenticateToken, requireAdmin);

// ── GET /api/admin/users  (lista por rol: ?role=admin|revisor|operador) ───────
router.get('/users', [
  query('role').optional().isIn(ROLES).withMessage('Rol inválido.'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { role } = req.query;
  let users;
  if (role) {
    users = db.prepare(
      'SELECT id, username, email, role, created_at FROM users WHERE role = ? ORDER BY created_at DESC'
    ).all(role);
  } else {
    users = db.prepare(
      "SELECT id, username, email, role, created_at FROM users WHERE role IN ('admin','revisor','operador') ORDER BY role, created_at DESC"
    ).all();
  }
  return res.json({ users });
});

// ── POST /api/admin/users  (crear usuario con rol específico) ─────────────────
router.post('/users', [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 }).withMessage('El nombre de usuario debe tener entre 3 y 50 caracteres.')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Solo letras, números y guiones bajos.'),
  body('email')
    .isEmail().withMessage('Correo electrónico inválido.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres.')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Debe incluir una mayúscula, una minúscula y un número.'),
  body('role')
    .isIn(ROLES).withMessage("El rol debe ser 'admin', 'revisor' u 'operador'."),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { username, email, password, role } = req.body;

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) return res.status(409).json({ error: 'El correo o nombre de usuario ya está en uso.' });

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const result = db
    .prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username, email, passwordHash, role);

  return res.status(201).json({
    message: 'Usuario creado exitosamente.',
    user: { id: result.lastInsertRowid, username, email, role },
  });
});

// ── PATCH /api/admin/users/:id  (editar datos de usuario) ─────────────────────
// Body opcional: { username?, email?, password?, role? }
// Protecciones:
//   - No puedes cambiar tu propio rol (evita lockout)
//   - No puedes degradar al último administrador
//   - Email/username deben seguir siendo únicos
router.patch('/users/:id', [
  param('id').isInt({ min: 1 }).withMessage('ID inválido.'),
  body('username').optional()
    .trim()
    .isLength({ min: 3, max: 50 }).withMessage('El nombre de usuario debe tener entre 3 y 50 caracteres.')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Solo letras, números y guiones bajos.'),
  body('email').optional()
    .isEmail().withMessage('Correo electrónico inválido.')
    .normalizeEmail(),
  body('password').optional({ checkFalsy: true })
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres.')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Debe incluir una mayúscula, una minúscula y un número.'),
  body('role').optional()
    .isIn(ROLES).withMessage("El rol debe ser 'admin', 'revisor' u 'operador'."),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const id = parseInt(req.params.id, 10);
  const user = db.prepare("SELECT id, username, email, role FROM users WHERE id = ? AND role IN ('admin','revisor','operador')").get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const { username, email, password, role } = req.body;
  if (username === undefined && email === undefined && password === undefined && role === undefined) {
    return res.status(400).json({ error: 'No hay cambios para guardar.' });
  }

  // Protecciones de rol
  if (role !== undefined && role !== user.role) {
    if (id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol de administrador.' });
    }
    if (user.role === 'admin' && role !== 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'No se puede degradar al último administrador del sistema.' });
      }
    }
  }

  // Unicidad de username/email (excluyéndose a sí mismo)
  if (username !== undefined && username !== user.username) {
    const exists = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (exists) return res.status(409).json({ error: 'El nombre de usuario ya está en uso.' });
  }
  if (email !== undefined && email !== user.email) {
    const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id);
    if (exists) return res.status(409).json({ error: 'El correo electrónico ya está en uso.' });
  }

  // UPDATE dinámico
  const sets = [];
  const vals = [];
  if (username !== undefined) { sets.push('username = ?');      vals.push(username); }
  if (email    !== undefined) { sets.push('email = ?');         vals.push(email); }
  if (password)               { sets.push('password_hash = ?'); vals.push(bcrypt.hashSync(password, SALT_ROUNDS)); }
  if (role     !== undefined) { sets.push('role = ?');          vals.push(role); }

  if (!sets.length) return res.status(400).json({ error: 'No hay cambios para guardar.' });
  vals.push(id);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    // Si deja de ser revisor, liberar sus envíos pendientes asignados (vuelven al pool).
    // Si no, quedarían huérfanos: el dashboard sólo lista revisores y tampoco saldrían
    // como "sin asignar".
    if (role !== undefined && role !== 'revisor' && user.role === 'revisor') {
      db.prepare(`
        UPDATE submissions SET assigned_reviewer_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE assigned_reviewer_id = ? AND status = 'pendiente_revision'
      `).run(id);
      // Y sacarlo del pool de asignación automática.
      try { db.prepare(`UPDATE users SET auto_assign = 0 WHERE id = ?`).run(id); } catch { /* sin columna */ }
    }
  });
  tx();

  const updated = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(id);
  return res.json({ message: 'Usuario actualizado.', user: updated });
});

// ── DELETE /api/admin/users/:id  (eliminar usuario) ───────────────────────────
router.delete('/users/:id', [
  param('id').isInt({ min: 1 }).withMessage('ID inválido.'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id } = req.params;

  // No se puede eliminar al propio administrador
  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  }

  const user = db.prepare("SELECT id, role FROM users WHERE id = ? AND role IN ('admin','revisor','operador')").get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  // Si es el último admin, no permitir eliminarlo
  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'No se puede eliminar al último administrador del sistema.' });
    }
  }

  // Limpiar referencias antes de borrar para no chocar con las foreign keys
  // (submissions.reviewer_id y review_fields.reviewer_id NO tienen ON DELETE; sin esto,
  // borrar un revisor con historial fallaría con error de FK → 500).
  // El crédito de revisiones se conserva en review_events (sin FK, no se borra).
  const uid = parseInt(id, 10);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM review_fields WHERE reviewer_id = ?').run(uid);
    db.prepare('UPDATE submissions SET reviewer_id = NULL WHERE reviewer_id = ?').run(uid);
    // assigned_reviewer_id se pone NULL automáticamente (ON DELETE SET NULL).
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  });
  tx();
  return res.json({ message: 'Usuario eliminado.' });
});

// ── GET /api/admin/assignment-overview ────────────────────────────────────────
// Estado actual de asignaciones: revisores con sus cargas + pendientes sin asignar.
// El campo auto_assign indica si el revisor está en el pool de asignación automática.
router.get('/assignment-overview', (_req, res) => {
  const reviewers = db.prepare(`
    SELECT
      u.id, u.username, u.email,
      u.auto_assign,
      (SELECT COUNT(*) FROM submissions s
        WHERE s.assigned_reviewer_id = u.id AND s.status = 'pendiente_revision') AS assigned_pending,
      (SELECT COUNT(*) FROM review_events e
        WHERE e.reviewer_id = u.id) AS reviewed_total
    FROM users u
    WHERE u.role = 'revisor'
    ORDER BY u.username COLLATE NOCASE
  `).all();

  const pendingUnassigned = db.prepare(`
    SELECT COUNT(*) AS cnt FROM submissions
    WHERE status = 'pendiente_revision' AND assigned_reviewer_id IS NULL
  `).get().cnt;

  return res.json({ reviewers, pending_unassigned: pendingUnassigned });
});

// ── POST /api/admin/auto-assign-pool ──────────────────────────────────────────
// Body: { reviewerIds: [number] }
// Persiste qué revisores forman parte del pool de asignación automática.
// Los nuevos envíos que entren después se asignarán automáticamente al revisor
// del pool con menor carga total (revisados + pendientes asignados).
// Si el array está vacío, NADIE recibe asignación automática (envíos quedan sin asignar).
router.post('/auto-assign-pool', [
  body('reviewerIds').isArray().withMessage('reviewerIds debe ser un arreglo (puede estar vacío).'),
  body('reviewerIds.*').isInt({ min: 1 }).withMessage('IDs de revisor inválidos.'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const ids = [...new Set((req.body.reviewerIds || []).map(Number))];

  // Validar que todos sean revisores reales
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const valid = db.prepare(
      `SELECT id FROM users WHERE role = 'revisor' AND id IN (${placeholders})`
    ).all(...ids);
    if (valid.length !== ids.length) {
      return res.status(400).json({ error: 'Uno o más IDs no corresponden a revisores válidos.' });
    }
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET auto_assign = 0 WHERE role = 'revisor'`).run();
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`UPDATE users SET auto_assign = 1 WHERE role = 'revisor' AND id IN (${placeholders})`).run(...ids);
    }
  });
  tx();

  return res.json({
    message: ids.length
      ? `Pool de asignación automática actualizado: ${ids.length} revisor(es) activo(s).`
      : 'Pool de asignación automática desactivado. Los nuevos envíos quedarán sin asignar.',
    pool_size: ids.length,
  });
});

// ── POST /api/admin/clear-reviewer-pending ────────────────────────────────────
// Body: { reviewerId: number }
// Quita la asignación pendiente del revisor indicado (assigned_reviewer_id = NULL)
// para que esos envíos vuelvan al pool de pendientes sin asignar.
// NO toca los que el revisor ya revisó (status != 'pendiente_revision').
router.post('/clear-reviewer-pending', [
  body('reviewerId').isInt({ min: 1 }).withMessage('reviewerId inválido.'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const reviewerId = parseInt(req.body.reviewerId, 10);
  const reviewer = db.prepare("SELECT id, username FROM users WHERE id = ? AND role = 'revisor'").get(reviewerId);
  if (!reviewer) return res.status(404).json({ error: 'Revisor no encontrado.' });

  const result = db.prepare(`
    UPDATE submissions
    SET    assigned_reviewer_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE  assigned_reviewer_id = ? AND status = 'pendiente_revision'
  `).run(reviewerId);

  return res.json({
    message: `Se liberaron ${result.changes} envío(s) asignado(s) a ${reviewer.username}.`,
    cleared: result.changes,
  });
});

// ── POST /api/admin/assign-reviews ────────────────────────────────────────────
// Body: { reviewerIds: [number] }
// Igualar CARGA TOTAL: la suma (reviewed_total + asignados_pendientes) queda lo más
// pareja posible entre los revisores marcados.
//
// Quien ya ha revisado MÁS tiendas NO recibe nuevos envíos hasta que los demás lo
// alcancen. Si tras emparejar quedan envíos sobrantes, esos se reparten en round-robin
// entre todos los marcados, así nadie es "castigado" por su historial.
//
// Pool a repartir: pendientes sin asignar + pendientes asignados a revisores DEL POOL
// (esto permite rebalancear si la carga actual quedó desigual).
// NO toca pendientes asignados a revisores que NO estén en el pool.
router.post('/assign-reviews', [
  body('reviewerIds').isArray({ min: 1 }).withMessage('Debe seleccionar al menos un revisor.'),
  body('reviewerIds.*').isInt({ min: 1 }).withMessage('IDs de revisor inválidos.'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { reviewerIds } = req.body;
  const uniqueIds = [...new Set(reviewerIds.map(Number))];

  // Validar que todos sean realmente revisores
  const placeholders = uniqueIds.map(() => '?').join(',');
  const valid = db.prepare(
    `SELECT id, username FROM users WHERE role = 'revisor' AND id IN (${placeholders})`
  ).all(...uniqueIds);

  if (valid.length !== uniqueIds.length) {
    return res.status(400).json({ error: 'Uno o más IDs no corresponden a revisores válidos.' });
  }

  const validIds = valid.map(r => r.id);
  const validPh  = validIds.map(() => '?').join(',');

  // Pool a repartir: pendientes sin asignar + pendientes asignados a revisores DEL POOL
  const pool = db.prepare(`
    SELECT id FROM submissions
    WHERE status = 'pendiente_revision'
      AND (assigned_reviewer_id IS NULL OR assigned_reviewer_id IN (${validPh}))
    ORDER BY COALESCE(submitted_at, created_at) ASC, id ASC
  `).all(...validIds);

  // Estado por revisor: base (lo que ya revisó) + count (lo que recibe en esta corrida)
  const state = new Map();
  for (const r of valid) {
    const reviewed = db.prepare(
      `SELECT COUNT(*) AS c FROM review_events WHERE reviewer_id = ?`
    ).get(r.id).c;
    state.set(r.id, { id: r.id, username: r.username, base_reviewed: reviewed, count: 0 });
  }

  if (!pool.length) {
    return res.json({
      message: 'No hay envíos pendientes para distribuir.',
      assigned: 0,
      distribution: [...state.values()].map(s => ({ id: s.id, username: s.username, count: 0, base_reviewed: s.base_reviewed })),
    });
  }

  // Greedy: por cada envío, asignarlo al revisor con MENOR carga proyectada
  // (base_reviewed + count). Empates resueltos por menor id (orden estable).
  // Esto garantiza que la suma final por revisor quede lo más pareja posible.
  const update = db.prepare(`
    UPDATE submissions
    SET    assigned_reviewer_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE  id = ?
  `);

  const tx = db.transaction(() => {
    for (const sub of pool) {
      let pick = null;
      let pickLoad = Infinity;
      for (const r of state.values()) {
        const projected = r.base_reviewed + r.count;
        if (projected < pickLoad || (projected === pickLoad && pick && r.id < pick.id)) {
          pick = r;
          pickLoad = projected;
        }
      }
      update.run(pick.id, sub.id);
      pick.count++;
    }
  });
  tx();

  return res.json({
    message: `Se distribuyeron ${pool.length} envío(s) entre ${valid.length} revisor(es) igualando la carga total.`,
    assigned: pool.length,
    distribution: [...state.values()].map(s => ({
      id: s.id, username: s.username, count: s.count,
      base_reviewed: s.base_reviewed,
      total: s.base_reviewed + s.count,
    })),
  });
});

// ── GET /api/admin/reviewers-report.xlsx ──────────────────────────────────────
// Reporte completo por revisor. Se usa review_fields (histórico real de revisiones)
// porque submissions.reviewer_id se resetea cuando el envío se corrige y vuelve a
// revisión, lo que antes hacía que el conteo "Total revisados" subestimara el
// trabajo real del revisor.
//
// Definiciones:
//   - revisiones_realizadas_historico: # envíos distintos que el revisor ha
//     revisado al menos una vez (incluye los que después fueron corregidos por
//     el operador y vueltos a revisar).
//   - vigente_aprobadas / vigente_rechazadas: revisiones del revisor que SIGUEN
//     siendo el veredicto actual del envío (no fueron sobreescritas por otro
//     revisor tras una corrección).
//   - reaperturas: envíos que el revisor revisó y luego fueron corregidos y
//     re-enviados (puede haberlas revisado él de nuevo o no).
router.get('/reviewers-report.xlsx', async (_req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.username, u.email,

      -- Histórico DURABLE desde review_events (cada revisión realizada cuenta, aunque
      -- el operador haya reenviado el envío después). Es la fuente de verdad real.
      (SELECT COUNT(*) FROM review_events e
        WHERE e.reviewer_id = u.id) AS revisiones_historico,
      (SELECT COUNT(*) FROM review_events e
        WHERE e.reviewer_id = u.id AND e.result = 'aprobado') AS aprobadas_historico,
      (SELECT COUNT(*) FROM review_events e
        WHERE e.reviewer_id = u.id AND e.result = 'rechazado') AS rechazadas_historico,

      -- Vigentes: revisiones que aún son el último veredicto del envío.
      (SELECT COUNT(*) FROM submissions s
        WHERE s.reviewer_id = u.id AND s.status = 'aprobado') AS vigente_aprobadas,
      (SELECT COUNT(*) FROM submissions s
        WHERE s.reviewer_id = u.id AND s.status = 'rechazado') AS vigente_rechazadas,

      -- Pendientes asignados (esperando primera revisión por el revisor).
      (SELECT COUNT(*) FROM submissions s
        WHERE s.assigned_reviewer_id = u.id
              AND s.status = 'pendiente_revision') AS pendientes_asignadas
    FROM users u
    WHERE u.role = 'revisor'
    ORDER BY u.username COLLATE NOCASE
  `).all();

  // Agregar diferencia para detectar reaperturas que ya no cuentan como vigentes
  for (const r of rows) {
    r.reaperturas = Math.max(0, r.revisiones_historico - (r.vigente_aprobadas + r.vigente_rechazadas));
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MINTIC';
  wb.created = new Date();

  const ws = wb.addWorksheet('Resumen por revisor', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'Revisor',                    key: 'username',             width: 26 },
    { header: 'Correo',                     key: 'email',                width: 32 },
    { header: 'Revisiones (histórico)',     key: 'revisiones_historico', width: 22 },
    { header: 'Aprobadas (histórico)',      key: 'aprobadas_historico',  width: 22 },
    { header: 'Rechazadas (histórico)',     key: 'rechazadas_historico', width: 22 },
    { header: 'Aprobadas vigentes',         key: 'vigente_aprobadas',    width: 20 },
    { header: 'Rechazadas vigentes',        key: 'vigente_rechazadas',   width: 20 },
    { header: 'Reaperturas',                key: 'reaperturas',          width: 16 },
    { header: 'Pendientes asignadas',       key: 'pendientes_asignadas', width: 22 },
  ];

  // Estilo del header
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 30;

  for (const r of rows) ws.addRow(r);

  // Alineación numérica
  for (let col = 3; col <= 9; col++) {
    ws.getColumn(col).alignment = { horizontal: 'center' };
  }

  // Segunda hoja: detalle envío por envío revisado por cada revisor
  const wsDetalle = wb.addWorksheet('Detalle por envío', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  wsDetalle.columns = [
    { header: 'Revisor',         key: 'revisor',      width: 24 },
    { header: 'Envío ID',        key: 'submission_id',width: 12 },
    { header: 'Operador',        key: 'operador',     width: 24 },
    { header: 'Veredicto revisor', key: 'veredicto',  width: 18 },
    { header: 'Estado actual',   key: 'estado_actual',width: 18 },
    { header: 'Sigue vigente',   key: 'vigente',      width: 14 },
    { header: 'Fecha revisión',  key: 'fecha',        width: 22 },
    { header: 'Observaciones',   key: 'observaciones',width: 50 },
  ];
  const hd = wsDetalle.getRow(1);
  hd.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hd.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
  hd.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  hd.height = 28;

  // Una fila por revisión realizada (review_events, durable). Las observaciones
  // se toman de review_fields si aún corresponden a esa revisión (mejor esfuerzo:
  // review_fields sólo conserva la última ronda de cada envío).
  const detalle = db.prepare(`
    SELECT
      rv.username AS revisor,
      e.submission_id,
      op.username AS operador,
      e.result AS veredicto,
      s.status AS estado_actual,
      CASE WHEN s.reviewer_id = e.reviewer_id THEN 'Sí' ELSE 'No (reabierto)' END AS vigente,
      e.reviewed_at AS fecha,
      (SELECT GROUP_CONCAT(rf.field_name || ': ' || rf.comment, ' | ')
         FROM review_fields rf
        WHERE rf.submission_id = e.submission_id AND rf.reviewer_id = e.reviewer_id
          AND rf.status = 'no_cumple' AND rf.comment IS NOT NULL) AS observaciones
    FROM review_events e
    JOIN users rv ON rv.id = e.reviewer_id
    JOIN submissions s ON s.id = e.submission_id
    JOIN users op ON op.id = s.operator_id
    ORDER BY rv.username COLLATE NOCASE, e.submission_id, e.id
  `).all();
  for (const d of detalle) wsDetalle.addRow(d);

  // Tercera hoja: leyenda de columnas
  const wsLeyenda = wb.addWorksheet('Glosario');
  wsLeyenda.columns = [
    { header: 'Columna',  key: 'col',  width: 28 },
    { header: 'Significado', key: 'def', width: 100 },
  ];
  const hl = wsLeyenda.getRow(1);
  hl.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
  hl.alignment = { vertical: 'middle', horizontal: 'center' };
  hl.height = 24;
  const glosario = [
    { col: 'Revisiones (histórico)', def: 'Total de revisiones realizadas por el revisor (bitácora durable review_events). Cada revisión cuenta, incluidas las de envíos que el operador corrigió y reabrió. No se pierde al reenviar.' },
    { col: 'Aprobadas (histórico)',  def: 'Cantidad de revisiones del revisor cuyo veredicto fue "aprobado" (durable, review_events).' },
    { col: 'Rechazadas (histórico)', def: 'Cantidad de revisiones del revisor cuyo veredicto fue "rechazado" (durable, review_events).' },
    { col: 'Aprobadas vigentes',     def: 'Envíos cuya última revisión vigente fue del revisor y el estado actual es "aprobado".' },
    { col: 'Rechazadas vigentes',    def: 'Envíos cuya última revisión vigente fue del revisor y el estado actual es "rechazado".' },
    { col: 'Reaperturas',            def: 'Envíos revisados por el revisor que fueron corregidos por el operador y por eso ya no muestran al revisor como reviewer_id actual. Trabajo realizado pero "invisible" en columnas vigentes.' },
    { col: 'Pendientes asignadas',   def: 'Envíos asignados al revisor que aún no han sido revisados (esperando su primera revisión).' },
  ];
  for (const g of glosario) wsLeyenda.addRow(g);
  wsLeyenda.getColumn('def').alignment = { wrapText: true, vertical: 'top' };

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-revisores-${today}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ── GET /api/admin/dashboard/kpis ─────────────────────────────────────────────
// Indicadores clave globales del sistema (números grandes para el dashboard).
router.get('/dashboard/kpis', (_req, res) => {
  try {
    const counts = {
      envios_total:        db.prepare('SELECT COUNT(*) c FROM submissions').get().c,
      envios_pendientes:   db.prepare("SELECT COUNT(*) c FROM submissions WHERE status='pendiente_revision'").get().c,
      envios_aprobados:    db.prepare("SELECT COUNT(*) c FROM submissions WHERE status='aprobado'").get().c,
      envios_rechazados:   db.prepare("SELECT COUNT(*) c FROM submissions WHERE status='rechazado'").get().c,
      envios_sin_asignar:  db.prepare("SELECT COUNT(*) c FROM submissions WHERE status='pendiente_revision' AND assigned_reviewer_id IS NULL").get().c,
      revisiones_total:    db.prepare('SELECT COUNT(*) c FROM review_events').get().c,
      operadores_activos:  db.prepare("SELECT COUNT(DISTINCT operator_id) c FROM submissions").get().c,
      revisores_activos:   db.prepare("SELECT COUNT(DISTINCT reviewer_id) c FROM review_events").get().c,
      revisores_en_pool:   db.prepare("SELECT COUNT(*) c FROM users WHERE role='revisor' AND auto_assign=1").get().c,
      revisores_total:     db.prepare("SELECT COUNT(*) c FROM users WHERE role='revisor'").get().c,
      operadores_total:    db.prepare("SELECT COUNT(*) c FROM users WHERE role='operador'").get().c,
    };
    const tasaAprobacion = counts.envios_total
      ? (counts.envios_aprobados / counts.envios_total * 100)
      : 0;
    return res.json({
      ...counts,
      tasa_aprobacion: Number(tasaAprobacion.toFixed(1)),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[dashboard/kpis]', e);
    return res.status(500).json({ error: 'No se pudieron calcular los KPIs.' });
  }
});

// ── GET /api/admin/dashboard/reviewers ────────────────────────────────────────
// Detalle por revisor (usando review_fields como fuente histórica real).
router.get('/dashboard/reviewers', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        u.id, u.username, u.email, u.auto_assign,
        u.created_at,
        (SELECT COUNT(*) FROM review_events e
          WHERE e.reviewer_id = u.id) AS revisiones_historico,
        (SELECT COUNT(*) FROM review_events e
          WHERE e.reviewer_id = u.id AND e.result = 'aprobado') AS aprobadas_historico,
        (SELECT COUNT(*) FROM review_events e
          WHERE e.reviewer_id = u.id AND e.result = 'rechazado') AS rechazadas_historico,
        (SELECT COUNT(*) FROM submissions s
          WHERE s.reviewer_id = u.id AND s.status='aprobado') AS vigente_aprobadas,
        (SELECT COUNT(*) FROM submissions s
          WHERE s.reviewer_id = u.id AND s.status='rechazado') AS vigente_rechazadas,
        (SELECT COUNT(*) FROM submissions s
          WHERE s.assigned_reviewer_id = u.id AND s.status='pendiente_revision') AS pendientes_asignadas,
        (SELECT MAX(e.reviewed_at) FROM review_events e
          WHERE e.reviewer_id = u.id) AS ultima_revision
      FROM users u
      WHERE u.role='revisor'
      ORDER BY revisiones_historico DESC, u.username COLLATE NOCASE
    `).all();
    return res.json({ reviewers: rows });
  } catch (e) {
    console.error('[dashboard/reviewers]', e);
    return res.status(500).json({ error: 'No se pudo obtener el reporte de revisores.' });
  }
});

// ── GET /api/admin/dashboard/operators ────────────────────────────────────────
// Detalle por operador.
router.get('/dashboard/operators', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        u.id, u.username, u.email,
        u.created_at,
        (SELECT COUNT(*) FROM submissions s WHERE s.operator_id = u.id) AS envios_total,
        (SELECT COUNT(*) FROM submissions s WHERE s.operator_id = u.id AND s.status='pendiente_revision') AS envios_pendientes,
        (SELECT COUNT(*) FROM submissions s WHERE s.operator_id = u.id AND s.status='aprobado') AS envios_aprobados,
        (SELECT COUNT(*) FROM submissions s WHERE s.operator_id = u.id AND s.status='rechazado') AS envios_rechazados,
        (SELECT MAX(s.submitted_at) FROM submissions s WHERE s.operator_id = u.id) AS ultimo_envio,
        (SELECT MIN(s.submitted_at) FROM submissions s WHERE s.operator_id = u.id) AS primer_envio
      FROM users u
      WHERE u.role='operador'
      ORDER BY envios_total DESC, u.username COLLATE NOCASE
    `).all();
    return res.json({ operators: rows });
  } catch (e) {
    console.error('[dashboard/operators]', e);
    return res.status(500).json({ error: 'No se pudo obtener el reporte de operadores.' });
  }
});

// ── GET /api/admin/dashboard/timeline ─────────────────────────────────────────
// Serie temporal: envíos y revisiones por día (últimos 30 días por defecto).
router.get('/dashboard/timeline', (req, res) => {
  try {
    const dias = Math.min(180, Math.max(7, parseInt(req.query.dias, 10) || 30));
    // Envíos por día
    const envios = db.prepare(`
      SELECT DATE(submitted_at) AS dia, COUNT(*) AS cnt
      FROM submissions
      WHERE submitted_at IS NOT NULL
        AND DATE(submitted_at) >= DATE('now', '-' || ? || ' day')
      GROUP BY DATE(submitted_at)
      ORDER BY dia
    `).all(dias);
    // Revisiones (envíos distintos revisados) por día
    const revisiones = db.prepare(`
      SELECT DATE(rf.reviewed_at) AS dia, COUNT(DISTINCT rf.submission_id) AS cnt
      FROM review_fields rf
      WHERE rf.reviewed_at IS NOT NULL
        AND DATE(rf.reviewed_at) >= DATE('now', '-' || ? || ' day')
      GROUP BY DATE(rf.reviewed_at)
      ORDER BY dia
    `).all(dias);
    // Aprobaciones y rechazos por día (basados en reviewed_at de submissions)
    const decisiones = db.prepare(`
      SELECT DATE(reviewed_at) AS dia, status, COUNT(*) AS cnt
      FROM submissions
      WHERE reviewed_at IS NOT NULL
        AND status IN ('aprobado','rechazado')
        AND DATE(reviewed_at) >= DATE('now', '-' || ? || ' day')
      GROUP BY DATE(reviewed_at), status
      ORDER BY dia
    `).all(dias);
    return res.json({ envios, revisiones, decisiones, dias });
  } catch (e) {
    console.error('[dashboard/timeline]', e);
    return res.status(500).json({ error: 'No se pudo construir la serie temporal.' });
  }
});

// ── GET /api/admin/dashboard/recent-activity ──────────────────────────────────
// Últimos eventos (envíos recientes, revisiones recientes).
router.get('/dashboard/recent-activity', (req, res) => {
  try {
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 15));
    const recent_submissions = db.prepare(`
      SELECT s.id, s.status, s.submitted_at, s.reviewed_at,
             op.username AS operador, rv.username AS revisor
      FROM submissions s
      JOIN users op ON op.id = s.operator_id
      LEFT JOIN users rv ON rv.id = s.reviewer_id
      WHERE s.submitted_at IS NOT NULL
      ORDER BY s.submitted_at DESC
      LIMIT ?
    `).all(limit);
    const recent_reviews = db.prepare(`
      SELECT rf.submission_id, MAX(rf.reviewed_at) AS reviewed_at,
             rv.username AS revisor,
             CASE WHEN SUM(CASE WHEN rf.status='no_cumple' THEN 1 ELSE 0 END) > 0
                  THEN 'rechazado' ELSE 'aprobado' END AS veredicto
      FROM review_fields rf
      JOIN users rv ON rv.id = rf.reviewer_id
      GROUP BY rf.submission_id, rf.reviewer_id
      ORDER BY reviewed_at DESC
      LIMIT ?
    `).all(limit);
    return res.json({ recent_submissions, recent_reviews });
  } catch (e) {
    console.error('[dashboard/recent-activity]', e);
    return res.status(500).json({ error: 'No se pudo obtener la actividad reciente.' });
  }
});

// ── GET /api/admin/backup-summary ─────────────────────────────────────────────
// Estadísticas previas para mostrar al admin antes de descargar
router.get('/backup-summary', (_req, res) => {
  try {
    const UPLOADS_DIR = path.join(__dirname, '../../uploads');
    const DB_PATH     = path.join(__dirname, '../../data/database.sqlite');

    const counts = {
      users:            db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      submissions:      db.prepare('SELECT COUNT(*) AS c FROM submissions').get().c,
      submission_files: db.prepare('SELECT COUNT(*) AS c FROM submission_files').get().c,
      review_fields:    db.prepare('SELECT COUNT(*) AS c FROM review_fields').get().c,
      responses:        db.prepare('SELECT COUNT(*) AS c FROM responses').get().c,
      attachments:      db.prepare('SELECT COUNT(*) AS c FROM attachments').get().c,
    };

    let filesOnDisk = 0;
    let totalBytes  = 0;
    if (fs.existsSync(UPLOADS_DIR)) {
      const entries = fs.readdirSync(UPLOADS_DIR);
      for (const name of entries) {
        try {
          const st = fs.statSync(path.join(UPLOADS_DIR, name));
          if (st.isFile()) { filesOnDisk++; totalBytes += st.size; }
        } catch { /* ignore */ }
      }
    }

    let dbBytes = 0;
    try { dbBytes = fs.statSync(DB_PATH).size; } catch { /* ignore */ }

    return res.json({
      counts,
      files_on_disk: filesOnDisk,
      uploads_bytes: totalBytes,
      db_bytes:      dbBytes,
      generated_at:  new Date().toISOString(),
    });
  } catch (e) {
    console.error('[backup-summary]', e);
    return res.status(500).json({ error: 'No se pudo calcular el resumen.' });
  }
});

// ── GET /api/admin/backup-completo.zip ────────────────────────────────────────
// Descarga ZIP con TODO: base de datos, archivos PDF/imágenes subidos,
// exportación JSON+CSV de todas las tablas, reporte Excel consolidado y manifiesto.
// Solo accesible para administradores.
router.get('/backup-completo.zip', async (_req, res) => {
  const UPLOADS_DIR = path.join(__dirname, '../../uploads');
  const DB_PATH     = path.join(__dirname, '../../data/database.sqlite');

  const today    = new Date().toISOString().slice(0, 10);
  const tempDb   = path.join(os.tmpdir(), `backup-mintic-${Date.now()}.sqlite`);
  const filename = `backup-mintic-${today}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 9 } });

  // Limpieza del archivo temporal cuando termine la respuesta
  const cleanup = () => { try { if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb); } catch { /* ignore */ } };

  archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.error('[backup] warning:', err); });
  archive.on('error',   (err) => { console.error('[backup] error:', err); cleanup(); try { res.end(); } catch { /* ignore */ } });
  res.on('close', cleanup);

  archive.pipe(res);

  try {
    // 1) Backup de la base de datos SQLite (método nativo para incluir WAL)
    try {
      await db.backup(tempDb);
      archive.file(tempDb, { name: 'database/database.sqlite' });
    } catch (e) {
      console.error('[backup] No se pudo respaldar la DB via API, copiando archivo:', e);
      if (fs.existsSync(DB_PATH)) archive.file(DB_PATH, { name: 'database/database.sqlite' });
    }

    // 2) Carpeta uploads/ completa (PDFs e imágenes)
    if (fs.existsSync(UPLOADS_DIR)) {
      archive.directory(UPLOADS_DIR, 'uploads');
    }

    // 3) Exportación JSON de cada tabla
    const tablas = ['users', 'responses', 'attachments', 'submissions', 'submission_files', 'review_fields', 'revoked_tokens'];
    for (const t of tablas) {
      try {
        const rows = db.prepare(`SELECT * FROM ${t}`).all();
        archive.append(JSON.stringify(rows, null, 2), { name: `exports/json/${t}.json` });
      } catch (e) {
        archive.append(`Error al exportar tabla ${t}: ${e.message}`, { name: `exports/json/${t}.error.txt` });
      }
    }

    // 4) CSV consolidado de envíos con sus archivos y observaciones
    const submissionsFull = db.prepare(`
      SELECT
        s.id AS submission_id,
        s.status,
        s.url_vitrina,
        s.url_chatbot,
        s.owner_doc_type,
        s.owner_doc_number,
        s.created_at,
        s.submitted_at,
        s.reviewed_at,
        op.username AS operador,
        op.email    AS operador_email,
        rv.username AS revisor,
        rv.email    AS revisor_email,
        ar.username AS revisor_asignado
      FROM   submissions s
      JOIN   users op ON op.id = s.operator_id
      LEFT JOIN users rv ON rv.id = s.reviewer_id
      LEFT JOIN users ar ON ar.id = s.assigned_reviewer_id
      ORDER BY s.id
    `).all();

    archive.append(toCsv(submissionsFull), { name: 'exports/csv/envios.csv' });

    // Observaciones de revisión
    const obs = db.prepare(`
      SELECT
        rf.submission_id,
        rf.field_name AS campo,
        rf.status     AS estado,
        rf.comment    AS observacion,
        rf.reviewed_at,
        rv.username   AS revisor
      FROM   review_fields rf
      LEFT JOIN users rv ON rv.id = rf.reviewer_id
      ORDER BY rf.submission_id, rf.id
    `).all();
    archive.append(toCsv(obs), { name: 'exports/csv/observaciones.csv' });

    // Archivos subidos (lista)
    const archivos = db.prepare(`
      SELECT
        sf.submission_id,
        sf.field_name      AS campo,
        sf.original_name   AS nombre_original,
        sf.stored_name     AS nombre_almacenado,
        sf.mimetype        AS tipo_mime,
        sf.size            AS tamano_bytes,
        sf.created_at
      FROM   submission_files sf
      ORDER BY sf.submission_id, sf.id
    `).all();
    archive.append(toCsv(archivos), { name: 'exports/csv/archivos_subidos.csv' });

    // Usuarios
    const usersCsv = db.prepare(`
      SELECT id, username, email, role, created_at
      FROM   users ORDER BY id
    `).all();
    archive.append(toCsv(usersCsv), { name: 'exports/csv/usuarios.csv' });

    // 5) Reporte Excel consolidado con TODO
    const xlsxBuf = await buildExcelReport(submissionsFull, obs, archivos, usersCsv);
    archive.append(xlsxBuf, { name: 'exports/reporte-consolidado.xlsx' });

    // 6) Manifiesto / README
    const manifest = buildManifest(submissionsFull.length, obs.length, archivos.length, usersCsv.length);
    archive.append(manifest, { name: 'README.txt' });

    await archive.finalize();
  } catch (e) {
    console.error('[backup] Error general:', e);
    try { archive.abort(); } catch { /* ignore */ }
    cleanup();
  }
});

// ── GET /api/admin/database.sqlite ────────────────────────────────────────────
// Descarga ÚNICAMENTE el archivo de la base de datos SQLite (sin uploads ni reportes).
// Usa el método nativo db.backup() para garantizar consistencia incluso con WAL activo.
router.get('/database.sqlite', async (_req, res) => {
  const today  = new Date().toISOString().slice(0, 10);
  const tempDb = path.join(os.tmpdir(), `mintic-db-${Date.now()}.sqlite`);

  try {
    await db.backup(tempDb);
  } catch (e) {
    console.error('[db-download] db.backup falló, copiando archivo directamente:', e);
    const DB_PATH = path.join(__dirname, '../../data/database.sqlite');
    try {
      fs.copyFileSync(DB_PATH, tempDb);
    } catch (copyErr) {
      console.error('[db-download] No se pudo copiar la base de datos:', copyErr);
      return res.status(500).json({ error: 'No se pudo preparar la base de datos para descarga.' });
    }
  }

  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="database-mintic-${today}.sqlite"`);
  res.setHeader('Cache-Control', 'no-store');

  const stream = fs.createReadStream(tempDb);
  const cleanup = () => { try { fs.unlinkSync(tempDb); } catch { /* ignore */ } };

  stream.on('error', (err) => {
    console.error('[db-download] error de stream:', err);
    cleanup();
    if (!res.headersSent) res.status(500).json({ error: 'Error al enviar la base de datos.' });
    else res.end();
  });
  res.on('close', cleanup);
  stream.pipe(res);
});

// ── GET /api/admin/envios-consolidados.xlsx ───────────────────────────────────
// Excel de una sola hoja con la vista consolidada de TODOS los envíos:
// Envío | Estado | Operador | Revisor | Asignado a | Doc | Número | URL Vitrina |
// Enviado | Revisado | # arch. | # obs. revisor | # notas op.
//
// Los conteos se calculan con subconsultas para que cada fila sea autosuficiente:
//   # arch.        → cantidad de archivos subidos del envío (submission_files)
//   # obs. revisor → observaciones "no_cumple" de la última revisión (review_fields)
//   # notas op.    → notas opcionales del operador (operator_notes)
router.get('/envios-consolidados.xlsx', async (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        s.id                                       AS envio,
        s.status                                   AS estado,
        op.username                                AS operador,
        rv.username                                AS revisor,
        ar.username                                AS asignado_a,
        s.owner_doc_type                           AS doc,
        s.owner_doc_number                         AS numero,
        s.url_vitrina                              AS url_vitrina,
        s.submitted_at                             AS enviado,
        s.reviewed_at                              AS revisado,
        (SELECT COUNT(*) FROM submission_files sf
           WHERE sf.submission_id = s.id)          AS num_archivos,
        (SELECT COUNT(*) FROM review_fields rf
           WHERE rf.submission_id = s.id
             AND rf.status = 'no_cumple')          AS num_obs_revisor,
        (SELECT COUNT(*) FROM operator_notes opn
           WHERE opn.submission_id = s.id)         AS num_notas_op
      FROM   submissions s
      JOIN      users op ON op.id = s.operator_id
      LEFT JOIN users rv ON rv.id = s.reviewer_id
      LEFT JOIN users ar ON ar.id = s.assigned_reviewer_id
      ORDER BY s.id
    `).all();

    const ESTADO_LABEL = {
      pendiente_revision: 'Pendiente de revisión',
      aprobado:           'Aprobado',
      rechazado:          'Rechazado',
    };
    const ESTADO_FILL = {
      pendiente_revision: 'FFFEF3C7',
      aprobado:           'FFDCFCE7',
      rechazado:          'FFFEE2E2',
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'MINTIC';
    wb.created = new Date();

    const ws = wb.addWorksheet('Envíos completos', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = [
      { header: 'Envío',          key: 'envio',           width: 9 },
      { header: 'Estado',         key: 'estado',          width: 22 },
      { header: 'Operador',       key: 'operador',        width: 28 },
      { header: 'Revisor',        key: 'revisor',         width: 24 },
      { header: 'Asignado a',     key: 'asignado_a',      width: 24 },
      { header: 'Doc',            key: 'doc',             width: 8 },
      { header: 'Número',         key: 'numero',          width: 18 },
      { header: 'URL Vitrina',    key: 'url_vitrina',     width: 50 },
      { header: 'Enviado',        key: 'enviado',         width: 20 },
      { header: 'Revisado',       key: 'revisado',        width: 20 },
      { header: '# arch.',        key: 'num_archivos',    width: 10 },
      { header: '# obs. revisor', key: 'num_obs_revisor', width: 14 },
      { header: '# notas op.',    key: 'num_notas_op',    width: 12 },
    ];

    // Estilo de encabezado
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
    header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    header.height = 26;

    for (const r of rows) {
      const row = ws.addRow({
        ...r,
        estado: ESTADO_LABEL[r.estado] ?? r.estado,
      });
      // Colorear la celda de estado
      const fill = ESTADO_FILL[r.estado];
      if (fill) {
        row.getCell('estado').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        row.getCell('estado').font = { bold: true };
      }
    }

    // Centrar columnas numéricas y de documento
    ['doc', 'num_archivos', 'num_obs_revisor', 'num_notas_op'].forEach(key => {
      ws.getColumn(key).alignment = { horizontal: 'center' };
    });

    // Autofiltro sobre todo el rango con datos
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: ws.columnCount },
    };

    // Hoja de resumen rápido
    const wsR = wb.addWorksheet('Resumen');
    wsR.columns = [
      { header: 'Métrica', key: 'm', width: 32 },
      { header: 'Valor',   key: 'v', width: 16 },
    ];
    const hr = wsR.getRow(1);
    hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    hr.alignment = { vertical: 'middle', horizontal: 'center' };
    const totalEnvios     = rows.length;
    const totalAprobados  = rows.filter(r => r.estado === 'aprobado').length;
    const totalRechazados = rows.filter(r => r.estado === 'rechazado').length;
    const totalPendientes = rows.filter(r => r.estado === 'pendiente_revision').length;
    wsR.addRow({ m: 'Total envíos',        v: totalEnvios });
    wsR.addRow({ m: 'Aprobados',           v: totalAprobados });
    wsR.addRow({ m: 'Rechazados',          v: totalRechazados });
    wsR.addRow({ m: 'Pendientes',          v: totalPendientes });
    wsR.addRow({ m: 'Tasa de aprobación',  v: totalEnvios ? `${(totalAprobados / totalEnvios * 100).toFixed(1)}%` : '0%' });
    wsR.addRow({ m: 'Generado',            v: new Date().toLocaleString('es-CO') });

    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="envios-consolidados-${today}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[envios-consolidados]', e);
    if (!res.headersSent) return res.status(500).json({ error: 'No se pudo generar el reporte de envíos.' });
    res.end();
  }
});

// ── Helpers para el backup ───────────────────────────────────────────────────
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc  = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\r\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const out = [cols.join(',')];
  for (const r of rows) out.push(cols.map(c => esc(r[c])).join(','));
  return out.join('\r\n');
}

async function buildExcelReport(submissions, observaciones, archivos, usuarios) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MINTIC';
  wb.created = new Date();

  const styleHeader = (row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.height = 22;
  };

  // Hoja 1: Envíos
  const wsE = wb.addWorksheet('Envíos', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsE.columns = [
    { header: 'ID',               key: 'submission_id',    width: 8 },
    { header: 'Estado',           key: 'status',           width: 18 },
    { header: 'URL Vitrina',      key: 'url_vitrina',      width: 38 },
    { header: 'URL Chatbot',      key: 'url_chatbot',      width: 38 },
    { header: 'Doc Tipo',         key: 'owner_doc_type',   width: 10 },
    { header: 'Doc Número',       key: 'owner_doc_number', width: 16 },
    { header: 'Operador',         key: 'operador',         width: 20 },
    { header: 'Email operador',   key: 'operador_email',   width: 28 },
    { header: 'Revisor',          key: 'revisor',          width: 20 },
    { header: 'Email revisor',    key: 'revisor_email',    width: 28 },
    { header: 'Revisor asignado', key: 'revisor_asignado', width: 20 },
    { header: 'Creado',           key: 'created_at',       width: 20 },
    { header: 'Enviado',          key: 'submitted_at',     width: 20 },
    { header: 'Revisado',         key: 'reviewed_at',      width: 20 },
  ];
  styleHeader(wsE.getRow(1));
  for (const r of submissions) wsE.addRow(r);

  // Hoja 2: Observaciones
  const wsO = wb.addWorksheet('Observaciones', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsO.columns = [
    { header: 'Envío ID',     key: 'submission_id', width: 10 },
    { header: 'Campo',        key: 'campo',         width: 28 },
    { header: 'Estado',       key: 'estado',        width: 14 },
    { header: 'Observación',  key: 'observacion',   width: 60 },
    { header: 'Revisado el',  key: 'reviewed_at',   width: 20 },
    { header: 'Revisor',      key: 'revisor',       width: 20 },
  ];
  styleHeader(wsO.getRow(1));
  for (const r of observaciones) wsO.addRow(r);
  wsO.getColumn('observacion').alignment = { wrapText: true, vertical: 'top' };

  // Hoja 3: Archivos
  const wsA = wb.addWorksheet('Archivos', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsA.columns = [
    { header: 'Envío ID',          key: 'submission_id',     width: 10 },
    { header: 'Campo',             key: 'campo',             width: 28 },
    { header: 'Nombre original',   key: 'nombre_original',   width: 38 },
    { header: 'Nombre almacenado', key: 'nombre_almacenado', width: 40 },
    { header: 'Tipo MIME',         key: 'tipo_mime',         width: 22 },
    { header: 'Tamaño (bytes)',    key: 'tamano_bytes',      width: 16 },
    { header: 'Creado',            key: 'created_at',        width: 20 },
  ];
  styleHeader(wsA.getRow(1));
  for (const r of archivos) wsA.addRow(r);

  // Hoja 4: Usuarios
  const wsU = wb.addWorksheet('Usuarios', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsU.columns = [
    { header: 'ID',         key: 'id',         width: 8 },
    { header: 'Usuario',    key: 'username',   width: 22 },
    { header: 'Correo',     key: 'email',      width: 30 },
    { header: 'Rol',        key: 'role',       width: 14 },
    { header: 'Creado',     key: 'created_at', width: 20 },
  ];
  styleHeader(wsU.getRow(1));
  for (const r of usuarios) wsU.addRow(r);

  return await wb.xlsx.writeBuffer();
}

function buildManifest(numEnvios, numObs, numArchivos, numUsuarios) {
  const now = new Date().toLocaleString('es-CO');
  return [
    '===========================================================',
    '   RESPALDO COMPLETO — MINTIC · APLICATIVO CUESTIONARIO',
    '===========================================================',
    '',
    `Generado: ${now}`,
    '',
    'Contenido del archivo ZIP:',
    '',
    '  database/database.sqlite',
    '      Copia íntegra de la base de datos SQLite. Se puede abrir con',
    '      DB Browser for SQLite (https://sqlitebrowser.org) o con cualquier',
    '      cliente compatible con SQLite 3.',
    '',
    '  uploads/',
    '      TODOS los archivos PDF e imágenes subidos por los operadores',
    '      (cédulas, informes, certificados, planillas, evidencias, etc.).',
    '      El nombre interno (UUID) coincide con el campo "stored_name"',
    '      de la tabla submission_files. Para conocer el nombre original',
    '      revisa exports/csv/archivos_subidos.csv o la hoja "Archivos"',
    '      del reporte Excel.',
    '',
    '  exports/json/',
    '      Una exportación en formato JSON por cada tabla de la base de',
    '      datos (users, submissions, submission_files, review_fields,',
    '      responses, attachments, revoked_tokens).',
    '',
    '  exports/csv/',
    '      envios.csv             - Envíos consolidados con operador/revisor.',
    '      observaciones.csv      - Todas las observaciones de los revisores.',
    '      archivos_subidos.csv   - Listado de archivos con metadatos.',
    '      usuarios.csv           - Listado de usuarios (sin contraseñas).',
    '',
    '  exports/reporte-consolidado.xlsx',
    '      Libro de Excel con cuatro hojas: Envíos, Observaciones,',
    '      Archivos y Usuarios. Listo para abrir directamente en Excel.',
    '',
    '  README.txt',
    '      Este archivo.',
    '',
    '-----------------------------------------------------------',
    'Resumen del respaldo',
    '-----------------------------------------------------------',
    `  Envíos totales:        ${numEnvios}`,
    `  Observaciones totales: ${numObs}`,
    `  Archivos totales:      ${numArchivos}`,
    `  Usuarios totales:      ${numUsuarios}`,
    '',
    '-----------------------------------------------------------',
    'NOTAS DE SEGURIDAD',
    '-----------------------------------------------------------',
    '  - Este respaldo contiene datos personales y documentos. Guárdalo',
    '    en un medio cifrado y limita su acceso a personal autorizado.',
    '  - Las contraseñas se almacenan como hashes bcrypt en la tabla',
    '    users.password_hash; aún así, trata la base de datos como',
    '    información sensible.',
    '  - Para restaurar el sistema basta con colocar database.sqlite en',
    '    la carpeta data/ y la carpeta uploads/ en la raíz del proyecto.',
    '',
  ].join('\r\n');
}

module.exports = router;
