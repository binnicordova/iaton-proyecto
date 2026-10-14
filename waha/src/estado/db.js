const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function abrirDb(ruta) {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  // La base guarda tokens de renovación y datos de conversaciones en curso: solo el dueño puede leerla.
  // SQLite crea los archivos -wal y -shm con los permisos de la base.
  if (ruta !== ':memory:') { fs.closeSync(fs.openSync(ruta, 'a', 0o600)); fs.chmodSync(ruta, 0o600); }
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversaciones (telefono TEXT PRIMARY KEY, ejecucion TEXT NOT NULL, actualizado TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS eventos_vistos (id TEXT PRIMARY KEY, visto TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sesiones_firebase (
      telefono TEXT PRIMARY KEY, uid TEXT NOT NULL, refresh TEXT NOT NULL, id_token TEXT NOT NULL, vence INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ordenes (orden_id TEXT PRIMARY KEY, telefono TEXT NOT NULL, chat_id TEXT, creada TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS seguimientos (
      orden_id TEXT PRIMARY KEY, telefono TEXT NOT NULL, chat_id TEXT NOT NULL, creado TEXT NOT NULL,
      estado_avisado TEXT, recibo_enviado INTEGER NOT NULL DEFAULT 0, cerrado INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS registro (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, tipo TEXT NOT NULL,
      mensaje_id TEXT, chat TEXT, estado TEXT, latencia_ms INTEGER, detalle TEXT
    );
  `);
  return db;
}

module.exports = { abrirDb };
