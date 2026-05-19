'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, param, query, validationResult } = require('express-validator');
const { db }  = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router     = express.Router();
const SALT_ROUNDS = 12;

// Todas las rutas requieren sesión y rol admin
router.use(authenticateToken, requireAdmin);

// ── GET /api/admin/users  (lista por rol: ?role=revisor|operador|todos) ────────
router.get('/users', [
  query('role').optional().isIn(['revisor', 'operador']).withMessage('Rol inválido.'),
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
      "SELECT id, username, email, role, created_at FROM users WHERE role IN ('revisor','operador') ORDER BY role, created_at DESC"
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
    .isIn(['revisor', 'operador']).withMessage("El rol debe ser 'revisor' u 'operador'."),
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

  const user = db.prepare("SELECT id, role FROM users WHERE id = ? AND role IN ('revisor','operador')").get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

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

// ── POST /api/admin/assign-reviews ────────────────────────────────────────────
// Body: { reviewerIds: [number] }
// Reparte por round-robin los envíos pendientes SIN ASIGNAR entre los revisores indicados.
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

  // Obtener pendientes SIN asignar (orden estable: el más antiguo primero)
  const pending = db.prepare(`
    SELECT id FROM submissions
    WHERE status = 'pendiente_revision' AND assigned_reviewer_id IS NULL
    ORDER BY COALESCE(submitted_at, created_at) ASC, id ASC
  `).all();

  if (!pending.length) {
    return res.json({
      message: 'No hay envíos pendientes sin asignar.',
      assigned: 0,
      distribution: valid.map(r => ({ id: r.id, username: r.username, count: 0 })),
    });
  }

  // Round-robin: distribución equitativa (algunos reciben uno más)
  const distMap = new Map(valid.map(r => [r.id, { id: r.id, username: r.username, count: 0 }]));
  const update = db.prepare(`UPDATE submissions SET assigned_reviewer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);

  const tx = db.transaction(() => {
    pending.forEach((sub, i) => {
      const reviewer = valid[i % valid.length];
      update.run(reviewer.id, sub.id);
      distMap.get(reviewer.id).count++;
    });
  });
  tx();

  return res.json({
    message: `Se asignaron ${pending.length} envío(s) entre ${valid.length} revisor(es).`,
    assigned: pending.length,
    distribution: [...distMap.values()],
  });
});

module.exports = router;
