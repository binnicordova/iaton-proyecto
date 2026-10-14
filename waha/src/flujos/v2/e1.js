// E1 v2: extrae monto y monedas, cotiza en el backend real y ofrece continuar.
const { Flow } = require('../../../../kapso/build/flow');
const { AGENTE_EXTRACCION } = require('../../../../kapso/build/workflows');
const { MSG_SIN_TASAS, FORMULARIO_WEB, MONEDAS, MONEDAS_BTN, escalar, pregunta, elegir } = require('./helpers');

function e1() {
  const f = new Flow('E1', 'BrasPer · E1 Cotiza (v2)', 'brasper-v2-e1-cotiza', 'Etapa 1: extrae monto y monedas, cotiza con el backend y ofrece continuar.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.agent('extraer', AGENTE_EXTRACCION);
  f.link('init', 'extraer');
  f.api('verifica', 'check_extraction', { edges: ['completa', 'incompleta'] });
  f.link('extraer', 'verifica');
  f.api('cotiza', 'quote_create', { edges: ['ok', 'sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona'] });
  f.link('verifica', 'cotiza', 'completa');

  // Respaldo: el mensaje no trae los tres datos.
  const mo = elegir(f, 'mo', { tipo: 'buttons', body: '¡Hola! Soy el asistente de BrasPer. ¿Qué moneda quieres enviar?', opciones: MONEDAS_BTN, variable: 'moneda_origen', motivo: 'moneda_origen' });
  const md = elegir(f, 'md', { tipo: 'buttons', body: '¿En qué moneda recibe tu destinatario?', opciones: MONEDAS_BTN, variable: 'moneda_destino', motivo: 'moneda_destino' });
  const monto = pregunta(f, 'monto', { prompt: '¿Cuánto quieres enviar? Escribe solo el monto.', guardar: 'monto_raw', validar: 'monto', error: 'No entendí el monto. Escribe solo el número, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('verifica', mo.entrada, 'incompleta');
  f.linkAll(mo.ruta, md.entrada, MONEDAS);
  f.linkAll(md.ruta, monto.entrada, MONEDAS);
  f.link(monto.salida, 'cotiza', 'valido');

  // Resultados de la cotización.
  f.text('par_err', 'Esa combinación de monedas no está disponible. Elige otras.');
  f.link('cotiza', 'par_err', 'par_invalido').link('par_err', mo.entrada);
  f.text('bajo', 'Ese monto es menor al mínimo (unos 10 USD equivalentes). Escribe un monto mayor.');
  f.link('cotiza', 'bajo', 'monto_bajo').link('bajo', monto.entrada);
  f.link('cotiza', escalar(f, 'tasas', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS }), 'sin_servicio');
  f.link('cotiza', escalar(f, 'grande', 'monto_grande', { mensaje: 'Por el monto, te paso con una persona del equipo para ayudarte.' }), 'requiere_persona');
  f.buttons('oferta', '¡Hola! Hoy 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}. Comisión {{vars.comision_txt}} + impuesto {{vars.impuesto_txt}} {{vars.moneda_origen}}. Total a transferir {{vars.total_enviar_txt}} {{vars.moneda_origen}}. Recibirás {{vars.recibe_txt}} {{vars.moneda_destino}}. Tasa asegurada hasta las {{vars.tasa_hasta}}', [
    { id: 'continuar', title: 'Continuar' }, { id: 'cambiar_monto', title: 'Cambiar monto' }, { id: 'persona', title: 'Hablar con persona' },
  ]);
  f.cta('web', '¿Prefieres hacerlo desde la web?', 'Abrir formulario web', FORMULARIO_WEB);
  f.wait('oferta_wait');
  f.api('oferta_route', 'route_reply:accion_e1', { edges: ['continuar', 'cambiar_monto', 'persona', 'invalido', 'escalar'] });
  f.link('cotiza', 'oferta', 'ok').link('oferta', 'web').link('web', 'oferta_wait').link('oferta_wait', 'oferta_route');
  f.link('oferta_route', 'oferta', 'invalido');
  f.link('oferta_route', escalar(f, 'oferta_esc', 'oferta_sin_respuesta'), 'escalar');
  f.link('oferta_route', escalar(f, 'persona', 'cliente_pide_persona'), 'persona');
  const m2 = pregunta(f, 'monto2', { prompt: '¿Cuánto quieres enviar? Escribe solo el monto.', guardar: 'monto_raw', validar: 'monto', error: 'No entendí el monto. Escribe solo el número, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('oferta_route', m2.entrada, 'cambiar_monto');
  f.link(m2.salida, 'cotiza', 'valido');
  f.setvar('listo', 'continuar', 'si');
  f.link('oferta_route', 'listo', 'continuar');
  return f;
}

module.exports = { e1 };
