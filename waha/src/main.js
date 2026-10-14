// Arranque: lee la configuración, comprueba WAHA (sin tocar sesiones) y escucha en localhost.
const path = require('node:path');
const { cargarConfig, cargarEnvDeArchivos } = require('./config');
const { abrirDb } = require('./estado/db');
const { crearAlmacen } = require('./estado/almacen');
const { WahaProvider } = require('./provider/waha');
const { crearExtractor } = require('./ia/extraccion');
const { crearDescargaMedia } = require('./media');
const { ensamblar } = require('./ensamblar');

async function main() {
  const config = cargarConfig({ ...cargarEnvDeArchivos(path.join(__dirname, '..')), ...process.env });
  const almacen = crearAlmacen(abrirDb(config.dbPath));
  const limpiar = () => {
    almacen.limpiarVistos(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
    almacen.limpiarEjecuciones(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  };
  limpiar();
  setInterval(limpiar, 3600 * 1000).unref();
  const proveedor = new WahaProvider({
    baseUrl: config.wahaBaseUrl, apiKey: config.wahaApiKey, session: config.wahaSession,
    interactivos: config.interactivos, pausaMs: config.pausaEnvioMs, registrar: (e) => almacen.registrar(e),
  });
  const entorno = { ...cargarEnvDeArchivos(path.join(__dirname, '..')), ...process.env };
  const { servidor, vigilante } = ensamblar({
    config, entorno, almacen, proveedor,
    extraer: crearExtractor({ apiKey: config.anthropicApiKey, timeoutMs: config.iaTimeoutMs, registrar: (e) => almacen.registrar(e) }),
    descargarMedia: crearDescargaMedia({ wahaBaseUrl: config.wahaBaseUrl, apiKey: config.wahaApiKey, session: config.wahaSession }),
  });
  servidor.listen(config.puerto, config.host, () => {
    console.log(`BrasPer WAHA escuchando en http://${config.host}:${config.puerto} | backend=${config.backend} | interactivos=${config.interactivos} | IA=${config.anthropicApiKey ? 'activa' : 'sin clave (el flujo pregunta paso a paso)'}`);
  });
  if (vigilante) vigilante.iniciar();
  try {
    const r = await fetch(`${config.wahaBaseUrl}/api/sessions/${config.wahaSession}`, { headers: { 'X-Api-Key': config.wahaApiKey }, signal: AbortSignal.timeout(3000) });
    const s = r.ok ? (await r.json()).status : `HTTP_${r.status}`;
    console.log(`Sesión de WAHA "${config.wahaSession}": ${s}${s === 'WORKING' ? '' : ' (no está lista; no la modifico al arrancar)'}`);
  } catch {
    console.log('WAHA no responde todavía; el servidor sigue arriba y /health/whatsapp lo indicará.');
  }
}

main().catch((e) => { console.error(`no pude arrancar: ${e.message}`); process.exit(1); });
