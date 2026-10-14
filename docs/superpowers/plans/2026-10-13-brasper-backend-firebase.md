# Flujo de WhatsApp de BrasPer sobre el backend real (Firebase): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el bot de WhatsApp sea un cliente más del backend real del equipo (proyecto Firebase `aibrasper`): cotiza, crea la orden, sube la foto del comprobante, avisa del estado y entrega el recibo real, con la API simulada como modo de respaldo.

**Architecture:** Un backend "real" implementa las mismas acciones por nombre que ya llama el motor (`({vars, phone, edges, wa}) → {vars, next_edge}`) traduciéndolas a llamadas HTTP: funciones callable de Firebase, lecturas REST de Firestore y subida a Storage, siempre con el token de un usuario anónimo de Firebase por teléfono (sin credenciales de administrador). Cuatro grafos nuevos (E1 a E4 y W0, "v2") sobre el mismo constructor `Flow` usan esas acciones. Un vigilante lee las órdenes abiertas y avisa al cliente cuando el personal las aprueba, rechaza o factura. `BACKEND=simulado` conserva todo lo de hoy.

**Tech Stack:** Node 24 (CommonJS, `node:test`, `node:sqlite`, `fetch`), sin dependencias de npm; Firebase por HTTP (Identity Toolkit, funciones callable, Firestore REST, Storage REST); WAHA; un servidor Firebase falso en proceso para las pruebas.

**Spec:** `docs/superpowers/specs/2026-10-13-brasper-backend-firebase-design.md` (leerlo antes de empezar; este plan lo implementa). También: `docs/superpowers/specs/2026-10-13-brasper-waha-design.md` y `waha/README.md`. Contrato del backend: repositorio `binnicordova/iathon-fintech`, `functions/docs/README.md`.

## Global Constraints

- **Ninguna credencial de administrador** en ningún lado: un usuario anónimo de Firebase por teléfono con la clave web pública (`FIREBASE_API_KEY`, que se lee del entorno, no del código). Los permisos los imponen las reglas del proyecto (spec §2, §7).
- El token de renovación vive solo en SQLite y **nunca** en registros ni en mensajes de error; los errores no incluyen URLs (la de `signUp` lleva la clave) (spec §7).
- Los registros guardan ids de orden, estados, latencias y teléfonos enmascarados; **nunca** documento, correo, número de cuenta, nombre ni el contenido de la foto (spec §7).
- Tras un `createOrder` exitoso se borran de `vars` los datos personales; el estado persistido no guarda el texto de los mensajes del cliente (spec §7).
- Texto libre (nombre, banco, cuenta): recortado, limpiado y **nunca** reinterpretado como plantilla (spec §7).
- `createOrder` no se reintenta a ciegas: ante un resultado dudoso se consulta por `quoteId` y no se duplica la orden. `createQuote` y las lecturas se reintentan una vez (spec §7).
- Errores de transporte (red, timeout de 15 s, 5xx): no se escala a una persona; se avisa "problema temporal" y la conversación queda en el paso que falló (spec §7).
- Canal siempre `"whatsapp"`; idioma fijo `"es"`; el número de orden lo asigna el backend (spec §2).
- `kapso/` no se modifica: los grafos v1 y `brasper-api.js` siguen intactos y son el modo `BACKEND=simulado` (spec §2, §8).
- No se escribe en la base real sin autorización explícita de David en cada hito real (⚑). Las órdenes de prueba reales no se pueden borrar desde el bot.
- Sin dependencias de npm; solo APIs integradas de Node 24. Mensajes al cliente, comentarios y nombres de pruebas en español, como el resto del repositorio.
- Cada commit termina con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Nada de push, force-push ni merge a la rama principal sin aprobación de David.
- Rama de trabajo: `feat/backend-firebase` (ya creada desde `origin/main`).

## Desviaciones respecto al spec

1. **Sin `backend/real/mensajes.js` ni `backend/simulado.js`.** Los textos al cliente viven en los grafos v2 (como en v1) y el simulador sigue siendo `puente-api.js`; `backend/index.js` (`crearBackend`) elige entre ambos. Menos archivos con el mismo comportamiento.
2. **Piezas nuevas no listadas en el spec:** `src/ensamblar.js` (une motor, backend, servidor y vigilante según `BACKEND`, para que `main.js` quede mínimo y el ensamblado se pruebe), `src/backend/real/formato.js` (dinero y hora de Lima en 12 h) y `src/backend/real/errores.js` (`ErrorBackend`).
3. **`BACKEND` vale `simulado` por defecto**, para que nadie escriba en la base real sin querer; el modo real se activa en `.env`.
4. **`/health/backend` usa una sesión anónima propia** (teléfono ficticio `0000000000`) para llamar a `getRates`; crea un usuario anónimo más, sin datos personales.
5. **`npm run contrato` compara la forma con el falso** (cada campo, con su tipo, que da el falso debe existir en la respuesta real) y borra su usuario; no crea órdenes.
6. **El vigilante lee `orders/{id}` con la API REST de Firestore** y trata un 403/404 como "sin acceso": cierra ese seguimiento en lugar de reintentar para siempre.
7. **`getReceipt` antes de que la factura esté aceptada** se espera por `invoiceStatus` (`accepted`), no por el código de error; el código `receipt-not-ready` que el vigilante tolera es una suposición defensiva, sin verificar contra el backend real.
8. **Verificación previa del plan:** el código de las tareas 1 a 9 se extrajo a una copia limpia de `main` más el spec, se ejecutó tarea por tarea (cada paso "ver que fallan" falla y cada "ver que pasan" pasa) y la suite completa quedó en 246 pruebas de `waha/` y 58 de `kapso/`. **No** se probó nada contra el proyecto real: eso es la tarea 10.

## Review Focus

Entradas o condiciones que el spec implica pero que ninguna tarea probaría por defecto. Cada una tiene su prueba en la tarea indicada.

1. **Texto libre con llaves de plantilla** (`{{vars.x}}` en el nombre de un banco): se muestra tal cual, no se interpreta. Prueba en la tarea 7 (`texto libre con llaves de plantilla…`).
2. **Foto enviada antes de tocar "Ya transferí":** no sube nada ni avanza, y el flujo sigue disponible. Prueba en la tarea 7 (`E3: una foto enviada antes…`).
3. **El cliente está en otra conversación cuando el personal aprueba:** el aviso se aplaza y no se da por enviado. Prueba en la tarea 8 (`si el cliente está en otra conversación…`).
4. **El seguimiento de una orden a la que el token ya no da acceso** (usuario anónimo borrado, orden ajena): se cierra y se registra, no se reintenta para siempre ni rompe la revisión de las demás. Prueba en la tarea 8 (`una revisión con fallo no impide…`).
5. **Respuesta perdida de `createOrder` o `submitProof`** (timeout después de que el backend actuó): no se duplica la orden ni se pierde el pago. Pruebas en la tarea 6 (`order_create: si la respuesta se pierde…`, `proof_submit: si la respuesta se pierde…`).

---

## Mapa de archivos

```
waha/
├── .env.example  docker-compose.yml  package.json  README.md          (modificados)
├── scripts/contrato.js                                                  contrato contra el proyecto real
├── src/
│   ├── backend/index.js                crearBackend({modo,…}) → llamarFuncion
│   ├── backend/real/
│   │   ├── errores.js                  ErrorBackend {codigo, estado, detalles, transporte}
│   │   ├── validadores.js              DNI, CE, RUC, CPF, correo, N.º de operación, limpiarTexto
│   │   ├── formato.js                  dinero(), hora12Lima()
│   │   ├── http.js                     pedir(): timeout, reintento de transporte, errores sin URL
│   │   ├── config.js                   configBackend(env)
│   │   ├── sesion.js                   usuario anónimo por teléfono + renovación de token
│   │   ├── funciones.js                llamar(teléfono, nombre, data) a las funciones callable
│   │   ├── firestore.js                leer(), ordenesPorCotizacion(), decodificar()
│   │   ├── storage.js                  subir(), extensionDe()
│   │   └── acciones.js                 las acciones del grafo contra el backend real
│   ├── flujos/v2/                      helpers, e1, e2, e3, e4w0, index (cargarFlujosV2)
│   ├── media.js                        baja la foto desde WAHA
│   ├── vigilante.js                    avisos de aprobación, rechazo y recibo
│   ├── ensamblar.js                    une las piezas según BACKEND
│   ├── estado/{db,almacen}.js          + sesiones_firebase, ordenes, seguimientos     (modificados)
│   ├── motor/motor.js  server.js  config.js  demo.js  main.js  webhook/normalizar.js (modificados)
│   └── scripts/{demo,preflight}.js                                                     (modificados)
└── test/
    ├── helpers/{firebase-falso,mundo-v2}.js
    └── validadores, formato, http-firebase, config-firebase, firebase-falso, sesion-firebase,
        firebase-clientes, media, backend-acciones, flujo-v2, vigilante, ensamblar  (nuevas)
        almacen, motor, normalizar, config, demo, server                            (ampliadas)
```

Todos los comandos se ejecutan desde la raíz del repositorio.

---

### Task 1: Validadores, errores y formato

**Files:**
- Create: `waha/src/backend/real/validadores.js`, `waha/src/backend/real/errores.js`, `waha/src/backend/real/formato.js`
- Test: `waha/test/validadores.test.js`, `waha/test/formato.test.js`

**Interfaces:**
- Produces:
  - `ErrorBackend(mensaje, { codigo?, estado?, detalles?, transporte? })` con esas propiedades; `transporte: true` marca un fallo de red, timeout o 5xx.
  - `validadores`: validación de DNI (8 dígitos), CE (9 a 12 alfanuméricos), RUC (11 dígitos, prefijo 10/15/17/20 y dígito verificador), CPF (11 dígitos con verificador), correo, N.º de operación (4 a 24 letras, dígitos o guion, en mayúsculas), `limpiarTexto`, `ultimos4` (solo letras y dígitos: `0001-12345678-9` → `6789`) y enmascarado de correo. Los nombres exactos son los que exporta el archivo.
  - `dinero(n) -> string` con dos decimales y `hora12Lima(iso) -> string` ("10:15 a. m.", hora de Lima en 12 h).

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/validadores.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/backend/real/validadores');

test('nombre: al menos 3 caracteres y un espacio', () => {
  assert.equal(v.nombreValido('Ana Paula Souza'), true);
  assert.equal(v.nombreValido('  Ana Souza  '), true);
  assert.equal(v.nombreValido('Ana'), false);
  assert.equal(v.nombreValido('A B'), true);
  assert.equal(v.nombreValido('Ab'), false);
  assert.equal(v.nombreValido(''), false);
  assert.equal(v.nombreValido(undefined), false);
});

test('DNI: exactamente 8 dígitos (ignora espacios y puntos)', () => {
  assert.equal(v.documentoValido('DNI', '12345678'), true);
  assert.equal(v.documentoValido('DNI', '1234 5678'), true);
  assert.equal(v.documentoValido('DNI', '1234567'), false);
  assert.equal(v.documentoValido('DNI', '123456789'), false);
  assert.equal(v.documentoValido('DNI', 'abcdefgh'), false);
});

test('CE: 9 a 12 caracteres alfanuméricos, sin distinguir mayúsculas', () => {
  assert.equal(v.documentoValido('CE', '001234567'), true);
  assert.equal(v.documentoValido('CE', 'ab1234567xyz'), true);
  assert.equal(v.documentoValido('CE', '12345678'), false);
  assert.equal(v.documentoValido('CE', '1234567890123'), false);
  assert.equal(v.documentoValido('CE', '12345-6789'), false);
});

test('CPF: 11 dígitos con dígito verificador y sin todos iguales', () => {
  assert.equal(v.documentoValido('CPF', '52998224725'), true);
  assert.equal(v.documentoValido('CPF', '529.982.247-25'), true);
  assert.equal(v.documentoValido('CPF', '52998224724'), false);
  assert.equal(v.documentoValido('CPF', '11111111111'), false);
  assert.equal(v.documentoValido('CPF', '5299822472'), false);
});

test('RUC: 11 dígitos con prefijo 10, 15, 17 o 20 y dígito verificador', () => {
  assert.equal(v.documentoValido('RUC', '20100070970'), true);
  assert.equal(v.documentoValido('RUC', '10123456789'), false); // dígito verificador incorrecto
  assert.equal(v.documentoValido('RUC', '30100070970'), false); // prefijo no permitido
  assert.equal(v.documentoValido('RUC', '2010007097'), false);
});

test('normalizarDocumento: CE en mayúsculas sin espacios; el resto, solo dígitos', () => {
  assert.equal(v.normalizarDocumento('CE', ' ab1234567 '), 'AB1234567');
  assert.equal(v.normalizarDocumento('DNI', '1234 5678'), '12345678');
  assert.equal(v.normalizarDocumento('CPF', '529.982.247-25'), '52998224725');
});

test('correo, número de operación y cuenta', () => {
  assert.equal(v.correoValido('ana@example.com'), true);
  assert.equal(v.correoValido(' ana@example.com '), true);
  assert.equal(v.correoValido('ana@example'), false);
  assert.equal(v.correoValido('ana example@x.com'), false);
  assert.equal(v.operacionValida('ABC-1234'), true);
  assert.equal(v.operacionValida('123'), false);
  assert.equal(v.operacionValida('1234567890123456789012345'), false);
  assert.equal(v.operacionValida('12 34'), false);
  assert.equal(v.cuentaValida('0001-12345678-9'), true);
  assert.equal(v.cuentaValida('123'), false);
  assert.equal(v.cuentaValida('  1234  '), true);
});

test('enmascarar correo y cuenta para mostrarlos al cliente', () => {
  assert.equal(v.enmascararCorreo('ana.souza@example.com'), 'a***@example.com');
  assert.equal(v.enmascararCorreo('x@y.com'), 'x***@y.com');
  assert.equal(v.enmascararCorreo('sin-arroba'), '***');
  assert.equal(v.ultimos4('191-1234567890'), '7890');
  assert.equal(v.ultimos4('123'), '123');
  assert.equal(v.ultimos4('0001-12345678-9'), '6789');
});

test('limpiarTexto recorta, colapsa espacios y quita caracteres de control', () => {
  assert.equal(v.limpiarTexto('  Banco   do\u0000 Brasil \n', 60), 'Banco do Brasil');
  assert.equal(v.limpiarTexto('x'.repeat(100), 10), 'xxxxxxxxxx');
  assert.equal(v.limpiarTexto(undefined, 10), '');
});
```

`waha/test/formato.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { dinero, hora12Lima } = require('../src/backend/real/formato');

test('dinero siempre con dos decimales', () => {
  assert.equal(dinero(500), '500.00');
  assert.equal(dinero(337.25), '337.25');
  assert.equal(dinero(2.1), '2.10');
  assert.equal(dinero('12'), '12.00');
  assert.equal(dinero(undefined), '');
  assert.equal(dinero(null), '');
});

test('hora12Lima: hora de Lima (UTC-5) en 12 horas con a. m. / p. m.', () => {
  assert.equal(hora12Lima('2026-10-13T21:47:57.093Z'), '4:47 p. m.');
  assert.equal(hora12Lima('2026-10-13T17:05:00Z'), '12:05 p. m.'); // mediodía en Lima
  assert.equal(hora12Lima('2026-10-13T05:25:00Z'), '12:25 a. m.'); // medianoche en Lima
  assert.equal(hora12Lima('2026-10-13T12:00:00Z'), '7:00 a. m.');
  assert.equal(hora12Lima('2026-10-14T00:30:00Z'), '7:30 p. m.');
  assert.equal(hora12Lima('basura'), '');
  assert.equal(hora12Lima(undefined), '');
});
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test waha/test/validadores.test.js waha/test/formato.test.js`
Expected: FAIL (Cannot find module `../src/backend/real/validadores`)

- [ ] **Step 3: Escribir el código**

`waha/src/backend/real/errores.js`:

```js
// Error de una llamada a Firebase. `transporte` distingue lo que no es culpa del cliente ni del flujo
// (red caída, timeout, 5xx sin código) de un error de negocio con código estable (`invalid-input`, `quote-expired`…).
class ErrorBackend extends Error {
  constructor(mensaje, { codigo = null, estado = null, detalles = null, transporte = false } = {}) {
    super(mensaje);
    this.name = 'ErrorBackend';
    this.codigo = codigo;
    this.estado = estado;
    this.detalles = detalles;
    this.transporte = transporte;
  }
}

module.exports = { ErrorBackend };
```

`waha/src/backend/real/validadores.js`:

```js
// Validadores del backend de BrasPer (misma regla que functions/ y src/domain/validators.ts del repositorio del equipo).
// El bot los aplica antes para responder al instante; la autoridad final es el backend.

const soloDigitos = (v) => String(v === undefined || v === null ? '' : v).replace(/\D/g, '');

function normalizarDocumento(tipo, valor) {
  const s = String(valor === undefined || valor === null ? '' : valor);
  return tipo === 'CE' ? s.trim().toUpperCase() : soloDigitos(s);
}

function cpfValido(valor) {
  const cpf = soloDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (largo) => {
    let suma = 0;
    for (let i = 0; i < largo; i += 1) suma += Number(cpf[i]) * (largo + 1 - i);
    const resto = (suma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

function rucValido(valor) {
  const ruc = soloDigitos(valor);
  if (ruc.length !== 11 || !/^(10|15|17|20)/.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(ruc[i]), 0);
  return (11 - (suma % 11)) % 10 === Number(ruc[10]);
}

function documentoValido(tipo, valor) {
  switch (tipo) {
    case 'DNI': return /^\d{8}$/.test(soloDigitos(valor));
    case 'CE': return /^[A-Z0-9]{9,12}$/.test(String(valor === undefined || valor === null ? '' : valor).trim().toUpperCase());
    case 'RUC': return rucValido(valor);
    case 'CPF': return cpfValido(valor);
    default: return false;
  }
}

const correoValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v === undefined || v === null ? '' : v).trim());
const nombreValido = (v) => {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return s.length >= 3 && /\s/.test(s);
};
const operacionValida = (v) => /^[A-Za-z0-9-]{4,24}$/.test(String(v === undefined || v === null ? '' : v).trim());
const cuentaValida = (v) => String(v === undefined || v === null ? '' : v).trim().length >= 4;

// Para mostrar al cliente sin exponer el dato completo.
function enmascararCorreo(correo) {
  const s = String(correo || '');
  const i = s.indexOf('@');
  return i < 1 ? '***' : `${s[0]}***${s.slice(i)}`;
}
const ultimos4 = (cuenta) => String(cuenta || '').replace(/[^0-9A-Za-z]/g, '').slice(-4);

// Texto libre del cliente (nombre, banco, cuenta): sin controles, espacios colapsados y con largo máximo.
function limpiarTexto(valor, max) {
  // eslint-disable-next-line no-control-regex
  return String(valor === undefined || valor === null ? '' : valor).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = {
  soloDigitos, normalizarDocumento, documentoValido, cpfValido, rucValido,
  correoValido, nombreValido, operacionValida, cuentaValida, enmascararCorreo, ultimos4, limpiarTexto,
};
```

`waha/src/backend/real/formato.js`:

```js
// Formatos de texto para los mensajes del chat.
const pad2 = (n) => String(n).padStart(2, '0');

const dinero = (n) => (n === undefined || n === null || n === '' || Number.isNaN(Number(n)) ? '' : Number(n).toFixed(2));

// Hora de Lima (UTC-5, sin horario de verano) como la escribe el cliente en Perú: "4:47 p. m.", "12:05 p. m.".
function hora12Lima(iso) {
  const f = new Date(iso);
  if (!iso || Number.isNaN(f.getTime())) return '';
  const lima = new Date(f.getTime() - 5 * 3600 * 1000);
  const h = lima.getUTCHours();
  return `${((h + 11) % 12) + 1}:${pad2(lima.getUTCMinutes())} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

module.exports = { dinero, hora12Lima };
```

- [ ] **Step 4: Ver que pasan**

Run: `node --test waha/test/validadores.test.js waha/test/formato.test.js`
Expected: PASS, 0 fallos

- [ ] **Commit**

```bash
git add waha/src/backend/real/errores.js waha/src/backend/real/validadores.js waha/src/backend/real/formato.js waha/test/validadores.test.js waha/test/formato.test.js
git commit -m "feat(waha): validadores, errores y formato del backend real

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 2: Cliente HTTP y configuración del backend

**Files:**
- Create: `waha/src/backend/real/http.js`, `waha/src/backend/real/config.js`
- Test: `waha/test/http-firebase.test.js`, `waha/test/config-firebase.test.js`

**Interfaces:**
- Consumes: `ErrorBackend` (tarea 1).
- Produces:
  - `pedir({ url, metodo='POST', encabezados, cuerpo, tipoCuerpo='json'|'form'|'binario', tipoContenido, timeoutMs=15000, reintentos=0, fetchImpl, dormir }) -> { estado, json }`. Reintenta solo fallos de transporte (backoff 300 ms · 2^n). Lanza `ErrorBackend` cuyo `codigo` es el código estable de la función (`quote-expired`…) o de Identity (`TOKEN_EXPIRED`…) y **nunca** incluye la URL.
  - `configBackend(env) -> { apiKey, projectId, bucket, identityUrl, tokenUrl, functionsUrl ('…{nombre}…'), firestoreUrl, storageUrl }`; lanza si falta `FIREBASE_API_KEY`. Cada URL se puede cambiar por entorno (las pruebas apuntan al falso).

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/http-firebase.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { pedir } = require('../src/backend/real/http');
const { ErrorBackend } = require('../src/backend/real/errores');

const URL_SECRETA = 'https://identitytoolkit.example/v1/accounts:signUp?key=CLAVE_QUE_NO_DEBE_FILTRARSE';
const respuesta = (estado, json) => ({ ok: estado >= 200 && estado < 300, status: estado, text: async () => (json === undefined ? '' : typeof json === 'string' ? json : JSON.stringify(json)) });
const sinEspera = async () => {};
const conRespuestas = (...rs) => {
  const llamadas = [];
  const fetchImpl = async (url, init) => { llamadas.push({ url, init }); const r = rs.shift(); if (r instanceof Error) throw r; return r; };
  return { fetchImpl, llamadas };
};
const falla = async (fn) => { try { await fn(); } catch (e) { return e; } assert.fail('debía lanzar'); };

test('una respuesta correcta devuelve estado y JSON', async () => {
  const { fetchImpl, llamadas } = conRespuestas(respuesta(200, { result: { ok: true } }));
  const r = await pedir({ url: URL_SECRETA, cuerpo: { data: {} }, encabezados: { authorization: 'Bearer x' }, fetchImpl });
  assert.deepEqual(r, { estado: 200, json: { result: { ok: true } } });
  assert.equal(llamadas[0].init.method, 'POST');
  assert.equal(llamadas[0].init.headers['content-type'], 'application/json');
  assert.equal(llamadas[0].init.headers.authorization, 'Bearer x');
  assert.equal(llamadas[0].init.body, '{"data":{}}');
});

test('los tres tipos de cuerpo: json, form y binario', async () => {
  const { fetchImpl, llamadas } = conRespuestas(respuesta(200, {}), respuesta(200, {}));
  await pedir({ url: 'http://x', tipoCuerpo: 'form', cuerpo: { grant_type: 'refresh_token', refresh_token: 'a b' }, fetchImpl });
  assert.equal(llamadas[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(llamadas[0].init.body, 'grant_type=refresh_token&refresh_token=a+b');
  const bytes = Buffer.from([1, 2, 3]);
  await pedir({ url: 'http://x', tipoCuerpo: 'binario', tipoContenido: 'image/jpeg', cuerpo: bytes, fetchImpl });
  assert.equal(llamadas[1].init.headers['content-type'], 'image/jpeg');
  assert.equal(llamadas[1].init.body, bytes);
});

test('error de una función: el código estable queda en codigo y no es de transporte', async () => {
  const { fetchImpl } = conRespuestas(respuesta(400, { error: { status: 'INVALID_ARGUMENT', message: 'invalid-input', details: [{ path: 'docNumber', message: 'x' }] } }));
  const e = await falla(() => pedir({ url: URL_SECRETA, fetchImpl }));
  assert.ok(e instanceof ErrorBackend);
  assert.equal(e.name, 'ErrorBackend');
  assert.equal(e.codigo, 'invalid-input');
  assert.equal(e.estado, 400);
  assert.deepEqual(e.detalles, [{ path: 'docNumber', message: 'x' }]);
  assert.equal(e.transporte, false);
});

test('error de Identity Toolkit (MAYÚSCULAS) y de Firestore (usa el status)', async () => {
  const { fetchImpl } = conRespuestas(
    respuesta(400, { error: { code: 400, message: 'TOKEN_EXPIRED' } }),
    respuesta(404, { error: { code: 404, message: 'Document "projects/p/x" not found.', status: 'NOT_FOUND' } }),
  );
  assert.equal((await falla(() => pedir({ url: 'http://x', fetchImpl }))).codigo, 'TOKEN_EXPIRED');
  const e = await falla(() => pedir({ url: 'http://x', fetchImpl }));
  assert.equal(e.codigo, 'NOT_FOUND');
  assert.equal(e.estado, 404);
});

test('un 503 con código estable (rates-unavailable) es un error de negocio; sin código es de transporte', async () => {
  const { fetchImpl } = conRespuestas(respuesta(503, { error: { status: 'UNAVAILABLE', message: 'rates-unavailable' } }), respuesta(502, '<html>Bad Gateway</html>'));
  const a = await falla(() => pedir({ url: 'http://x', fetchImpl }));
  assert.equal(a.codigo, 'rates-unavailable');
  assert.equal(a.transporte, false);
  const b = await falla(() => pedir({ url: 'http://x', fetchImpl }));
  assert.equal(b.transporte, true);
});

test('red caída y timeout son errores de transporte y el mensaje nunca incluye la URL ni la clave', async () => {
  const { fetchImpl } = conRespuestas(new Error(`fetch failed ${URL_SECRETA}`));
  const e = await falla(() => pedir({ url: URL_SECRETA, fetchImpl }));
  assert.equal(e.transporte, true);
  assert.ok(!e.message.includes('CLAVE_QUE_NO_DEBE_FILTRARSE') && !e.message.includes('identitytoolkit'));
  const lenta = (url, init) => new Promise((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(new Error(`abortado ${url}`))));
  const t = await falla(() => pedir({ url: URL_SECRETA, fetchImpl: lenta, timeoutMs: 20 }));
  assert.equal(t.transporte, true);
  assert.equal(t.codigo, 'timeout');
  assert.ok(!t.message.includes('CLAVE_QUE_NO_DEBE_FILTRARSE'));
});

test('reintenta solo los errores de transporte, con espera creciente', async () => {
  const esperas = [];
  const { fetchImpl, llamadas } = conRespuestas(respuesta(502, ''), new Error('red'), respuesta(200, { ok: 1 }));
  const r = await pedir({ url: 'http://x', fetchImpl, reintentos: 2, dormir: async (ms) => esperas.push(ms) });
  assert.equal(r.estado, 200);
  assert.equal(llamadas.length, 3);
  assert.deepEqual(esperas, [300, 600]);
  const negocio = conRespuestas(respuesta(400, { error: { message: 'invalid-input' } }), respuesta(200, {}));
  await falla(() => pedir({ url: 'http://x', fetchImpl: negocio.fetchImpl, reintentos: 2, dormir: sinEspera }));
  assert.equal(negocio.llamadas.length, 1);
});

test('agota los reintentos y lanza el último error de transporte', async () => {
  const { fetchImpl, llamadas } = conRespuestas(respuesta(500, ''), respuesta(500, ''));
  const e = await falla(() => pedir({ url: 'http://x', fetchImpl, reintentos: 1, dormir: sinEspera }));
  assert.equal(e.transporte, true);
  assert.equal(llamadas.length, 2);
});
```

`waha/test/config-firebase.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { configBackend } = require('../src/backend/real/config');

test('exige la clave web y nombra la variable sin imprimir valores', () => {
  assert.throws(() => configBackend({}), /FIREBASE_API_KEY/);
});

test('el proyecto aibrasper es el valor por defecto y de él salen el bucket y las URL', () => {
  const c = configBackend({ FIREBASE_API_KEY: 'k' });
  assert.equal(c.projectId, 'aibrasper');
  assert.equal(c.bucket, 'aibrasper.firebasestorage.app');
  assert.equal(c.functionsUrl, 'https://{nombre}-h5wenirx2q-rj.a.run.app');
  assert.equal(c.firestoreUrl, 'https://firestore.googleapis.com/v1/projects/aibrasper/databases/(default)/documents');
  assert.equal(c.identityUrl, 'https://identitytoolkit.googleapis.com');
});

test('cualquier URL o el proyecto se pueden cambiar por entorno (las pruebas apuntan al servidor falso)', () => {
  const c = configBackend({ FIREBASE_API_KEY: 'k', FIREBASE_PROJECT_ID: 'otro', FIREBASE_FUNCTIONS_URL: 'http://x/{nombre}' });
  assert.equal(c.bucket, 'otro.firebasestorage.app');
  assert.match(c.firestoreUrl, /projects\/otro\//);
  assert.equal(c.functionsUrl, 'http://x/{nombre}');
});
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test waha/test/http-firebase.test.js waha/test/config-firebase.test.js`
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Escribir el código**

`waha/src/backend/real/http.js`:

```js
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
```

`waha/src/backend/real/config.js`:

```js
// Configuración del backend real (proyecto Firebase de BrasPer). La clave web es pública pero se lee del entorno, no del código.
function configBackend(env) {
  if (!env.FIREBASE_API_KEY) throw new Error('falta FIREBASE_API_KEY en .env (la clave web pública de Firebase) para BACKEND=real');
  const projectId = env.FIREBASE_PROJECT_ID || 'aibrasper';
  return {
    apiKey: env.FIREBASE_API_KEY,
    projectId,
    bucket: env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    identityUrl: env.FIREBASE_IDENTITY_URL || 'https://identitytoolkit.googleapis.com',
    tokenUrl: env.FIREBASE_TOKEN_URL || 'https://securetoken.googleapis.com',
    // Las funciones callable se sirven en https://<nombre-en-minúsculas>-<hash>.a.run.app
    functionsUrl: env.FIREBASE_FUNCTIONS_URL || 'https://{nombre}-h5wenirx2q-rj.a.run.app',
    firestoreUrl: env.FIREBASE_FIRESTORE_URL || `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`,
    storageUrl: env.FIREBASE_STORAGE_URL || 'https://firebasestorage.googleapis.com',
  };
}

module.exports = { configBackend };
```

- [ ] **Step 4: Ver que pasan**

Run: `node --test waha/test/http-firebase.test.js waha/test/config-firebase.test.js`
Expected: PASS, 0 fallos

- [ ] **Commit**

```bash
git add waha/src/backend/real/http.js waha/src/backend/real/config.js waha/test/http-firebase.test.js waha/test/config-firebase.test.js
git commit -m "feat(waha): cliente HTTP y configuración del backend real

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 3: Servidor Firebase falso para las pruebas

**Files:**
- Create: `waha/test/helpers/firebase-falso.js`
- Test: `waha/test/firebase-falso.test.js`

**Interfaces:**
- Consumes: `validadores` (tarea 1).
- Produces: `crearFirebaseFalso() -> Promise<Falso>` (servidor HTTP en proceso, `unref`) con `Falso.config` (mismas claves que `configBackend`), `apiKey`, `bucket`, `cerrar()`, los mapas `llamadas`, `ordenes`, `clientes`, `cotizaciones`, `archivos`, `tickets`, `usuarios` y el control de la prueba: `avanzar(min)`, `fallar(ruta, {estado, veces, cuerpo})`, `demorar(ruta, ms, {veces, despuesDeEfecto})`, `expirarTokens()`, `borrarUsuario(uid)`, y el personal simulado `aprobar/rechazar(id, motivo)/exportar/facturar(id)`. Imita Identity Toolkit (alta anónima, renovación, `accounts:delete`), las funciones del contrato con sus validaciones y códigos de error (rutas en minúsculas: `/fn/createorder`), lecturas REST con la regla de dueño (403), la consulta por `quoteId` y Storage con sus límites. También exporta `CUENTAS_PAGO` y `PRECIOS`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/firebase-falso.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

async function conFalso(fn, opciones) {
  const f = await crearFirebaseFalso(opciones);
  try { await fn(f); } finally { await f.cerrar(); }
}
const alta = async (f) => (await (await fetch(`${f.config.identityUrl}/v1/accounts:signUp?key=${f.apiKey}`, { method: 'POST', body: '{}' })).json());
const fn = async (f, nombre, token, data) => {
  const r = await fetch(f.config.functionsUrl.replace('{nombre}', nombre), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ data }) });
  return { estado: r.status, json: await r.json() };
};
const DATOS = { language: 'es', clientName: 'Ana Paula Souza', docType: 'CPF', docNumber: '52998224725', email: 'ana@example.com', fundsSource: 'savings', sourceBank: 'Nubank', sourceAccount: '0001-12345678-9', destinationBank: 'BCP', destinationAccount: '191-1234567890' };

test('la cotización de 500 BRL a PEN reproduce las cifras de la prueba de humo real', () => conFalso(async (f) => {
  const u = await alta(f);
  const r = await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500, channel: 'whatsapp' });
  assert.equal(r.estado, 200);
  const q = r.json.result;
  assert.deepEqual([q.rate, q.commission, q.tax, q.total, q.receiveAmount, q.channel, q.status, q.requiresHuman], [0.6745, 12, 2.16, 514.16, 337.25, 'whatsapp', 'open', false]);
  assert.equal(new Date(q.expiresAt) - new Date(q.createdAt), 15 * 60_000);
}));

test('códigos de error de createQuote: misma moneda, monto mínimo y monto grande', () => conFalso(async (f) => {
  const { idToken } = await alta(f);
  const err = async (data) => (await fn(f, 'createQuote', idToken, data)).json.error.message;
  assert.equal(await err({ sendCurrency: 'BRL', receiveCurrency: 'BRL', sendAmount: 100 }), 'same-currency');
  assert.equal(await err({ sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 10 }), 'amount-too-small');
  assert.equal(await err({ sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 20000 }), 'requires-human');
  assert.equal(await err({ sendCurrency: 'BRL', receiveCurrency: 'PEN' }), 'invalid-input');
}));

test('createOrder numera desde el contador, guarda el perfil y consume la cotización', () => conFalso(async (f) => {
  const u = await alta(f);
  const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500, channel: 'whatsapp' })).json.result;
  const o = (await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS })).json.result;
  assert.equal(o.orderId, 'BR-0001');
  assert.equal(o.status, 'pending');
  assert.equal(o.paymentAccount.bank, 'Nubank');
  assert.equal(f.clientes.get(u.localId).accounts.length, 2);
  const otra = (await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS })).json.error.message;
  assert.equal(otra, 'quote-already-used');
}, { desdeOrden: 1 }));

test('una cotización vencida da quote-expired (504) y los datos malos dan invalid-input con el campo', () => conFalso(async (f) => {
  const u = await alta(f);
  const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  const malo = await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS, docNumber: '52998224724' });
  assert.equal(malo.estado, 400);
  assert.deepEqual(malo.json.error.details.map((d) => d.path), ['docNumber']);
  f.avanzar(16);
  const vencida = await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS });
  assert.equal(vencida.estado, 504);
  assert.equal(vencida.json.error.message, 'quote-expired');
}));

test('las reglas de lectura: la orden ajena da 403, el propio cliente inexistente da 404', () => conFalso(async (f) => {
  const a = await alta(f); const b = await alta(f);
  const q = (await fn(f, 'createQuote', a.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  await fn(f, 'createOrder', a.idToken, { quoteId: q.id, ...DATOS });
  const leer = (token, ruta) => fetch(`${f.config.firestoreUrl}/${ruta}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await leer(b.idToken, 'orders/BR-0001')).status, 403);
  assert.equal((await leer(a.idToken, 'orders/BR-0001')).status, 200);
  assert.equal((await leer(b.idToken, `clients/${b.localId}`)).status, 404);
  assert.equal((await leer(b.idToken, `clients/${a.localId}`)).status, 403);
}));

test('subida a Storage: solo a la carpeta propia, imagen o PDF, sin sobrescribir', () => conFalso(async (f) => {
  const u = await alta(f);
  const subir = (ruta, tipo, bytes = Buffer.from('x')) => fetch(`${f.config.storageUrl}/v0/b/${f.bucket}/o?name=${encodeURIComponent(ruta)}`, { method: 'POST', headers: { authorization: `Firebase ${u.idToken}`, 'content-type': tipo }, body: bytes });
  assert.equal((await subir(`proofs/${u.localId}/BR-0001/p.jpg`, 'image/jpeg')).status, 200);
  assert.equal((await subir(`proofs/${u.localId}/BR-0001/p.jpg`, 'image/jpeg')).status, 403);
  assert.equal((await subir('proofs/otro/BR-0001/p.jpg', 'image/jpeg')).status, 403);
  assert.equal((await subir(`proofs/${u.localId}/BR-0001/v.mp4`, 'video/mp4')).status, 403);
  assert.equal((await subir(`proofs/${u.localId}/BR-0001/g.jpg`, 'image/jpeg', Buffer.alloc(8 * 1024 * 1024))).status, 403);
}));

test('submitProof exige foto subida, número válido y no duplicado; la orden pasa a validating', () => conFalso(async (f) => {
  const u = await alta(f);
  const crear = async () => {
    const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
    return (await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS })).json.result.orderId;
  };
  const o1 = await crear(); const o2 = await crear();
  const ruta = (o) => `proofs/${u.localId}/${o}/p.jpg`;
  const sinFoto = await fn(f, 'submitProof', u.idToken, { orderId: o1, operationNo: 'ab-1234', proofPath: ruta(o1) });
  assert.equal(sinFoto.json.error.message, 'proof-not-uploaded');
  f.archivos.set(ruta(o1), { bytes: Buffer.from('x'), contentType: 'image/jpeg' });
  f.archivos.set(ruta(o2), { bytes: Buffer.from('x'), contentType: 'image/jpeg' });
  assert.equal((await fn(f, 'submitProof', u.idToken, { orderId: o1, operationNo: '12', proofPath: ruta(o1) })).json.error.message, 'invalid-operation-no');
  assert.equal((await fn(f, 'submitProof', u.idToken, { orderId: o1, operationNo: 'ab-1234', proofPath: ruta(o1) })).json.result.ok, true);
  assert.equal(f.ordenes.get(o1).status, 'validating');
  assert.equal(f.ordenes.get(o1).operationNo, 'AB-1234');
  assert.equal((await fn(f, 'submitProof', u.idToken, { orderId: o2, operationNo: 'AB-1234', proofPath: ruta(o2) })).json.error.message, 'operation-no-duplicate');
  assert.equal((await fn(f, 'submitProof', u.idToken, { orderId: o1, operationNo: 'AB-9999', proofPath: ruta(o1) })).json.error.message, 'order-not-pending');
}));

test('el personal simulado mueve la orden y getReceipt solo responde con la factura aceptada', () => conFalso(async (f) => {
  const u = await alta(f);
  const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  const id = (await fn(f, 'createOrder', u.idToken, { quoteId: q.id, ...DATOS })).json.result.orderId;
  f.archivos.set(`proofs/${u.localId}/${id}/p.jpg`, { bytes: Buffer.from('x'), contentType: 'image/jpeg' });
  await fn(f, 'submitProof', u.idToken, { orderId: id, operationNo: 'AB-1234', proofPath: `proofs/${u.localId}/${id}/p.jpg` });
  assert.throws(() => f.exportar(id), /transición ilegal/);
  f.aprobar(id); f.exportar(id);
  assert.equal((await fn(f, 'getReceipt', u.idToken, { orderId: id })).json.error.message, 'receipt-not-ready');
  f.facturar(id);
  const r = (await fn(f, 'getReceipt', u.idToken, { orderId: id })).json.result;
  assert.equal(r.contentType, 'application/pdf');
  assert.match(Buffer.from(r.base64, 'base64').toString(), /^%PDF-1.4/);
}));

test('tokens: vencidos dan 401, se renuevan con el refresh y un usuario borrado no puede renovar', () => conFalso(async (f) => {
  const u = await alta(f);
  f.expirarTokens();
  assert.equal((await fn(f, 'getRates', u.idToken, {})).estado, 401);
  const refrescar = (refresh) => fetch(`${f.config.tokenUrl}/v1/token?key=${f.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString() });
  const nuevo = await (await refrescar(u.refreshToken)).json();
  assert.equal((await fn(f, 'getRates', nuevo.id_token, {})).estado, 200);
  f.borrarUsuario(u.localId);
  const r = await refrescar(u.refreshToken);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.message, 'TOKEN_EXPIRED');
}));

test('inyección de fallos: 502 un número limitado de veces y después responde bien', () => conFalso(async (f) => {
  const u = await alta(f);
  f.fallar('getRates', { estado: 502, veces: 2 });
  const estados = [];
  for (let i = 0; i < 3; i++) estados.push((await fn(f, 'getRates', u.idToken, {}).catch(() => ({ estado: 'sin-json' }))).estado);
  assert.deepEqual(estados, ['sin-json', 'sin-json', 200]);
}));

test('createOrder con demora después del efecto: la orden se crea aunque el cliente se rinda', () => conFalso(async (f) => {
  const u = await alta(f);
  const q = (await fn(f, 'createQuote', u.idToken, { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500 })).json.result;
  f.demorar('createOrder', 300, { despuesDeEfecto: true });
  await fetch(f.config.functionsUrl.replace('{nombre}', 'createOrder'), { method: 'POST', headers: { authorization: `Bearer ${u.idToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ data: { quoteId: q.id, ...DATOS } }), signal: AbortSignal.timeout(50) }).catch(() => {});
  assert.equal(f.ordenes.size, 1);
}));

test('accounts:delete borra al usuario: su token deja de servir y su refresco da TOKEN_EXPIRED', () => conFalso(async (f) => {
  const u = await alta(f);
  const r = await fetch(`${f.config.identityUrl}/v1/accounts:delete?key=${f.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: u.idToken }) });
  assert.equal(r.status, 200);
  assert.equal((await fn(f, 'getRates', u.idToken, {})).estado, 401);
  const refresco = await fetch(`${f.config.tokenUrl}/v1/token?key=${f.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${u.refreshToken}` });
  assert.equal((await refresco.json()).error.message, 'TOKEN_EXPIRED');
}));
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test waha/test/firebase-falso.test.js`
Expected: FAIL (Cannot find module `./helpers/firebase-falso`)

- [ ] **Step 3: Escribir el código**

`waha/test/helpers/firebase-falso.js`:

```js
// Servidor HTTP que imita el contrato publicado del backend de BrasPer (proyecto aibrasper): Identity Toolkit, las funciones
// callable, lecturas REST de Firestore con las reglas de dueño y la subida a Storage. Solo para pruebas.
// Las cifras de la cotización reproducen las de la prueba de humo real (500 BRL → PEN: tasa 0.6745, total 514.16).
const http = require('node:http');
const { documentoValido, normalizarDocumento, correoValido, nombreValido, operacionValida, cuentaValida } = require('../../src/backend/real/validadores');

const TASAS_USD = { USD: 1, BRL: 4.989911, PEN: 3.434509 };
const PRECIOS = { spreadBps: 200, commissionBps: 240, taxBps: 1800, quoteTtlMinutes: 15, rateLockMinutes: 30, ratesRefreshMinutes: 60, largeAmountUsd: 3000, minSendUsd: 10 };
const MONEDAS = ['BRL', 'PEN', 'USD'];
const DOCS = ['DNI', 'CE', 'RUC', 'CPF'];
const FONDOS = ['savings', 'salary', 'business', 'asset_sale', 'donation', 'other'];
const CUENTAS_PAGO = {
  BRL: { currency: 'BRL', holder: 'BrasPer (DEMO)', bank: 'Nubank', accountNumber: '0001-0000001-0', pixKey: 'pix@brasper.demo', demo: true },
  PEN: { currency: 'PEN', holder: 'BrasPer (DEMO)', bank: 'BCP', accountNumber: '191-0000000-0-00', demo: true },
  USD: { currency: 'USD', holder: 'BrasPer (DEMO)', bank: 'BCP', accountNumber: '191-0000000-1-11', demo: true },
};
const MAX_PRUEBA = 8 * 1024 * 1024;
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;

// Valores tipados de Firestore, como los devuelve la API REST.
function codificar(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(codificar) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, codificar(x)])) } };
}
const documento = (ruta, datos) => ({ name: `projects/aibrasper/databases/(default)/documents/${ruta}`, fields: codificar(datos).mapValue.fields });

class ErrorHttp extends Error {
  constructor(estado, grpc, mensaje, detalles) { super(mensaje); this.estado = estado; this.grpc = grpc; this.detalles = detalles; }
}
const negocio = (estado, grpc, mensaje, detalles) => new ErrorHttp(estado, grpc, mensaje, detalles);

async function crearFirebaseFalso({ apiKey = 'CLAVE_PUBLICA_FALSA', bucket = 'aibrasper.firebasestorage.app', desdeOrden = 1, ahora = () => new Date(), tasas = TASAS_USD, tokenSegundos = 3600 } = {}) {
  let reloj = 0; // minutos que se han "avanzado" con avanzar()
  const ahoraSim = () => new Date(ahora().getTime() + reloj * 60_000);
  const usuarios = new Map(); // uid → { refresh }
  const tokens = new Map(); // idToken → { uid, vence }
  const refrescos = new Map(); // refresh → uid
  const cotizaciones = new Map();
  const ordenes = new Map();
  const clientes = new Map();
  const archivos = new Map();
  const tickets = new Map();
  const llamadas = [];
  const fallos = []; // { ruta, estado, cuerpo, veces } | { ruta, demora, veces, despuesDeEfecto }
  let nUsuarios = 0; let nCot = 0; let seq = desdeOrden - 1; let nTickets = 0; let nTokens = 0;

  const nuevoToken = (uid) => {
    const t = `tok.${uid}.${(nTokens += 1)}`;
    tokens.set(t, { uid, vence: ahoraSim().getTime() + tokenSegundos * 1000 });
    return t;
  };
  const crearUsuario = () => {
    const uid = `uid${String((nUsuarios += 1)).padStart(3, '0')}`;
    const refresh = `refresh.${uid}`;
    usuarios.set(uid, { refresh });
    refrescos.set(refresh, uid);
    return { uid, refresh, idToken: nuevoToken(uid) };
  };
  const autenticar = (cabecera, prefijo) => {
    const m = new RegExp(`^${prefijo} (.+)$`).exec(cabecera || '');
    const t = m && tokens.get(m[1]);
    if (!t || t.vence <= ahoraSim().getTime() || !usuarios.has(t.uid)) throw negocio(401, 'UNAUTHENTICATED', 'sign-in-required');
    return t.uid;
  };

  const precio = (envia, recibe, monto, esEnvio) => {
    const mercado = tasas[recibe] / tasas[envia];
    const tasa = r4(mercado * (1 - PRECIOS.spreadBps / 10000));
    const envio = esEnvio ? monto : r2(monto / tasa);
    const comision = r2((envio * PRECIOS.commissionBps) / 10000);
    const impuesto = r2((comision * PRECIOS.taxBps) / 10000);
    return { sendAmount: envio, receiveAmount: esEnvio ? r2(envio * tasa) : monto, marketRate: r4(mercado), rate: tasa, commission: comision, tax: impuesto, total: r2(envio + comision + impuesto) };
  };

  const funciones = {
    getRates() {
      const t = ahoraSim().toISOString();
      return { market: { base: 'USD', rates: tasas, source: 'open.er-api.com', fetchedAt: t, nextUpdateAt: t, providerUpdatedAt: t }, pricing: PRECIOS, minutesPerQueuedClient: 2.5 };
    },
    createQuote(uid, d) {
      const detalles = [];
      if (!MONEDAS.includes(d.sendCurrency)) detalles.push({ path: 'sendCurrency', message: 'invalid' });
      if (!MONEDAS.includes(d.receiveCurrency)) detalles.push({ path: 'receiveCurrency', message: 'invalid' });
      const tieneEnvio = d.sendAmount !== undefined; const tieneRecibo = d.receiveAmount !== undefined;
      if (tieneEnvio === tieneRecibo) detalles.push({ path: 'sendAmount', message: 'give exactly one of sendAmount or receiveAmount' });
      if (detalles.length) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-input', detalles);
      if (d.sendCurrency === d.receiveCurrency) throw negocio(400, 'INVALID_ARGUMENT', 'same-currency');
      const monto = tieneEnvio ? d.sendAmount : d.receiveAmount;
      if (typeof monto !== 'number' || !(monto > 0) || monto > 10_000_000) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-amount');
      const p = precio(d.sendCurrency, d.receiveCurrency, monto, tieneEnvio);
      const enUsd = p.sendAmount / tasas[d.sendCurrency];
      if (enUsd < PRECIOS.minSendUsd) throw negocio(400, 'INVALID_ARGUMENT', 'amount-too-small');
      const ahoraIso = ahoraSim();
      const q = {
        id: `Q${String((nCot += 1)).padStart(4, '0')}`, uid, channel: d.channel || 'form', status: 'open',
        createdAt: ahoraIso.toISOString(), expiresAt: new Date(ahoraIso.getTime() + PRECIOS.quoteTtlMinutes * 60_000).toISOString(),
        sendCurrency: d.sendCurrency, receiveCurrency: d.receiveCurrency, ...p, requiresHuman: enUsd > PRECIOS.largeAmountUsd,
      };
      if (q.requiresHuman) throw negocio(400, 'FAILED_PRECONDITION', 'requires-human', q);
      cotizaciones.set(q.id, q);
      return q;
    },
    createOrder(uid, d) {
      const detalles = [];
      const falta = (path) => detalles.push({ path, message: 'invalid' });
      if (typeof d.quoteId !== 'string' || !d.quoteId) falta('quoteId');
      if (!nombreValido(d.clientName)) falta('clientName');
      if (!DOCS.includes(d.docType)) falta('docType');
      else if (!documentoValido(d.docType, d.docNumber)) falta('docNumber');
      if (!correoValido(d.email)) falta('email');
      if (!FONDOS.includes(d.fundsSource)) falta('fundsSource');
      for (const c of ['sourceBank', 'destinationBank']) if (typeof d[c] !== 'string' || !d[c].trim() || d[c].length > 60) falta(c);
      for (const c of ['sourceAccount', 'destinationAccount']) if (!cuentaValida(d[c])) falta(c);
      if (detalles.length) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-input', detalles);
      const q = cotizaciones.get(d.quoteId);
      if (!q || q.uid !== uid) throw negocio(404, 'NOT_FOUND', 'quote-not-found');
      if (q.status !== 'open') throw negocio(400, 'FAILED_PRECONDITION', 'quote-already-used');
      const t = ahoraSim();
      if (t.getTime() > new Date(q.expiresAt).getTime()) throw negocio(504, 'DEADLINE_EXCEEDED', 'quote-expired');
      seq += 1;
      const orderId = `BR-${String(seq).padStart(4, '0')}`;
      const orden = {
        orderId, seq, uid, channel: q.channel, language: d.language || 'es', status: 'pending', createdAt: t.toISOString(), updatedAt: t.toISOString(),
        quoteId: q.id, clientName: d.clientName, docType: d.docType, docNumber: normalizarDocumento(d.docType, d.docNumber), email: d.email.toLowerCase(),
        fundsSource: d.fundsSource, sourceBank: d.sourceBank, sourceAccount: d.sourceAccount, destinationBank: d.destinationBank, destinationAccount: d.destinationAccount,
        sendAmount: q.sendAmount, sendCurrency: q.sendCurrency, receiveAmount: q.receiveAmount, receiveCurrency: q.receiveCurrency,
        rate: q.rate, marketRate: q.marketRate, commission: q.commission, tax: q.tax, total: q.total,
        rateLockedUntil: new Date(t.getTime() + PRECIOS.rateLockMinutes * 60_000).toISOString(), paymentAccount: CUENTAS_PAGO[q.sendCurrency],
        operationNo: null, paymentProofPath: null, proofSubmittedAt: null, validatedBy: null, validatedAt: null, rejectionReason: null,
        exportBatchId: null, exportedAt: null, invoiceStatus: null,
      };
      ordenes.set(orderId, orden);
      q.status = 'consumed'; q.orderId = orderId;
      const previo = clientes.get(uid) || { accounts: [] };
      const cuentas = new Map(previo.accounts.map((a) => [`${a.bank}|${a.accountNumber}`, a]));
      for (const [banco, numero, moneda] of [[d.sourceBank, d.sourceAccount, q.sendCurrency], [d.destinationBank, d.destinationAccount, q.receiveCurrency]]) {
        const clave = `${banco}|${numero}`;
        if (!cuentas.has(clave)) cuentas.set(clave, { id: clave, bank: banco, accountNumber: numero, currency: moneda });
      }
      clientes.set(uid, { clientName: d.clientName, email: d.email.toLowerCase(), docType: d.docType, docNumber: orden.docNumber, language: d.language || 'es', accounts: [...cuentas.values()].slice(-12), updatedAt: t.toISOString() });
      return orden;
    },
    submitProof(uid, d) {
      if (!operacionValida(d.operationNo)) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-operation-no');
      const o = ordenes.get(d.orderId);
      if (!o || o.uid !== uid) throw negocio(404, 'NOT_FOUND', 'order-not-found');
      const prefijo = `proofs/${uid}/${d.orderId}/`;
      if (typeof d.proofPath !== 'string' || !d.proofPath.startsWith(prefijo) || d.proofPath.includes('..')) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-proof-path');
      if (o.status !== 'pending') throw negocio(400, 'FAILED_PRECONDITION', 'order-not-pending');
      const f = archivos.get(d.proofPath);
      if (!f) throw negocio(400, 'FAILED_PRECONDITION', 'proof-not-uploaded');
      if (f.bytes.length > MAX_PRUEBA) throw negocio(400, 'INVALID_ARGUMENT', 'proof-too-large');
      const num = d.operationNo.trim().toUpperCase();
      for (const otra of ordenes.values()) {
        if (otra.orderId !== o.orderId && otra.operationNo === num && !['cancelled', 'rejected'].includes(otra.status)) throw negocio(409, 'ALREADY_EXISTS', 'operation-no-duplicate');
      }
      Object.assign(o, { status: 'validating', operationNo: num, paymentProofPath: d.proofPath, proofSubmittedAt: ahoraSim().toISOString(), updatedAt: ahoraSim().toISOString() });
      return { ok: true, orderId: o.orderId };
    },
    cancelOrder(uid, d) {
      const o = ordenes.get(d.orderId);
      if (!o || o.uid !== uid) throw negocio(404, 'NOT_FOUND', 'order-not-found');
      if (o.status !== 'pending') throw negocio(400, 'FAILED_PRECONDITION', 'order-not-pending');
      o.status = 'cancelled'; o.updatedAt = ahoraSim().toISOString();
      return { ok: true, orderId: o.orderId };
    },
    requestHuman(uid, d) {
      if (typeof d.summary !== 'string' || !d.summary.trim() || d.summary.length > 1500) throw negocio(400, 'INVALID_ARGUMENT', 'invalid-input', [{ path: 'summary', message: 'invalid' }]);
      if (d.orderId) { const o = ordenes.get(d.orderId); if (!o || o.uid !== uid) throw negocio(404, 'NOT_FOUND', 'order-not-found'); }
      let t = [...tickets.values()].find((x) => x.uid === uid && x.status === 'waiting');
      if (!t) { t = { handoffId: `H${String((nTickets += 1)).padStart(3, '0')}`, uid, status: 'waiting', summary: d.summary, orderId: d.orderId || null, channel: d.channel || 'assistant' }; tickets.set(t.handoffId, t); }
      const posicion = [...tickets.values()].filter((x) => x.status === 'waiting').indexOf(t) + 1;
      return { handoffId: t.handoffId, position: posicion, estimatedWaitMinutes: Math.max(1, Math.round(posicion * 2.5)) };
    },
    getQueueInfo(uid, d) {
      const t = tickets.get(d.handoffId);
      if (!t || t.uid !== uid) throw negocio(404, 'NOT_FOUND', 'handoff-not-found');
      const posicion = t.status === 'waiting' ? [...tickets.values()].filter((x) => x.status === 'waiting').indexOf(t) + 1 : 0;
      return { handoffId: t.handoffId, position: posicion, estimatedWaitMinutes: posicion ? Math.max(1, Math.round(posicion * 2.5)) : 0, status: t.status };
    },
    getReceipt(uid, d) {
      const o = ordenes.get(d.orderId);
      if (!o || o.uid !== uid) throw negocio(403, 'PERMISSION_DENIED', 'not-your-order');
      if (o.invoiceStatus !== 'accepted') throw negocio(400, 'FAILED_PRECONDITION', 'receipt-not-ready');
      return { filename: `B001-${String(o.seq).padStart(8, '0')}.pdf`, contentType: 'application/pdf', base64: Buffer.from(`%PDF-1.4 RECIBO FALSO ${o.orderId}`).toString('base64') };
    },
  };

  // Reglas de lectura de Firestore: orders y clientes solo del dueño.
  function leerDocumento(uid, coleccion, id) {
    // Como en el Firestore real: la regla compara resource.data.uid, así que una orden que no existe también da 403.
    if (coleccion === 'orders') { const o = ordenes.get(id); if (!o || o.uid !== uid) throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.'); return documento(`orders/${id}`, o); }
    if (coleccion === 'clients') { if (id !== uid) throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.'); const c = clientes.get(uid); return c ? documento(`clients/${uid}`, c) : null; }
    throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
  }

  function consultar(uid, cuerpo) {
    const q = cuerpo.structuredQuery || {};
    const coleccion = q.from && q.from[0] && q.from[0].collectionId;
    if (coleccion !== 'orders') throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
    const filtros = q.where && q.where.compositeFilter ? q.where.compositeFilter.filters : q.where ? [q.where] : [];
    const campos = Object.fromEntries(filtros.map((f) => [f.fieldFilter.field.fieldPath, f.fieldFilter.value.stringValue]));
    if (campos.uid !== uid) throw negocio(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.'); // la regla exige filtrar por el propio uid
    const docs = [...ordenes.values()].filter((o) => o.uid === uid && Object.entries(campos).every(([k, v]) => o[k] === v));
    return docs.length ? docs.map((o) => ({ document: documento(`orders/${o.orderId}`, o), readTime: ahoraSim().toISOString() })) : [{ readTime: ahoraSim().toISOString() }];
  }

  function subirArchivo(uid, ruta, contentType, bytes) {
    const m = /^proofs\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(ruta || '');
    if (!m || m[1] !== uid) throw negocio(403, 'PERMISSION_DENIED', 'Permission denied.');
    if (bytes.length >= MAX_PRUEBA || !(contentType.startsWith('image/') || contentType === 'application/pdf')) throw negocio(403, 'PERMISSION_DENIED', 'Permission denied.');
    if (archivos.has(ruta)) throw negocio(403, 'PERMISSION_DENIED', 'Permission denied.'); // update y delete están prohibidos
    archivos.set(ruta, { bytes, contentType });
    return { name: ruta, bucket, size: String(bytes.length), contentType };
  }

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const corte = (res, e) => {
    res.writeHead(e.estado, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { status: e.grpc, message: e.message, ...(e.detalles ? { details: e.detalles } : {}) } }));
  };
  const json = (res, estado, cuerpo) => { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(cuerpo)); };

  const servidor = http.createServer(async (req, res) => {
    const partes = [];
    for await (const c of req) partes.push(c);
    const crudo = Buffer.concat(partes);
    const url = new URL(req.url, 'http://local');
    const ruta = url.pathname;
    try {
      const fallo = fallos.find((f) => ruta.includes(f.ruta) && f.veces > 0);
      if (fallo && !fallo.despuesDeEfecto) {
        fallo.veces -= 1;
        if (fallo.demora) await dormir(fallo.demora);
        if (fallo.estado) { res.writeHead(fallo.estado, { 'Content-Type': 'text/html' }); return res.end(fallo.cuerpo || ''); }
      }
      // Identity Toolkit
      if (ruta === '/identity/v1/accounts:signUp') {
        if (url.searchParams.get('key') !== apiKey) return json(res, 400, { error: { code: 400, message: 'API_KEY_INVALID' } });
        const u = crearUsuario();
        return json(res, 200, { idToken: u.idToken, refreshToken: u.refresh, localId: u.uid, expiresIn: String(tokenSegundos) });
      }
      if (ruta === '/identity/v1/accounts:delete') {
        if (url.searchParams.get('key') !== apiKey) return json(res, 400, { error: { code: 400, message: 'API_KEY_INVALID' } });
        const t = tokens.get(JSON.parse(crudo.toString('utf8') || '{}').idToken);
        if (!t || !usuarios.has(t.uid)) return json(res, 400, { error: { code: 400, message: 'INVALID_ID_TOKEN' } });
        usuarios.delete(t.uid);
        return json(res, 200, { kind: 'identitytoolkit#DeleteAccountResponse' });
      }
      if (ruta === '/securetoken/v1/token') {
        const form = new URLSearchParams(crudo.toString('utf8'));
        const uid = refrescos.get(form.get('refresh_token'));
        if (!uid || !usuarios.has(uid)) return json(res, 400, { error: { code: 400, message: 'TOKEN_EXPIRED' } });
        return json(res, 200, { id_token: nuevoToken(uid), refresh_token: usuarios.get(uid).refresh, user_id: uid, expires_in: String(tokenSegundos) });
      }
      // Funciones callable
      const f = /^\/fn\/([A-Za-z]+)$/.exec(ruta);
      if (f) {
        const uid = autenticar(req.headers.authorization, 'Bearer');
        const nombre = Object.keys(funciones).find((k) => k.toLowerCase() === f[1].toLowerCase()); // la URL real va en minúsculas
        if (!nombre) return json(res, 404, { error: { status: 'NOT_FOUND', message: 'function-not-found' } });
        const data = (JSON.parse(crudo.toString('utf8') || '{}') || {}).data || {};
        llamadas.push({ tipo: 'funcion', nombre, uid, data });
        const resultado = funciones[nombre](uid, data);
        if (fallo && fallo.despuesDeEfecto) { fallo.veces -= 1; await dormir(fallo.demora); }
        return json(res, 200, { result: resultado });
      }
      // Firestore
      const base = '/fs/projects/aibrasper/databases/(default)/documents';
      if (ruta === `${base}:runQuery`) {
        const uid = autenticar(req.headers.authorization, 'Bearer');
        llamadas.push({ tipo: 'consulta', uid });
        return json(res, 200, consultar(uid, JSON.parse(crudo.toString('utf8') || '{}')));
      }
      if (ruta.startsWith(`${base}/`) && req.method === 'GET') {
        const uid = autenticar(req.headers.authorization, 'Bearer');
        const [coleccion, id] = ruta.slice(base.length + 1).split('/');
        llamadas.push({ tipo: 'lectura', ruta: `${coleccion}/${id}`, uid });
        const d = leerDocumento(uid, coleccion, id);
        if (!d) return json(res, 404, { error: { code: 404, message: `Document "projects/aibrasper/databases/(default)/documents/${coleccion}/${id}" not found.`, status: 'NOT_FOUND' } });
        return json(res, 200, d);
      }
      // Storage
      if (ruta === `/storage/v0/b/${bucket}/o` && req.method === 'POST') {
        const uid = autenticar(req.headers.authorization, 'Firebase');
        llamadas.push({ tipo: 'subida', ruta: url.searchParams.get('name'), uid, bytes: crudo.length });
        return json(res, 200, subirArchivo(uid, url.searchParams.get('name'), req.headers['content-type'] || '', crudo));
      }
      return json(res, 404, { error: { code: 404, message: 'ruta no soportada por el falso', status: 'NOT_FOUND' } });
    } catch (e) {
      if (e instanceof ErrorHttp) return corte(res, e);
      return json(res, 500, { error: { status: 'INTERNAL', message: 'falso-roto', details: String(e.stack || e) } });
    }
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  servidor.unref();
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const orden = (id) => { const o = ordenes.get(id); if (!o) throw new Error(`orden inexistente: ${id}`); return o; };
  const cambiar = (id, desde, hasta, extra = {}) => {
    const o = orden(id);
    if (!desde.includes(o.status)) throw new Error(`transición ilegal ${o.status} → ${hasta}`);
    Object.assign(o, { status: hasta, updatedAt: ahoraSim().toISOString(), ...extra });
  };

  return {
    apiKey, bucket, url: base,
    config: {
      apiKey, bucket, projectId: 'aibrasper',
      identityUrl: `${base}/identity`, tokenUrl: `${base}/securetoken`, functionsUrl: `${base}/fn/{nombre}`,
      firestoreUrl: `${base}/fs/projects/aibrasper/databases/(default)/documents`, storageUrl: `${base}/storage`,
    },
    llamadas, ordenes, clientes, cotizaciones, archivos, tickets, usuarios,
    // Control de la prueba
    avanzar(minutos) { reloj += minutos; },
    fallar(ruta, { estado = 502, veces = 1, cuerpo = '' } = {}) { fallos.push({ ruta, estado, veces, cuerpo }); },
    demorar(ruta, ms, { veces = 1, despuesDeEfecto = false } = {}) { fallos.push({ ruta, demora: ms, veces, despuesDeEfecto }); },
    expirarTokens() { for (const t of tokens.values()) t.vence = 0; },
    borrarUsuario(uid) { usuarios.delete(uid); },
    // Personal simulado
    aprobar(id, por = 'validador@brasper.com') { cambiar(id, ['validating'], 'approved', { validatedBy: por, validatedAt: ahoraSim().toISOString() }); },
    rechazar(id, motivo, por = 'validador@brasper.com') { cambiar(id, ['validating'], 'rejected', { validatedBy: por, validatedAt: ahoraSim().toISOString(), rejectionReason: motivo }); },
    exportar(id) { cambiar(id, ['approved'], 'exported', { exportBatchId: 'lote-1', exportedAt: ahoraSim().toISOString() }); },
    facturar(id) { const o = orden(id); if (o.status !== 'exported') throw new Error('solo se factura lo exportado'); o.invoiceStatus = 'accepted'; },
    cerrar: () => new Promise((r) => servidor.close(r)),
  };
}

module.exports = { crearFirebaseFalso, CUENTAS_PAGO, PRECIOS };
```

- [ ] **Step 4: Ver que pasan**

Run: `node --test waha/test/firebase-falso.test.js`
Expected: PASS, 0 fallos

- [ ] **Commit**

```bash
git add waha/test/helpers/firebase-falso.js waha/test/firebase-falso.test.js
git commit -m "test(waha): servidor Firebase falso con reglas de dueño, fallos inyectados y personal simulado

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 4: Sesiones, funciones, Firestore, Storage y tablas SQLite

**Files:**
- Create: `waha/src/backend/real/sesion.js`, `waha/src/backend/real/funciones.js`, `waha/src/backend/real/firestore.js`, `waha/src/backend/real/storage.js`
- Modify: `waha/src/estado/db.js`, `waha/src/estado/almacen.js`
- Test: `waha/test/almacen.test.js` (ampliada), `waha/test/sesion-firebase.test.js`, `waha/test/firebase-clientes.test.js`

**Interfaces:**
- Consumes: `pedir`, `configBackend`, `ErrorBackend`, `crearCola` (`waha/src/motor/cola.js`, ya existe), el falso (tarea 3).
- Produces:
  - Almacén (`crearAlmacen(db)`): `sesionFirebase(tel) -> {telefono, uid, refresh, idToken, vence}|null`, `guardarSesionFirebase({telefono, uid, refresh, idToken, vence})`, `borrarSesionFirebase(tel)`, `agregarOrden({ordenId, telefono, chatId, creada})`, `ordenesDe(tel)`, `abrirSeguimiento({ordenId, telefono, chatId, creado})`, `seguimientosAbiertos()`, `seguimiento(ordenId) -> {ordenId, telefono, chatId, creado, estadoAvisado, reciboEnviado, cerrado}|null`, `actualizarSeguimiento(ordenId, { estadoAvisado?, reciboEnviado?, cerrado? })`. Tablas `sesiones_firebase`, `ordenes`, `seguimientos`.
  - `crearSesiones({ almacen, config, fetchImpl, ahora, cola, dormir }) -> { obtener(tel) -> {uid, idToken}, usar(tel, fn(sesion)) , olvidar(tel) }`: crea el usuario anónimo en la primera llamada, renueva el token cuando le quedan menos de 5 minutos con una cola por teléfono y, si el usuario ya no existe, crea otro.
  - `crearFunciones({ sesiones, config, fetchImpl, dormir, timeoutMs }) -> { llamar(tel, nombre, data, { reintentos }) -> result }`.
  - `crearFirestore({ sesiones, config, fetchImpl, dormir }) -> { leer(tel, ruta) -> objeto decodificado|null, ordenesPorCotizacion(tel, quoteId) -> [orden] }` y `decodificar(valorTipado)`.
  - `crearStorage({ sesiones, config, fetchImpl, dormir }) -> { subir(tel, ruta, bytes, mimetype) }` y `extensionDe(mimetype) -> 'jpg'|'png'|'webp'|'pdf'|null`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/sesion-firebase.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearSesiones } = require('../src/backend/real/sesion');
const { configBackend } = require('../src/backend/real/config');
const { ErrorBackend } = require('../src/backend/real/errores');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

async function mundo(opciones) {
  const falso = await crearFirebaseFalso(opciones);
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const sesiones = crearSesiones({ almacen, config: falso.config });
  return { falso, almacen, sesiones, cerrar: () => falso.cerrar() };
}
const altas = (falso) => falso.usuarios.size;

test('configBackend: exige la clave web y trae los valores por defecto del proyecto', () => {
  assert.throws(() => configBackend({}), /FIREBASE_API_KEY/);
  const c = configBackend({ FIREBASE_API_KEY: 'k' });
  assert.equal(c.apiKey, 'k');
  assert.equal(c.projectId, 'aibrasper');
  assert.equal(c.bucket, 'aibrasper.firebasestorage.app');
  assert.equal(c.functionsUrl, 'https://{nombre}-h5wenirx2q-rj.a.run.app');
  assert.equal(c.firestoreUrl, 'https://firestore.googleapis.com/v1/projects/aibrasper/databases/(default)/documents');
  assert.equal(c.storageUrl, 'https://firebasestorage.googleapis.com');
  const otro = configBackend({ FIREBASE_API_KEY: 'k', FIREBASE_PROJECT_ID: 'otro', FIREBASE_FUNCTIONS_URL: 'http://f/{nombre}' });
  assert.equal(otro.projectId, 'otro');
  assert.equal(otro.functionsUrl, 'http://f/{nombre}');
  assert.match(otro.firestoreUrl, /projects\/otro\//);
});

test('la primera vez crea un usuario anónimo y lo guarda; la segunda reutiliza la sesión', async () => {
  const m = await mundo();
  try {
    const a = await m.sesiones.obtener('519');
    const b = await m.sesiones.obtener('519');
    assert.equal(altas(m.falso), 1);
    assert.equal(a.uid, b.uid);
    assert.equal(a.idToken, b.idToken);
    assert.equal(m.almacen.sesionFirebase('519').uid, a.uid);
    assert.notEqual((await m.sesiones.obtener('518')).uid, a.uid); // otro teléfono, otro usuario
  } finally { await m.cerrar(); }
});

test('renueva el token cuando le quedan menos de 5 minutos y conserva el mismo usuario', async () => {
  const m = await mundo({ tokenSegundos: 200 });
  try {
    const a = await m.sesiones.obtener('519');
    const b = await m.sesiones.obtener('519');
    assert.equal(a.uid, b.uid);
    assert.notEqual(a.idToken, b.idToken);
    assert.equal(altas(m.falso), 1);
  } finally { await m.cerrar(); }
});

test('forzar renueva aunque el token siga vigente', async () => {
  const m = await mundo();
  try {
    const a = await m.sesiones.obtener('519');
    const b = await m.sesiones.obtener('519', { forzar: true });
    assert.notEqual(a.idToken, b.idToken);
    assert.equal(a.uid, b.uid);
  } finally { await m.cerrar(); }
});

test('si el usuario ya no existe, crea otro (el cliente pierde su perfil anterior)', async () => {
  const m = await mundo({ tokenSegundos: 200 });
  try {
    const a = await m.sesiones.obtener('519');
    m.falso.borrarUsuario(a.uid);
    const b = await m.sesiones.obtener('519');
    assert.notEqual(a.uid, b.uid);
    assert.equal(m.almacen.sesionFirebase('519').uid, b.uid);
  } finally { await m.cerrar(); }
});

test('un fallo de transporte al renovar NO crea otro usuario: se propaga', async () => {
  const m = await mundo({ tokenSegundos: 200 });
  try {
    const a = await m.sesiones.obtener('519');
    m.falso.fallar('/securetoken', { estado: 502, veces: 5 });
    await assert.rejects(() => m.sesiones.obtener('519'), (e) => e instanceof ErrorBackend && e.transporte === true);
    assert.equal(altas(m.falso), 1);
    assert.equal(m.almacen.sesionFirebase('519').uid, a.uid);
  } finally { await m.cerrar(); }
});

test('llamadas simultáneas del mismo teléfono comparten una sola alta', async () => {
  const m = await mundo();
  try {
    const rs = await Promise.all([m.sesiones.obtener('519'), m.sesiones.obtener('519'), m.sesiones.obtener('519')]);
    assert.equal(altas(m.falso), 1);
    assert.equal(new Set(rs.map((r) => r.uid)).size, 1);
  } finally { await m.cerrar(); }
});

test('usar reintenta una vez con un token nuevo si el backend responde 401', async () => {
  const m = await mundo();
  try {
    await m.sesiones.obtener('519');
    m.falso.expirarTokens();
    const vistos = [];
    const r = await m.sesiones.usar('519', async (s) => {
      vistos.push(s.idToken);
      if (vistos.length === 1) throw new ErrorBackend('401', { estado: 401, codigo: 'sign-in-required' });
      return 'ok';
    });
    assert.equal(r, 'ok');
    assert.equal(vistos.length, 2);
    assert.notEqual(vistos[0], vistos[1]);
    await assert.rejects(() => m.sesiones.usar('519', async () => { throw new ErrorBackend('401', { estado: 401 }); }), /401/); // solo un reintento
    await assert.rejects(() => m.sesiones.usar('519', async () => { throw new ErrorBackend('x', { estado: 400, codigo: 'invalid-input' }); }), (e) => e.codigo === 'invalid-input');
  } finally { await m.cerrar(); }
});

test('olvidar borra la sesión y el siguiente uso crea un usuario nuevo', async () => {
  const m = await mundo();
  try {
    const a = await m.sesiones.obtener('519');
    m.sesiones.olvidar('519');
    const b = await m.sesiones.obtener('519');
    assert.notEqual(a.uid, b.uid);
  } finally { await m.cerrar(); }
});
```

`waha/test/firebase-clientes.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearSesiones } = require('../src/backend/real/sesion');
const { crearFunciones } = require('../src/backend/real/funciones');
const { crearFirestore, decodificar } = require('../src/backend/real/firestore');
const { crearStorage, extensionDe } = require('../src/backend/real/storage');
const { ErrorBackend } = require('../src/backend/real/errores');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

async function mundo(opciones) {
  const falso = await crearFirebaseFalso(opciones);
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const sesiones = crearSesiones({ almacen, config: falso.config });
  return {
    falso, almacen, sesiones,
    funciones: crearFunciones({ sesiones, config: falso.config }),
    firestore: crearFirestore({ sesiones, config: falso.config }),
    storage: crearStorage({ sesiones, config: falso.config }),
    cerrar: () => falso.cerrar(),
  };
}
const T = '51944686794';
const DATOS = { language: 'es', clientName: 'Ana Paula Souza', docType: 'CPF', docNumber: '52998224725', email: 'ana@example.com', fundsSource: 'savings', sourceBank: 'Nubank', sourceAccount: '0001-12345678-9', destinationBank: 'BCP', destinationAccount: '191-1234567890' };
const cotizar = (m, tel = T) => m.funciones.llamar(tel, 'createQuote', { sendCurrency: 'BRL', receiveCurrency: 'PEN', sendAmount: 500, channel: 'whatsapp' });

test('decodificar convierte los valores tipados de Firestore en valores normales', () => {
  const d = decodificar({ fields: {
    texto: { stringValue: 'a' }, entero: { integerValue: '12' }, decimal: { doubleValue: 0.6745 }, si: { booleanValue: true }, nada: { nullValue: null },
    lista: { arrayValue: { values: [{ stringValue: 'x' }, { integerValue: '2' }] } }, vacia: { arrayValue: {} },
    mapa: { mapValue: { fields: { banco: { stringValue: 'BCP' }, n: { integerValue: '4' } } } }, tiempo: { timestampValue: '2026-10-13T10:00:00Z' },
  } });
  assert.deepEqual(d, { texto: 'a', entero: 12, decimal: 0.6745, si: true, nada: null, lista: ['x', 2], vacia: [], mapa: { banco: 'BCP', n: 4 }, tiempo: '2026-10-13T10:00:00Z' });
});

test('funciones: llama con el token del cliente y devuelve el resultado', async () => {
  const m = await mundo();
  try {
    const q = await cotizar(m);
    assert.equal(q.total, 514.16);
    assert.equal(q.channel, 'whatsapp');
    const [llamada] = m.falso.llamadas;
    assert.equal(llamada.nombre, 'createQuote');
    assert.equal(llamada.uid, m.almacen.sesionFirebase(T).uid);
  } finally { await m.cerrar(); }
});

test('funciones: un error de negocio llega con su código y detalles', async () => {
  const m = await mundo();
  try {
    const q = await cotizar(m);
    await assert.rejects(() => m.funciones.llamar(T, 'createOrder', { quoteId: q.id, ...DATOS, docNumber: '52998224724' }), (e) => {
      assert.ok(e instanceof ErrorBackend);
      assert.equal(e.codigo, 'invalid-input');
      assert.deepEqual(e.detalles.map((d) => d.path), ['docNumber']);
      assert.equal(e.transporte, false);
      return true;
    });
  } finally { await m.cerrar(); }
});

test('funciones: con el token vencido renueva solo y la llamada sale bien', async () => {
  const m = await mundo();
  try {
    await cotizar(m);
    m.falso.expirarTokens();
    const r = await m.funciones.llamar(T, 'getRates', {});
    assert.equal(r.pricing.quoteTtlMinutes, 15);
  } finally { await m.cerrar(); }
});

test('funciones: reintenta los fallos de transporte solo si se pide', async () => {
  const m = await mundo();
  try {
    await m.sesiones.obtener(T);
    m.falso.fallar('/fn/getrates', { estado: 502, veces: 1 });
    await assert.rejects(() => m.funciones.llamar(T, 'getRates', {}), (e) => e.transporte === true);
    m.falso.fallar('/fn/getrates', { estado: 502, veces: 1 });
    assert.ok((await m.funciones.llamar(T, 'getRates', {}, { reintentos: 1, dormir: async () => {} })).market);
  } finally { await m.cerrar(); }
});

test('firestore: lee la orden propia como objeto normal; la ajena da PERMISSION_DENIED; lo que no existe da null', async () => {
  const m = await mundo();
  try {
    const q = await cotizar(m);
    const o = await m.funciones.llamar(T, 'createOrder', { quoteId: q.id, ...DATOS });
    const leida = await m.firestore.leer(T, `orders/${o.orderId}`);
    assert.equal(leida.status, 'pending');
    assert.equal(leida.total, 514.16);
    assert.equal(leida.paymentAccount.bank, 'Nubank');
    assert.equal(leida.operationNo, null);
    await assert.rejects(() => m.firestore.leer('51900000000', `orders/${o.orderId}`), (e) => e.codigo === 'PERMISSION_DENIED' && e.estado === 403);
    assert.equal(await m.firestore.leer(T, 'orders/BR-9999').catch((e) => e.codigo), 'PERMISSION_DENIED'); // inexistente de otro: la regla compara dueño
    const uid = m.almacen.sesionFirebase(T).uid;
    const perfil = await m.firestore.leer(T, `clients/${uid}`);
    assert.equal(perfil.accounts.length, 2);
    assert.equal(perfil.accounts[0].bank, 'Nubank');
    assert.equal(await m.firestore.leer('51911111111', 'clients/uidinexistente').catch((e) => e.codigo), 'PERMISSION_DENIED');
    assert.equal(await m.firestore.leer(T, 'clients/' + 'x'.repeat(5)).catch((e) => e.codigo), 'PERMISSION_DENIED');
  } finally { await m.cerrar(); }
});

test('firestore: el propio perfil inexistente devuelve null (404)', async () => {
  const m = await mundo();
  try {
    await m.sesiones.obtener(T);
    const uid = m.almacen.sesionFirebase(T).uid;
    assert.equal(await m.firestore.leer(T, `clients/${uid}`), null);
  } finally { await m.cerrar(); }
});

test('firestore: busca las propias órdenes por cotización (para reconciliar un createOrder dudoso)', async () => {
  const m = await mundo();
  try {
    const q = await cotizar(m);
    assert.deepEqual(await m.firestore.ordenesPorCotizacion(T, q.id), []);
    const o = await m.funciones.llamar(T, 'createOrder', { quoteId: q.id, ...DATOS });
    const halladas = await m.firestore.ordenesPorCotizacion(T, q.id);
    assert.equal(halladas.length, 1);
    assert.equal(halladas[0].orderId, o.orderId);
    assert.deepEqual(await m.firestore.ordenesPorCotizacion('51922222222', q.id), []); // otro cliente no ve la orden
  } finally { await m.cerrar(); }
});

test('storage: sube a proofs/<uid>/<orden>/ y lo devuelve; rechaza tipos y lugares no permitidos', async () => {
  const m = await mundo();
  try {
    const { uid } = await m.sesiones.obtener(T);
    const ruta = await m.storage.subir(T, { ordenId: 'BR-0001', nombre: 'proof-1.jpg', mimetype: 'image/jpeg', bytes: Buffer.from('foto') });
    assert.equal(ruta, `proofs/${uid}/BR-0001/proof-1.jpg`);
    assert.equal(m.falso.archivos.get(ruta).bytes.toString(), 'foto');
    await assert.rejects(() => m.storage.subir(T, { ordenId: 'BR-0001', nombre: 'v.mp4', mimetype: 'video/mp4', bytes: Buffer.from('v') }), (e) => e.codigo === 'PERMISSION_DENIED');
    await assert.rejects(() => m.storage.subir(T, { ordenId: 'BR-0001', nombre: 'proof-1.jpg', mimetype: 'image/jpeg', bytes: Buffer.from('otra') }), (e) => e.estado === 403); // no se sobrescribe
  } finally { await m.cerrar(); }
});

test('storage: extensión según el tipo del archivo', () => {
  assert.equal(extensionDe('image/jpeg'), 'jpg');
  assert.equal(extensionDe('image/png'), 'png');
  assert.equal(extensionDe('image/webp'), 'webp');
  assert.equal(extensionDe('application/pdf'), 'pdf');
  assert.equal(extensionDe('video/mp4'), 'bin');
  assert.equal(extensionDe(undefined), 'bin');
});
```

Parche para `waha/test/almacen.test.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/test/almacen.test.js
+++ b/waha/test/almacen.test.js
@@ -61,3 +61,47 @@
   a.registrar({ tipo: 'envio', ruta: '/api/sendSeen', estado: '201' });
   assert.deepEqual(db.prepare('SELECT detalle FROM registro ORDER BY id').all().map((f) => f.detalle), ['/api/sendText', '/api/sendSeen']);
 });
+
+test('sesiones de Firebase por teléfono: guardar, actualizar y olvidar', () => {
+  const a = nuevo();
+  assert.equal(a.sesionFirebase('519'), null);
+  a.guardarSesionFirebase({ telefono: '519', uid: 'u1', refresh: 'r1', idToken: 't1', vence: 1000 });
+  assert.deepEqual(a.sesionFirebase('519'), { telefono: '519', uid: 'u1', refresh: 'r1', idToken: 't1', vence: 1000 });
+  a.guardarSesionFirebase({ telefono: '519', uid: 'u1', refresh: 'r2', idToken: 't2', vence: 2000 });
+  assert.equal(a.sesionFirebase('519').idToken, 't2');
+  a.borrarSesionFirebase('519');
+  assert.equal(a.sesionFirebase('519'), null);
+});
+
+test('órdenes por teléfono: la más reciente primero', () => {
+  const a = nuevo();
+  a.agregarOrden({ ordenId: 'BR-0001', telefono: '519', chatId: '519@c.us', creada: '2026-10-13T10:00:00.000Z' });
+  a.agregarOrden({ ordenId: 'BR-0002', telefono: '519', chatId: '519@c.us', creada: '2026-10-13T11:00:00.000Z' });
+  a.agregarOrden({ ordenId: 'BR-0003', telefono: '518', chatId: '518@c.us', creada: '2026-10-13T12:00:00.000Z' });
+  assert.deepEqual(a.ordenesDe('519').map((o) => o.ordenId), ['BR-0002', 'BR-0001']);
+  assert.deepEqual(a.ordenesDe('000'), []);
+});
+
+test('seguimientos: abrir, actualizar, listar los abiertos y cerrar', () => {
+  const a = nuevo();
+  a.abrirSeguimiento({ ordenId: 'BR-0001', telefono: '519', chatId: '519@c.us', creado: '2026-10-13T10:00:00.000Z' });
+  a.abrirSeguimiento({ ordenId: 'BR-0002', telefono: '518', chatId: '518@c.us', creado: '2026-10-13T10:05:00.000Z' });
+  a.abrirSeguimiento({ ordenId: 'BR-0001', telefono: '519', chatId: '519@c.us', creado: '2026-10-13T10:00:00.000Z' }); // repetir no duplica
+  assert.deepEqual(a.seguimientosAbiertos().map((s) => s.ordenId), ['BR-0001', 'BR-0002']);
+  a.actualizarSeguimiento('BR-0001', { estadoAvisado: 'approved', reciboEnviado: 1 });
+  const s = a.seguimientosAbiertos().find((x) => x.ordenId === 'BR-0001');
+  assert.equal(s.estadoAvisado, 'approved');
+  assert.equal(s.reciboEnviado, 1);
+  a.actualizarSeguimiento('BR-0002', { cerrado: 1 });
+  assert.deepEqual(a.seguimientosAbiertos().map((x) => x.ordenId), ['BR-0001']);
+});
+
+test('seguimiento(ordenId) devuelve la fila, esté abierta o cerrada, o null', () => {
+  const a = nuevo();
+  assert.equal(a.seguimiento('BR-0001'), null);
+  a.abrirSeguimiento({ ordenId: 'BR-0001', telefono: '519', chatId: '519@c.us', creado: '2026-10-13T10:00:00.000Z' });
+  assert.equal(a.seguimiento('BR-0001').cerrado, 0);
+  a.actualizarSeguimiento('BR-0001', { cerrado: 1 });
+  assert.equal(a.seguimiento('BR-0001').cerrado, 1);
+  assert.equal(a.seguimiento('BR-0001').telefono, '519');
+});
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test waha/test/almacen.test.js waha/test/sesion-firebase.test.js waha/test/firebase-clientes.test.js`
Expected: FAIL (pruebas nuevas de almacén y módulos inexistentes)

- [ ] **Step 3: Escribir el código**

`waha/src/backend/real/sesion.js`:

```js
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
```

`waha/src/backend/real/funciones.js`:

```js
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
```

`waha/src/backend/real/firestore.js`:

```js
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
```

`waha/src/backend/real/storage.js`:

```js
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
```

Parche para `waha/src/estado/db.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/estado/db.js
+++ b/waha/src/estado/db.js
@@ -10,6 +10,14 @@
     CREATE TABLE IF NOT EXISTS conversaciones (telefono TEXT PRIMARY KEY, ejecucion TEXT NOT NULL, actualizado TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS eventos_vistos (id TEXT PRIMARY KEY, visto TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS kv (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
+    CREATE TABLE IF NOT EXISTS sesiones_firebase (
+      telefono TEXT PRIMARY KEY, uid TEXT NOT NULL, refresh TEXT NOT NULL, id_token TEXT NOT NULL, vence INTEGER NOT NULL
+    );
+    CREATE TABLE IF NOT EXISTS ordenes (orden_id TEXT PRIMARY KEY, telefono TEXT NOT NULL, chat_id TEXT, creada TEXT NOT NULL);
+    CREATE TABLE IF NOT EXISTS seguimientos (
+      orden_id TEXT PRIMARY KEY, telefono TEXT NOT NULL, chat_id TEXT NOT NULL, creado TEXT NOT NULL,
+      estado_avisado TEXT, recibo_enviado INTEGER NOT NULL DEFAULT 0, cerrado INTEGER NOT NULL DEFAULT 0
+    );
     CREATE TABLE IF NOT EXISTS registro (
       id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, tipo TEXT NOT NULL,
       mensaje_id TEXT, chat TEXT, estado TEXT, latencia_ms INTEGER, detalle TEXT
```

Parche para `waha/src/estado/almacen.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/estado/almacen.js
+++ b/waha/src/estado/almacen.js
@@ -9,6 +9,15 @@
     kvGet: db.prepare('SELECT valor FROM kv WHERE clave = ?'),
     kvPut: db.prepare('INSERT INTO kv (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'),
     kvDel: db.prepare('DELETE FROM kv WHERE clave = ?'),
+    sesGet: db.prepare('SELECT telefono, uid, refresh, id_token AS idToken, vence FROM sesiones_firebase WHERE telefono = ?'),
+    sesPut: db.prepare('INSERT INTO sesiones_firebase (telefono, uid, refresh, id_token, vence) VALUES (?, ?, ?, ?, ?) ON CONFLICT(telefono) DO UPDATE SET uid = excluded.uid, refresh = excluded.refresh, id_token = excluded.id_token, vence = excluded.vence'),
+    sesDel: db.prepare('DELETE FROM sesiones_firebase WHERE telefono = ?'),
+    ordPut: db.prepare('INSERT OR IGNORE INTO ordenes (orden_id, telefono, chat_id, creada) VALUES (?, ?, ?, ?)'),
+    ordDe: db.prepare('SELECT orden_id AS ordenId, telefono, chat_id AS chatId, creada FROM ordenes WHERE telefono = ? ORDER BY creada DESC, orden_id DESC'),
+    segPut: db.prepare('INSERT OR IGNORE INTO seguimientos (orden_id, telefono, chat_id, creado) VALUES (?, ?, ?, ?)'),
+    segAbiertos: db.prepare('SELECT orden_id AS ordenId, telefono, chat_id AS chatId, creado, estado_avisado AS estadoAvisado, recibo_enviado AS reciboEnviado, cerrado FROM seguimientos WHERE cerrado = 0 ORDER BY creado, orden_id'),
+    segUno: db.prepare('SELECT orden_id AS ordenId, telefono, chat_id AS chatId, creado, estado_avisado AS estadoAvisado, recibo_enviado AS reciboEnviado, cerrado FROM seguimientos WHERE orden_id = ?'),
+    segUpd: db.prepare('UPDATE seguimientos SET estado_avisado = COALESCE(?, estado_avisado), recibo_enviado = COALESCE(?, recibo_enviado), cerrado = COALESCE(?, cerrado) WHERE orden_id = ?'),
     reg: db.prepare('INSERT INTO registro (ts, tipo, mensaje_id, chat, estado, latencia_ms, detalle) VALUES (?, ?, ?, ?, ?, ?, ?)'),
   };
   const ahora = () => new Date().toISOString();
@@ -24,6 +33,19 @@
     registrar({ tipo, mensajeId = null, chat = null, estado = null, latenciaMs = null, detalle = null, ruta = null }) {
       sql.reg.run(ahora(), tipo, mensajeId, chat, estado, latenciaMs, detalle || ruta);
     },
+    // Sesión de Firebase de cada cliente (usuario anónimo). El token de renovación es un secreto: nunca se registra.
+    sesionFirebase(tel) { const f = sql.sesGet.get(tel); return f ? { ...f } : null; },
+    guardarSesionFirebase({ telefono, uid, refresh, idToken, vence }) { sql.sesPut.run(telefono, uid, refresh, idToken, vence); },
+    borrarSesionFirebase(tel) { sql.sesDel.run(tel); },
+    // Órdenes que el bot creó para cada teléfono, y seguimiento de las que esperan respuesta del personal.
+    agregarOrden({ ordenId, telefono, chatId, creada }) { sql.ordPut.run(ordenId, telefono, chatId || null, creada); },
+    ordenesDe(tel) { return sql.ordDe.all(tel).map((o) => ({ ...o })); },
+    abrirSeguimiento({ ordenId, telefono, chatId, creado }) { sql.segPut.run(ordenId, telefono, chatId, creado); },
+    seguimiento(ordenId) { const s = sql.segUno.get(ordenId); return s ? { ...s } : null; },
+    seguimientosAbiertos() { return sql.segAbiertos.all().map((s) => ({ ...s })); },
+    actualizarSeguimiento(ordenId, { estadoAvisado, reciboEnviado, cerrado } = {}) {
+      sql.segUpd.run(estadoAvisado === undefined ? null : estadoAvisado, reciboEnviado === undefined ? null : reciboEnviado, cerrado === undefined ? null : cerrado, ordenId);
+    },
     // Misma forma que env.KV de Cloudflare: get(k, 'json'), put(k, string), delete(k).
     kvEnv() {
       return {
```

- [ ] **Step 4: Ver que pasan**

Run: `node --test waha/test/almacen.test.js waha/test/sesion-firebase.test.js waha/test/firebase-clientes.test.js`
Expected: PASS, 0 fallos

- [ ] **Commit**

```bash
git add waha/src/backend/real/sesion.js waha/src/backend/real/funciones.js waha/src/backend/real/firestore.js waha/src/backend/real/storage.js waha/src/estado/db.js waha/src/estado/almacen.js waha/test/almacen.test.js waha/test/sesion-firebase.test.js waha/test/firebase-clientes.test.js
git commit -m "feat(waha): sesión anónima de Firebase, funciones, Firestore, Storage y tablas de seguimiento

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 5: Motor: chat, medios, listas dinámicas, fallos de transporte y privacidad; descarga de fotos

**Files:**
- Create: `waha/src/media.js`
- Modify: `waha/src/motor/motor.js`, `waha/src/webhook/normalizar.js`
- Test: `waha/test/motor.test.js` (ampliada), `waha/test/normalizar.test.js` (ampliada), `waha/test/media.test.js`

**Interfaces:**
- Consumes: `ErrorBackend` (tarea 1), el almacén (tarea 4).
- Produces:
  - Motor: `invocar` pasa `chatId` a la acción; el mensaje entrante (`wa`) añade `media_url` y `mimetype`; listas dinámicas (`rows_var`, máximo 10; vacía es un error del flujo); `persistible()` borra el texto de `entrantes` al guardar; un `ErrorBackend` con `transporte` envía "Tuvimos un problema temporal. Intenta de nuevo en un momento." y conserva el paso (en un workflow lanzado por API no avisa al cliente y se informa a quien lo lanzó); `iniciar(flujo, tel, chatId, vars) -> { iniciado: true, fallo?: 'transporte'|'escalado' } | { iniciado: false, motivo: 'ocupado' }`.
  - `normalizarEvento` devuelve además `mediaUrl` y `mimetype`.
  - `crearDescargaMedia({ wahaBaseUrl, apiKey, session, fetchImpl, timeoutMs }) -> async ({ chatId, mensajeId, mediaUrl, mimetype }) -> { bytes: Buffer, mimetype }|null`: usa solo la ruta de `media.url` contra la dirección de WAHA que ve este servidor; sin URL pide el mensaje con `?downloadMedia=true`. Un fallo de red es `ErrorBackend` de transporte. **No verificado en vivo** (tarea 10, H3).

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/media.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearDescargaMedia } = require('../src/media');
const { ErrorBackend } = require('../src/backend/real/errores');

// WAHA de mentira: sirve /api/files/* y el mensaje con downloadMedia.
async function wahaFalso(extra = {}) {
  const pedidos = [];
  const archivos = { '/api/files/foto.jpeg': { tipo: 'image/jpeg', cuerpo: Buffer.from('JPEG') }, '/api/files/doc.pdf': { tipo: 'application/pdf; charset=binary', cuerpo: Buffer.from('%PDF') }, ...extra.archivos };
  const servidor = http.createServer((req, res) => {
    pedidos.push({ url: req.url, clave: req.headers['x-api-key'] });
    if (req.headers['x-api-key'] !== 'CLAVE') { res.writeHead(401); return res.end(); }
    if (archivos[req.url.split('?')[0]]) { const a = archivos[req.url.split('?')[0]]; res.writeHead(200, { 'content-type': a.tipo }); return res.end(a.cuerpo); }
    if (/\/api\/demo\/chats\/.+\/messages\/.+\?downloadMedia=true$/.test(req.url)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(extra.mensaje || { hasMedia: true, media: { url: `http://localhost:3000/api/files/foto.jpeg`, mimetype: 'image/jpeg' } }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  servidor.unref();
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { base, pedidos, cerrar: () => new Promise((r) => servidor.close(r)) };
}
const crear = (w, opciones) => crearDescargaMedia({ wahaBaseUrl: w.base, apiKey: 'CLAVE', session: 'demo', ...opciones });

test('baja el archivo de la URL del evento, reescribiéndola al WAHA propio, con la clave', async () => {
  const w = await wahaFalso();
  try {
    const r = await crear(w)({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://localhost:3000/api/files/foto.jpeg', mimetype: 'image/jpeg' });
    assert.equal(r.bytes.toString(), 'JPEG');
    assert.equal(r.mimetype, 'image/jpeg');
    assert.deepEqual(w.pedidos, [{ url: '/api/files/foto.jpeg', clave: 'CLAVE' }]);
  } finally { await w.cerrar(); }
});

test('el tipo sale del encabezado de la respuesta cuando el evento no lo trae', async () => {
  const w = await wahaFalso();
  try {
    const r = await crear(w)({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://x/api/files/doc.pdf' });
    assert.equal(r.mimetype, 'application/pdf');
  } finally { await w.cerrar(); }
});

test('sin URL en el evento pide el mensaje con downloadMedia=true y baja el archivo que indique', async () => {
  const w = await wahaFalso();
  try {
    const r = await crear(w)({ chatId: '51944686794@c.us', mensajeId: 'false_51@c.us_AAA', mediaUrl: null, mimetype: null });
    assert.equal(r.bytes.toString(), 'JPEG');
    assert.equal(r.mimetype, 'image/jpeg');
    assert.match(w.pedidos[0].url, /^\/api\/demo\/chats\/51944686794%40c\.us\/messages\/false_51%40c\.us_AAA\?downloadMedia=true$/);
    assert.equal(w.pedidos[1].url, '/api/files/foto.jpeg');
  } finally { await w.cerrar(); }
});

test('devuelve null si WAHA no tiene el archivo (no es un fallo de red)', async () => {
  const w = await wahaFalso({ mensaje: { hasMedia: false, media: null } });
  try {
    assert.equal(await crear(w)({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: null }), null);
    assert.equal(await crear(w)({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://x/api/files/no-existe.jpeg' }), null);
  } finally { await w.cerrar(); }
});

test('si WAHA no responde es un error de transporte (el motor avisa del problema temporal)', async () => {
  const w = await wahaFalso();
  const base = w.base;
  await w.cerrar();
  await assert.rejects(() => crearDescargaMedia({ wahaBaseUrl: base, apiKey: 'CLAVE', session: 'demo', timeoutMs: 300 })({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://x/api/files/foto.jpeg' }), (e) => e instanceof ErrorBackend && e.transporte === true);
});

test('con una clave equivocada devuelve null en vez de lanzar un error opaco', async () => {
  const w = await wahaFalso();
  try {
    assert.equal(await crearDescargaMedia({ wahaBaseUrl: w.base, apiKey: 'OTRA', session: 'demo' })({ chatId: '51@c.us', mensajeId: 'm1', mediaUrl: 'http://x/api/files/foto.jpeg' }), null);
  } finally { await w.cerrar(); }
});
```

Parche para `waha/test/motor.test.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/test/motor.test.js
+++ b/waha/test/motor.test.js
@@ -2,6 +2,7 @@
 const assert = require('node:assert/strict');
 const { Flow } = require('../../kapso/build/flow');
 const { ErrorEnvio } = require('../src/provider/waha');
+const { ErrorBackend } = require('../src/backend/real/errores');
 const { abrirDb } = require('../src/estado/db');
 const { crearMundo, msg } = require('./helpers/mundo');
 
@@ -213,3 +214,95 @@
   assert.deepEqual(proveedor.textos(), []);
   assert.equal(almacen.cargarEjecucion(T), null);
 });
+
+test('la función recibe el chat y los datos del archivo del mensaje entrante', async () => {
+  const flujos = w0((f) => { f.wait('w').api('r', 'x', { edges: ['a'] }); f.link('start', 'w').link('w', 'r'); });
+  let visto;
+  const llamarFuncion = async (a) => { visto = a; return { vars: {}, next_edge: 'a' }; };
+  const { motor } = crearMundo({ flujos, llamarFuncion });
+  await motor.procesarMensaje(msg(T, 'inicio'));
+  await motor.procesarMensaje(msg(T, '', { tieneMedia: true, tipoMensaje: 'image', mensajeId: 'wamid-foto', mediaUrl: 'http://waha/api/files/f.jpeg', mimetype: 'image/jpeg' }));
+  assert.equal(visto.chatId, `${T}@c.us`);
+  const m = visto.wa.messages.at(-1);
+  assert.equal(m.media_url, 'http://waha/api/files/f.jpeg');
+  assert.equal(m.mimetype, 'image/jpeg');
+  assert.equal(m.whatsapp_message_id, 'wamid-foto');
+});
+
+test('lista dinámica: las filas salen de una variable (máximo 10) y el texto también se interpreta', async () => {
+  const flujos = w0((f) => {
+    f.setvar('s', 'dummy', 'x');
+    f._add('l', 'send_interactive', { interactive_type: 'list', body_text: 'Elige cuenta', list_button_text: 'Elegir', rows_var: 'cuentas_opts' });
+    f.wait('w').api('r', 'route', { edges: ['a', 'b', 'invalido'] }).text('t', 'ok');
+    f.link('start', 's').link('s', 'l').link('l', 'w').link('w', 'r').link('r', 't', 'a').link('r', 't', 'b').link('r', 't', 'invalido');
+  });
+  const filas = Array.from({ length: 12 }, (_, i) => ({ id: `acc:${i}`, title: `Banco ${i} ••${1000 + i}` }));
+  let id;
+  const { motor, proveedor } = crearMundo({ flujos, llamarFuncion: async ({ wa }) => { id = wa.messages.at(-1).reply_option_id; return { vars: {}, next_edge: 'a' }; } });
+  await motor.iniciar('W0', T, `${T}@c.us`, { cuentas_opts: filas });
+  const lista = proveedor.enviados[0];
+  assert.equal(lista.tipo, 'lista');
+  assert.equal(lista.opciones.length, 10);
+  assert.equal(lista.opciones[0].id, 'acc:0');
+  await motor.procesarMensaje(msg(T, '3'));
+  assert.equal(id, 'acc:2');
+});
+
+test('lista dinámica sin filas es un error del flujo, no un mensaje vacío', async () => {
+  const flujos = w0((f) => {
+    f._add('l', 'send_interactive', { interactive_type: 'list', body_text: 'x', list_button_text: 'y', rows_var: 'cuentas_opts' });
+    f.link('start', 'l');
+  });
+  const { motor, proveedor } = crearMundo({ flujos });
+  await motor.procesarMensaje(msg(T, 'x'));
+  assert.deepEqual(proveedor.textos(), ['Te paso con una persona del equipo para ayudarte.']);
+});
+
+test('un fallo de transporte del backend avisa del problema temporal, conserva el paso y el siguiente mensaje reintenta', async () => {
+  const flujos = w0((f) => { f.api('d', 'cotizar', { edges: ['ok'] }).text('t', 'cotizado'); f.link('start', 'd').link('d', 't', 'ok'); });
+  let intentos = 0;
+  const acciones = [];
+  const llamarFuncion = async ({ vars }) => {
+    acciones.push(vars.api_action);
+    if (vars.api_action === 'cotizar' && ++intentos === 1) throw new ErrorBackend('Firebase no respondió', { codigo: 'timeout', transporte: true });
+    return { vars: {}, next_edge: 'ok' };
+  };
+  const { motor, proveedor, almacen } = crearMundo({ flujos, llamarFuncion });
+  await motor.procesarMensaje(msg(T, 'hola'));
+  assert.deepEqual(proveedor.textos(), ['Tuvimos un problema temporal. Intenta de nuevo en un momento.']);
+  assert.ok(almacen.cargarEjecucion(T), 'la conversación se conserva');
+  assert.ok(!acciones.includes('handoff_to_human:error_motor'));
+  await motor.procesarMensaje(msg(T, 'ya'));
+  assert.deepEqual(proveedor.textos().at(-1), 'cotizado');
+  assert.equal(almacen.cargarEjecucion(T), null);
+});
+
+test('un error de negocio inesperado del backend sí escala a persona', async () => {
+  const flujos = w0((f) => { f.api('d', 'cotizar', { edges: ['ok'] }); f.link('start', 'd'); });
+  const llamarFuncion = async ({ vars }) => { if (vars.api_action === 'cotizar') throw new ErrorBackend('raro', { codigo: 'codigo-desconocido', estado: 400 }); return { vars: {} }; };
+  const { motor, proveedor } = crearMundo({ flujos, llamarFuncion });
+  await motor.procesarMensaje(msg(T, 'hola'));
+  assert.deepEqual(proveedor.textos(), ['Te paso con una persona del equipo para ayudarte.']);
+});
+
+test('un fallo de transporte en un workflow lanzado por API no avisa al cliente y se informa a quien lo lanzó', async () => {
+  const e4 = new Flow('E4', 'E4', 'e4'); e4.start().text('t', 'aviso'); e4.link('start', 't');
+  const w = new Flow('E4b', 'E4b', 'e4b'); w.start().api('d', 'x', { edges: ['ok'] }).text('t', 'aviso'); w.link('start', 'd').link('d', 't', 'ok');
+  const { motor, proveedor, almacen } = crearMundo({ flujos: { E4: w }, llamarFuncion: async () => { throw new ErrorBackend('red', { codigo: 'red', transporte: true }); } });
+  const r = await motor.iniciar('E4', T, `${T}@c.us`, {});
+  assert.deepEqual(r, { iniciado: true, fallo: 'transporte' });
+  assert.deepEqual(proveedor.textos(), []);
+  assert.equal(almacen.cargarEjecucion(T), null);
+});
+
+test('el estado guardado no incluye el texto de los mensajes del cliente, pero el agente lo ve en el mismo turno', async () => {
+  const flujos = w0((f) => { f.agent('ag', { system_prompt: 'x' }).wait('w'); f.link('start', 'ag').link('ag', 'w'); });
+  const vistos = [];
+  const { motor, almacen } = crearMundo({ flujos, extraer: async (texto) => { vistos.push(texto); return {}; } });
+  await motor.procesarMensaje(msg(T, 'mi DNI es 12345678 y mi correo ana@example.com'));
+  assert.deepEqual(vistos, ['mi DNI es 12345678 y mi correo ana@example.com']);
+  const guardado = almacen.cargarEjecucion(T);
+  assert.ok(guardado.entrantes.length >= 1);
+  assert.ok(guardado.entrantes.every((e) => e.text === ''));
+  assert.ok(!JSON.stringify(guardado).includes('12345678'));
+});
```

Parche para `waha/test/normalizar.test.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/test/normalizar.test.js
+++ b/waha/test/normalizar.test.js
@@ -88,3 +88,16 @@
   delete e.payload._data.key.remoteJidAlt;
   assert.equal(normalizarEvento(e).telefono, '184512345678901');
 });
+
+test('el mensaje con archivo trae la URL de descarga y el tipo cuando WAHA los entrega', () => {
+  const e = fx('message_image');
+  e.payload.media = { url: 'http://localhost:3000/api/files/f.jpeg', mimetype: 'image/jpeg' };
+  const m = normalizarEvento(e);
+  assert.equal(m.mediaUrl, 'http://localhost:3000/api/files/f.jpeg');
+  assert.equal(m.mimetype, 'image/jpeg');
+  const sinUrl = normalizarEvento(fx('message_image'));
+  assert.equal(sinUrl.mediaUrl, null);
+  assert.equal(sinUrl.mimetype, 'image/jpeg');
+  assert.equal(normalizarEvento(fx('message_text')).mediaUrl, null);
+  assert.equal(normalizarEvento(fx('message_text')).mimetype, null);
+});
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test waha/test/motor.test.js waha/test/normalizar.test.js waha/test/media.test.js`
Expected: FAIL (pruebas nuevas del motor y módulo `../src/media` inexistente)

- [ ] **Step 3: Escribir el código**

`waha/src/media.js`:

```js
// Baja la foto o el PDF que el cliente mandó por WhatsApp desde WAHA (para subirlo a Storage).
// WAHA entrega `media.url` con su propio host (p. ej. http://localhost:3000/api/files/…); aquí solo se usa la ruta,
// contra la dirección de WAHA que ve este servidor. Sin URL se pide el mensaje con downloadMedia=true.
const { ErrorBackend } = require('./backend/real/errores');

function crearDescargaMedia({ wahaBaseUrl, apiKey, session, fetchImpl = fetch, timeoutMs = 20000 }) {
  const base = String(wahaBaseUrl).replace(/\/$/, '');
  const cab = { 'X-Api-Key': apiKey };

  async function pedir(url) {
    try {
      return await fetchImpl(url, { headers: cab, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ErrorBackend('No pude conectar con WAHA para bajar el archivo', { codigo: 'waha_red', transporte: true });
    }
  }

  async function bajar(urlEvento, mimetype) {
    const ruta = new URL(urlEvento, 'http://local').pathname;
    const res = await pedir(`${base}${ruta}`);
    if (!res.ok) return null;
    const tipo = mimetype || String(res.headers.get('content-type') || '').split(';')[0].trim() || null;
    return { bytes: Buffer.from(await res.arrayBuffer()), mimetype: tipo };
  }

  return async function descargar({ chatId, mensajeId, mediaUrl, mimetype }) {
    if (mediaUrl) return bajar(mediaUrl, mimetype);
    const res = await pedir(`${base}/api/${session}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(mensajeId)}?downloadMedia=true`);
    if (!res.ok) return null;
    const m = await res.json().catch(() => null);
    return m && m.media && m.media.url ? bajar(m.media.url, m.media.mimetype || mimetype) : null;
  };
}

module.exports = { crearDescargaMedia };
```

Parche para `waha/src/motor/motor.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/motor/motor.js
+++ b/waha/src/motor/motor.js
@@ -7,6 +7,7 @@
 
 const MAX_PASOS = 150;
 const MSG_PERSONA = 'Te paso con una persona del equipo para ayudarte.';
+const MSG_TEMPORAL = 'Tuvimos un problema temporal. Intenta de nuevo en un momento.';
 
 class ErrorMotor extends Error {}
 
@@ -15,6 +16,10 @@
   for (const [clave, f] of Object.entries(flujos)) idx[clave] = { nodos: new Map(f.nodes.map((n) => [n.id, n])), aristas: f.edges };
   const cola = crearCola();
 
+  // Lo que se guarda no lleva el texto de los mensajes del cliente (puede traer documentos, correos o cuentas):
+  // el agente lo lee en el mismo turno, antes de guardar.
+  const persistible = (ej) => ({ ...ej, entrantes: ej.entrantes.map((e) => ({ ...e, text: '' })) });
+
   const nueva = (flujo, telefono, chatId, vars = {}) => ({
     telefono, chatId, pila: [{ flujo, nodo: 'start' }], vars, esperando: null, opciones: null, entrantes: [],
   });
@@ -35,7 +40,7 @@
   }
 
   async function invocar(ej, edges) {
-    const out = await llamarFuncion({ vars: ej.vars, phone: ej.telefono, edges, wa: { messages: ej.entrantes } });
+    const out = await llamarFuncion({ vars: ej.vars, phone: ej.telefono, edges, wa: { messages: ej.entrantes }, chatId: ej.chatId });
     if (out.vars) Object.assign(ej.vars, out.vars);
     return out;
   }
@@ -46,7 +51,9 @@
       await proveedor.enviarBotones(ej.chatId, cuerpo, c.buttons);
       ej.opciones = c.buttons;
     } else if (c.interactive_type === 'list') {
-      const filas = c.list_sections.flatMap((s) => s.rows);
+      // Las filas son fijas en el grafo o salen de una variable (`rows_var`), p. ej. las cuentas guardadas del cliente.
+      const filas = c.rows_var ? (Array.isArray(ej.vars[c.rows_var]) ? ej.vars[c.rows_var].slice(0, 10) : []) : c.list_sections.flatMap((s) => s.rows);
+      if (!filas.length) throw new ErrorMotor(`lista sin filas en ${c.rows_var || 'el grafo'}`);
       await proveedor.enviarLista(ej.chatId, cuerpo, c.list_button_text, filas);
       ej.opciones = filas;
     } else if (c.interactive_type === 'cta_url') {
@@ -116,23 +123,37 @@
         const nodo = f.nodos.get(frame.nodo);
         if (!nodo) throw new ErrorMotor(`nodo inexistente ${frame.flujo}.${frame.nodo}`);
         const r = await ejecutarNodo(ej, nodo);
-        if (r.detener === 'espera') { almacen.guardarEjecucion(ej.telefono, ej); return; }
+        if (r.detener === 'espera') { almacen.guardarEjecucion(ej.telefono, persistible(ej)); return 'espera'; }
         if (r.detener === 'handoff') break;
         if (r.llamada) continue;
         if (!avanzar(ej, r.etiqueta || 'next')) break;
       }
       almacen.borrarEjecucion(ej.telefono);
+      return 'ok';
     } catch (e) {
       if (e && e.name === 'ErrorEnvio') {
         // Fallo de transporte (WAHA caído, 5xx agotados, 463/475): no es culpa del cliente ni del flujo. No se escala ni se
         // pierde la operación. En una conversación (W0) el estado queda en el nodo que falló y el siguiente mensaje reintenta;
         // en un aviso por API (E4) no queda conversación y el backend puede volver a avisar.
         almacen.registrar({ tipo: 'error_envio', chat: enmascarar(ej.chatId), estado: String(e.estado || 'red'), detalle: e.restriccion ? 'restriccion_whatsapp' : 'transporte' });
-        if (ej.pila[0] && ej.pila[0].flujo === 'W0') almacen.guardarEjecucion(ej.telefono, ej);
+        if (ej.pila[0] && ej.pila[0].flujo === 'W0') almacen.guardarEjecucion(ej.telefono, persistible(ej));
         else almacen.borrarEjecucion(ej.telefono);
-        return;
+        return 'transporte';
       }
+      if (e && e.name === 'ErrorBackend' && e.transporte) {
+        // Firebase no respondió (red, timeout, 5xx): tampoco se escala. En una conversación se avisa al cliente y el siguiente
+        // mensaje reintenta el paso que falló; un aviso lanzado por API no molesta al cliente y quien lo lanzó puede repetirlo.
+        almacen.registrar({ tipo: 'error_backend', chat: enmascarar(ej.chatId), estado: String(e.estado || e.codigo || 'red'), detalle: e.codigo || 'transporte' });
+        if (ej.pila[0] && ej.pila[0].flujo === 'W0') {
+          try { await proveedor.enviarTexto(ej.chatId, MSG_TEMPORAL); } catch { /* ya hay registro del fallo */ }
+          almacen.guardarEjecucion(ej.telefono, persistible(ej));
+        } else {
+          almacen.borrarEjecucion(ej.telefono);
+        }
+        return 'transporte';
+      }
       await escalarPorError(ej, e);
+      return 'escalado';
     }
   }
 
@@ -140,6 +161,7 @@
     return {
       direction: 'inbound', created_at: ahora().toISOString(), id: msg.mensajeId, whatsapp_message_id: msg.mensajeId,
       message_type: msg.tipoMensaje, has_media: msg.tieneMedia, reply_option_id: null, text: msg.texto || '',
+      media_url: msg.mediaUrl || null, mimetype: msg.mimetype || null,
     };
   }
 
@@ -167,12 +189,12 @@
   function iniciar(flujo, telefono, chatId, vars = {}) {
     return cola.ejecutar(telefono, async () => {
       if (almacen.cargarEjecucion(telefono)) return { iniciado: false, motivo: 'ocupado' };
-      await correr(nueva(flujo, telefono, chatId, { ...vars }));
-      return { iniciado: true };
+      const resultado = await correr(nueva(flujo, telefono, chatId, { ...vars }));
+      return resultado === 'transporte' || resultado === 'escalado' ? { iniciado: true, fallo: resultado } : { iniciado: true };
     });
   }
 
   return { procesarMensaje, iniciar };
 }
 
-module.exports = { crearMotor, MSG_PERSONA, ErrorMotor };
+module.exports = { crearMotor, MSG_PERSONA, MSG_TEMPORAL, ErrorMotor };
```

Parche para `waha/src/webhook/normalizar.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/webhook/normalizar.js
+++ b/waha/src/webhook/normalizar.js
@@ -44,6 +44,8 @@
     opcionId,
     tieneMedia: Boolean(p.hasMedia),
     tipoMensaje: tipoDeMedia(p),
+    mediaUrl: (p.media && p.media.url) || null,
+    mimetype: (p.media && p.media.mimetype) || (p._data && p._data.mimetype) || null,
     creado: new Date((Number(p.timestamp) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
   };
 }
```

- [ ] **Step 4: Ver que pasan**

Run: `node --test waha/test/motor.test.js waha/test/normalizar.test.js waha/test/media.test.js`
Expected: PASS, 0 fallos

- [ ] **Commit**

```bash
git add waha/src/media.js waha/src/motor/motor.js waha/src/webhook/normalizar.js waha/test/media.test.js waha/test/motor.test.js waha/test/normalizar.test.js
git commit -m "feat(waha): el motor pasa el chat y los medios, soporta listas dinámicas y fallos de transporte, y no persiste el texto del cliente

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 6: Acciones del backend real y fábrica `crearBackend`

**Files:**
- Create: `waha/src/backend/real/acciones.js`, `waha/src/backend/index.js`
- Test: `waha/test/backend-acciones.test.js`

**Interfaces:**
- Consumes: sesión, funciones, Firestore, Storage, almacén (tarea 4), validadores y formato (tarea 1), el falso (tarea 3), `kapso/functions/brasper-api.js` (acciones genéricas delegadas al simulador).
- Produces:
  - `crearBackend({ modo='simulado'|'real', almacen, entorno, configReal, fetchImpl, descargarMedia, ahora, registrar, timeoutMs, dormir, varsFijas }) -> { modo, llamarFuncion, sesiones?, funciones?, firestore?, storage? }`. `llamarFuncion({ vars, phone, edges, wa, chatId }) -> { vars, next_edge }` es el contrato que usa el motor.
  - Acciones (`vars.api_action`): `quote_create`, `perfil_get`, `validate:<campo>`, `cuentas_opciones`, `route_cuenta`, `banco_set`, `order_create` (reconcilia por `quoteId` y borra los datos personales), `route_campo`, `orden_info`, `check_lock`, `proof_upload`, `proof_submit` (abre el seguimiento), `cancel_order`, `handoff_to_human` (`requestHuman` y marcador `handoff:<tel>`), `get_status`, `route_evento`; las demás se delegan al simulador y una arista no declarada es un error visible.
  - `varsOrden(orden)`, `varsCotizacion(q)`, `TEXTO_ESTADO`, `SIN_DATOS_PERSONALES`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/backend-acciones.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearBackend } = require('../src/backend');
const { ErrorBackend } = require('../src/backend/real/errores');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

const T = '51944686794';
const CHAT = `${T}@c.us`;
const COTIZACION = { monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' };
const DATOS = { nombre: 'Ana Paula Souza', doc_tipo: 'CPF', doc_num: '52998224725', correo: 'ana@example.com', fondos: 'savings', origen_banco: 'Nubank', origen_cuenta: '0001-12345678-9', destino_banco: 'BCP', destino_cuenta: '191-1234567890' };

async function mundo({ timeoutMs, ahora } = {}) {
  const falso = await crearFirebaseFalso();
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const registrados = [];
  let descargar = async () => null;
  const media = { usar: (fn) => { descargar = fn; } };
  const backend = crearBackend({ modo: 'real', almacen, configReal: falso.config, descargarMedia: (p) => descargar(p), timeoutMs, ahora, registrar: (e) => registrados.push(e), dormir: async () => {} });
  const llamar = (accion, vars = {}, extra = {}) => backend.llamarFuncion({ vars: { api_action: accion, ...vars }, phone: T, edges: extra.edges || [], wa: extra.wa || { messages: [] }, chatId: CHAT });
  return { falso, almacen, backend, llamar, registrados, media, cerrar: () => falso.cerrar() };
}
const entrante = (extra) => ({ messages: [{ direction: 'inbound', ...extra }] });
const conMundo = async (fn, opciones) => { const m = await mundo(opciones); try { await fn(m); } finally { await m.cerrar(); } };
const OK = ['ok', 'sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona'];

// Deja al cliente con una orden creada y devuelve sus variables.
async function conOrden(m) {
  const q = await m.llamar('quote_create', COTIZACION, { edges: OK });
  const r = await m.llamar('order_create', { ...COTIZACION, ...q.vars, ...DATOS }, { edges: ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'] });
  assert.equal(r.next_edge, 'ok');
  return r.vars;
}

test('quote_create: cotiza por el canal whatsapp y deja los datos para el mensaje', () => conMundo(async (m) => {
  const r = await m.llamar('quote_create', COTIZACION, { edges: OK });
  assert.equal(r.next_edge, 'ok');
  assert.deepEqual([r.vars.tasa_txt, r.vars.comision_txt, r.vars.impuesto_txt, r.vars.total_enviar_txt, r.vars.recibe_txt], ['0.6745', '12.00', '2.16', '514.16', '337.25']);
  assert.match(r.vars.tasa_hasta, /^\d{1,2}:\d\d [ap]\. m\.$/);
  assert.ok(r.vars.quote_id);
  assert.equal(m.falso.llamadas.at(-1).data.channel, 'whatsapp');
}));

test('quote_create: los códigos del backend se traducen a aristas del grafo', () => conMundo(async (m) => {
  const borde = async (vars) => (await m.llamar('quote_create', vars, { edges: OK })).next_edge;
  assert.equal(await borde({ ...COTIZACION, monto: 20000 }), 'requiere_persona');
  assert.equal(await borde({ ...COTIZACION, monto: 10 }), 'monto_bajo');
  assert.equal(await borde({ ...COTIZACION, moneda_destino: 'BRL' }), 'par_invalido');
  assert.equal(await borde({ monto: 'abc', moneda_origen: 'BRL', moneda_destino: 'PEN' }), 'par_invalido');
  m.falso.fallar('/fn/createquote', { estado: 503, veces: 1, cuerpo: '{"error":{"status":"UNAVAILABLE","message":"rates-unavailable"}}' });
  assert.equal(await borde(COTIZACION), 'sin_servicio');
}));

test('quote_create: un fallo de transporte sube al motor (se reintenta una vez antes)', () => conMundo(async (m) => {
  m.falso.fallar('/fn/createquote', { estado: 502, veces: 1 });
  assert.equal((await m.llamar('quote_create', COTIZACION, { edges: OK })).next_edge, 'ok'); // el reintento lo resuelve
  m.falso.fallar('/fn/createquote', { estado: 502, veces: 2 });
  await assert.rejects(() => m.llamar('quote_create', COTIZACION, { edges: OK }), (e) => e instanceof ErrorBackend && e.transporte === true);
}));

test('perfil_get: nuevo si no hay perfil; existe con los datos y las cuentas tras una orden', () => conMundo(async (m) => {
  const nuevo = await m.llamar('perfil_get', {}, { edges: ['nuevo', 'existe'] });
  assert.equal(nuevo.next_edge, 'nuevo');
  await conOrden(m);
  const e = await m.llamar('perfil_get', {}, { edges: ['nuevo', 'existe'] });
  assert.equal(e.next_edge, 'existe');
  assert.equal(e.vars.nombre, 'Ana Paula Souza');
  assert.equal(e.vars.doc_tipo, 'CPF');
  assert.equal(e.vars.doc_num, '52998224725');
  assert.equal(e.vars.correo_masc, 'a***@example.com');
  assert.deepEqual(e.vars.cuentas_perfil.map((c) => `${c.bank}|${c.currency}`), ['Nubank|BRL', 'BCP|PEN']);
}));

test('validate: cada campo guarda su valor limpio; el segundo fallo seguido escala', () => conMundo(async (m) => {
  const v = (campo, vars) => m.llamar(`validate:${campo}`, vars, { edges: ['valido', 'invalido', 'escalar'] });
  assert.deepEqual((await v('nombre', { nombre_raw: '  Ana   Souza ' })).vars.nombre, 'Ana Souza');
  assert.equal((await v('doc', { doc_tipo: 'DNI', doc_raw: '1234 5678' })).vars.doc_num, '12345678');
  assert.equal((await v('doc', { doc_tipo: 'CPF', doc_raw: '529.982.247-25' })).vars.doc_num, '52998224725');
  assert.equal((await v('doc', { doc_tipo: 'DNI', doc_raw: '1234567' })).next_edge, 'invalido');
  const c = await v('correo', { correo_raw: ' Ana@Example.COM ' });
  assert.deepEqual([c.vars.correo, c.vars.correo_masc], ['ana@example.com', 'a***@example.com']);
  const o = await v('cuenta_origen', { origen_cuenta_raw: '0001-12345678-9' });
  assert.deepEqual([o.vars.origen_cuenta, o.vars.origen_ult4], ['0001-12345678-9', '6789']);
  assert.equal((await v('cuenta_destino', { destino_cuenta_raw: '191-1234567890' })).vars.destino_ult4, '7890');
  assert.equal((await v('banco_destino', { destino_banco_raw: '  Banco   Pichincha ' })).vars.destino_banco, 'Banco Pichincha');
  assert.equal((await v('operacion', { operacion_raw: ' ab-1234 ' })).vars.operacion_no, 'AB-1234');
  // segundo fallo seguido del mismo campo → escalar; un acierto reinicia el contador
  const a = await v('correo', { correo_raw: 'mal' });
  assert.equal(a.next_edge, 'invalido');
  const b = await v('correo', { correo_raw: 'mal', ...a.vars });
  assert.equal(b.next_edge, 'escalar');
  const c2 = await v('correo', { correo_raw: 'ana@example.com', ...a.vars });
  assert.equal(c2.vars.fallos_correo, 0);
}));

test('cuentas_opciones y route_cuenta: lista las cuentas guardadas de esa moneda y resuelve la elegida', () => conMundo(async (m) => {
  const perfil = (await m.llamar('perfil_get', {}, { edges: ['nuevo', 'existe'] })).vars;
  assert.equal((await m.llamar('cuentas_opciones:origen', { ...COTIZACION, ...perfil }, { edges: ['con_cuentas', 'sin_cuentas'] })).next_edge, 'sin_cuentas');
  await conOrden(m);
  const p = (await m.llamar('perfil_get', {}, { edges: ['nuevo', 'existe'] })).vars;
  const base = { ...COTIZACION, ...p };
  const op = await m.llamar('cuentas_opciones:origen', base, { edges: ['con_cuentas', 'sin_cuentas'] });
  assert.equal(op.next_edge, 'con_cuentas');
  assert.deepEqual(op.vars.opciones_origen, [{ id: 'acc:0', title: 'Nubank ••6789' }, { id: 'otra', title: 'Otra cuenta' }]);
  const dest = await m.llamar('cuentas_opciones:destino', base, { edges: ['con_cuentas', 'sin_cuentas'] });
  assert.deepEqual(dest.vars.opciones_destino.map((f) => f.title), ['BCP ••7890', 'Otra cuenta']);
  const ruta = (id, vars) => m.llamar('route_cuenta:origen', { ...base, ...op.vars, ...vars }, { edges: ['elegida', 'otra', 'invalido', 'escalar'], wa: entrante({ reply_option_id: id }) });
  const elegida = await ruta('acc:0');
  assert.equal(elegida.next_edge, 'elegida');
  assert.deepEqual([elegida.vars.origen_banco, elegida.vars.origen_cuenta, elegida.vars.origen_ult4], ['Nubank', '0001-12345678-9', '6789']);
  assert.equal((await ruta('otra')).next_edge, 'otra');
  const mal = await ruta('acc:9');
  assert.equal(mal.next_edge, 'invalido');
  assert.equal((await ruta('zzz', mal.vars)).next_edge, 'escalar');
}));

test('banco_set copia el banco elegido de la lista', () => conMundo(async (m) => {
  const r = await m.llamar('banco_set:origen', { origen_banco_sel: 'Itaú' });
  assert.deepEqual(r.vars, { origen_banco: 'Itaú' });
}));

test('order_create: crea la orden, guarda cómo encontrarla y borra los datos personales del estado', () => conMundo(async (m) => {
  const v = await conOrden(m);
  assert.equal(v.operacion_id, 'BR-0001');
  assert.deepEqual([v.pago_titular, v.pago_banco, v.pago_cuenta], ['BrasPer (DEMO)', 'Nubank', '0001-0000001-0']);
  assert.equal(v.pago_pix_linea, '\nPix: pix@brasper.demo');
  assert.equal(v.total_enviar_txt, '514.16');
  assert.match(v.tasa_hasta, /^\d{1,2}:\d\d [ap]\. m\.$/);
  assert.equal(v.destino_ult4, '7890');
  for (const campo of ['nombre', 'doc_num', 'doc_raw', 'correo', 'origen_cuenta', 'destino_cuenta']) assert.equal(v[campo], '', campo);
  assert.deepEqual(v.cuentas_perfil, []);
  assert.deepEqual(m.almacen.ordenesDe(T).map((o) => o.ordenId), ['BR-0001']);
  assert.ok(!JSON.stringify(v).includes('52998224725') && !JSON.stringify(v).includes('ana@example.com'));
}));

test('order_create: los errores de negocio se traducen y los datos malos dicen qué campo repreguntar', () => conMundo(async (m) => {
  const q = (await m.llamar('quote_create', COTIZACION, { edges: OK })).vars;
  const E = ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'];
  const crear = (extra) => m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS, ...extra }, { edges: E });
  const malDoc = await crear({ doc_num: '52998224724' });
  assert.equal(malDoc.next_edge, 'dato_invalido');
  assert.equal(malDoc.vars.campo_invalido, 'documento');
  assert.equal((await m.llamar('route_campo', malDoc.vars, { edges: ['nombre', 'documento', 'correo', 'otro'] })).next_edge, 'documento');
  assert.equal((await crear({ correo: 'mal' })).vars.campo_invalido, 'correo');
  assert.equal((await crear({ nombre: 'Ana' })).vars.campo_invalido, 'nombre');
  const otro = await crear({ fondos: 'raro' });
  assert.equal(otro.vars.campo_invalido, 'otro');
  assert.equal((await m.llamar('route_campo', otro.vars, { edges: ['nombre', 'documento', 'correo', 'otro'] })).next_edge, 'otro');
  m.falso.avanzar(16);
  assert.equal((await crear({})).next_edge, 'quote_expirada');
  assert.equal((await crear({ quote_id: 'Q9999' })).next_edge, 'quote_expirada');
}));

test('order_create: si la respuesta se pierde por un timeout, reconcilia por la cotización y no duplica la orden', () => conMundo(async (m) => {
  const q = (await m.llamar('quote_create', COTIZACION, { edges: OK })).vars;
  m.falso.demorar('/fn/createorder', 400, { despuesDeEfecto: true });
  const r = await m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS }, { edges: ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'] });
  assert.equal(r.next_edge, 'ok');
  assert.equal(r.vars.operacion_id, 'BR-0001');
  assert.equal(m.falso.ordenes.size, 1);
}, { timeoutMs: 80 }));

test('order_create: una cotización ya usada recupera la orden que se creó antes', () => conMundo(async (m) => {
  const q = (await m.llamar('quote_create', COTIZACION, { edges: OK })).vars;
  const E = ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'];
  await m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS }, { edges: E });
  const otra = await m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS }, { edges: E });
  assert.equal(otra.next_edge, 'ok');
  assert.equal(otra.vars.operacion_id, 'BR-0001');
  assert.equal(m.falso.ordenes.size, 1);
}));

test('check_lock distingue el bloqueo de tasa vigente del vencido', () => conMundo(async (m) => {
  const v = await conOrden(m);
  const lock = (vars) => m.llamar('check_lock', vars, { edges: ['vigente', 'vencida'] });
  assert.equal((await lock(v)).next_edge, 'vigente');
  assert.equal((await lock({ lock_iso: '2020-01-01T00:00:00Z' })).next_edge, 'vencida');
  assert.equal((await lock({})).next_edge, 'vencida');
}));

test('orden_info: si faltan los datos de pago los lee de la última orden', () => conMundo(async (m) => {
  const v = await conOrden(m);
  const r = await m.llamar('orden_info', { operacion_id: 'BR-0001' });
  assert.equal(r.vars.pago_cuenta, v.pago_cuenta);
  assert.deepEqual((await m.llamar('orden_info', { pago_cuenta: 'ya-estaba' })).vars, {});
}));

const EDGES_E2 = ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'];
const EDGES_FOTO = ['subida', 'sin_foto', 'muy_grande', 'fallo_subida', 'escalar'];
const FOTO = (extra) => entrante({ has_media: true, message_type: 'image', whatsapp_message_id: 'wamid-1', media_url: 'http://waha/api/files/f.jpeg', mimetype: 'image/jpeg', ...extra });
const jpeg = (bytes = Buffer.from('JPEGDATA')) => async () => ({ bytes, mimetype: 'image/jpeg' });

test('proof_upload: sube la foto bajada de WAHA a proofs/<uid>/<orden>/ y guarda la ruta', () => conMundo(async (m) => {
  const pedidos = [];
  m.media.usar(async (p) => { pedidos.push(p); return { bytes: Buffer.from('JPEGDATA'), mimetype: 'image/jpeg' }; });
  const v = await conOrden(m);
  const r = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  assert.equal(r.next_edge, 'subida');
  assert.match(r.vars.proof_path, new RegExp(`^proofs/${m.almacen.sesionFirebase(T).uid}/BR-0001/proof-\\d+\\.jpg$`));
  assert.equal(m.falso.archivos.get(r.vars.proof_path).bytes.toString(), 'JPEGDATA');
  assert.deepEqual(pedidos, [{ chatId: CHAT, mensajeId: 'wamid-1', mediaUrl: 'http://waha/api/files/f.jpeg', mimetype: 'image/jpeg' }]);
  assert.equal(r.vars.fallos_comprobante, 0);
}));

test('proof_upload: sin foto, tipo no permitido o descarga fallida cuentan como fallo y el segundo escala', () => conMundo(async (m) => {
  const v = await conOrden(m);
  const sinMedia = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: entrante({ has_media: false, message_type: 'text' }) });
  assert.equal(sinMedia.next_edge, 'sin_foto');
  const otra = await m.llamar('proof_upload', { ...v, ...sinMedia.vars }, { edges: EDGES_FOTO, wa: entrante({ has_media: false, message_type: 'text' }) });
  assert.equal(otra.next_edge, 'escalar');
  m.media.usar(async () => ({ bytes: Buffer.from('v'), mimetype: 'video/mp4' }));
  assert.equal((await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() })).next_edge, 'sin_foto');
  m.media.usar(async () => null);
  assert.equal((await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() })).next_edge, 'sin_foto');
  assert.equal(m.falso.archivos.size, 0);
}));

test('proof_upload: más de 8 MB es muy_grande y un rechazo de Storage es fallo_subida', () => conMundo(async (m) => {
  const v = await conOrden(m);
  m.media.usar(jpeg(Buffer.alloc(8 * 1024 * 1024)));
  assert.equal((await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() })).next_edge, 'muy_grande');
  m.media.usar(jpeg());
  assert.equal((await m.llamar('proof_upload', { ...v, operacion_id: 'BR-0001' }, { edges: EDGES_FOTO, wa: FOTO() })).next_edge, 'subida');
  const ajena = await m.llamar('proof_upload', { ...v, operacion_id: '../otra' }, { edges: EDGES_FOTO, wa: FOTO() });
  assert.ok(['fallo_subida', 'subida'].includes(ajena.next_edge));
}));

test('proof_submit: registra el pago, abre el seguimiento y la orden pasa a validating', () => conMundo(async (m) => {
  m.media.usar(jpeg());
  const v = await conOrden(m);
  const foto = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  const val = (await m.llamar('validate:operacion', { operacion_raw: 'ab-1234' }, { edges: ['valido', 'invalido', 'escalar'] })).vars;
  const r = await m.llamar('proof_submit', { ...v, ...foto.vars, ...val }, { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  assert.equal(r.next_edge, 'ok');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
  assert.equal(m.falso.ordenes.get('BR-0001').operationNo, 'AB-1234');
  const seg = m.almacen.seguimiento('BR-0001');
  assert.deepEqual([seg.telefono, seg.chatId, seg.cerrado], [T, CHAT, 0]);
}));

test('proof_submit: número duplicado, foto que no está y comprobante ya recibido', () => conMundo(async (m) => {
  m.media.usar(jpeg());
  const E = ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'];
  const v = await conOrden(m);
  const foto = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  const base = { ...v, ...foto.vars, operacion_no: 'AB-1234' };
  assert.equal((await m.llamar('proof_submit', { ...base, proof_path: `${foto.vars.proof_path}.inexistente` }, { edges: E })).next_edge, 'sin_subida');
  assert.equal((await m.llamar('proof_submit', { ...base, operacion_no: '12' }, { edges: E })).next_edge, 'invalido');
  assert.equal((await m.llamar('proof_submit', base, { edges: E })).next_edge, 'ok');
  assert.equal((await m.llamar('proof_submit', base, { edges: E })).next_edge, 'ya_recibido'); // order-not-pending, pero la orden ya está en validating
  // segunda orden con el mismo número de operación
  const q = (await m.llamar('quote_create', COTIZACION, { edges: OK })).vars;
  const o2 = (await m.llamar('order_create', { ...COTIZACION, ...q, ...DATOS }, { edges: EDGES_E2 })).vars;
  const f2 = await m.llamar('proof_upload', o2, { edges: EDGES_FOTO, wa: FOTO() });
  assert.equal((await m.llamar('proof_submit', { ...o2, ...f2.vars, operacion_no: 'AB-1234' }, { edges: E })).next_edge, 'duplicado');
}));

test('proof_submit: si la respuesta se pierde por un timeout, confirma leyendo la orden y no la da por perdida', () => conMundo(async (m) => {
  m.media.usar(jpeg());
  const v = await conOrden(m);
  const foto = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  m.falso.demorar('/fn/submitproof', 400, { despuesDeEfecto: true });
  const r = await m.llamar('proof_submit', { ...v, ...foto.vars, operacion_no: 'AB-1234' }, { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  assert.equal(r.next_edge, 'ok');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
}, { timeoutMs: 80 }));

test('cancel_order cancela la orden pendiente y tolera que ya no lo esté', () => conMundo(async (m) => {
  const v = await conOrden(m);
  assert.deepEqual((await m.llamar('cancel_order', v)).vars, { estado: 'cancelled' });
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'cancelled');
  assert.deepEqual((await m.llamar('cancel_order', v)).vars, { estado: 'cancelled' }); // ya cancelada: no es un error para el cliente
}));

test('handoff_to_human: abre el ticket con un resumen sin datos personales y recuerda que está atendido', () => conMundo(async (m) => {
  const v = await conOrden(m);
  const r = await m.llamar('handoff_to_human:cliente_pide_persona', { ...v, monto_txt: '500.00' });
  assert.equal(r.vars.cola_texto, ' Estás en la posición 1 (espera aproximada: 3 min).');
  const ticket = [...m.falso.tickets.values()][0];
  assert.match(ticket.summary, /cliente_pide_persona/);
  assert.match(ticket.summary, /BR-0001/);
  assert.ok(!ticket.summary.includes('52998224725') && !ticket.summary.includes('ana@example.com'));
  assert.equal(ticket.channel, 'whatsapp');
  assert.ok(await m.almacen.kvEnv().get(`handoff:${T}`, 'json'));
}));

test('get_status: sin orden → e1; pendiente → e3 con sus datos; en validación → estado', () => conMundo(async (m) => {
  const E = ['e1', 'e3', 'estado', 'escalada'];
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'e1');
  const v = await conOrden(m);
  const pend = await m.llamar('get_status', {}, { edges: E });
  assert.equal(pend.next_edge, 'e3');
  assert.equal(pend.vars.operacion_id, 'BR-0001');
  assert.equal(pend.vars.pago_cuenta, v.pago_cuenta);
  m.media.usar(jpeg());
  const foto = await m.llamar('proof_upload', v, { edges: EDGES_FOTO, wa: FOTO() });
  await m.llamar('proof_submit', { ...v, ...foto.vars, operacion_no: 'AB-1234' }, { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  const val = await m.llamar('get_status', {}, { edges: E });
  assert.equal(val.next_edge, 'estado');
  assert.equal(val.vars.estado_texto, 'en validación: una persona revisa tu pago');
  m.falso.aprobar('BR-0001');
  assert.match((await m.llamar('get_status', {}, { edges: E })).vars.estado_texto, /^verificada/);
}));

test('get_status: una orden con seguimiento cerrado o cancelada deja empezar de nuevo; un ticket abierto escala', () => conMundo(async (m) => {
  const E = ['e1', 'e3', 'estado', 'escalada'];
  const v = await conOrden(m);
  m.almacen.abrirSeguimiento({ ordenId: 'BR-0001', telefono: T, chatId: CHAT, creado: '2026-10-13T10:00:00.000Z' });
  m.almacen.actualizarSeguimiento('BR-0001', { cerrado: 1 });
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'e1');
  await m.llamar('cancel_order', v);
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'e1');
  await m.llamar('handoff_to_human:x', {});
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'escalada');
  [...m.falso.tickets.values()][0].status = 'closed';
  assert.equal((await m.llamar('get_status', {}, { edges: E })).next_edge, 'e1');
  assert.equal(await m.almacen.kvEnv().get(`handoff:${T}`, 'json'), null); // el marcador se limpió
}));

test('route_evento enruta por el evento del vigilante', () => conMundo(async (m) => {
  const r = (evento) => m.llamar('route_evento', { evento }, { edges: ['aprobada', 'rechazada', 'otro'] }).then((x) => x.next_edge);
  assert.deepEqual([await r('aprobada'), await r('rechazada'), await r('otra')], ['aprobada', 'rechazada', 'otro']);
}));

test('las acciones genéricas se delegan al simulador y una arista no declarada es un error visible', () => conMundo(async (m) => {
  const r = await m.llamar('check_extraction', COTIZACION, { edges: ['completa', 'incompleta'] });
  assert.equal(r.next_edge, 'completa');
  assert.equal((await m.llamar('validate:monto', { monto_raw: '1.500,50' }, { edges: ['valido', 'invalido', 'escalar'] })).vars.monto, 1500.5);
  await assert.rejects(() => m.llamar('route_evento', { evento: 'aprobada' }, { edges: ['rechazada'] }), /edge_no_declarado/);
}));
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test waha/test/backend-acciones.test.js`
Expected: FAIL (Cannot find module `../src/backend`)

- [ ] **Step 3: Escribir el código**

`waha/src/backend/real/acciones.js`:

```js
// Acciones de negocio de los grafos v2 sobre el backend real de BrasPer. Cada acción recibe el contexto del motor y devuelve
// { vars, next_edge }, igual que brasper-api.js. Las acciones genéricas (route_reply, check_extraction, check_hours…) se delegan
// al simulador. Un error de transporte (red, timeout, 5xx) se deja subir: el motor lo trata sin escalar al cliente.
const { ErrorBackend } = require('./errores');
const { dinero, hora12Lima } = require('./formato');
const V = require('./validadores');
const { extensionDe } = require('./storage');
const { parseMonto, normMoneda } = require('../../../../kapso/functions/brasper-api.js');

const MAX_COMPROBANTE_BYTES = 8 * 1024 * 1024;
const TEXTO_ESTADO = {
  validating: 'en validación: una persona revisa tu pago',
  approved: 'verificada: estamos enviando tu dinero',
  exported: 'enviada: tu dinero ya fue enviado',
  rejected: 'con un problema de validación: una persona te contactará',
};
// Datos personales del cliente: se borran del estado de la conversación en cuanto el backend los guarda en su perfil.
const SIN_DATOS_PERSONALES = {
  nombre: '', nombre_raw: '', doc_tipo: '', doc_num: '', doc_raw: '', correo: '', correo_raw: '', correo_masc: '',
  origen_cuenta: '', origen_cuenta_raw: '', destino_cuenta: '', destino_cuenta_raw: '',
  cuentas_perfil: [], cuentas_origen: [], cuentas_destino: [], opciones_origen: [], opciones_destino: [],
};

const ultimoEntrante = (wa) => [...((wa && wa.messages) || [])].reverse().find((m) => m.direction === 'inbound');
// Fallos consecutivos por paso: el segundo escala a una persona.
function fallo(vars, clave) {
  const n = (Number(vars[`fallos_${clave}`]) || 0) + 1;
  return { vars: { [`fallos_${clave}`]: n }, next_edge: n >= 2 ? 'escalar' : 'invalido' };
}
const reinicio = (clave, extra = {}) => ({ [`fallos_${clave}`]: 0, ...extra });

function varsCotizacion(q) {
  return {
    quote_id: q.id, moneda_origen: q.sendCurrency, moneda_destino: q.receiveCurrency, monto_txt: dinero(q.sendAmount),
    tasa_txt: String(q.rate), comision_txt: dinero(q.commission), impuesto_txt: dinero(q.tax), total_enviar_txt: dinero(q.total),
    recibe_txt: dinero(q.receiveAmount), tasa_hasta: hora12Lima(q.expiresAt), quote_expira_iso: q.expiresAt,
  };
}

function varsOrden(o) {
  const pa = o.paymentAccount || {};
  return {
    operacion_id: o.orderId, moneda_origen: o.sendCurrency, moneda_destino: o.receiveCurrency, monto_txt: dinero(o.sendAmount),
    tasa_txt: String(o.rate), comision_txt: dinero(o.commission), impuesto_txt: dinero(o.tax), total_enviar_txt: dinero(o.total),
    recibe_txt: dinero(o.receiveAmount), tasa_hasta: hora12Lima(o.rateLockedUntil), lock_iso: o.rateLockedUntil,
    pago_titular: pa.holder || '', pago_banco: pa.bank || '', pago_cuenta: pa.accountNumber || '', pago_pix_linea: pa.pixKey ? `\nPix: ${pa.pixKey}` : '',
    origen_ult4: V.ultimos4(o.sourceAccount), destino_ult4: V.ultimos4(o.destinationAccount),
  };
}

const VALIDADORES = {
  nombre: { src: 'nombre_raw', run: (s) => (V.nombreValido(s) ? { nombre: V.limpiarTexto(s, 100) } : null) },
  doc: { src: 'doc_raw', run: (s, vars) => (V.documentoValido(vars.doc_tipo, s) ? { doc_num: V.normalizarDocumento(vars.doc_tipo, s) } : null) },
  correo: { src: 'correo_raw', run: (s) => (V.correoValido(s) ? { correo: String(s).trim().toLowerCase(), correo_masc: V.enmascararCorreo(String(s).trim().toLowerCase()) } : null) },
  cuenta_origen: { src: 'origen_cuenta_raw', run: (s) => (V.cuentaValida(s) ? { origen_cuenta: V.limpiarTexto(s, 40), origen_ult4: V.ultimos4(s) } : null) },
  cuenta_destino: { src: 'destino_cuenta_raw', run: (s) => (V.cuentaValida(s) ? { destino_cuenta: V.limpiarTexto(s, 40), destino_ult4: V.ultimos4(s) } : null) },
  banco_origen: { src: 'origen_banco_raw', run: (s) => (V.limpiarTexto(s, 60).length >= 2 ? { origen_banco: V.limpiarTexto(s, 60) } : null) },
  banco_destino: { src: 'destino_banco_raw', run: (s) => (V.limpiarTexto(s, 60).length >= 2 ? { destino_banco: V.limpiarTexto(s, 60) } : null) },
  operacion: { src: 'operacion_raw', run: (s) => (V.operacionValida(s) ? { operacion_no: String(s).trim().toUpperCase() } : null) },
};

// Qué campo repreguntar cuando el backend rechaza un dato (`invalid-input` trae la ruta del campo).
function campoDe(detalles) {
  const ruta = (detalles && detalles[0] && detalles[0].path) || '';
  if (ruta === 'clientName') return 'nombre';
  if (ruta === 'docType' || ruta === 'docNumber') return 'documento';
  if (ruta === 'email') return 'correo';
  return 'otro';
}

function crearBackendReal({ funciones, firestore, storage, sesiones, almacen, descargarMedia, delegado, ahora = () => new Date(), registrar = () => {} }) {
  const esNegocio = (e) => e instanceof ErrorBackend && !e.transporte;
  const kv = almacen.kvEnv();

  async function leerOrden(tel, id) {
    try { return await firestore.leer(tel, `orders/${id}`); } catch (e) { if (esNegocio(e)) return null; throw e; }
  }

  const ACCIONES = {
    // E1: cotizar. Los códigos del backend se traducen a las aristas del grafo.
    async quote_create({ vars, phone }) {
      const monto = parseMonto(vars.monto);
      const o = normMoneda(vars.moneda_origen);
      const d = normMoneda(vars.moneda_destino);
      if (!monto || !o || !d || o === d) return { vars: {}, next_edge: 'par_invalido' };
      try {
        const q = await funciones.llamar(phone, 'createQuote', { sendCurrency: o, receiveCurrency: d, sendAmount: monto, channel: 'whatsapp' }, { reintentos: 1 });
        return { vars: varsCotizacion(q), next_edge: 'ok' };
      } catch (e) {
        if (!esNegocio(e)) throw e;
        const mapa = { 'requires-human': 'requiere_persona', 'amount-too-small': 'monto_bajo', 'same-currency': 'par_invalido', 'invalid-amount': 'par_invalido', 'invalid-input': 'par_invalido' };
        return { vars: {}, next_edge: mapa[e.codigo] || 'sin_servicio' };
      }
    },

    // E2: perfil guardado del cliente (clients/{uid}) para no repetir datos ni cuentas.
    async perfil_get({ phone }) {
      const { uid } = await sesiones.obtener(phone);
      const p = await firestore.leer(phone, `clients/${uid}`);
      if (!p || !p.clientName) return { vars: { cuentas_perfil: [] }, next_edge: 'nuevo' };
      const cuentas = (p.accounts || []).map((a) => ({ bank: a.bank, accountNumber: a.accountNumber, currency: a.currency }));
      return {
        vars: { nombre: p.clientName, doc_tipo: p.docType, doc_num: p.docNumber, correo: p.email, correo_masc: V.enmascararCorreo(p.email), cuentas_perfil: cuentas },
        next_edge: 'existe',
      };
    },

    async validate({ vars, arg }) {
      const v = VALIDADORES[arg];
      if (!v) throw new Error(`validador desconocido: ${arg}`);
      const res = v.run(vars[v.src], vars);
      if (!res) return fallo(vars, arg);
      return { vars: reinicio(arg, res), next_edge: 'valido' };
    },

    // Cuentas ya usadas por el cliente en la moneda del lado indicado (origen o destino), como filas de una lista.
    async cuentas_opciones({ vars, arg }) {
      const moneda = arg === 'origen' ? vars.moneda_origen : vars.moneda_destino;
      const guardadas = (vars.cuentas_perfil || []).filter((a) => a.currency === moneda).slice(-9).reverse();
      if (!guardadas.length) return { vars: { [`opciones_${arg}`]: [], [`cuentas_${arg}`]: [] }, next_edge: 'sin_cuentas' };
      const filas = guardadas.map((a, i) => ({ id: `acc:${i}`, title: `${a.bank} ••${V.ultimos4(a.accountNumber)}`.slice(0, 24) }));
      filas.push({ id: 'otra', title: 'Otra cuenta' });
      return { vars: { [`opciones_${arg}`]: filas, [`cuentas_${arg}`]: guardadas }, next_edge: 'con_cuentas' };
    },

    async route_cuenta({ vars, arg, wa }) {
      const m = ultimoEntrante(wa);
      const id = m && m.reply_option_id;
      if (id === 'otra') return { vars: reinicio(`cuenta_${arg}`), next_edge: 'otra' };
      const mt = /^acc:(\d+)$/.exec(id || '');
      const cuenta = mt && (vars[`cuentas_${arg}`] || [])[Number(mt[1])];
      if (cuenta) {
        return { vars: reinicio(`cuenta_${arg}`, { [`${arg}_banco`]: cuenta.bank, [`${arg}_cuenta`]: cuenta.accountNumber, [`${arg}_ult4`]: V.ultimos4(cuenta.accountNumber) }), next_edge: 'elegida' };
      }
      return fallo(vars, `cuenta_${arg}`);
    },

    async banco_set({ vars, arg }) { return { vars: { [`${arg}_banco`]: vars[`${arg}_banco_sel`] } }; },

    // Crea la orden. Ante un resultado dudoso (timeout) se consulta si llegó a crearse antes de dar nada por perdido.
    async order_create({ vars, phone, chatId }) {
      const datos = {
        quoteId: vars.quote_id, language: 'es', clientName: vars.nombre, docType: vars.doc_tipo, docNumber: vars.doc_num, email: vars.correo,
        fundsSource: vars.fondos, sourceBank: vars.origen_banco, sourceAccount: vars.origen_cuenta,
        destinationBank: vars.destino_banco, destinationAccount: vars.destino_cuenta,
      };
      let orden;
      try {
        orden = await funciones.llamar(phone, 'createOrder', datos);
      } catch (e) {
        if (!(e instanceof ErrorBackend)) throw e;
        const previas = (e.transporte || e.codigo === 'quote-already-used') ? await firestore.ordenesPorCotizacion(phone, vars.quote_id).catch(() => []) : [];
        if (previas.length) orden = previas[0];
        else if (e.transporte) throw e;
        else {
          const mapa = { 'quote-expired': 'quote_expirada', 'quote-not-found': 'quote_expirada', 'quote-already-used': 'quote_expirada', 'requires-human': 'requiere_persona', 'invalid-input': 'dato_invalido' };
          return { vars: e.codigo === 'invalid-input' ? { campo_invalido: campoDe(e.detalles) } : {}, next_edge: mapa[e.codigo] || 'sin_servicio' };
        }
      }
      almacen.agregarOrden({ ordenId: orden.orderId, telefono: phone, chatId, creada: orden.createdAt });
      return { vars: { ...varsOrden(orden), ...SIN_DATOS_PERSONALES }, next_edge: 'ok' };
    },

    async route_campo({ vars }) { return { vars: {}, next_edge: ['nombre', 'documento', 'correo'].includes(vars.campo_invalido) ? vars.campo_invalido : 'otro' }; },

    // E3: datos de pago de la orden (si el cliente vuelve más tarde, se leen de Firestore).
    async orden_info({ vars, phone }) {
      if (vars.pago_cuenta) return { vars: {} };
      const ultima = almacen.ordenesDe(phone)[0];
      const o = ultima && (await leerOrden(phone, ultima.ordenId));
      return { vars: o ? varsOrden(o) : {} };
    },

    async check_lock({ vars }) {
      const vigente = vars.lock_iso && new Date(vars.lock_iso) > ahora();
      return { vars: {}, next_edge: vigente ? 'vigente' : 'vencida' };
    },

    // Baja la foto de WAHA y la sube a Storage con el token del cliente.
    async proof_upload({ vars, phone, wa, chatId }) {
      const m = ultimoEntrante(wa);
      const sinFoto = () => { const f = fallo(vars, 'comprobante'); return { vars: f.vars, next_edge: f.next_edge === 'invalido' ? 'sin_foto' : 'escalar' }; };
      if (!m || !m.has_media || !['image', 'document'].includes(m.message_type)) return sinFoto();
      const archivo = await descargarMedia({ chatId, mensajeId: m.whatsapp_message_id || m.id, mediaUrl: m.media_url, mimetype: m.mimetype });
      if (!archivo) return sinFoto();
      const tipo = String(archivo.mimetype || '').toLowerCase();
      if (!(tipo.startsWith('image/') || tipo === 'application/pdf')) return sinFoto();
      if (archivo.bytes.length >= MAX_COMPROBANTE_BYTES) return { vars: {}, next_edge: 'muy_grande' };
      try {
        const ruta = await storage.subir(phone, { ordenId: vars.operacion_id, nombre: `proof-${ahora().getTime()}.${extensionDe(tipo)}`, mimetype: tipo, bytes: archivo.bytes });
        return { vars: reinicio('comprobante', { proof_path: ruta }), next_edge: 'subida' };
      } catch (e) {
        if (!esNegocio(e)) throw e;
        const f = fallo(vars, 'comprobante');
        return { vars: f.vars, next_edge: f.next_edge === 'invalido' ? 'fallo_subida' : 'escalar' };
      }
    },

    async proof_submit({ vars, phone, chatId }) {
      const ya = (estado) => ['validating', 'approved', 'exported'].includes(estado);
      const confirmar = async () => ya((await leerOrden(phone, vars.operacion_id) || {}).status);
      let ok = false;
      try {
        await funciones.llamar(phone, 'submitProof', { orderId: vars.operacion_id, operationNo: vars.operacion_no, proofPath: vars.proof_path });
        ok = true;
      } catch (e) {
        if (!(e instanceof ErrorBackend)) throw e;
        if (e.transporte) { if (await confirmar().catch(() => false)) ok = true; else throw e; }
        else {
          const mapa = { 'operation-no-duplicate': 'duplicado', 'proof-not-uploaded': 'sin_subida', 'invalid-proof-path': 'sin_subida', 'proof-too-large': 'sin_subida', 'invalid-operation-no': 'invalido' };
          if (e.codigo === 'order-not-pending') return { vars: {}, next_edge: (await confirmar()) ? 'ya_recibido' : 'escalar' };
          return { vars: {}, next_edge: mapa[e.codigo] || 'escalar' };
        }
      }
      if (ok) almacen.abrirSeguimiento({ ordenId: vars.operacion_id, telefono: phone, chatId, creado: ahora().toISOString() });
      return { vars: { estado: 'validating' }, next_edge: 'ok' };
    },

    async cancel_order({ vars, phone }) {
      try { await funciones.llamar(phone, 'cancelOrder', { orderId: vars.operacion_id }); } catch (e) { if (!esNegocio(e)) throw e; }
      return { vars: { estado: 'cancelled' } };
    },

    // "Hablar con persona": entra a la cola del backend con un resumen sin datos personales.
    async handoff_to_human({ vars, phone, arg }) {
      const partes = [`Cliente de WhatsApp pide ayuda (${arg || 'sin motivo'}).`];
      if (vars.monto_txt) partes.push(`Cotización: ${vars.monto_txt} ${vars.moneda_origen} → ${vars.moneda_destino}.`);
      if (vars.operacion_id) partes.push(`Operación ${vars.operacion_id}.`);
      try {
        const t = await funciones.llamar(phone, 'requestHuman', { summary: partes.join(' ').slice(0, 1500), orderId: vars.operacion_id || null, channel: 'whatsapp', language: 'es' });
        await kv.put(`handoff:${phone}`, JSON.stringify({ handoffId: t.handoffId, motivo: arg || '' }));
        return { vars: { cola_texto: ` Estás en la posición ${t.position} (espera aproximada: ${t.estimatedWaitMinutes} min).` } };
      } catch (e) {
        if (!esNegocio(e)) throw e;
        registrar({ tipo: 'error_backend', estado: String(e.estado || ''), detalle: `requestHuman:${e.codigo}` });
        return { vars: { cola_texto: '' } };
      }
    },

    // W0: ¿en qué punto está este cliente? Primero un ticket de persona abierto; luego su última orden.
    async get_status({ phone }) {
      const marca = await kv.get(`handoff:${phone}`, 'json');
      if (marca) {
        const q = await funciones.llamar(phone, 'getQueueInfo', { handoffId: marca.handoffId }).catch((e) => { if (esNegocio(e)) return null; throw e; });
        if (q && q.status !== 'closed') return { vars: {}, next_edge: 'escalada' };
        await kv.delete(`handoff:${phone}`);
      }
      const ultima = almacen.ordenesDe(phone)[0];
      if (!ultima) return { vars: { estado: 'sin_operacion' }, next_edge: 'e1' };
      const seg = almacen.seguimiento(ultima.ordenId);
      if (seg && seg.cerrado) return { vars: { estado: 'sin_operacion' }, next_edge: 'e1' };
      const o = await leerOrden(phone, ultima.ordenId);
      if (!o || o.status === 'cancelled') return { vars: { estado: 'sin_operacion' }, next_edge: 'e1' };
      if (o.status === 'pending') return { vars: { ...varsOrden(o), estado: 'pending' }, next_edge: 'e3' };
      return { vars: { ...varsOrden(o), estado: o.status, estado_texto: TEXTO_ESTADO[o.status] || o.status }, next_edge: 'estado' };
    },

    // E4 v2: lo lanza el vigilante con vars.evento.
    async route_evento({ vars }) { return { vars: {}, next_edge: ['aprobada', 'rechazada'].includes(vars.evento) ? vars.evento : 'otro' }; },
  };

  return async function llamarFuncion({ vars, phone, edges, wa, chatId }) {
    const crudo = String(vars.api_action || '');
    const i = crudo.indexOf(':');
    const nombre = i === -1 ? crudo : crudo.slice(0, i);
    const arg = i === -1 ? '' : crudo.slice(i + 1);
    const accion = ACCIONES[nombre];
    // validate:monto y el resto de acciones genéricas siguen siendo las del simulador.
    if (!accion || (nombre === 'validate' && !VALIDADORES[arg])) return delegado({ vars, phone, edges, wa, chatId });
    const out = await accion({ vars, phone, edges, wa, chatId, arg });
    if (edges && edges.length && !edges.includes(out.next_edge)) throw new Error(`edge_no_declarado: ${out.next_edge} (${crudo})`);
    return out;
  };
}

module.exports = { crearBackendReal, varsOrden, varsCotizacion, TEXTO_ESTADO, SIN_DATOS_PERSONALES };
```

`waha/src/backend/index.js`:

```js
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
```

- [ ] **Step 4: Ver que pasan**

Run: `node --test waha/test/backend-acciones.test.js`
Expected: PASS, 0 fallos

- [ ] **Commit**

```bash
git add waha/src/backend/real/acciones.js waha/src/backend/index.js waha/test/backend-acciones.test.js
git commit -m "feat(waha): acciones del backend real (cotizar, crear orden, subir comprobante, ticket) con reconciliación y sin datos personales

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 7: Grafos v2 (E1 a E4 y W0) y escenarios completos

**Files:**
- Create: `waha/src/flujos/v2/helpers.js`, `waha/src/flujos/v2/e1.js`, `waha/src/flujos/v2/e2.js`, `waha/src/flujos/v2/e3.js`, `waha/src/flujos/v2/e4w0.js`, `waha/src/flujos/v2/index.js`
- Test: `waha/test/helpers/mundo-v2.js`, `waha/test/flujo-v2.test.js`

**Interfaces:**
- Consumes: `Flow` (`kapso/build/flow.js`), `crearBackend` (tarea 6), el motor (tarea 5), `ProveedorFalso` y `crearMundo` (`waha/test/helpers/`, ya existen), el falso (tarea 3).
- Produces:
  - `cargarFlujosV2() -> { W0, E1, E2, E3, E4 }` (objetos `Flow` validados; las listas con `rows_var` se validan sustituyéndolas por una lista fija). Tamaños (nodos/aristas): E1 65/77, E2 178/239, E3 58/70, E4 10/9, W0 13/14.
  - E4 se lanza con `vars.evento` = `aprobada` | `rechazada` y, además, `operacion_id`, `destino_ult4`, `motivo`.
  - `crearMundoV2({ extraer, db }) -> { falso, almacen, bd, proveedor, motor, backend, registrados, decir(texto, extra), tocar(id, titulo), foto(extra), ultimo(), descargar.usar(fn), avanzar(min), ahora, cerrar(), T, CHAT }`; `hastaInstrucciones(m)` lleva a un cliente nuevo hasta las instrucciones de pago de BR-0001.

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/helpers/mundo-v2.js`:

```js
// Mundo de pruebas para los grafos v2: servidor Firebase falso + backend real + motor + proveedor falso.
const { abrirDb } = require('../../src/estado/db');
const { crearAlmacen } = require('../../src/estado/almacen');
const { crearMotor } = require('../../src/motor/motor');
const { crearBackend } = require('../../src/backend');
const { cargarFlujosV2 } = require('../../src/flujos/v2');
const { ProveedorFalso } = require('./proveedor-falso');
const { crearFirebaseFalso } = require('./firebase-falso');
const { msg } = require('./mundo');

const T = '51944686794';
const CHAT = `${T}@c.us`;
const COTIZA = async () => ({ monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' });
const AHORA_SIMULADO = '2026-10-14T15:00:00Z'; // miércoles 10:00 en Lima: horario abierto

async function crearMundoV2({ extraer = COTIZA, db } = {}) {
  const falso = await crearFirebaseFalso();
  const bd = db || abrirDb(':memory:');
  const almacen = crearAlmacen(bd);
  const proveedor = new ProveedorFalso();
  const registrados = [];
  let descargar = async () => ({ bytes: Buffer.from('FOTO'), mimetype: 'image/jpeg' });
  let desfase = 0; // minutos que se adelanta el reloj del bot y el del backend falso
  const ahora = () => new Date(Date.now() + desfase * 60_000);
  const backend = crearBackend({
    modo: 'real', almacen, configReal: falso.config, descargarMedia: (p) => descargar(p), registrar: (e) => registrados.push(e),
    dormir: async () => {}, varsFijas: { simular_ahora: AHORA_SIMULADO }, ahora,
  });
  const motor = crearMotor({ flujos: cargarFlujosV2(), almacen, proveedor, llamarFuncion: backend.llamarFuncion, extraer });
  const decir = (texto, extra = {}) => motor.procesarMensaje(msg(T, texto, extra));
  const tocar = (id, titulo = id) => decir(titulo, { opcionId: id });
  const foto = (extra = {}) => decir('', { tieneMedia: true, tipoMensaje: 'image', mensajeId: `wamid-${Math.random()}`, mediaUrl: 'http://waha/api/files/f.jpeg', mimetype: 'image/jpeg', ...extra });
  const ultimo = () => proveedor.enviados.at(-1);
  return {
    falso, almacen, bd, proveedor, motor, backend, registrados, decir, tocar, foto, ultimo, T, CHAT,
    descargar: { usar: (fn) => { descargar = fn; } },
    avanzar: (min) => { desfase += min; falso.avanzar(min); }, ahora,
    cerrar: () => falso.cerrar(),
  };
}

// Lleva a un cliente nuevo hasta recibir las instrucciones de pago (E3) con una orden creada.
async function hastaInstrucciones(m) {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('529.982.247-25');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  await m.tocar('confirmar', 'Confirmar');
}

module.exports = { crearMundoV2, hastaInstrucciones, T, CHAT };
```

`waha/test/flujo-v2.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMundoV2, hastaInstrucciones, T } = require('./helpers/mundo-v2');

const conMundo = async (fn, opciones) => { const m = await crearMundoV2(opciones); try { await fn(m); } finally { await m.cerrar(); } };
const HORA = '\\d{1,2}:\\d\\d [ap]\\. m\\.';

test('cliente nuevo: de la cotización hasta que la orden queda en validación en el backend', () => conMundo(async (m) => {
  const e = m.proveedor.enviados;
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  assert.equal(e[0].tipo, 'botones');
  assert.match(e[0].texto, new RegExp(`^¡Hola! Hoy 1 BRL = 0\\.6745 PEN\\. Comisión 12\\.00 \\+ impuesto 2\\.16 BRL\\. Total a transferir 514\\.16 BRL\\. Recibirás 337\\.25 PEN\\. Tasa asegurada hasta las ${HORA}$`));
  assert.deepEqual(e[0].opciones.map((o) => o.id), ['continuar', 'cambiar_monto', 'persona']);
  assert.equal(e[1].tipo, 'enlace');
  assert.equal(m.falso.llamadas.find((l) => l.nombre === 'createQuote').data.channel, 'whatsapp');

  await m.tocar('continuar', 'Continuar');
  assert.equal(m.ultimo().texto, '¿Cuál es tu nombre completo? Escribe nombre y apellido.');
  await m.decir('Ana Paula Souza');
  assert.equal(m.ultimo().tipo, 'lista');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['DNI', 'CE', 'RUC', 'CPF']);
  await m.tocar('CPF');
  assert.equal(m.ultimo().texto, 'Escribe tu número de CPF.');
  await m.decir('529.982.247-25');
  assert.equal(m.ultimo().texto, '¿A qué correo electrónico te enviamos tu comprobante?');
  await m.decir('ana@example.com');
  assert.equal(m.ultimo().texto, '¿De dónde provienen los fondos?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['savings', 'salary', 'business', 'asset_sale', 'donation', 'other']);
  await m.tocar('savings', 'Ahorros');
  assert.equal(m.ultimo().texto, '¿Desde qué banco nos envías tu dinero?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro']);
  await m.tocar('Nubank');
  assert.equal(m.ultimo().texto, 'Escribe el número de la cuenta en Nubank.');
  await m.decir('0001-12345678-9');
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro']);
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  assert.equal(m.ultimo().texto, 'Envías 514.16 BRL desde Nubank ••6789.\nRecibe 337.25 PEN en BCP ••7890.\nTasa 0.6745. ¿Confirmas?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['confirmar', 'cambiar', 'cancelar']);
  assert.equal(m.falso.ordenes.size, 0); // todavía no se creó nada

  await m.tocar('confirmar', 'Confirmar');
  const instr = e.at(-2);
  assert.match(instr.texto, new RegExp(`^Tu operación es BR-0001\\.\\nTransfiere 514\\.16 BRL a:\\nTitular: BrasPer \\(DEMO\\)\\nBanco: Nubank\\nCuenta: 0001-0000001-0\\nPix: pix@brasper\\.demo\\nUsa la cuenta de BRL, no otra moneda\\.\\nTasa asegurada hasta las ${HORA}$`));
  assert.equal(m.ultimo().texto, 'Cuando termines la transferencia, toca "Ya transferí".');
  const o = m.falso.ordenes.get('BR-0001');
  assert.deepEqual([o.channel, o.status, o.clientName, o.docType, o.docNumber, o.email, o.fundsSource], ['whatsapp', 'pending', 'Ana Paula Souza', 'CPF', '52998224725', 'ana@example.com', 'savings']);
  assert.deepEqual([o.sourceBank, o.sourceAccount, o.destinationBank, o.destinationAccount], ['Nubank', '0001-12345678-9', 'BCP', '191-1234567890']);

  // Los datos personales ya no están en el estado de la conversación ni en el registro.
  const guardado = JSON.stringify(m.almacen.cargarEjecucion(T));
  for (const dato of ['52998224725', 'ana@example.com', 'Ana Paula Souza', '0001-12345678-9', '191-1234567890']) assert.ok(!guardado.includes(dato), `el estado no debe guardar ${dato}`);

  await m.tocar('ya_transferi', 'Ya transferí');
  assert.equal(m.ultimo().texto, 'Perfecto. Envíame la foto del comprobante (imagen o PDF).');
  await m.foto();
  assert.equal(m.ultimo().texto, 'Ahora escribe el número de operación bancaria.');
  assert.equal(m.falso.archivos.size, 1);
  assert.match([...m.falso.archivos.keys()][0], /^proofs\/uid001\/BR-0001\/proof-\d+\.jpg$/);
  await m.decir('ab-1234');
  assert.equal(m.ultimo().texto, 'Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo.');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
  assert.equal(m.falso.ordenes.get('BR-0001').operationNo, 'AB-1234');
  assert.equal(m.almacen.cargarEjecucion(T), null);
  assert.equal(m.almacen.seguimientosAbiertos().length, 1);
  // Ningún dato personal llega al registro (ni de la base ni de los eventos que se informan).
  const todo = JSON.stringify(m.bd.prepare('SELECT * FROM registro').all()) + JSON.stringify(m.registrados);
  for (const dato of ['52998224725', 'ana@example.com', 'Ana Paula', '0001-12345678-9']) assert.ok(!todo.includes(dato), `el registro no debe tener ${dato}`);
}));

// Una orden ya terminada para ese teléfono: el siguiente mensaje empieza una operación nueva con el perfil guardado.
async function cerrarLaPrimera(m) {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  m.falso.aprobar('BR-0001');
  m.almacen.actualizarSeguimiento('BR-0001', { cerrado: 1 }); // lo que hará el vigilante al terminar
}

test('cliente que vuelve: confirma sus datos y elige sus cuentas guardadas de una lista', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  const n = m.proveedor.enviados.length;
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  assert.equal(m.ultimo().texto, 'Usaremos tu CPF 52998224725 y tu correo a***@example.com. ¿Es correcto?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['si_datos', 'cambiar']);
  await m.tocar('si_datos', 'Sí, es correcto');
  assert.equal(m.ultimo().texto, '¿De dónde provienen los fondos?');
  await m.tocar('salary', 'Sueldo');
  assert.equal(m.ultimo().texto, 'Elige la cuenta desde la que vas a pagar:');
  assert.deepEqual(m.ultimo().opciones, [{ id: 'acc:0', title: 'Nubank ••6789' }, { id: 'otra', title: 'Otra cuenta' }]);
  await m.tocar('acc:0', 'Nubank ••6789');
  assert.equal(m.ultimo().texto, 'Elige la cuenta donde recibirá tu destinatario:');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.title), ['BCP ••7890', 'Otra cuenta']);
  await m.tocar('acc:0', 'BCP ••7890');
  assert.match(m.ultimo().texto, /^Envías 514\.16 BRL desde Nubank ••6789\.\nRecibe 337\.25 PEN en BCP ••7890\./);
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.falso.ordenes.get('BR-0002').fundsSource, 'salary');
  assert.equal(m.falso.ordenes.get('BR-0002').clientName, 'Ana Paula Souza');
  assert.ok(m.proveedor.enviados.length > n);
  assert.equal(m.falso.usuarios.size, 1); // el mismo usuario anónimo de siempre: así recuerda al cliente
}));

test('cliente que vuelve y elige "Otra cuenta" para el destino: pide banco y número', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.tocar('si_datos', 'Sí, es correcto');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('acc:0', 'Nubank ••6789');
  await m.tocar('otra', 'Otra cuenta');
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?');
  await m.tocar('Otro');
  assert.equal(m.ultimo().texto, 'Escribe el nombre de tu banco.');
  await m.decir('Banco Pichincha');
  assert.equal(m.ultimo().texto, 'Escribe el número de la cuenta en Banco Pichincha.');
  await m.decir('555-0099');
  await m.tocar('confirmar', 'Confirmar');
  assert.deepEqual([m.falso.ordenes.get('BR-0002').destinationBank, m.falso.ordenes.get('BR-0002').destinationAccount], ['Banco Pichincha', '555-0099']);
}));

test('si la cotización vence mientras el cliente completa los datos, se cotiza de nuevo y se pide confirmar', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.avanzar(16);
  await m.tocar('confirmar', 'Confirmar');
  assert.match(m.ultimo().texto, /^La tasa cambió\. Nueva cotización: 1 BRL = 0\.6745 PEN\. Total a transferir 514\.16 BRL\./);
  assert.equal(m.falso.ordenes.size, 0);
  await m.tocar('continuar', 'Continuar');
  assert.equal(m.falso.ordenes.size, 1);
  assert.match(m.proveedor.enviados.at(-2).texto, /^Tu operación es BR-0001\./);
}));

test('un monto por encima del límite pasa a una persona con un ticket en el backend', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 20000 reales a Perú');
  assert.equal(m.falso.ordenes.size, 0);
  assert.equal(m.falso.tickets.size, 1);
  const t = [...m.falso.tickets.values()][0];
  assert.equal(t.channel, 'whatsapp');
  assert.match(t.summary, /monto_grande/);
  assert.equal(m.ultimo().texto, 'Por el monto, te paso con una persona del equipo para ayudarte. Estás en la posición 1 (espera aproximada: 3 min).');
  assert.equal(m.almacen.cargarEjecucion(T), null);
}, { extraer: async () => ({ monto: 20000, moneda_origen: 'BRL', moneda_destino: 'PEN' }) }));

test('un monto menor al mínimo explica el mínimo y vuelve a pedir el monto', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 10 reales a Perú');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Ese monto es menor al mínimo (unos 10 USD equivalentes). Escribe un monto mayor.');
  assert.equal(m.ultimo().texto, '¿Cuánto quieres enviar? Escribe solo el monto.');
  await m.decir('500');
  assert.match(m.proveedor.enviados.at(-2).texto, /Total a transferir 514\.16 BRL/); // la oferta va antes del enlace web
}, { extraer: async () => ({ monto: 10, moneda_origen: 'BRL', moneda_destino: 'PEN' }) }));

test('datos inválidos para el backend: se repregunta solo el campo que rechazó', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.fallar('/fn/createorder', { estado: 400, veces: 1, cuerpo: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'invalid-input', details: [{ path: 'email', message: 'x' }] } }) });
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Uno de tus datos no pasó la validación. Revisémoslo.');
  assert.equal(m.ultimo().texto, '¿A qué correo electrónico te enviamos tu comprobante?');
}));

test('las respuestas inválidas en un paso de texto repiten la pregunta y el segundo fallo escala', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana');
  assert.equal(m.ultimo().texto, 'Necesito tu nombre y apellido, por ejemplo Ana Souza.');
  await m.decir('');
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte\./);
  assert.equal(m.falso.tickets.size, 1);
}));

test('documento inválido para el tipo elegido: repite y no avanza', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('DNI');
  await m.decir('1234567');
  assert.equal(m.ultimo().texto, 'Ese número no es válido para DNI. Revísalo y envíalo de nuevo.');
  await m.decir('12345678');
  assert.equal(m.ultimo().texto, '¿A qué correo electrónico te enviamos tu comprobante?');
}));

test('E3: el número de operación duplicado se avisa y se puede corregir', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.tocar('si_datos', 'Sí, es correcto');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('acc:0', 'Nubank ••6789');
  await m.tocar('acc:0', 'BCP ••7890');
  await m.tocar('confirmar', 'Confirmar');
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234'); // el mismo de la primera orden
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Ese número de operación ya está en otra operación. Revísalo y envíalo de nuevo.');
  assert.equal(m.ultimo().texto, 'Ahora escribe el número de operación bancaria.'); // vuelve a pedirlo
  assert.equal(m.falso.ordenes.get('BR-0002').status, 'pending');
  await m.decir('ZZ-9999');
  assert.equal(m.ultimo().texto, 'Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo.');
  assert.equal(m.falso.ordenes.get('BR-0002').status, 'validating');
}));

test('E3: sin foto, archivo de otro tipo o demasiado grande no avanzan; el segundo fallo escala', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.decir('ya pagué');
  assert.equal(m.ultimo().texto, 'No recibí una foto o PDF. Envíame la foto o captura del comprobante.');
  m.descargar.usar(async () => ({ bytes: Buffer.alloc(8 * 1024 * 1024), mimetype: 'image/jpeg' }));
  await m.foto();
  assert.equal(m.ultimo().texto, 'El archivo pesa más de 8 MB. Envía una foto más liviana o un PDF más pequeño.');
  m.descargar.usar(async () => ({ bytes: Buffer.from('v'), mimetype: 'video/mp4' }));
  await m.foto();
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte\./); // segundo fallo del mismo paso
  assert.equal(m.falso.archivos.size, 0);
}));

test('E3: cancelar con confirmación cancela la orden en el backend', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.tocar('cancelar', 'Cancelar operación');
  assert.equal(m.ultimo().texto, '¿Seguro que quieres cancelar la operación BR-0001?');
  await m.tocar('si_cancelar', 'Sí, cancelar');
  assert.equal(m.ultimo().texto, 'Listo, cancelé la operación BR-0001.');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'cancelled');
  await m.decir('hola'); // vuelve a empezar: no queda nada pendiente
  assert.equal(m.proveedor.enviados.at(-2).tipo, 'botones');
}));

test('E3: si el bloqueo de tasa venció cuando dice "Ya transferí", se avisa y se sigue pidiendo la foto', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  m.avanzar(31); // el bloqueo de la orden dura 30 min
  await m.tocar('ya_transferi', 'Ya transferí');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Tu tasa asegurada venció mientras transferías. Igual recibo tu constancia: una persona confirmará la tasa final al validar tu pago.');
  assert.equal(m.ultimo().texto, 'Perfecto. Envíame la foto del comprobante (imagen o PDF).');
}));

test('si Firebase no responde, se avisa del problema temporal y el siguiente mensaje reintenta sin perder lo hecho', () => conMundo(async (m) => {
  m.falso.fallar('/fn/createquote', { estado: 502, veces: 2 }); // el reintento interno también falla
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  assert.equal(m.ultimo().texto, 'Tuvimos un problema temporal. Intenta de nuevo en un momento.');
  assert.equal(m.falso.tickets.size, 0); // no se escaló a nadie
  assert.ok(m.almacen.cargarEjecucion(T));
  await m.decir('ya');
  assert.match(m.proveedor.enviados.at(-2).texto, /^¡Hola! Hoy 1 BRL = 0\.6745 PEN/);
}));

test('si createOrder falla por red, la orden no se pierde ni se duplica: el siguiente mensaje reintenta', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.fallar('/fn/createorder', { estado: 502, veces: 1 });
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.ultimo().texto, 'Tuvimos un problema temporal. Intenta de nuevo en un momento.');
  assert.equal(m.falso.ordenes.size, 0);
  await m.decir('listo');
  assert.equal(m.falso.ordenes.size, 1);
  assert.match(m.proveedor.enviados.at(-2).texto, /^Tu operación es BR-0001\./);
}));

test('W0: quien vuelve con una orden pendiente ve de nuevo las instrucciones; en validación, el estado', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  m.almacen.borrarEjecucion(T); // el cliente se fue sin transferir y la conversación quedó cerrada
  await m.decir('hola otra vez');
  assert.match(m.proveedor.enviados.at(-2).texto, /^Tu operación es BR-0001\.\nTransfiere 514\.16 BRL a:/);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  await m.decir('¿cómo va?');
  assert.equal(m.ultimo().texto, 'Tu operación BR-0001 está en validación: una persona revisa tu pago.');
  m.falso.aprobar('BR-0001');
  await m.decir('¿y ahora?');
  assert.equal(m.ultimo().texto, 'Tu operación BR-0001 está verificada: estamos enviando tu dinero.');
}));

test('"Hablar con persona" abre un ticket y los mensajes siguientes reciben el aviso de que ya los atienden', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('persona', 'Hablar con persona');
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte\. Estás en la posición 1/);
  assert.equal(m.falso.tickets.size, 1);
  await m.decir('¿hay alguien?');
  assert.equal(m.ultimo().texto, 'Una persona del equipo ya está atendiendo tu caso.');
  [...m.falso.tickets.values()][0].status = 'closed';
  await m.decir('hola');
  assert.equal(m.proveedor.enviados.at(-2).tipo, 'botones'); // el ticket se cerró: empieza de nuevo
}));

test('reinicio del servidor a mitad de los datos: retoma desde SQLite sin pedir nada otra vez', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  const { crearMotor } = require('../src/motor/motor');
  const { cargarFlujosV2 } = require('../src/flujos/v2');
  const { msg } = require('./helpers/mundo');
  const otro = crearMotor({ flujos: cargarFlujosV2(), almacen: m.almacen, proveedor: m.proveedor, llamarFuncion: m.backend.llamarFuncion, extraer: async () => ({}) });
  await otro.procesarMensaje(msg(T, 'CPF', { opcionId: 'CPF' }));
  assert.equal(m.ultimo().texto, 'Escribe tu número de CPF.');
}));

test('texto libre con llaves de plantilla (nombre de banco) se muestra tal cual y no se interpreta', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('529.982.247-25');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Otro');
  await m.decir('Banco {{vars.quote_id}} {{vars.api_action}}');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  assert.match(m.ultimo().texto, /^Envías 514\.16 BRL desde Banco \{\{vars\.quote_id\}\} \{\{vars\.api_action\}\} ••6789\./);
}));

test('E3: una foto enviada antes de tocar "Ya transferí" no sube nada ni avanza', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.foto();
  assert.equal(m.falso.archivos.size, 0);
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'pending');
  await m.tocar('ya_transferi', 'Ya transferí'); // el flujo sigue ahí: puede continuar con normalidad
  assert.equal(m.ultimo().texto, 'Perfecto. Envíame la foto del comprobante (imagen o PDF).');
}));
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test --test-timeout=60000 waha/test/flujo-v2.test.js`
Expected: FAIL (Cannot find module `../../src/flujos/v2`)

- [ ] **Step 3: Escribir el código**

`waha/src/flujos/v2/helpers.js`:

```js
// Piezas comunes de los grafos v2 (mismas ideas que kapso/build/workflows.js, con las acciones del backend real).
const { PHONE_NUMBER_ID } = require('../../../../kapso/build/flow');

const MSG_PERSONA = 'Te paso con una persona del equipo para ayudarte.';
const MSG_SIN_TASAS = 'Ahora no puedo cotizar con seguridad. Te paso con una persona del equipo para ayudarte.';
const FORMULARIO_WEB = 'https://brasper.com/es';
const MONEDAS = ['BRL', 'PEN', 'USD'];
const MONEDAS_BTN = MONEDAS.map((m) => ({ id: m, title: m }));
// Bancos de demostración por moneda (máximo 10 filas por lista). "Otro" pide escribir el nombre.
const BANCOS_POR_MONEDA = {
  BRL: ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro'],
  PEN: ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro'],
  USD: ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Otro'],
};
const TIPOS_DOC = ['DNI', 'CE', 'RUC', 'CPF'].map((d) => ({ id: d, title: d }));
// Los ids son los valores que acepta el backend (fundsSource).
const FONDOS = [
  { id: 'savings', title: 'Ahorros' }, { id: 'salary', title: 'Sueldo' }, { id: 'business', title: 'Negocio propio' },
  { id: 'asset_sale', title: 'Venta de un bien' }, { id: 'donation', title: 'Donación' }, { id: 'other', title: 'Otro' },
];
const ids = (opciones) => opciones.map((o) => o.id);

// Handoff a persona: abre el ticket (requestHuman), avisa con la posición en la cola y detiene la ejecución.
function escalar(f, nombre, motivo, { mensaje = MSG_PERSONA, cta } = {}) {
  f.api(`${nombre}_reg`, `handoff_to_human:${motivo}`);
  f.text(`${nombre}_msg`, `${mensaje}{{vars.cola_texto}}`);
  f.link(`${nombre}_reg`, `${nombre}_msg`);
  let ultimo = `${nombre}_msg`;
  if (cta) {
    f.cta(`${nombre}_cta`, cta.body, cta.label, cta.url);
    f.link(ultimo, `${nombre}_cta`);
    ultimo = `${nombre}_cta`;
  }
  f.handoff(`${nombre}_fin`);
  f.link(ultimo, `${nombre}_fin`);
  return `${nombre}_reg`;
}

// Pregunta de texto libre con validación; el segundo fallo seguido escala. El llamador conecta `salida` con 'valido'.
function pregunta(f, n, { prompt, guardar, validar, error, motivo, escalarOpts }) {
  f.text(`${n}_ask`, prompt);
  f.wait(`${n}_wait`, { save: guardar });
  f.api(`${n}_val`, `validate:${validar}`, { edges: ['valido', 'invalido', 'escalar'] });
  f.text(`${n}_err`, error);
  const esc = escalar(f, `${n}_esc`, motivo, escalarOpts);
  f.link(`${n}_ask`, `${n}_wait`).link(`${n}_wait`, `${n}_val`);
  f.link(`${n}_val`, `${n}_err`, 'invalido').link(`${n}_err`, `${n}_wait`);
  f.link(`${n}_val`, esc, 'escalar');
  return { entrada: `${n}_ask`, salida: `${n}_val` };
}

// Elección por botones o lista; una respuesta fuera de las opciones repite el mensaje y el segundo fallo escala.
// El llamador conecta `ruta` con cada id de `opciones`.
function elegir(f, n, { tipo, body, opciones, boton = 'Elegir', variable, motivo }) {
  if (tipo === 'list') f.list(`${n}_ask`, body, boton, opciones);
  else f.buttons(`${n}_ask`, body, opciones);
  f.wait(`${n}_wait`);
  f.api(`${n}_route`, `route_reply:${variable}`, { edges: [...ids(opciones), 'invalido', 'escalar'] });
  const esc = escalar(f, `${n}_esc`, motivo);
  f.link(`${n}_ask`, `${n}_wait`).link(`${n}_wait`, `${n}_route`);
  f.link(`${n}_route`, `${n}_ask`, 'invalido');
  f.link(`${n}_route`, esc, 'escalar');
  return { entrada: `${n}_ask`, ruta: `${n}_route` };
}

// Como `elegir` con lista, pero la lista depende de la moneda guardada en `monedaVar`.
function elegirPorMoneda(f, n, { monedaVar, body, boton = 'Elegir banco', listas, variable, motivo }) {
  const todas = [...new Set(Object.values(listas).flat())];
  f.api(`${n}_mon`, `route_moneda:${monedaVar}`, { edges: MONEDAS });
  f.wait(`${n}_wait`);
  for (const m of MONEDAS) {
    f.list(`${n}_ask_${m}`, body, boton, listas[m].map((b) => ({ id: b, title: b })));
    f.link(`${n}_mon`, `${n}_ask_${m}`, m).link(`${n}_ask_${m}`, `${n}_wait`);
  }
  f.api(`${n}_route`, `route_reply:${variable}`, { edges: [...todas, 'invalido', 'escalar'] });
  const esc = escalar(f, `${n}_esc`, motivo);
  f.link(`${n}_wait`, `${n}_route`).link(`${n}_route`, `${n}_mon`, 'invalido').link(`${n}_route`, esc, 'escalar');
  return { entrada: `${n}_mon`, ruta: `${n}_route`, ids: todas };
}

// Lista cuyas filas salen de una variable del estado (p. ej. las cuentas guardadas del cliente).
function listaDinamica(f, id, { body, boton, filasVar }) {
  return f._add(id, 'send_interactive', { interactive_type: 'list', body_text: body, list_button_text: boton, rows_var: filasVar, phone_number_id: PHONE_NUMBER_ID });
}

module.exports = {
  MSG_PERSONA, MSG_SIN_TASAS, FORMULARIO_WEB, MONEDAS, MONEDAS_BTN, BANCOS_POR_MONEDA, TIPOS_DOC, FONDOS, ids,
  escalar, pregunta, elegir, elegirPorMoneda, listaDinamica,
};
```

`waha/src/flujos/v2/e1.js`:

```js
// E1 v2: extrae monto y monedas, cotiza en el backend real y ofrece continuar.
const { Flow } = require('../../../../kapso/build/flow');
const { AGENTE_EXTRACCION } = require('../../../../kapso/build/workflows');
const { MSG_SIN_TASAS, FORMULARIO_WEB, MONEDAS, MONEDAS_BTN, escalar, pregunta, elegir } = require('./helpers');

function e1() {
  const f = new Flow('E1', 'BrasPer · E1 Cotiza (v2)', 'brasper-v2-e1-cotiza', 'Etapa 1: extrae monto y monedas, cotiza con el backend y ofrece continuar.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.agent('extraer', AGENTE_EXTRACCION);
  f.link('init', 'extraer');
  f.api('verifica', 'check_extraction', { edges: ['completa', 'incompleta'] });
  f.link('extraer', 'verifica');
  f.api('cotiza', 'quote_create', { edges: ['ok', 'sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona'] });
  f.link('verifica', 'cotiza', 'completa');

  // Respaldo: el mensaje no trae los tres datos.
  const mo = elegir(f, 'mo', { tipo: 'buttons', body: '¡Hola! Soy el asistente de BrasPer. ¿Qué moneda quieres enviar?', opciones: MONEDAS_BTN, variable: 'moneda_origen', motivo: 'moneda_origen' });
  const md = elegir(f, 'md', { tipo: 'buttons', body: '¿En qué moneda recibe tu destinatario?', opciones: MONEDAS_BTN, variable: 'moneda_destino', motivo: 'moneda_destino' });
  const monto = pregunta(f, 'monto', { prompt: '¿Cuánto quieres enviar? Escribe solo el monto.', guardar: 'monto_raw', validar: 'monto', error: 'No entendí el monto. Escribe solo el número, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('verifica', mo.entrada, 'incompleta');
  f.linkAll(mo.ruta, md.entrada, MONEDAS);
  f.linkAll(md.ruta, monto.entrada, MONEDAS);
  f.link(monto.salida, 'cotiza', 'valido');

  // Resultados de la cotización.
  f.text('par_err', 'Esa combinación de monedas no está disponible. Elige otras.');
  f.link('cotiza', 'par_err', 'par_invalido').link('par_err', mo.entrada);
  f.text('bajo', 'Ese monto es menor al mínimo (unos 10 USD equivalentes). Escribe un monto mayor.');
  f.link('cotiza', 'bajo', 'monto_bajo').link('bajo', monto.entrada);
  f.link('cotiza', escalar(f, 'tasas', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS }), 'sin_servicio');
  f.link('cotiza', escalar(f, 'grande', 'monto_grande', { mensaje: 'Por el monto, te paso con una persona del equipo para ayudarte.' }), 'requiere_persona');
  f.buttons('oferta', '¡Hola! Hoy 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}. Comisión {{vars.comision_txt}} + impuesto {{vars.impuesto_txt}} {{vars.moneda_origen}}. Total a transferir {{vars.total_enviar_txt}} {{vars.moneda_origen}}. Recibirás {{vars.recibe_txt}} {{vars.moneda_destino}}. Tasa asegurada hasta las {{vars.tasa_hasta}}', [
    { id: 'continuar', title: 'Continuar' }, { id: 'cambiar_monto', title: 'Cambiar monto' }, { id: 'persona', title: 'Hablar con persona' },
  ]);
  f.cta('web', '¿Prefieres hacerlo desde la web?', 'Abrir formulario web', FORMULARIO_WEB);
  f.wait('oferta_wait');
  f.api('oferta_route', 'route_reply:accion_e1', { edges: ['continuar', 'cambiar_monto', 'persona', 'invalido', 'escalar'] });
  f.link('cotiza', 'oferta', 'ok').link('oferta', 'web').link('web', 'oferta_wait').link('oferta_wait', 'oferta_route');
  f.link('oferta_route', 'oferta', 'invalido');
  f.link('oferta_route', escalar(f, 'oferta_esc', 'oferta_sin_respuesta'), 'escalar');
  f.link('oferta_route', escalar(f, 'persona', 'cliente_pide_persona'), 'persona');
  const m2 = pregunta(f, 'monto2', { prompt: '¿Cuánto quieres enviar? Escribe solo el monto.', guardar: 'monto_raw', validar: 'monto', error: 'No entendí el monto. Escribe solo el número, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('oferta_route', m2.entrada, 'cambiar_monto');
  f.link(m2.salida, 'cotiza', 'valido');
  f.setvar('listo', 'continuar', 'si');
  f.link('oferta_route', 'listo', 'continuar');
  return f;
}

module.exports = { e1 };
```

`waha/src/flujos/v2/e2.js`:

```js
// E2 v2: datos del cliente (o confirmación de los guardados), origen de fondos, cuentas de origen y destino, resumen y createOrder.
const { Flow } = require('../../../../kapso/build/flow');
const { MSG_SIN_TASAS, MONEDAS, BANCOS_POR_MONEDA, TIPOS_DOC, FONDOS, ids, escalar, pregunta, elegir, elegirPorMoneda, listaDinamica } = require('./helpers');

// Bloque de cuenta (origen o destino): lista de las cuentas guardadas de esa moneda o, si no hay o elige "Otra cuenta",
// banco (lista por moneda; "Otro" = escribir el nombre) y número de cuenta. Termina en `${p}_ok`.
function bloqueCuenta(f, p, { lado, monedaVar, cuerpoLista, cuerpoBanco }) {
  const n = (s) => `${p}_${s}`;
  f.api(n('opc'), `cuentas_opciones:${lado}`, { edges: ['con_cuentas', 'sin_cuentas'] });
  listaDinamica(f, n('lista'), { body: cuerpoLista, boton: 'Elegir cuenta', filasVar: `opciones_${lado}` });
  f.wait(n('wait'));
  f.api(n('route'), `route_cuenta:${lado}`, { edges: ['elegida', 'otra', 'invalido', 'escalar'] });
  f.link(n('opc'), n('lista'), 'con_cuentas').link(n('lista'), n('wait')).link(n('wait'), n('route'));
  f.link(n('route'), n('lista'), 'invalido');
  f.link(n('route'), escalar(f, n('esc'), `cuenta_${lado}`), 'escalar');

  const banco = elegirPorMoneda(f, n('bn'), { monedaVar, body: cuerpoBanco, boton: 'Elegir banco', listas: BANCOS_POR_MONEDA, variable: `${lado}_banco_sel`, motivo: `banco_${lado}` });
  const bancoTxt = pregunta(f, n('bt'), { prompt: 'Escribe el nombre de tu banco.', guardar: `${lado}_banco_raw`, validar: `banco_${lado}`, error: 'No entendí el nombre del banco. Escríbelo de nuevo.', motivo: `banco_${lado}_invalido` });
  f.api(n('bset'), `banco_set:${lado}`);
  const num = pregunta(f, n('nm'), {
    prompt: `Escribe el número de la cuenta en {{vars.${lado}_banco}}.`, guardar: `${lado}_cuenta_raw`, validar: `cuenta_${lado}`,
    error: 'Ese número de cuenta no parece válido. Escríbelo solo con dígitos y guiones.', motivo: `cuenta_${lado}_invalida`,
  });
  f.link(n('opc'), banco.entrada, 'sin_cuentas').link(n('route'), banco.entrada, 'otra');
  f.linkAll(banco.ruta, n('bset'), banco.ids.filter((b) => b !== 'Otro'));
  f.link(banco.ruta, bancoTxt.entrada, 'Otro');
  f.link(bancoTxt.salida, num.entrada, 'valido').link(n('bset'), num.entrada);
  f.setvar(n('ok'), `cuenta_${lado}_lista`, 'si');
  f.link(n('route'), n('ok'), 'elegida').link(num.salida, n('ok'), 'valido');
  return { entrada: n('opc'), salida: n('ok') };
}

function e2() {
  const f = new Flow('E2', 'BrasPer · E2 Datos (v2)', 'brasper-v2-e2-datos', 'Etapa 2: datos del cliente, origen de fondos, cuentas, resumen y creación de la orden.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.api('perfil', 'perfil_get', { edges: ['nuevo', 'existe'] });
  f.link('init', 'perfil');

  // Cliente nuevo: nombre, tipo y número de documento, correo.
  const nom = pregunta(f, 'nom', { prompt: '¿Cuál es tu nombre completo? Escribe nombre y apellido.', guardar: 'nombre_raw', validar: 'nombre', error: 'Necesito tu nombre y apellido, por ejemplo Ana Souza.', motivo: 'nombre_invalido' });
  const dt = elegir(f, 'dt', { tipo: 'list', body: '¿Qué tipo de documento tienes?', opciones: TIPOS_DOC, variable: 'doc_tipo', motivo: 'doc_tipo' });
  const dn = pregunta(f, 'dn', { prompt: 'Escribe tu número de {{vars.doc_tipo}}.', guardar: 'doc_raw', validar: 'doc', error: 'Ese número no es válido para {{vars.doc_tipo}}. Revísalo y envíalo de nuevo.', motivo: 'doc_invalido' });
  const co = pregunta(f, 'co', { prompt: '¿A qué correo electrónico te enviamos tu comprobante?', guardar: 'correo_raw', validar: 'correo', error: 'Ese correo no parece válido. Escríbelo de nuevo, por ejemplo ana@correo.com.', motivo: 'correo_invalido' });
  f.link('perfil', nom.entrada, 'nuevo');
  f.link(nom.salida, dt.entrada, 'valido').linkAll(dt.ruta, dn.entrada, ids(TIPOS_DOC)).link(dn.salida, co.entrada, 'valido');

  // Cliente que vuelve: se confirman sus datos guardados.
  const cf = elegir(f, 'cf', {
    tipo: 'buttons', body: 'Usaremos tu {{vars.doc_tipo}} {{vars.doc_num}} y tu correo {{vars.correo_masc}}. ¿Es correcto?',
    opciones: [{ id: 'si_datos', title: 'Sí, es correcto' }, { id: 'cambiar', title: 'Cambiar mis datos' }], variable: 'confirma_datos', motivo: 'confirma_datos',
  });
  f.link('perfil', cf.entrada, 'existe').link(cf.ruta, nom.entrada, 'cambiar');

  // Origen de fondos y cuentas.
  const fo = elegir(f, 'fo', { tipo: 'list', body: '¿De dónde provienen los fondos?', opciones: FONDOS, variable: 'fondos', motivo: 'origen_fondos' });
  f.link(cf.ruta, fo.entrada, 'si_datos').link(co.salida, fo.entrada, 'valido');
  const origen = bloqueCuenta(f, 'cu_o', { lado: 'origen', monedaVar: 'moneda_origen', cuerpoLista: 'Elige la cuenta desde la que vas a pagar:', cuerpoBanco: '¿Desde qué banco nos envías tu dinero?' });
  const destino = bloqueCuenta(f, 'cu_d', { lado: 'destino', monedaVar: 'moneda_destino', cuerpoLista: 'Elige la cuenta donde recibirá tu destinatario:', cuerpoBanco: '¿En qué banco recibirá tu destinatario?' });
  f.linkAll(fo.ruta, origen.entrada, ids(FONDOS));
  f.link(origen.salida, destino.entrada);

  // Resumen y confirmación antes de crear la orden.
  const rs = elegir(f, 'rs', {
    tipo: 'buttons',
    body: 'Envías {{vars.total_enviar_txt}} {{vars.moneda_origen}} desde {{vars.origen_banco}} ••{{vars.origen_ult4}}.\nRecibe {{vars.recibe_txt}} {{vars.moneda_destino}} en {{vars.destino_banco}} ••{{vars.destino_ult4}}.\nTasa {{vars.tasa_txt}}. ¿Confirmas?',
    opciones: [{ id: 'confirmar', title: 'Confirmar' }, { id: 'cambiar', title: 'Cambiar datos' }, { id: 'cancelar', title: 'Cancelar' }], variable: 'confirma_e2', motivo: 'confirma_e2',
  });
  f.link(destino.salida, rs.entrada);
  f.text('cancelada', 'Listo, cancelé la solicitud. Cuando quieras, escríbeme de nuevo.');
  f.link(rs.ruta, nom.entrada, 'cambiar').link(rs.ruta, 'cancelada', 'cancelar');

  // Crear la orden y tratar lo que responda el backend.
  f.api('crea', 'order_create', { edges: ['ok', 'quote_expirada', 'requiere_persona', 'dato_invalido', 'sin_servicio'] });
  f.link(rs.ruta, 'crea', 'confirmar');
  f.setvar('listo', 'continuar', 'si');
  f.link('crea', 'listo', 'ok');
  f.link('crea', escalar(f, 'crea_grande', 'monto_grande', { mensaje: 'Por el monto, te paso con una persona del equipo para ayudarte.' }), 'requiere_persona');
  f.link('crea', escalar(f, 'crea_sin', 'creacion_no_disponible', { mensaje: 'Ahora no puedo crear tu operación con seguridad. Te paso con una persona del equipo para ayudarte.' }), 'sin_servicio');

  // La cotización venció (dura 15 min): se cotiza de nuevo con los mismos montos y se pide confirmar la nueva tasa.
  f.api('rq', 'quote_create', { edges: ['ok', 'sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona'] });
  f.link('crea', 'rq', 'quote_expirada');
  const rc = elegir(f, 'rc', {
    tipo: 'buttons',
    body: 'La tasa cambió. Nueva cotización: 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}. Total a transferir {{vars.total_enviar_txt}} {{vars.moneda_origen}}. Recibirás {{vars.recibe_txt}} {{vars.moneda_destino}}.',
    opciones: [{ id: 'continuar', title: 'Continuar' }, { id: 'cancelar', title: 'Cancelar' }], variable: 'tasa_nueva', motivo: 'tasa_nueva',
  });
  f.link('rq', rc.entrada, 'ok');
  const sinTasas = escalar(f, 'rq_esc', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS });
  for (const e of ['sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona']) f.link('rq', sinTasas, e);
  f.link(rc.ruta, 'crea', 'continuar').link(rc.ruta, 'cancelada', 'cancelar');

  // El backend rechazó un dato: se repregunta solo ese campo.
  f.text('inv', 'Uno de tus datos no pasó la validación. Revisémoslo.');
  f.api('campo', 'route_campo', { edges: ['nombre', 'documento', 'correo', 'otro'] });
  f.link('crea', 'inv', 'dato_invalido').link('inv', 'campo');
  f.link('campo', nom.entrada, 'nombre').link('campo', dt.entrada, 'documento').link('campo', co.entrada, 'correo').link('campo', fo.entrada, 'otro');
  return f;
}

module.exports = { e2 };
```

`waha/src/flujos/v2/e3.js`:

```js
// E3 v2: datos de pago de la orden, "Ya transferí", foto del comprobante (a Storage) y número de operación (submitProof).
const { Flow } = require('../../../../kapso/build/flow');
const { escalar, pregunta, elegir } = require('./helpers');

function e3() {
  const f = new Flow('E3', 'BrasPer · E3 Pago y constancia (v2)', 'brasper-v2-e3-pago', 'Etapa 3: cuenta de pago, constancia (foto y N.º de operación) o cancelación.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.api('info', 'orden_info');
  f.link('init', 'info');
  f.text('instr', 'Tu operación es {{vars.operacion_id}}.\nTransfiere {{vars.total_enviar_txt}} {{vars.moneda_origen}} a:\nTitular: {{vars.pago_titular}}\nBanco: {{vars.pago_banco}}\nCuenta: {{vars.pago_cuenta}}{{vars.pago_pix_linea}}\nUsa la cuenta de {{vars.moneda_origen}}, no otra moneda.\nTasa asegurada hasta las {{vars.tasa_hasta}}');
  f.link('info', 'instr');
  f.api('horario', 'check_hours', { edges: ['abierto', 'cerrado'] });
  f.link('instr', 'horario');
  f.text('fuera', 'Fuera de horario: tu operación se verificará {{vars.proxima_verificacion}}');
  const ac = elegir(f, 'ac', {
    tipo: 'buttons', body: 'Cuando termines la transferencia, toca "Ya transferí".',
    opciones: [{ id: 'ya_transferi', title: 'Ya transferí' }, { id: 'cancelar', title: 'Cancelar operación' }], variable: 'accion_e3', motivo: 'accion_e3',
  });
  f.link('horario', 'fuera', 'cerrado').link('horario', ac.entrada, 'abierto').link('fuera', ac.entrada);

  // Cancelar con confirmación.
  const cc = elegir(f, 'cc', {
    tipo: 'buttons', body: '¿Seguro que quieres cancelar la operación {{vars.operacion_id}}?',
    opciones: [{ id: 'si_cancelar', title: 'Sí, cancelar' }, { id: 'continuar', title: 'Continuar' }], variable: 'confirma_cancelar', motivo: 'confirma_cancelar',
  });
  f.api('cancela', 'cancel_order');
  f.text('cancelada', 'Listo, cancelé la operación {{vars.operacion_id}}.');
  f.link(ac.ruta, cc.entrada, 'cancelar').link(cc.ruta, 'cancela', 'si_cancelar').link(cc.ruta, ac.entrada, 'continuar').link('cancela', 'cancelada');

  // Constancia: foto (a Storage) y número de operación bancaria. El asistente no evalúa el comprobante.
  f.api('vigencia', 'check_lock', { edges: ['vigente', 'vencida'] });
  f.link(ac.ruta, 'vigencia', 'ya_transferi');
  f.text('pide_foto', 'Perfecto. Envíame la foto del comprobante (imagen o PDF).');
  f.setvar('marca_vencida', 'tasa_vencida', 'si');
  f.text('aviso_vencida', 'Tu tasa asegurada venció mientras transferías. Igual recibo tu constancia: una persona confirmará la tasa final al validar tu pago.');
  f.link('vigencia', 'pide_foto', 'vigente').link('vigencia', 'marca_vencida', 'vencida').link('marca_vencida', 'aviso_vencida').link('aviso_vencida', 'pide_foto');
  f.wait('esp_foto');
  f.api('foto', 'proof_upload', { edges: ['subida', 'sin_foto', 'muy_grande', 'fallo_subida', 'escalar'] });
  f.link('pide_foto', 'esp_foto').link('esp_foto', 'foto');
  f.text('sin_foto', 'No recibí una foto o PDF. Envíame la foto o captura del comprobante.');
  f.text('grande', 'El archivo pesa más de 8 MB. Envía una foto más liviana o un PDF más pequeño.');
  f.text('falla', 'No pude guardar tu archivo. Envíalo de nuevo.');
  f.link('foto', 'sin_foto', 'sin_foto').link('sin_foto', 'esp_foto');
  f.link('foto', 'grande', 'muy_grande').link('grande', 'esp_foto');
  f.link('foto', 'falla', 'fallo_subida').link('falla', 'esp_foto');
  f.link('foto', escalar(f, 'foto_esc', 'comprobante_no_recibido'), 'escalar');

  const nop = pregunta(f, 'nop', { prompt: 'Ahora escribe el número de operación bancaria.', guardar: 'operacion_raw', validar: 'operacion', error: 'Ese número no parece válido. Usa de 4 a 24 letras, dígitos o guiones.', motivo: 'n_operacion_invalido' });
  f.link('foto', nop.entrada, 'subida');
  f.api('envia', 'proof_submit', { edges: ['ok', 'duplicado', 'sin_subida', 'ya_recibido', 'invalido'] });
  f.link(nop.salida, 'envia', 'valido');
  f.text('cierre', 'Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo.');
  f.text('dup', 'Ese número de operación ya está en otra operación. Revísalo y envíalo de nuevo.');
  f.text('nofoto', 'No encontré tu foto. Envíamela de nuevo.');
  f.text('ya', 'Ya recibimos tu comprobante. Una persona validará tu pago.');
  f.link('envia', 'cierre', 'ok');
  f.link('envia', 'dup', 'duplicado').link('dup', nop.entrada);
  f.link('envia', 'nofoto', 'sin_subida').link('nofoto', 'esp_foto');
  f.link('envia', 'ya', 'ya_recibido');
  f.link('envia', nop.entrada, 'invalido');
  f.setvar('listo', 'continuar', 'si');
  f.link('cierre', 'listo').link('ya', 'listo');
  return f;
}

module.exports = { e3 };
```

`waha/src/flujos/v2/e4w0.js`:

```js
// E4 v2 (lo lanza el vigilante con vars.evento) y el enrutador W0 v2.
const { Flow } = require('../../../../kapso/build/flow');
const { escalar } = require('./helpers');

function e4() {
  const f = new Flow('E4', 'BrasPer · E4 Estado (v2)', 'brasper-v2-e4-estado', 'Etapa 4: avisa al cliente cuando el personal decide sobre su pago. Lo lanza el vigilante.');
  f.start();
  f.api('ev', 'route_evento', { edges: ['aprobada', 'rechazada', 'otro'] });
  f.link('start', 'ev');
  f.text('aprobada', '✅ Pago verificado. Enviamos tu dinero a la cuenta ••{{vars.destino_ult4}}.');
  f.text('rech', 'No pudimos validar tu pago de la operación {{vars.operacion_id}}: {{vars.motivo}}.');
  f.setvar('nada', 'evento_ignorado', 'si');
  f.link('ev', 'aprobada', 'aprobada').link('ev', 'rech', 'rechazada').link('ev', 'nada', 'otro');
  f.link('rech', escalar(f, 'rech_esc', 'pago_no_validado', { mensaje: 'Una persona del equipo te contactará.' }));
  return f;
}

function w0() {
  const f = new Flow('W0', 'BrasPer · W0 Enrutador (v2)', 'brasper-v2-w0-enrutador', 'Enruta cada conversación nueva a la etapa que corresponde según el estado de la orden.');
  f.start();
  f.api('estado', 'get_status', { edges: ['e1', 'e3', 'estado', 'escalada'] });
  f.link('start', 'estado');
  f.call('c1', 'E1').api('sigue1', 'check_continue', { edges: ['seguir', 'fin'] });
  f.call('c2', 'E2').api('sigue2', 'check_continue', { edges: ['seguir', 'fin'] });
  f.call('c3', 'E3');
  f.setvar('fin', 'flujo_terminado', 'si');
  f.link('estado', 'c1', 'e1').link('c1', 'sigue1').link('sigue1', 'c2', 'seguir').link('c2', 'sigue2').link('sigue2', 'c3', 'seguir');
  f.link('sigue1', 'fin', 'fin').link('sigue2', 'fin', 'fin');
  f.link('estado', 'c3', 'e3');
  f.text('status', 'Tu operación {{vars.operacion_id}} está {{vars.estado_texto}}.');
  f.link('estado', 'status', 'estado');
  f.text('esc', 'Una persona del equipo ya está atendiendo tu caso.');
  f.link('estado', 'esc', 'escalada');
  return f;
}

module.exports = { e4, w0 };
```

`waha/src/flujos/v2/index.js`:

```js
// Carga y valida los grafos v2. validar() de kapso/ no conoce las listas dinámicas (`rows_var`), así que para validar
// se sustituyen por una lista fija de ejemplo.
const { validar } = require('../../../../kapso/build/flow');
const { e1 } = require('./e1');
const { e2 } = require('./e2');
const { e3 } = require('./e3');
const { e4, w0 } = require('./e4w0');

function paraValidar(flow) {
  const nodes = flow.nodes.map((n) => (n.config && n.config.rows_var
    ? { ...n, config: { ...n.config, list_sections: [{ title: 'Opciones', rows: [{ id: 'x', title: 'x' }] }] } }
    : n));
  return { ...flow, nodes };
}

function cargarFlujosV2() {
  const flujos = { E1: e1(), E2: e2(), E3: e3(), E4: e4(), W0: w0() };
  const claves = Object.keys(flujos);
  for (const f of Object.values(flujos)) {
    const errs = validar(paraValidar(f), claves);
    if (errs.length) throw new Error(`${f.key} (v2) inválido:\n- ${errs.join('\n- ')}`);
  }
  return flujos;
}

module.exports = { cargarFlujosV2 };
```

- [ ] **Step 4: Ver que pasan**

Run: `node --test --test-timeout=60000 waha/test/flujo-v2.test.js`
Expected: PASS, 0 fallos (20 escenarios)

- [ ] **Commit**

```bash
git add waha/src/flujos/v2 waha/test/helpers/mundo-v2.js waha/test/flujo-v2.test.js
git commit -m "feat(waha): grafos v2 sobre el backend real (cliente nuevo y que vuelve, pago, comprobante, aviso y persona)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 8: Vigilante de órdenes

**Files:**
- Create: `waha/src/vigilante.js`
- Test: `waha/test/vigilante.test.js`

**Interfaces:**
- Consumes: almacén (`seguimientosAbiertos`, `actualizarSeguimiento`), `firestore.leer`, `funciones.llamar` (`getReceipt`), `motor.iniciar` (E4 v2), `proveedor.enviarDocumento(chatId, { nombre, mimetype, base64, caption })`, `mundo-v2` (tarea 7).
- Produces: `crearVigilante({ almacen, firestore, funciones, motor, proveedor, ahora, registrar, intervaloMs=20000 }) -> { tick(), iniciar(), detener() }`. `tick()` revisa una vez todas las órdenes abiertas (cada una como mucho una vez por minuto pasados 10 minutos; cierra las de más de 7 días): `approved`/`exported` → E4 `aprobada` (se marca avisado solo si salió); `rejected` → E4 `rechazada` con motivo y ticket, y cierra; `cancelled` → cierra; `exported` con `invoiceStatus: 'accepted'` → `getReceipt` y envío del PDF con el texto "Tu comprobante de la operación BR-000N", y cierra. Un 403/404 al leer cierra el seguimiento y se registra `seguimiento_sin_acceso`; cualquier otro fallo se registra y se reintenta en la siguiente revisión. El temporizador usa `unref()`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/vigilante.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearVigilante } = require('../src/vigilante');
const { crearMundoV2, hastaInstrucciones, T, CHAT } = require('./helpers/mundo-v2');
const { ErrorBackend } = require('../src/backend/real/errores');

const conMundo = async (fn, opciones) => { const m = await crearMundoV2(opciones); try { await fn(m); } finally { await m.cerrar(); } };
const vigilante = (m, extra = {}) => crearVigilante({ almacen: m.almacen, firestore: m.backend.firestore, funciones: m.backend.funciones, motor: m.motor, proveedor: m.proveedor, ahora: m.ahora, registrar: (e) => m.registrados.push(e), ...extra });

// Un cliente con la orden BR-0001 en validación (foto y número ya registrados).
async function validando(m) {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
}
const textos = (m) => m.proveedor.enviados.filter((e) => e.tipo === 'texto').map((e) => e.texto);

test('al aprobarse la orden avisa una sola vez, aunque se revise varias veces', () => conMundo(async (m) => {
  await validando(m);
  const v = vigilante(m);
  const antes = m.proveedor.enviados.length;
  await v.tick();
  assert.equal(m.proveedor.enviados.length, antes); // todavía en validación: no hay nada que avisar
  m.falso.aprobar('BR-0001');
  await v.tick();
  assert.equal(m.ultimo().texto, '✅ Pago verificado. Enviamos tu dinero a la cuenta ••7890.');
  await v.tick();
  await v.tick();
  assert.equal(textos(m).filter((t) => t.startsWith('✅ Pago verificado')).length, 1);
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, 'approved');
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 0); // falta el recibo
}));

test('cuando la factura está aceptada manda el recibo real como documento y cierra el seguimiento', () => conMundo(async (m) => {
  await validando(m);
  const v = vigilante(m);
  m.falso.aprobar('BR-0001');
  await v.tick();
  m.falso.exportar('BR-0001');
  await v.tick(); // exportada pero sin factura: el recibo aún no está listo
  assert.ok(!m.proveedor.enviados.some((e) => e.tipo === 'documento'));
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 0);
  m.falso.facturar('BR-0001');
  await v.tick();
  const doc = m.proveedor.enviados.find((e) => e.tipo === 'documento');
  assert.equal(doc.chatId, CHAT);
  assert.equal(doc.nombre, 'B001-00000001.pdf');
  assert.equal(doc.mimetype, 'application/pdf');
  assert.equal(doc.texto, 'Tu comprobante de la operación BR-0001');
  assert.match(Buffer.from(doc.base64, 'base64').toString(), /^%PDF-1\.4/);
  const s = m.almacen.seguimiento('BR-0001');
  assert.deepEqual([s.reciboEnviado, s.cerrado], [1, 1]);
  await v.tick();
  assert.equal(m.proveedor.enviados.filter((e) => e.tipo === 'documento').length, 1);
}));

test('si la orden salta de aprobada a facturada entre dos revisiones, igual se avisa la aprobación y se manda el recibo', () => conMundo(async (m) => {
  await validando(m);
  m.falso.aprobar('BR-0001'); m.falso.exportar('BR-0001'); m.falso.facturar('BR-0001');
  await vigilante(m).tick();
  assert.equal(textos(m).filter((t) => t.startsWith('✅ Pago verificado')).length, 1);
  assert.equal(m.proveedor.enviados.filter((e) => e.tipo === 'documento').length, 1);
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 1);
}));

test('un pago rechazado avisa el motivo, abre un ticket con una persona y cierra el seguimiento', () => conMundo(async (m) => {
  await validando(m);
  m.falso.rechazar('BR-0001', 'El monto transferido no coincide');
  await vigilante(m).tick();
  assert.ok(textos(m).includes('No pudimos validar tu pago de la operación BR-0001: El monto transferido no coincide.'));
  assert.match(m.ultimo().texto, /^Una persona del equipo te contactará\. Estás en la posición 1/);
  assert.equal(m.falso.tickets.size, 1);
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 1);
}));

test('si el cliente está en otra conversación, el aviso se aplaza y no se marca como enviado', () => conMundo(async (m) => {
  await validando(m);
  const v = vigilante(m);
  m.almacen.guardarEjecucion(T, { flujo: 'E2', telefono: T, chatId: CHAT, nodo: 'x', vars: {}, entrantes: [], esperando: { guardar: null, opciones: null } }); // el cliente está a mitad de otra operación
  m.falso.aprobar('BR-0001');
  const antes = m.proveedor.enviados.length;
  await v.tick();
  assert.equal(m.proveedor.enviados.length, antes);
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, null);
  m.almacen.borrarEjecucion(T); // la conversación termina
  await v.tick();
  assert.equal(m.ultimo().texto, '✅ Pago verificado. Enviamos tu dinero a la cuenta ••7890.');
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, 'approved');
}));

test('persiste a los reinicios: un vigilante nuevo sobre la misma base no repite avisos', () => conMundo(async (m) => {
  await validando(m);
  m.falso.aprobar('BR-0001');
  await vigilante(m).tick();
  const n = m.proveedor.enviados.length;
  await vigilante(m).tick(); // "reinicio"
  assert.equal(m.proveedor.enviados.length, n);
}));

test('un fallo de red al leer la orden no rompe la revisión: se reintenta en la siguiente', () => conMundo(async (m) => {
  await validando(m);
  m.falso.aprobar('BR-0001');
  const v = vigilante(m);
  m.falso.fallar('/orders/BR-0001', { estado: 502, veces: 2 }); // la lectura y su reintento fallan
  await v.tick();
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, null);
  await v.tick();
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, 'approved');
}));

test('una revisión con fallo no impide revisar las demás órdenes', () => conMundo(async (m) => {
  await validando(m);
  m.almacen.abrirSeguimiento({ ordenId: 'BR-9999', telefono: '51900000000', chatId: '51900000000@c.us', creado: m.ahora().toISOString() }); // no existe: sin acceso
  m.falso.aprobar('BR-0001');
  await vigilante(m).tick();
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, 'approved');
  assert.equal(m.almacen.seguimiento('BR-9999').cerrado, 1); // sin acceso a esa orden: se deja de vigilar
  assert.ok(m.registrados.some((e) => e.tipo === 'seguimiento_sin_acceso'));
}));

test('las órdenes de más de 7 días o canceladas dejan de vigilarse', () => conMundo(async (m) => {
  await validando(m);
  const hace8 = new Date(m.ahora().getTime() - 8 * 24 * 3600 * 1000).toISOString();
  m.bd.prepare('UPDATE seguimientos SET creado = ? WHERE orden_id = ?').run(hace8, 'BR-0001');
  await vigilante(m).tick();
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 1);
  assert.ok(!textos(m).some((t) => t.startsWith('✅')));
}));

test('iniciar y detener manejan el temporizador sin dejar el proceso colgado', async () => {
  let llamadas = 0;
  const v = crearVigilante({ almacen: { seguimientosAbiertos: () => { llamadas += 1; return []; } }, firestore: {}, funciones: {}, motor: {}, proveedor: {}, ahora: () => new Date(), registrar: () => {}, intervaloMs: 10 });
  v.iniciar();
  await new Promise((r) => setTimeout(r, 60));
  v.detener();
  const n = llamadas;
  assert.ok(n >= 2, `se revisó ${n} veces`);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(llamadas, n);
});
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test --test-timeout=60000 waha/test/vigilante.test.js`
Expected: FAIL (Cannot find module `../src/vigilante`)

- [ ] **Step 3: Escribir el código**

`waha/src/vigilante.js`:

```js
// Vigila las órdenes que esperan una decisión del personal y avisa al cliente por WhatsApp.
// Lee `orders/{id}` con el token del cliente (no hay una dirección pública a la que el backend pueda llamar de vuelta).
// Un aviso solo se marca como enviado si salió; si el cliente está en otra conversación se reintenta en la siguiente revisión.
const { ErrorBackend } = require('./backend/real/errores');

const SIETE_DIAS_MS = 7 * 24 * 3600 * 1000;
const DIEZ_MIN_MS = 10 * 60 * 1000;

function crearVigilante({ almacen, firestore, funciones, motor, proveedor, ahora = () => new Date(), registrar = () => {}, intervaloMs = 20000 }) {
  const ultimaRevision = new Map(); // ordenId → ms; pasados los 10 minutos se revisa una vez por minuto
  let temporizador = null;

  async function avisar(s, orden, evento) {
    const r = await motor.iniciar('E4', s.telefono, s.chatId, {
      operacion_id: s.ordenId, evento, destino_ult4: String(orden.destinationAccount || '').replace(/[^0-9A-Za-z]/g, '').slice(-4),
      motivo: orden.rejectionReason || 'no pudimos validar el comprobante',
    });
    return r.iniciado && !r.fallo;
  }

  async function enviarRecibo(s) {
    let recibo;
    try {
      recibo = await funciones.llamar(s.telefono, 'getReceipt', { orderId: s.ordenId });
    } catch (e) {
      if (e instanceof ErrorBackend && e.codigo === 'receipt-not-ready') return false; // todavía no hay factura aceptada
      throw e;
    }
    await proveedor.enviarDocumento(s.chatId, { nombre: recibo.filename, mimetype: recibo.contentType, base64: recibo.base64, caption: `Tu comprobante de la operación ${s.ordenId}` });
    return true;
  }

  async function revisar(s) {
    const edad = ahora().getTime() - new Date(s.creado).getTime();
    if (edad > SIETE_DIAS_MS) { almacen.actualizarSeguimiento(s.ordenId, { cerrado: 1 }); return; }
    const antes = ultimaRevision.get(s.ordenId) || 0;
    if (edad > DIEZ_MIN_MS && ahora().getTime() - antes < 60000) return;
    ultimaRevision.set(s.ordenId, ahora().getTime());

    let orden;
    try {
      orden = await firestore.leer(s.telefono, `orders/${s.ordenId}`);
    } catch (e) {
      if (e instanceof ErrorBackend && !e.transporte) {
        registrar({ tipo: 'seguimiento_sin_acceso', estado: String(e.estado || ''), detalle: e.codigo || '' });
        almacen.actualizarSeguimiento(s.ordenId, { cerrado: 1 });
        return;
      }
      throw e;
    }
    if (!orden || orden.status === 'cancelled') { almacen.actualizarSeguimiento(s.ordenId, { cerrado: 1 }); return; }

    if (orden.status === 'rejected' && s.estadoAvisado !== 'rejected') {
      if (await avisar(s, orden, 'rechazada')) almacen.actualizarSeguimiento(s.ordenId, { estadoAvisado: 'rejected', cerrado: 1 });
      return;
    }
    let estado = s.estadoAvisado;
    if (['approved', 'exported'].includes(orden.status) && estado !== 'approved') {
      if (!(await avisar(s, orden, 'aprobada'))) return;
      almacen.actualizarSeguimiento(s.ordenId, { estadoAvisado: 'approved' });
      estado = 'approved';
    }
    if (estado === 'approved' && orden.status === 'exported' && orden.invoiceStatus === 'accepted' && !s.reciboEnviado) {
      if (await enviarRecibo(s)) almacen.actualizarSeguimiento(s.ordenId, { reciboEnviado: 1, cerrado: 1 });
    }
  }

  // Una revisión de todas las órdenes abiertas. Un fallo en una no impide revisar las demás.
  async function tick() {
    for (const s of almacen.seguimientosAbiertos()) {
      try {
        await revisar(s);
      } catch (e) {
        registrar({ tipo: 'error_seguimiento', estado: String((e && (e.estado || e.codigo)) || ''), detalle: String((e && e.message) || e).slice(0, 120) });
      }
    }
  }

  function iniciar() {
    if (temporizador) return;
    temporizador = setInterval(() => { tick().catch(() => {}); }, intervaloMs);
    temporizador.unref();
  }
  function detener() { clearInterval(temporizador); temporizador = null; }

  return { tick, iniciar, detener };
}

module.exports = { crearVigilante };
```

- [ ] **Step 4: Ver que pasan**

Run: `node --test --test-timeout=60000 waha/test/vigilante.test.js`
Expected: PASS, 0 fallos (10 pruebas)

- [ ] **Commit**

```bash
git add waha/src/vigilante.js waha/test/vigilante.test.js
git commit -m "feat(waha): vigilante que avisa la aprobación o el rechazo y entrega el recibo real

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 9: Ensamblado según `BACKEND`, servidor, scripts, contrato y documentación

**Files:**
- Create: `waha/src/ensamblar.js`, `waha/scripts/contrato.js`
- Modify: `waha/src/config.js`, `waha/src/demo.js`, `waha/src/server.js`, `waha/src/main.js`, `waha/src/scripts/demo.js`, `waha/src/scripts/preflight.js`, `waha/package.json`, `waha/.env.example`, `waha/docker-compose.yml`, `waha/README.md`
- Test: `waha/test/ensamblar.test.js`, `waha/test/config.test.js`, `waha/test/demo.test.js`, `waha/test/server.test.js` (ampliadas)

**Interfaces:**
- Consumes: `crearBackend` (tarea 6), `cargarFlujosV2` (tarea 7), `crearVigilante` (tarea 8), `crearDescargaMedia` (tarea 5), el falso (tarea 3).
- Produces:
  - `cargarConfig(env).backend` (`'simulado'` por defecto, `'real'`; otro valor lanza "BACKEND debe ser real o simulado").
  - `ensamblar({ config, entorno, almacen, proveedor, extraer, descargarMedia, fetchImpl, ahora, dormir }) -> { servidor, inactivo, motor, backend, vigilante|null }`: en `real` usa los grafos v2 y arranca un vigilante; en `simulado`, los grafos v1 y `vigilante: null`.
  - `crearServidor({ …, saludBackend })`: `GET /health/backend` → `{backend:'simulado',ready:true}` o, en real, 200/503 según llame `getRates`; con `backend: 'real'` el aviso interno **no** envía el comprobante simulado.
  - `resetDemo({ …, clienteNuevo })` (olvida la sesión de Firebase); `npm run demo:reset -- <teléfono> --cliente-nuevo`; `npm run contrato`; `preflight` añade la línea del backend; el compose añade `WAHA_EVENTS_DOWNLOAD_MEDIA: "true"`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`waha/test/ensamblar.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { ensamblar } = require('../src/ensamblar');
const { ProveedorFalso } = require('./helpers/proveedor-falso');
const { crearFirebaseFalso } = require('./helpers/firebase-falso');

const CONFIG = { comprobanteEntrega: 'whatsapp', hmacSecret: 's', internalKey: 'k', wahaBaseUrl: 'http://waha:3000', wahaApiKey: 'K', wahaSession: 'demo', iaTimeoutMs: 100 };

async function conServidor(config, entorno, fn) {
  const { servidor, vigilante } = ensamblar({
    config: { ...CONFIG, ...config }, entorno, almacen: crearAlmacen(abrirDb(':memory:')), proveedor: new ProveedorFalso(), extraer: async () => ({}), dormir: async () => {},
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  servidor.unref();
  try { await fn(`http://127.0.0.1:${servidor.address().port}`, vigilante); } finally { await new Promise((r) => servidor.close(r)); }
}

test('en modo simulado no hay vigilante y /health/backend responde simulado', async () => {
  await conServidor({ backend: 'simulado' }, {}, async (base, vigilante) => {
    assert.equal(vigilante, null);
    assert.deepEqual(await (await fetch(`${base}/health/backend`)).json(), { backend: 'simulado', ready: true });
  });
});

test('en modo real hay vigilante y /health/backend llama a getRates con una sesión propia', async () => {
  const falso = await crearFirebaseFalso();
  try {
    const entorno = { FIREBASE_API_KEY: falso.apiKey, FIREBASE_IDENTITY_URL: falso.config.identityUrl, FIREBASE_TOKEN_URL: falso.config.tokenUrl, FIREBASE_FUNCTIONS_URL: falso.config.functionsUrl, FIREBASE_FIRESTORE_URL: falso.config.firestoreUrl, FIREBASE_STORAGE_URL: falso.config.storageUrl };
    await conServidor({ backend: 'real' }, entorno, async (base, vigilante) => {
      assert.ok(vigilante && typeof vigilante.tick === 'function');
      assert.deepEqual(await (await fetch(`${base}/health/backend`)).json(), { backend: 'real', ready: true });
      falso.fallar('/fn/getrates', { estado: 500, veces: 5 });
      const r = await fetch(`${base}/health/backend`);
      assert.deepEqual([r.status, (await r.json()).ready], [503, false]);
    });
  } finally { await falso.cerrar(); }
});

test('en modo real sin FIREBASE_API_KEY falla al ensamblar y lo dice sin imprimir valores', () => {
  assert.throws(() => ensamblar({ config: { ...CONFIG, backend: 'real' }, entorno: {}, almacen: crearAlmacen(abrirDb(':memory:')), proveedor: new ProveedorFalso(), extraer: async () => ({}) }), /FIREBASE_API_KEY/);
});
```

Parche para `waha/test/config.test.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/test/config.test.js
+++ b/waha/test/config.test.js
@@ -46,3 +46,9 @@
   assert.equal(cargarConfig({ ...BASE, COMPROBANTE_ENTREGA: 'ninguno' }).comprobanteEntrega, 'ninguno');
   assert.throws(() => cargarConfig({ ...BASE, COMPROBANTE_ENTREGA: 'correo' }), /whatsapp o ninguno/);
 });
+
+test('BACKEND vale simulado por defecto, acepta real y rechaza otros valores', () => {
+  assert.equal(cargarConfig(BASE).backend, 'simulado');
+  assert.equal(cargarConfig({ ...BASE, BACKEND: 'real' }).backend, 'real');
+  assert.throws(() => cargarConfig({ ...BASE, BACKEND: 'firebase' }), /real o simulado/);
+});
```

Parche para `waha/test/demo.test.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/test/demo.test.js
+++ b/waha/test/demo.test.js
@@ -28,3 +28,12 @@
   assert.equal(m.almacen.cargarEjecucion(T), null);
   for (const k of ['active', 'seen', 'handoff']) assert.equal(await m.kv.get(`${k}:${T}`, 'json'), null);
 });
+
+test('resetDemo con clienteNuevo también olvida la sesión de Firebase del teléfono', async () => {
+  const m = mundo();
+  m.almacen.guardarSesionFirebase({ telefono: T, uid: 'u1', refresh: 'r', idToken: 't', vence: 1 });
+  await resetDemo({ almacen: m.almacen, llamarFuncion: m.llamarFuncion, telefono: T });
+  assert.ok(m.almacen.sesionFirebase(T)); // el reset normal conserva la sesión: el cliente sigue siendo el mismo
+  await resetDemo({ almacen: m.almacen, llamarFuncion: m.llamarFuncion, telefono: T, clienteNuevo: true });
+  assert.equal(m.almacen.sesionFirebase(T), null);
+});
```

Parche para `waha/test/server.test.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/test/server.test.js
+++ b/waha/test/server.test.js
@@ -20,12 +20,12 @@
   return { W0: w0, E4: e4 };
 }
 
-async function levantar({ fetchImpl, config } = {}) {
+async function levantar({ fetchImpl, config, saludBackend } = {}) {
   const db = abrirDb(':memory:');
   const almacen = crearAlmacen(db);
   const proveedor = new ProveedorFalso();
   const motor = crearMotor({ flujos: flujos(), almacen, proveedor, llamarFuncion: async () => ({ vars: {} }), extraer: async () => ({}) });
-  const { servidor, inactivo } = crearServidor({ config: { ...CONFIG, ...config }, motor, almacen, proveedor, fetchImpl });
+  const { servidor, inactivo } = crearServidor({ config: { ...CONFIG, ...config }, motor, almacen, proveedor, fetchImpl, saludBackend });
   await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
   servidor.unref(); // si una prueba falla antes de cerrar, el proceso no se queda colgado
   const base = `http://127.0.0.1:${servidor.address().port}`;
@@ -244,5 +244,31 @@
     assert.equal(res.status, 200);
     assert.deepEqual((await res.json()).comprobante, { enviado: false, motivo: 'error' });
     assert.equal(s.db.prepare("SELECT COUNT(*) n FROM registro WHERE tipo = 'error_comprobante'").get().n, 1);
+  } finally { await s.cerrar(); }
+});
+
+test('con backend real el aviso interno no manda el comprobante simulado (lo manda el vigilante con el recibo real)', async () => {
+  const s = await levantar({ config: { backend: 'real' } });
+  try {
+    const res = await fetch(`${s.base}/internal/avisos`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Key': 'clave-interna' }, body: JSON.stringify({ telefono: '51944686794', operacion_id: 'BR-0001' }) });
+    const j = await res.json();
+    assert.equal(res.status, 200);
+    assert.equal(j.comprobante, undefined);
+    assert.ok(!s.proveedor.enviados.some((e) => e.tipo === 'documento'));
   } finally { await s.cerrar(); }
 });
+
+test('/health/backend informa el modo y, en real, si el backend responde', async () => {
+  const sim = await levantar({ config: { backend: 'simulado' } });
+  try {
+    const r = await fetch(`${sim.base}/health/backend`);
+    assert.deepEqual([r.status, await r.json()], [200, { backend: 'simulado', ready: true }]);
+  } finally { await sim.cerrar(); }
+  for (const [ok, estado] of [[true, 200], [false, 503]]) {
+    const s = await levantar({ config: { backend: 'real' }, saludBackend: async () => { if (!ok) throw new Error('sin respuesta'); } });
+    try {
+      const r = await fetch(`${s.base}/health/backend`);
+      assert.deepEqual([r.status, (await r.json()).ready], [estado, ok]);
+    } finally { await s.cerrar(); }
+  }
+});
```

- [ ] **Step 2: Ver que fallan**

Run: `node --test waha/test/ensamblar.test.js waha/test/config.test.js waha/test/demo.test.js waha/test/server.test.js`
Expected: FAIL (módulo `../src/ensamblar` inexistente y pruebas nuevas de BACKEND, clienteNuevo y /health/backend)

- [ ] **Step 3: Escribir el código**

`waha/src/ensamblar.js`:

```js
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
    modo: config.backend, almacen, entorno, configReal: real ? configBackend(entorno) : undefined, fetchImpl, descargarMedia, ahora, registrar, dormir,
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
```

Parche para `waha/src/config.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/config.js
+++ b/waha/src/config.js
@@ -20,7 +20,10 @@
   if (!['nativo', 'texto'].includes(interactivos)) throw new Error('WAHA_INTERACTIVOS debe ser nativo o texto');
   const comprobanteEntrega = env.COMPROBANTE_ENTREGA || 'whatsapp';
   if (!['whatsapp', 'ninguno'].includes(comprobanteEntrega)) throw new Error('COMPROBANTE_ENTREGA debe ser whatsapp o ninguno');
+  const backend = env.BACKEND || 'simulado';
+  if (!['real', 'simulado'].includes(backend)) throw new Error('BACKEND debe ser real o simulado');
   return {
+    backend,
     wahaBaseUrl: env.WAHA_BASE_URL || `http://127.0.0.1:${env.WAHA_PORT || 3010}`,
     wahaApiKey: env.WAHA_API_KEY,
     wahaSession: env.WAHA_SESSION || 'demo',
```

Parche para `waha/src/demo.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/demo.js
+++ b/waha/src/demo.js
@@ -1,8 +1,10 @@
 // Equivalentes de reset_demo y seed_demo del README de Kapso, ahora sobre la base local.
 const vacio = { messages: [] };
 
-async function resetDemo({ almacen, llamarFuncion, telefono }) {
+// clienteNuevo: además olvida la sesión de Firebase, para repetir el recorrido de un cliente que llega por primera vez.
+async function resetDemo({ almacen, llamarFuncion, telefono, clienteNuevo = false }) {
   almacen.borrarEjecucion(telefono);
+  if (clienteNuevo) almacen.borrarSesionFirebase(telefono);
   await llamarFuncion({ vars: { api_action: 'reset_demo' }, phone: telefono, edges: [], wa: vacio });
 }
 
```

Parche para `waha/src/server.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/server.js
+++ b/waha/src/server.js
@@ -27,7 +27,7 @@
   return x.length === y.length && crypto.timingSafeEqual(x, y);
 }
 
-function crearServidor({ config, motor, almacen, proveedor, fetchImpl = fetch }) {
+function crearServidor({ config, motor, almacen, proveedor, fetchImpl = fetch, saludBackend = async () => {} }) {
   const pendientes = new Set();
   const enSegundoPlano = (promesa) => { pendientes.add(promesa); promesa.finally(() => pendientes.delete(promesa)); };
   const kv = almacen.kvEnv();
@@ -90,6 +90,17 @@
     }
   }
 
+  // En modo real basta con que el backend responda (p. ej. getRates); el detalle del fallo nunca sale al exterior.
+  async function saludDelBackend(responder) {
+    if (config.backend !== 'real') return responder(200, { backend: 'simulado', ready: true });
+    try {
+      await saludBackend();
+      return responder(200, { backend: 'real', ready: true });
+    } catch {
+      return responder(503, { backend: 'real', ready: false });
+    }
+  }
+
   async function avisos(req, responder) {
     if (!iguales(req.headers['x-internal-key'], config.internalKey)) return responder(401, { error: 'no autorizado' });
     let datos;
@@ -99,7 +110,7 @@
     const chatId = guardado || `${datos.telefono}@c.us`;
     const r = await motor.iniciar('E4', datos.telefono, chatId, { operacion_id: datos.operacion_id });
     // Después del aviso de E4, el comprobante en PDF por el mismo chat. Un fallo aquí nunca rompe el aviso.
-    if (r.iniciado && config.comprobanteEntrega === 'whatsapp') {
+    if (r.iniciado && config.backend !== 'real' && config.comprobanteEntrega === 'whatsapp') {
       try {
         r.comprobante = await entregarComprobante({ kv, proveedor, registrar: (e) => almacen.registrar(e), telefono: datos.telefono, chatId, operacionId: datos.operacion_id });
       } catch (e) {
@@ -116,6 +127,7 @@
       const { pathname } = new URL(req.url, 'http://local');
       if (req.method === 'POST' && pathname === '/webhooks/waha') return await webhook(req, responder);
       if (req.method === 'GET' && pathname === '/health/whatsapp') return await salud(responder);
+      if (req.method === 'GET' && pathname === '/health/backend') return await saludDelBackend(responder);
       if (req.method === 'POST' && pathname === '/internal/avisos') return await avisos(req, responder);
       return responder(404, { error: 'no encontrado' });
     } catch (e) {
```

Parche para `waha/src/main.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/main.js
+++ b/waha/src/main.js
@@ -4,11 +4,9 @@
 const { abrirDb } = require('./estado/db');
 const { crearAlmacen } = require('./estado/almacen');
 const { WahaProvider } = require('./provider/waha');
-const { crearLlamadorFuncion } = require('./puente-api');
 const { crearExtractor } = require('./ia/extraccion');
-const { crearMotor } = require('./motor/motor');
-const { cargarFlujos } = require('./flujos');
-const { crearServidor } = require('./server');
+const { crearDescargaMedia } = require('./media');
+const { ensamblar } = require('./ensamblar');
 
 async function main() {
   const config = cargarConfig({ ...cargarEnvDeArchivos(path.join(__dirname, '..')), ...process.env });
@@ -18,15 +16,16 @@
     baseUrl: config.wahaBaseUrl, apiKey: config.wahaApiKey, session: config.wahaSession,
     interactivos: config.interactivos, pausaMs: config.pausaEnvioMs, registrar: (e) => almacen.registrar(e),
   });
-  const motor = crearMotor({
-    flujos: cargarFlujos(), almacen, proveedor,
-    llamarFuncion: crearLlamadorFuncion({ kvEnv: almacen.kvEnv(), envExtra: { TASAS_CAIDAS: process.env.TASAS_CAIDAS } }),
+  const entorno = { ...cargarEnvDeArchivos(path.join(__dirname, '..')), ...process.env };
+  const { servidor, vigilante } = ensamblar({
+    config, entorno, almacen, proveedor,
     extraer: crearExtractor({ apiKey: config.anthropicApiKey, timeoutMs: config.iaTimeoutMs }),
+    descargarMedia: crearDescargaMedia({ wahaBaseUrl: config.wahaBaseUrl, apiKey: config.wahaApiKey, session: config.wahaSession }),
   });
-  const { servidor } = crearServidor({ config, motor, almacen, proveedor });
   servidor.listen(config.puerto, config.host, () => {
-    console.log(`BrasPer WAHA escuchando en http://${config.host}:${config.puerto} | interactivos=${config.interactivos} | IA=${config.anthropicApiKey ? 'activa' : 'sin clave (el flujo pregunta paso a paso)'}`);
+    console.log(`BrasPer WAHA escuchando en http://${config.host}:${config.puerto} | backend=${config.backend} | interactivos=${config.interactivos} | IA=${config.anthropicApiKey ? 'activa' : 'sin clave (el flujo pregunta paso a paso)'}`);
   });
+  if (vigilante) vigilante.iniciar();
   try {
     const r = await fetch(`${config.wahaBaseUrl}/api/sessions/${config.wahaSession}`, { headers: { 'X-Api-Key': config.wahaApiKey }, signal: AbortSignal.timeout(3000) });
     const s = r.ok ? (await r.json()).status : `HTTP_${r.status}`;
```

Parche para `waha/src/scripts/demo.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/scripts/demo.js
+++ b/waha/src/scripts/demo.js
@@ -1,4 +1,4 @@
-// Uso: node src/scripts/demo.js reset|seed <telefono> [--cuentas 2]
+// Uso: node src/scripts/demo.js reset|seed <telefono> [--cuentas 2] [--cliente-nuevo]
 const path = require('node:path');
 const { cargarConfig, cargarEnvDeArchivos } = require('../config');
 const { abrirDb } = require('../estado/db');
@@ -13,7 +13,7 @@
   const config = cargarConfig({ ...cargarEnvDeArchivos(path.join(__dirname, '..', '..')), ...process.env });
   const almacen = crearAlmacen(abrirDb(config.dbPath));
   const llamarFuncion = crearLlamadorFuncion({ kvEnv: almacen.kvEnv() });
-  if (orden === 'reset') await resetDemo({ almacen, llamarFuncion, telefono });
+  if (orden === 'reset') await resetDemo({ almacen, llamarFuncion, telefono, clienteNuevo: resto.includes('--cliente-nuevo') });
   else await seedDemo({ llamarFuncion, telefono, cuentas: resto.includes('--cuentas') ? Number(resto[resto.indexOf('--cuentas') + 1]) : 1 });
   console.log(`${orden} listo para ${'*'.repeat(Math.max(0, telefono.length - 4))}${telefono.slice(-4)}`);
 })().catch((e) => { console.error(e.message); process.exit(1); });
```

Parche para `waha/src/scripts/preflight.js` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/src/scripts/preflight.js
+++ b/waha/src/scripts/preflight.js
@@ -22,6 +22,13 @@
     if (!r.ok) throw new Error(`HTTP ${r.status}`);
     return 'ready';
   });
+  if (c.backend === 'real') {
+    await probar('El backend de Firebase responde (/health/backend)', async () => {
+      const r = await fetch(`http://${c.host}:${c.puerto}/health/backend`, { signal: AbortSignal.timeout(8000) });
+      if (!r.ok) throw new Error(`HTTP ${r.status} (getRates no respondió)`);
+      return 'getRates ok';
+    });
+  }
   await probar('La base SQLite abre y escribe', async () => { abrirDb(c.dbPath).exec('SELECT 1'); return c.dbPath; });
   await probar('Hay clave de Anthropic (no se muestra)', async () => { if (!c.anthropicApiKey) throw new Error('falta ANTHROPIC_API_KEY'); return 'presente'; });
   if (process.argv.includes('--ia')) {
@@ -31,6 +38,7 @@
       return 'ok';
     });
   }
+  filas.push(['Backend', true, c.backend]);
   filas.push(['Modo de botones y listas', true, c.interactivos]);
   for (const [n, ok, d] of filas) console.log(`${ok ? '✔' : '✘'} ${n}: ${d}`);
   console.log('Pendiente a mano: mensaje de prueba desde otro teléfono y sin aviso de restricción 463/475 en el panel de WAHA.');
```

Parche para `waha/package.json` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/package.json
+++ b/waha/package.json
@@ -10,6 +10,7 @@
     "sesion": "node src/scripts/crear-sesion.js",
     "preflight": "node src/scripts/preflight.js",
     "demo:reset": "node src/scripts/demo.js reset",
+    "contrato": "node scripts/contrato.js",
     "demo:seed": "node src/scripts/demo.js seed"
   }
 }
```

Parche para `waha/.env.example` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/.env.example
+++ b/waha/.env.example
@@ -14,3 +14,8 @@
 # Comprobante en PDF por el chat al completarse la operación: whatsapp (por defecto) o ninguno.
 COMPROBANTE_ENTREGA=whatsapp
 # ANTHROPIC_API_KEY va en el .env de la raíz del repositorio (o aquí).
+# Backend: simulado (por defecto, la API de demostración) o real (funciones y Firestore del proyecto Firebase de BrasPer).
+BACKEND=simulado
+# Solo con BACKEND=real. La clave web de Firebase es pública (la lleva cualquier app web), pero se lee del entorno.
+FIREBASE_API_KEY=
+FIREBASE_PROJECT_ID=aibrasper
```

Parche para `waha/docker-compose.yml` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/docker-compose.yml
+++ b/waha/docker-compose.yml
@@ -13,6 +13,8 @@
       WHATSAPP_SWAGGER_ENABLED: "true"
       WHATSAPP_SWAGGER_USERNAME: ${WHATSAPP_SWAGGER_USERNAME}
       WHATSAPP_SWAGGER_PASSWORD: ${WHATSAPP_SWAGGER_PASSWORD}
+      # Las fotos de los comprobantes llegan con su enlace de descarga en el webhook (BACKEND=real).
+      WAHA_EVENTS_DOWNLOAD_MEDIA: "true"
     volumes:
       - ./.sessions:/app/.sessions
 
```

- [ ] **Step 4: Escribir el script de contrato y la documentación**

El script se comprueba solo con una ejecución real (tarea 10, H1): sus pruebas se hacen contra el proyecto de verdad, y su lógica de comparación es la misma que valida el falso.

`waha/scripts/contrato.js`:

```js
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
```

Parche para `waha/README.md` (guárdalo en un archivo temporal y aplícalo con `git apply <archivo>` desde la raíz del repositorio):

```diff
--- a/waha/README.md
+++ b/waha/README.md
@@ -59,6 +59,19 @@
 
 Responde `{"iniciado":true}`. Si el cliente está en medio de una conversación responde `{"iniciado":false,"motivo":"ocupado"}` y no envía nada. Otros estados (`rechazada`, `escalada`, `cancelada`) se simulan igual con `set_status`.
 
+## Backend real (Firebase)
+
+Con `BACKEND=real` el bot usa el backend del equipo (proyecto Firebase `aibrasper`: funciones `getRates`, `createQuote`, `createOrder`, `submitProof`, `requestHuman`, `getReceipt`…) en lugar de la API simulada. Con `BACKEND=simulado` (por defecto) todo sigue como antes: es el modo de respaldo para la demo.
+
+1. En `waha/.env`: `BACKEND=real` y `FIREBASE_API_KEY=<clave web pública de Firebase>` (la lleva cualquier app web del proyecto; `FIREBASE_PROJECT_ID` vale `aibrasper` por defecto). No hace falta ninguna clave de servicio.
+2. Cada cliente (por teléfono) recibe un usuario anónimo de Firebase; la sesión se guarda en SQLite (`sesiones_firebase`). `npm run demo:reset -- <teléfono> --cliente-nuevo` la olvida para repetir el recorrido de un cliente nuevo.
+3. `npm run contrato` repite contra el proyecto real las llamadas seguras (usuario anónimo, `getRates`, `createQuote`, lecturas que dan 403) y compara la forma con la del servidor falso de las pruebas. No crea órdenes y borra su usuario.
+4. `GET /health/backend` indica el modo y, en real, si `getRates` responde; `npm run preflight` lo incluye.
+5. El vigilante revisa cada ~20 s las órdenes abiertas (1 por minuto pasados 10 min; hasta 7 días): al aprobarse avisa al cliente, al rechazarse avisa el motivo y abre un ticket con una persona, y cuando la factura está aceptada envía el recibo en PDF real (`getReceipt`). Un aviso solo se marca como enviado si salió.
+6. Las órdenes de prueba creadas contra el proyecto real no se pueden borrar desde el bot (las reglas lo impiden); el repositorio del equipo tiene `functions/scripts/reset-test-data.mjs`.
+
+Privacidad: el nombre, documento, correo y cuentas del cliente solo viajan a Firebase; en SQLite y en el registro quedan el teléfono enmascarado, los ids y los últimos 4 dígitos. El comprobante PDF propio y `COMPROBANTE_ENTREGA` solo se usan en modo simulado.
+
 ## Botones y listas
 
 Resultado de H0 (`docs/h0-hallazgos.md`): con el motor **NOWEB** y un número personal solo llegan las **listas** de WhatsApp; los botones de respuesta y el botón de enlace devuelven 201 pero no se entregan, y WEBJS responde 501. Por eso el motor por defecto es NOWEB y `WAHA_INTERACTIVOS` en `waha/.env` tiene dos modos:
```

- [ ] **Step 5: Ver que pasan, y la suite completa**

Run: `node --test waha/test/ensamblar.test.js waha/test/config.test.js waha/test/demo.test.js waha/test/server.test.js`
Expected: PASS, 0 fallos
Run: `npm --prefix waha test`
Expected: PASS: 246 pruebas, 0 fallos
Run: `npm --prefix kapso test`
Expected: PASS: 58 pruebas, 0 fallos (kapso/ no se modificó)

- [ ] **Step 6: Comprobar que el script de contrato carga**

Run: `node --check waha/scripts/contrato.js`
Expected: sin salida (sintaxis válida); la ejecución real es la tarea 10

- [ ] **Commit**

```bash
git add waha/src waha/scripts waha/test waha/package.json waha/.env.example waha/docker-compose.yml waha/README.md
git commit -m "feat(waha): BACKEND=real|simulado, ensamblado, /health/backend, contrato, demo:reset --cliente-nuevo y documentación

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 10: Hitos reales H1 a H5 con David (⚑ pruebas contra el proyecto `aibrasper`)

**Files:** ninguno nuevo; solo `waha/.env` (ignorado por git) y, si algo falla, correcciones con su prueba.

**Interfaces:**
- Consumes: todo lo anterior con `BACKEND=real`.
- Produces: la declaración, por hito, de lo que se **verificó en vivo** y lo que quedó **sin verificar**.

Cada hito escribe en la base real de pruebas de la hackathon; **cada uno necesita la autorización explícita de David antes de ejecutarse** (la autorización de uno no vale para el siguiente). Las órdenes de prueba no se pueden borrar desde el bot: serán pocas, con el nombre "Prueba WhatsApp"; el equipo puede limpiarlas con `functions/scripts/reset-test-data.mjs` del repositorio `binnicordova/iathon-fintech`. Si algo falla en vivo: reproducirlo, escribir primero la prueba que lo cubre contra el falso, corregir y repetir; nunca se tocan las reglas ni el backend del equipo.

- [ ] **Step 1: Preparación (sin escribir en la base)**

  1. En `waha/.env` pon `BACKEND=real` y `FIREBASE_API_KEY=<clave web pública>` (David la tiene; no se imprime ni se commitea).
  2. `npm --prefix waha run contrato` → Expected: todas las líneas con ✔ (usuario anónimo, `getRates`, `createQuote`, monto inválido, lecturas 403, usuario borrado). **Es la única comprobación que crea y borra un usuario anónimo**; si alguna línea falla, corrige primero el falso o el bot (el contrato cambió).
  3. Reinicia el servidor con la ruta absoluta (`node <repo>/waha/src/main.js`) y ejecuta `npm --prefix waha run preflight` → Expected: la línea "El backend de Firebase responde" con ✔ y `Backend: real`.

- [ ] **Step 2: H1 ⚑ Cotizar por WhatsApp contra el proyecto real (no crea orden)**

  Desde el teléfono de prueba escribe "Hola, quiero enviar 500 reales a Perú". Expected: el mensaje de la cotización con tasa, comisión más impuesto, total, monto que recibe y la vigencia en hora de Lima y 12 h (a. m. / p. m.); `createQuote` tarda ~3 s la primera vez. Anota la latencia. No hay orden creada.

- [ ] **Step 3: H2 ⚑ Datos y `createOrder` (crea una orden de prueba real)**

  Continúa con un cliente de prueba ("Prueba WhatsApp"), documento y correo ficticios válidos, y cuentas de demostración. Confirma. Expected: el mensaje con "Tu operación es BR-000N" y la cuenta de pago del backend; en el panel del equipo la orden aparece `pending` con canal `whatsapp`. Repite con `npm --prefix waha run demo:reset -- <teléfono>` (cliente que vuelve: confirma datos y cuentas guardadas) y con `--cliente-nuevo`.

- [ ] **Step 4: H3 ⚑ Foto real (WAHA → Storage → `submitProof`)**

  Toca "Ya transferí", envía una foto real y escribe un N.º de operación. Expected: la orden pasa a `validating` en el panel y el archivo existe en `proofs/<uid>/<orden>/`. **La descarga de la foto desde WAHA no estaba verificada en vivo:** si `media.url` no llega en el webhook o la ruta no coincide, la prueba lo mostrará; verifica `WAHA_EVENTS_DOWNLOAD_MEDIA` y la ruta de descarga en `waha/src/media.js` y cubre el caso nuevo con una prueba antes de corregir.

- [ ] **Step 5: H4 ⚑ Vigilante y recibo (necesita personal del equipo)**

  Pide a quien tenga rol de personal que apruebe la orden, la exporte y la facture. Expected: el aviso "✅ Pago verificado…" llega solo en ≤ ~20 s tras aprobar; el PDF real llega tras la factura aceptada. Prueba también un rechazo (motivo + ticket). **Si nadie del equipo puede hacerlo, esta parte se declara "no verificada en vivo"** y la demo en video usa el modo simulado.

- [ ] **Step 6: H5 Persona, cancelar y privacidad**

  Verifica "Hablar con persona" (ticket con posición), cancelar una orden `pending` y que el registro (`SELECT * FROM registro`) no contiene documento, correo ni cuentas. Ejecuta `npm --prefix waha run contrato` otra vez. Expected: ✔ en todo.

- [ ] **Step 7: Cierre**

  Revisa `git status` y el diff final; confirma que `waha/.env`, `waha/data/` y `waha/secrets/` no se versionan. Informa a David con COMPLETADO / VALIDACIÓN / SUPOSICIONES / RIESGOS / NEEDS_HUMAN, separando lo verificado en vivo de lo que solo pasó contra el falso. Pendientes que siguen siendo de David: borrar la cuenta de servicio `whatsapp-bot` que creó en Google Cloud (no se usa) y decidir si se versiona `waha/WAHA_Claude_Code_Hackathon_Reference.md`.
