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
