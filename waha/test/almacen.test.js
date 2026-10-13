const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');

const nuevo = () => crearAlmacen(abrirDb(':memory:'));

test('guarda, carga y borra la ejecución de un teléfono', () => {
  const a = nuevo();
  assert.equal(a.cargarEjecucion('519'), null);
  a.guardarEjecucion('519', { pila: [{ flujo: 'W0', nodo: 'start' }], vars: { x: 1 } });
  assert.deepEqual(a.cargarEjecucion('519').vars, { x: 1 });
  a.guardarEjecucion('519', { pila: [], vars: { x: 2 } });
  assert.equal(a.cargarEjecucion('519').vars.x, 2);
  a.borrarEjecucion('519');
  assert.equal(a.cargarEjecucion('519'), null);
});

test('marcarVisto distingue lo nuevo de lo repetido', () => {
  const a = nuevo();
  assert.equal(a.marcarVisto('evt-1'), true);
  assert.equal(a.marcarVisto('evt-1'), false);
  assert.equal(a.marcarVisto('evt-2'), true);
});

test('limpiarVistos borra solo los anteriores a la fecha', () => {
  const db = abrirDb(':memory:');
  const a = crearAlmacen(db);
  db.prepare('INSERT INTO eventos_vistos (id, visto) VALUES (?, ?)').run('viejo', '2026-01-01T00:00:00.000Z');
  a.marcarVisto('reciente');
  a.limpiarVistos('2026-06-01T00:00:00.000Z');
  assert.equal(a.marcarVisto('viejo'), true);
  assert.equal(a.marcarVisto('reciente'), false);
});

test('kvEnv se comporta como el KV de Cloudflare que usa brasper-api', async () => {
  const kv = nuevo().kvEnv();
  assert.equal(await kv.get('a', 'json'), null);
  await kv.put('a', JSON.stringify({ n: 1 }));
  assert.deepEqual(await kv.get('a', 'json'), { n: 1 });
  assert.equal(await kv.get('a'), '{"n":1}');
  await kv.put('a', JSON.stringify(7));
  assert.equal(await kv.get('a', 'json'), 7);
  await kv.delete('a');
  assert.equal(await kv.get('a', 'json'), null);
});

test('registrar guarda metadatos y nunca texto de mensajes', () => {
  const db = abrirDb(':memory:');
  crearAlmacen(db).registrar({ tipo: 'envio', mensajeId: 'm1', chat: '***6794', estado: 'ok', latenciaMs: 120 });
  const fila = db.prepare('SELECT * FROM registro').get();
  assert.equal(fila.tipo, 'envio');
  assert.equal(fila.chat, '***6794');
  assert.ok(!('texto' in fila));
});

test('registrar guarda la ruta de WAHA en detalle para distinguir mensajes de sendSeen', () => {
  const db = abrirDb(':memory:');
  const a = crearAlmacen(db);
  a.registrar({ tipo: 'envio', ruta: '/api/sendText', estado: '201' });
  a.registrar({ tipo: 'envio', ruta: '/api/sendSeen', estado: '201' });
  assert.deepEqual(db.prepare('SELECT detalle FROM registro ORDER BY id').all().map((f) => f.detalle), ['/api/sendText', '/api/sendSeen']);
});

test('sesiones de Firebase por teléfono: guardar, actualizar y olvidar', () => {
  const a = nuevo();
  assert.equal(a.sesionFirebase('519'), null);
  a.guardarSesionFirebase({ telefono: '519', uid: 'u1', refresh: 'r1', idToken: 't1', vence: 1000 });
  assert.deepEqual(a.sesionFirebase('519'), { telefono: '519', uid: 'u1', refresh: 'r1', idToken: 't1', vence: 1000 });
  a.guardarSesionFirebase({ telefono: '519', uid: 'u1', refresh: 'r2', idToken: 't2', vence: 2000 });
  assert.equal(a.sesionFirebase('519').idToken, 't2');
  a.borrarSesionFirebase('519');
  assert.equal(a.sesionFirebase('519'), null);
});

test('órdenes por teléfono: la más reciente primero', () => {
  const a = nuevo();
  a.agregarOrden({ ordenId: 'BR-0001', telefono: '519', chatId: '519@c.us', creada: '2026-10-13T10:00:00.000Z' });
  a.agregarOrden({ ordenId: 'BR-0002', telefono: '519', chatId: '519@c.us', creada: '2026-10-13T11:00:00.000Z' });
  a.agregarOrden({ ordenId: 'BR-0003', telefono: '518', chatId: '518@c.us', creada: '2026-10-13T12:00:00.000Z' });
  assert.deepEqual(a.ordenesDe('519').map((o) => o.ordenId), ['BR-0002', 'BR-0001']);
  assert.deepEqual(a.ordenesDe('000'), []);
});

test('seguimientos: abrir, actualizar, listar los abiertos y cerrar', () => {
  const a = nuevo();
  a.abrirSeguimiento({ ordenId: 'BR-0001', telefono: '519', chatId: '519@c.us', creado: '2026-10-13T10:00:00.000Z' });
  a.abrirSeguimiento({ ordenId: 'BR-0002', telefono: '518', chatId: '518@c.us', creado: '2026-10-13T10:05:00.000Z' });
  a.abrirSeguimiento({ ordenId: 'BR-0001', telefono: '519', chatId: '519@c.us', creado: '2026-10-13T10:00:00.000Z' }); // repetir no duplica
  assert.deepEqual(a.seguimientosAbiertos().map((s) => s.ordenId), ['BR-0001', 'BR-0002']);
  a.actualizarSeguimiento('BR-0001', { estadoAvisado: 'approved', reciboEnviado: 1 });
  const s = a.seguimientosAbiertos().find((x) => x.ordenId === 'BR-0001');
  assert.equal(s.estadoAvisado, 'approved');
  assert.equal(s.reciboEnviado, 1);
  a.actualizarSeguimiento('BR-0002', { cerrado: 1 });
  assert.deepEqual(a.seguimientosAbiertos().map((x) => x.ordenId), ['BR-0001']);
});

test('seguimiento(ordenId) devuelve la fila, esté abierta o cerrada, o null', () => {
  const a = nuevo();
  assert.equal(a.seguimiento('BR-0001'), null);
  a.abrirSeguimiento({ ordenId: 'BR-0001', telefono: '519', chatId: '519@c.us', creado: '2026-10-13T10:00:00.000Z' });
  assert.equal(a.seguimiento('BR-0001').cerrado, 0);
  a.actualizarSeguimiento('BR-0001', { cerrado: 1 });
  assert.equal(a.seguimiento('BR-0001').cerrado, 1);
  assert.equal(a.seguimiento('BR-0001').telefono, '519');
});
