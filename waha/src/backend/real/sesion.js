// Un usuario anónimo de Firebase por teléfono. Guarda el uid y el token de renovación en SQLite (el token es un secreto:
// nunca se registra) y renueva el token de 1 hora antes de que venza. Una cola por teléfono evita altas o renovaciones duplicadas.
const { pedir } = require('./http');
const { ErrorBackend } = require('./errores');
const { crearCola } = require('../../motor/cola');

const MARGEN_MS = 5 * 60 * 1000;
// Si el refresh falla con alguno de estos códigos el usuario ya no existe o su sesión se perdió: se crea otro.
const SESION_PERDIDA = new Set(['TOKEN_EXPIRED', 'USER_NOT_FOUND', 'USER_DISABLED', 'INVALID_REFRESH_TOKEN', 'MISSING_REFRESH_TOKEN']);

function crearSesiones({ almacen, config, fetchImpl = fetch, ahora = () => new Date(), cola = crearCola(), dormir }) {
  const opciones = { fetchImpl, dormir, reintentos: 1 };

  async function crear(telefono) {
    const { json } = await pedir({ url: `${config.identityUrl}/v1/accounts:signUp?key=${config.apiKey}`, cuerpo: { returnSecureToken: true }, ...opciones });
    const s = { telefono, uid: json.localId, refresh: json.refreshToken, idToken: json.idToken, vence: ahora().getTime() + Number(json.expiresIn) * 1000 };
    almacen.guardarSesionFirebase(s);
    return s;
  }

  async function renovar(s) {
    const { json } = await pedir({
      url: `${config.tokenUrl}/v1/token?key=${config.apiKey}`, tipoCuerpo: 'form',
      cuerpo: { grant_type: 'refresh_token', refresh_token: s.refresh }, ...opciones,
    });
    const nueva = { telefono: s.telefono, uid: json.user_id, refresh: json.refresh_token || s.refresh, idToken: json.id_token, vence: ahora().getTime() + Number(json.expires_in) * 1000 };
    almacen.guardarSesionFirebase(nueva);
    return nueva;
  }

  function obtener(telefono, { forzar = false } = {}) {
    return cola.ejecutar(`fb:${telefono}`, async () => {
      let s = almacen.sesionFirebase(telefono);
      if (!s) {
        s = await crear(telefono);
      } else if (forzar || s.vence - ahora().getTime() < MARGEN_MS) {
        try {
          s = await renovar(s);
        } catch (e) {
          if (e instanceof ErrorBackend && !e.transporte && SESION_PERDIDA.has(e.codigo)) s = await crear(telefono);
          else throw e;
        }
      }
      return { uid: s.uid, idToken: s.idToken };
    });
  }

  // Ejecuta `fn(sesion)`; si el backend responde 401 renueva el token y repite una sola vez.
  async function usar(telefono, fn) {
    const s = await obtener(telefono);
    try {
      return await fn(s);
    } catch (e) {
      if (e instanceof ErrorBackend && e.estado === 401) return fn(await obtener(telefono, { forzar: true }));
      throw e;
    }
  }

  const olvidar = (telefono) => almacen.borrarSesionFirebase(telefono);

  return { obtener, usar, olvidar };
}

module.exports = { crearSesiones };
