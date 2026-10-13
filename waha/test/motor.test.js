const test = require('node:test');
const assert = require('node:assert/strict');
const { Flow } = require('../../kapso/build/flow');
const { abrirDb } = require('../src/estado/db');
const { crearMundo, msg } = require('./helpers/mundo');

const T = '51999999999';

const w0 = (armar) => { const f = new Flow('W0', 'W0', 'w0'); f.start(); armar(f); return { W0: f }; };

test('envía texto, espera y reanuda con la respuesta guardada; al terminar borra la ejecución', async () => {
  const flujos = w0((f) => {
    f.text('ask', '¿Nombre?').wait('w', { save: 'nombre' }).text('hi', 'Hola {{vars.nombre}}');
    f.link('start', 'ask').link('ask', 'w').link('w', 'hi');
  });
  const { motor, proveedor, almacen } = crearMundo({ flujos });
  await motor.procesarMensaje(msg(T, 'hola'));
  assert.deepEqual(proveedor.textos(), ['¿Nombre?']);
  assert.ok(almacen.cargarEjecucion(T).esperando);
  await motor.procesarMensaje(msg(T, 'Ana'));
  assert.deepEqual(proveedor.textos(), ['¿Nombre?', 'Hola Ana']);
  assert.equal(almacen.cargarEjecucion(T), null);
});

test('set_variable convierte float y resuelve plantillas', async () => {
  const flujos = w0((f) => {
    f.setvar('a', 'monto', '500', 'float').setvar('b', 'txt', 'S/ {{vars.monto}}').text('t', '{{vars.txt}}');
    f.link('start', 'a').link('a', 'b').link('b', 't');
  });
  const { motor, proveedor } = crearMundo({ flujos });
  await motor.procesarMensaje(msg(T, 'x'));
  assert.deepEqual(proveedor.textos(), ['S/ 500']);
});

test('function fusiona las variables devueltas y decide sigue la arista indicada', async () => {
  const flujos = w0((f) => {
    f.api('d', 'check_x', { edges: ['si', 'no'] }).text('si', 'camino sí').text('no', 'camino no');
    f.link('start', 'd').link('d', 'si', 'si').link('d', 'no', 'no');
  });
  const llamadas = [];
  const llamarFuncion = async (a) => { llamadas.push(a); return { vars: { visto: true }, next_edge: 'no' }; };
  const { motor, proveedor } = crearMundo({ flujos, llamarFuncion });
  await motor.procesarMensaje(msg(T, 'x'));
  assert.deepEqual(proveedor.textos(), ['camino no']);
  assert.equal(llamadas[0].vars.api_action, 'check_x');
  assert.deepEqual(llamadas[0].edges, ['si', 'no']);
  assert.equal(llamadas[0].phone, T);
});

test('call ejecuta el workflow hijo, comparte variables y vuelve al padre', async () => {
  const hijo = new Flow('E1', 'E1', 'e1'); hijo.start().setvar('s', 'continuar', 'si').text('t', 'en el hijo'); hijo.link('start', 's').link('s', 't');
  const padre = new Flow('W0', 'W0', 'w0'); padre.start().call('c', 'E1').api('k', 'check_continue', { edges: ['seguir', 'fin'] }).text('ok', 'volví');
  padre.link('start', 'c').link('c', 'k').link('k', 'ok', 'seguir');
  const llamarFuncion = async ({ vars }) => ({ vars: {}, next_edge: vars.continuar === 'si' ? 'seguir' : 'fin' });
  const { motor, proveedor } = crearMundo({ flujos: { W0: padre, E1: hijo }, llamarFuncion });
  await motor.procesarMensaje(msg(T, 'x'));
  assert.deepEqual(proveedor.textos(), ['en el hijo', 'volví']);
});

test('botones: el número o el título se traducen al id; el opcionId nativo pasa tal cual; lo ajeno da null', async () => {
  const flujos = w0((f) => {
    f.buttons('b', 'Elige', [{ id: 'continuar', title: 'Continuar' }, { id: 'persona', title: 'Hablar con persona' }]).wait('w');
    f.api('r', 'route_reply:x', { edges: ['continuar', 'persona', 'invalido'] }).text('fin', 'fin');
    f.link('start', 'b').link('b', 'w').link('w', 'r').link('r', 'fin', 'continuar').link('r', 'fin', 'persona').link('r', 'fin', 'invalido');
  });
  const vistos = [];
  const llamarFuncion = async ({ wa }) => { const m = wa.messages[wa.messages.length - 1]; vistos.push(m.reply_option_id); return { vars: {}, next_edge: 'invalido' }; };
  for (const [texto, extra, esperado] of [['2', {}, 'persona'], ['continuar', {}, 'continuar'], ['dame un rato', {}, null], ['', { opcionId: 'persona' }, 'persona']]) {
    const { motor } = crearMundo({ flujos, llamarFuncion });
    await motor.procesarMensaje(msg(T, 'inicio'));
    await motor.procesarMensaje(msg(T, texto, extra));
    assert.equal(vistos.pop(), esperado, `entrada "${texto}"`);
  }
});

test('el mensaje entrante llega a la función con los campos que brasper-api lee', async () => {
  const flujos = w0((f) => {
    f.wait('w').api('r', 'media:comprobante', { edges: ['foto'] }).text('t', 'ok');
    f.link('start', 'w').link('w', 'r').link('r', 't', 'foto');
  });
  let wa;
  const llamarFuncion = async (a) => { wa = a.wa; return { vars: {}, next_edge: 'foto' }; };
  const { motor } = crearMundo({ flujos, llamarFuncion });
  await motor.procesarMensaje(msg(T, 'inicio'));
  await motor.procesarMensaje(msg(T, '', { tieneMedia: true, tipoMensaje: 'image', mensajeId: 'wamid-foto' }));
  const m = wa.messages[wa.messages.length - 1];
  assert.equal(m.direction, 'inbound');
  assert.equal(m.has_media, true);
  assert.equal(m.message_type, 'image');
  assert.equal(m.whatsapp_message_id, 'wamid-foto');
  assert.equal(m.created_at, '2026-10-14T15:00:00.000Z');
});

test('handoff termina la conversación', async () => {
  const flujos = w0((f) => { f.text('t', 'te paso').handoff('h'); f.link('start', 't').link('t', 'h'); });
  const { motor, almacen } = crearMundo({ flujos });
  await motor.procesarMensaje(msg(T, 'x'));
  assert.equal(almacen.cargarEjecucion(T), null);
});

test('un bucle sin fin escala a persona en lugar de colgarse', async () => {
  const flujos = w0((f) => {
    f.setvar('a', 'x', '1').setvar('b', 'y', '2');
    f.link('start', 'a').link('a', 'b').link('b', 'a');
  });
  const llamadas = [];
  const { motor, proveedor, almacen } = crearMundo({ flujos, llamarFuncion: async (a) => { llamadas.push(a.vars.api_action); return { vars: {} }; } });
  await motor.procesarMensaje(msg(T, 'x'));
  assert.deepEqual(proveedor.textos(), ['Te paso con una persona del equipo para ayudarte.']);
  assert.deepEqual(llamadas, ['handoff_to_human:error_motor']);
  assert.equal(almacen.cargarEjecucion(T), null);
});

test('si la función falla, el cliente recibe el mensaje de persona y se registra el handoff', async () => {
  const flujos = w0((f) => { f.api('d', 'roto', { edges: ['a'] }); f.link('start', 'd'); });
  const acciones = [];
  const llamarFuncion = async ({ vars }) => { acciones.push(vars.api_action); if (vars.api_action === 'roto') throw new Error('brasper-api 500'); return { vars: {} }; };
  const { motor, proveedor } = crearMundo({ flujos, llamarFuncion });
  await motor.procesarMensaje(msg(T, 'x'));
  assert.deepEqual(proveedor.textos(), ['Te paso con una persona del equipo para ayudarte.']);
  assert.deepEqual(acciones, ['roto', 'handoff_to_human:error_motor']);
});

test('una arista que la función no declara es un error visible, no un salto silencioso', async () => {
  const flujos = w0((f) => { f.api('d', 'x', { edges: ['a'] }).text('t', 'a'); f.link('start', 'd').link('d', 't', 'a'); });
  const { motor, proveedor } = crearMundo({ flujos, llamarFuncion: async () => ({ vars: {}, next_edge: 'zzz' }) });
  await motor.procesarMensaje(msg(T, 'x'));
  assert.deepEqual(proveedor.textos(), ['Te paso con una persona del equipo para ayudarte.']);
});

test('REVIEW 3: dos mensajes seguidos del mismo teléfono se procesan en orden', async () => {
  const flujos = w0((f) => {
    f.text('uno', 'uno').wait('w1', { save: 'a' }).text('ra', 'A={{vars.a}}').wait('w2', { save: 'b' }).text('rb', 'B={{vars.b}}');
    f.link('start', 'uno').link('uno', 'w1').link('w1', 'ra').link('ra', 'w2').link('w2', 'rb');
  });
  const { motor, proveedor } = crearMundo({ flujos });
  await Promise.all([motor.procesarMensaje(msg(T, 'inicio')), motor.procesarMensaje(msg(T, 'x')), motor.procesarMensaje(msg(T, 'y'))]);
  assert.deepEqual(proveedor.textos(), ['uno', 'A=x', 'B=y']);
});

test('REVIEW 4: un motor nuevo sobre la misma base retoma la conversación donde quedó', async () => {
  const flujos = w0((f) => {
    f.text('ask', '¿Nombre?').wait('w', { save: 'nombre' }).text('hi', 'Hola {{vars.nombre}}');
    f.link('start', 'ask').link('ask', 'w').link('w', 'hi');
  });
  const db = abrirDb(':memory:');
  const antes = crearMundo({ flujos, db });
  await antes.motor.procesarMensaje(msg(T, 'inicio'));
  const despues = crearMundo({ flujos, db }); // "reinicio" del servidor
  await despues.motor.procesarMensaje(msg(T, 'Luz'));
  assert.deepEqual(despues.proveedor.textos(), ['Hola Luz']);
});

test('iniciar arranca un workflow por API, pero no si el cliente está en medio de una conversación', async () => {
  const e4 = new Flow('E4', 'E4', 'e4'); e4.start().text('t', 'aviso {{vars.operacion_id}}'); e4.link('start', 't');
  const w = w0((f) => { f.wait('w'); f.link('start', 'w'); });
  const { motor, proveedor } = crearMundo({ flujos: { ...w, E4: e4 } });
  assert.deepEqual(await motor.iniciar('E4', T, `${T}@c.us`, { operacion_id: 'BR-0001' }), { iniciado: true });
  assert.deepEqual(proveedor.textos(), ['aviso BR-0001']);
  await motor.procesarMensaje(msg(T, 'hola')); // queda esperando
  assert.deepEqual(await motor.iniciar('E4', T, `${T}@c.us`, {}), { iniciado: false, motivo: 'ocupado' });
});

test('agent: extrae del último mensaje y fusiona los datos en las variables', async () => {
  const flujos = w0((f) => {
    f.agent('ag', { system_prompt: 'x' }).text('t', '{{vars.monto}} {{vars.moneda_origen}}');
    f.link('start', 'ag').link('ag', 't');
  });
  const textos = [];
  const extraer = async (texto) => { textos.push(texto); return { monto: 500, moneda_origen: 'BRL' }; };
  const { motor, proveedor } = crearMundo({ flujos, extraer });
  await motor.procesarMensaje(msg(T, 'quiero enviar 500 reales'));
  assert.deepEqual(textos, ['quiero enviar 500 reales']);
  assert.deepEqual(proveedor.textos(), ['500 BRL']);
});

test('lista seguida de un enlace conserva las opciones de la lista para interpretar el texto', async () => {
  const flujos = w0((f) => {
    f.list('l', 'Banco', 'Elegir', [{ id: 'BCP', title: 'BCP' }, { id: 'Otro', title: 'Otro' }]).cta('c', 'Web', 'Abrir', 'https://brasper.com/es').wait('w');
    f.api('r', 'route_reply:b', { edges: ['BCP', 'Otro'] }).text('t', 'ok');
    f.link('start', 'l').link('l', 'c').link('c', 'w').link('w', 'r').link('r', 't', 'BCP').link('r', 't', 'Otro');
  });
  let id;
  const { motor } = crearMundo({ flujos, llamarFuncion: async ({ wa }) => { id = wa.messages.at(-1).reply_option_id; return { vars: {}, next_edge: 'BCP' }; } });
  await motor.procesarMensaje(msg(T, 'inicio'));
  await motor.procesarMensaje(msg(T, '2'));
  assert.equal(id, 'Otro');
});
