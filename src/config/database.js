'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH  = path.join(DATA_DIR, 'database.sqlite');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function runMigrations() {
  const getVersion = () => db.pragma('user_version', { simple: true });

  if (getVersion() < 1) {
    // Migración: actualizar roles de 'user'→'operador', añadir 'revisor'
    db.exec(`
      BEGIN;
      CREATE TABLE users_new (
        id            INTEGER  PRIMARY KEY AUTOINCREMENT,
        username      TEXT     NOT NULL UNIQUE,
        email         TEXT     NOT NULL UNIQUE,
        password_hash TEXT     NOT NULL,
        role          TEXT     NOT NULL DEFAULT 'operador'
                               CHECK(role IN ('admin', 'revisor', 'operador')),
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users_new
        SELECT id, username, email, password_hash,
          CASE WHEN role = 'admin' THEN 'admin' ELSE 'operador' END,
          created_at
        FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
    `);
    db.pragma('user_version = 1');
    console.log('Migración v1 aplicada: roles actualizados.');
  }

  if (getVersion() < 2) {
    db.exec(`
      BEGIN;

      CREATE TABLE IF NOT EXISTS submissions (
        id           INTEGER  PRIMARY KEY AUTOINCREMENT,
        operator_id  INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status       TEXT     NOT NULL DEFAULT 'pendiente_revision'
                               CHECK(status IN ('pendiente_revision', 'aprobado', 'rechazado')),
        url_vitrina  TEXT,
        url_chatbot  TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        submitted_at DATETIME,
        reviewed_at  DATETIME,
        reviewer_id  INTEGER  REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS submission_files (
        id            INTEGER  PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER  NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        field_name    TEXT     NOT NULL,
        stored_name   TEXT     NOT NULL UNIQUE,
        original_name TEXT     NOT NULL,
        mimetype      TEXT     NOT NULL,
        size          INTEGER  NOT NULL,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(submission_id, field_name)
      );

      CREATE TABLE IF NOT EXISTS review_fields (
        id            INTEGER  PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER  NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        reviewer_id   INTEGER  NOT NULL REFERENCES users(id),
        field_name    TEXT     NOT NULL,
        status        TEXT     NOT NULL CHECK(status IN ('cumple', 'no_cumple')),
        comment       TEXT,
        reviewed_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(submission_id, field_name)
      );

      COMMIT;
    `);
    db.pragma('user_version = 2');
    console.log('Migración v2 aplicada: tablas de envíos y revisiones creadas.');
  }

  if (getVersion() < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        jti        TEXT     PRIMARY KEY,
        expires_at INTEGER  NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
    `);
    db.pragma('user_version = 3');
    console.log('Migración v3 aplicada: tabla revoked_tokens creada.');
  }

  if (getVersion() < 4) {
    try { db.exec(`ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`); } catch { /* ya existe */ }
    try { db.exec(`ALTER TABLE users ADD COLUMN locked_until DATETIME`); } catch { /* ya existe */ }
    db.pragma('user_version = 4');
    console.log('Migración v4 aplicada: campos de bloqueo de cuenta añadidos a users.');
  }

  if (getVersion() < 5) {
    try { db.exec(`ALTER TABLE submissions ADD COLUMN assigned_reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL`); } catch { /* ya existe */ }
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_submissions_assigned ON submissions(assigned_reviewer_id)`); } catch { /* ya existe */ }
    db.pragma('user_version = 5');
    console.log('Migración v5 aplicada: columna assigned_reviewer_id añadida a submissions.');
  }

  if (getVersion() < 6) {
    // Documento de identificación del propietario de la vitrina.
    // owner_doc_type: CC | NIT | CE | PP
    // owner_doc_number: solo dígitos
    // El índice único parcial (WHERE NOT NULL) permite que envíos antiguos sin documento
    // sigan siendo válidos, pero impide duplicados entre los nuevos.
    try { db.exec(`ALTER TABLE submissions ADD COLUMN owner_doc_type TEXT`); } catch { /* ya existe */ }
    try { db.exec(`ALTER TABLE submissions ADD COLUMN owner_doc_number TEXT`); } catch { /* ya existe */ }
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_owner_doc
               ON submissions(owner_doc_type, owner_doc_number)
               WHERE owner_doc_number IS NOT NULL`);
    } catch { /* ya existe */ }
    db.pragma('user_version = 6');
    console.log('Migración v6 aplicada: campos de documento del propietario añadidos a submissions.');
  }

  if (getVersion() < 7) {
    // Pool de asignación automática: revisores marcados con auto_assign=1 reciben
    // automáticamente cada nuevo envío en cuanto se crea, balanceando la carga total.
    try { db.exec(`ALTER TABLE users ADD COLUMN auto_assign INTEGER NOT NULL DEFAULT 0`); } catch { /* ya existe */ }
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_users_auto_assign ON users(auto_assign) WHERE auto_assign = 1`); } catch { /* ya existe */ }
    db.pragma('user_version = 7');
    console.log('Migración v7 aplicada: columna auto_assign añadida a users (pool de asignación automática).');
  }

  if (getVersion() < 8) {
    // Notas u observaciones opcionales del operador por cada campo del envío.
    // field_name puede ser cualquier nombre de archivo (cedula_pdf, informe_pdf, etc.)
    // o un campo de texto (url_vitrina, url_chatbot, owner_doc).
    db.exec(`
      CREATE TABLE IF NOT EXISTS operator_notes (
        id            INTEGER  PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER  NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        field_name    TEXT     NOT NULL,
        comment       TEXT     NOT NULL,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(submission_id, field_name)
      );
      CREATE INDEX IF NOT EXISTS idx_operator_notes_submission ON operator_notes(submission_id);
    `);
    db.pragma('user_version = 8');
    console.log('Migración v8 aplicada: tabla operator_notes creada (comentarios opcionales del operador).');
  }

  if (getVersion() < 9) {
    // Bitácora DURABLE de revisiones. Cada vez que un revisor completa una revisión
    // se registra aquí un evento que NO se borra cuando el operador reenvía una
    // corrección, ni cuando se renombra/cambia de rol/elimina al revisor.
    //
    // Antes "total revisadas / histórico" se calculaba con submissions.reviewer_id o
    // con review_fields, pero ambos se pierden al reenviar (reviewer_id pasa a NULL y
    // review_fields se borra/sobrescribe), haciendo que el revisor perdiera el crédito
    // de revisiones que sí realizó. Esta tabla es la única fuente de verdad durable
    // para los conteos de revisiones realizadas.
    db.exec(`
      CREATE TABLE IF NOT EXISTS review_events (
        id            INTEGER  PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER  NOT NULL,
        reviewer_id   INTEGER  NOT NULL,
        result        TEXT     NOT NULL CHECK(result IN ('aprobado', 'rechazado')),
        reviewed_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_review_events_reviewer ON review_events(reviewer_id);
      CREATE INDEX IF NOT EXISTS idx_review_events_submission ON review_events(submission_id);
    `);

    // Backfill para no perder el crédito existente al actualizar. Preferimos la
    // evidencia más rica (review_fields, que conserva el veredicto por revisor de la
    // última ronda de cada envío); si no hay, caemos al estado vigente de submissions.
    try {
      const fromFields = db.prepare(`
        SELECT rf.submission_id AS sid, rf.reviewer_id AS rid,
               CASE WHEN SUM(CASE WHEN rf.status='no_cumple' THEN 1 ELSE 0 END) > 0
                    THEN 'rechazado' ELSE 'aprobado' END AS result,
               MAX(rf.reviewed_at) AS rat
        FROM review_fields rf
        GROUP BY rf.submission_id, rf.reviewer_id
      `).all();
      const insEv = db.prepare(`INSERT INTO review_events (submission_id, reviewer_id, result, reviewed_at) VALUES (?,?,?,COALESCE(?,CURRENT_TIMESTAMP))`);
      const seen = new Set();
      const tx = db.transaction(() => {
        for (const r of fromFields) { insEv.run(r.sid, r.rid, r.result, r.rat); seen.add(r.sid + ':' + r.rid); }
        // Envíos revisados cuyo veredicto sólo vive en submissions (review_fields ya borrados)
        const fromSubs = db.prepare(`SELECT id AS sid, reviewer_id AS rid, status AS result, reviewed_at AS rat FROM submissions WHERE reviewer_id IS NOT NULL AND status IN ('aprobado','rechazado')`).all();
        for (const r of fromSubs) { if (!seen.has(r.sid + ':' + r.rid)) insEv.run(r.sid, r.rid, r.result, r.rat); }
      });
      tx();
    } catch (e) {
      console.error('[migración v9] backfill de review_events falló:', e.message);
    }

    db.pragma('user_version = 9');
    console.log('Migración v9 aplicada: bitácora durable review_events creada y poblada.');
  }
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER  PRIMARY KEY AUTOINCREMENT,
      username      TEXT     NOT NULL UNIQUE,
      email         TEXT     NOT NULL UNIQUE,
      password_hash TEXT     NOT NULL,
      role          TEXT     NOT NULL DEFAULT 'operador'
                             CHECK(role IN ('admin', 'revisor', 'operador')),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS responses (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nombre       TEXT     NOT NULL,
      correo       TEXT     NOT NULL,
      cedula       TEXT     NOT NULL,
      link_vitrina TEXT,
      notas        TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id            INTEGER  PRIMARY KEY AUTOINCREMENT,
      response_id   INTEGER  NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      stored_name   TEXT     NOT NULL UNIQUE,
      original_name TEXT     NOT NULL,
      mimetype      TEXT     NOT NULL,
      size          INTEGER  NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  runMigrations();
  console.log('Base de datos lista.');
}

module.exports = { db, initDatabase };
