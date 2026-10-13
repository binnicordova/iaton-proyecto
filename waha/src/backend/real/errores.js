// Error de una llamada a Firebase. `transporte` distingue lo que no es culpa del cliente ni del flujo
// (red caída, timeout, 5xx sin código) de un error de negocio con código estable (`invalid-input`, `quote-expired`…).
class ErrorBackend extends Error {
  constructor(mensaje, { codigo = null, estado = null, detalles = null, transporte = false } = {}) {
    super(mensaje);
    this.name = 'ErrorBackend';
    this.codigo = codigo;
    this.estado = estado;
    this.detalles = detalles;
    this.transporte = transporte;
  }
}

module.exports = { ErrorBackend };
