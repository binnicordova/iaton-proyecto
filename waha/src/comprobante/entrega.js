// Entrega del comprobante por el chat de WhatsApp una vez que el pago quedó verificado y la operación completada.
// No escala ni bloquea al cliente si el envío falla: se registra y se puede volver a avisar.
const { generarPdf } = require('./pdf');
const { datosComprobante } = require('./datos');
const { enmascarar } = require('../util');

async function entregarComprobante({ kv, proveedor, registrar, telefono, chatId, operacionId }) {
  const op = await kv.get(`op:${operacionId}`, 'json');
  if (!op) return { enviado: false, motivo: 'sin_operacion' };
  if (String(op.phone) !== String(telefono)) return { enviado: false, motivo: 'otro_cliente' };
  if (op.estado !== 'completada') return { enviado: false, motivo: 'no_completada' };
  if (await kv.get(`comprobante:${op.id}`, 'json')) return { enviado: false, motivo: 'ya_enviado' };

  const pdf = generarPdf(datosComprobante(op));
  try {
    await proveedor.enviarDocumento(chatId, {
      nombre: `comprobante-${op.id}.pdf`,
      mimetype: 'application/pdf',
      base64: pdf.toString('base64'),
      caption: `Tu comprobante de la operación ${op.id}`,
    });
  } catch (e) {
    if (e && e.name === 'ErrorEnvio') {
      registrar({ tipo: 'error_comprobante', chat: enmascarar(chatId), estado: String(e.estado || 'red'), detalle: e.restriccion ? 'restriccion_whatsapp' : 'transporte' });
      return { enviado: false, motivo: 'error_envio' };
    }
    throw e;
  }
  await kv.put(`comprobante:${op.id}`, JSON.stringify(true));
  return { enviado: true, bytes: pdf.length };
}

module.exports = { entregarComprobante };
