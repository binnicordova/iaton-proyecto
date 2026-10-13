const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function abrirDb(ruta) {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversaciones (telefono TEXT PRIMARY KEY, ejecucion TEXT NOT NULL, actualizado TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS eventos_vistos (id TEXT PRIMARY KEY, visto TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS registro (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, tipo TEXT NOT NULL,
      mensaje_id TEXT, chat TEXT, estado TEXT, latencia_ms INTEGER, detalle TEXT
    );
  `);
  return db;
}

module.exports = { abrirDb };
