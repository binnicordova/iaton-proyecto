const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearLlamadorFuncion } = require('../src/puente-api');
const { resetDemo, seedDemo } = require('../src/demo');

const T = '51944686794';

function mundo() {
  const almacen = crearAlmacen(abrirDb(':memory:'));
  return { almacen, kv: almacen.kvEnv(), llamarFuncion: crearLlamadorFuncion({ kvEnv: almacen.kvEnv() }) };
}

test('seedDemo siembra una cuenta, o dos con cuentas:2', async () => {
  const m = mundo();
  await seedDemo({ llamarFuncion: m.llamarFuncion, telefono: T });
  assert.deepEqual((await m.kv.get(`client:${T}`, 'json')).cuentas.map((c) => c.ultimos4), ['9956']);
  await seedDemo({ llamarFuncion: m.llamarFuncion, telefono: T, cuentas: 2 });
  assert.deepEqual((await m.kv.get(`client:${T}`, 'json')).cuentas.map((c) => c.ultimos4), ['9956', '1111']);
});

test('resetDemo limpia la conversación, la operación activa, el visto y el handoff', async () => {
  const m = mundo();
  m.almacen.guardarEjecucion(T, { pila: [], vars: {} });
  for (const k of ['active', 'seen', 'handoff']) await m.kv.put(`${k}:${T}`, JSON.stringify('x'));
  await resetDemo({ almacen: m.almacen, llamarFuncion: m.llamarFuncion, telefono: T });
  assert.equal(m.almacen.cargarEjecucion(T), null);
  for (const k of ['active', 'seen', 'handoff']) assert.equal(await m.kv.get(`${k}:${T}`, 'json'), null);
});
