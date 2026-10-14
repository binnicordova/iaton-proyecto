// Vigila las órdenes que esperan una decisión del personal y avisa al cliente por WhatsApp.
// Lee `orders/{id}` con el token del cliente (no hay una dirección pública a la que el backend pueda llamar de vuelta).
// Un aviso solo se marca como enviado si salió; si el cliente está en otra conversación se reintenta en la siguiente revisión.
const { ErrorBackend } = require('./backend/real/errores');

const SIETE_DIAS_MS = 7 * 24 * 3600 * 1000;
const DIEZ_MIN_MS = 10 * 60 * 1000;

function crearVigilante({ almacen, firestore, funciones, motor, proveedor, ahora = () => new Date(), registrar = () => {}, intervaloMs = 20000 }) {
  const ultimaRevision = new Map(); // ordenId → ms; pasados los 10 minutos se revisa una vez por minuto
  let temporizador = null;
  let enCurso = false; // el temporizador no lanza una revisión nueva mientras la anterior sigue (evita avisos duplicados)

  async function avisar(s, orden, evento) {
    const r = await motor.iniciar('E4', s.telefono, s.chatId, {
      operacion_id: s.ordenId, evento, destino_ult4: String(orden.destinationAccount || '').replace(/[^0-9A-Za-z]/g, '').slice(-4),
      motivo: orden.rejectionReason || 'no pudimos validar el comprobante',
    });
    return r.iniciado && !r.fallo;
  }

  async function enviarRecibo(s) {
    let recibo;
    try {
      recibo = await funciones.llamar(s.telefono, 'getReceipt', { orderId: s.ordenId });
    } catch (e) {
      if (e instanceof ErrorBackend && e.codigo === 'receipt-not-ready') return false; // todavía no hay factura aceptada
      throw e;
    }
    await proveedor.enviarDocumento(s.chatId, { nombre: recibo.filename, mimetype: recibo.contentType, base64: recibo.base64, caption: `📄 Tu comprobante de la operación ${s.ordenId}. ¡Gracias por confiar en BrasPer!` });
    return true;
  }

  async function revisar(s) {
    const edad = ahora().getTime() - new Date(s.creado).getTime();
    if (edad > SIETE_DIAS_MS) { almacen.actualizarSeguimiento(s.ordenId, { cerrado: 1 }); return; }
    const antes = ultimaRevision.get(s.ordenId) || 0;
    if (edad > DIEZ_MIN_MS && ahora().getTime() - antes < 60000) return;
    ultimaRevision.set(s.ordenId, ahora().getTime());

    let orden;
    try {
      orden = await firestore.leer(s.telefono, `orders/${s.ordenId}`);
    } catch (e) {
      if (e instanceof ErrorBackend && !e.transporte) {
        registrar({ tipo: 'seguimiento_sin_acceso', estado: String(e.estado || ''), detalle: e.codigo || '' });
        almacen.actualizarSeguimiento(s.ordenId, { cerrado: 1 });
        return;
      }
      throw e;
    }
    if (!orden || orden.status === 'cancelled') { almacen.actualizarSeguimiento(s.ordenId, { cerrado: 1 }); return; }

    if (orden.status === 'rejected' && s.estadoAvisado !== 'rejected') {
      if (await avisar(s, orden, 'rechazada')) almacen.actualizarSeguimiento(s.ordenId, { estadoAvisado: 'rejected', cerrado: 1 });
      return;
    }
    let estado = s.estadoAvisado;
    if (['approved', 'exported'].includes(orden.status) && estado !== 'approved') {
      if (!(await avisar(s, orden, 'aprobada'))) return;
      almacen.actualizarSeguimiento(s.ordenId, { estadoAvisado: 'approved' });
      estado = 'approved';
    }
    if (estado === 'approved' && orden.status === 'exported' && orden.invoiceStatus === 'accepted' && !s.reciboEnviado) {
      if (await enviarRecibo(s)) almacen.actualizarSeguimiento(s.ordenId, { reciboEnviado: 1, cerrado: 1 });
    }
  }

  // Una revisión de todas las órdenes abiertas. Un fallo en una no impide revisar las demás.
  async function tick() {
    if (enCurso) return;
    enCurso = true;
    try {
      for (const s of almacen.seguimientosAbiertos()) {
        try {
          await revisar(almacen.seguimiento(s.ordenId) || s);
        } catch (e) {
          registrar({ tipo: 'error_seguimiento', estado: String((e && (e.estado || e.codigo)) || ''), detalle: String((e && e.message) || e).slice(0, 120) });
        }
      }
    } finally { enCurso = false; }
  }

  function iniciar() {
    if (temporizador) return;
    temporizador = setInterval(() => { tick().catch(() => {}); }, intervaloMs);
    temporizador.unref();
  }
  function detener() { clearInterval(temporizador); temporizador = null; }

  return { tick, iniciar, detener };
}

module.exports = { crearVigilante };
