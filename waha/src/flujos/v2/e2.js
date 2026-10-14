// E2 v2: datos del cliente (o confirmación de los guardados), origen de fondos, cuentas de origen y destino, resumen y createOrder.
const { Flow } = require('../../../../kapso/build/flow');
const { MSG_SIN_TASAS, MONEDAS, BANCOS_POR_MONEDA, TIPOS_DOC, FONDOS, ids, escalar, pregunta, elegir, elegirPorMoneda, listaDinamica } = require('./helpers');

// Bloque de cuenta (origen o destino): lista de las cuentas guardadas de esa moneda o, si no hay o elige "Otra cuenta",
// banco (lista por moneda; "Otro" = escribir el nombre) y número de cuenta. Termina en `${p}_ok`.
function bloqueCuenta(f, p, { lado, monedaVar, cuerpoLista, cuerpoBanco }) {
  const n = (s) => `${p}_${s}`;
  f.api(n('opc'), `cuentas_opciones:${lado}`, { edges: ['con_cuentas', 'sin_cuentas'] });
  listaDinamica(f, n('lista'), { body: cuerpoLista, boton: 'Elegir cuenta', filasVar: `opciones_${lado}` });
  f.wait(n('wait'));
  f.api(n('route'), `route_cuenta:${lado}`, { edges: ['elegida', 'otra', 'invalido', 'escalar'] });
  f.link(n('opc'), n('lista'), 'con_cuentas').link(n('lista'), n('wait')).link(n('wait'), n('route'));
  f.link(n('route'), n('lista'), 'invalido');
  f.link(n('route'), escalar(f, n('esc'), `cuenta_${lado}`), 'escalar');

  const banco = elegirPorMoneda(f, n('bn'), { monedaVar, body: cuerpoBanco, boton: 'Elegir banco', listas: BANCOS_POR_MONEDA, variable: `${lado}_banco_sel`, motivo: `banco_${lado}` });
  const bancoTxt = pregunta(f, n('bt'), { prompt: 'Escribe el nombre de tu banco.', guardar: `${lado}_banco_raw`, validar: `banco_${lado}`, error: 'No entendí el nombre del banco. Escríbelo de nuevo.', motivo: `banco_${lado}_invalido` });
  f.api(n('bset'), `banco_set:${lado}`);
  const num = pregunta(f, n('nm'), {
    prompt: `Escribe el número de la cuenta en {{vars.${lado}_banco}}.`, guardar: `${lado}_cuenta_raw`, validar: `cuenta_${lado}`,
    error: 'Ese número de cuenta no parece válido. Escríbelo solo con dígitos y guiones.', motivo: `cuenta_${lado}_invalida`,
  });
  f.link(n('opc'), banco.entrada, 'sin_cuentas').link(n('route'), banco.entrada, 'otra');
  f.linkAll(banco.ruta, n('bset'), banco.ids.filter((b) => b !== 'Otro'));
  f.link(banco.ruta, bancoTxt.entrada, 'Otro');
  f.link(bancoTxt.salida, num.entrada, 'valido').link(n('bset'), num.entrada);
  f.setvar(n('ok'), `cuenta_${lado}_lista`, 'si');
  f.link(n('route'), n('ok'), 'elegida').link(num.salida, n('ok'), 'valido');
  return { entrada: n('opc'), salida: n('ok') };
}

function e2() {
  const f = new Flow('E2', 'BrasPer · E2 Datos (v2)', 'brasper-v2-e2-datos', 'Etapa 2: datos del cliente, origen de fondos, cuentas, resumen y creación de la orden.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.api('perfil', 'perfil_get', { edges: ['nuevo', 'existe'] });
  f.link('init', 'perfil');

  // Cliente nuevo: nombre, tipo y número de documento, correo.
  const nom = pregunta(f, 'nom', { prompt: '¿Cuál es tu nombre completo? Escribe nombre y apellido.', guardar: 'nombre_raw', validar: 'nombre', error: 'Necesito tu nombre y apellido, por ejemplo Ana Souza.', motivo: 'nombre_invalido' });
  const dt = elegir(f, 'dt', { tipo: 'list', body: '¿Qué tipo de documento tienes?', opciones: TIPOS_DOC, variable: 'doc_tipo', motivo: 'doc_tipo' });
  const dn = pregunta(f, 'dn', { prompt: 'Escribe tu número de {{vars.doc_tipo}}.', guardar: 'doc_raw', validar: 'doc', error: 'Ese número no es válido para {{vars.doc_tipo}}. Revísalo y envíalo de nuevo.', motivo: 'doc_invalido' });
  const co = pregunta(f, 'co', { prompt: '¿A qué correo electrónico te enviamos tu comprobante?', guardar: 'correo_raw', validar: 'correo', error: 'Ese correo no parece válido. Escríbelo de nuevo, por ejemplo ana@correo.com.', motivo: 'correo_invalido' });
  f.link('perfil', nom.entrada, 'nuevo');
  f.link(nom.salida, dt.entrada, 'valido').linkAll(dt.ruta, dn.entrada, ids(TIPOS_DOC)).link(dn.salida, co.entrada, 'valido');

  // Cliente que vuelve: se confirman sus datos guardados.
  const cf = elegir(f, 'cf', {
    tipo: 'buttons', body: 'Usaremos tu {{vars.doc_tipo}} {{vars.doc_num}} y tu correo {{vars.correo_masc}}. ¿Es correcto?',
    opciones: [{ id: 'si_datos', title: 'Sí, es correcto' }, { id: 'cambiar', title: 'Cambiar mis datos' }], variable: 'confirma_datos', motivo: 'confirma_datos',
  });
  f.link('perfil', cf.entrada, 'existe').link(cf.ruta, nom.entrada, 'cambiar');

  // Origen de fondos y cuentas.
  const fo = elegir(f, 'fo', { tipo: 'list', body: '¿De dónde provienen los fondos?', opciones: FONDOS, variable: 'fondos', motivo: 'origen_fondos' });
  f.link(cf.ruta, fo.entrada, 'si_datos').link(co.salida, fo.entrada, 'valido');
  const origen = bloqueCuenta(f, 'cu_o', { lado: 'origen', monedaVar: 'moneda_origen', cuerpoLista: 'Elige la cuenta desde la que vas a pagar:', cuerpoBanco: '¿Desde qué banco nos envías tu dinero?' });
  const destino = bloqueCuenta(f, 'cu_d', { lado: 'destino', monedaVar: 'moneda_destino', cuerpoLista: 'Elige la cuenta donde recibirá tu destinatario:', cuerpoBanco: '¿En qué banco recibirá tu destinatario?' });
  f.linkAll(fo.ruta, origen.entrada, ids(FONDOS));
  f.link(origen.salida, destino.entrada);

  // Resumen y confirmación antes de crear la orden.
  const rs = elegir(f, 'rs', {
    tipo: 'buttons',
    body: 'Envías {{vars.total_enviar_txt}} {{vars.moneda_origen}} desde {{vars.origen_banco}} ••{{vars.origen_ult4}}.\nRecibe {{vars.recibe_txt}} {{vars.moneda_destino}} en {{vars.destino_banco}} ••{{vars.destino_ult4}}.\nTasa {{vars.tasa_txt}}. ¿Confirmas?',
    opciones: [{ id: 'confirmar', title: 'Confirmar' }, { id: 'cambiar', title: 'Cambiar datos' }, { id: 'cancelar', title: 'Cancelar' }], variable: 'confirma_e2', motivo: 'confirma_e2',
  });
  f.link(destino.salida, rs.entrada);
  f.text('cancelada', 'Listo, cancelé la solicitud. Cuando quieras, escríbeme de nuevo.');
  f.link(rs.ruta, nom.entrada, 'cambiar').link(rs.ruta, 'cancelada', 'cancelar');

  // Crear la orden y tratar lo que responda el backend.
  f.api('crea', 'order_create', { edges: ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'] });
  f.link(rs.ruta, 'crea', 'confirmar');
  f.setvar('listo', 'continuar', 'si');
  f.link('crea', 'listo', 'ok');
  f.link('crea', escalar(f, 'crea_grande', 'monto_grande', { mensaje: 'Por el monto, te paso con una persona del equipo para ayudarte.' }), 'requiere_persona');
  f.link('crea', escalar(f, 'crea_sin', 'creacion_no_disponible', { mensaje: 'Ahora no puedo crear tu operación con seguridad. Te paso con una persona del equipo para ayudarte.' }), 'sin_servicio');

  // La cotización venció (dura 15 min): se cotiza de nuevo con los mismos montos y se pide confirmar la nueva tasa.
  f.api('rq', 'quote_create', { edges: ['ok', 'sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona'] });
  f.link('crea', 'rq', 'quote_expirada');
  const rc = elegir(f, 'rc', {
    tipo: 'buttons',
    body: 'La tasa cambió. Nueva cotización: 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}. Total a transferir {{vars.total_enviar_txt}} {{vars.moneda_origen}}. Recibirás {{vars.recibe_txt}} {{vars.moneda_destino}}.',
    opciones: [{ id: 'continuar', title: 'Continuar' }, { id: 'cancelar', title: 'Cancelar' }], variable: 'tasa_nueva', motivo: 'tasa_nueva',
  });
  f.link('rq', rc.entrada, 'ok');
  const sinTasas = escalar(f, 'rq_esc', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS });
  for (const e of ['sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona']) f.link('rq', sinTasas, e);
  f.link(rc.ruta, 'crea', 'continuar').link(rc.ruta, 'cancelada', 'cancelar');

  // El backend rechazó un dato: se repregunta solo ese campo.
  f.text('inv', 'Uno de tus datos no pasó la validación. Revisémoslo.');
  f.api('campo', 'route_campo', { edges: ['nombre', 'documento', 'correo', 'otro'] });
  f.link('crea', 'inv', 'dato_invalido').link('inv', 'campo');
  f.link('campo', nom.entrada, 'nombre').link('campo', dt.entrada, 'documento').link('campo', co.entrada, 'correo').link('campo', fo.entrada, 'otro');
  return f;
}

module.exports = { e2 };
