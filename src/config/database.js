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
  const version = db.pragma('user_version', { simple: true });

  if (version < 1) {
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

  if (version < 3) {
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

  if (version < 4) {
    try { db.exec(`ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`); } catch { /* ya existe */ }
    try { db.exec(`ALTER TABLE users ADD COLUMN locked_until DATETIME`); } catch { /* ya existe */ }
    db.pragma('user_version = 4');
    console.log('Migración v4 aplicada: campos de bloqueo de cuenta añadidos a users.');
  }

  if (version < 2) {
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
