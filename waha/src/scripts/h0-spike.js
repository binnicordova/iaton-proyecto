// DESECHABLE (H0). Levanta un receptor que guarda cada webhook en waha/.capturas/ y envía
// texto, botones, lista y botón de enlace al teléfono indicado. Uso: node src/scripts/h0-spike.js <telefono>
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { cargarConfig, cargarEnvDeArchivos } = require('../config');

const cfg = cargarConfig(cargarEnvDeArchivos(path.join(__dirname, '..', '..')));
const tel = String(process.argv[2] || '').replace(/\D/g, '');
if (!tel) { console.error('Uso: node src/scripts/h0-spike.js <telefono con código de país>'); process.exit(1); }
const chatId = `${tel}@c.us`;
const dirCap = path.join(__dirname, '..', '..', '.capturas');
fs.mkdirSync(dirCap, { recursive: true });

http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    const f = path.join(dirCap, `${Date.now()}.json`);
    fs.writeFileSync(f, Buffer.concat(partes));
    console.log(`webhook guardado: ${path.basename(f)} (${req.url})`);
    res.writeHead(200).end('ok');
  });
}).listen(8010, '127.0.0.1', () => console.log('receptor de webhooks en 127.0.0.1:8010'));

async function enviar(ruta, cuerpo) {
  const r = await fetch(`${cfg.wahaBaseUrl}${ruta}`, {
    method: 'POST',
    headers: { 'X-Api-Key': cfg.wahaApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: cfg.wahaSession, chatId, ...cuerpo }),
  });
  console.log(`${ruta} -> HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
}

(async () => {
  await enviar('/api/sendText', { text: 'H0 1/5: texto simple' });
  await enviar('/api/sendButtons', { body: 'H0 2/5: botones de respuesta', buttons: [
    { type: 'reply', text: 'Continuar', id: 'continuar' },
    { type: 'reply', text: 'Cambiar monto', id: 'cambiar_monto' },
    { type: 'reply', text: 'Hablar con persona', id: 'persona' },
  ] });
  await enviar('/api/sendList', { message: {
    title: 'BrasPer', description: 'H0 3/5: lista', footer: 'BrasPer', button: 'Elegir banco',
    sections: [{ title: 'Opciones', rows: [
      { title: 'BCP', rowId: 'BCP', description: null }, { title: 'Interbank', rowId: 'Interbank', description: null }, { title: 'Otro', rowId: 'Otro', description: null },
    ] }],
  } });
  await enviar('/api/sendButtons', { body: 'H0 4/5: botón de enlace', buttons: [{ type: 'url', text: 'Abrir formulario web', url: 'https://brasper.com/es' }] });
  await enviar('/api/sendText', { text: 'H0 5/5: ahora toca un botón y una fila de la lista; guardo lo que llegue.' });
})().catch((e) => console.error('fallo:', e.message));
