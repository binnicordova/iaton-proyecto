const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMenu, interpretarRespuesta } = require('../src/provider/menu-texto');

const OPC = [{ id: 'si_esa', title: 'Sí, esa' }, { id: 'otra_cuenta', title: 'Otra cuenta' }];

test('renderMenu numera las opciones', () => {
  assert.equal(renderMenu('¿Recibes ahí?', OPC), '¿Recibes ahí?\n\n1. Sí, esa\n2. Otra cuenta\n\nResponde con el número o el nombre de la opción.');
});

test('interpretarRespuesta acepta número o título sin importar mayúsculas, tildes ni puntuación', () => {
  assert.equal(interpretarRespuesta('1', OPC), 'si_esa');
  assert.equal(interpretarRespuesta(' 2 ', OPC), 'otra_cuenta');
  assert.equal(interpretarRespuesta('si esa', OPC), 'si_esa');
  assert.equal(interpretarRespuesta('SÍ, ESA!', OPC), 'si_esa');
  assert.equal(interpretarRespuesta('otra CUENTA', OPC), 'otra_cuenta');
});

test('interpretarRespuesta devuelve null si no calza', () => {
  assert.equal(interpretarRespuesta('3', OPC), null);
  assert.equal(interpretarRespuesta('0', OPC), null);
  assert.equal(interpretarRespuesta('quizás', OPC), null);
  assert.equal(interpretarRespuesta('', OPC), null);
  assert.equal(interpretarRespuesta('1', null), null);
});
