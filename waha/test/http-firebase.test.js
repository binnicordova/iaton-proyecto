const test = require('node:test');
const assert = require('node:assert/strict');
const { pedir } = require('../src/backend/real/http');
const { ErrorBackend } = require('../src/backend/real/errores');

const URL_SECRETA = 'https://identitytoolkit.example/v1/accounts:signUp?key=CLAVE_QUE_NO_DEBE_FILTRARSE';
const respuesta = (estado, json) => ({ ok: estado >= 200 && estado < 300, status: estado, text: async () => (json === undefined ? '' : typeof json === 'string' ? json : JSON.stringify(json)) });
const sinEspera = async () => {};
const conRespuestas = (...rs) => {
  const llamadas = [];
  const fetchImpl = async (url, init) => { llamadas.push({ url, init }); const r = rs.shift(); if (r instanceof Error) throw r; return r; };
  return { fetchImpl, llamadas };
};
const falla = async (fn) => { try { await fn(); } catch (e) { return e; } assert.fail('debía lanzar'); };

test('una respuesta correcta devuelve estado y JSON', async () => {
  const { fetchImpl, llamadas } = conRespuestas(respuesta(200, { result: { ok: true } }));
  const r = await pedir({ url: URL_SECRETA, cuerpo: { data: {} }, encabezados: { authorization: 'Bearer x' }, fetchImpl });
  assert.deepEqual(r, { estado: 200, json: { result: { ok: true } } });
  assert.equal(llamadas[0].init.method, 'POST');
  assert.equal(llamadas[0].init.headers['content-type'], 'application/json');
  assert.equal(llamadas[0].init.headers.authorization, 'Bearer x');
  assert.equal(llamadas[0].init.body, '{"data":{}}');
});

test('los tres tipos de cuerpo: json, form y binario', async () => {
  const { fetchImpl, llamadas } = conRespuestas(respuesta(200, {}), respuesta(200, {}));
  await pedir({ url: 'http://x', tipoCuerpo: 'form', cuerpo: { grant_type: 'refresh_token', refresh_token: 'a b' }, fetchImpl });
  assert.equal(llamadas[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(llamadas[0].init.body, 'grant_type=refresh_token&refresh_token=a+b');
  const bytes = Buffer.from([1, 2, 3]);
  await pedir({ url: 'http://x', tipoCuerpo: 'binario', tipoContenido: 'image/jpeg', cuerpo: bytes, fetchImpl });
  assert.equal(llamadas[1].init.headers['content-type'], 'image/jpeg');
  assert.equal(llamadas[1].init.body, bytes);
});

test('error de una función: el código estable queda en codigo y no es de transporte', async () => {
  const { fetchImpl } = conRespuestas(respuesta(400, { error: { status: 'INVALID_ARGUMENT', message: 'invalid-input', details: [{ path: 'docNumber', message: 'x' }] } }));
  const e = await falla(() => pedir({ url: URL_SECRETA, fetchImpl }));
  assert.ok(e instanceof ErrorBackend);
  assert.equal(e.name, 'ErrorBackend');
  assert.equal(e.codigo, 'invalid-input');
  assert.equal(e.estado, 400);
  assert.deepEqual(e.detalles, [{ path: 'docNumber', message: 'x' }]);
  assert.equal(e.transporte, false);
});

test('error de Identity Toolkit (MAYÚSCULAS) y de Firestore (usa el status)', async () => {
  const { fetchImpl } = conRespuestas(
    respuesta(400, { error: { code: 400, message: 'TOKEN_EXPIRED' } }),
    respuesta(404, { error: { code: 404, message: 'Document "projects/p/x" not found.', status: 'NOT_FOUND' } }),
  );
  assert.equal((await falla(() => pedir({ url: 'http://x', fetchImpl }))).codigo, 'TOKEN_EXPIRED');
  const e = await falla(() => pedir({ url: 'http://x', fetchImpl }));
  assert.equal(e.codigo, 'NOT_FOUND');
  assert.equal(e.estado, 404);
});

test('un 503 con código estable (rates-unavailable) es un error de negocio; sin código es de transporte', async () => {
  const { fetchImpl } = conRespuestas(respuesta(503, { error: { status: 'UNAVAILABLE', message: 'rates-unavailable' } }), respuesta(502, '<html>Bad Gateway</html>'));
  const a = await falla(() => pedir({ url: 'http://x', fetchImpl }));
  assert.equal(a.codigo, 'rates-unavailable');
  assert.equal(a.transporte, false);
  const b = await falla(() => pedir({ url: 'http://x', fetchImpl }));
  assert.equal(b.transporte, true);
});

test('red caída y timeout son errores de transporte y el mensaje nunca incluye la URL ni la clave', async () => {
  const { fetchImpl } = conRespuestas(new Error(`fetch failed ${URL_SECRETA}`));
  const e = await falla(() => pedir({ url: URL_SECRETA, fetchImpl }));
  assert.equal(e.transporte, true);
  assert.ok(!e.message.includes('CLAVE_QUE_NO_DEBE_FILTRARSE') && !e.message.includes('identitytoolkit'));
  const lenta = (url, init) => new Promise((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(new Error(`abortado ${url}`))));
  const t = await falla(() => pedir({ url: URL_SECRETA, fetchImpl: lenta, timeoutMs: 20 }));
  assert.equal(t.transporte, true);
  assert.equal(t.codigo, 'timeout');
  assert.ok(!t.message.includes('CLAVE_QUE_NO_DEBE_FILTRARSE'));
});

test('reintenta solo los errores de transporte, con espera creciente', async () => {
  const esperas = [];
  const { fetchImpl, llamadas } = conRespuestas(respuesta(502, ''), new Error('red'), respuesta(200, { ok: 1 }));
  const r = await pedir({ url: 'http://x', fetchImpl, reintentos: 2, dormir: async (ms) => esperas.push(ms) });
  assert.equal(r.estado, 200);
  assert.equal(llamadas.length, 3);
  assert.deepEqual(esperas, [300, 600]);
  const negocio = conRespuestas(respuesta(400, { error: { message: 'invalid-input' } }), respuesta(200, {}));
  await falla(() => pedir({ url: 'http://x', fetchImpl: negocio.fetchImpl, reintentos: 2, dormir: sinEspera }));
  assert.equal(negocio.llamadas.length, 1);
});

test('agota los reintentos y lanza el último error de transporte', async () => {
  const { fetchImpl, llamadas } = conRespuestas(respuesta(500, ''), respuesta(500, ''));
  const e = await falla(() => pedir({ url: 'http://x', fetchImpl, reintentos: 1, dormir: sinEspera }));
  assert.equal(e.transporte, true);
  assert.equal(llamadas.length, 2);
});

test('un 5xx o 429 con cuerpo JSON (UNAVAILABLE, INTERNAL, RESOURCE_EXHAUSTED) es de transporte y se reintenta', async () => {
  for (const [estado, status] of [[503, 'UNAVAILABLE'], [500, 'INTERNAL'], [429, 'RESOURCE_EXHAUSTED']]) {
    const { fetchImpl, llamadas } = conRespuestas(respuesta(estado, { error: { status, message: status } }), respuesta(200, { result: 1 }));
    const r = await pedir({ url: 'http://x', cuerpo: {}, fetchImpl, reintentos: 1, dormir: sinEspera });
    assert.equal(r.json.result, 1, `${estado} se reintenta`);
    assert.equal(llamadas.length, 2);
    const e = await falla(() => pedir({ url: 'http://x', fetchImpl: conRespuestas(respuesta(estado, { error: { status, message: status } })).fetchImpl }));
    assert.equal(e.transporte, true, `${estado} ${status} es de transporte`);
  }
});
