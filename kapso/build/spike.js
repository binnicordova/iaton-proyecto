// Workflows desechables para verificar supuestos de plataforma antes de publicar el flujo real (spike).
const { Flow, PHONE_NUMBER_ID } = require('./flow');
const { AGENTE_EXTRACCION, FORMULARIO_WEB } = require('./workflows');

const entrante = { trigger_type: 'inbound_message', phone_number_id: PHONE_NUMBER_ID, active: true };

// S1: ¿el agente de extracción escribe monto y monedas en variables sin enviar mensajes propios?
function s1() {
  const f = new Flow('S1', 'SPIKE · extracción', 'spike-extraccion');
  f.start();
  f.agent('extraer', AGENTE_EXTRACCION);
  f.text('resultado', 'S1 monto={{vars.monto}} origen={{vars.moneda_origen}} destino={{vars.moneda_destino}}');
  f.link('start', 'extraer').link('extraer', 'resultado');
  return f.trigger(entrante);
}

// S2: un workflow que llama a otro que espera respuesta. ¿El mensaje reanuda al hijo y el padre continúa al terminar?
function s2Hijo() {
  const f = new Flow('S2C', 'SPIKE · hijo', 'spike-hijo');
  f.start();
  f.text('pregunta', 'S2 hijo: dime algo');
  f.wait('espera', { save: 'dato' });
  f.text('recibido', 'S2 hijo: recibí {{vars.dato}}');
  f.link('start', 'pregunta').link('pregunta', 'espera').link('espera', 'recibido');
  return f;
}
function s2Padre() {
  const f = new Flow('S2P', 'SPIKE · padre', 'spike-padre');
  f.start();
  f.call('c', 'S2C');
  f.text('fin', 'S2 padre: el hijo terminó, dato={{vars.dato}}');
  f.link('start', 'c').link('c', 'fin');
  return f.trigger(entrante);
}

// S3: inicio por API y decisión por ventana de 24 h con la función real (check_window).
function s3() {
  const f = new Flow('S3', 'SPIKE · api', 'spike-api');
  f.start();
  f.api('ventana', 'check_window', { edges: ['abierta', 'cerrada'] });
  f.text('abierta', 'S3 API ok: ventana abierta, operación {{vars.operacion_id}}');
  f.setvar('cerrada', 'aviso_pendiente', 'plantilla_requerida');
  f.link('start', 'ventana').link('ventana', 'abierta', 'abierta').link('ventana', 'cerrada', 'cerrada');
  return f.trigger({ trigger_type: 'api_call', active: true });
}

// S4: botones, enlace y lista en el sandbox, y enrutado con la función real (route_reply como decide).
function s4() {
  const f = new Flow('S4', 'SPIKE · interactivos', 'spike-interactivos');
  f.start();
  f.buttons('botones', 'S4 prueba de botones', [{ id: 'a', title: 'Hablar con persona' }, { id: 'b', title: 'Cambiar monto' }, { id: 'c', title: 'Continuar' }]);
  f.cta('web', 'S4 prueba de enlace', 'Abrir formulario web', FORMULARIO_WEB);
  f.wait('espera1');
  f.api('ruta1', 'route_reply:eleccion', { edges: ['a', 'b', 'c', 'invalido', 'escalar'] });
  f.text('dijo', 'S4 botón elegido: {{vars.eleccion}}');
  f.text('mal1', 'S4 respuesta fuera de las opciones');
  f.list('lista', 'S4 prueba de lista', 'Elegir banco', [{ id: 'BCP', title: 'BCP' }, { id: 'Banco do Brasil', title: 'Banco do Brasil' }, { id: 'Otro', title: 'Otro' }]);
  f.wait('espera2');
  f.api('ruta2', 'route_reply:fila', { edges: ['BCP', 'Banco do Brasil', 'Otro', 'invalido', 'escalar'] });
  f.text('fila', 'S4 fila elegida: {{vars.fila}}');
  f.link('start', 'botones').link('botones', 'web').link('web', 'espera1').link('espera1', 'ruta1');
  f.linkAll('ruta1', 'dijo', ['a', 'b', 'c']).link('ruta1', 'mal1', 'invalido').link('ruta1', 'mal1', 'escalar');
  f.link('dijo', 'lista').link('lista', 'espera2').link('espera2', 'ruta2');
  f.linkAll('ruta2', 'fila', ['BCP', 'Banco do Brasil', 'Otro']).link('ruta2', 'fila', 'invalido').link('ruta2', 'fila', 'escalar');
  return f.trigger(entrante);
}

function buildSpike() {
  return { S1: s1(), S2C: s2Hijo(), S2P: s2Padre(), S3: s3(), S4: s4() };
}

module.exports = { buildSpike };
