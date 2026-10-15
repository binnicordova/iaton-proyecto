const test = require('node:test');
const assert = require('node:assert/strict');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

async function conFalso(fn, opciones) {
  const f = await crearFirebaseFalso(opciones);
  try { await fn(f); } finally { await f.cerrar(); }
}
const alta = async (f) => (await (await fetch(`${f.config.identityUrl}/v1/accounts:signUp?key=${f.apiKey}`, { method: 'POST', body: '{}' })).json());
const fn = async (f, nombre, token, data) => {
  const r = await fetch(f.config.functionsUrl.replace('{nombre}', nombre), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ data }) });
  return { estado: r.status, json: await r.json() };
};
const DATOS = { language: 'es', clientName: 'Ana Paula Souza', docType: 'CPF', docNumber: '52998224725', email: 'ana@example.com', fundsSource: 'savings', sourceBank: 'Nubank', sourceAccount: '0001-12345678-9', destinationBank: 'BCP', destinationAccount: '191-1234567890' };

test('la cotización de 500 BRL a PEN reproduce las cifras de la prueba de humo real', () => conFalso(async (f) => {
  const u = await alta(f);
  const r = await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500, channel: 'whatsapp' });
  assert.equal(r.estado, 200);
  const q = r.json.result;
  assert.deepEqual([q.rate, q.commission, q.tax, q.total, q.receiveAmount, q.channel, q.status, q.requiresHuman], [0.6745, 12, 2.16, 514.16, 337.25, 'whatsapp', 'open', false]);
  assert.equal(new Date(q.expiresAt) - new Date(q.createdAt), 15 * 60_000);
}));

test('códigos de error de createQuote: misma moneda, monto mínimo y monto grande', () => conFalso(async (f) => {
  const { idToken } = await alta(f);
  const err = async (data) => (await fn(f, 'createQuote', idToken, data)).json.error.message;
  assert.equal(await err({ sendCurrency: 'BRL', receiveCurrency: 'BRL', sendAmount: 100 }), 'same-currency');
  assert.equal(await err({ sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 10 }), 'amount-too-small');
  assert.equal(await err({ sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 20000 }), 'requires-human');
  assert.equal(await err({ sendCurrency: 'BRL', receiveCurrency: 'PEN' }), 'invalid-input');
}));

test('createOrder numera desde el contador, guarda el perfil y consume la cotización', () => conFalso(async (f) => {
  const u = await alta(f);
  const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500, channel: 'whatsapp' })).json.result;
  const o = (await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS })).json.result;
  assert.equal(o.orderId, 'BR-0001');
  assert.equal(o.status, 'pending');
  assert.equal(o.paymentAccount.bank, 'Nubank');
  assert.equal(f.clientes.get(u.localId).accounts.length, 2);
  const otra = (await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS })).json.error.message;
  assert.equal(otra, 'quote-already-used');
}, { desdeOrden: 1 }));

test('una cotización vencida da quote-expired (504) y los datos malos dan invalid-input con el campo', () => conFalso(async (f) => {
  const u = await alta(f);
  const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  const malo = await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS, docNumber: '52998224724' });
  assert.equal(malo.estado, 400);
  assert.deepEqual(malo.json.error.details.map((d) => d.path), ['docNumber']);
  f.avanzar(16);
  const vencida = await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS });
  assert.equal(vencida.estado, 504);
  assert.equal(vencida.json.error.message, 'quote-expired');
}));

test('las reglas de lectura: la orden ajena da 403, el propio cliente inexistente da 404', () => conFalso(async (f) => {
  const a = await alta(f); const b = await alta(f);
  const q = (await fn(f, 'createQuote', a.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  await fn(f, 'createOrder', a.idToken, { quoteId: q.id, ...DATOS });
  const leer = (token, ruta) => fetch(`${f.config.firestoreUrl}/${ruta}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await leer(b.idToken, 'orders/BR-0001')).status, 403);
  assert.equal((await leer(a.idToken, 'orders/BR-0001')).status, 200);
  assert.equal((await leer(b.idToken, `clients/${b.localId}`)).status, 404);
  assert.equal((await leer(b.idToken, `clients/${a.localId}`)).status, 403);
}));

test('subida a Storage: solo a la carpeta propia, imagen o PDF, sin sobrescribir', () => conFalso(async (f) => {
  const u = await alta(f);
  const subir = (ruta, tipo, bytes = Buffer.from('x')) => fetch(`${f.config.storageUrl}/v0/b/${f.bucket}/o?name=${encodeURIComponent(ruta)}`, { method: 'POST', headers: { authorization: `Firebase ${u.idToken}`, 'content-type': tipo }, body: bytes });
  assert.equal((await subir(`proofs/${u.localId}/BR-0001/p.jpg`, 'image/jpeg')).status, 200);
  assert.equal((await subir(`proofs/${u.localId}/BR-0001/p.jpg`, 'image/jpeg')).status, 403);
  assert.equal((await subir('proofs/otro/BR-0001/p.jpg', 'image/jpeg')).status, 403);
  assert.equal((await subir(`proofs/${u.localId}/BR-0001/v.mp4`, 'video/mp4')).status, 403);
  assert.equal((await subir(`proofs/${u.localId}/BR-0001/g.jpg`, 'image/jpeg', Buffer.alloc(8 * 1024 * 1024))).status, 403);
}));

test('submitProof exige foto subida, número válido y no duplicado; la orden pasa a validating', () => conFalso(async (f) => {
  const u = await alta(f);
  const crear = async () => {
    const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
    return (await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS })).json.result.orderId;
  };
  const o1 = await crear(); const o2 = await crear();
  const ruta = (o) => `proofs/${u.localId}/${o}/p.jpg`;
  const sinFoto = await fn(f, 'submitProof', u.idToken, { orderId: o1, operationNo: 'ab-1234', proofPath: ruta(o1) });
  assert.equal(sinFoto.json.error.message, 'proof-not-uploaded');
  f.archivos.set(ruta(o1), { bytes: Buffer.from('x'), contentType: 'image/jpeg' });
  f.archivos.set(ruta(o2), { bytes: Buffer.from('x'), contentType: 'image/jpeg' });
  assert.equal((await fn(f, 'submitProof', u.idToken, { orderId: o1, operationNo: '12', proofPath: ruta(o1) })).json.error.message, 'invalid-operation-no');
  assert.equal((await fn(f, 'submitProof', u.idToken, { orderId: o1, operationNo: 'ab-1234', proofPath: ruta(o1) })).json.result.ok, true);
  assert.equal(f.ordenes.get(o1).status, 'validating');
  assert.equal(f.ordenes.get(o1).operationNo, 'AB-1234');
  assert.equal((await fn(f, 'submitProof', u.idToken, { orderId: o2, operationNo: 'AB-1234', proofPath: ruta(o2) })).json.error.message, 'operation-no-duplicate');
  assert.equal((await fn(f, 'submitProof', u.idToken, { orderId: o1, operationNo: 'AB-9999', proofPath: ruta(o1) })).json.error.message, 'order-not-pending');
}));

test('el personal simulado mueve la orden y getReceipt solo responde con la factura aceptada', () => conFalso(async (f) => {
  const u = await alta(f);
  const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  const id = (await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS })).json.result.orderId;
  f.archivos.set(`proofs/${u.localId}/${id}/p.jpg`, { bytes: Buffer.from('x'), contentType: 'image/jpeg' });
  await fn(f, 'submitProof', u.idToken, { orderId: id, operationNo: 'AB-1234', proofPath: `proofs/${u.localId}/${id}/p.jpg` });
  assert.throws(() => f.exportar(id), /transición ilegal/);
  f.aprobar(id); f.exportar(id);
  assert.equal((await fn(f, 'getReceipt', u.idToken, { orderId: id })).json.error.message, 'receipt-not-ready');
  f.facturar(id);
  const r = (await fn(f, 'getReceipt', u.idToken, { orderId: id })).json.result;
  assert.equal(r.contentType, 'application/pdf');
  assert.match(Buffer.from(r.base64, 'base64').toString(), /^%PDF-1.4/);
}));

test('tokens: vencidos dan 401, se renuevan con el refresh y un usuario borrado no puede renovar', () => conFalso(async (f) => {
  const u = await alta(f);
  f.expirarTokens();
  assert.equal((await fn(f, 'getRates', u.idToken, {})).estado, 401);
  const refrescar = (refresh) => fetch(`${f.config.tokenUrl}/v1/token?key=${f.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString() });
  const nuevo = await (await refrescar(u.refreshToken)).json();
  assert.equal((await fn(f, 'getRates', nuevo.id_token, {})).estado, 200);
  f.borrarUsuario(u.localId);
  const r = await refrescar(u.refreshToken);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.message, 'TOKEN_EXPIRED');
}));

test('inyección de fallos: 502 un número limitado de veces y después responde bien', () => conFalso(async (f) => {
  const u = await alta(f);
  f.fallar('getRates', { estado: 502, veces: 2 });
  const estados = [];
  for (let i = 0; i < 3; i++) estados.push((await fn(f, 'getRates', u.idToken, {}).catch(() => ({ estado: 'sin-json' }))).estado);
  assert.deepEqual(estados, ['sin-json', 'sin-json', 200]);
}));

test('createOrder con demora después del efecto: la orden se crea aunque el cliente se rinda', () => conFalso(async (f) => {
  const u = await alta(f);
  const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  f.demorar('createOrder', 300, { despuesDeEfecto: true });
  await fetch(f.config.functionsUrl.replace('{nombre}', 'createOrder'), { method: 'POST', headers: { authorization: `Bearer ${u.idToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ data: { quoteId: q.id, ...DATOS } }), signal: AbortSignal.timeout(50) }).catch(() => {});
  assert.equal(f.ordenes.size, 1);
}));

test('accounts:delete borra al usuario: su token deja de servir y su refresco da TOKEN_EXPIRED', () => conFalso(async (f) => {
  const u = await alta(f);
  const r = await fetch(`${f.config.identityUrl}/v1/accounts:delete?key=${f.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: u.idToken }) });
  assert.equal(r.status, 200);
  assert.equal((await fn(f, 'getRates', u.idToken, {})).estado, 401);
  const refresco = await fetch(`${f.config.tokenUrl}/v1/token?key=${f.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${u.refreshToken}` });
  assert.equal((await refresco.json()).error.message, 'TOKEN_EXPIRED');
}));

test('createOrder: sourceAccount es opcional, pero si viene debe ser válida; destinationAccount sigue siendo obligatoria', () => conFalso(async (f) => {
  const u = await alta(f);
  const cotizar = async () => (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  const { sourceAccount, ...sinOrigen } = DATOS;
  const ok = await fn(f, 'createOrder', u.idToken, { quoteId: (await cotizar()).id, ...sinOrigen });
  assert.equal(ok.estado, 200);
  assert.equal(ok.json.result.sourceBank, 'Nubank');
  const corta = await fn(f, 'createOrder', u.idToken, { quoteId: (await cotizar()).id, ...DATOS, sourceAccount: 'ab' });
  assert.deepEqual([corta.estado, corta.json.error.details.map((d) => d.path)], [400, ['sourceAccount']]);
  const { destinationAccount, ...sinDestino } = DATOS;
  const falta = await fn(f, 'createOrder', u.idToken, { quoteId: (await cotizar()).id, ...sinDestino });
  assert.deepEqual(falta.json.error.details.map((d) => d.path), ['destinationAccount']);
}));
