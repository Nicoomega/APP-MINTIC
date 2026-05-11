'use strict';
// OBS-004: este script es SOLO para desarrollo/pruebas
if (process.env.NODE_ENV === 'production') {
  console.error('ERROR: seed.js no debe ejecutarse en producción. Abortando.');
  process.exit(1);
}

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const db = new Database('data/database.sqlite');

// ── Asegurar segundo operador ──────────────────────────────────────────────────
let op2 = db.prepare('SELECT id FROM users WHERE username = ?').get('operador2');
if (!op2) {
  const hash = bcrypt.hashSync('Test1234', 12);
  const r = db.prepare(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,?)'
  ).run('operador2', 'op2@test.com', hash, 'operador');
  op2 = { id: r.lastInsertRowid };
  console.log('Operador2 creado id=', op2.id);
} else {
  console.log('Operador2 ya existe id=', op2.id);
}

const revisor = db.prepare("SELECT id FROM users WHERE role = 'revisor' LIMIT 1").get();
const op1     = db.prepare("SELECT id FROM users WHERE username = 'operador_test'").get();

// ── Helper: insertar archivos seed ────────────────────────────────────────────
function insertFiles(subId, prefix) {
  const fields = [
    ['cedula_pdf',               'cedula_beneficiario.pdf',         'application/pdf', 143360],
    ['informe_pdf',              'informe_general.pdf',             'application/pdf', 286720],
    ['certificado_pdf',          'certificado_completado.pdf',      'application/pdf', 102400],
    ['planilla_conecta_pdf',     'planilla_conecta_region.pdf',     'application/pdf',  81920],
    ['planilla_comunicacion_pdf','planilla_comunicacion_efectiva.pdf','application/pdf', 81920],
    ['calificacion_modulos_pdf', 'calificacion_modulos_virtuales.pdf','application/pdf', 122880],
    ['evidencia_chatbot',        'captura_chatbot.jpg',             'image/jpeg',      204800],
  ];
  for (const [field, origName, mime, size] of fields) {
    try {
      db.prepare(
        'INSERT INTO submission_files (submission_id,field_name,stored_name,original_name,mimetype,size) VALUES (?,?,?,?,?,?)'
      ).run(subId, field, `${prefix}_${field}`, origName, mime, size);
    } catch { /* ya existe */ }
  }
}

// ── Helper: insertar review (todos cumple) ────────────────────────────────────
function insertReviewApproved(subId, reviewerId) {
  const fields = [
    'gestion_asistencia','firma_gestor','precio_ubicacion_descripcion',
    'catalogo','resenas_calificaciones','vinculo_chatbot',
    'precios_referencia','preguntas_producto',
  ];
  for (const fn of fields) {
    try {
      db.prepare(
        'INSERT INTO review_fields (submission_id,reviewer_id,field_name,status,comment) VALUES (?,?,?,"cumple",null)'
      ).run(subId, reviewerId, fn);
    } catch { /* ya existe */ }
  }
}

// ── Submission 4: operador2, pendiente ─────────────────────────────────────────
if (!db.prepare('SELECT id FROM submissions WHERE id = 4').get()) {
  db.prepare(`
    INSERT INTO submissions (id,operator_id,status,url_vitrina,url_chatbot,submitted_at)
    VALUES (4,?,'pendiente_revision',
      'https://mercado.ejemplo.com/tienda-artesanias',
      'https://bot.ejemplo.com/artesanias',
      '2026-04-22 09:15:00')
  `).run(op2.id);
  insertFiles(4, 'sub4');
  console.log('Submission 4 creada (pendiente, op2)');
}

// ── Submission 5: operador2, aprobado ─────────────────────────────────────────
if (!db.prepare('SELECT id FROM submissions WHERE id = 5').get()) {
  db.prepare(`
    INSERT INTO submissions (id,operator_id,status,url_vitrina,url_chatbot,submitted_at,reviewed_at,reviewer_id)
    VALUES (5,?,'aprobado',
      'https://mercado.ejemplo.com/tienda-ropa',
      'https://bot.ejemplo.com/ropa',
      '2026-04-10 11:00:00',
      '2026-04-12 16:45:00',
      ?)
  `).run(op2.id, revisor.id);
  insertFiles(5, 'sub5');
  insertReviewApproved(5, revisor.id);
  console.log('Submission 5 creada (aprobado, op2)');
}

// ── Submission 6: operador1, rechazado con múltiples observaciones ─────────────
if (!db.prepare('SELECT id FROM submissions WHERE id = 6').get()) {
  db.prepare(`
    INSERT INTO submissions (id,operator_id,status,url_vitrina,url_chatbot,submitted_at,reviewed_at,reviewer_id)
    VALUES (6,?,'rechazado',
      'https://tienda.ejemplo.com/vitrina-correccion',
      'https://chatbot.ejemplo.com/bot-correccion',
      '2026-04-17 08:30:00',
      '2026-04-19 11:20:00',
      ?)
  `).run(op1.id, revisor.id);
  insertFiles(6, 'sub6');
  const reviewFields6 = [
    { fn: 'gestion_asistencia',            st: 'no_cumple', cm: 'Falta firma del beneficiario en la planilla de asistencia del día 12 de abril.' },
    { fn: 'firma_gestor',                  st: 'cumple',    cm: null },
    { fn: 'precio_ubicacion_descripcion',  st: 'no_cumple', cm: 'El precio del producto principal no coincide con el publicado en el catálogo oficial.' },
    { fn: 'catalogo',                      st: 'cumple',    cm: null },
    { fn: 'resenas_calificaciones',        st: 'cumple',    cm: null },
    { fn: 'vinculo_chatbot',               st: 'no_cumple', cm: 'El enlace del chatbot no abre correctamente. Verificar que esté publicado y activo.' },
    { fn: 'precios_referencia',            st: 'cumple',    cm: null },
    { fn: 'preguntas_producto',            st: 'cumple',    cm: null },
  ];
  for (const { fn, st, cm } of reviewFields6) {
    try {
      db.prepare(
        'INSERT INTO review_fields (submission_id,reviewer_id,field_name,status,comment) VALUES (?,?,?,?,?)'
      ).run(6, revisor.id, fn, st, cm);
    } catch { /* ya existe */ }
  }
  console.log('Submission 6 creada (rechazado con 3 obs, op1)');
}

console.log('\n=== RESUMEN FINAL ===');
console.log('Users:', JSON.stringify(db.prepare('SELECT id,username,role FROM users').all()));
console.log('Submissions:', db.prepare('SELECT COUNT(*) as c FROM submissions').get().c);
console.log('Files:', db.prepare('SELECT COUNT(*) as c FROM submission_files').get().c);
console.log('Reviews:', db.prepare('SELECT COUNT(*) as c FROM review_fields').get().c);
