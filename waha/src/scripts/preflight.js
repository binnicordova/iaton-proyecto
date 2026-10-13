// Lista previa a la demo (T-30 min). Sale con código 1 si algo falla. Con --ia hace una llamada real de prueba.
const path = require('node:path');
const { cargarConfig, cargarEnvDeArchivos } = require('../config');
const { abrirDb } = require('../estado/db');
const { crearExtractor } = require('../ia/extraccion');

(async () => {
  const c = cargarConfig({ ...cargarEnvDeArchivos(path.join(__dirname, '..', '..')), ...process.env });
  const filas = [];
  const probar = async (nombre, fn) => {
    try { filas.push([nombre, true, await fn()]); } catch (e) { filas.push([nombre, false, e.message]); }
  };
  await probar('WAHA responde y la sesión está WORKING', async () => {
    const r = await fetch(`${c.wahaBaseUrl}/api/sessions/${c.wahaSession}`, { headers: { 'X-Api-Key': c.wahaApiKey }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} (¿hay otro servicio en ${c.wahaBaseUrl}?)`);
    const s = (await r.json()).status;
    if (s !== 'WORKING') throw new Error(`estado ${s}`);
    return s;
  });
  await probar('El servidor responde en /health/whatsapp', async () => {
    const r = await fetch(`http://${c.host}:${c.puerto}/health/whatsapp`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return 'ready';
  });
  if (c.backend === 'real') {
    await probar('El backend de Firebase responde (/health/backend)', async () => {
      const r = await fetch(`http://${c.host}:${c.puerto}/health/backend`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} (getRates no respondió)`);
      return 'getRates ok';
    });
  }
  await probar('La base SQLite abre y escribe', async () => { abrirDb(c.dbPath).exec('SELECT 1'); return c.dbPath; });
  await probar('Hay clave de Anthropic (no se muestra)', async () => { if (!c.anthropicApiKey) throw new Error('falta ANTHROPIC_API_KEY'); return 'presente'; });
  if (process.argv.includes('--ia')) {
    await probar('La IA extrae un mensaje de prueba', async () => {
      const r = await crearExtractor({ apiKey: c.anthropicApiKey, timeoutMs: c.iaTimeoutMs })('Quiero enviar 500 reales a Perú');
      if (!(r.monto === 500 && r.moneda_origen === 'BRL' && r.moneda_destino === 'PEN')) throw new Error(`respuesta inesperada: ${JSON.stringify(r)}`);
      return 'ok';
    });
  }
  filas.push(['Backend', true, c.backend]);
  filas.push(['Modo de botones y listas', true, c.interactivos]);
  for (const [n, ok, d] of filas) console.log(`${ok ? '✔' : '✘'} ${n}: ${d}`);
  console.log('Pendiente a mano: mensaje de prueba desde otro teléfono y sin aviso de restricción 463/475 en el panel de WAHA.');
  if (filas.some((f) => !f[1])) process.exit(1);
})().catch((e) => { console.error(e.message); process.exit(1); });
