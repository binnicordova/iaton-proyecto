const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearSesiones } = require('../src/backend/real/sesion');
const { configBackend } = require('../src/backend/real/config');
const { ErrorBackend } = require('../src/backend/real/errores');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

async function mundo(opciones) {
  const falso = await crearFirebaseFalso(opciones);
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const sesiones = crearSesiones({ almacen, config: falso.config });
  return { falso, almacen, sesiones, cerrar: () => falso.cerrar() };
}
const altas = (falso) => falso.usuarios.size;

test('configBackend: exige la clave web y trae los valores por defecto del proyecto', () => {
  assert.throws(() => configBackend({}), /FIREBASE_API_KEY/);
  const c = configBackend({ FIREBASE_API_KEY: 'k' });
  assert.equal(c.apiKey, 'k');
  assert.equal(c.projectId, 'aibrasper');
  assert.equal(c.bucket, 'aibrasper.firebasestorage.app');
  assert.equal(c.functionsUrl, 'https://{nombre}-h5wenirx2q-rj.a.run.app');
  assert.equal(c.firestoreUrl, 'https://firestore.googleapis.com/v1/projects/aibrasper/databases/(default)/documents');
  assert.equal(c.storageUrl, 'https://firebasestorage.googleapis.com');
  const otro = configBackend({ FIREBASE_API_KEY: 'k', FIREBASE_PROJECT_ID: 'otro', FIREBASE_FUNCTIONS_URL: 'http://f/{nombre}' });
  assert.equal(otro.projectId, 'otro');
  assert.equal(otro.functionsUrl, 'http://f/{nombre}');
  assert.match(otro.firestoreUrl, /projects\/otro\//);
});

test('la primera vez crea un usuario anónimo y lo guarda; la segunda reutiliza la sesión', async () => {
  const m = await mundo();
  try {
    const a = await m.sesiones.obtener('519');
    const b = await m.sesiones.obtener('519');
    assert.equal(altas(m.falso), 1);
    assert.equal(a.uid, b.uid);
    assert.equal(a.idToken, b.idToken);
    assert.equal(m.almacen.sesionFirebase('519').uid, a.uid);
    assert.notEqual((await m.sesiones.obtener('518')).uid, a.uid); // otro teléfono, otro usuario
  } finally { await m.cerrar(); }
});

test('renueva el token cuando le quedan menos de 5 minutos y conserva el mismo usuario', async () => {
  const m = await mundo({ tokenSegundos: 200 });
  try {
    const a = await m.sesiones.obtener('519');
    const b = await m.sesiones.obtener('519');
    assert.equal(a.uid, b.uid);
    assert.notEqual(a.idToken, b.idToken);
    assert.equal(altas(m.falso), 1);
  } finally { await m.cerrar(); }
});

test('forzar renueva aunque el token siga vigente', async () => {
  const m = await mundo();
  try {
    const a = await m.sesiones.obtener('519');
    const b = await m.sesiones.obtener('519', { forzar: true });
    assert.notEqual(a.idToken, b.idToken);
    assert.equal(a.uid, b.uid);
  } finally { await m.cerrar(); }
});

test('si el usuario ya no existe, crea otro (el cliente pierde su perfil anterior)', async () => {
  const m = await mundo({ tokenSegundos: 200 });
  try {
    const a = await m.sesiones.obtener('519');
    m.falso.borrarUsuario(a.uid);
    const b = await m.sesiones.obtener('519');
    assert.notEqual(a.uid, b.uid);
    assert.equal(m.almacen.sesionFirebase('519').uid, b.uid);
  } finally { await m.cerrar(); }
});

test('un fallo de transporte al renovar NO crea otro usuario: se propaga', async () => {
  const m = await mundo({ tokenSegundos: 200 });
  try {
    const a = await m.sesiones.obtener('519');
    m.falso.fallar('/securetoken', { estado: 502, veces: 5 });
    await assert.rejects(() => m.sesiones.obtener('519'), (e) => e instanceof ErrorBackend && e.transporte === true);
    assert.equal(altas(m.falso), 1);
    assert.equal(m.almacen.sesionFirebase('519').uid, a.uid);
  } finally { await m.cerrar(); }
});

test('llamadas simultáneas del mismo teléfono comparten una sola alta', async () => {
  const m = await mundo();
  try {
    const rs = await Promise.all([m.sesiones.obtener('519'), m.sesiones.obtener('519'), m.sesiones.obtener('519')]);
    assert.equal(altas(m.falso), 1);
    assert.equal(new Set(rs.map((r) => r.uid)).size, 1);
  } finally { await m.cerrar(); }
});

test('usar reintenta una vez con un token nuevo si el backend responde 401', async () => {
  const m = await mundo();
  try {
    await m.sesiones.obtener('519');
    m.falso.expirarTokens();
    const vistos = [];
    const r = await m.sesiones.usar('519', async (s) => {
      vistos.push(s.idToken);
      if (vistos.length === 1) throw new ErrorBackend('401', { estado: 401, codigo: 'sign-in-required' });
      return 'ok';
    });
    assert.equal(r, 'ok');
    assert.equal(vistos.length, 2);
    assert.notEqual(vistos[0], vistos[1]);
    await assert.rejects(() => m.sesiones.usar('519', async () => { throw new ErrorBackend('401', { estado: 401 }); }), /401/); // solo un reintento
    await assert.rejects(() => m.sesiones.usar('519', async () => { throw new ErrorBackend('x', { estado: 400, codigo: 'invalid-input' }); }), (e) => e.codigo === 'invalid-input');
  } finally { await m.cerrar(); }
});

test('olvidar borra la sesión y el siguiente uso crea un usuario nuevo', async () => {
  const m = await mundo();
  try {
    const a = await m.sesiones.obtener('519');
    m.sesiones.olvidar('519');
    const b = await m.sesiones.obtener('519');
    assert.notEqual(a.uid, b.uid);
  } finally { await m.cerrar(); }
});
