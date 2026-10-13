const test = require('node:test');
const assert = require('node:assert/strict');
const { firmar, verificarHmac } = require('../src/webhook/hmac');

const CUERPO = Buffer.from('{"a":1}');

test('acepta una firma válida sobre el cuerpo crudo', () => {
  const firma = firmar(CUERPO, 'secreto');
  assert.equal(verificarHmac({ cuerpoCrudo: CUERPO, firma, secreto: 'secreto' }), true);
});

test('rechaza firma ausente, alterada, de otro secreto o con otro cuerpo', () => {
  const firma = firmar(CUERPO, 'secreto');
  assert.equal(verificarHmac({ cuerpoCrudo: CUERPO, firma: undefined, secreto: 'secreto' }), false);
  assert.equal(verificarHmac({ cuerpoCrudo: CUERPO, firma: `${firma.slice(0, -1)}0`, secreto: 'secreto' }), false);
  assert.equal(verificarHmac({ cuerpoCrudo: CUERPO, firma, secreto: 'otro' }), false);
  assert.equal(verificarHmac({ cuerpoCrudo: Buffer.from('{"a": 1}'), firma, secreto: 'secreto' }), false);
  assert.equal(verificarHmac({ cuerpoCrudo: CUERPO, firma: 'zz', secreto: 'secreto' }), false);
});
