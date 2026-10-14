// E3 v2: datos de pago de la orden, "Ya transferí", foto del comprobante (a Storage) y número de operación (submitProof).
const { Flow } = require('../../../../kapso/build/flow');
const { escalar, pregunta, elegir } = require('./helpers');

function e3() {
  const f = new Flow('E3', 'BrasPer · E3 Pago y constancia (v2)', 'brasper-v2-e3-pago', 'Etapa 3: cuenta de pago, constancia (foto y N.º de operación) o cancelación.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.api('info', 'orden_info');
  f.link('init', 'info');
  const ac = elegir(f, 'ac', {
    tipo: 'buttons', body: '✅ *Operación {{vars.operacion_id}} registrada*\n\nTransfiere *{{vars.total_enviar_txt}} {{vars.moneda_origen}}* a esta cuenta:\n🏦 Banco: {{vars.pago_banco}}\n👤 Titular: {{vars.pago_titular}}\n🔢 Cuenta: {{vars.pago_cuenta}}{{vars.pago_pix_linea}}\n\n⏱ Tienes hasta las {{vars.tasa_hasta}} para transferir con esta tasa.\n⚠ Transfiere en {{vars.moneda_origen}}, no en otra moneda.\n\nCuando termines, toca *Ya transferí*.',
    opciones: [{ id: 'ya_transferi', title: 'Ya transferí' }, { id: 'cancelar', title: 'Cancelar operación' }], variable: 'accion_e3', motivo: 'accion_e3',
  });
  f.link('info', ac.entrada); // sin horario propio: el backend no publica uno y el bot no lo inventa

  // Cancelar con confirmación.
  const cc = elegir(f, 'cc', {
    tipo: 'buttons', body: '¿Seguro que quieres cancelar la operación {{vars.operacion_id}}?',
    opciones: [{ id: 'si_cancelar', title: 'Sí, cancelar' }, { id: 'continuar', title: 'Continuar' }], variable: 'confirma_cancelar', motivo: 'confirma_cancelar',
  });
  f.api('cancela', 'cancel_order');
  f.text('cancelada', 'Listo, cancelé la operación {{vars.operacion_id}}. Cuando quieras, escríbeme para hacer una nueva cotización.');
  f.link(ac.ruta, cc.entrada, 'cancelar').link(cc.ruta, 'cancela', 'si_cancelar').link(cc.ruta, ac.entrada, 'continuar').link('cancela', 'cancelada');

  // Constancia: foto (a Storage) y número de operación bancaria. El asistente no evalúa el comprobante.
  f.api('vigencia', 'check_lock', { edges: ['vigente', 'vencida'] });
  f.link(ac.ruta, 'vigencia', 'ya_transferi');
  f.text('pide_foto', '¡Gracias! 📎 Envíame la foto o el PDF del comprobante de tu transferencia.');
  f.setvar('marca_vencida', 'tasa_vencida', 'si');
  f.text('aviso_vencida', 'Tu tasa asegurada venció mientras transferías, pero igual recibo tu comprobante. Una persona confirmará la tasa final al validar tu pago.');
  f.link('vigencia', 'pide_foto', 'vigente').link('vigencia', 'marca_vencida', 'vencida').link('marca_vencida', 'aviso_vencida').link('aviso_vencida', 'pide_foto');
  f.wait('esp_foto');
  f.api('foto', 'proof_upload', { edges: ['subida', 'sin_foto', 'muy_grande', 'fallo_subida', 'escalar'] });
  f.link('pide_foto', 'esp_foto').link('esp_foto', 'foto');
  f.text('sin_foto', 'No veo ninguna foto o PDF en tu mensaje 🤔 Envía una foto o captura del comprobante.');
  f.text('grande', 'El archivo es muy pesado (máximo 8 MB). Envía una foto más liviana o un PDF más pequeño.');
  f.text('falla', 'No pude guardar tu archivo 😕 Inténtalo de nuevo, por favor.');
  f.link('foto', 'sin_foto', 'sin_foto').link('sin_foto', 'esp_foto');
  f.link('foto', 'grande', 'muy_grande').link('grande', 'esp_foto');
  f.link('foto', 'falla', 'fallo_subida').link('falla', 'esp_foto');
  f.link('foto', escalar(f, 'foto_esc', 'comprobante_no_recibido'), 'escalar');

  const nop = pregunta(f, 'nop', { prompt: 'Ahora escribe el número de operación que aparece en tu comprobante.', guardar: 'operacion_raw', validar: 'operacion', error: 'Ese número no parece válido. Debe tener entre 4 y 24 letras o dígitos (se aceptan guiones).', motivo: 'n_operacion_invalido' });
  f.link('foto', nop.entrada, 'subida');
  f.api('envia', 'proof_submit', { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  f.link(nop.salida, 'envia', 'valido');
  f.text('cierre', '¡Listo! Recibimos tu comprobante ✅\nUna persona validará tu pago y te escribo apenas esté listo.');
  f.text('dup', 'Ese número ya está registrado en otra operación. Revísalo en tu comprobante y envíalo de nuevo.');
  f.text('nofoto', 'No encontré tu foto 🤔 Envíamela de nuevo.');
  f.text('ya', 'Ya recibimos tu comprobante. Una persona validará tu pago.');
  f.link('envia', 'cierre', 'ok');
  f.link('envia', 'dup', 'duplicado').link('dup', nop.entrada);
  f.link('envia', 'nofoto', 'sin_subida').link('nofoto', 'esp_foto');
  f.link('envia', 'ya', 'ya_recibido');
  f.link('envia', nop.entrada, 'invalido');
  f.setvar('listo', 'continuar', 'si');
  f.link('cierre', 'listo').link('ya', 'listo');
  return f;
}

module.exports = { e3 };
