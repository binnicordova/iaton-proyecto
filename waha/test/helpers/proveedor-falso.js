// Solo para pruebas: registra lo que el motor enviaría sin tocar WhatsApp.
class ProveedorFalso {
  constructor() { this.enviados = []; this.lids = {}; this.fallar = []; }
  _reg(e) {
    if (this.fallar.length) throw this.fallar.shift();
    this.enviados.push(e); return `m${this.enviados.length}`; }
  async enviarTexto(chatId, texto) { return this._reg({ tipo: 'texto', chatId, texto }); }
  async enviarBotones(chatId, texto, opciones) { return this._reg({ tipo: 'botones', chatId, texto, opciones }); }
  async enviarLista(chatId, texto, etiqueta, opciones) { return this._reg({ tipo: 'lista', chatId, texto, etiqueta, opciones }); }
  async enviarEnlace(chatId, texto, etiqueta, url) { return this._reg({ tipo: 'enlace', chatId, texto, etiqueta, url }); }
  async marcarLeido() {}
  async resolverTelefono(chatId) { return this.lids[chatId] || null; }
  textos() { return this.enviados.map((e) => e.texto); }
}

module.exports = { ProveedorFalso };
