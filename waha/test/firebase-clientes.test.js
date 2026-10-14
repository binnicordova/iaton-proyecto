const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearSesiones } = require('../src/backend/real/sesion');
const { crearFunciones } = require('../src/backend/real/funciones');
const { crearFirestore, decodificar } = require('../src/backend/real/firestore');
const { crearStorage, extensionDe } = require('../src/backend/real/storage');
const { ErrorBackend } = require('../src/backend/real/errores');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

async function mundo(opciones) {
  const falso = await crearFirebaseFalso(opciones);
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const sesiones = crearSesiones({ almacen, config: falso.config });
  return {
    falso, almacen, sesiones,
    funciones: crearFunciones({ sesiones, config: falso.config }),
    firestore: crearFirestore({ sesiones, config: falso.config }),
    storage: crearStorage({ sesiones, config: falso.config }),
    cerrar: () => falso.cerrar(),
  };
}
const T = '51944686794';
const DATOS = { language: 'es', clientName: 'Ana Paula Souza', docType: 'CPF', docNumber: '52998224725', email: 'ana@example.com', fundsSource: 'savings', sourceBank: 'Nubank', sourceAccount: '0001-12345678-9', destinationBank: 'BCP', destinationAccount: '191-1234567890' };
const cotizar = (m, tel = T) => m.funciones.llamar(tel, 'createQuote', { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500, channel: 'whatsapp' });

test('decodificar convierte los valores tipados de Firestore en valores normales', () => {
  const d = decodificar({ fields: {
    texto: { stringValue: 'a' }, entero: { integerValue: '12' }, decimal: { doubleValue: 0.6745 }, si: { booleanValue: true }, nada: { nullValue: null },
    lista: { arrayValue: { values: [{ stringValue: 'x' }, { integerValue: '2' }] } }, vacia: { arrayValue: {} },
    mapa: { mapValue: { fields: { banco: { stringValue: 'BCP' }, n: { integerValue: '4' } } } }, tiempo: { timestampValue: '2026-10-13T10:00:00Z' },
  } });
  assert.deepEqual(d, { texto: 'a', entero: 12, decimal: 0.6745, si: true, nada: null, lista: ['x', 2], vacia: [], mapa: { banco: 'BCP', n: 4 }, tiempo: '2026-10-13T10:00:00Z' });
});

test('funciones: llama con el token del cliente y devuelve el resultado', async () => {
  const m = await mundo();
  try {
    const q = await cotizar(m);
    assert.equal(q.total, 514.16);
    assert.equal(q.channel, 'whatsapp');
    const [llamada] = m.falso.llamadas;
    assert.equal(llamada.nombre, 'createQuote');
    assert.equal(llamada.uid, m.almacen.sesionFirebase(T).uid);
  } finally { await m.cerrar(); }
});

test('funciones: un error de negocio llega con su código y detalles', async () => {
  const m = await mundo();
  try {
    const q = await cotizar(m);
    await assert.rejects(() => m.funciones.llamar(T, 'createOrder', { quoteId: q.id, ...DATOS, docNumber: '52998224724' }), (e) => {
      assert.ok(e instanceof ErrorBackend);
      assert.equal(e.codigo, 'invalid-input');
      assert.deepEqual(e.detalles.map((d) => d.path), ['docNumber']);
      assert.equal(e.transporte, false);
      return true;
    });
  } finally { await m.cerrar(); }
});

test('funciones: con el token vencido renueva solo y la llamada sale bien', async () => {
  const m = await mundo();
  try {
    await cotizar(m);
    m.falso.expirarTokens();
    const r = await m.funciones.llamar(T, 'getRates', {});
    assert.equal(r.pricing.quoteTtlMinutes, 15);
  } finally { await m.cerrar(); }
});

test('funciones: reintenta los fallos de transporte solo si se pide', async () => {
  const m = await mundo();
  try {
    await m.sesiones.obtener(T);
    m.falso.fallar('/fn/getrates', { estado: 502, veces: 1 });
    await assert.rejects(() => m.funciones.llamar(T, 'getRates', {}), (e) => e.transporte === true);
    m.falso.fallar('/fn/getrates', { estado: 502, veces: 1 });
    assert.ok((await m.funciones.llamar(T, 'getRates', {}, { reintentos: 1, dormir: async () => {} })).market);
  } finally { await m.cerrar(); }
});

test('firestore: lee la orden propia como objeto normal; la ajena da PERMISSION_DENIED; lo que no existe da null', async () => {
  const m = await mundo();
  try {
    const q = await cotizar(m);
    const o = await m.funciones.llamar(T, 'createOrder', { quoteId: q.id, ...DATOS });
    const leida = await m.firestore.leer(T, `orders/${o.orderId}`);
    assert.equal(leida.status, 'pending');
    assert.equal(leida.total, 514.16);
    assert.equal(leida.paymentAccount.bank, 'Nubank');
    assert.equal(leida.operationNo, null);
    await assert.rejects(() => m.firestore.leer('51900000000', `orders/${o.orderId}`), (e) => e.codigo === 'PERMISSION_DENIED' && e.estado === 403);
    assert.equal(await m.firestore.leer(T, 'orders/BR-9999').catch((e) => e.codigo), 'PERMISSION_DENIED'); // inexistente de otro: la regla compara dueño
    const uid = m.almacen.sesionFirebase(T).uid;
    const perfil = await m.firestore.leer(T, `clients/${uid}`);
    assert.equal(perfil.accounts.length, 2);
    assert.equal(perfil.accounts[0].bank, 'Nubank');
    assert.equal(await m.firestore.leer('51911111111', 'clients/uidinexistente').catch((e) => e.codigo), 'PERMISSION_DENIED');
    assert.equal(await m.firestore.leer(T, 'clients/' + 'x'.repeat(5)).catch((e) => e.codigo), 'PERMISSION_DENIED');
  } finally { await m.cerrar(); }
});

test('firestore: el propio perfil inexistente devuelve null (404)', async () => {
  const m = await mundo();
  try {
    await m.sesiones.obtener(T);
    const uid = m.almacen.sesionFirebase(T).uid;
    assert.equal(await m.firestore.leer(T, `clients/${uid}`), null);
  } finally { await m.cerrar(); }
});

test('firestore: busca las propias órdenes por cotización (para reconciliar un createOrder dudoso)', async () => {
  const m = await mundo();
  try {
    const q = await cotizar(m);
    assert.deepEqual(await m.firestore.ordenesPorCotizacion(T, q.id), []);
    const o = await m.funciones.llamar(T, 'createOrder', { quoteId: q.id, ...DATOS });
    const halladas = await m.firestore.ordenesPorCotizacion(T, q.id);
    assert.equal(halladas.length, 1);
    assert.equal(halladas[0].orderId, o.orderId);
    assert.deepEqual(await m.firestore.ordenesPorCotizacion('51922222222', q.id), []); // otro cliente no ve la orden
  } finally { await m.cerrar(); }
});

test('storage: sube a proofs/<uid>/<orden>/ y lo devuelve; rechaza tipos y lugares no permitidos', async () => {
  const m = await mundo();
  try {
    const { uid } = await m.sesiones.obtener(T);
    const ruta = await m.storage.subir(T, { ordenId: 'BR-0001', nombre: 'proof-1.jpg', mimetype: 'image/jpeg', bytes: Buffer.from('foto') });
    assert.equal(ruta, `proofs/${uid}/BR-0001/proof-1.jpg`);
    assert.equal(m.falso.archivos.get(ruta).bytes.toString(), 'foto');
    await assert.rejects(() => m.storage.subir(T, { ordenId: 'BR-0001', nombre: 'v.mp4', mimetype: 'video/mp4', bytes: Buffer.from('v') }), (e) => e.codigo === 'PERMISSION_DENIED');
    await assert.rejects(() => m.storage.subir(T, { ordenId: 'BR-0001', nombre: 'proof-1.jpg', mimetype: 'image/jpeg', bytes: Buffer.from('otra') }), (e) => e.estado === 403); // no se sobrescribe
  } finally { await m.cerrar(); }
});

test('storage: extensión según el tipo del archivo', () => {
  assert.equal(extensionDe('image/jpeg'), 'jpg');
  assert.equal(extensionDe('image/png'), 'png');
  assert.equal(extensionDe('image/webp'), 'webp');
  assert.equal(extensionDe('application/pdf'), 'pdf');
  assert.equal(extensionDe('video/mp4'), 'bin');
  assert.equal(extensionDe(undefined), 'bin');
});
