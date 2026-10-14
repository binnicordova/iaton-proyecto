// Fábrica del backend: simulado (brasper-api.js, el modo de respaldo) o real (funciones de Firebase).
// En ambos casos devuelve `llamarFuncion({ vars, phone, edges, wa, chatId })`, el contrato que usa el motor.
const { crearLlamadorFuncion } = require('../puente-api');
const { crearSesiones } = require('./real/sesion');
const { crearFunciones } = require('./real/funciones');
const { crearFirestore } = require('./real/firestore');
const { crearStorage } = require('./real/storage');
const { crearBackendReal } = require('./real/acciones');

function crearBackend({ modo = 'simulado', almacen, entorno = process.env, configReal, fetchImpl = fetch, descargarMedia = async () => null, ahora = () => new Date(), registrar = () => {}, timeoutMs, dormir, varsFijas = {} }) {
  const simulado = crearLlamadorFuncion({ kvEnv: almacen.kvEnv(), envExtra: { TASAS_CAIDAS: entorno.TASAS_CAIDAS }, varsFijas });
  if (modo !== 'real') return { modo: 'simulado', llamarFuncion: simulado };
  const sesiones = crearSesiones({ almacen, config: configReal, fetchImpl, ahora, dormir });
  const funciones = crearFunciones({ sesiones, config: configReal, fetchImpl, dormir, timeoutMs });
  const firestore = crearFirestore({ sesiones, config: configReal, fetchImpl, dormir });
  const storage = crearStorage({ sesiones, config: configReal, fetchImpl, dormir });
  const llamarFuncion = crearBackendReal({ funciones, firestore, storage, sesiones, almacen, descargarMedia, delegado: simulado, ahora, registrar });
  return { modo: 'real', llamarFuncion, sesiones, funciones, firestore, storage };
}

module.exports = { crearBackend };
