const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { ensamblar } = require('../src/ensamblar');
const { ProveedorFalso } = require('./helpers/proveedor-falso');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

const CONFIG = { comprobanteEntrega: 'whatsapp', hmacSecret: 's', internalKey: 'k', wahaBaseUrl: 'http://waha:3000', wahaApiKey: 'K', wahaSession: 'demo', iaTimeoutMs: 100 };

async function conServidor(config, entorno, fn) {
  const { servidor, vigilante } = ensamblar({
    config: { ...CONFIG, ...config }, entorno, almacen: crearAlmacen(abrirDb(':memory:')), proveedor: new ProveedorFalso(), extraer: async () => ({}), dormir: async () => {},
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  servidor.unref();
  try { await fn(`http://127.0.0.1:${servidor.address().port}`, vigilante); } finally { await new Promise((r) => servidor.close(r)); }
}

test('en modo simulado no hay vigilante y /health/backend responde simulado', async () => {
  await conServidor({ backend: 'simulado' }, {}, async (base, vigilante) => {
    assert.equal(vigilante, null);
    assert.deepEqual(await (await fetch(`${base}/health/backend`)).json(), { backend: 'simulado', ready: true });
  });
});

test('en modo real hay vigilante y /health/backend llama a getRates con una sesión propia', async () => {
  const falso = await crearFirebaseFalso();
  try {
    const entorno = { FIREBASE_API_KEY: falso.apiKey, FIREBASE_IDENTITY_URL: falso.config.identityUrl, FIREBASE_TOKEN_URL: falso.config.tokenUrl, FIREBASE_FUNCTIONS_URL: falso.config.functionsUrl, FIREBASE_FIRESTORE_URL: falso.config.firestoreUrl, FIREBASE_STORAGE_URL: falso.config.storageUrl };
    await conServidor({ backend: 'real' }, entorno, async (base, vigilante) => {
      assert.ok(vigilante && typeof vigilante.tick === 'function');
      assert.deepEqual(await (await fetch(`${base}/health/backend`)).json(), { backend: 'real', ready: true });
      falso.fallar('/fn/getrates', { estado: 500, veces: 5 });
      const r = await fetch(`${base}/health/backend`);
      assert.deepEqual([r.status, (await r.json()).ready], [503, false]);
    });
  } finally { await falso.cerrar(); }
});

test('en modo real sin FIREBASE_API_KEY falla al ensamblar y lo dice sin imprimir valores', () => {
  assert.throws(() => ensamblar({ config: { ...CONFIG, backend: 'real' }, entorno: {}, almacen: crearAlmacen(abrirDb(':memory:')), proveedor: new ProveedorFalso(), extraer: async () => ({}) }), /FIREBASE_API_KEY/);
});
