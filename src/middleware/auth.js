'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

function getSecret() {
  return process.env.JWT_SECRET; // Validado al arranque en server.js
}

function authenticateToken(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Acceso no autorizado.' });

  try {
    const payload = jwt.verify(token, getSecret());
    // Verificar que el token no haya sido revocado (logout previo)
    if (payload.jti) {
      const revoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(payload.jti);
      if (revoked) return res.status(401).json({ error: 'Sesión cerrada. Inicia sesión nuevamente.' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Solo los administradores pueden realizar esta acción.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'No tienes permisos para realizar esta acción.' });
    }
    next();
  };
}

module.exports = { authenticateToken, requireAdmin, requireRole };
