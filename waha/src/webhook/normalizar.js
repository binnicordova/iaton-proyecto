const { soloDigitos } = require('../util');

const EVENTOS = new Set(['message', 'session.status']);

function extraerOpcion(payload) {
  const d = (payload && payload._data) || {};
  const candidatos = [payload.selectedButtonId, payload.selectedRowId, d.selectedButtonId, d.selectedRowId];
  return candidatos.find((x) => typeof x === 'string' && x) || null;
}

function tipoDeMedia(payload) {
  if (!payload.hasMedia) return 'text';
  const mime = (payload.media && payload.media.mimetype) || (payload._data && payload._data.mimetype) || '';
  if (!mime || mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || mime.startsWith('application/')) return 'document';
  return 'other';
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
    telefono: soloDigitos(from),
    texto: String(p.body || ''),
    opcionId,
    tieneMedia: Boolean(p.hasMedia),
    tipoMensaje: tipoDeMedia(p),
    creado: new Date((Number(p.timestamp) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}

module.exports = { normalizarEvento, extraerOpcion };
