// Baja la foto o el PDF que el cliente mandó por WhatsApp desde WAHA (para subirlo a Storage).
// WAHA entrega `media.url` con su propio host (p. ej. http://localhost:3000/api/files/…); aquí solo se usa la ruta,
// contra la dirección de WAHA que ve este servidor. Sin URL se pide el mensaje con downloadMedia=true.
const { ErrorBackend } = require('./backend/real/errores');

function crearDescargaMedia({ wahaBaseUrl, apiKey, session, fetchImpl = fetch, timeoutMs = 20000 }) {
  const base = String(wahaBaseUrl).replace(/\/$/, '');
  const cab = { 'X-Api-Key': apiKey };

  async function pedir(url) {
    try {
      return await fetchImpl(url, { headers: cab, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ErrorBackend('No pude conectar con WAHA para bajar el archivo', { codigo: 'waha_red', transporte: true });
    }
  }

  async function bajar(urlEvento, mimetype) {
    const ruta = new URL(urlEvento, 'http://local').pathname;
    const res = await pedir(`${base}${ruta}`);
    if (!res.ok) return null;
    const tipo = mimetype || String(res.headers.get('content-type') || '').split(';')[0].trim() || null;
    return { bytes: Buffer.from(await res.arrayBuffer()), mimetype: tipo };
  }

  return async function descargar({ chatId, mensajeId, mediaUrl, mimetype }) {
    if (mediaUrl) return bajar(mediaUrl, mimetype);
    const res = await pedir(`${base}/api/${session}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(mensajeId)}?downloadMedia=true`);
    if (!res.ok) return null;
    const m = await res.json().catch(() => null);
    return m && m.media && m.media.url ? bajar(m.media.url, m.media.mimetype || mimetype) : null;
  };
}

module.exports = { crearDescargaMedia };
