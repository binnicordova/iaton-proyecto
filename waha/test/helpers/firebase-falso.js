// Servidor HTTP que imita el contrato publicado del backend de BrasPer (proyecto aibrasper): Identity Toolkit, las funciones
// callable, lecturas REST de Firestore con las reglas de dueño y la subida a Storage. Solo para pruebas.
// Las cifras de la cotización reproducen las de la prueba de humo real (500 BRL → PEN: tasa 0.6745, total 514.16).
const http = require('node:http');
const { documentoValido, normalizarDocumento, correoValido, nombreValido, operacionValida, cuentaValida } = require('../../src/backend/real/validadores');

const TASAS_USD = { USD: 1, BRL: 4.989911, PEN: 3.434509 };
const PRECIOS = { spreadBps: 200, commissionBps: 240, taxBps: 1800, quoteTtlMinutes: 15, rateLockMinutes: 30, ratesRefreshMinutes: 60, largeAmountUsd: 3000, minSendUsd: 10 };
const MONEDAS = ['BRL', 'PEN', 'USD'];
const DOCS = ['DNI', 'CE', 'RUC', 'CPF'];
const FONDOS = ['savings', 'salary', 'business', 'asset_sale', 'donation', 'other'];
const CUENTAS_PAGO = {
  BRL: { currency: 'BRL', holder: 'BrasPer (DEMO)', bank: 'Nubank', accountNumber: '0001-0000001-0', pixKey: 'pix@brasper.demo', demo: true },
  PEN: { currency: 'PEN', holder: 'BrasPer (DEMO)', bank: 'BCP', accountNumber: '191-0000000-0-00', demo: true },
  USD: { currency: 'USD', holder: 'BrasPer (DEMO)', bank: 'BCP', accountNumber: '191-0000000-1-11', demo: true },
};
const MAX_PRUEBA = 8 * 1024 * 1024;
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;

// Valores tipados de Firestore, como los devuelve la API REST.
function codificar(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(codificar) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, codificar(x)])) } };
}
const documento = (ruta, datos) => ({ name: `projects/aibrasper/databases/(default)/documents/${ruta}`, fields: codificar(datos).mapValue.fields });

class ErrorHttp extends Error {
  constructor(estado, grpc, mensaje, detalles) { super(mensaje); this.estado = estado; this.grpc = grpc; this.detalles = detalles; }
}
const negocio = (estado, grpc, mensaje, detalles) => new ErrorHttp(estado, grpc, mensaje, detalles);

async function crearFirebaseFalso({ apiKey = 'CLAVE_PUBLICA_FALSA', bucket = 'aibrasper.firebasestorage.app', desdeOrden = 1, ahora = () => new Date(), tasas = TASAS_USD, tokenSegundos = 3600 } = {}) {
  let reloj = 0; // minutos que se han "avanzado" con avanzar()
  const ahoraSim = () => new Date(ahora().getTime() + reloj * 60_000);
  const usuarios = new Map(); // uid → { refresh }
  const tokens = new Map(); // idToken → { uid, vence }
  const refrescos = new Map(); // refresh → uid
  const cotizaciones = new Map();
  const ordenes = new Map();
  const clientes = new Map();
  const archivos = new Map();
  const tickets = new Map();
  const llamadas = [];
  const fallos = []; // { ruta, estado, cuerpo, veces } | { ruta, demora, veces, despuesDeEfecto }
  let nUsuarios = 0; let nCot = 0; let seq = desdeOrden - 1; let nTickets = 0; let nTokens = 0;

  const nuevoToken = (uid) => {
    const t = `tok.${uid}.${(nTokens += 1)}`;
    tokens.set(t, { uid, vence: ahoraSim().getTime() + tokenSegundos * 1000 });
    return t;
  };
  const crearUsuario = () => {
    const uid = `uid${String((nUsuarios += 1)).padStart(3, '0')}`;
    const refresh = `refresh.${uid}`;
    usuarios.set(uid, { refresh });
    refrescos.set(refresh, uid);
    return { uid, refresh, idToken: nuevoToken(uid) };
  };
  const autenticar = (cabecera, prefijo) => {
    const m = new RegExp(`^${prefijo} (.+)$`).exec(cabecera || '');
    const t = m && tokens.get(m[1]);
    if (!t || t.vence <= ahoraSim().getTime() || !usuarios.has(t.uid)) throw negocio(401, 'UNAUTHENTICATED', 'sign-in-required');
    return t.uid;
  };

  const precio = (envia, recibe, monto, esEnvio) => {
    const mercado = tasas[recibe] / tasas[envia];
    const tasa = r4(mercado * (1 - PRECIOS.spreadBps / 10000));
    const envio = esEnvio ? monto : r2(monto / tasa);
    const comision = r2((envio * PRECIOS.commissionBps) / 10000);
    const impuesto = r2((comision * PRECIOS.taxBps) / 10000);
    return { sendAmount: envio, receiveAmount: esEnvio ? r2(envio * tasa) : monto, marketRate: r4(mercado), rate: tasa, commission: comision, tax: impuesto, total: r2(envio + comision + impuesto) };
  };

  const funciones = {
    getRates() {
      const t = ahoraSim().toISOString();
      return { market: { base: 'USD', rates: tasas, source: 'open.er-api.com', fetchedAt: t, nextUpdateAt: t, providerUpdatedAt: t }, pricing: PRECIOS, minutesPerQueuedClient: 2.5 };
    },
    createQuote(uid, d) {
      const detalles = [];
      if (!MONEDAS.includes(d.sendCurrency)) detalles.push({ path: 'sendCurrency', message: 'invalid' });
      if (!MONEDAS.includes(d.receiveCurrency)) detalles.push({ path: 'receiveCurrency', message: 'invalid' });
      const tieneEnvio = d.sendAmount !== undefined; const tieneRecibo = d.receiveAmount !== undefined;
      if (tieneEnvio === tieneRecibo) detalles.push({ path: 'sendAmount', message: 'give exactly one of sendAmount or receiveAmount' });
      if (detalles.length) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-input', detalles);
      if (d.sendCurrency === d.receiveCurrency) throw negocio(400, 'INVALID_ARGUMENT', 'same-currency');
      const monto = tieneEnvio ? d.sendAmount : d.receiveAmount;
      if (typeof monto !== 'number' || !(monto > 0) || monto > 10_000_000) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-amount');
      const p = precio(d.sendCurrency, d.receiveCurrency, monto, tieneEnvio);
      const enUsd = p.sendAmount / tasas[d.sendCurrency];
      if (enUsd < PRECIOS.minSendUsd) throw negocio(400, 'INVALID_ARGUMENT', 'amount-too-small');
      const ahoraIso = ahoraSim();
      const q = {
        id: `Q${String((nCot += 1)).padStart(4, '0')}`, uid, channel: d.channel || 'form', status: 'open',
        createdAt: ahoraIso.toISOString(), expiresAt: new Date(ahoraIso.getTime() + PRECIOS.quoteTtlMinutes * 60_000).toISOString(),
        sendCurrency: d.sendCurrency, receiveCurrency: d.receiveCurrency, ...p, requiresHuman: enUsd > PRECIOS.largeAmountUsd,
      };
      if (q.requiresHuman) throw negocio(400, 'FAILED_PRECONDITION', 'requires-human', q);
      cotizaciones.set(q.id, q);
      return q;
    },
    createOrder(uid, d) {
      const detalles = [];
      const falta = (path) => detalles.push({ path, message: 'invalid' });
      if (typeof d.quoteId !== 'string' || !d.quoteId) falta('quoteId');
      if (!nombreValido(d.clientName)) falta('clientName');
      if (!DOCS.includes(d.docType)) falta('docType');
      else if (!documentoValido(d.docType, d.docNumber)) falta('docNumber');
      if (!correoValido(d.email)) falta('email');
      if (!FONDOS.includes(d.fundsSource)) falta('fundsSource');
      for (const c of ['sourceBank', 'destinationBank']) if (typeof d[c] !== 'string' || !d[c].trim() || d[c].length > 60) falta(c);
      if (!cuentaValida(d.destinationAccount)) falta('destinationAccount');
      if (d.sourceAccount !== undefined && !cuentaValida(d.sourceAccount)) falta('sourceAccount'); // opcional en el backend; si viene, debe ser válida
      if (detalles.length) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-input', detalles);
      const q = cotizaciones.get(d.quoteId);
      if (!q || q.uid !== uid) throw negocio(404, 'NOT_FOUND', 'quote-not-found');
      if (q.status !== 'open') throw negocio(400, 'FAILED_PRECONDITION', 'quote-already-used');
      const t = ahoraSim();
      if (t.getTime() > new Date(q.expiresAt).getTime()) throw negocio(504, 'DEADLINE_EXCEEDED', 'quote-expired');
      seq += 1;
      const orderId = `BR-${String(seq).padStart(4, '0')}`;
      const orden = {
        orderId, seq, uid, channel: q.channel, language: d.language || 'es', status: 'pending', createdAt: t.toISOString(), updatedAt: t.toISOString(),
        quoteId: q.id, clientName: d.clientName, docType: d.docType, docNumber: normalizarDocumento(d.docType, d.docNumber), email: d.email.toLowerCase(),
        fundsSource: d.fundsSource, sourceBank: d.sourceBank, sourceAccount: d.sourceAccount, destinationBank: d.destinationBank, destinationAccount: d.destinationAccount,
        sendAmount: q.sendAmount, sendCurrency: q.sendCurrency, receiveAmount: q.receiveAmount, receiveCurrency: q.receiveCurrency,
        rate: q.rate, marketRate: q.marketRate, commission: q.commission, tax: q.tax, total: q.total,
        rateLockedUntil: new Date(t.getTime() + PRECIOS.rateLockMinutes * 60_000).toISOString(), paymentAccount: CUENTAS_PAGO[q.sendCurrency],
        operationNo: null, paymentProofPath: null, proofSubmittedAt: null, validatedBy: null, validatedAt: null, rejectionReason: null,
        exportBatchId: null, exportedAt: null, invoiceStatus: null,
      };
      ordenes.set(orderId, orden);
      q.status = 'consumed'; q.orderId = orderId;
      const previo = clientes.get(uid) || { accounts: [] };
      const cuentas = new Map(previo.accounts.map((a) => [`${a.bank}|${a.accountNumber}`, a]));
      for (const [banco, numero, moneda] of [[d.sourceBank, d.sourceAccount, q.sendCurrency], [d.destinationBank, d.destinationAccount, q.receiveCurrency]]) {
        if (!numero) continue; // sin número de cuenta no hay cuenta que guardar
        const clave = `${banco}|${numero}`;
        if (!cuentas.has(clave)) cuentas.set(clave, { id: clave, bank: banco, accountNumber: numero, currency: moneda });
      }
      clientes.set(uid, { clientName: d.clientName, email: d.email.toLowerCase(), docType: d.docType, docNumber: orden.docNumber, language: d.language || 'es', accounts: [...cuentas.values()].slice(-12), updatedAt: t.toISOString() });
      return orden;
    },
    submitProof(uid, d) {
      if (!operacionValida(d.operationNo)) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-operation-no');
      const o = ordenes.get(d.orderId);
      if (!o || o.uid !== uid) throw negocio(404, 'NOT_FOUND', 'order-not-found');
      const prefijo = `proofs/${uid}/${d.orderId}/`;
      if (typeof d.proofPath !== 'string' || !d.proofPath.startsWith(prefijo) || d.proofPath.includes('..')) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-proof-path');
      if (o.status !== 'pending') throw negocio(400, 'FAILED_PRECONDITION', 'order-not-pending');
      const f = archivos.get(d.proofPath);
      if (!f) throw negocio(400, 'FAILED_PRECONDITION', 'proof-not-uploaded');
      if (f.bytes.length > MAX_PRUEBA) throw negocio(400, 'INVALID_ARGUMENT', 'proof-too-large');
      const num = d.operationNo.trim().toUpperCase();
      for (const otra of ordenes.values()) {
        if (otra.orderId !== o.orderId && otra.operationNo === num && !['cancelled', 'rejected'].includes(otra.status)) throw negocio(409, 'ALREADY_EXISTS', 'operation-no-duplicate');
      }
      Object.assign(o, { status: 'validating', operationNo: num, paymentProofPath: d.proofPath, proofSubmittedAt: ahoraSim().toISOString(), updatedAt: ahoraSim().toISOString() });
      return { ok: true, orderId: o.orderId };
    },
    cancelOrder(uid, d) {
      const o = ordenes.get(d.orderId);
      if (!o || o.uid !== uid) throw negocio(404, 'NOT_FOUND', 'order-not-found');
      if (o.status !== 'pending') throw negocio(400, 'FAILED_PRECONDITION', 'order-not-pending');
      o.status = 'cancelled'; o.updatedAt = ahoraSim().toISOString();
      return { ok: true, orderId: o.orderId };
    },
    requestHuman(uid, d) {
      if (typeof d.summary !== 'string' || !d.summary.trim() || d.summary.length > 1500) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-input', [{ path: 'summary', message: 'invalid' }]);
      if (d.orderId) { const o = ordenes.get(d.orderId); if (!o || o.uid !== uid) throw negocio(404, 'NOT_FOUND', 'order-not-found'); }
      let t = [...tickets.values()].find((x) => x.uid === uid && x.status === 'waiting');
      if (!t) { t = { handoffId: `H${String((nTickets += 1)).padStart(3, '0')}`, uid, status: 'waiting', summary: d.summary, orderId: d.orderId || null, channel: d.channel || 'assistant' }; tickets.set(t.handoffId, t); }
      const posicion = [...tickets.values()].filter((x) => x.status === 'waiting').indexOf(t) + 1;
      return { handoffId: t.handoffId, position: posicion, estimatedWaitMinutes: Math.max(1, Math.round(posicion * 2.5)) };
    },
    getQueueInfo(uid, d) {
      const t = tickets.get(d.handoffId);
      if (!t || t.uid !== uid) throw negocio(404, 'NOT_FOUND', 'handoff-not-found');
      const posicion = t.status === 'waiting' ? [...tickets.values()].filter((x) => x.status === 'waiting').indexOf(t) + 1 : 0;
      return { handoffId: t.handoffId, position: posicion, estimatedWaitMinutes: posicion ? Math.max(1, Math.round(posicion * 2.5)) : 0, status: t.status };
    },
    getReceipt(uid, d) {
      const o = ordenes.get(d.orderId);
      if (!o || o.uid !== uid) throw negocio(403, 'PERMISSION_DENIED', 'not-your-order');
      if (o.invoiceStatus !== 'accepted') throw negocio(400, 'FAILED_PRECONDITION', 'receipt-not-ready');
      return { filename: `B001-${String(o.seq).padStart(8, '0')}.pdf`, contentType: 'application/pdf', base64: Buffer.from(`%PDF-1.4 RECIBO FALSO ${o.orderId}`).toString('base64') };
    },
  };

  // Reglas de lectura de Firestore: orders y clientes solo del dueño.
  function leerDocumento(uid, coleccion, id) {
    // Como en el Firestore real: la regla compara resource.data.uid, así que una orden que no existe también da 403.
    if (coleccion === 'orders') { const o = ordenes.get(id); if (!o || o.uid !== uid) throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.'); return documento(`orders/${id}`, o); }
    if (coleccion === 'clients') { if (id !== uid) throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.'); const c = clientes.get(uid); return c ? documento(`clients/${uid}`, c) : null; }
    throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
  }

  function consultar(uid, cuerpo) {
    const q = cuerpo.structuredQuery || {};
    const coleccion = q.from && q.from[0] && q.from[0].collectionId;
    if (coleccion !== 'orders') throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
    const filtros = q.where && q.where.compositeFilter ? q.where.compositeFilter.filters : q.where ? [q.where] : [];
    const campos = Object.fromEntries(filtros.map((f) => [f.fieldFilter.field.fieldPath, f.fieldFilter.value.stringValue]));
    if (campos.uid !== uid) throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.'); // la regla exige filtrar por el propio uid
    const docs = [...ordenes.values()].filter((o) => o.uid === uid && Object.entries(campos).every(([k, v]) => o[k] === v));
    return docs.length ? docs.map((o) => ({ document: documento(`orders/${o.orderId}`, o), readTime: ahoraSim().toISOString() })) : [{ readTime: ahoraSim().toISOString() }];
  }

  function subirArchivo(uid, ruta, contentType, bytes) {
    const m = /^proofs\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(ruta || '');
    if (!m || m[1] !== uid) throw negocio(403, 'PERMISSION_DENIED', 'Permission denied.');
    if (bytes.length >= MAX_PRUEBA || !(contentType.startsWith('image/') || contentType === 'application/pdf')) throw negocio(403, 'PERMISSION_DENIED', 'Permission denied.');
    if (archivos.has(ruta)) throw negocio(403, 'PERMISSION_DENIED', 'Permission denied.'); // update y delete están prohibidos
    archivos.set(ruta, { bytes, contentType });
    return { name: ruta, bucket, size: String(bytes.length), contentType };
  }

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const corte = (res, e) => {
    res.writeHead(e.estado, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { status: e.grpc, message: e.message, ...(e.detalles ? { details: e.detalles } : {}) } }));
  };
  const json = (res, estado, cuerpo) => { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(cuerpo)); };

  const servidor = http.createServer(async (req, res) => {
    const partes = [];
    for await (const c of req) partes.push(c);
    const crudo = Buffer.concat(partes);
    const url = new URL(req.url, 'http://local');
    const ruta = url.pathname;
    try {
      const fallo = fallos.find((f) => ruta.includes(f.ruta) && f.veces > 0);
      if (fallo && !fallo.despuesDeEfecto) {
        fallo.veces -= 1;
        if (fallo.demora) await dormir(fallo.demora);
        if (fallo.estado) { res.writeHead(fallo.estado, { 'Content-Type': 'text/html' }); return res.end(fallo.cuerpo || ''); }
      }
      // Identity Toolkit
      if (ruta === '/identity/v1/accounts:signUp') {
        if (url.searchParams.get('key') !== apiKey) return json(res, 400, { error: { code: 400, message: 'API_KEY_INVALID' } });
        const u = crearUsuario();
        return json(res, 200, { idToken: u.idToken, refreshToken: u.refresh, localId: u.uid, expiresIn: String(tokenSegundos) });
      }
      if (ruta === '/identity/v1/accounts:delete') {
        if (url.searchParams.get('key') !== apiKey) return json(res, 400, { error: { code: 400, message: 'API_KEY_INVALID' } });
        const t = tokens.get(JSON.parse(crudo.toString('utf8') || '{}').idToken);
        if (!t || !usuarios.has(t.uid)) return json(res, 400, { error: { code: 400, message: 'INVALID_ID_TOKEN' } });
        usuarios.delete(t.uid);
        return json(res, 200, { kind: 'identitytoolkit#DeleteAccountResponse' });
      }
      if (ruta === '/securetoken/v1/token') {
        const form = new URLSearchParams(crudo.toString('utf8'));
        const uid = refrescos.get(form.get('refresh_token'));
        if (!uid || !usuarios.has(uid)) return json(res, 400, { error: { code: 400, message: 'TOKEN_EXPIRED' } });
        return json(res, 200, { id_token: nuevoToken(uid), refresh_token: usuarios.get(uid).refresh, user_id: uid, expires_in: String(tokenSegundos) });
      }
      // Funciones callable
      const f = /^\/fn\/([A-Za-z]+)$/.exec(ruta);
      if (f) {
        const uid = autenticar(req.headers.authorization, 'Bearer');
        const nombre = Object.keys(funciones).find((k) => k.toLowerCase() === f[1].toLowerCase()); // la URL real va en minúsculas
        if (!nombre) return json(res, 404, { error: { status: 'NOT_FOUND', message: 'function-not-found' } });
        const data = (JSON.parse(crudo.toString('utf8') || '{}') || {}).data || {};
        llamadas.push({ tipo: 'funcion', nombre, uid, data });
        const resultado = funciones[nombre](uid, data);
        if (fallo && fallo.despuesDeEfecto) { fallo.veces -= 1; await dormir(fallo.demora); }
        return json(res, 200, { result: resultado });
      }
      // Firestore
      const base = '/fs/projects/aibrasper/databases/(default)/documents';
      if (ruta === `${base}:runQuery`) {
        const uid = autenticar(req.headers.authorization, 'Bearer');
        llamadas.push({ tipo: 'consulta', uid });
        return json(res, 200, consultar(uid, JSON.parse(crudo.toString('utf8') || '{}')));
      }
      if (ruta.startsWith(`${base}/`) && req.method === 'GET') {
        const uid = autenticar(req.headers.authorization, 'Bearer');
        const [coleccion, id] = ruta.slice(base.length + 1).split('/');
        llamadas.push({ tipo: 'lectura', ruta: `${coleccion}/${id}`, uid });
        const d = leerDocumento(uid, coleccion, id);
        if (!d) return json(res, 404, { error: { code: 404, message: `Document "projects/aibrasper/databases/(default)/documents/${coleccion}/${id}" not found.`, status: 'NOT_FOUND' } });
        return json(res, 200, d);
      }
      // Storage
      if (ruta === `/storage/v0/b/${bucket}/o` && req.method === 'POST') {
        const uid = autenticar(req.headers.authorization, 'Firebase');
        llamadas.push({ tipo: 'subida', ruta: url.searchParams.get('name'), uid, bytes: crudo.length });
        return json(res, 200, subirArchivo(uid, url.searchParams.get('name'), req.headers['content-type'] || '', crudo));
      }
      return json(res, 404, { error: { code: 404, message: 'ruta no soportada por el falso', status: 'NOT_FOUND' } });
    } catch (e) {
      if (e instanceof ErrorHttp) return corte(res, e);
      return json(res, 500, { error: { status: 'INTERNAL', message: 'falso-roto', details: String(e.stack || e) } });
    }
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  servidor.unref();
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const orden = (id) => { const o = ordenes.get(id); if (!o) throw new Error(`orden inexistente: ${id}`); return o; };
  const cambiar = (id, desde, hasta, extra = {}) => {
    const o = orden(id);
    if (!desde.includes(o.status)) throw new Error(`transición ilegal ${o.status} → ${hasta}`);
    Object.assign(o, { status: hasta, updatedAt: ahoraSim().toISOString(), ...extra });
  };

  return {
    apiKey, bucket, url: base,
    config: {
      apiKey, bucket, projectId: 'aibrasper',
      identityUrl: `${base}/identity`, tokenUrl: `${base}/securetoken`, functionsUrl: `${base}/fn/{nombre}`,
      firestoreUrl: `${base}/fs/projects/aibrasper/databases/(default)/documents`, storageUrl: `${base}/storage`,
    },
    llamadas, ordenes, clientes, cotizaciones, archivos, tickets, usuarios,
    // Control de la prueba
    avanzar(minutos) { reloj += minutos; },
    fallar(ruta, { estado = 502, veces = 1, cuerpo = '' } = {}) { fallos.push({ ruta, estado, veces, cuerpo }); },
    demorar(ruta, ms, { veces = 1, despuesDeEfecto = false } = {}) { fallos.push({ ruta, demora: ms, veces, despuesDeEfecto }); },
    expirarTokens() { for (const t of tokens.values()) t.vence = 0; },
    borrarUsuario(uid) { usuarios.delete(uid); },
    // Personal simulado
    aprobar(id, por = 'validador@brasper.com') { cambiar(id, ['validating'], 'approved', { validatedBy: por, validatedAt: ahoraSim().toISOString() }); },
    rechazar(id, motivo, por = 'validador@brasper.com') { cambiar(id, ['validating'], 'rejected', { validatedBy: por, validatedAt: ahoraSim().toISOString(), rejectionReason: motivo }); },
    exportar(id) { cambiar(id, ['approved'], 'exported', { exportBatchId: 'lote-1', exportedAt: ahoraSim().toISOString() }); },
    facturar(id) { const o = orden(id); if (o.status !== 'exported') throw new Error('solo se factura lo exportado'); o.invoiceStatus = 'accepted'; },
    cerrar: () => new Promise((r) => servidor.close(r)),
  };
}

module.exports = { crearFirebaseFalso, CUENTAS_PAGO, PRECIOS };
