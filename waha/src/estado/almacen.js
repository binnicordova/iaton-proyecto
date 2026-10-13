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
    sesGet: db.prepare('SELECT telefono, uid, refresh, id_token AS idToken, vence FROM sesiones_firebase WHERE telefono = ?'),
    sesPut: db.prepare('INSERT INTO sesiones_firebase (telefono, uid, refresh, id_token, vence) VALUES (?, ?, ?, ?, ?) ON CONFLICT(telefono) DO UPDATE SET uid = excluded.uid, refresh = excluded.refresh, id_token = excluded.id_token, vence = excluded.vence'),
    sesDel: db.prepare('DELETE FROM sesiones_firebase WHERE telefono = ?'),
    ordPut: db.prepare('INSERT OR IGNORE INTO ordenes (orden_id, telefono, chat_id, creada) VALUES (?, ?, ?, ?)'),
    ordDe: db.prepare('SELECT orden_id AS ordenId, telefono, chat_id AS chatId, creada FROM ordenes WHERE telefono = ? ORDER BY creada DESC, orden_id DESC'),
    segPut: db.prepare('INSERT OR IGNORE INTO seguimientos (orden_id, telefono, chat_id, creado) VALUES (?, ?, ?, ?)'),
    segAbiertos: db.prepare('SELECT orden_id AS ordenId, telefono, chat_id AS chatId, creado, estado_avisado AS estadoAvisado, recibo_enviado AS reciboEnviado, cerrado FROM seguimientos WHERE cerrado = 0 ORDER BY creado, orden_id'),
    segUno: db.prepare('SELECT orden_id AS ordenId, telefono, chat_id AS chatId, creado, estado_avisado AS estadoAvisado, recibo_enviado AS reciboEnviado, cerrado FROM seguimientos WHERE orden_id = ?'),
    segUpd: db.prepare('UPDATE seguimientos SET estado_avisado = COALESCE(?, estado_avisado), recibo_enviado = COALESCE(?, recibo_enviado), cerrado = COALESCE(?, cerrado) WHERE orden_id = ?'),
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
    // Sesión de Firebase de cada cliente (usuario anónimo). El token de renovación es un secreto: nunca se registra.
    sesionFirebase(tel) { const f = sql.sesGet.get(tel); return f ? { ...f } : null; },
    guardarSesionFirebase({ telefono, uid, refresh, idToken, vence }) { sql.sesPut.run(telefono, uid, refresh, idToken, vence); },
    borrarSesionFirebase(tel) { sql.sesDel.run(tel); },
    // Órdenes que el bot creó para cada teléfono, y seguimiento de las que esperan respuesta del personal.
    agregarOrden({ ordenId, telefono, chatId, creada }) { sql.ordPut.run(ordenId, telefono, chatId || null, creada); },
    ordenesDe(tel) { return sql.ordDe.all(tel).map((o) => ({ ...o })); },
    abrirSeguimiento({ ordenId, telefono, chatId, creado }) { sql.segPut.run(ordenId, telefono, chatId, creado); },
    seguimiento(ordenId) { const s = sql.segUno.get(ordenId); return s ? { ...s } : null; },
    seguimientosAbiertos() { return sql.segAbiertos.all().map((s) => ({ ...s })); },
    actualizarSeguimiento(ordenId, { estadoAvisado, reciboEnviado, cerrado } = {}) {
      sql.segUpd.run(estadoAvisado === undefined ? null : estadoAvisado, reciboEnviado === undefined ? null : reciboEnviado, cerrado === undefined ? null : cerrado, ordenId);
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
