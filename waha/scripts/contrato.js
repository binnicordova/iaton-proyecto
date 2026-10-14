// Contrato contra el backend REAL: repite las llamadas seguras y comprueba que la forma de las respuestas coincide con la que
// simula test/helpers/firebase-falso.js (si el backend cambia y el falso no, las pruebas dejarían de decir la verdad).
// No crea órdenes ni deja datos: usa un usuario anónimo propio y lo borra al final.
// Uso: npm run contrato   (necesita FIREBASE_API_KEY en .env)
const path = require('node:path');
const { cargarEnvDeArchivos } = require('../src/config');
const { configBackend } = require('../src/backend/real/config');
const { pedir } = require('../src/backend/real/http');
const { crearFirebaseFalso } = require('../test/helpers/firebase-falso');

const tipo = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// Todo campo (con su tipo) que trae el falso debe venir también en el backend real. Devuelve las diferencias.
function diferencias(falso, real, ruta = '') {
  const faltan = [];
  for (const [k, v] of Object.entries(falso || {})) {
    if (!(k in (real || {}))) { faltan.push(`${ruta}${k}: falta en el backend real`); continue; }
    const r = real[k];
    if (v !== null && r !== null && tipo(v) !== tipo(r)) faltan.push(`${ruta}${k}: el falso da ${tipo(v)} y el real ${tipo(r)}`);
    else if (tipo(v) === 'object' && tipo(r) === 'object') faltan.push(...diferencias(v, r, `${ruta}${k}.`));
  }
  return faltan;
}

(async () => {
  const env = { ...cargarEnvDeArchivos(path.join(__dirname, '..')), ...process.env };
  const real = configBackend(env);
  const falso = await crearFirebaseFalso();
  const filas = [];
  const comprobar = async (nombre, fn) => {
    try { filas.push([nombre, true, (await fn()) || 'ok']); } catch (e) { filas.push([nombre, false, e.message]); }
  };
  const registro = async (c) => (await pedir({ url: `${c.identityUrl}/v1/accounts:signUp?key=${c.apiKey}`, cuerpo: { returnSecureToken: true } })).json;
  const llamar = async (c, token, nombre, data) => (await pedir({ url: c.functionsUrl.replace('{nombre}', nombre.toLowerCase()), encabezados: { authorization: `Bearer ${token}` }, cuerpo: { data } })).json.result;
  const estadoDe = async (fn) => { try { await fn(); return 200; } catch (e) { return e.estado || e.codigo; } };

  let tokenReal = null;
  try {
    const cuentaFalsa = await registro(falso.config);
    await comprobar('Registro anónimo: idToken, localId y refreshToken', async () => {
      const r = await registro(real);
      tokenReal = r.idToken;
      const d = diferencias(cuentaFalsa, r);
      if (d.length) throw new Error(d.join('; '));
    });
    if (tokenReal) {
      const consulta = { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500, channel: 'whatsapp' };
      await comprobar('getRates: misma forma que el falso', async () => {
        const d = diferencias(await llamar(falso.config, cuentaFalsa.idToken, 'getRates', {}), await llamar(real, tokenReal, 'getRates', {}));
        if (d.length) throw new Error(d.join('; '));
      });
      await comprobar('createQuote 500 BRL → PEN: misma forma que el falso', async () => {
        const d = diferencias(await llamar(falso.config, cuentaFalsa.idToken, 'createQuote', consulta), await llamar(real, tokenReal, 'createQuote', consulta));
        if (d.length) throw new Error(d.join('; '));
      });
      await comprobar('Un monto inválido da un código de error estable (en minúsculas con guiones)', async () => {
        try { await llamar(real, tokenReal, 'createQuote', { ...consulta, sendAmount: -5 }); } catch (e) { if (/^[a-z0-9-]+$/.test(e.codigo || '')) return `código ${e.codigo}`; throw new Error(`código ${e.codigo || '(ninguno)'}`); }
        throw new Error('aceptó un monto negativo');
      });
      await comprobar('Una orden ajena y un clients/{otro} no se pueden leer (403/404)', async () => {
        const leer = (ruta) => estadoDe(() => pedir({ url: `${real.firestoreUrl}/${ruta}`, metodo: 'GET', encabezados: { authorization: `Bearer ${tokenReal}` } }));
        const estados = [await leer('orders/BR-0001'), await leer('clients/otro-uid')];
        if (!estados.every((e) => e === 403 || e === 404)) throw new Error(`estados ${estados.join(', ')}`);
        return `HTTP ${estados.join(' y ')}`;
      });
      await comprobar('Se borra el usuario anónimo de prueba', async () => {
        await pedir({ url: `${real.identityUrl}/v1/accounts:delete?key=${real.apiKey}`, cuerpo: { idToken: tokenReal } });
        return 'borrado';
      });
    }
  } finally { await falso.cerrar(); }
  for (const [n, ok, d] of filas) console.log(`${ok ? '✔' : '✘'} ${n}: ${d}`);
  if (filas.some((f) => !f[1])) process.exit(1);
})().catch((e) => { console.error(e.message); process.exit(1); });
