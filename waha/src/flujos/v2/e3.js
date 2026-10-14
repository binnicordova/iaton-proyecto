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
  f.text('instr', 'Tu operación es {{vars.operacion_id}}.\nTransfiere {{vars.total_enviar_txt}} {{vars.moneda_origen}} a:\nTitular: {{vars.pago_titular}}\nBanco: {{vars.pago_banco}}\nCuenta: {{vars.pago_cuenta}}{{vars.pago_pix_linea}}\nUsa la cuenta de {{vars.moneda_origen}}, no otra moneda.\nTienes hasta las {{vars.tasa_hasta}} para transferir con esta tasa.');
  f.link('info', 'instr');
  const ac = elegir(f, 'ac', {
    tipo: 'buttons', body: 'Cuando termines la transferencia, toca "Ya transferí".',
    opciones: [{ id: 'ya_transferi', title: 'Ya transferí' }, { id: 'cancelar', title: 'Cancelar operación' }], variable: 'accion_e3', motivo: 'accion_e3',
  });
  f.link('instr', ac.entrada); // sin horario propio: el backend no publica uno y el bot no lo inventa

  // Cancelar con confirmación.
  const cc = elegir(f, 'cc', {
    tipo: 'buttons', body: '¿Seguro que quieres cancelar la operación {{vars.operacion_id}}?',
    opciones: [{ id: 'si_cancelar', title: 'Sí, cancelar' }, { id: 'continuar', title: 'Continuar' }], variable: 'confirma_cancelar', motivo: 'confirma_cancelar',
  });
  f.api('cancela', 'cancel_order');
  f.text('cancelada', 'Listo, cancelé la operación {{vars.operacion_id}}.');
  f.link(ac.ruta, cc.entrada, 'cancelar').link(cc.ruta, 'cancela', 'si_cancelar').link(cc.ruta, ac.entrada, 'continuar').link('cancela', 'cancelada');

  // Constancia: foto (a Storage) y número de operación bancaria. El asistente no evalúa el comprobante.
  f.api('vigencia', 'check_lock', { edges: ['vigente', 'vencida'] });
  f.link(ac.ruta, 'vigencia', 'ya_transferi');
  f.text('pide_foto', 'Perfecto. Envíame la foto del comprobante (imagen o PDF).');
  f.setvar('marca_vencida', 'tasa_vencida', 'si');
  f.text('aviso_vencida', 'Tu tasa asegurada venció mientras transferías. Igual recibo tu constancia: una persona confirmará la tasa final al validar tu pago.');
  f.link('vigencia', 'pide_foto', 'vigente').link('vigencia', 'marca_vencida', 'vencida').link('marca_vencida', 'aviso_vencida').link('aviso_vencida', 'pide_foto');
  f.wait('esp_foto');
  f.api('foto', 'proof_upload', { edges: ['subida', 'sin_foto', 'muy_grande', 'fallo_subida', 'escalar'] });
  f.link('pide_foto', 'esp_foto').link('esp_foto', 'foto');
  f.text('sin_foto', 'No recibí una foto o PDF. Envíame la foto o captura del comprobante.');
  f.text('grande', 'El archivo pesa más de 8 MB. Envía una foto más liviana o un PDF más pequeño.');
  f.text('falla', 'No pude guardar tu archivo. Envíalo de nuevo.');
  f.link('foto', 'sin_foto', 'sin_foto').link('sin_foto', 'esp_foto');
  f.link('foto', 'grande', 'muy_grande').link('grande', 'esp_foto');
  f.link('foto', 'falla', 'fallo_subida').link('falla', 'esp_foto');
  f.link('foto', escalar(f, 'foto_esc', 'comprobante_no_recibido'), 'escalar');

  const nop = pregunta(f, 'nop', { prompt: 'Ahora escribe el número de operación bancaria.', guardar: 'operacion_raw', validar: 'operacion', error: 'Ese número no parece válido. Usa de 4 a 24 letras, dígitos o guiones.', motivo: 'n_operacion_invalido' });
  f.link('foto', nop.entrada, 'subida');
  f.api('envia', 'proof_submit', { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  f.link(nop.salida, 'envia', 'valido');
  f.text('cierre', 'Una persona validará tu pago. Te escribo cuando esté listo.');
  f.text('dup', 'Ese número de operación ya está en otra operación. Revísalo y envíalo de nuevo.');
  f.text('nofoto', 'No encontré tu foto. Envíamela de nuevo.');
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
