const crypto = require('node:crypto');

const firmar = (cuerpo, secreto) => crypto.createHmac('sha512', secreto).update(cuerpo).digest('hex');

// El HMAC se calcula sobre el cuerpo crudo, nunca sobre el JSON reserializado.
function verificarHmac({ cuerpoCrudo, firma, secreto }) {
  if (!firma) return false;
  const esperado = Buffer.from(firmar(cuerpoCrudo, secreto), 'hex');
  const recibido = Buffer.from(String(firma), 'hex');
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

module.exports = { firmar, verificarHmac };
