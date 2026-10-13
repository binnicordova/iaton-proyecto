const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarFlujos } = require('../src/flujos');

test('carga y valida los cinco workflows con el tamaño que publicó Kapso', () => {
  const f = cargarFlujos();
  assert.deepEqual(Object.keys(f).sort(), ['E1', 'E2', 'E3', 'E4', 'W0']);
  assert.deepEqual([f.E1, f.E2, f.E3, f.E4, f.W0].map((x) => `${x.nodes.length}/${x.edges.length}`), ['60/71', '83/116', '69/79', '17/16', '13/14']);
});
