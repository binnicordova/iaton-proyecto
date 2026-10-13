const test = require('node:test');
const assert = require('node:assert/strict');
const { crearCola } = require('../src/motor/cola');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('las tareas de la misma clave corren en orden y de una en una', async () => {
  const cola = crearCola();
  const log = [];
  const t = (n, ms) => () => cola.ejecutar('a', async () => { log.push(`ini${n}`); await pausa(ms); log.push(`fin${n}`); });
  await Promise.all([t(1, 30)(), t(2, 5)(), t(3, 1)()]);
  assert.deepEqual(log, ['ini1', 'fin1', 'ini2', 'fin2', 'ini3', 'fin3']);
});

test('claves distintas corren en paralelo', async () => {
  const cola = crearCola();
  const log = [];
  await Promise.all([
    cola.ejecutar('a', async () => { log.push('a1'); await pausa(20); log.push('a2'); }),
    cola.ejecutar('b', async () => { log.push('b1'); await pausa(1); log.push('b2'); }),
  ]);
  assert.deepEqual(log, ['a1', 'b1', 'b2', 'a2']);
});

test('un fallo no bloquea las tareas siguientes y llega a quien lo originó', async () => {
  const cola = crearCola();
  const falla = cola.ejecutar('a', async () => { throw new Error('boom'); });
  const sigue = cola.ejecutar('a', async () => 'ok');
  await assert.rejects(falla, /boom/);
  assert.equal(await sigue, 'ok');
});
