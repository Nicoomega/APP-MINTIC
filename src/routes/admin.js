'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const ExcelJS = require('exceljs');
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
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

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

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return res.json({ message: 'Usuario eliminado.' });
});

// ── GET /api/admin/assignment-overview ────────────────────────────────────────
// Estado actual de asignaciones: revisores con sus cargas + pendientes sin asignar
router.get('/assignment-overview', (_req, res) => {
  const reviewers = db.prepare(`
    SELECT
      u.id, u.username, u.email,
      (SELECT COUNT(*) FROM submissions s
        WHERE s.assigned_reviewer_id = u.id AND s.status = 'pendiente_revision') AS assigned_pending,
      (SELECT COUNT(*) FROM submissions s
        WHERE s.reviewer_id = u.id) AS reviewed_total
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
// Rebalanceo equitativo por CARGA TOTAL (reviewed_total + asignados pendientes).
// Re-junta TODOS los pendientes que están sin asignar o asignados a revisores del pool,
// y los reparte mediante greedy por menor carga proyectada, así un revisor nuevo con 0
// recibe el lote inicial más grande hasta equilibrar contra los antiguos.
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

  // Carga base (reviewed_total) por revisor — los del pool no cuentan como carga base
  // porque van a redistribuirse. Los revisores fuera del pool con asignaciones quedan
  // intactos (no son ni reciben).
  const baseLoad = new Map();
  for (const r of valid) {
    const reviewed = db.prepare(
      `SELECT COUNT(*) AS c FROM submissions WHERE reviewer_id = ?`
    ).get(r.id).c;
    baseLoad.set(r.id, { id: r.id, username: r.username, base: reviewed, count: 0 });
  }

  if (!pool.length) {
    return res.json({
      message: 'No hay envíos pendientes para distribuir.',
      assigned: 0,
      distribution: [...baseLoad.values()].map(({ id, username, count }) => ({ id, username, count })),
    });
  }

  // Greedy: por cada envío, asignarlo al revisor con MENOR carga proyectada (base + ya asignado en esta corrida).
  // Empates: por menor id (orden estable). Esto da más al de menor reviewed_total.
  const update = db.prepare(`
    UPDATE submissions
    SET    assigned_reviewer_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE  id = ?
  `);

  const tx = db.transaction(() => {
    for (const sub of pool) {
      let pick = null;
      let pickLoad = Infinity;
      for (const r of baseLoad.values()) {
        const projected = r.base + r.count;
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
    message: `Se distribuyeron ${pool.length} envío(s) entre ${valid.length} revisor(es) por carga total.`,
    assigned: pool.length,
    distribution: [...baseLoad.values()].map(({ id, username, count, base }) => ({ id, username, count, base_reviewed: base })),
  });
});

// ── GET /api/admin/reviewers-report.xlsx ──────────────────────────────────────
// Excel con resumen por revisor: nombre, email, total revisados, aprobadas, rechazadas, pendientes asignadas
router.get('/reviewers-report.xlsx', async (_req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.username, u.email,
      (SELECT COUNT(*) FROM submissions s WHERE s.reviewer_id = u.id) AS total_revisados,
      (SELECT COUNT(*) FROM submissions s WHERE s.reviewer_id = u.id AND s.status = 'aprobado') AS aprobadas,
      (SELECT COUNT(*) FROM submissions s WHERE s.reviewer_id = u.id AND s.status = 'rechazado') AS rechazadas,
      (SELECT COUNT(*) FROM submissions s WHERE s.assigned_reviewer_id = u.id AND s.status = 'pendiente_revision') AS pendientes_asignadas
    FROM users u
    WHERE u.role = 'revisor'
    ORDER BY u.username COLLATE NOCASE
  `).all();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MINTIC';
  wb.created = new Date();

  const ws = wb.addWorksheet('Resumen por revisor', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'Revisor',              key: 'username',             width: 24 },
    { header: 'Correo',               key: 'email',                width: 32 },
    { header: 'Total revisados',      key: 'total_revisados',      width: 18 },
    { header: 'Aprobadas',            key: 'aprobadas',            width: 14 },
    { header: 'Rechazadas',           key: 'rechazadas',           width: 14 },
    { header: 'Pendientes asignadas', key: 'pendientes_asignadas', width: 22 },
  ];

  // Estilo del header
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 22;

  for (const r of rows) ws.addRow(r);

  // Alineación numérica
  for (let col = 3; col <= 6; col++) {
    ws.getColumn(col).alignment = { horizontal: 'center' };
  }

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-revisores-${today}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
