// Llamadas a las funciones callable del backend con el token del cliente (ver el contrato en el spec).
const { pedir } = require('./http');

function crearFunciones({ sesiones, config, fetchImpl = fetch, dormir, timeoutMs }) {
  const urlDe = (nombre) => config.functionsUrl.replace('{nombre}', nombre.toLowerCase());

  async function llamar(telefono, nombre, data, { reintentos = 0 } = {}) {
    return sesiones.usar(telefono, async (s) => {
      const { json } = await pedir({
        url: urlDe(nombre), encabezados: { authorization: `Bearer ${s.idToken}` }, cuerpo: { data }, reintentos, fetchImpl, dormir, timeoutMs,
      });
      return json && json.result;
    });
  }

  return { llamar };
}

module.exports = { crearFunciones };
