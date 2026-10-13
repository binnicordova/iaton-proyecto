const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearBackend } = require('../src/backend');
const { ErrorBackend } = require('../src/backend/real/errores');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

const T = '51944686794';
const CHAT = `${T}@c.us`;
const COTIZACION = { monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' };
const DATOS = { nombre: 'Ana Paula Souza', doc_tipo: 'CPF', doc_num: '52998224725', correo: 'ana@example.com', fondos: 'savings', origen_banco: 'Nubank', origen_cuenta: '0001-12345678-9', destino_banco: 'BCP', destino_cuenta: '191-1234567890' };

async function mundo({ timeoutMs, ahora } = {}) {
  const falso = await crearFirebaseFalso();
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const registrados = [];
  let descargar = async () => null;
  const media = { usar: (fn) => { descargar = fn; } };
  const backend = crearBackend({ modo: 'real', almacen, configReal: falso.config, descargarMedia: (p) => descargar(p), timeoutMs, ahora, registrar: (e) => registrados.push(e), dormir: async () => {} });
  const llamar = (accion, vars = {}, extra = {}) => backend.llamarFuncion({ vars: { api_action: accion, ...vars }, phone: T, edges: extra.edges || [], wa: extra.wa || { messages: [] }, chatId: CHAT });
  return { falso, almacen, backend, llamar, registrados, media, cerrar: () => falso.cerrar() };
}
const entrante = (extra) => ({ messages: [{ direction: 'inbound', ...extra }] });
const conMundo = async (fn, opciones) => { const m = await mundo(opciones); try { await fn(m); } finally { await m.cerrar(); } };
const OK = ['ok', 'sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona'];

// Deja al cliente con una orden creada y devuelve sus variables.
async function conOrden(m) {
  const q = await m.llamar('quote_create', COTIZACION, { edges: OK });
  const r = await m.llamar('order_create', { ...COTIZACION, ...q.vars, ...DATOS }, { edges: ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'] });
  assert.equal(r.next_edge, 'ok');
  return r.vars;
}

test('quote_create: cotiza por el canal whatsapp y deja los datos para el mensaje', () => conMundo(async (m) => {
  const r = await m.llamar('quote_create', COTIZACION, { edges: OK });
  assert.equal(r.next_edge, 'ok');
  assert.deepEqual([r.vars.tasa_txt, r.vars.comision_txt, r.vars.impuesto_txt, r.vars.total_enviar_txt, r.vars.recibe_txt], ['0.6745', '12.00', '2.16', '514.16', '337.25']);
  assert.match(r.vars.tasa_hasta, /^\d{1,2}:\d\d [ap]\. m\.$/);
  assert.ok(r.vars.quote_id);
  assert.equal(m.falso.llamadas.at(-1).data.channel, 'whatsapp');
}));

test('quote_create: los códigos del backend se traducen a aristas del grafo', () => conMundo(async (m) => {
  const borde = async (vars) => (await m.llamar('quote_create', vars, { edges: OK })).next_edge;
  assert.equal(await borde({ ...COTIZACION, monto: 20000 }), 'requiere_persona');
  assert.equal(await borde({ ...COTIZACION, monto: 10 }), 'monto_bajo');
  assert.equal(await borde({ ...COTIZACION, moneda_destino: 'BRL' }), 'par_invalido');
  assert.equal(await borde({ monto: 'abc', moneda_origen: 'BRL', moneda_destino: 'PEN' }), 'par_invalido');
  m.falso.fallar('/fn/createquote', { estado: 503, veces: 1, cuerpo: '{"error":{"status":"UNAVAILABLE","message":"rates-unavailable"}}' });
  assert.equal(await borde(COTIZACION), 'sin_servicio');
}));

test('quote_create: un fallo de transporte sube al motor (se reintenta una vez antes)', () => conMundo(async (m) => {
  m.falso.fallar('/fn/createquote', { estado: 502, veces: 1 });
  assert.equal((await m.llamar('quote_create', COTIZACION, { edges: OK })).next_edge, 'ok'); // el reintento lo resuelve
  m.falso.fallar('/fn/createquote', { estado: 502, veces: 2 });
  await assert.rejects(() => m.llamar('quote_create', COTIZACION, { edges: OK }), (e) => e instanceof ErrorBackend && e.transporte === true);
}));

test('perfil_get: nuevo si no hay perfil; existe con los datos y las cuentas tras una orden', () => conMundo(async (m) => {
  const nuevo = await m.llamar('perfil_get', {}, { edges: ['nuevo', 'existe'] });
  assert.equal(nuevo.next_edge, 'nuevo');
  await conOrden(m);
  const e = await m.llamar('perfil_get', {}, { edges: ['nuevo', 'existe'] });
  assert.equal(e.next_edge, 'existe');
  assert.equal(e.vars.nombre, 'Ana Paula Souza');
  assert.equal(e.vars.doc_tipo, 'CPF');
  assert.equal(e.vars.doc_num, '52998224725');
  assert.equal(e.vars.correo_masc, 'a***@example.com');
  assert.deepEqual(e.vars.cuentas_perfil.map((c) => `${c.bank}|${c.currency}`), ['Nubank|BRL', 'BCP|PEN']);
}));

test('validate: cada campo guarda su valor limpio; el segundo fallo seguido escala', () => conMundo(async (m) => {
  const v = (campo, vars) => m.llamar(`validate:${campo}`, vars, { edges: ['valido', 'invalido', 'escalar'] });
  assert.deepEqual((await v('nombre', { nombre_raw: '  Ana   Souza ' })).vars.nombre, 'Ana Souza');
  assert.equal((await v('doc', { doc_tipo: 'DNI', doc_raw: '1234 5678' })).vars.doc_num, '12345678');
  assert.equal((await v('doc', { doc_tipo: 'CPF', doc_raw: '529.982.247-25' })).vars.doc_num, '52998224725');
  assert.equal((await v('doc', { doc_tipo: 'DNI', doc_raw: '1234567' })).next_edge, 'invalido');
  const c = await v('correo', { correo_raw: ' Ana@Example.COM ' });
  assert.deepEqual([c.vars.correo, c.vars.correo_masc], ['ana@example.com', 'a***@example.com']);
  const o = await v('cuenta_origen', { origen_cuenta_raw: '0001-12345678-9' });
  assert.deepEqual([o.vars.origen_cuenta, o.vars.origen_ult4], ['0001-12345678-9', '6789']);
  assert.equal((await v('cuenta_destino', { destino_cuenta_raw: '191-1234567890' })).vars.destino_ult4, '7890');
  assert.equal((await v('banco_destino', { destino_banco_raw: '  Banco   Pichincha ' })).vars.destino_banco, 'Banco Pichincha');
  assert.equal((await v('operacion', { operacion_raw: ' ab-1234 ' })).vars.operacion_no, 'AB-1234');
  // segundo fallo seguido del mismo campo → escalar; un acierto reinicia el contador
  const a = await v('correo', { correo_raw: 'mal' });
  assert.equal(a.next_edge, 'invalido');
  const b = await v('correo', { correo_raw: 'mal', ...a.vars });
  assert.equal(b.next_edge, 'escalar');
  const c2 = await v('correo', { correo_raw: 'ana@example.com', ...a.vars });
  assert.equal(c2.vars.fallos_correo, 0);
}));

test('cuentas_opciones y route_cuenta: lista las cuentas guardadas de esa moneda y resuelve la elegida', () => conMundo(async (m) => {
  const perfil = (await m.llamar('perfil_get', {}, { edges: ['nuevo', 'existe'] })).vars;
  assert.equal((await m.llamar('cuentas_opciones:origen', { ...COTIZACION, ...perfil }, { edges: ['con_cuentas', 'sin_cuentas'] })).next_edge, 'sin_cuentas');
  await conOrden(m);
  const p = (await m.llamar('perfil_get', {}, { edges: ['nuevo', 'existe'] })).vars;
  const base = { ...COTIZACION, ...p };
  const op = await m.llamar('cuentas_opciones:origen', base, { edges: ['con_cuentas', 'sin_cuentas'] });
  assert.equal(op.next_edge, 'con_cuentas');
  assert.deepEqual(op.vars.opciones_origen, [{ id: 'acc:0', title: 'Nubank ••6789' }, { id: 'otra', title: 'Otra cuenta' }]);
  const dest = await m.llamar('cuentas_opciones:destino', base, { edges: ['con_cuentas', 'sin_cuentas'] });
  assert.deepEqual(dest.vars.opciones_destino.map((f) => f.title), ['BCP ••7890', 'Otra cuenta']);
  const ruta = (id, vars) => m.llamar('route_cuenta:origen', { ...base, ...op.vars, ...vars }, { edges: ['elegida', 'otra', 'invalido', 'escalar'], wa: entrante({ reply_option_id: id }) });
  const elegida = await ruta('acc:0');
  assert.equal(elegida.next_edge, 'elegida');
  assert.deepEqual([elegida.vars.origen_banco, elegida.vars.origen_cuenta, elegida.vars.origen_ult4], ['Nubank', '0001-12345678-9', '6789']);
  assert.equal((await ruta('otra')).next_edge, 'otra');
  const mal = await ruta('acc:9');
  assert.equal(mal.next_edge, 'invalido');
  assert.equal((await ruta('zzz', mal.vars)).next_edge, 'escalar');
}));

test('banco_set copia el banco elegido de la lista', () => conMundo(async (m) => {
  const r = await m.llamar('banco_set:origen', { origen_banco_sel: 'Itaú' });
  assert.deepEqual(r.vars, { origen_banco: 'Itaú' });
}));

test('order_create: crea la orden, guarda cómo encontrarla y borra los datos personales del estado', () => conMundo(async (m) => {
  const v = await conOrden(m);
  assert.equal(v.operacion_id, 'BR-0001');
  assert.deepEqual([v.pago_titular, v.pago_banco, v.pago_cuenta], ['BrasPer (DEMO)', 'Nubank', '0001-0000001-0']);
  assert.equal(v.pago_pix_linea, '\nPix: pix@brasper.demo');
  assert.equal(v.total_enviar_txt, '514.16');
  assert.match(v.tasa_hasta, /^\d{1,2}:\d\d [ap]\. m\.$/);
  assert.equal(v.destino_ult4, '7890');
  for (const campo of ['nombre', 'doc_num', 'doc_raw', 'correo', 'origen_cuenta', 'destino_cuenta']) assert.equal(v[campo], '', campo);
  assert.deepEqual(v.cuentas_perfil, []);
  assert.deepEqual(m.almacen.ordenesDe(T).map((o) => o.ordenId), ['BR-0001']);
  assert.ok(!JSON.stringify(v).includes('52998224725') && !JSON.stringify(v).includes('ana@example.com'));
}));

test('order_create: los errores de negocio se traducen y los datos malos dicen qué campo repreguntar', () => conMundo(async (m) => {
  const q = (await m.llamar('quote_create', COTIZACION, { edges: OK })).vars;
  const E = ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'];
  const crear = (extra) => m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS, ...extra }, { edges: E });
  const malDoc = await crear({ doc_num: '52998224724' });
  assert.equal(malDoc.next_edge, 'dato_invalido');
  assert.equal(malDoc.vars.campo_invalido, 'documento');
  assert.equal((await m.llamar('route_campo', malDoc.vars, { edges: ['nombre', 'documento', 'correo', 'otro'] })).next_edge, 'documento');
  assert.equal((await crear({ correo: 'mal' })).vars.campo_invalido, 'correo');
  assert.equal((await crear({ nombre: 'Ana' })).vars.campo_invalido, 'nombre');
  const otro = await crear({ fondos: 'raro' });
  assert.equal(otro.vars.campo_invalido, 'otro');
  assert.equal((await m.llamar('route_campo', otro.vars, { edges: ['nombre', 'documento', 'correo', 'otro'] })).next_edge, 'otro');
  m.falso.avanzar(16);
  assert.equal((await crear({})).next_edge, 'quote_expirada');
  assert.equal((await crear({ quote_id: 'Q9999' })).next_edge, 'quote_expirada');
}));

test('order_create: si la respuesta se pierde por un timeout, reconcilia por la cotización y no duplica la orden', () => conMundo(async (m) => {
  const q = (await m.llamar('quote_create', COTIZACION, { edges: OK })).vars;
  m.falso.demorar('/fn/createorder', 400, { despuesDeEfecto: true });
  const r = await m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS }, { edges: ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'] });
  assert.equal(r.next_edge, 'ok');
  assert.equal(r.vars.operacion_id, 'BR-0001');
  assert.equal(m.falso.ordenes.size, 1);
}, { timeoutMs: 80 }));

test('order_create: una cotización ya usada recupera la orden que se creó antes', () => conMundo(async (m) => {
  const q = (await m.llamar('quote_create', COTIZACION, { edges: OK })).vars;
  const E = ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'];
  await m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS }, { edges: E });
  const otra = await m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS }, { edges: E });
  assert.equal(otra.next_edge, 'ok');
  assert.equal(otra.vars.operacion_id, 'BR-0001');
  assert.equal(m.falso.ordenes.size, 1);
}));

test('check_lock distingue el bloqueo de tasa vigente del vencido', () => conMundo(async (m) => {
  const v = await conOrden(m);
  const lock = (vars) => m.llamar('check_lock', vars, { edges: ['vigente', 'vencida'] });
  assert.equal((await lock(v)).next_edge, 'vigente');
  assert.equal((await lock({ lock_iso: '2020-01-01T00:00:00Z' })).next_edge, 'vencida');
  assert.equal((await lock({})).next_edge, 'vencida');
}));

test('orden_info: si faltan los datos de pago los lee de la última orden', () => conMundo(async (m) => {
  const v = await conOrden(m);
  const r = await m.llamar('orden_info', { operacion_id: 'BR-0001' });
  assert.equal(r.vars.pago_cuenta, v.pago_cuenta);
  assert.deepEqual((await m.llamar('orden_info', { pago_cuenta: 'ya-estaba' })).vars, {});
}));

const EDGES_E2 = ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'];
const EDGES_FOTO = ['subida', 'sin_foto', 'muy_grande', 'fallo_subida', 'escalar'];
const FOTO = (extra) => entrante({ has_media: true, message_type: 'image', whatsapp_message_id: 'wamid-1', media_url: 'http://waha/api/files/f.jpeg', mimetype: 'image/jpeg', ...extra });
const jpeg = (bytes = Buffer.from('JPEGDATA')) => async () => ({ bytes, mimetype: 'image/jpeg' });

test('proof_upload: sube la foto bajada de WAHA a proofs/<uid>/<orden>/ y guarda la ruta', () => conMundo(async (m) => {
  const pedidos = [];
  m.media.usar(async (p) => { pedidos.push(p); return { bytes: Buffer.from('JPEGDATA'), mimetype: 'image/jpeg' }; });
  const v = await conOrden(m);
  const r = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  assert.equal(r.next_edge, 'subida');
  assert.match(r.vars.proof_path, new RegExp(`^proofs/${m.almacen.sesionFirebase(T).uid}/BR-0001/proof-\\d+\\.jpg$`));
  assert.equal(m.falso.archivos.get(r.vars.proof_path).bytes.toString(), 'JPEGDATA');
  assert.deepEqual(pedidos, [{ chatId: CHAT, mensajeId: 'wamid-1', mediaUrl: 'http://waha/api/files/f.jpeg', mimetype: 'image/jpeg' }]);
  assert.equal(r.vars.fallos_comprobante, 0);
}));

test('proof_upload: sin foto, tipo no permitido o descarga fallida cuentan como fallo y el segundo escala', () => conMundo(async (m) => {
  const v = await conOrden(m);
  const sinMedia = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: entrante({ has_media: false, message_type: 'text' }) });
  assert.equal(sinMedia.next_edge, 'sin_foto');
  const otra = await m.llamar('proof_upload', { ...v, ...sinMedia.vars }, { edges: EDGES_FOTO, wa: entrante({ has_media: false, message_type: 'text' }) });
  assert.equal(otra.next_edge, 'escalar');
  m.media.usar(async () => ({ bytes: Buffer.from('v'), mimetype: 'video/mp4' }));
  assert.equal((await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() })).next_edge, 'sin_foto');
  m.media.usar(async () => null);
  assert.equal((await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() })).next_edge, 'sin_foto');
  assert.equal(m.falso.archivos.size, 0);
}));

test('proof_upload: más de 8 MB es muy_grande y un rechazo de Storage es fallo_subida', () => conMundo(async (m) => {
  const v = await conOrden(m);
  m.media.usar(jpeg(Buffer.alloc(8 * 1024 * 1024)));
  assert.equal((await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() })).next_edge, 'muy_grande');
  m.media.usar(jpeg());
  assert.equal((await m.llamar('proof_upload', { ...v, operacion_id: 'BR-0001' }, { edges: EDGES_FOTO, wa: FOTO() })).next_edge, 'subida');
  const ajena = await m.llamar('proof_upload', { ...v, operacion_id: '../otra' }, { edges: EDGES_FOTO, wa: FOTO() });
  assert.ok(['fallo_subida', 'subida'].includes(ajena.next_edge));
}));

test('proof_submit: registra el pago, abre el seguimiento y la orden pasa a validating', () => conMundo(async (m) => {
  m.media.usar(jpeg());
  const v = await conOrden(m);
  const foto = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  const val = (await m.llamar('validate:operacion', { operacion_raw: 'ab-1234' }, { edges: ['valido', 'invalido', 'escalar'] })).vars;
  const r = await m.llamar('proof_submit', { ...v, ...foto.vars, ...val }, { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  assert.equal(r.next_edge, 'ok');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
  assert.equal(m.falso.ordenes.get('BR-0001').operationNo, 'AB-1234');
  const seg = m.almacen.seguimiento('BR-0001');
  assert.deepEqual([seg.telefono, seg.chatId, seg.cerrado], [T, CHAT, 0]);
}));

test('proof_submit: número duplicado, foto que no está y comprobante ya recibido', () => conMundo(async (m) => {
  m.media.usar(jpeg());
  const E = ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'];
  const v = await conOrden(m);
  const foto = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  const base = { ...v, ...foto.vars, operacion_no: 'AB-1234' };
  assert.equal((await m.llamar('proof_submit', { ...base, proof_path: `${foto.vars.proof_path}.inexistente` }, { edges: E })).next_edge, 'sin_subida');
  assert.equal((await m.llamar('proof_submit', { ...base, operacion_no: '12' }, { edges: E })).next_edge, 'invalido');
  assert.equal((await m.llamar('proof_submit', base, { edges: E })).next_edge, 'ok');
  assert.equal((await m.llamar('proof_submit', base, { edges: E })).next_edge, 'ya_recibido'); // order-not-pending, pero la orden ya está en validating
  // segunda orden con el mismo número de operación
  const q = (await m.llamar('quote_create', COTIZACION, { edges: OK })).vars;
  const o2 = (await m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS }, { edges: EDGES_E2 })).vars;
  const f2 = await m.llamar('proof_upload', o2, { edges: EDGES_FOTO, wa: FOTO() });
  assert.equal((await m.llamar('proof_submit', { ...o2, ...f2.vars, operacion_no: 'AB-1234' }, { edges: E })).next_edge, 'duplicado');
}));

test('proof_submit: si la respuesta se pierde por un timeout, confirma leyendo la orden y no la da por perdida', () => conMundo(async (m) => {
  m.media.usar(jpeg());
  const v = await conOrden(m);
  const foto = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  m.falso.demorar('/fn/submitproof', 400, { despuesDeEfecto: true });
  const r = await m.llamar('proof_submit', { ...v, ...foto.vars, operacion_no: 'AB-1234' }, { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  assert.equal(r.next_edge, 'ok');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
}, { timeoutMs: 80 }));

test('cancel_order cancela la orden pendiente y tolera que ya no lo esté', () => conMundo(async (m) => {
  const v = await conOrden(m);
  assert.deepEqual((await m.llamar('cancel_order', v)).vars, { estado: 'cancelled' });
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'cancelled');
  assert.deepEqual((await m.llamar('cancel_order', v)).vars, { estado: 'cancelled' }); // ya cancelada: no es un error para el cliente
}));

test('handoff_to_human: abre el ticket con un resumen sin datos personales y recuerda que está atendido', () => conMundo(async (m) => {
  const v = await conOrden(m);
  const r = await m.llamar('handoff_to_human:cliente_pide_persona', { ...v, monto_txt: '500.00' });
  assert.equal(r.vars.cola_texto, ' Estás en la posición 1 (espera aproximada: 3 min).');
  const ticket = [...m.falso.tickets.values()][0];
  assert.match(ticket.summary, /cliente_pide_persona/);
  assert.match(ticket.summary, /BR-0001/);
  assert.ok(!ticket.summary.includes('52998224725') && !ticket.summary.includes('ana@example.com'));
  assert.equal(ticket.channel, 'whatsapp');
  assert.ok(await m.almacen.kvEnv().get(`handoff:${T}`, 'json'));
}));

test('get_status: sin orden → e1; pendiente → e3 con sus datos; en validación → estado', () => conMundo(async (m) => {
  const E = ['e1', 'e3', 'estado', 'escalada'];
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'e1');
  const v = await conOrden(m);
  const pend = await m.llamar('get_status', {}, { edges: E });
  assert.equal(pend.next_edge, 'e3');
  assert.equal(pend.vars.operacion_id, 'BR-0001');
  assert.equal(pend.vars.pago_cuenta, v.pago_cuenta);
  m.media.usar(jpeg());
  const foto = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  await m.llamar('proof_submit', { ...v, ...foto.vars, operacion_no: 'AB-1234' }, { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  const val = await m.llamar('get_status', {}, { edges: E });
  assert.equal(val.next_edge, 'estado');
  assert.equal(val.vars.estado_texto, 'en validación: una persona revisa tu pago');
  m.falso.aprobar('BR-0001');
  assert.match((await m.llamar('get_status', {}, { edges: E })).vars.estado_texto, /^verificada/);
}));

test('get_status: una orden con seguimiento cerrado o cancelada deja empezar de nuevo; un ticket abierto escala', () => conMundo(async (m) => {
  const E = ['e1', 'e3', 'estado', 'escalada'];
  const v = await conOrden(m);
  m.almacen.abrirSeguimiento({ ordenId: 'BR-0001', telefono: T, chatId: CHAT, creado: '2026-10-13T10:00:00.000Z' });
  m.almacen.actualizarSeguimiento('BR-0001', { cerrado: 1 });
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'e1');
  await m.llamar('cancel_order', v);
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'e1');
  await m.llamar('handoff_to_human:x', {});
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'escalada');
  [...m.falso.tickets.values()][0].status = 'closed';
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'e1');
  assert.equal(await m.almacen.kvEnv().get(`handoff:${T}`, 'json'), null); // el marcador se limpió
}));

test('route_evento enruta por el evento del vigilante', () => conMundo(async (m) => {
  const r = (evento) => m.llamar('route_evento', { evento }, { edges: ['aprobada', 'rechazada', 'otro'] }).then((x) => x.next_edge);
  assert.deepEqual([await r('aprobada'), await r('rechazada'), await r('otra')], ['aprobada', 'rechazada', 'otro']);
}));

test('las acciones genéricas se delegan al simulador y una arista no declarada es un error visible', () => conMundo(async (m) => {
  const r = await m.llamar('check_extraction', COTIZACION, { edges: ['completa', 'incompleta'] });
  assert.equal(r.next_edge, 'completa');
  assert.equal((await m.llamar('validate:monto', { monto_raw: '1.500,50' }, { edges: ['valido', 'invalido', 'escalar'] })).vars.monto, 1500.5);
  await assert.rejects(() => m.llamar('route_evento', { evento: 'aprobada' }, { edges: ['rechazada'] }), /edge_no_declarado/);
}));
