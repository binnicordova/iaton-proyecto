// Genera waha/.env con secretos aleatorios distintos. Conserva lo que ya exista. No imprime valores.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const util = require('node:util');

const secreto = () => crypto.randomBytes(32).toString('hex');

function generarEnv(existente) {
  const e = { ...existente };
  e.WAHA_API_KEY ||= secreto();
  e.WAHA_WEBHOOK_HMAC_SECRET ||= secreto();
  e.INTERNAL_API_KEY ||= secreto();
  e.WAHA_DASHBOARD_USERNAME ||= 'waha';
  e.WAHA_DASHBOARD_PASSWORD ||= secreto();
  e.WHATSAPP_SWAGGER_USERNAME ||= 'swagger';
  e.WHATSAPP_SWAGGER_PASSWORD ||= secreto();
  e.WAHA_SESSION ||= 'demo';
  e.WAHA_PORT ||= '3010';
  e.APP_PORT ||= '8010';
  e.WAHA_INTERACTIVOS ||= 'texto';
  e.WHATSAPP_DEFAULT_ENGINE ||= 'WEBJS';
  return `${Object.entries(e).map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
}

if (require.main === module) {
  const ruta = path.join(__dirname, '..', '..', '.env');
  let existente = {};
  try { existente = util.parseEnv(fs.readFileSync(ruta, 'utf8')); } catch { /* no existe todavía */ }
  fs.writeFileSync(ruta, generarEnv(existente), { mode: 0o600 });
  console.log(`Escribí ${path.relative(process.cwd(), ruta) || '.env'} (secretos sin mostrar). ANTHROPIC_API_KEY se lee del .env de la raíz del repositorio.`);
}

module.exports = { generarEnv };
