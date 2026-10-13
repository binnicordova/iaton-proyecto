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
const CONFIG = { hmacSecret: SECRETO, internalKey: 'clave-interna', wahaBaseUrl: 'http://waha:3000', wahaApiKey: 'K', wahaSession: 'demo' };
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'waha', `${n}.json`), 'utf8'));

function flujos() {
  const w0 = new Flow('W0', 'W0', 'w0'); w0.start().text('eco', 'eco'); w0.link('start', 'eco');
  const e4 = new Flow('E4', 'E4', 'e4'); e4.start().text('av', 'aviso {{vars.operacion_id}}'); e4.link('start', 'av');
  return { W0: w0, E4: e4 };
}

async function levantar({ fetchImpl } = {}) {
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const proveedor = new ProveedorFalso();
  const motor = crearMotor({ flujos: flujos(), almacen, proveedor, llamarFuncion: async () => ({ vars: {} }), extraer: async () => ({}) });
  const { servidor, inactivo } = crearServidor({ config: CONFIG, motor, almacen, proveedor, fetchImpl });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const enviar = async (evento, { secreto = SECRETO, firma } = {}) => {
    const cuerpo = typeof evento === 'string' ? evento : JSON.stringify(evento);
    const res = await fetch(`${base}/webhooks/waha`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Hmac': firma || firmar(cuerpo, secreto) }, body: cuerpo });
    return { status: res.status, json: await res.json() };
  };
  return { almacen, proveedor, inactivo, base, enviar, cerrar: () => new Promise((r) => servidor.close(r)) };
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
  assert.deepEqual(await ok.json(), { iniciado: true });
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
