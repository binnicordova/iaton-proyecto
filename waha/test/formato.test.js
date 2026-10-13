const test = require('node:test');
const assert = require('node:assert/strict');
const { dinero, hora12Lima } = require('../src/backend/real/formato');

test('dinero siempre con dos decimales', () => {
  assert.equal(dinero(500), '500.00');
  assert.equal(dinero(337.25), '337.25');
  assert.equal(dinero(2.1), '2.10');
  assert.equal(dinero('12'), '12.00');
  assert.equal(dinero(undefined), '');
  assert.equal(dinero(null), '');
});

test('hora12Lima: hora de Lima (UTC-5) en 12 horas con a. m. / p. m.', () => {
  assert.equal(hora12Lima('2026-10-13T21:47:57.093Z'), '4:47 p. m.');
  assert.equal(hora12Lima('2026-10-13T17:05:00Z'), '12:05 p. m.'); // mediodía en Lima
  assert.equal(hora12Lima('2026-10-13T05:25:00Z'), '12:25 a. m.'); // medianoche en Lima
  assert.equal(hora12Lima('2026-10-13T12:00:00Z'), '7:00 a. m.');
  assert.equal(hora12Lima('2026-10-14T00:30:00Z'), '7:30 p. m.');
  assert.equal(hora12Lima('basura'), '');
  assert.equal(hora12Lima(undefined), '');
});
