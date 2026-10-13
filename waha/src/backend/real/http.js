// Cliente HTTP para Firebase: timeout, reintento solo de fallos de transporte y errores sin la URL
// (la de signUp lleva la clave web en la dirección).
const { ErrorBackend } = require('./errores');

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));
const CODIGO_FUNCION = /^[a-z0-9-]+$/; // códigos estables de las funciones: invalid-input, quote-expired…
const CODIGO_IDENTIDAD = /^[A-Z_]+$/; // Identity Toolkit: TOKEN_EXPIRED, USER_NOT_FOUND…

function leerJson(texto) {
  try { return texto ? JSON.parse(texto) : null; } catch { return null; }
}

function errorDeRespuesta(estado, json) {
  const err = json && json.error;
  const mensaje = err && typeof err.message === 'string' ? err.message : '';
  const codigo = CODIGO_FUNCION.test(mensaje) || CODIGO_IDENTIDAD.test(mensaje) ? mensaje : (err && err.status) || null;
  if (codigo) return new ErrorBackend(`Firebase respondió ${estado} (${codigo})`, { codigo, estado, detalles: (err && err.details) || null });
  return new ErrorBackend(`Firebase respondió ${estado}`, { estado, transporte: estado >= 500 || estado === 429 });
}

async function unIntento({ url, metodo, encabezados, cuerpo, tipoCuerpo, tipoContenido, timeoutMs, fetchImpl }) {
  const cabeceras = { ...encabezados };
  let body;
  if (cuerpo !== undefined) {
    if (tipoCuerpo === 'form') { cabeceras['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(cuerpo).toString(); }
    else if (tipoCuerpo === 'binario') { cabeceras['content-type'] = tipoContenido || 'application/octet-stream'; body = cuerpo; }
    else { cabeceras['content-type'] = 'application/json'; body = JSON.stringify(cuerpo); }
  }
  let res;
  try {
    res = await fetchImpl(url, { method: metodo, headers: cabeceras, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const agotado = e && (e.name === 'TimeoutError' || e.name === 'AbortError' || /abortado|aborted/i.test(String(e.message)));
    throw new ErrorBackend(agotado ? 'Firebase no respondió a tiempo' : 'No pude conectar con Firebase', { codigo: agotado ? 'timeout' : 'red', transporte: true });
  }
  const texto = await res.text();
  const json = leerJson(texto);
  if (!res.ok) throw errorDeRespuesta(res.status, json);
  return { estado: res.status, json };
}

async function pedir({ url, metodo = 'POST', encabezados = {}, cuerpo, tipoCuerpo = 'json', tipoContenido, timeoutMs = 15000, reintentos = 0, fetchImpl = fetch, dormir = dormirReal }) {
  let ultimo;
  for (let intento = 0; intento <= reintentos; intento += 1) {
    try {
      return await unIntento({ url, metodo, encabezados, cuerpo, tipoCuerpo, tipoContenido, timeoutMs, fetchImpl });
    } catch (e) {
      if (!(e instanceof ErrorBackend) || !e.transporte) throw e;
      ultimo = e;
      if (intento < reintentos) await dormir(300 * 2 ** intento);
    }
  }
  throw ultimo;
}

module.exports = { pedir };
