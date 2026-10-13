const test = require('node:test');
const assert = require('node:assert/strict');
const { handler, parseMonto, normMoneda } = require('./brasper-api.js');

class MemKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { const v = this.m.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
}

const TEL = '51944686794';
function mundo() {
  const env = { KV: new MemKV() };
  const call = async (action, { vars = {}, edges = [], phone = TEL, ahora, wa } = {}) => {
    const body = {
      action,
      execution_context: { vars: { ...vars, ...(ahora ? { simular_ahora: ahora } : {}) }, context: { phone_number: `+${phone}` } },
      available_edges: edges,
      whatsapp_context: wa,
    };
    const res = await handler(new Request('http://f/x', { method: 'POST', body: JSON.stringify(body) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  return { env, call };
}
const entrante = (extra) => ({ messages: [{ direction: 'inbound', created_at: '2026-10-12T15:00:00Z', ...extra }] });
const COTIZACION = { monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' };

test('parseMonto entiende formatos habituales', () => {
  assert.equal(parseMonto('500'), 500);
  assert.equal(parseMonto('500 reales'), 500);
  assert.equal(parseMonto('1.500,50'), 1500.5);
  assert.equal(parseMonto('1,500.50'), 1500.5);
  assert.equal(parseMonto('1.500'), 1500);
  assert.equal(parseMonto('500,5'), 500.5);
  assert.equal(parseMonto('0'), null);
  assert.equal(parseMonto('abc'), null);
  assert.equal(parseMonto(undefined), null);
});

test('normMoneda acepta alias con y sin acentos', () => {
  assert.equal(normMoneda('reales'), 'BRL');
  assert.equal(normMoneda('Soles'), 'PEN');
  assert.equal(normMoneda('dólares'), 'USD');
  assert.equal(normMoneda('euros'), null);
});

test('acción desconocida devuelve 400', async () => {
  const { call } = mundo();
  const r = await call('no_existe');
  assert.equal(r.status, 400);
});

test('validate:dni_cpf distingue DNI y CPF y escala al segundo fallo', async () => {
  const { call } = mundo();
  const E = ['valido', 'invalido', 'escalar'];
  const dni = await call('validate:dni_cpf', { vars: { dni_raw: '12345678' }, edges: E });
  assert.equal(dni.next_edge, 'valido');
  assert.equal(dni.vars.tipo_doc, 'DNI');
  const cpf = await call('validate:dni_cpf', { vars: { dni_raw: '123.456.789-09' }, edges: E });
  assert.equal(cpf.vars.tipo_doc, 'CPF');
  assert.equal(cpf.vars.dni_cpf, '12345678909');
  const f1 = await call('validate:dni_cpf', { vars: { dni_raw: '123' }, edges: E });
  assert.equal(f1.next_edge, 'invalido');
  assert.equal(f1.vars.fallos_dni_cpf, 1);
  const f2 = await call('validate:dni_cpf', { vars: { dni_raw: '12', fallos_dni_cpf: 1 }, edges: E });
  assert.equal(f2.next_edge, 'escalar');
});

test('un dato válido reinicia el contador de fallos', async () => {
  const { call } = mundo();
  const r = await call('validate:monto', { vars: { monto_raw: '500', fallos_monto: 1 }, edges: ['valido', 'invalido', 'escalar'] });
  assert.equal(r.next_edge, 'valido');
  assert.equal(r.vars.fallos_monto, 0);
  assert.equal(r.vars.monto, 500);
});

test('validate:numero_cuenta y n_operacion exigen solo dígitos', async () => {
  const { call } = mundo();
  const E = ['valido', 'invalido', 'escalar'];
  const cta = await call('validate:numero_cuenta', { vars: { numero_cuenta_raw: '1234 5678 4821' }, edges: E });
  assert.equal(cta.vars.cuenta_ultimos4, '4821');
  assert.equal((await call('validate:numero_cuenta', { vars: { numero_cuenta_raw: 'abc' }, edges: E })).next_edge, 'invalido');
  assert.equal((await call('validate:n_operacion', { vars: { n_operacion_raw: '000123' }, edges: E })).next_edge, 'valido');
  assert.equal((await call('validate:n_operacion', { vars: { n_operacion_raw: '12' }, edges: E })).next_edge, 'invalido');
});

test('route_reply devuelve el id del botón y escala tras dos respuestas inválidas', async () => {
  const { call } = mundo();
  const E = ['continuar', 'cambiar_monto', 'persona', 'invalido', 'escalar'];
  const ok = await call('route_reply:accion_e1', { edges: E, wa: entrante({ reply_option_id: 'cambiar_monto' }) });
  assert.equal(ok.next_edge, 'cambiar_monto');
  assert.equal(ok.vars.accion_e1, 'cambiar_monto');
  const f1 = await call('route_reply:accion_e1', { edges: E, wa: entrante({ content: 'hola' }) });
  assert.equal(f1.next_edge, 'invalido');
  const f2 = await call('route_reply:accion_e1', { vars: { fallos_accion_e1: 1 }, edges: E, wa: entrante({ content: 'cancelar' }) });
  assert.equal(f2.next_edge, 'escalar');
});

test('media:comprobante acepta imagen o documento y repite si llega texto', async () => {
  const { call } = mundo();
  const E = ['foto', 'sin_foto', 'escalar'];
  const img = await call('media:comprobante', { edges: E, wa: entrante({ has_media: true, message_type: 'image', whatsapp_message_id: 'wamid.1' }) });
  assert.equal(img.next_edge, 'foto');
  assert.equal(img.vars.comprobante_msg_id, 'wamid.1');
  const txt = await call('media:comprobante', { edges: E, wa: entrante({ message_type: 'text', content: '000123' }) });
  assert.equal(txt.next_edge, 'sin_foto');
  const txt2 = await call('media:comprobante', { vars: { fallos_comprobante: 1 }, edges: E, wa: entrante({ message_type: 'text' }) });
  assert.equal(txt2.next_edge, 'escalar');
});

test('check_extraction normaliza alias y exige monedas distintas', async () => {
  const { call } = mundo();
  const E = ['completa', 'incompleta'];
  const ok = await call('check_extraction', { vars: { monto: '500', moneda_origen: 'reales', moneda_destino: 'Soles' }, edges: E });
  assert.deepEqual([ok.next_edge, ok.vars.moneda_origen, ok.vars.moneda_destino, ok.vars.monto], ['completa', 'BRL', 'PEN', 500]);
  assert.equal((await call('check_extraction', { vars: { monto: 500, moneda_origen: 'BRL' }, edges: E })).next_edge, 'incompleta');
  assert.equal((await call('check_extraction', { vars: { monto: 500, moneda_origen: 'BRL', moneda_destino: 'reales' }, edges: E })).next_edge, 'incompleta');
  assert.equal((await call('check_extraction', { vars: {}, edges: E })).next_edge, 'incompleta');
});

test('get_rate_quote calcula con datos de demostración y fija 15 minutos de vigencia', async () => {
  const { call } = mundo();
  const E = ['ok', 'sin_servicio', 'par_invalido'];
  const r = await call('get_rate_quote', { vars: COTIZACION, edges: E, ahora: '2026-10-12T15:00:00Z' });
  assert.equal(r.next_edge, 'ok');
  assert.equal(r.vars.recibe_txt, '350.00');
  assert.equal(r.vars.comision_txt, '5.00');
  assert.equal(r.vars.total_enviar_txt, '505.00');
  assert.equal(r.vars.tasa_txt, '0.7');
  assert.equal(r.vars.tasa_hasta, '10:15');
  assert.equal(r.vars.tasa_hasta_iso, '2026-10-12T15:15:00.000Z');
});

test('get_rate_quote: servicio caído y par inválido no inventan tasa', async () => {
  const { call } = mundo();
  const E = ['ok', 'sin_servicio', 'par_invalido'];
  const caido = await call('get_rate_quote', { vars: { ...COTIZACION, simular_tasas_caidas: true }, edges: E });
  assert.equal(caido.next_edge, 'sin_servicio');
  assert.equal(caido.vars.tasa, undefined);
  assert.equal((await call('get_rate_quote', { vars: { ...COTIZACION, moneda_destino: 'BRL' }, edges: E })).next_edge, 'par_invalido');
  assert.equal((await call('get_rate_quote', { vars: { ...COTIZACION, monto: 0 }, edges: E })).next_edge, 'par_invalido');
});

test('check_tasa distingue tasa vigente y vencida', async () => {
  const { call } = mundo();
  const E = ['vigente', 'vencida'];
  const vars = { tasa_hasta_iso: '2026-10-12T15:15:00.000Z' };
  assert.equal((await call('check_tasa', { vars, edges: E, ahora: '2026-10-12T15:10:00Z' })).next_edge, 'vigente');
  assert.equal((await call('check_tasa', { vars, edges: E, ahora: '2026-10-12T15:20:00Z' })).next_edge, 'vencida');
  assert.equal((await call('check_tasa', { vars: {}, edges: E })).next_edge, 'vencida');
});

test('check_hours usa el horario de Lima y dice cuándo se verifica', async () => {
  const { call } = mundo();
  const E = ['abierto', 'cerrado'];
  const dom10 = await call('check_hours', { edges: E, ahora: '2026-10-11T15:00:00Z' }); // domingo 10:00 Lima
  assert.equal(dom10.next_edge, 'cerrado');
  assert.equal(dom10.vars.proxima_verificacion, 'hoy a las 12:00 p. m.');
  const dom15 = await call('check_hours', { edges: E, ahora: '2026-10-11T20:00:00Z' }); // domingo 15:00 Lima
  assert.equal(dom15.vars.proxima_verificacion, 'mañana a las 7:00 a. m.');
  const sab15 = await call('check_hours', { edges: E, ahora: '2026-10-10T20:00:00Z' }); // sábado 15:00 Lima
  assert.equal(sab15.vars.proxima_verificacion, 'mañana a las 12:00 p. m.');
  const lun6 = await call('check_hours', { edges: E, ahora: '2026-10-12T11:00:00Z' }); // lunes 06:00 Lima
  assert.equal(lun6.vars.proxima_verificacion, 'hoy a las 7:00 a. m.');
  assert.equal((await call('check_hours', { edges: E, ahora: '2026-10-12T17:00:00Z' })).next_edge, 'abierto'); // lunes 12:00 Lima
});

test('check_window: abierta solo si el cliente escribió hace menos de 23 h', async () => {
  const { call } = mundo();
  const E = ['abierta', 'cerrada'];
  assert.equal((await call('check_window', { edges: E })).next_edge, 'cerrada');
  await call('get_status', { edges: ['e1', 'e3', 'estado', 'escalada'], wa: entrante({ created_at: '2026-10-12T15:00:00Z' }) });
  assert.equal((await call('check_window', { edges: E, ahora: '2026-10-12T20:00:00Z' })).next_edge, 'abierta');
  assert.equal((await call('check_window', { edges: E, ahora: '2026-10-13T16:00:00Z' })).next_edge, 'cerrada');
});

test('clientes y cuentas: seed, get_client, save_account', async () => {
  const { call } = mundo();
  const E = ['con_cuenta', 'sin_cuenta'];
  const antes = await call('get_client', { vars: { moneda_destino: 'PEN' }, edges: E });
  assert.equal(antes.next_edge, 'sin_cuenta');
  await call('seed_demo');
  const seed = await call('get_client', { vars: { moneda_destino: 'PEN' }, edges: E });
  assert.deepEqual([seed.next_edge, seed.vars.cuenta_banco, seed.vars.cuenta_ultimos4], ['con_cuenta', 'Scotiabank', '9956']);
  assert.equal((await call('get_client', { vars: { moneda_destino: 'BRL' }, edges: E })).next_edge, 'sin_cuenta');
  const nueva = await call('save_account', { vars: { cuenta_banco_nuevo: 'BCP', cuenta_numero_nuevo: '19412345678904821', moneda_destino: 'BRL' } });
  assert.equal(nueva.vars.cuenta_ultimos4, '4821');
  assert.equal((await call('get_client', { vars: { moneda_destino: 'BRL' }, edges: E })).vars.cuenta_banco, 'BCP');
  assert.equal((await call('list_accounts')).vars.cuentas.length, 2);
});

test('ciclo de una operación: crear, mostrar cuenta, adjuntar comprobante, verificar', async () => {
  const { call } = mundo();
  const R = ['e1', 'e3', 'estado', 'escalada'];
  assert.equal((await call('get_status', { edges: R })).next_edge, 'e1');
  const vars = { ...COTIZACION, recibe_txt: '350.00', total_enviar_txt: '505.00', banco_origen: 'BCP', cuenta_ultimos4: '9956' };
  const op = await call('create_operation', { vars });
  assert.equal(op.vars.operacion_id, 'BR-0001');
  assert.equal(op.vars.estado, 'pendiente');
  const e3 = await call('get_status', { edges: R });
  assert.equal(e3.next_edge, 'e3');
  assert.equal(e3.vars.operacion_id, 'BR-0001');
  assert.equal(e3.vars.total_enviar_txt, '505.00');
  const cta = await call('get_company_account', { vars: { operacion_id: 'BR-0001', moneda_origen: 'BRL', banco_origen: 'BCP' } });
  assert.deepEqual([cta.vars.brasper_titular, cta.vars.brasper_banco, cta.vars.brasper_cuenta], ['BrasPer (DEMO)', 'BCP', 'DEMO-BRL-0001']);
  await call('attach_proof', { vars: { operacion_id: 'BR-0001', comprobante_msg_id: 'wamid.1', n_operacion_bancaria: '000123' } });
  const val = await call('get_status', { edges: R });
  assert.equal(val.next_edge, 'estado');
  assert.equal(val.vars.estado, 'en_validacion');
  assert.match(val.vars.estado_texto, /una persona revisa tu pago/);
  await call('set_status', { vars: { operacion_id: 'BR-0001', estado: 'verificada' } });
  const op2 = await call('get_operation', { vars: { operacion_id: 'BR-0001' } });
  assert.deepEqual([op2.vars.estado, op2.vars.recibe_txt], ['verificada', '350.00']);
  assert.equal((await call('route_estado', { vars: { estado: 'verificada' }, edges: ['verificada', 'rechazada', 'otro'] })).next_edge, 'verificada');
  assert.equal((await call('route_estado', { vars: { estado: 'rechazada' }, edges: ['verificada', 'rechazada', 'otro'] })).next_edge, 'rechazada');
  assert.equal((await call('route_estado', { vars: { estado: 'en_validacion' }, edges: ['verificada', 'rechazada', 'otro'] })).next_edge, 'otro');
});

test('operaciones sucesivas incrementan el id y cancelar libera al cliente', async () => {
  const { call } = mundo();
  const R = ['e1', 'e3', 'estado', 'escalada'];
  await call('create_operation', { vars: COTIZACION });
  const dos = await call('create_operation', { vars: COTIZACION });
  assert.equal(dos.vars.operacion_id, 'BR-0002');
  await call('cancel_operation', { vars: { operacion_id: 'BR-0002' } });
  assert.equal((await call('get_status', { edges: R })).next_edge, 'e1');
});

test('handoff_to_human marca la operación como escalada y get_status lo refleja', async () => {
  const { call } = mundo();
  const R = ['e1', 'e3', 'estado', 'escalada'];
  await call('create_operation', { vars: COTIZACION });
  const h = await call('handoff_to_human:tasas_no_disponibles', { vars: { operacion_id: 'BR-0001' } });
  assert.equal(h.vars.escalada, true);
  assert.equal((await call('get_status', { edges: R })).next_edge, 'escalada');
});

test('get_rate_quote actualiza la cotización de la operación al recotizar', async () => {
  const { call } = mundo();
  await call('create_operation', { vars: { ...COTIZACION, tasa_txt: '0.7' } });
  await call('get_rate_quote', { vars: { ...COTIZACION, operacion_id: 'BR-0001', monto: 1000 }, edges: ['ok', 'sin_servicio', 'par_invalido'], ahora: '2026-10-12T15:00:00Z' });
  const op = await call('get_operation', { vars: { operacion_id: 'BR-0001' } });
  assert.equal(op.vars.recibe_txt, '700.00');
});

test('check_continue y reset_demo', async () => {
  const { call } = mundo();
  assert.equal((await call('check_continue', { vars: { continuar: 'si' }, edges: ['seguir', 'fin'] })).next_edge, 'seguir');
  assert.equal((await call('check_continue', { vars: { continuar: 'no' }, edges: ['seguir', 'fin'] })).next_edge, 'fin');
  await call('create_operation', { vars: COTIZACION });
  await call('reset_demo');
  assert.equal((await call('get_status', { edges: ['e1', 'e3', 'estado', 'escalada'] })).next_edge, 'e1');
});

test('si la función devuelve una arista no declarada, responde 500 en vez de enrutar mal', async () => {
  const { call } = mundo();
  const r = await call('check_continue', { vars: { continuar: 'si' }, edges: ['otra'] });
  assert.equal(r.status, 500);
  assert.equal(r.error, 'edge_no_declarado');
});

test('set_status rechaza estados inválidos y operaciones inexistentes', async () => {
  const { call } = mundo();
  assert.equal((await call('set_status', { vars: { operacion_id: 'BR-0009', estado: 'verificada' } })).status, 500);
  await call('create_operation', { vars: COTIZACION });
  assert.equal((await call('set_status', { vars: { operacion_id: 'BR-0001', estado: 'inventado' } })).status, 500);
});

test('el teléfono se normaliza: con y sin signo + apuntan al mismo cliente', async () => {
  const { call } = mundo();
  await call('seed_demo', { phone: '+51944686794' });
  const r = await call('get_client', { vars: { moneda_destino: 'PEN' }, edges: ['con_cuenta', 'sin_cuenta'], phone: '51944686794' });
  assert.equal(r.next_edge, 'con_cuenta');
});

test('route_moneda enruta por la moneda de la variable indicada', async () => {
  const { call } = mundo();
  const E = ['BRL', 'PEN', 'USD'];
  assert.equal((await call('route_moneda:moneda_origen', { vars: { moneda_origen: 'BRL' }, edges: E })).next_edge, 'BRL');
  assert.equal((await call('route_moneda:moneda_destino', { vars: { moneda_destino: 'soles' }, edges: E })).next_edge, 'PEN');
  assert.equal((await call('route_moneda:moneda_origen', { vars: { moneda_origen: 'usd' }, edges: E })).next_edge, 'USD');
  // moneda desconocida o ausente: no rompe el flujo, cae en la primera arista
  assert.equal((await call('route_moneda:moneda_origen', { vars: { moneda_origen: 'euros' }, edges: E })).next_edge, 'BRL');
  assert.equal((await call('route_moneda:moneda_origen', { edges: E })).next_edge, 'BRL');
});

test('parseMonto rechaza montos con multiplicadores en palabras y negativos', () => {
  assert.equal(parseMonto('2 mil'), null);
  assert.equal(parseMonto('3k'), null);
  assert.equal(parseMonto('-500'), null);
  assert.equal(parseMonto('1.500,50 reales'), 1500.5);
});

test('get_company_account no muestra "Otro" como banco de BrasPer', async () => {
  const { call } = mundo();
  const cta = await call('get_company_account', { vars: { moneda_origen: 'BRL', banco_origen: 'Otro' } });
  assert.equal(cta.vars.brasper_banco, 'Banco do Brasil');
  const pen = await call('get_company_account', { vars: { moneda_origen: 'PEN', banco_origen: 'Otro' } });
  assert.equal(pen.vars.brasper_banco, 'BCP');
});

test('complete_operation cierra la operación y libera al cliente para cotizar de nuevo', async () => {
  const { call } = mundo();
  const R = ['e1', 'e3', 'estado', 'escalada'];
  await call('create_operation', { vars: COTIZACION });
  await call('set_status', { vars: { operacion_id: 'BR-0001', estado: 'verificada' } });
  assert.equal((await call('get_status', { edges: R })).next_edge, 'estado');
  const r = await call('complete_operation', { vars: { operacion_id: 'BR-0001' } });
  assert.equal(r.vars.estado, 'completada');
  assert.equal((await call('get_status', { edges: R })).next_edge, 'e1');
});

test('horario de Lima: bordes de apertura y cierre', async () => {
  const { call } = mundo();
  const E = ['abierto', 'cerrado'];
  // 2026-10-12 es lunes. Lima = UTC-5.
  assert.equal((await call('check_hours', { edges: E, ahora: '2026-10-12T22:59:00Z' })).next_edge, 'abierto'); // 17:59
  assert.equal((await call('check_hours', { edges: E, ahora: '2026-10-12T23:00:00Z' })).next_edge, 'cerrado'); // 18:00
  assert.equal((await call('check_hours', { edges: E, ahora: '2026-10-12T12:00:00Z' })).next_edge, 'abierto'); // 07:00
  assert.equal((await call('check_hours', { edges: E, ahora: '2026-10-17T18:59:00Z' })).next_edge, 'abierto'); // sáb 13:59
  assert.equal((await call('check_hours', { edges: E, ahora: '2026-10-17T19:00:00Z' })).next_edge, 'cerrado'); // sáb 14:00
  assert.equal((await call('check_hours', { edges: E, ahora: '2026-10-18T19:00:00Z' })).next_edge, 'cerrado'); // dom 14:00
});

test('attach_proof guarda si la tasa había vencido al transferir', async () => {
  const { env, call } = mundo();
  await call('create_operation', { vars: COTIZACION });
  await call('attach_proof', { vars: { operacion_id: 'BR-0001', comprobante_msg_id: 'w1', n_operacion_bancaria: '1234', tasa_vencida: 'si' } });
  assert.equal((await env.KV.get('op:BR-0001', 'json')).proof.tasa_vencida, true);
  await call('create_operation', { vars: COTIZACION });
  await call('attach_proof', { vars: { operacion_id: 'BR-0002', comprobante_msg_id: 'w2', n_operacion_bancaria: '1234' } });
  assert.equal((await env.KV.get('op:BR-0002', 'json')).proof.tasa_vencida, false);
});
