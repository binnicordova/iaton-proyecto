const test = require('node:test');
const assert = require('node:assert/strict');
const { WahaProvider } = require('../src/provider/waha');

function proveedor(respuestas, extra = {}) {
  const llamadas = [];
  const esperas = [];
  const fetchImpl = async (url, init) => {
    llamadas.push({ url, init, cuerpo: JSON.parse(init.body) });
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json || {} };
  };
  const p = new WahaProvider({ baseUrl: 'http://waha:3000/', apiKey: 'K', session: 'demo', fetchImpl, dormir: async (ms) => { esperas.push(ms); }, ...extra });
  return { p, llamadas, esperas };
}
const OK = { status: 201, json: { id: 'true_51999@c.us_X' } };
const CHAT = '51999999999@c.us';
const BOTONES = [{ id: 'continuar', title: 'Continuar' }, { id: 'persona', title: 'Hablar con persona' }];

test('enviarTexto usa sendText con la clave y devuelve el id', async () => {
  const { p, llamadas } = proveedor([OK]);
  assert.equal(await p.enviarTexto(CHAT, 'hola'), 'true_51999@c.us_X');
  assert.equal(llamadas[0].url, 'http://waha:3000/api/sendText');
  assert.equal(llamadas[0].init.headers['X-Api-Key'], 'K');
  assert.deepEqual(llamadas[0].cuerpo, { session: 'demo', chatId: CHAT, text: 'hola' });
});

test('modo texto: botones y lista salen como menú numerado por sendText', async () => {
  const { p, llamadas } = proveedor([OK, OK, OK], { interactivos: 'texto' });
  await p.enviarBotones(CHAT, 'Elige', BOTONES);
  await p.enviarLista(CHAT, 'Banco', 'Elegir', [{ id: 'BCP', title: 'BCP' }]);
  await p.enviarEnlace(CHAT, 'Web', 'Abrir formulario web', 'https://brasper.com/es');
  assert.deepEqual(llamadas.map((l) => l.url.split('/').pop()), ['sendText', 'sendText', 'sendText']);
  assert.match(llamadas[0].cuerpo.text, /1\. Continuar\n2\. Hablar con persona/);
  assert.match(llamadas[1].cuerpo.text, /1\. BCP/);
  assert.equal(llamadas[2].cuerpo.text, 'Web\nAbrir formulario web: https://brasper.com/es');
});

test('modo nativo: todo se envía como lista de WhatsApp; el enlace como texto (H0: botones y botón url no llegan en cuentas personales)', async () => {
  const { p, llamadas } = proveedor([OK, OK, OK], { interactivos: 'nativo' });
  await p.enviarBotones(CHAT, 'Elige', BOTONES);
  await p.enviarLista(CHAT, 'Banco', 'Elegir banco', [{ id: 'BCP', title: 'BCP' }, { id: 'Otro', title: 'Otro' }]);
  await p.enviarEnlace(CHAT, 'Web', 'Abrir formulario web', 'https://brasper.com/es');
  assert.deepEqual(llamadas.map((l) => l.url.split('/').pop()), ['sendList', 'sendList', 'sendText']);
  const deBotones = llamadas[0].cuerpo.message;
  assert.equal(deBotones.description, 'Elige');
  assert.equal(deBotones.button, 'Elegir');
  assert.deepEqual(deBotones.sections[0].rows, [
    { title: 'Continuar', rowId: 'continuar', description: null },
    { title: 'Hablar con persona', rowId: 'persona', description: null },
  ]);
  const lista = llamadas[1].cuerpo.message;
  assert.equal(lista.button, 'Elegir banco');
  assert.deepEqual(lista.sections[0].rows[1], { title: 'Otro', rowId: 'Otro', description: null });
  assert.equal(llamadas[2].cuerpo.text, 'Web\nAbrir formulario web: https://brasper.com/es');
});

test('reintenta 5xx y errores de red con espera creciente y luego tiene éxito', async () => {
  const { p, llamadas, esperas } = proveedor([{ status: 502 }, new Error('ECONNRESET'), OK]);
  await p.enviarTexto(CHAT, 'hola');
  assert.equal(llamadas.length, 3);
  assert.deepEqual(esperas, [200, 400]);
});

test('no reintenta 4xx; marca como restricción los errores 463 y 475', async () => {
  for (const [estado, restriccion] of [[400, false], [463, true], [475, true]]) {
    const { p, llamadas } = proveedor([{ status: estado }, OK]);
    await assert.rejects(() => p.enviarTexto(CHAT, 'hola'), (e) => e.estado === estado && e.restriccion === restriccion && e.reintentable === false);
    assert.equal(llamadas.length, 1);
  }
});

test('agota los reintentos y lanza el último error', async () => {
  const { p, llamadas } = proveedor([{ status: 500 }, { status: 500 }, { status: 500 }]);
  await assert.rejects(() => p.enviarTexto(CHAT, 'hola'), (e) => e.reintentable === true && e.estado === 500);
  assert.equal(llamadas.length, 3);
});

test('hace una pausa tras cada envío y marcarLeido nunca lanza', async () => {
  const { p, esperas } = proveedor([OK, { status: 500 }, { status: 500 }, { status: 500 }], { pausaMs: 700 });
  await p.enviarTexto(CHAT, 'hola');
  assert.deepEqual(esperas, [700]);
  await assert.doesNotReject(() => p.marcarLeido(CHAT));
});

test('registra metadatos del envío sin el texto', async () => {
  const eventos = [];
  const { p } = proveedor([OK], { registrar: (e) => eventos.push(e) });
  await p.enviarTexto(CHAT, 'secreto del cliente');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'envio');
  assert.equal(eventos[0].chat, '***9999');
  assert.ok(!JSON.stringify(eventos[0]).includes('secreto del cliente'));
});

test('resolverTelefono traduce un @lid al teléfono real con la API de LIDs de WAHA', async () => {
  const { p, llamadas } = proveedor([]);
  const fetchImpl = async (url, init) => { llamadas.push({ url, key: init.headers['X-Api-Key'] }); return { ok: true, status: 200, json: async () => ({ lid: '155@lid', pn: '51944686794@c.us' }) }; };
  const q = new WahaProvider({ baseUrl: 'http://waha:3000', apiKey: 'K', session: 'demo', fetchImpl });
  assert.equal(await q.resolverTelefono('155@lid'), '51944686794');
  assert.equal(llamadas[0].url, 'http://waha:3000/api/demo/lids/155%40lid');
  assert.equal(llamadas[0].key, 'K');
  assert.equal(await q.resolverTelefono('51944686794@c.us'), '51944686794'); // un @c.us no consulta la API
  assert.equal(llamadas.length, 1);
});

test('resolverTelefono devuelve null si WAHA no conoce el LID o falla', async () => {
  for (const fetchImpl of [async () => ({ ok: false, status: 404, json: async () => ({}) }), async () => ({ ok: true, status: 200, json: async () => ({ lid: 'x', pn: null }) }), async () => { throw new Error('ECONNRESET'); }]) {
    const q = new WahaProvider({ baseUrl: 'http://waha:3000', apiKey: 'K', session: 'demo', fetchImpl });
    assert.equal(await q.resolverTelefono('155@lid'), null);
  }
});
