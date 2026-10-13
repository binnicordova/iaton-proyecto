const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearDescargaMedia } = require('../src/media');
const { ErrorBackend } = require('../src/backend/real/errores');

// WAHA de mentira: sirve /api/files/* y el mensaje con downloadMedia.
async function wahaFalso(extra = {}) {
  const pedidos = [];
  const archivos = { '/api/files/foto.jpeg': { tipo: 'image/jpeg', cuerpo: Buffer.from('JPEG') }, '/api/files/doc.pdf': { tipo: 'application/pdf; charset=binary', cuerpo: Buffer.from('%PDF') }, ...extra.archivos };
  const servidor = http.createServer((req, res) => {
    pedidos.push({ url: req.url, clave: req.headers['x-api-key'] });
    if (req.headers['x-api-key'] !== 'CLAVE') { res.writeHead(401); return res.end(); }
    if (archivos[req.url.split('?')[0]]) { const a = archivos[req.url.split('?')[0]]; res.writeHead(200, { 'content-type': a.tipo }); return res.end(a.cuerpo); }
    if (/\/api\/demo\/chats\/.+\/messages\/.+\?downloadMedia=true$/.test(req.url)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(extra.mensaje || { hasMedia: true, media: { url: `http://localhost:3000/api/files/foto.jpeg`, mimetype: 'image/jpeg' } }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  servidor.unref();
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { base, pedidos, cerrar: () => new Promise((r) => servidor.close(r)) };
}
const crear = (w, opciones) => crearDescargaMedia({ wahaBaseUrl: w.base, apiKey: 'CLAVE', session: 'demo', ...opciones });

test('baja el archivo de la URL del evento, reescribiéndola al WAHA propio, con la clave', async () => {
  const w = await wahaFalso();
  try {
    const r = await crear(w)({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://localhost:3000/api/files/foto.jpeg', mimetype: 'image/jpeg' });
    assert.equal(r.bytes.toString(), 'JPEG');
    assert.equal(r.mimetype, 'image/jpeg');
    assert.deepEqual(w.pedidos, [{ url: '/api/files/foto.jpeg', clave: 'CLAVE' }]);
  } finally { await w.cerrar(); }
});

test('el tipo sale del encabezado de la respuesta cuando el evento no lo trae', async () => {
  const w = await wahaFalso();
  try {
    const r = await crear(w)({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://x/api/files/doc.pdf' });
    assert.equal(r.mimetype, 'application/pdf');
  } finally { await w.cerrar(); }
});

test('sin URL en el evento pide el mensaje con downloadMedia=true y baja el archivo que indique', async () => {
  const w = await wahaFalso();
  try {
    const r = await crear(w)({ chatId: '51944686794@c.us', mensajeId: 'false_51@c.us_AAA', mediaUrl: null, mimetype: null });
    assert.equal(r.bytes.toString(), 'JPEG');
    assert.equal(r.mimetype, 'image/jpeg');
    assert.match(w.pedidos[0].url, /^\/api\/demo\/chats\/51944686794%40c\.us\/messages\/false_51%40c\.us_AAA\?downloadMedia=true$/);
    assert.equal(w.pedidos[1].url, '/api/files/foto.jpeg');
  } finally { await w.cerrar(); }
});

test('devuelve null si WAHA no tiene el archivo (no es un fallo de red)', async () => {
  const w = await wahaFalso({ mensaje: { hasMedia: false, media: null } });
  try {
    assert.equal(await crear(w)({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: null }), null);
    assert.equal(await crear(w)({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://x/api/files/no-existe.jpeg' }), null);
  } finally { await w.cerrar(); }
});

test('si WAHA no responde es un error de transporte (el motor avisa del problema temporal)', async () => {
  const w = await wahaFalso();
  const base = w.base;
  await w.cerrar();
  await assert.rejects(() => crearDescargaMedia({ wahaBaseUrl: base, apiKey: 'CLAVE', session: 'demo', timeoutMs: 300 })({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://x/api/files/foto.jpeg' }), (e) => e instanceof ErrorBackend && e.transporte === true);
});

test('con una clave equivocada devuelve null en vez de lanzar un error opaco', async () => {
  const w = await wahaFalso();
  try {
    assert.equal(await crearDescargaMedia({ wahaBaseUrl: w.base, apiKey: 'OTRA', session: 'demo' })({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://x/api/files/foto.jpeg' }), null);
  } finally { await w.cerrar(); }
});
