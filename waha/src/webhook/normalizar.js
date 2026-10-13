const { soloDigitos } = require('../util');

const EVENTOS = new Set(['message', 'session.status']);

// Id de la fila tocada en una lista. Con NOWEB (probado en H0) viaja en
// _data.message.listResponseMessage.singleSelectReply.selectedRowId y el body trae el título.
function extraerOpcion(payload) {
  const lista = payload && payload._data && payload._data.message && payload._data.message.listResponseMessage;
  const id = lista && lista.singleSelectReply && lista.singleSelectReply.selectedRowId;
  return typeof id === 'string' && id ? id : null;
}

function tipoDeMedia(payload) {
  if (!payload.hasMedia) return 'text';
  const mime = (payload.media && payload.media.mimetype) || (payload._data && payload._data.mimetype) || '';
  if (!mime || mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || mime.startsWith('application/')) return 'document';
  return 'other';
}

// Con NOWEB el remitente llega como @lid, pero el evento trae el teléfono real en _data.key.remoteJidAlt.
// Si no viene, queda el LID y el servidor intenta resolverlo con la API de WAHA.
function telefonoReal(payload, from) {
  const alt = payload._data && payload._data.key && payload._data.key.remoteJidAlt;
  return /@lid$/.test(from) && /@s\.whatsapp\.net$/.test(String(alt || '')) ? soloDigitos(alt) : soloDigitos(from);
}

// Devuelve un evento de dominio o null si debe ignorarse. Nada fuera de este archivo conoce los campos de WAHA.
function normalizarEvento(evento) {
  if (!evento || !EVENTOS.has(evento.event) || !evento.payload) return null;
  const p = evento.payload;
  if (evento.event === 'session.status') return p.status ? { tipo: 'sesion', estado: String(p.status) } : null;
  if (p.fromMe || p.source === 'api') return null;
  const from = String(p.from || '');
  if (!/@(c\.us|lid)$/.test(from)) return null; // grupos, difusiones y estados
  const opcionId = extraerOpcion(p);
  return {
    tipo: 'mensaje',
    eventoId: evento.id || `${evento.session}:${p.id}`,
    mensajeId: p.id,
    chatId: from,
    telefono: telefonoReal(p, from),
    texto: String(p.body || ''),
    opcionId,
    tieneMedia: Boolean(p.hasMedia),
    tipoMensaje: tipoDeMedia(p),
    creado: new Date((Number(p.timestamp) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}

module.exports = { normalizarEvento, extraerOpcion };
