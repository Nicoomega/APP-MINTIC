'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { db }   = require('../config/database');

const router = express.Router();

const SALT_ROUNDS      = 12;
const LOCKOUT_THRESHOLD = 5;   // intentos fallidos antes de bloquear
const LOCKOUT_MINUTES   = 15;  // minutos de bloqueo

function getSecret() {
  return process.env.JWT_SECRET; // Validado al arranque en server.js
}

// ── Validaciones ─────────────────────────────────────────────────────────────
const registerRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('El nombre de usuario debe tener entre 3 y 50 caracteres.')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Solo letras, números y guiones bajos.'),
  body('email')
    .isEmail().withMessage('Correo electrónico inválido.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres.')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Debe incluir una mayúscula, una minúscula y un número.'),
];

const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Correo electrónico inválido.'),
  body('password').notEmpty().withMessage('La contraseña es requerida.'),
];

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', registerRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { username, email, password } = req.body;

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) return res.status(409).json({ error: 'El correo o nombre de usuario ya está registrado.' });

  // El primer usuario registrado se convierte en administrador
  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  const role      = userCount === 0 ? 'admin' : 'operador';

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const result = db
    .prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username, email, passwordHash, role);

  return res.status(201).json({ message: 'Usuario registrado exitosamente.', userId: result.lastInsertRowid, role });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', loginRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;

  const user = db.prepare(
    'SELECT id, username, email, password_hash, role, failed_attempts, locked_until FROM users WHERE email = ?'
  ).get(email);

  // Protección contra timing attack: siempre ejecutar bcrypt aunque el usuario no exista
  const DUMMY_HASH   = '$2a$12$dummyhashfortimingprotectionXXXXXXXXXXXXXXXXXXX';
  const hashToCheck  = user?.password_hash ?? DUMMY_HASH;
  const passwordMatch = bcrypt.compareSync(password, hashToCheck);

  if (!user || !passwordMatch) {
    // Registrar intento fallido y aplicar bloqueo si corresponde (VUL-006)
    if (user) {
      const newAttempts = (user.failed_attempts || 0) + 1;
      if (newAttempts >= LOCKOUT_THRESHOLD) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
          .run(newAttempts, lockedUntil, user.id);
      } else {
        db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?')
          .run(newAttempts, user.id);
      }
    }
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  // Verificar si la cuenta está bloqueada (VUL-006)
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const unlockTime = new Date(user.locked_until).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    return res.status(429).json({
      error: `Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta de nuevo después de las ${unlockTime}`,
    });
  }

  // Login exitoso: resetear contador de intentos fallidos
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

  const payload = { id: user.id, username: user.username, email: user.email, role: user.role, jti: require('crypto').randomUUID() };
  const token   = jwt.sign(payload, getSecret(), { expiresIn: '8h' });

  res.cookie('token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   8 * 60 * 60 * 1000,
  });

  return res.json({ message: 'Sesión iniciada.', user: payload });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      const payload = jwt.verify(token, getSecret());
      if (payload.jti) {
        const expiresAt = payload.exp ?? Math.floor(Date.now() / 1000) + 8 * 3600;
        db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(payload.jti, expiresAt);
      }
    } catch { /* token ya inválido, no importa */ }
  }
  res.clearCookie('token');
  return res.json({ message: 'Sesión cerrada.' });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'No autenticado.' });

  try {
    const payload = jwt.verify(token, getSecret());
    if (payload.jti) {
      const revoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(payload.jti);
      if (revoked) return res.status(401).json({ error: 'Sesión cerrada. Inicia sesión nuevamente.' });
    }
    return res.json({ user: { id: payload.id, username: payload.username, email: payload.email, role: payload.role } });
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }
});

// ── GET /api/auth/dev-login?role=… ── Solo en desarrollo, solo desde localhost ─
if (process.env.NODE_ENV !== 'production') {
  router.get('/dev-login', (req, res) => {
    // VUL-002: restringir a localhost para evitar uso accidental en redes expuestas
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    const isLocalhost = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(clientIp);
    if (!isLocalhost) {
      return res.status(403).json({ error: 'dev-login solo está disponible desde localhost.' });
    }

    const role = req.query.role;
    if (!['admin', 'revisor', 'operador'].includes(role)) {
      return res.status(400).json({ error: 'role debe ser admin, revisor u operador.' });
    }
    const user = db.prepare('SELECT id, username, email, role FROM users WHERE role = ? LIMIT 1').get(role);
    if (!user) {
      return res.status(404).json({ error: `No existe ningún usuario con rol "${role}". Créalo desde el panel de admin.` });
    }
    const payload = { id: user.id, username: user.username, email: user.email, role: user.role, jti: require('crypto').randomUUID() };
    const token   = jwt.sign(payload, getSecret(), { expiresIn: '8h' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 });
    const redirects = { admin: '/admin.html', revisor: '/revisor.html', operador: '/operador.html' };
    return res.redirect(redirects[role]);
  });
}

module.exports = router;
