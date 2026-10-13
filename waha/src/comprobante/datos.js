// Arma los datos del comprobante a partir de la operación guardada por brasper-api (op.snap y op.proof).
// El documento va completo: es el comprobante del propio cliente y le llega a su chat. Lo que falta queda en `undefined` y el PDF muestra un guion.

const FORMATO_LIMA = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function fechaLima(iso) {
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return undefined;
  const p = Object.fromEntries(FORMATO_LIMA.formatToParts(f).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const conMoneda = (monto, moneda) => (monto ? `${monto} ${moneda || ''}`.trim() : undefined);

function datosComprobante(op) {
  const s = op.snap || {};
  const p = op.proof || {};
  return {
    emisor: 'BrasPer',
    titulo: 'Comprobante de operación',
    aviso: 'DOCUMENTO DE DEMOSTRACIÓN',
    numero: op.id,
    fecha: fechaLima(op.creada),
    secciones: [
      { titulo: 'Operación', filas: [['Estado', op.estado === 'completada' ? 'Completada' : op.estado]] },
      {
        titulo: 'Envío',
        filas: [
          ['Monto enviado', conMoneda(s.monto_txt, s.moneda_origen)],
          ['Comisión', conMoneda(s.comision_txt, s.moneda_origen)],
          ['Total transferido', conMoneda(s.total_enviar_txt, s.moneda_origen)],
          ['Tasa', s.tasa_txt ? `1 ${s.moneda_origen} = ${s.tasa_txt} ${s.moneda_destino}` : undefined],
        ],
      },
      {
        titulo: 'Destino',
        filas: [
          ['Monto recibido', conMoneda(s.recibe_txt, s.moneda_destino)],
          ['Cuenta de destino', s.cuenta_banco && s.cuenta_ultimos4 ? `${s.cuenta_banco} ••${s.cuenta_ultimos4}` : undefined],
        ],
      },
      {
        titulo: 'Origen',
        filas: [
          ['Banco de origen', s.banco_origen],
          ['Origen de fondos', s.origen_fondos],
          ['Documento', s.dni_cpf ? `${s.tipo_doc || 'DNI'} ${s.dni_cpf}` : undefined],
          ['N.º de operación bancaria', p.n_operacion],
        ],
      },
    ],
    pie: 'Constancia de demostración. No es un comprobante de pago electrónico de SUNAT.',
  };
}

module.exports = { datosComprobante };
