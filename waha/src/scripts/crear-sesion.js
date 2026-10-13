// Crea la sesión de WAHA con el webhook firmado, solo si no existe. No reinicia ni borra nada.
const path = require('node:path');
const { cargarConfig, cargarEnvDeArchivos } = require('../config');

(async () => {
  const env = { ...cargarEnvDeArchivos(path.join(__dirname, '..', '..')), ...process.env };
  const c = cargarConfig(env);
  const cab = { 'X-Api-Key': c.wahaApiKey, 'Content-Type': 'application/json' };
  const actual = await fetch(`${c.wahaBaseUrl}/api/sessions/${c.wahaSession}`, { headers: cab });
  if (actual.ok) { console.log(`La sesión "${c.wahaSession}" ya existe: ${(await actual.json()).status}. No hice cambios.`); return; }
  const url = env.WEBHOOK_URL || `http://host.docker.internal:${c.puerto}/webhooks/waha`;
  const r = await fetch(`${c.wahaBaseUrl}/api/sessions`, {
    method: 'POST', headers: cab,
    body: JSON.stringify({
      name: c.wahaSession,
      config: {
        client: { deviceName: 'BrasPer demo', browserName: 'Chrome' },
        webhooks: [{ url, events: ['message', 'session.status'], hmac: { key: c.hmacSecret }, retries: { policy: 'exponential', delaySeconds: 2, attempts: 5 } }],
      },
    }),
  });
  console.log(`Creación de la sesión: HTTP ${r.status}. Webhook hacia ${url}.`);
  if (!r.ok) process.exit(1);
  const inicio = await fetch(`${c.wahaBaseUrl}/api/sessions/${c.wahaSession}/start`, { method: 'POST', headers: cab });
  console.log(`Inicio de la sesión: HTTP ${inicio.status}. Escanea el QR desde el panel de WAHA (${c.wahaBaseUrl}/dashboard).`);
})().catch((e) => { console.error(e.message); process.exit(1); });
