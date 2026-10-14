// Lecturas REST de Firestore con el token del cliente (las reglas solo dejan leer lo propio).
const { pedir } = require('./http');
const { ErrorBackend } = require('./errores');

// Convierte los valores tipados de la API REST en valores normales.
function valor(v) {
  if (v === null || v === undefined) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valor);
  if ('mapValue' in v) return decodificar(v.mapValue);
  return null;
}
function decodificar(doc) {
  return Object.fromEntries(Object.entries((doc && doc.fields) || {}).map(([k, v]) => [k, valor(v)]));
}

function crearFirestore({ sesiones, config, fetchImpl = fetch, dormir }) {
  // Devuelve el documento como objeto, o null si no existe. Un documento ajeno (o de una orden inexistente) da PERMISSION_DENIED.
  async function leer(telefono, ruta) {
    return sesiones.usar(telefono, async (s) => {
      try {
        const { json } = await pedir({ url: `${config.firestoreUrl}/${ruta}`, metodo: 'GET', encabezados: { authorization: `Bearer ${s.idToken}` }, reintentos: 1, fetchImpl, dormir });
        return decodificar(json);
      } catch (e) {
        if (e instanceof ErrorBackend && e.estado === 404) return null;
        throw e;
      }
    });
  }

  // Órdenes propias creadas desde una cotización: sirve para saber si un createOrder dudoso llegó a crearse.
  async function ordenesPorCotizacion(telefono, quoteId) {
    return sesiones.usar(telefono, async (s) => {
      const filtro = (campo, v) => ({ fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: v } } });
      const { json } = await pedir({
        url: `${config.firestoreUrl}:runQuery`, encabezados: { authorization: `Bearer ${s.idToken}` }, reintentos: 1, fetchImpl, dormir,
        cuerpo: { structuredQuery: { from: [{ collectionId: 'orders' }], where: { compositeFilter: { op: 'AND', filters: [filtro('uid', s.uid), filtro('quoteId', quoteId)] } }, limit: 5 } },
      });
      return (json || []).filter((f) => f.document).map((f) => decodificar(f.document));
    });
  }

  return { leer, ordenesPorCotizacion };
}

module.exports = { crearFirestore, decodificar };
