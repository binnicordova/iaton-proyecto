const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Flow } = require('../../kapso/build/flow');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearMotor } = require('../src/motor/motor');
const { crearServidor } = require('../src/server');
const { firmar } = require('../src/webhook/hmac');
const { ProveedorFalso } = require('./helpers/proveedor-falso');

const SECRETO = 'secreto-hmac';
const CONFIG = { comprobanteEntrega: 'whatsapp', hmacSecret: SECRETO, internalKey: 'clave-interna', wahaBaseUrl: 'http://waha:3000', wahaApiKey: 'K', wahaSession: 'demo' };
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'waha', `${n}.json`), 'utf8'));

function flujos() {
  const w0 = new Flow('W0', 'W0', 'w0'); w0.start().text('eco', 'eco'); w0.link('start', 'eco');
  const e4 = new Flow('E4', 'E4', 'e4'); e4.start().text('av', 'aviso {{vars.operacion_id}}'); e4.link('start', 'av');
  return { W0: w0, E4: e4 };
}

async function levantar({ fetchImpl, config, saludBackend } = {}) {
  const db = abrirDb(':memory:');
  const almacen = crearAlmacen(db);
  const proveedor = new ProveedorFalso();
  const motor = crearMotor({ flujos: flujos(), almacen, proveedor, llamarFuncion: async () => ({ vars: {} }), extraer: async () => ({}) });
  const { servidor, inactivo } = crearServidor({ config: { ...CONFIG, ...config }, motor, almacen, proveedor, fetchImpl, saludBackend });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  servidor.unref(); // si una prueba falla antes de cerrar, el proceso no se queda colgado
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const enviar = async (evento, { secreto = SECRETO, firma } = {}) => {
    const cuerpo = typeof evento === 'string' ? evento : JSON.stringify(evento);
    const res = await fetch(`${base}/webhooks/waha`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Hmac': firma || firmar(cuerpo, secreto) }, body: cuerpo });
    return { status: res.status, json: await res.json() };
  };
  return { db, almacen, proveedor, inactivo, base, enviar, cerrar: () => new Promise((r) => servidor.close(r)) };
}

test('una firma inválida o ausente da 401 y no envía nada', async () => {
  const s = await levantar();
  assert.equal((await s.enviar(fx('message_text'), { secreto: 'otro' })).status, 401);
  const sinFirma = await fetch(`${s.base}/webhooks/waha`, { method: 'POST', body: JSON.stringify(fx('message_text')) });
  assert.equal(sinFirma.status, 401);
  await s.inactivo();
  assert.equal(s.proveedor.enviados.length, 0);
  await s.cerrar();
});

test('un mensaje válido se responde una vez', async () => {
  const s = await levantar();
  const r = await s.enviar(fx('message_text'));
  assert.equal(r.status, 200);
  await s.inactivo();
  assert.deepEqual(s.proveedor.textos(), ['eco']);
  assert.equal(s.proveedor.enviados[0].chatId, '51999999999@c.us');
  await s.cerrar();
});

test('REVIEW 2: el mismo evento reenviado por WAHA no genera una segunda respuesta', async () => {
  const s = await levantar();
  await s.enviar(fx('message_text'));
  const repetido = await s.enviar(fx('message_text'));
  assert.equal(repetido.json.duplicado, true);
  const otroEventoMismoMensaje = fx('message_text');
  otroEventoMismoMensaje.id = 'evt_otro';
  assert.equal((await s.enviar(otroEventoMismoMensaje)).json.duplicado, true);
  await s.inactivo();
  assert.deepEqual(s.proveedor.textos(), ['eco']);
  await s.cerrar();
});

test('los mensajes propios, de grupo y los eventos ajenos se ignoran con 200', async () => {
  const s = await levantar();
  for (const e of [fx('message_from_me'), fx('message_group'), { id: 'x', event: 'message.ack', session: 'demo', payload: {} }]) {
    const r = await s.enviar(e);
    assert.equal(r.status, 200);
    assert.equal(r.json.ignorado, true);
  }
  await s.inactivo();
  assert.equal(s.proveedor.enviados.length, 0);
  await s.cerrar();
});

test('el estado de la sesión se registra sin texto', async () => {
  const s = await levantar();
  assert.equal((await s.enviar(fx('session_status'))).status, 200);
  await s.cerrar();
});

test('JSON roto con firma válida da 400; un cuerpo enorme da 413', async () => {
  const s = await levantar();
  assert.equal((await s.enviar('no es json')).status, 400);
  const res = await fetch(`${s.base}/webhooks/waha`, { method: 'POST', body: 'a'.repeat(300 * 1024) });
  assert.equal(res.status, 413);
  await s.cerrar();
});

test('/health/whatsapp refleja el estado de la sesión de WAHA sin exponer secretos', async () => {
  const llamadas = [];
  const conEstado = (status) => async (url, init) => { llamadas.push({ url, key: init.headers['X-Api-Key'] }); return { ok: true, status: 200, json: async () => ({ status }) }; };
  let s = await levantar({ fetchImpl: conEstado('WORKING') });
  let r = await fetch(`${s.base}/health/whatsapp`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { provider: 'waha', session: 'demo', status: 'WORKING', ready: true });
  assert.equal(llamadas[0].url, 'http://waha:3000/api/sessions/demo');
  await s.cerrar();

  s = await levantar({ fetchImpl: conEstado('SCAN_QR_CODE') });
  r = await fetch(`${s.base}/health/whatsapp`);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).ready, false);
  await s.cerrar();

  s = await levantar({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  r = await fetch(`${s.base}/health/whatsapp`);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).status, 'UNREACHABLE');
  await s.cerrar();
});

test('/internal/avisos exige la clave interna, valida los datos y arranca E4', async () => {
  const s = await levantar();
  const post = (cuerpo, clave) => fetch(`${s.base}/internal/avisos`, { method: 'POST', headers: { 'x-internal-key': clave || '' }, body: JSON.stringify(cuerpo) });
  assert.equal((await post({ telefono: '51999999999', operacion_id: 'BR-0001' }, 'mala')).status, 401);
  assert.equal((await post({ telefono: 'abc', operacion_id: 'BR-0001' }, 'clave-interna')).status, 400);
  assert.equal((await post({ telefono: '51999999999', operacion_id: 'malo' }, 'clave-interna')).status, 400);
  const ok = await post({ telefono: '51999999999', operacion_id: 'BR-0001' }, 'clave-interna');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { iniciado: true, comprobante: { enviado: false, motivo: 'sin_operacion' } }); // BR-0001 no existe en el KV de la prueba
  assert.deepEqual(s.proveedor.textos(), ['aviso BR-0001']);
  assert.equal(s.proveedor.enviados[0].chatId, '51999999999@c.us');
  await s.cerrar();
});

test('el chat real (@lid) de un cliente se recuerda para los avisos posteriores', async () => {
  const s = await levantar();
  const e = fx('message_text');
  e.payload.from = '184512345678901@lid';
  await s.enviar(e);
  await s.inactivo();
  const r = await fetch(`${s.base}/internal/avisos`, { method: 'POST', headers: { 'x-internal-key': 'clave-interna' }, body: JSON.stringify({ telefono: '184512345678901', operacion_id: 'BR-0002' }) });
  assert.equal(r.status, 200);
  assert.equal(s.proveedor.enviados.at(-1).chatId, '184512345678901@lid');
  await s.cerrar();
});

test('un remitente @lid se identifica por su teléfono real, y se recuerda en el KV para no consultar de nuevo', async () => {
  const s = await levantar();
  try {
    s.proveedor.lids['155387672191004@lid'] = '51944686794';
    let llamadas = 0;
    const original = s.proveedor.resolverTelefono.bind(s.proveedor);
    s.proveedor.resolverTelefono = async (c) => { llamadas++; return original(c); };
    const e = fx('message_text');
    e.payload.from = '155387672191004@lid';
    await s.enviar(e);
    await s.inactivo();
    assert.deepEqual(s.proveedor.textos(), ['eco']);
    assert.equal(s.proveedor.enviados[0].chatId, '155387672191004@lid'); // se responde al chat original
    assert.equal(await s.almacen.kvEnv().get('chat:51944686794', 'json'), '155387672191004@lid');
    assert.equal(await s.almacen.kvEnv().get('lid:155387672191004', 'json'), '51944686794');
    const otro = fx('message_text');
    otro.id = 'evt_lid_2'; otro.payload.id = 'false_x_AAA9'; otro.payload.from = '155387672191004@lid';
    await s.enviar(otro);
    await s.inactivo();
    assert.equal(llamadas, 1);
  } finally {
    await s.cerrar();
  }
});

test('si el evento ya trae el teléfono real (remoteJidAlt), no se consulta la API de LIDs', async () => {
  const s = await levantar();
  try {
    let llamadas = 0;
    s.proveedor.resolverTelefono = async () => { llamadas++; return null; };
    await s.enviar(fx('respuesta_lista'));
    await s.inactivo();
    assert.equal(llamadas, 0);
    assert.equal(await s.almacen.kvEnv().get('chat:51999999999', 'json'), '184512345678901@lid');
  } finally {
    await s.cerrar();
  }
});

test('el registro nunca guarda el teléfono completo: ni en chat ni en mensaje_id', async () => {
  const s = await levantar();
  try {
    await s.enviar(fx('message_text')); // id "false_51999999999@c.us_AAA1", chat 51999999999@c.us
    await s.inactivo();
    const filas = s.db.prepare("SELECT * FROM registro WHERE tipo = 'mensaje'").all();
    assert.equal(filas.length, 1);
    assert.equal(filas[0].mensaje_id, 'AAA1');
    assert.ok(!JSON.stringify(filas).includes('51999999999'));
  } finally {
    await s.cerrar();
  }
});

const OP_COMPLETADA = { id: 'BR-0002', phone: '51999999999', estado: 'completada', creada: '2026-10-13T19:03:00.000Z', snap: { moneda_origen: 'BRL', moneda_destino: 'PEN', monto_txt: '500.00' }, proof: {} };
const avisar = (s, operacion = 'BR-0002') => fetch(`${s.base}/internal/avisos`, { method: 'POST', headers: { 'x-internal-key': 'clave-interna' }, body: JSON.stringify({ telefono: '51999999999', operacion_id: operacion }) });

test('tras el aviso de E4, con la operación completada, envía el PDF del comprobante por el chat', async () => {
  const s = await levantar();
  try {
    await s.almacen.kvEnv().put('op:BR-0002', JSON.stringify(OP_COMPLETADA));
    const r = await (await avisar(s)).json();
    assert.equal(r.iniciado, true);
    assert.equal(r.comprobante.enviado, true);
    assert.deepEqual(s.proveedor.enviados.map((e) => e.tipo), ['texto', 'documento']); // primero el aviso de E4, después el PDF
    assert.equal(s.proveedor.enviados[1].nombre, 'comprobante-BR-0002.pdf');
  } finally { await s.cerrar(); }
});

test('con COMPROBANTE_ENTREGA=ninguno no se envía el PDF ni se informa del comprobante', async () => {
  const s = await levantar({ config: { comprobanteEntrega: 'ninguno' } });
  try {
    await s.almacen.kvEnv().put('op:BR-0002', JSON.stringify(OP_COMPLETADA));
    const r = await (await avisar(s)).json();
    assert.equal(r.comprobante, undefined);
    assert.deepEqual(s.proveedor.enviados.map((e) => e.tipo), ['texto']);
  } finally { await s.cerrar(); }
});

test('si E4 no se inició (cliente ocupado) no se envía el comprobante', async () => {
  const s = await levantar();
  try {
    await s.almacen.kvEnv().put('op:BR-0002', JSON.stringify(OP_COMPLETADA));
    await s.enviar(fx('message_text')); // el flujo W0 de la prueba termina; se fuerza una espera guardada:
    s.almacen.guardarEjecucion('51999999999', { telefono: '51999999999', chatId: '51999999999@c.us', pila: [{ flujo: 'W0', nodo: 'eco' }], vars: {}, esperando: null, opciones: null, entrantes: [] });
    const r = await (await avisar(s)).json();
    assert.deepEqual(r, { iniciado: false, motivo: 'ocupado' });
    assert.ok(!s.proveedor.enviados.some((e) => e.tipo === 'documento'));
  } finally { await s.cerrar(); }
});

test('un error inesperado al armar el comprobante no rompe el aviso: se informa y se registra', async () => {
  const s = await levantar();
  try {
    await s.almacen.kvEnv().put('op:BR-0002', JSON.stringify(OP_COMPLETADA));
    s.proveedor.enviarDocumento = async () => { throw new Error('bug inesperado'); };
    const res = await avisar(s);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).comprobante, { enviado: false, motivo: 'error' });
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM registro WHERE tipo = 'error_comprobante'").get().n, 1);
  } finally { await s.cerrar(); }
});

test('con backend real el aviso interno no manda el comprobante simulado (lo manda el vigilante con el recibo real)', async () => {
  const s = await levantar({ config: { backend: 'real' } });
  try {
    const res = await fetch(`${s.base}/internal/avisos`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Key': 'clave-interna' }, body: JSON.stringify({ telefono: '51944686794', operacion_id: 'BR-0001' }) });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.comprobante, undefined);
    assert.ok(!s.proveedor.enviados.some((e) => e.tipo === 'documento'));
  } finally { await s.cerrar(); }
});

test('/health/backend informa el modo y, en real, si el backend responde', async () => {
  const sim = await levantar({ config: { backend: 'simulado' } });
  try {
    const r = await fetch(`${sim.base}/health/backend`);
    assert.deepEqual([r.status, await r.json()], [200, { backend: 'simulado', ready: true }]);
  } finally { await sim.cerrar(); }
  for (const [ok, estado] of [[true, 200], [false, 503]]) {
    const s = await levantar({ config: { backend: 'real' }, saludBackend: async () => { if (!ok) throw new Error('sin respuesta'); } });
    try {
      const r = await fetch(`${s.base}/health/backend`);
      assert.deepEqual([r.status, (await r.json()).ready], [estado, ok]);
    } finally { await s.cerrar(); }
  }
});
