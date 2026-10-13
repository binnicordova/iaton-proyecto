# Flujo de WhatsApp de BrasPer sobre WAHA: diseño

Fecha: 2026-10-13. Estado: diseño aprobado por David en conversación; pendiente de su revisión escrita.
Depende de: `2026-10-11-brasper-whatsapp-flow-design.md` (el flujo y sus reglas no cambian) y de `waha/WAHA_Claude_Code_Hackathon_Reference.md` (referencia de la pila).

## 1. Objetivo y alcance

Ejecutar el **mismo flujo de pasos fijos** de BrasPer (cotizar, datos, pago y constancia, estado) sobre **WAHA** en vez de Kapso + API oficial de Meta, para eliminar el costo por mensaje de Meta en la demo y la presentación del hackathon. Se conserva una **capa de proveedor** para volver a la API oficial de Meta después, sin reescribir el producto (opción C acordada, con alcance de demo).

Motivo: con 200 conversaciones al día y 30 % de conversión, Meta cobra ~US$942 al mes de ~US$971 (97 %). Ver `presentacion/proyecto/costos/costos.md`.

Dentro del alcance: servidor Node, intérprete de los grafos existentes, proveedor WAHA, extracción con IA, estado en SQLite, seguridad y operación de la demo.
Fuera del alcance: flujo de facturación, código de Meta Cloud (solo la interfaz), varias sesiones de WhatsApp, mensajería masiva.

## 2. Decisiones acordadas

| Decisión | Elegido |
|---|---|
| Para qué se usa | Demo y presentación, con proveedor intercambiable (opción C, alcance de A) |
| Número | Dedicado, de WhatsApp personal (no Business); enlazado a WAHA por QR |
| Lenguaje | Node.js (reutiliza `brasper-api.js` y sus 57 pruebas) |
| Motor del flujo | Intérprete de los grafos existentes (enfoque A) |
| Botones y listas | Nativos de WAHA si funcionan; si no, menú de texto numerado, sin cambiar el grafo |
| Motor de WhatsApp en WAHA | WEBJS por defecto; NOWEB se prueba en H0 por la duda de los botones |

## 3. Arquitectura

```
Teléfono ⇄ WAHA (Docker, 127.0.0.1) ──webhook con HMAC──▶ Servidor Node (127.0.0.1)
                                                            ├─ Motor de flujo (intérprete)
                                                            ├─ Estado (SQLite)
                                                            ├─ brasper-api.js (en el mismo proceso)
                                                            └─ Proveedor de WhatsApp (interfaz)
                                                                ├─ WahaProvider        (hoy)
                                                                └─ MetaCloudProvider   (futuro, sin código)
```

Estructura de carpetas (en `waha/`):

```
waha/
├── docker-compose.yml  .env.example  .gitignore  package.json  README.md
├── src/
│   ├── server.js        webhook, /health/whatsapp, endpoint interno de avisos (E4)
│   ├── config.js
│   ├── webhook/         hmac.js, normalizar.js
│   ├── provider/        interfaz.js, waha.js, menu-texto.js
│   ├── motor/           interprete.js, plantillas.js, cola.js
│   ├── estado/          db.js, kv.js
│   ├── ia/              extraccion.js
│   └── scripts/         preflight, demo-reset, demo-seed
├── test/                unitarias, motor, paridad, integración
└── fixtures/waha/       eventos de ejemplo firmados
```

El motor **no copia** código de `kapso/`: importa los grafos de `kapso/build/workflows.js` (objetos `Flow` en memoria, antes de `definition()`) y la API simulada de `kapso/functions/brasper-api.js`. Una sola fuente de verdad.

## 4. Motor de flujo

Ejecuta los 10 tipos de nodo de los grafos actuales:

| Nodo | Comportamiento |
|---|---|
| `start` | Entrada de cada workflow. |
| `set_variable` | Escribe en `vars` (tipos `string`, `float`), resolviendo `{{vars.x}}`. |
| `function` | Llama al handler con `vars.api_action`; mezcla las variables devueltas; las guarda en `save_response_to` si existe. |
| `decide` | Como `function`; el `next_edge` devuelto elige la arista por etiqueta. Una etiqueta inexistente es un error visible. |
| `send_text`, `send_interactive` | Renderiza plantillas y envía por el proveedor. |
| `wait_for_response` | Guarda `(workflow, nodo, vars)` en SQLite y detiene la ejecución; el siguiente mensaje de ese teléfono la reanuda y deja el texto o el id de la opción en `save_response_to`. |
| `call` | Apila el workflow hijo y vuelve al padre al terminar (W0 encadena E1, E2, E3). |
| `handoff` | Marca la conversación como escalada y detiene la ejecución. |
| `agent` | Ver sección 6. |

Contrato con `brasper-api.js` (se llama con un `Request` y un `env.KV` respaldado por SQLite, sin modificar el archivo): cuerpo `{ execution_context: {vars}, vars, available_edges, phone, whatsapp_context }`, respuesta `{ vars, next_edge }`. `env.KV` debe ofrecer `get(k, 'json')`, `put(k, string)` y `delete(k)`. El motor construye `whatsapp_context.messages` con el último mensaje entrante: `direction: 'inbound'`, `reply_option_id`, `has_media`, `message_type`, `whatsapp_message_id`, `id` (campos que leen `route_reply` y `media`).

Reglas:
- Una cola por teléfono: un mensaje a la vez.
- W0 enruta cada mensaje sin ejecución en espera según el estado de la operación (E1, E3, estado, escalada).
- E4 se arranca con un endpoint interno del servidor, en lugar del disparador de Kapso; la ventana de 23 h la decide el handler.
- Al cargar, aplica `validar()` y se niega a arrancar con un grafo inconsistente.
- Máximo de pasos por mensaje; al superarlo, escala a persona.
- Ningún grafo usa esperas con tiempo; no se construyen temporizadores.

## 5. Proveedor de WhatsApp

Interfaz: `enviarTexto`, `enviarBotones` (hasta 3), `enviarLista` (hasta 10 filas), `enviarEnlace`, `marcarLeido`.

`WahaProvider` usa `/api/sendText`, `/api/sendButtons`, `/api/sendList` y `/api/sendSeen`. El botón de enlace usa el tipo `url` de `sendButtons`, o texto con la URL si no se muestra.

Interactivos: la variable `WAHA_INTERACTIVOS` vale `nativo` o `texto`.
- `nativo`: la respuesta llega con el id del botón o fila.
- `texto`: las opciones salen numeradas ("1. Sí, esa"). El motor guarda las opciones del último menú y acepta el número o el título exacto (sin distinguir mayúsculas ni tildes), y lo traduce al mismo `reply_option_id`. Un texto que no calza sigue el camino existente de respuesta inválida y, a la segunda vez, de persona.
- No hay detección automática: WAHA no devuelve error si el cliente no ve los botones. El valor lo fija el hito H0.

Otros detalles:
- Normalización de identificadores (`51…@c.us` y `…@lid`) a solo dígitos, conservando el id original para responder.
- Fotos del comprobante: se normalizan `tieneMedia` y el id; no se descarga el archivo.
- Cada envío espera al anterior, con una pausa corta, para conservar el orden.
- Reintentos con espera creciente solo para fallos de red y 5xx. Sin reintento para 4xx ni para los errores 463 y 475 de WhatsApp (restricciones de contacto y de cuota): se registran y la conversación queda pendiente.

## 6. IA y estado

**Extracción (nodo `agent` de E1).** Una sola llamada a la API de Anthropic (`claude-haiku-5-5`, temperatura 0) con una herramienta `guardar_datos` de esquema cerrado: `monto` (número positivo), `moneda_origen` y `moneda_destino` (`BRL`, `PEN`, `USD`). Sin otras herramientas ni acceso a WAHA, estado o red. La salida se revalida con `parseMonto` y `normMoneda`.
- Ante fallo, demora (unos segundos) o falta de clave, devuelve "datos incompletos" y el flujo sigue por su camino actual de preguntar paso a paso. El cliente nunca queda sin respuesta.
- La clave `ANTHROPIC_API_KEY` va en `.env`; la aporta David.
- Costo estimado (no medido): ~600 tokens de entrada y ~100 de salida, ~US$0.0001 por conversación.

**Estado (SQLite, modo WAL).**

| Tabla | Guarda |
|---|---|
| `conversaciones` | Por teléfono: pila de workflows con nodo actual, `vars`, si espera, opciones del último menú |
| `eventos_vistos` | Id de evento y de mensaje, con fecha para limpiar (idempotencia) |
| `kv` | Clave, valor y vencimiento (el `env.KV` de `brasper-api.js`) |
| `registro` | Id de mensaje, sentido, tipo, estado de envío y latencia; **sin texto de mensajes** |

`demo-reset` y `demo-seed` (incluida `cuentas:2`) pasan a ser scripts de npm que llaman al mismo handler.

## 7. Seguridad y operación

- WAHA y el servidor escuchan solo en `127.0.0.1`. Nada se expone a Internet; en compose se hablan por nombre de servicio.
- Cinco secretos distintos en `.env` (administración de WAHA, MCP, panel, HMAC, Anthropic). Fuera de git: `.env`, `.sessions/`, `*.db`.
- Receptor de webhooks, en orden: límite de tamaño, HMAC SHA-512 sobre el cuerpo crudo con comparación en tiempo constante, lista de eventos permitidos (`message`, `session.status`), descarte de `fromMe` y de origen `api`, idempotencia, respuesta 200 inmediata y proceso en la cola.
- Solo se responde a quien escribió primero. El único envío por iniciativa propia es el aviso E4, dentro de la ventana de 23 h. Sin envíos masivos. Sin reiniciar, cerrar sesión ni volver a vincular de forma automática.
- MCP de WAHA solo para desarrollo, con una app de MCP de la sesión y permisos de solo lectura; nunca la clave de administración ni los permisos `send`, `control`, `setting`, `app`, `delete`. Queda apagado hasta que David lo pida.
- Registros: id, sesión, tipo, chat enmascarado, latencias, reintentos; nunca el texto.
- `GET /health/whatsapp` (WAHA alcanzable, sesión `WORKING`); al arrancar solo comprueba y avisa. `npm run preflight` ejecuta la lista previa a la demo.
- Respaldo: el flujo sigue sin IA; la presentación usa video grabado de la operación completa.
- Se documenta que la vía no es oficial y que el proveedor de Meta es el camino de producción.

## 8. Pruebas e hitos

Pruebas:
- Las 57 existentes de `brasper-api` y las de grafos, sin cambios.
- Unitarias nuevas: HMAC, normalización, plantillas, análisis del menú de texto, adaptador `kv`, reintentos del proveedor.
- Motor: cada tipo de nodo; rechazo de grafos que `validar()` no acepte.
- Paridad con Kapso: los criterios de aceptación 1 a 9 de `docs/superpowers/findings/2026-10-12-acceptance.md` sobre el motor con un proveedor falso, con la misma secuencia y textos; una operación completa produce 13 mensajes salientes.
- Integración: webhook firmado produce un solo envío; evento repetido, ninguno extra; WAHA caído; IA caída.
- Manual con el número real: recorrido completo y casos de handoff.

| Hito | Entrega | Verificación |
|---|---|---|
| H0. Prueba de interactivos | WAHA en Docker, número enlazado; texto, botones, lista y botón de enlace con WEBJS y NOWEB | Se ve en el teléfono; fija `WAHA_INTERACTIVOS` y el motor. Desechable, con su propia aprobación |
| H1. Transporte | Compose, webhook con HMAC, normalización, idempotencia, proveedor, eco | Integración y un mensaje real |
| H2. Motor y estado | Intérprete, SQLite, W0 con E1 a E4 | Pruebas de paridad en verde |
| H3. IA | Extracción con respaldo | Casos válidos, inválidos e inyección |
| H4. E2E real | Operación completa en el número | 13 salientes, sin duplicados, latencia medida |
| H5. Operación | Salud, preflight, README, MCP opcional, guion de grabación | Lista de la referencia |

Terminado cuando: una operación completa por WhatsApp real se comporta como en Kapso, sin duplicados; todas las pruebas pasan; no hay secretos en git; el README describe cómo levantar, reiniciar y limpiar la demo.

## 9. Costo resultante

Meta: US$0 (no se usa la API oficial). IA: unos US$0.0001 por conversación (estimado). Infraestructura: la Mac del equipo. El costo real es el riesgo no oficial (sección 10).

## 10. Suposiciones y riesgos

Suposiciones:
- El número dedicado y de WhatsApp personal está disponible y se puede escanear su QR.
- La documentación de WAHA vigente a 2026-10-13 (release 2026.9.2) describe `sendButtons` y `sendList`; no pude confirmar qué motor los soporta.
- Los tokens de IA son una estimación; se miden en H3.

Riesgos:
1. **WAHA es no oficial.** La referencia (§2) indica que contradice las reglas de WhatsApp; el número puede restringirse. Mitigación: número secundario, solo respuestas, sin masivos, y provider intercambiable. No usar para el canal real de BrasPer.
2. **Botones y listas** pueden no mostrarse con un número personal o con el motor elegido. Mitigación: H0 y el menú de texto.
3. **Diferencias de semántica con Kapso** (variable indefinida en `{{…}}`, evaluación de `decide`). Mitigación: pruebas de paridad.
4. **Cambios rápidos de WAHA.** Se fija la versión de la imagen en compose y se contrasta con el OpenAPI de la imagen en ejecución (fuente de verdad §73 de la referencia).
5. **Datos fuera de la máquina:** el texto que se envía a la IA sale a la API de Anthropic aunque WAHA sea local.
6. La API de BrasPer, las tasas, la cuenta y el cliente siguen siendo ficticios (demo).

## 11. Pendientes por decidir

- Motor definitivo (WEBJS o NOWEB) y valor de `WAHA_INTERACTIVOS`: lo fija H0.
- Que David aporte `ANTHROPIC_API_KEY` y el número a enlazar.
- Si se conecta MCP de WAHA a Claude Code (por defecto, no).
- Los pendientes de producto del spec original (§11) siguen vigentes: correo, Pix, horarios y feriados, límites de monto, listas definitivas, plantillas de Meta, número real.
