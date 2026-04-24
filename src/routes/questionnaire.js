'use strict';
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const FileType = require('file-type');
const { db }   = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Tipos que tienen magic bytes verificables (VUL-003)
const BINARY_MIMETYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip', 'application/x-zip-compressed',
]);

async function validateMagicBytes(files) {
  const errors = [];
  for (const file of files) {
    if (!BINARY_MIMETYPES.has(file.mimetype)) continue; // text/plain, text/csv no tienen magic bytes
    const detected = await FileType.fromFile(file.path);
    if (!detected) {
      errors.push(`"${file.originalname}": no se pudo determinar el tipo real del archivo.`);
      continue;
    }
    const normalizedMime = file.mimetype === 'application/x-zip-compressed' ? 'application/zip' : file.mimetype;
    const normalizedDetected = detected.mime === 'application/x-zip-compressed' ? 'application/zip' : detected.mime;
    if (normalizedMime !== normalizedDetected) {
      errors.push(`"${file.originalname}": el contenido no coincide con el tipo declarado (detectado: ${detected.mime}).`);
    }
  }
  return errors;
}

const router = express.Router();

// ── Directorio de subidas ────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Tipos MIME permitidos ────────────────────────────────────────────────────
// SVG excluido (VUL-007): puede contener JS embebido (XSS)
const ALLOWED_MIMETYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES     = 5;

// ── Configuración Multer ─────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIMETYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES } });

// ── Validaciones del formulario ──────────────────────────────────────────────
const formRules = [
  body('nombre')
    .trim().isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres.'),
  body('correo')
    .isEmail().withMessage('Correo electrónico inválido.').normalizeEmail(),
  body('cedula')
    .trim().matches(/^\d{5,20}$/).withMessage('La cédula debe tener entre 5 y 20 dígitos numéricos.'),
  body('link_vitrina')
    .optional({ checkFalsy: true }).isURL().withMessage('El link de la vitrina debe ser una URL válida.'),
  body('notas')
    .optional().trim().isLength({ max: 1000 }).withMessage('Las notas no pueden superar 1000 caracteres.'),
];

// ── POST /api/questionnaire ── Enviar cuestionario ───────────────────────────
router.post('/', authenticateToken, upload.array('archivos', MAX_FILES), formRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
    return res.status(400).json({ errors: errors.array() });
  }

  // Validar magic bytes de archivos binarios (VUL-003)
  if (req.files?.length) {
    const magicErrors = await validateMagicBytes(req.files);
    if (magicErrors.length) {
      req.files.forEach(f => fs.unlink(f.path, () => {}));
      return res.status(400).json({ error: `Tipo de archivo inválido:\n${magicErrors.join('\n')}` });
    }
  }

  const { nombre, correo, cedula, link_vitrina, notas } = req.body;

  const insertResponse   = db.prepare(
    'INSERT INTO responses (user_id, nombre, correo, cedula, link_vitrina, notas) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertAttachment = db.prepare(
    'INSERT INTO attachments (response_id, stored_name, original_name, mimetype, size) VALUES (?, ?, ?, ?, ?)'
  );

  const runTransaction = db.transaction(() => {
    const { lastInsertRowid: responseId } = insertResponse.run(
      req.user.id, nombre, correo, cedula, link_vitrina || null, notas || null
    );
    if (req.files?.length) {
      for (const file of req.files) {
        insertAttachment.run(responseId, file.filename, file.originalname, file.mimetype, file.size);
      }
    }
    return responseId;
  });

  try {
    const responseId = runTransaction();
    return res.status(201).json({ message: 'Cuestionario enviado exitosamente.', responseId });
  } catch (err) {
    if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
    console.error(err);
    return res.status(500).json({ error: 'Error al guardar el cuestionario.' });
  }
});

// ── GET /api/questionnaire ── Listar todas (solo admin) ──────────────────────
router.get('/', authenticateToken, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.nombre, r.correo, r.cedula, r.link_vitrina, r.notas, r.created_at,
           u.username AS submitted_by,
           COUNT(a.id) AS attachment_count
    FROM   responses r
    JOIN   users u       ON u.id = r.user_id
    LEFT JOIN attachments a ON a.response_id = r.id
    GROUP  BY r.id
    ORDER  BY r.created_at DESC
  `).all();
  return res.json({ responses: rows });
});

// ── GET /api/questionnaire/my ── Mis respuestas ───────────────────────────────
router.get('/my', authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.nombre, r.correo, r.cedula, r.link_vitrina, r.notas, r.created_at,
           COUNT(a.id) AS attachment_count
    FROM   responses r
    LEFT JOIN attachments a ON a.response_id = r.id
    WHERE  r.user_id = ?
    GROUP  BY r.id
    ORDER  BY r.created_at DESC
  `).all(req.user.id);
  return res.json({ responses: rows });
});

// ── GET /api/questionnaire/:id ── Detalle de una respuesta ───────────────────
router.get('/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

  const response = db.prepare(`
    SELECT r.*, u.username AS submitted_by
    FROM   responses r JOIN users u ON u.id = r.user_id
    WHERE  r.id = ?
  `).get(id);

  if (!response) return res.status(404).json({ error: 'Respuesta no encontrada.' });
  if (req.user.role !== 'admin' && response.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Sin permisos para ver esta respuesta.' });
  }

  const attachments = db.prepare(
    'SELECT id, stored_name, original_name, mimetype, size, created_at FROM attachments WHERE response_id = ?'
  ).all(id);

  return res.json({ response, attachments });
});

// ── GET /api/questionnaire/:id/files/:filename ── Descargar archivo ──────────
router.get('/:id/files/:filename', authenticateToken, (req, res) => {
  const id       = parseInt(req.params.id, 10);
  const filename = path.basename(req.params.filename); // prevenir path traversal

  if (isNaN(id) || !/^[a-f0-9-]+\.[a-zA-Z0-9]+$/i.test(filename)) {
    return res.status(400).json({ error: 'Solicitud inválida.' });
  }

  const attachment = db.prepare(`
    SELECT a.*, r.user_id
    FROM   attachments a JOIN responses r ON r.id = a.response_id
    WHERE  a.response_id = ? AND a.stored_name = ?
  `).get(id, filename);

  if (!attachment) return res.status(404).json({ error: 'Archivo no encontrado.' });
  if (req.user.role !== 'admin' && attachment.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Sin permisos.' });
  }

  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no disponible en el servidor.' });

  res.setHeader('Content-Type', attachment.mimetype);
  // Sanitizar nombre para prevenir header injection (VUL-004)
  const safeFilename = attachment.original_name
    .replace(/[\r\n"\\]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_');
  const encodedFilename = encodeURIComponent(attachment.original_name);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);
  res.sendFile(filePath);
});

// ── Manejador de errores Multer ───────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')  return res.status(400).json({ error: 'El archivo supera el límite de 10 MB.' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: `Máximo ${MAX_FILES} archivos por envío.` });
    return res.status(400).json({ error: `Error al subir archivo: ${err.message}` });
  }
  if (err?.message?.startsWith('Tipo de archivo')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Error interno.' });
});

module.exports = router;
