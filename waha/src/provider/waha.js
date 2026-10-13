const { renderMenu } = require('./menu-texto');
const { enmascarar, soloDigitos } = require('../util');

class ErrorEnvio extends Error {
  constructor(mensaje, { estado = null, reintentable = false, restriccion = false } = {}) {
    super(mensaje);
    this.estado = estado;
    this.reintentable = reintentable;
    this.restriccion = restriccion;
  }
}

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));

// Adaptador de WhatsApp sobre WAHA. El motor solo conoce estos cinco métodos.
class WahaProvider {
  constructor({ baseUrl, apiKey, session, interactivos = 'texto', fetchImpl = fetch, dormir = dormirReal, pausaMs = 0, reintentos = 3, registrar = null }) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.apiKey = apiKey;
    this.session = session;
    this.interactivos = interactivos;
    this.fetchImpl = fetchImpl;
    this.dormir = dormir;
    this.pausaMs = pausaMs;
    this.reintentos = reintentos;
    this.registrar = registrar;
  }

  async _post(ruta, cuerpo) {
    let ultimo;
    for (let intento = 0; intento < this.reintentos; intento++) {
      const t0 = Date.now();
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${ruta}`, {
          method: 'POST',
          headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: this.session, ...cuerpo }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (this.registrar) this.registrar({ tipo: 'envio', ruta, chat: enmascarar(cuerpo.chatId), estado: String(res.status), latenciaMs: Date.now() - t0 });
          return data;
        }
        ultimo = new ErrorEnvio(`WAHA ${ruta} respondió ${res.status}`, {
          estado: res.status, reintentable: res.status >= 500, restriccion: res.status === 463 || res.status === 475,
        });
      } catch (e) {
        ultimo = new ErrorEnvio(`red: ${e.message}`, { reintentable: true });
      }
      if (!ultimo.reintentable) break;
      if (intento < this.reintentos - 1) await this.dormir(200 * 2 ** intento);
    }
    if (this.registrar) this.registrar({ tipo: 'envio', ruta, chat: enmascarar(cuerpo.chatId), estado: `error_${ultimo.estado || 'red'}` });
    throw ultimo;
  }

  async _enviar(ruta, cuerpo) {
    const data = await this._post(ruta, cuerpo);
    if (this.pausaMs > 0) await this.dormir(this.pausaMs);
    return typeof data.id === 'string' ? data.id : null;
  }

  enviarTexto(chatId, texto) { return this._enviar('/api/sendText', { chatId, text: texto }); }

  enviarBotones(chatId, cuerpo, botones) {
    if (this.interactivos === 'texto') return this.enviarTexto(chatId, renderMenu(cuerpo, botones));
    return this._enviar('/api/sendButtons', { chatId, body: cuerpo, buttons: botones.map((b) => ({ type: 'reply', text: b.title, id: b.id })) });
  }

  enviarLista(chatId, cuerpo, etiqueta, filas) {
    if (this.interactivos === 'texto') return this.enviarTexto(chatId, renderMenu(cuerpo, filas));
    return this._enviar('/api/sendList', {
      chatId,
      message: {
        title: 'BrasPer', description: cuerpo, footer: 'BrasPer', button: etiqueta,
        sections: [{ title: 'Opciones', rows: filas.map((r) => ({ title: r.title, rowId: r.id, description: r.description || null })) }],
      },
    });
  }

  enviarEnlace(chatId, cuerpo, etiqueta, url) {
    if (this.interactivos === 'texto') return this.enviarTexto(chatId, `${cuerpo}\n${etiqueta}: ${url}`);
    return this._enviar('/api/sendButtons', { chatId, body: cuerpo, buttons: [{ type: 'url', text: etiqueta, url }] });
  }

  // WAHA puede entregar al cliente como @lid (identificador interno de WhatsApp) en vez de su teléfono.
  // Devuelve el teléfono real (solo dígitos) o null si WAHA no lo conoce.
  async resolverTelefono(chatId) {
    if (!/@lid$/.test(String(chatId))) return soloDigitos(chatId);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/${this.session}/lids/${encodeURIComponent(chatId)}`, { headers: { 'X-Api-Key': this.apiKey } });
      if (!res.ok) return null;
      const d = await res.json();
      return d && d.pn ? soloDigitos(d.pn) : null;
    } catch {
      return null;
    }
  }

  // Marcar como leído nunca bloquea ni rompe la respuesta.
  async marcarLeido(chatId) {
    try { await this._post('/api/sendSeen', { chatId }); } catch { /* no crítico */ }
  }
}

module.exports = { WahaProvider, ErrorEnvio };
