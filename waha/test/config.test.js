const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarConfig } = require('../src/config');
const { enmascarar, soloDigitos } = require('../src/util');

const BASE = { WAHA_API_KEY: 'k', WAHA_WEBHOOK_HMAC_SECRET: 'h', INTERNAL_API_KEY: 'i' };

test('cargarConfig aplica valores por defecto seguros', () => {
  const c = cargarConfig(BASE);
  assert.equal(c.interactivos, 'texto');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.puerto, 8010);
  assert.equal(c.wahaSession, 'demo');
  assert.equal(c.anthropicApiKey, null);
  assert.equal(c.iaTimeoutMs, 6000);
});

test('cargarConfig exige los secretos obligatorios y nombra los que faltan sin imprimir valores', () => {
  assert.throws(() => cargarConfig({ WAHA_API_KEY: 'k' }), /WAHA_WEBHOOK_HMAC_SECRET.*INTERNAL_API_KEY/);
});

test('cargarConfig rechaza un WAHA_INTERACTIVOS desconocido', () => {
  assert.throws(() => cargarConfig({ ...BASE, WAHA_INTERACTIVOS: 'raro' }), /nativo o texto/);
});

test('cargarConfig deriva la URL de WAHA del puerto configurado', () => {
  assert.equal(cargarConfig(BASE).wahaBaseUrl, 'http://127.0.0.1:3010');
  assert.equal(cargarConfig({ ...BASE, WAHA_PORT: '3333' }).wahaBaseUrl, 'http://127.0.0.1:3333');
});

test('cargarConfig lee la clave de Anthropic y el modo nativo', () => {
  const c = cargarConfig({ ...BASE, ANTHROPIC_API_KEY: 'sk-x', WAHA_INTERACTIVOS: 'nativo' });
  assert.equal(c.anthropicApiKey, 'sk-x');
  assert.equal(c.interactivos, 'nativo');
});

test('enmascarar deja solo los últimos 4 dígitos y soloDigitos limpia el id', () => {
  assert.equal(enmascarar('51944686794@c.us'), '***6794');
  assert.equal(enmascarar(undefined), '***');
  assert.equal(soloDigitos('51944686794@c.us'), '51944686794');
  assert.equal(soloDigitos('+51 944-686-794'), '51944686794');
});

test('COMPROBANTE_ENTREGA vale whatsapp por defecto, acepta ninguno y rechaza otros valores', () => {
  assert.equal(cargarConfig(BASE).comprobanteEntrega, 'whatsapp');
  assert.equal(cargarConfig({ ...BASE, COMPROBANTE_ENTREGA: 'ninguno' }).comprobanteEntrega, 'ninguno');
  assert.throws(() => cargarConfig({ ...BASE, COMPROBANTE_ENTREGA: 'correo' }), /whatsapp o ninguno/);
});
