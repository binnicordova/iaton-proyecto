const test = require('node:test');
const assert = require('node:assert/strict');
const { renderizar } = require('../src/motor/plantillas');

test('sustituye variables, con o sin espacios', () => {
  assert.equal(renderizar('Hoy 1 {{vars.moneda_origen}} = {{ vars.tasa_txt }} {{vars.moneda_destino}}', { moneda_origen: 'BRL', tasa_txt: '0.7', moneda_destino: 'PEN' }), 'Hoy 1 BRL = 0.7 PEN');
});

test('una variable ausente o nula da cadena vacía; los números se convierten', () => {
  assert.equal(renderizar('A{{vars.x}}B{{vars.y}}C{{vars.z}}', { y: null, z: 0 }), 'AB' + 'C0');
});

test('no toca llaves que no son plantillas ni ejecuta nada', () => {
  assert.equal(renderizar('{{ 1+1 }} {vars.x} {{vars.a.b}}', { x: 'no' }), '{{ 1+1 }} {vars.x} {{vars.a.b}}');
});
