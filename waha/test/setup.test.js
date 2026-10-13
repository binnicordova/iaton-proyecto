const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const { generarEnv } = require('../src/scripts/setup');

test('generarEnv crea los secretos faltantes distintos entre sí', () => {
  const env = util.parseEnv(generarEnv({}));
  const claves = ['WAHA_API_KEY', 'WAHA_WEBHOOK_HMAC_SECRET', 'INTERNAL_API_KEY', 'WAHA_DASHBOARD_PASSWORD', 'WHATSAPP_SWAGGER_PASSWORD'];
  for (const k of claves) assert.match(env[k], /^[0-9a-f]{64}$/);
  assert.equal(new Set(claves.map((k) => env[k])).size, claves.length);
  assert.equal(env.WAHA_SESSION, 'demo');
  assert.equal(env.WAHA_PORT, '3010');
  assert.equal(env.APP_PORT, '8010');
  assert.equal(env.WAHA_INTERACTIVOS, 'nativo'); // decisión de H0: NOWEB + listas
  assert.equal(env.WHATSAPP_DEFAULT_ENGINE, 'NOWEB');
});

test('generarEnv conserva los valores existentes', () => {
  const env = util.parseEnv(generarEnv({ WAHA_API_KEY: 'mia', WAHA_INTERACTIVOS: 'nativo' }));
  assert.equal(env.WAHA_API_KEY, 'mia');
  assert.equal(env.WAHA_INTERACTIVOS, 'nativo');
});
