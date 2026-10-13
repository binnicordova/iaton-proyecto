const crypto = require('node:crypto');
const http = require('node:http');
const { verificarHmac } = require('./webhook/hmac');
const { normalizarEvento } = require('./webhook/normalizar');
const { enmascarar, soloDigitos } = require('./util');
const { entregarComprobante } = require('./comprobante/entrega');

const LIMITE_CUERPO = 256 * 1024;

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    let excedido = false;
    req.on('data', (c) => { total += c.length; if (total > LIMITE_CUERPO) excedido = true; else partes.push(c); });
    req.on('end', () => (excedido ? reject(Object.assign(new Error('cuerpo demasiado grande'), { estado: 413 })) : resolve(Buffer.concat(partes))));
    req.on('error', reject);
  });
}

// Los ids de WAHA (WEBJS) son "false_<teléfono>@c.us_<hex>": solo se registra el sufijo.
const idSinTelefono = (id) => String(id || '').split('_').pop();

function iguales(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function crearServidor({ config, motor, almacen, proveedor, fetchImpl = fetch, saludBackend = async () => {} }) {
  const pendientes = new Set();
  const enSegundoPlano = (promesa) => { pendientes.add(promesa); promesa.finally(() => pendientes.delete(promesa)); };
  const kv = almacen.kvEnv();

  // Un @lid se traduce al teléfono real (con caché en el KV) para que el estado, las demos y los avisos usen el mismo número.
  // Si WAHA no lo resuelve, se usa el LID como identidad.
  async function identificar(n) {
    if (!n.chatId.endsWith('@lid') || n.telefono !== soloDigitos(n.chatId)) return n; // @c.us, o el teléfono real ya vino en el evento
    const clave = `lid:${n.telefono}`;
    let tel = await kv.get(clave, 'json');
    if (!tel) {
      tel = await proveedor.resolverTelefono(n.chatId);
      if (tel) await kv.put(clave, JSON.stringify(tel));
    }
    return tel ? { ...n, telefono: tel } : n;
  }

  async function procesar(entrante) {
    const t0 = Date.now();
    let n = entrante;
    try {
      n = await identificar(entrante);
      await kv.put(`chat:${n.telefono}`, JSON.stringify(n.chatId));
      proveedor.marcarLeido(n.chatId);
      await motor.procesarMensaje(n);
      almacen.registrar({ tipo: 'mensaje', mensajeId: idSinTelefono(n.mensajeId), chat: enmascarar(n.chatId), estado: 'ok', latenciaMs: Date.now() - t0 });
    } catch (e) {
      almacen.registrar({ tipo: 'mensaje', mensajeId: idSinTelefono(n.mensajeId), chat: enmascarar(n.chatId), estado: 'error', latenciaMs: Date.now() - t0, detalle: String(e.message).slice(0, 200) });
    }
  }

  async function webhook(req, responder) {
    const cuerpo = await leerCuerpo(req);
    if (!verificarHmac({ cuerpoCrudo: cuerpo, firma: req.headers['x-webhook-hmac'], secreto: config.hmacSecret })) return responder(401, { error: 'firma inválida' });
    let evento;
    try { evento = JSON.parse(cuerpo.toString('utf8')); } catch { return responder(400, { error: 'json inválido' }); }
    const n = normalizarEvento(evento);
    if (!n) return responder(200, { ok: true, ignorado: true });
    if (n.tipo === 'sesion') {
      almacen.registrar({ tipo: 'sesion', estado: n.estado });
      return responder(200, { ok: true });
    }
    const eventoNuevo = almacen.marcarVisto(`evt:${n.eventoId}`);
    const mensajeNuevo = almacen.marcarVisto(`msg:${n.mensajeId}`);
    if (!eventoNuevo || !mensajeNuevo) return responder(200, { ok: true, duplicado: true });
    responder(200, { ok: true }); // WAHA reintenta si tarda: se responde antes de ejecutar el flujo
    enSegundoPlano(procesar(n));
  }

  async function salud(responder) {
    const base = { provider: 'waha', session: config.wahaSession };
    try {
      const r = await fetchImpl(`${config.wahaBaseUrl}/api/sessions/${config.wahaSession}`, { headers: { 'X-Api-Key': config.wahaApiKey }, signal: AbortSignal.timeout(3000) });
      if (!r.ok) return responder(503, { ...base, status: `HTTP_${r.status}`, ready: false });
      const s = await r.json();
      const listo = s.status === 'WORKING';
      return responder(listo ? 200 : 503, { ...base, status: s.status, ready: listo });
    } catch {
      return responder(503, { ...base, status: 'UNREACHABLE', ready: false });
    }
  }

  // En modo real basta con que el backend responda (p. ej. getRates); el detalle del fallo nunca sale al exterior.
  async function saludDelBackend(responder) {
    if (config.backend !== 'real') return responder(200, { backend: 'simulado', ready: true });
    try {
      await saludBackend();
      return responder(200, { backend: 'real', ready: true });
    } catch {
      return responder(503, { backend: 'real', ready: false });
    }
  }

  async function avisos(req, responder) {
    if (!iguales(req.headers['x-internal-key'], config.internalKey)) return responder(401, { error: 'no autorizado' });
    let datos;
    try { datos = JSON.parse((await leerCuerpo(req)).toString('utf8')); } catch { return responder(400, { error: 'json inválido' }); }
    if (!/^\d{6,20}$/.test(String(datos.telefono || '')) || !/^BR-\d+$/.test(String(datos.operacion_id || ''))) return responder(400, { error: 'telefono u operacion_id inválidos' });
    const guardado = await kv.get(`chat:${datos.telefono}`, 'json');
    const chatId = guardado || `${datos.telefono}@c.us`;
    const r = await motor.iniciar('E4', datos.telefono, chatId, { operacion_id: datos.operacion_id });
    // Después del aviso de E4, el comprobante en PDF por el mismo chat. Un fallo aquí nunca rompe el aviso.
    if (r.iniciado && config.backend !== 'real' && config.comprobanteEntrega === 'whatsapp') {
      try {
        r.comprobante = await entregarComprobante({ kv, proveedor, registrar: (e) => almacen.registrar(e), telefono: datos.telefono, chatId, operacionId: datos.operacion_id });
      } catch (e) {
        almacen.registrar({ tipo: 'error_comprobante', chat: enmascarar(chatId), detalle: String(e.message).slice(0, 200) });
        r.comprobante = { enviado: false, motivo: 'error' };
      }
    }
    return responder(200, r);
  }

  const servidor = http.createServer(async (req, res) => {
    const responder = (estado, obj) => { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      const { pathname } = new URL(req.url, 'http://local');
      if (req.method === 'POST' && pathname === '/webhooks/waha') return await webhook(req, responder);
      if (req.method === 'GET' && pathname === '/health/whatsapp') return await salud(responder);
      if (req.method === 'GET' && pathname === '/health/backend') return await saludDelBackend(responder);
      if (req.method === 'POST' && pathname === '/internal/avisos') return await avisos(req, responder);
      return responder(404, { error: 'no encontrado' });
    } catch (e) {
      return responder(e.estado || 500, { error: e.estado ? e.message : 'error interno' });
    }
  });

  return { servidor, inactivo: async () => { while (pendientes.size) await Promise.allSettled([...pendientes]); } };
}

module.exports = { crearServidor };
