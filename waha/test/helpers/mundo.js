const { abrirDb } = require('../../src/estado/db');
const { crearAlmacen } = require('../../src/estado/almacen');
const { crearMotor } = require('../../src/motor/motor');
const { ProveedorFalso } = require('./proveedor-falso');

const AHORA = new Date('2026-10-14T15:00:00Z'); // miércoles 10:00 en Lima

function crearMundo({ flujos, llamarFuncion, extraer, db } = {}) {
  const proveedor = new ProveedorFalso();
  const almacen = crearAlmacen(db || abrirDb(':memory:'));
  const motor = crearMotor({
    flujos, almacen, proveedor,
    llamarFuncion: llamarFuncion || (async () => ({ vars: {}, next_edge: 'next' })),
    extraer: extraer || (async () => ({})),
    ahora: () => AHORA,
  });
  return { motor, proveedor, almacen, AHORA };
}

let n = 0;
const msg = (telefono, texto, extra = {}) => ({
  eventoId: `e${++n}`, mensajeId: `m${n}`, chatId: `${telefono}@c.us`, telefono, texto,
  opcionId: null, tieneMedia: false, tipoMensaje: 'text', creado: AHORA.toISOString(), ...extra,
});

module.exports = { crearMundo, msg, AHORA };
