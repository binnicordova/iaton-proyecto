# Flujo de WhatsApp de BrasPer sobre el backend real (Firebase): diseño

Fecha: 2026-10-13. Estado: diseño aprobado por David en conversación (6 secciones); pendiente de su revisión escrita.
Depende de: `2026-10-13-brasper-waha-design.md` (servidor, motor y WAHA, ya integrados en `main`) y del backend del equipo: https://github.com/binnicordova/iathon-fintech (`functions/docs/README.md`, `firestore.rules`, `storage.rules`, `functions/src/orders.ts`).

## 1. Objetivo y alcance

Hoy el bot usa una API simulada (`kapso/functions/brasper-api.js`) con tasas inventadas y su propio contador de operaciones. El equipo ya tiene un **backend real** en el proyecto Firebase `aibrasper` (13 funciones callable, Firestore, Storage) pensado para que lo usen la app, un asistente **y un bot de WhatsApp** (existe el canal `whatsapp`). Este diseño hace que el bot sea **un cliente más de ese backend**: cotiza, crea la orden, recibe la foto del comprobante, la sube a Storage, avisa del estado y entrega el recibo real.

Fuera de alcance: reconocer por documento a clientes que compraron por el formulario web (necesita una función nueva en ese backend); portugués e inglés; `assistantGenerate` (Gemma; la extracción con Claude se mantiene); los paneles del personal; la facturación real con SUNAT.

## 2. Decisiones acordadas

| Decisión | Elegido |
|---|---|
| Integración | Completa, por las funciones del backend. No se escribe en Firestore directamente |
| Credenciales | **Ninguna de administrador.** Un usuario anónimo de Firebase por teléfono, con la clave web pública |
| Modos | `BACKEND=real` o `BACKEND=simulado` (el actual, de respaldo) |
| Flujos | Nuevos (v2) en `waha/src/flujos/v2/`; `kapso/` no se toca |
| Base de datos | Proyecto `aibrasper`, **de pruebas** (hackathon), `channel: "whatsapp"` |
| Número de orden | Lo asigna el backend (`counters/orders`); el bot deja de numerar |
| Foto | Se sube a Storage `proofs/<uid>/<orden>/…`; no se guarda localmente |
| Recibo | El PDF real de `getReceipt`; el generador propio queda solo para el modo simulado |

## 3. Hechos verificados (2026-10-13)

Prueba de humo contra el proyecto real, con un usuario anónimo borrado al final:
- `accounts:signUp` anónimo: HTTP 200 (token de 1 h y token de renovación). El login anónimo **está activo**.
- `getRates`: 200 en 0.5 s. Spread 200 bps, comisión 240 bps, impuesto 1800 bps, vigencia de la cotización 15 min, bloqueo de tasa 30 min, límite de 3,000 USD, mínimo de 10 USD.
- `createQuote` BRL→PEN 500 con `channel: "whatsapp"`: 200 en 3.3 s (arranque en frío probable). Tasa 0.6745, comisión 12, impuesto 2.16, total 514.16, recibe 337.25, `requiresHuman: false`.
- Lectura de `clients/{uid}` propio inexistente: 404. Lectura de una orden ajena: 403. Las reglas aíslan a cada cliente.

Reglas del backend (`firestore.rules`, `storage.rules`):
- `orders`, `quotes`, `invoices`, `handoffs`: solo lectura del dueño o del personal; **escritura solo por funciones**.
- `clients/{uid}`: lectura y escritura del propio `uid`, con los campos `clientName, email, docType, docNumber, language, accounts, updatedAt`.
- Storage: `proofs/{uid}/{orderId}/{file}`; el dueño crea (imagen o PDF, menos de 8 MB), nadie modifica ni borra.

Datos de las colecciones (capturas del usuario y `orders.ts`): `orders/BR-000N` con `channel, clientName, commission, createdAt, destinationBank, destinationAccount, docType, docNumber, email, fundsSource, exportBatchId, exportedAt, …`. `clients/{uid}.accounts` es una lista de `{ id: "banco|número", bank, accountNumber, currency }` con **cuentas de origen y de destino** (se distinguen por moneda; se conservan las últimas 12).

## 4. Contrato del backend que usa el bot

Las funciones son callable: `POST https://<nombre-en-minúsculas>-h5wenirx2q-rj.a.run.app`, cuerpo `{"data": {…}}`, cabecera `Authorization: Bearer <idToken>`. Éxito: `{"result": …}`. Error: `{"error": {"status", "message", "details"}}`, donde `message` es el código estable.

| Función | Uso en el bot | Entrada clave | Salida clave |
|---|---|---|---|
| `createQuote` | Cotizar (E1) | `sendCurrency`, `receiveCurrency`, `sendAmount`, `channel: "whatsapp"` | `id`, `rate`, `commission`, `tax`, `total`, `receiveAmount`, `expiresAt`, `requiresHuman` |
| `createOrder` | Crear la orden (E2) | `quoteId`, `language: "es"`, `clientName`, `docType`, `docNumber`, `email`, `fundsSource`, `sourceBank`, `sourceAccount`, `destinationBank`, `destinationAccount` | orden completa con `orderId`, `status: "pending"`, `rateLockedUntil`, `paymentAccount` |
| `submitProof` | Registrar el pago (E3) | `orderId`, `operationNo`, `proofPath` | `{ok}`; la orden pasa a `validating` |
| `cancelOrder` | Cancelar una orden `pending` | `orderId` | `{ok}` |
| `requestHuman` | "Hablar con persona" | `summary`, `orderId?`, `channel: "whatsapp"` | `handoffId`, `position`, `estimatedWaitMinutes` |
| `getQueueInfo` | Posición en la cola (opcional) | `handoffId` | `position`, `status` |
| `getReceipt` | Recibo real | `orderId` | `{filename, contentType, base64}` |

Validaciones de `createOrder` (el bot las replica antes para dar respuesta inmediata; la autoridad es el backend):
- `clientName`: al menos 3 caracteres y un espacio.
- `docType`: `DNI` (8 dígitos), `CE` (9 a 12 alfanuméricos), `RUC` (11 dígitos con prefijo 10, 15, 17 o 20 y dígito verificador), `CPF` (11 dígitos con dígito verificador).
- `email` válido; `fundsSource` ∈ `savings, salary, business, asset_sale, donation, other`.
- `sourceAccount` y `destinationAccount`: al menos 4 caracteres; bancos de hasta 60 caracteres, texto libre.
- `operationNo` de `submitProof`: 4 a 24 letras, dígitos o guion (se guarda en mayúsculas).

Códigos de error y su respuesta en el chat: `requires-human` (pasa a una persona con `requestHuman`); `amount-too-small` (explica el mínimo y repregunta el monto); `quote-expired` (recotiza con los mismos montos y pide confirmar la nueva tasa); `invalid-input` con `details` (repregunta solo el dato que falló); `operation-no-duplicate` (pide revisar el número); `proof-not-uploaded` (pide reenviar la foto); `order-not-pending` (ya se recibió el comprobante); `rates-unavailable`, red caída, timeouts y 5xx (aviso temporal, sin escalar).

## 5. Arquitectura

```
WhatsApp ⇄ WAHA ⇄ Servidor Node ─ Motor (grafos v2) ─ Backend (interfaz)
                        │                               ├─ real      → funciones + Firestore + Storage (aibrasper)
                        │                               └─ simulado  → brasper-api.js (el actual)
                        └─ SQLite: conversaciones, eventos vistos, sesiones de Firebase, seguimientos
```

El motor sigue llamando acciones por nombre con el contrato `({vars, phone, edges, wa}) → {vars, next_edge}`. El backend real las traduce a llamadas HTTP; los grafos v2 usan los mismos tipos de nodo y el mismo constructor `Flow`.

Archivos nuevos en `waha/src/`: `backend/real/{config, sesion, http, funciones, firestore, storage, validadores, mensajes, acciones}.js`, `backend/simulado.js` (hoy `puente-api.js`), `vigilante.js`, `media.js`, `flujos/v2/`. En pruebas: `test/helpers/firebase-falso.js`. Script: `scripts/contrato.js`.

Configuración: `BACKEND`, `FIREBASE_API_KEY` (la clave web pública, en `.env`), proyecto, bucket y plantilla de URLs de las funciones. `/health/backend` y una línea de `preflight` que llama a `getRates`.

## 6. Flujo de conversación

**E1 (cotizar):** el agente extrae monto y monedas como hoy; `createQuote` con `channel: "whatsapp"`. El mensaje muestra tasa, comisión más impuesto, total a transferir, monto que recibe y la vigencia (`expiresAt`, en hora de Lima y 12 h).

**E2 (datos):**
- *Cliente nuevo* (no existe `clients/{uid}`): nombre y apellido; tipo de documento (lista de 4); número de documento (validado); correo.
- *Cliente que vuelve*: "Usaremos tu DNI 12345678 y tu correo a***@gmail.com. ¿Es correcto?" con Sí / Cambiar mis datos.
- *Siempre*: origen de fondos (lista de 6: Ahorros → `savings`, Sueldo → `salary`, Negocio propio → `business`, Venta de un bien → `asset_sale`, Donación → `donation`, Otro → `other`); cuenta de origen y cuenta de destino (lista con las cuentas guardadas de esa moneda más "Otra cuenta"; si no hay, lista de bancos y luego el número; "Otro" banco = el cliente escribe el nombre); resumen y confirmación (Confirmar / Cambiar datos / Cancelar).
- `createOrder` y a E3. Idioma fijo en español.

**E3 (pago):** muestra `paymentAccount` y el total, con "Ya transferí" y "Cancelar" (`cancelOrder`). Si la orden vence su bloqueo de tasa (`rateLockedUntil`) antes de que el cliente transfiera, se avisa y una persona confirma, como hoy.

**Foto y registro:** tras "Ya transferí" se pide la foto (imagen o PDF de hasta 8 MB). Al llegar se baja de WAHA y se sube de inmediato a `proofs/<uid>/<orden>/proof-1.<ext>` con el token del cliente. Luego se pide el N.º de operación y se llama a `submitProof`. La orden pasa a `validating` y el cliente lee que una persona validará su pago.

**Descarga de la foto desde WAHA:** de `payload.media.url` (se baja con `GET /api/files/<archivo>` y la clave de WAHA), o pidiendo el mensaje con `GET /api/{session}/chats/{chatId}/messages/{messageId}?downloadMedia=true`. `WAHA_EVENTS_DOWNLOAD_MEDIA=true` explícito en el compose. **No verificado todavía en vivo.**

**Seguimiento (vigilante):** una tabla `seguimientos` en SQLite (orden, teléfono, chat, último estado) y un ciclo que lee `orders/{id}` con el token de cada cliente cada ~20 s (cada 60 s pasados 10 minutos) mientras la orden esté abierta. Avisos: `approved` → "✅ Pago verificado…"; `rejected` → motivo (`rejectionReason`) y ticket con `requestHuman`; `exported` con factura aceptada → `getReceipt` y envío del PDF como documento; `cancelled` → fin. Un aviso se marca como enviado solo si salió; si el cliente está en otra conversación, se reintenta. Persiste a reinicios; termina en un estado final o a los 7 días. Con WAHA no se aplica la ventana de 23 h (la interfaz del proveedor la reintroduce para la API oficial).

**"Hablar con persona":** `requestHuman` con un resumen de lo recogido; responde posición y espera estimada.

## 7. Sesión de Firebase, errores y seguridad

**Sesión por teléfono:** tabla `sesiones_firebase` (teléfono, `uid`, token de renovación, token actual, vencimiento). El usuario anónimo se crea en la primera cotización. El token de 1 h se renueva con `securetoken.googleapis.com` cuando le quedan menos de 5 minutos, con una cola por teléfono. Si el usuario ya no existe se crea otro (el cliente pierde su perfil y sus órdenes anteriores). `demo:reset` conserva el `uid`; `demo:reset --cliente-nuevo` lo olvida.

**Errores de transporte** (red, timeout de 15 s, 5xx): no se escala ni se pierde la conversación; se avisa al cliente ("problema temporal, intenta de nuevo") y el estado queda en el paso que falló. `createQuote` y las lecturas se reintentan una vez. `createOrder` **no se reintenta a ciegas**: ante un resultado dudoso se consultan las órdenes propias por `quoteId`. `submitProof` con `order-not-pending` se trata como éxito si la orden ya está en `validating`.

**Seguridad y datos personales:**
- Sin credenciales de administrador en ningún lado. La clave web es pública; los permisos los imponen las reglas del proyecto.
- El token de renovación se guarda en SQLite con permisos 600 y nunca en registros ni en mensajes de error (los errores no incluyen la URL: la de `signUp` lleva la clave).
- Registros: ids de orden, estados, latencias y teléfonos enmascarados; **nunca** documento, correo, número de cuenta ni el contenido de la foto.
- Minimización: tras un `createOrder` exitoso se borran de `vars` los datos personales (el backend ya los guarda en `clients/{uid}`), y se deja de persistir el texto de los últimos mensajes del cliente.
- Texto libre (nombre, banco, cuenta) recortado y limpiado; nunca se vuelve a interpretar como plantilla.
- El vigilante hace ~3 lecturas por minuto por orden abierta al principio; con 100 órdenes, ~4,000 lecturas al día, dentro de la capa gratuita.

## 8. Pruebas

**Servidor Firebase falso** (`test/helpers/firebase-falso.js`), en el mismo proceso: imita Identity Toolkit (alta anónima y renovación), las funciones del contrato con sus validaciones y códigos de error, lecturas REST de `orders/{id}` y `clients/{uid}` con la regla de dueño (403), la consulta por `quoteId`, la subida a Storage con sus límites (8 MB, imagen o PDF, carpeta del propio `uid`), inyección de fallos y acciones de personal simulado (aprobar, rechazar, exportar, facturar).

Niveles:
1. **Unitarias:** validadores (DNI, CE, RUC, CPF, correo, N.º de operación), renovación de tokens, traducción de errores, decodificación de los valores tipados de Firestore.
2. **Adaptador contra el falso:** cada acción con sus errores; token vencido; usuario borrado; `createOrder` con timeout reconciliado sin duplicar; `submitProof` con `order-not-pending`.
3. **Escenarios completos con los grafos v2:** cliente nuevo hasta `validating`; cliente que vuelve con cuentas guardadas; `quote-expired`, `requires-human`, monto mínimo; N.º de operación duplicado y foto que no se sube; backend caído a mitad del flujo; vigilante (aprobación, rechazo con ticket, recibo como PDF, reinicio con seguimiento persistido, aviso aplazado); datos personales borrados tras `createOrder` y ausentes de los registros.
4. **Servidor:** bajar una foto de un WAHA de prueba y subirla al Storage falso.

`BACKEND=simulado` mantiene los grafos actuales y todas las pruebas de hoy (113 en `waha/` y 58 en `kapso/` en `main`).

**Contra el desvío del falso:** `npm run contrato` repite contra el proyecto real las llamadas seguras de la prueba de humo (usuario anónimo, `getRates`, `createQuote`, y las lecturas que deben dar 403) y comprueba que las respuestas tengan la misma forma que las del falso; no crea órdenes.

## 9. Hitos

| Hito | Entrega |
|---|---|
| H1 | Sesión de Firebase y cotización real en E1 v2. ⚑ Cotizar por WhatsApp contra el proyecto real (no crea orden) |
| H2 | E2 v2 (datos, cuentas guardadas, confirmación) y `createOrder` con la cuenta de pago. ⚑ Crea una orden de prueba real |
| H3 | Foto: WAHA → Storage → `submitProof`. ⚑ Foto real; la orden pasa a `validating` en el panel del equipo |
| H4 | Vigilante, avisos y recibo real. ⚑ Con el equipo aprobando, exportando y facturando |
| H5 | `requestHuman`, `cancelOrder`, limpieza de datos personales, `npm run contrato`, README y `preflight` |

Las órdenes de las pruebas reales no se pueden borrar desde el bot (las reglas lo impiden): serán pocas, con el nombre "Prueba WhatsApp", y el equipo puede limpiarlas con `functions/scripts/reset-test-data.mjs`. Si nadie del equipo puede aprobar en H4, esa parte queda declarada como **no verificada en vivo**.

## 10. Suposiciones y riesgos

- La descarga de fotos de WAHA está documentada y **sin verificar en vivo** (H3).
- **App Check:** si se activa la exigencia en el proyecto, el bot queda bloqueado. Hoy la consola solo lo sugiere.
- **Limpieza de usuarios anónimos** (a los 30 días, si la activan): los clientes que vuelven perderían su perfil.
- `createQuote` tarda ~3 s en frío; el chat se sentirá lento en la primera cotización.
- El falso puede desviarse de la realidad; lo cubren `npm run contrato` y las pruebas reales.
- El backend es de otro integrante del equipo; si cambia su contrato o su región, hay que actualizar el bot.
- Un cliente que ya compró por el formulario web tiene otro `uid` y no se reconoce por documento.
- Los datos de la base son de pruebas de la hackathon (confirmado por David); no se debe apuntar el bot a una base de producción sin una revisión aparte.

## 11. Pendientes por decidir

- Si se pide a quien mantiene el backend una función nueva para buscar un cliente por documento (reconocimiento entre canales).
- Quién del equipo aprueba, exporta y factura las órdenes de prueba en H4, y cuándo.
- La cuenta de servicio `whatsapp-bot` que David creó en Google Cloud no se usa: debe borrarse.
- Versionar `waha/WAHA_Claude_Code_Hackathon_Reference.md`, que el spec de WAHA cita y que sigue sin estar en git.
