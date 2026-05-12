'use strict';
require('dotenv').config();

// ── Validación temprana de variables críticas ────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('\n❌  FATAL: JWT_SECRET no está configurado.');
  console.error('    Copia .env.example a .env y define JWT_SECRET con al menos 32 caracteres.\n');
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('\n❌  FATAL: JWT_SECRET es demasiado corto (mínimo 32 caracteres).\n');
  process.exit(1);
}

const express = require('express');
const helmet  = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path = require('path');

const jwt  = require('jsonwebtoken');
const { initDatabase, db } = require('./src/config/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Inicializar base de datos ────────────────────────────────────────────────
initDatabase();

// ── Vistas protegidas: rol requerido por archivo ─────────────────────────────
const PROTECTED_VIEWS = {
  '/admin.html':         ['admin'],
  '/operador.html':      ['operador'],
  '/revisor.html':       ['revisor'],
  '/dashboard.html':     ['admin', 'operador', 'revisor'],
  '/questionnaire.html': ['admin', 'operador', 'revisor'],
};

function getJwtSecret() {
  return process.env.JWT_SECRET;
}

// ── Cabeceras de seguridad (Helmet) ──────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", 'https://cdn.tailwindcss.com', 'https://unpkg.com', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
        styleSrc:   ["'self'", "'unsafe-inline'", 'https://api.fontshare.com', 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
        fontSrc:    ["'self'", 'https://api.fontshare.com', 'https://cdnjs.cloudflare.com', 'data:'],
        imgSrc:     ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
  })
);

// ── Parsers ──────────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Rate limiting ────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta más tarde.' },
});

// Limiter específico para endpoints de subida (VUL-005)
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envíos en poco tiempo. Intenta más tarde.' },
});

app.use('/api', generalLimiter);
app.use('/api/questionnaire', uploadLimiter);

// ── Archivos estáticos — vistas protegidas por JWT ──────────────────────────
app.use((req, res, next) => {
  const allowed = PROTECTED_VIEWS[req.path];
  if (!allowed) return next();                       // ruta libre (index, css, js…)

  const token = req.cookies?.token;
  if (!token) return res.redirect('/index.html');

  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (!allowed.includes(payload.role)) return res.redirect('/index.html');
    return next();
  } catch {
    return res.redirect('/index.html');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Rutas API ────────────────────────────────────────────────────────────────
app.use('/api/auth',        require('./src/routes/auth'));
app.use('/api/admin',       require('./src/routes/admin'));
app.use('/api/submissions', require('./src/routes/submissions'));
app.use('/api/reviews',     require('./src/routes/reviews'));
app.use('/api/questionnaire', require('./src/routes/questionnaire'));

// ── Manejador global de errores ──────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// ── Limpieza periódica de tokens revocados (OBS-002) ────────────────────────
setInterval(() => {
  try {
    const deleted = db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?')
      .run(Math.floor(Date.now() / 1000));
    if (deleted.changes > 0) {
      console.log(`[cleanup] ${deleted.changes} token(s) revocado(s) expirado(s) eliminados.`);
    }
  } catch (e) {
    console.error('[cleanup] Error al limpiar revoked_tokens:', e.message);
  }
}, 6 * 60 * 60 * 1000); // cada 6 horas

app.listen(PORT, () => {
  console.log(`\n✅  Servidor corriendo en http://localhost:${PORT}`);
  console.log(`    Entorno: ${process.env.NODE_ENV || 'development'}\n`);
});
