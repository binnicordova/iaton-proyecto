const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const OBLIGATORIAS = ['WAHA_API_KEY', 'WAHA_WEBHOOK_HMAC_SECRET', 'INTERNAL_API_KEY'];

function leer(ruta) {
  try { return util.parseEnv(fs.readFileSync(ruta, 'utf8')); } catch { return {}; }
}

// La raíz del repositorio puede tener un .env (p. ej. con ANTHROPIC_API_KEY); waha/.env tiene prioridad.
function cargarEnvDeArchivos(dirWaha) {
  return { ...leer(path.join(dirWaha, '..', '.env')), ...leer(path.join(dirWaha, '.env')) };
}

function cargarConfig(env) {
  const faltan = OBLIGATORIAS.filter((k) => !env[k]);
  if (faltan.length) throw new Error(`faltan variables en .env: ${faltan.join(', ')}`);
  const interactivos = env.WAHA_INTERACTIVOS || 'texto';
  if (!['nativo', 'texto'].includes(interactivos)) throw new Error('WAHA_INTERACTIVOS debe ser nativo o texto');
  const comprobanteEntrega = env.COMPROBANTE_ENTREGA || 'whatsapp';
  if (!['whatsapp', 'ninguno'].includes(comprobanteEntrega)) throw new Error('COMPROBANTE_ENTREGA debe ser whatsapp o ninguno');
  const backend = env.BACKEND || 'simulado';
  if (!['real', 'simulado'].includes(backend)) throw new Error('BACKEND debe ser real o simulado');
  return {
    backend,
    wahaBaseUrl: env.WAHA_BASE_URL || `http://127.0.0.1:${env.WAHA_PORT || 3010}`,
    wahaApiKey: env.WAHA_API_KEY,
    wahaSession: env.WAHA_SESSION || 'demo',
    interactivos,
    comprobanteEntrega,
    hmacSecret: env.WAHA_WEBHOOK_HMAC_SECRET,
    internalKey: env.INTERNAL_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    puerto: Number(env.APP_PORT || 8010),
    host: env.APP_HOST || '127.0.0.1',
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'brasper.db'),
    iaTimeoutMs: Number(env.IA_TIMEOUT_MS || 6000),
    pausaEnvioMs: Number(env.PAUSA_ENVIO_MS || 700),
  };
}

module.exports = { cargarConfig, cargarEnvDeArchivos };
