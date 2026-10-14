const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/backend/real/validadores');

test('nombre: al menos 3 caracteres y un espacio', () => {
  assert.equal(v.nombreValido('Ana Paula Souza'), true);
  assert.equal(v.nombreValido('  Ana Souza  '), true);
  assert.equal(v.nombreValido('Ana'), false);
  assert.equal(v.nombreValido('A B'), true);
  assert.equal(v.nombreValido('Ab'), false);
  assert.equal(v.nombreValido(''), false);
  assert.equal(v.nombreValido(undefined), false);
});

test('DNI: exactamente 8 dígitos (ignora espacios y puntos)', () => {
  assert.equal(v.documentoValido('DNI', '12345678'), true);
  assert.equal(v.documentoValido('DNI', '1234 5678'), true);
  assert.equal(v.documentoValido('DNI', '1234567'), false);
  assert.equal(v.documentoValido('DNI', '123456789'), false);
  assert.equal(v.documentoValido('DNI', 'abcdefgh'), false);
});

test('CE: 9 a 12 caracteres alfanuméricos, sin distinguir mayúsculas', () => {
  assert.equal(v.documentoValido('CE', '001234567'), true);
  assert.equal(v.documentoValido('CE', 'ab1234567xyz'), true);
  assert.equal(v.documentoValido('CE', '12345678'), false);
  assert.equal(v.documentoValido('CE', '1234567890123'), false);
  assert.equal(v.documentoValido('CE', '12345-6789'), false);
});

test('CPF: 11 dígitos con dígito verificador y sin todos iguales', () => {
  assert.equal(v.documentoValido('CPF', '52998224725'), true);
  assert.equal(v.documentoValido('CPF', '529.982.247-25'), true);
  assert.equal(v.documentoValido('CPF', '52998224724'), false);
  assert.equal(v.documentoValido('CPF', '11111111111'), false);
  assert.equal(v.documentoValido('CPF', '5299822472'), false);
});

test('RUC: 11 dígitos con prefijo 10, 15, 17 o 20 y dígito verificador', () => {
  assert.equal(v.documentoValido('RUC', '20100070970'), true);
  assert.equal(v.documentoValido('RUC', '10123456789'), false); // dígito verificador incorrecto
  assert.equal(v.documentoValido('RUC', '30100070970'), false); // prefijo no permitido
  assert.equal(v.documentoValido('RUC', '2010007097'), false);
});

test('normalizarDocumento: CE en mayúsculas sin espacios; el resto, solo dígitos', () => {
  assert.equal(v.normalizarDocumento('CE', ' ab1234567 '), 'AB1234567');
  assert.equal(v.normalizarDocumento('DNI', '1234 5678'), '12345678');
  assert.equal(v.normalizarDocumento('CPF', '529.982.247-25'), '52998224725');
});

test('correo, número de operación y cuenta', () => {
  assert.equal(v.correoValido('ana@example.com'), true);
  assert.equal(v.correoValido(' ana@example.com '), true);
  assert.equal(v.correoValido('ana@example'), false);
  assert.equal(v.correoValido('ana example@x.com'), false);
  assert.equal(v.operacionValida('ABC-1234'), true);
  assert.equal(v.operacionValida('123'), false);
  assert.equal(v.operacionValida('1234567890123456789012345'), false);
  assert.equal(v.operacionValida('12 34'), false);
  assert.equal(v.cuentaValida('0001-12345678-9'), true);
  assert.equal(v.cuentaValida('123'), false);
  assert.equal(v.cuentaValida('  1234  '), true);
});

test('enmascarar correo y cuenta para mostrarlos al cliente', () => {
  assert.equal(v.enmascararCorreo('ana.souza@example.com'), 'a***@example.com');
  assert.equal(v.enmascararCorreo('x@y.com'), 'x***@y.com');
  assert.equal(v.enmascararCorreo('sin-arroba'), '***');
  assert.equal(v.ultimos4('191-1234567890'), '7890');
  assert.equal(v.ultimos4('123'), '123');
  assert.equal(v.ultimos4('0001-12345678-9'), '6789');
});

test('limpiarTexto recorta, colapsa espacios y quita caracteres de control', () => {
  assert.equal(v.limpiarTexto('  Banco   do\u0000 Brasil \n', 60), 'Banco do Brasil');
  assert.equal(v.limpiarTexto('x'.repeat(100), 10), 'xxxxxxxxxx');
  assert.equal(v.limpiarTexto(undefined, 10), '');
});
