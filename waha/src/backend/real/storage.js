// Subida de la foto del comprobante a Firebase Storage con el token del cliente.
// Las reglas del proyecto solo permiten crear en proofs/<uid>/<orden>/<archivo> (imagen o PDF, menos de 8 MB) y no modificar.
const { pedir } = require('./http');

const EXTENSIONES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };
const extensionDe = (mimetype) => EXTENSIONES[String(mimetype || '').toLowerCase()] || 'bin';

function crearStorage({ sesiones, config, fetchImpl = fetch, dormir }) {
  // Devuelve la ruta del archivo en el bucket (la que se pasa a submitProof).
  async function subir(telefono, { ordenId, nombre, mimetype, bytes }) {
    return sesiones.usar(telefono, async (s) => {
      const ruta = `proofs/${s.uid}/${ordenId}/${nombre}`;
      await pedir({
        url: `${config.storageUrl}/v0/b/${config.bucket}/o?name=${encodeURIComponent(ruta)}`, tipoCuerpo: 'binario', tipoContenido: mimetype, cuerpo: bytes,
        encabezados: { authorization: `Firebase ${s.idToken}` }, timeoutMs: 30000, reintentos: 1, fetchImpl, dormir,
      });
      return ruta;
    });
  }
  return { subir };
}

module.exports = { crearStorage, extensionDe };
