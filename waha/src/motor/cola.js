// Una cola por clave (el teléfono): un mensaje a la vez, en orden de llegada.
function crearCola() {
  const colas = new Map();
  return {
    ejecutar(clave, tarea) {
      const previa = colas.get(clave) || Promise.resolve();
      const resultado = previa.then(tarea, tarea);
      const marca = resultado.catch(() => {});
      colas.set(clave, marca);
      marca.then(() => { if (colas.get(clave) === marca) colas.delete(clave); });
      return resultado;
    },
  };
}

module.exports = { crearCola };
