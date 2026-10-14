const test = require('node:test');
const assert = require('node:assert/strict');
const { configBackend } = require('../src/backend/real/config');

test('exige la clave web y nombra la variable sin imprimir valores', () => {
  assert.throws(() => configBackend({}), /FIREBASE_API_KEY/);
});

test('el proyecto aibrasper es el valor por defecto y de él salen el bucket y las URL', () => {
  const c = configBackend({ FIREBASE_API_KEY: 'k' });
  assert.equal(c.projectId, 'aibrasper');
  assert.equal(c.bucket, 'aibrasper.firebasestorage.app');
  assert.equal(c.functionsUrl, 'https://{nombre}-h5wenirx2q-rj.a.run.app');
  assert.equal(c.firestoreUrl, 'https://firestore.googleapis.com/v1/projects/aibrasper/databases/(default)/documents');
  assert.equal(c.identityUrl, 'https://identitytoolkit.googleapis.com');
});

test('cualquier URL o el proyecto se pueden cambiar por entorno (las pruebas apuntan al servidor falso)', () => {
  const c = configBackend({ FIREBASE_API_KEY: 'k', FIREBASE_PROJECT_ID: 'otro', FIREBASE_FUNCTIONS_URL: 'http://x/{nombre}' });
  assert.equal(c.bucket, 'otro.firebasestorage.app');
  assert.match(c.firestoreUrl, /projects\/otro\//);
  assert.equal(c.functionsUrl, 'http://x/{nombre}');
});
