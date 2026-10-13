// Estado de la conversación, idempotencia, KV de brasper-api y registro de metadatos (nunca el texto de los mensajes).
function crearAlmacen(db) {
  const sql = {
    cargar: db.prepare('SELECT ejecucion FROM conversaciones WHERE telefono = ?'),
    guardar: db.prepare('INSERT INTO conversaciones (telefono, ejecucion, actualizado) VALUES (?, ?, ?) ON CONFLICT(telefono) DO UPDATE SET ejecucion = excluded.ejecucion, actualizado = excluded.actualizado'),
    borrar: db.prepare('DELETE FROM conversaciones WHERE telefono = ?'),
    visto: db.prepare('INSERT OR IGNORE INTO eventos_vistos (id, visto) VALUES (?, ?)'),
    limpiar: db.prepare('DELETE FROM eventos_vistos WHERE visto < ?'),
    kvGet: db.prepare('SELECT valor FROM kv WHERE clave = ?'),
    kvPut: db.prepare('INSERT INTO kv (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'),
    kvDel: db.prepare('DELETE FROM kv WHERE clave = ?'),
    reg: db.prepare('INSERT INTO registro (ts, tipo, mensaje_id, chat, estado, latencia_ms, detalle) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  };
  const ahora = () => new Date().toISOString();
  return {
    cargarEjecucion(tel) {
      const f = sql.cargar.get(tel);
      return f ? JSON.parse(f.ejecucion) : null;
    },
    guardarEjecucion(tel, ej) { sql.guardar.run(tel, JSON.stringify(ej), ahora()); },
    borrarEjecucion(tel) { sql.borrar.run(tel); },
    marcarVisto(id) { return sql.visto.run(id, ahora()).changes === 1; },
    limpiarVistos(antesDeIso) { sql.limpiar.run(antesDeIso); },
    registrar({ tipo, mensajeId = null, chat = null, estado = null, latenciaMs = null, detalle = null, ruta = null }) {
      sql.reg.run(ahora(), tipo, mensajeId, chat, estado, latenciaMs, detalle || ruta);
    },
    // Misma forma que env.KV de Cloudflare: get(k, 'json'), put(k, string), delete(k).
    kvEnv() {
      return {
        async get(k, tipo) {
          const f = sql.kvGet.get(k);
          if (!f) return null;
          return tipo === 'json' ? JSON.parse(f.valor) : f.valor;
        },
        async put(k, v) { sql.kvPut.run(k, String(v)); },
        async delete(k) { sql.kvDel.run(k); },
      };
    },
  };
}

module.exports = { crearAlmacen };
