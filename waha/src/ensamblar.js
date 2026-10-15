// Une las piezas según BACKEND: flujos v1 + simulador, o flujos v2 + funciones de Firebase + vigilante de órdenes.
const { crearBackend } = require('./backend');
const { configBackend } = require('./backend/real/config');
const { crearMotor } = require('./motor/motor');
const { cargarFlujos } = require('./flujos');
const { cargarFlujosV2 } = require('./flujos/v2');
const { crearServidor } = require('./server');
const { crearVigilante } = require('./vigilante');

// Teléfono ficticio con el que el chequeo de salud abre su propia sesión anónima en Firebase.
const TELEFONO_SALUD = '0000000000';

function ensamblar({ config, entorno = process.env, almacen, proveedor, extraer, descargarMedia, fetchImpl = fetch, ahora = () => new Date(), dormir }) {
  const real = config.backend === 'real';
  const registrar = (e) => almacen.registrar(e);
  const backend = crearBackend({
    modo: config.backend, humano: config.whatsappHumano, almacen, entorno, configReal: real ? configBackend(entorno) : undefined, fetchImpl, descargarMedia, ahora, registrar, dormir,
  });
  const motor = crearMotor({ flujos: real ? cargarFlujosV2() : cargarFlujos(), almacen, proveedor, llamarFuncion: backend.llamarFuncion, extraer });
  const saludBackend = real ? () => backend.funciones.llamar(TELEFONO_SALUD, 'getRates', {}) : undefined;
  const { servidor, inactivo } = crearServidor({ config, motor, almacen, proveedor, fetchImpl, saludBackend });
  const vigilante = real
    ? crearVigilante({ almacen, firestore: backend.firestore, funciones: backend.funciones, motor, proveedor, ahora, registrar })
    : null;
  return { servidor, inactivo, motor, backend, vigilante };
}

module.exports = { ensamblar };
