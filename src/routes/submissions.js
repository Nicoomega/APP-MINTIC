'use strict';
const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const { v4: uuidv4 } = require('uuid');
const pdfParse  = require('pdf-parse');
const FileType  = require('file-type');
const { db }    = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Documento del propietario de la vitrina ──────────────────────────────────
const OWNER_DOC_TYPES = ['CC', 'NIT', 'CE', 'PP'];

// ── Notas opcionales del operador ────────────────────────────────────────────
// Campos válidos para los comentarios del operador. Se aceptan tanto los nombres
// de archivos como las URLs y el documento del propietario.
const NOTE_FIELDS = new Set([
  // Archivos (los 7)
  'cedula_pdf', 'informe_pdf', 'certificado_pdf',
  'planilla_conecta_pdf', 'planilla_comunicacion_pdf',
  'calificacion_modulos_pdf', 'evidencia_chatbot',
  // Otros campos del envío
  'url_vitrina', 'url_chatbot', 'owner_doc',
]);
const MAX_NOTE_LENGTH = 2000;

// Extrae las notas del body (campos con prefijo "note_<field_name>") y devuelve
// un array de { field_name, comment } para los que tienen contenido válido.
function parseOperatorNotes(body) {
  const notes = [];
  for (const field of NOTE_FIELDS) {
    const raw = body?.[`note_${field}`];
    if (raw === undefined || raw === null) continue;
    const trimmed = String(raw).trim();
    if (!trimmed) continue;                                  // vacío → no se guarda
    if (trimmed.length > MAX_NOTE_LENGTH) {
      return { error: `La nota del campo "${field}" excede ${MAX_NOTE_LENGTH} caracteres.` };
    }
    notes.push({ field_name: field, comment: trimmed });
  }
  return { notes };
}

// Reemplaza por completo las notas del envío (borra las anteriores y guarda las nuevas).
function saveOperatorNotes(submissionId, notes) {
  const del = db.prepare('DELETE FROM operator_notes WHERE submission_id = ?');
  const ins = db.prepare(`
    INSERT INTO operator_notes (submission_id, field_name, comment, created_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  del.run(submissionId);
  for (const n of notes) ins.run(submissionId, n.field_name, n.comment);
}

// Devuelve { type, number, errors } — type/number normalizados o errors no vacío
function validateOwnerDoc(rawType, rawNumber, { required = true } = {}) {
  const errors = [];
  const type   = String(rawType ?? '').trim().toUpperCase();
  const number = String(rawNumber ?? '').trim().replace(/[.\s-]/g, '');

  if (!type && !number) {
    if (required) errors.push('Debes indicar el tipo y número de documento del propietario.');
    return { type: null, number: null, errors };
  }
  if (!OWNER_DOC_TYPES.includes(type)) {
    errors.push(`Tipo de documento inválido. Permitidos: ${OWNER_DOC_TYPES.join(', ')}.`);
  }
  if (!/^\d{6,15}$/.test(number)) {
    errors.push('El número de documento debe tener entre 6 y 15 dígitos (solo números).');
  }
  return { type: type || null, number: number || null, errors };
}

// Busca un envío que YA use ese documento. Si excludeId, lo excluye del chequeo.
function findDocConflict(type, number, excludeId = null) {
  if (!type || !number) return null;
  const sql = excludeId
    ? 'SELECT id, operator_id FROM submissions WHERE owner_doc_type = ? AND owner_doc_number = ? AND id != ? LIMIT 1'
    : 'SELECT id, operator_id FROM submissions WHERE owner_doc_type = ? AND owner_doc_number = ? LIMIT 1';
  return excludeId ? db.prepare(sql).get(type, number, excludeId) : db.prepare(sql).get(type, number);
}

// ── Configuración de cada campo de archivo ────────────────────────────────────
const FIELD_CONFIGS = {
  cedula_pdf:                { mimes: ['application/pdf'],               maxPages: 15,   maxMB: 5,  label: 'Cédula del beneficiario',                        required: true },
  informe_pdf:               { mimes: ['application/pdf'],               maxPages: null, maxMB: 10, label: 'Informe general',                                required: true },
  certificado_pdf:           { mimes: ['application/pdf'],               maxPages: 2,    maxMB: 5,  label: 'Certificado',                                    required: true },
  planilla_conecta_pdf:      { mimes: ['application/pdf'],               maxPages: 3,    maxMB: 5,  label: 'Planilla INTRODUCCIÓN A CONECTA REGIÓN CARIBE',  required: true },
  planilla_comunicacion_pdf: { mimes: ['application/pdf'],               maxPages: 3,    maxMB: 5,  label: 'Planilla COMUNICACIÓN EFECTIVA Y PROMOCIÓN',     required: true },
  calificacion_modulos_pdf:  { mimes: ['application/pdf'],               maxPages: 3,    maxMB: 5,  label: 'Calificación módulos virtuales',                 required: true },
  evidencia_chatbot:         { mimes: ['application/pdf','image/jpeg','image/png'],  maxPages: null, maxMB: 10, label: 'Evidencia del chatbot',                          required: true },
};
const ALL_FIELDS = Object.keys(FIELD_CONFIGS);

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const cfg = FIELD_CONFIGS[file.fieldname];
  if (!cfg) return cb(new Error(`Campo desconocido: ${file.fieldname}`));
  if (!cfg.mimes.includes(file.mimetype)) {
    return cb(new Error(`Tipo no permitido para "${cfg.label}". Formatos aceptados: ${cfg.mimes.map(m => m.split('/')[1]).join(', ')}.`));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
}).fields(ALL_FIELDS.map(n => ({ name: n, maxCount: 1 })));

// ── Helpers ───────────────────────────────────────────────────────────────────
function deleteFiles(paths) {
  for (const p of paths) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
}

// Asigna el envío indicado al revisor del pool de asignación automática con menor
// carga total (revisados + pendientes asignados). Devuelve el id del revisor elegido,
// o null si el pool está vacío. Es seguro llamarla dentro de una transacción.
function autoAssignFromPool(submissionId) {
  const pool = db.prepare(`
    SELECT
      u.id,
      (SELECT COUNT(*) FROM review_events e WHERE e.reviewer_id = u.id) AS reviewed_total,
      (SELECT COUNT(*) FROM submissions s
        WHERE s.assigned_reviewer_id = u.id AND s.status = 'pendiente_revision') AS assigned_pending
    FROM users u
    WHERE u.role = 'revisor' AND u.auto_assign = 1
  `).all();

  if (!pool.length) return null;

  let pick = null;
  let pickLoad = Infinity;
  for (const r of pool) {
    const load = r.reviewed_total + r.assigned_pending;
    if (load < pickLoad || (load === pickLoad && pick && r.id < pick.id)) {
      pick = r;
      pickLoad = load;
    }
  }
  if (!pick) return null;

  db.prepare(`
    UPDATE submissions
    SET    assigned_reviewer_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE  id = ?
  `).run(pick.id, submissionId);

  return pick.id;
}

async function countPdfPages(filePath) {
  try {
    const buf  = fs.readFileSync(filePath);
    const data = await pdfParse(buf, { max: 0 });
    return data.numpages;
  } catch { return null; }
}

// VUL-003: validar magic bytes para detectar spoofing de Content-Type
async function validateMagicBytes(files) {
  const errors = [];
  for (const [field, cfg] of Object.entries(FIELD_CONFIGS)) {
    const fileArr = files?.[field];
    if (!fileArr?.length) continue;
    const file     = fileArr[0];
    const filePath = path.join(UPLOADS_DIR, file.filename);
    const detected = await FileType.fromFile(filePath);
    if (!detected) {
      errors.push(`"${cfg.label}": no se pudo determinar el tipo real del archivo.`);
      continue;
    }
    if (!cfg.mimes.includes(detected.mime)) {
      errors.push(`"${cfg.label}": el contenido del archivo no coincide con el tipo declarado (detectado: ${detected.mime}).`);
    }
  }
  return errors;
}

async function validatePages(files) {
  const errors = [];
  for (const [field, cfg] of Object.entries(FIELD_CONFIGS)) {
    const fileArr = files?.[field];
    if (!fileArr?.length) continue;
    const file = fileArr[0];
    if (file.mimetype === 'application/pdf' && cfg.maxPages) {
      const pages = await countPdfPages(path.join(UPLOADS_DIR, file.filename));
      if (pages !== null && pages > cfg.maxPages) {
        errors.push(`"${cfg.label}": máximo ${cfg.maxPages} página(s), el archivo tiene ${pages}.`);
      }
      // pages === null: magic bytes ya validaron que es un PDF; pdf-parse no puede leerlo pero se acepta
    }
  }
  return errors;
}

// ── POST /api/submissions ── Crear envío ──────────────────────────────────────
router.post('/', authenticateToken, requireRole('operador'), (req, res) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Error al subir: ${err.message}` });
    }
    if (err) return res.status(400).json({ error: err.message });

    const uploaded = Object.values(req.files || {}).flat().map(f => path.join(UPLOADS_DIR, f.filename));

    try {
      // Verificar campos obligatorios de archivo
      const missing = ALL_FIELDS.filter(f => !req.files?.[f]?.length);
      if (missing.length) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: `Documentos faltantes: ${missing.map(f => FIELD_CONFIGS[f].label).join(', ')}.` });
      }

      // Validar URLs
      const { url_vitrina, url_chatbot } = req.body;
      if (!url_vitrina?.trim() || !url_chatbot?.trim()) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: 'La URL de la vitrina y la URL del chatbot son obligatorias.' });
      }
      try { new URL(url_vitrina); } catch {
        deleteFiles(uploaded);
        return res.status(400).json({ error: 'La URL de la vitrina no es válida.' });
      }
      try { new URL(url_chatbot); } catch {
        deleteFiles(uploaded);
        return res.status(400).json({ error: 'La URL del chatbot no es válida.' });
      }

      // Validar documento del propietario (obligatorio)
      const doc = validateOwnerDoc(req.body.owner_doc_type, req.body.owner_doc_number, { required: true });
      if (doc.errors.length) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: doc.errors.join(' ') });
      }
      const conflict = findDocConflict(doc.type, doc.number);
      if (conflict) {
        deleteFiles(uploaded);
        return res.status(409).json({
          error: `Ya existe un envío registrado con ${doc.type} ${doc.number}. No se puede duplicar.`,
        });
      }

      // Validar magic bytes primero (VUL-003) — detecta spoofing de Content-Type
      const magicErrors = await validateMagicBytes(req.files);
      if (magicErrors.length) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: `Tipo de archivo inválido:\n${magicErrors.join('\n')}` });
      }

      // Validar páginas (solo rechaza si excede; si pdf-parse no puede leer, magic bytes ya valida)
      const pageErrors = await validatePages(req.files);
      if (pageErrors.length) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: `Límite de páginas excedido:\n${pageErrors.join('\n')}` });
      }

      // Guardar en BD
      const insertSub  = db.prepare(
        `INSERT INTO submissions (operator_id, url_vitrina, url_chatbot, owner_doc_type, owner_doc_number, status, submitted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pendiente_revision', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      );
      const insertFile = db.prepare(
        `INSERT INTO submission_files (submission_id, field_name, stored_name, original_name, mimetype, size)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      // Validar y extraer las notas opcionales del operador antes de la transacción
      const notesRes = parseOperatorNotes(req.body);
      if (notesRes.error) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: notesRes.error });
      }

      try {
        const save = db.transaction(() => {
          const { lastInsertRowid: subId } = insertSub.run(
            req.user.id, url_vitrina.trim(), url_chatbot.trim(), doc.type, doc.number
          );
          for (const field of ALL_FIELDS) {
            const f = req.files[field][0];
            insertFile.run(subId, field, f.filename, f.originalname, f.mimetype, f.size);
          }
          // Guardar notas opcionales del operador
          if (notesRes.notes.length) saveOperatorNotes(subId, notesRes.notes);
          // Asignación automática inmediata si hay revisores en el pool.
          // Si el pool está vacío, el envío queda sin asignar para reparto manual posterior.
          const assignedTo = autoAssignFromPool(subId);
          return { subId, assignedTo };
        });
        const { subId, assignedTo } = save();
        return res.status(201).json({
          message: assignedTo
            ? 'Envío creado y asignado automáticamente a un revisor.'
            : 'Envío creado. En espera de revisión.',
          submissionId: subId,
          assigned_reviewer_id: assignedTo,
        });
      } catch (txErr) {
        // Carrera: alguien insertó el mismo documento entre el chequeo y el INSERT.
        // El índice único parcial lanza SQLITE_CONSTRAINT_UNIQUE.
        deleteFiles(uploaded);
        if (txErr && /UNIQUE/i.test(txErr.message) && /owner_doc/i.test(txErr.message)) {
          return res.status(409).json({
            error: `Ya existe un envío registrado con ${doc.type} ${doc.number}. No se puede duplicar.`,
          });
        }
        throw txErr;
      }

    } catch (e) {
      deleteFiles(uploaded);
      console.error(e);
      return res.status(500).json({ error: 'Error interno al guardar.' });
    }
  });
});

// ── GET /api/submissions ── Lista ─────────────────────────────────────────────
// Para revisores: por defecto solo los asignados a él o que él mismo ya revisó.
// Pasar ?scope=all para ver todos (modo "suave": pueden tomar otros).
router.get('/', authenticateToken, (req, res) => {
  const { role, id: uid } = req.user;
  let rows;
  if (role === 'operador') {
    rows = db.prepare(`
      SELECT s.id, s.status, s.url_vitrina, s.url_chatbot,
             s.owner_doc_type, s.owner_doc_number,
             s.created_at, s.updated_at, s.submitted_at, s.reviewed_at,
             rv.username AS reviewer_name
      FROM   submissions s
      LEFT JOIN users rv ON rv.id = s.reviewer_id
      WHERE  s.operator_id = ?
      ORDER  BY s.updated_at DESC
    `).all(uid);
  } else if (role === 'revisor') {
    const scope = req.query.scope === 'all' ? 'all' : 'mine';
    if (scope === 'all') {
      rows = db.prepare(`
        SELECT s.id, s.status, s.url_vitrina, s.url_chatbot,
               s.owner_doc_type, s.owner_doc_number,
               s.created_at, s.updated_at, s.submitted_at, s.reviewed_at,
               s.assigned_reviewer_id,
               op.username AS operator_name,
               rv.username AS reviewer_name,
               ar.username AS assigned_reviewer_name
        FROM   submissions s
        JOIN   users op ON op.id = s.operator_id
        LEFT JOIN users rv ON rv.id = s.reviewer_id
        LEFT JOIN users ar ON ar.id = s.assigned_reviewer_id
        ORDER  BY s.updated_at DESC
      `).all();
    } else {
      rows = db.prepare(`
        SELECT s.id, s.status, s.url_vitrina, s.url_chatbot,
               s.owner_doc_type, s.owner_doc_number,
               s.created_at, s.updated_at, s.submitted_at, s.reviewed_at,
               s.assigned_reviewer_id,
               op.username AS operator_name,
               rv.username AS reviewer_name,
               ar.username AS assigned_reviewer_name
        FROM   submissions s
        JOIN   users op ON op.id = s.operator_id
        LEFT JOIN users rv ON rv.id = s.reviewer_id
        LEFT JOIN users ar ON ar.id = s.assigned_reviewer_id
        WHERE  s.assigned_reviewer_id = ? OR s.reviewer_id = ?
        ORDER  BY s.updated_at DESC
      `).all(uid, uid);
    }
  } else {
    rows = db.prepare(`
      SELECT s.id, s.status, s.url_vitrina, s.url_chatbot,
             s.created_at, s.updated_at, s.submitted_at, s.reviewed_at,
             s.assigned_reviewer_id,
             op.username AS operator_name,
             rv.username AS reviewer_name,
             ar.username AS assigned_reviewer_name
      FROM   submissions s
      JOIN   users op ON op.id = s.operator_id
      LEFT JOIN users rv ON rv.id = s.reviewer_id
      LEFT JOIN users ar ON ar.id = s.assigned_reviewer_id
      ORDER  BY s.updated_at DESC
    `).all();
  }
  return res.json({ submissions: rows });
});

// ── GET /api/submissions/:id ── Detalle ───────────────────────────────────────
router.get('/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

  const sub = db.prepare(`
    SELECT s.*, op.username AS operator_name, rv.username AS reviewer_name
    FROM   submissions s
    JOIN   users op ON op.id = s.operator_id
    LEFT JOIN users rv ON rv.id = s.reviewer_id
    WHERE  s.id = ?
  `).get(id);
  if (!sub) return res.status(404).json({ error: 'Envío no encontrado.' });

  const { role, id: uid } = req.user;
  if (role === 'operador' && sub.operator_id !== uid) {
    return res.status(403).json({ error: 'Sin permisos para ver este envío.' });
  }

  const files   = db.prepare(
    'SELECT field_name, stored_name, original_name, mimetype, size FROM submission_files WHERE submission_id = ?'
  ).all(id);
  const reviews = db.prepare(
    'SELECT field_name, status, comment, reviewed_at FROM review_fields WHERE submission_id = ? ORDER BY id'
  ).all(id);
  const operator_notes = db.prepare(
    'SELECT field_name, comment, created_at, updated_at FROM operator_notes WHERE submission_id = ?'
  ).all(id);

  return res.json({ submission: sub, files, reviews, operator_notes });
});

// ── PUT /api/submissions/:id ── Corregir (operador, solo si rechazado) ────────
router.put('/:id', authenticateToken, requireRole('operador'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

  const sub = db.prepare('SELECT * FROM submissions WHERE id = ? AND operator_id = ?').get(id, req.user.id);
  if (!sub)                       return res.status(404).json({ error: 'Envío no encontrado.' });
  if (sub.status !== 'rechazado') return res.status(400).json({ error: 'Solo se pueden corregir envíos rechazados.' });

  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Error al subir: ${err.message}` });
    }
    if (err) return res.status(400).json({ error: err.message });

    const uploaded = Object.values(req.files || {}).flat().map(f => path.join(UPLOADS_DIR, f.filename));

    try {
      const { url_vitrina, url_chatbot } = req.body;
      if (url_vitrina?.trim()) {
        try { new URL(url_vitrina); } catch {
          deleteFiles(uploaded);
          return res.status(400).json({ error: 'La URL de la vitrina no es válida.' });
        }
      }
      if (url_chatbot?.trim()) {
        try { new URL(url_chatbot); } catch {
          deleteFiles(uploaded);
          return res.status(400).json({ error: 'La URL del chatbot no es válida.' });
        }
      }

      // Validar magic bytes primero (VUL-003)
      const magicErrors = await validateMagicBytes(req.files);
      if (magicErrors.length) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: `Tipo de archivo inválido:\n${magicErrors.join('\n')}` });
      }

      // Validar páginas de archivos nuevos
      const pageErrors = await validatePages(req.files);
      if (pageErrors.length) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: `Límite de páginas excedido:\n${pageErrors.join('\n')}` });
      }

      // Validar documento del propietario si viene en el body.
      // Si el envío original no lo tenía (registros antiguos pre-v6), exigirlo.
      const docProvided = (req.body.owner_doc_type ?? '').trim() !== '' || (req.body.owner_doc_number ?? '').trim() !== '';
      const docRequired = !sub.owner_doc_number; // los antiguos sin documento deben llenarlo al corregir
      let docType = sub.owner_doc_type;
      let docNumber = sub.owner_doc_number;
      if (docProvided || docRequired) {
        const doc = validateOwnerDoc(req.body.owner_doc_type, req.body.owner_doc_number, { required: docRequired });
        if (doc.errors.length) {
          deleteFiles(uploaded);
          return res.status(400).json({ error: doc.errors.join(' ') });
        }
        if (doc.type && doc.number) {
          const conflict = findDocConflict(doc.type, doc.number, id);
          if (conflict) {
            deleteFiles(uploaded);
            return res.status(409).json({
              error: `Ya existe un envío registrado con ${doc.type} ${doc.number}. No se puede duplicar.`,
            });
          }
          docType = doc.type;
          docNumber = doc.number;
        }
      }

      // Validar notas opcionales del operador antes de la transacción
      const notesRes = parseOperatorNotes(req.body);
      if (notesRes.error) {
        deleteFiles(uploaded);
        return res.status(400).json({ error: notesRes.error });
      }

      try {
        const update = db.transaction(() => {
          const filesToDelete = [];
          const delOld   = db.prepare('SELECT stored_name FROM submission_files WHERE submission_id = ? AND field_name = ?');
          const delRow   = db.prepare('DELETE FROM submission_files WHERE submission_id = ? AND field_name = ?');
          const insFile  = db.prepare(
            `INSERT INTO submission_files (submission_id, field_name, stored_name, original_name, mimetype, size)
             VALUES (?, ?, ?, ?, ?, ?)`
          );

          for (const field of ALL_FIELDS) {
            const arr = req.files?.[field];
            if (arr?.length) {
              const old = delOld.get(id, field);
              if (old) filesToDelete.push(path.join(UPLOADS_DIR, old.stored_name));
              delRow.run(id, field);
              insFile.run(id, field, arr[0].filename, arr[0].originalname, arr[0].mimetype, arr[0].size);
            }
          }

          const sets = ['status = ?', 'updated_at = CURRENT_TIMESTAMP', 'submitted_at = CURRENT_TIMESTAMP', 'reviewed_at = NULL', 'reviewer_id = NULL'];
          const vals = ['pendiente_revision'];
          if (url_vitrina?.trim()) { sets.push('url_vitrina = ?'); vals.push(url_vitrina.trim()); }
          if (url_chatbot?.trim()) { sets.push('url_chatbot = ?'); vals.push(url_chatbot.trim()); }
          if (docType !== sub.owner_doc_type)     { sets.push('owner_doc_type = ?');   vals.push(docType); }
          if (docNumber !== sub.owner_doc_number) { sets.push('owner_doc_number = ?'); vals.push(docNumber); }
          vals.push(id);
          db.prepare(`UPDATE submissions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

          // Limpiar revisiones anteriores para revisión fresca
          db.prepare('DELETE FROM review_fields WHERE submission_id = ?').run(id);

          // Reemplazar notas del operador (la corrección sobreescribe las anteriores)
          saveOperatorNotes(id, notesRes.notes);

          return filesToDelete;
        });

        const oldFiles = update();
        deleteFiles(oldFiles);

        return res.json({ message: 'Envío corregido y enviado nuevamente a revisión.' });
      } catch (txErr) {
        deleteFiles(uploaded);
        if (txErr && /UNIQUE/i.test(txErr.message) && /owner_doc/i.test(txErr.message)) {
          return res.status(409).json({
            error: `Ya existe un envío registrado con ${docType} ${docNumber}. No se puede duplicar.`,
          });
        }
        throw txErr;
      }

    } catch (e) {
      deleteFiles(uploaded);
      console.error(e);
      return res.status(500).json({ error: 'Error interno al actualizar.' });
    }
  });
});

// ── GET /api/submissions/:id/files/:fieldname ── Descargar archivo ────────────
router.get('/:id/files/:fieldname', authenticateToken, (req, res) => {
  const id        = parseInt(req.params.id, 10);
  const fieldname = req.params.fieldname;

  // Validación estricta: solo nombres de campo conocidos (previene path traversal y enumeración)
  const VALID_FIELDNAME = /^[a-zA-Z0-9_]{1,64}$/;
  if (isNaN(id) || !VALID_FIELDNAME.test(fieldname) || !FIELD_CONFIGS[fieldname]) {
    return res.status(400).json({ error: 'Solicitud inválida.' });
  }

  const sub = db.prepare('SELECT operator_id FROM submissions WHERE id = ?').get(id);
  if (!sub) return res.status(404).json({ error: 'Envío no encontrado.' });

  const { role, id: uid } = req.user;
  if (role === 'operador' && sub.operator_id !== uid) {
    return res.status(403).json({ error: 'Sin permisos.' });
  }

  const file = db.prepare(
    'SELECT stored_name, original_name, mimetype FROM submission_files WHERE submission_id = ? AND field_name = ?'
  ).get(id, fieldname);
  if (!file) return res.status(404).json({ error: 'Archivo no encontrado.' });

  const filePath = path.join(UPLOADS_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no disponible en el servidor.' });

  res.setHeader('Content-Type', file.mimetype);
  // Sanitizar nombre de archivo: eliminar caracteres peligrosos para prevenir header injection
  const safeFilename = file.original_name
    .replace(/[\r\n"\\]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_');
  const encodedFilename = encodeURIComponent(file.original_name);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);
  res.sendFile(filePath);
});

// ── Manejador de errores Multer ───────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Archivo demasiado grande (máx. 10 MB).' });
    return res.status(400).json({ error: `Error al subir archivo: ${err.message}` });
  }
  res.status(500).json({ error: 'Error interno.' });
});

module.exports = router;
