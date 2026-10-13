// E4 v2 (lo lanza el vigilante con vars.evento) y el enrutador W0 v2.
const { Flow } = require('../../../../kapso/build/flow');
const { escalar } = require('./helpers');

function e4() {
  const f = new Flow('E4', 'BrasPer · E4 Estado (v2)', 'brasper-v2-e4-estado', 'Etapa 4: avisa al cliente cuando el personal decide sobre su pago. Lo lanza el vigilante.');
  f.start();
  f.api('ev', 'route_evento', { edges: ['aprobada', 'rechazada', 'otro'] });
  f.link('start', 'ev');
  f.text('aprobada', '✅ Pago verificado. Enviamos tu dinero a la cuenta ••{{vars.destino_ult4}}.');
  f.text('rech', 'No pudimos validar tu pago de la operación {{vars.operacion_id}}: {{vars.motivo}}.');
  f.setvar('nada', 'evento_ignorado', 'si');
  f.link('ev', 'aprobada', 'aprobada').link('ev', 'rech', 'rechazada').link('ev', 'nada', 'otro');
  f.link('rech', escalar(f, 'rech_esc', 'pago_no_validado', { mensaje: 'Una persona del equipo te contactará.' }));
  return f;
}

function w0() {
  const f = new Flow('W0', 'BrasPer · W0 Enrutador (v2)', 'brasper-v2-w0-enrutador', 'Enruta cada conversación nueva a la etapa que corresponde según el estado de la orden.');
  f.start();
  f.api('estado', 'get_status', { edges: ['e1', 'e3', 'estado', 'escalada'] });
  f.link('start', 'estado');
  f.call('c1', 'E1').api('sigue1', 'check_continue', { edges: ['seguir', 'fin'] });
  f.call('c2', 'E2').api('sigue2', 'check_continue', { edges: ['seguir', 'fin'] });
  f.call('c3', 'E3');
  f.setvar('fin', 'flujo_terminado', 'si');
  f.link('estado', 'c1', 'e1').link('c1', 'sigue1').link('sigue1', 'c2', 'seguir').link('c2', 'sigue2').link('sigue2', 'c3', 'seguir');
  f.link('sigue1', 'fin', 'fin').link('sigue2', 'fin', 'fin');
  f.link('estado', 'c3', 'e3');
  f.text('status', 'Tu operación {{vars.operacion_id}} está {{vars.estado_texto}}.');
  f.link('estado', 'status', 'estado');
  f.text('esc', 'Una persona del equipo ya está atendiendo tu caso.');
  f.link('estado', 'esc', 'escalada');
  return f;
}

module.exports = { e4, w0 };
