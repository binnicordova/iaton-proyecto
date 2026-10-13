# Flujo de WhatsApp de BrasPer: spec de diseño

- **Fecha:** 2026-10-11
- **Estado:** borrador para revisión
- **Diseño visual aprobado:** https://www.figma.com/design/tymrlM4tRU7O3dztzAN9QV (3 páginas: arquitectura, chat por etapa, contratos y pendientes)
- **Referencias de origen:** `reference/explore.html`, `reference/workflow_brasper_2.jpeg`, `reference/web_app_forms.jpeg`, `reference/kambista-benchmark.html`

## 1. Objetivo y alcance

Construir en Kapso el flujo de WhatsApp que lleva a un cliente de BrasPer desde una consulta hasta una operación de envío registrada, con comprobante recibido y aviso de pago verificado. Los pasos son fijos y deterministas. Un agente conversacional se conecta después, en una fase posterior.

**Dentro del alcance**
- Un enrutador (W0) y cuatro workflows de etapa (E1 Cotiza, E2 Datos, E3 Pago y constancia, E4 Estado).
- Una API simulada con Kapso Functions para la demo, con el contrato que tendrá el backend real.
- El aviso de pago verificado, disparado a mano en la demo.

**Fuera del alcance**
- El backend y la BD reales de BrasPer, el dashboard del operador de banco y el script de facturación.
- El formulario web y la app a los que apuntan los botones de enlace.
- El agente conversacional (fase posterior).
- Telegram y Discord.

## 2. Decisiones cerradas

| # | Decisión |
|---|---|
| 1 | Los datos se diseñan contra la API futura de BrasPer. En Kapso se simulan con funciones de prueba. |
| 2 | Los pasos 1 a 4 son rígidos: si la respuesta no es válida se repite la pregunta y, tras 2 fallos seguidos, se pasa a una persona. El agente entra solo después de E4. |
| 3 | En el primer mensaje libre, la IA solo extrae monto, moneda de origen y moneda de destino. Si falla, se usa un menú con botones. |
| 4 | Los botones de formulario web y de app son enlaces que llevan la cotización cargada. |
| 5 | El aviso de pago verificado lo inicia el backend con un trigger `api_call`. En la demo se envía como texto libre y se dispara a mano. En producción, fuera de la ventana de 24 h, se usará una plantilla de Meta. |
| 6 | Cuenta de origen: solo el banco, por lista. Cuenta de destino: cuentas guardadas. Cuenta nueva: mini-flujo en el chat con respaldo al formulario web. |
| 7 | Estructura: un workflow por etapa más un enrutador que lee el estado de la operación. |
| 8 | Los campos son los del formulario web: DNI/CPF, origen de fondos, banco de origen, cuenta destino, N° de operación bancaria y foto del comprobante. Se mantienen el aviso fuera de horario y Cancelar operación. |

## 3. Arquitectura

```
Mensaje entrante ──► W0 Enrutador ──get_status──► decide por estado
                                                    │
        ┌───────────────┬───────────────────────────┼──────────────────┐
        ▼               ▼                           ▼                  ▼
   E1 Cotiza       E2 Datos               E3 Pago y constancia     E4 Estado
                                                                       ▲
                       Backend (simulado en la demo) ── api_call ──────┘
```

- **W0 Enrutador:** trigger `inbound_message` del número de WhatsApp. Llama a `get_status(teléfono)` y deriva con un nodo `call` a la etapa que corresponde.
- **E1 a E3:** workflows con nodos `send_interactive`, `wait_for_response`, `function`, `decide` y `handoff`.
- **E4:** workflow con trigger `api_call`, iniciado por el backend. Decide por la ventana de 24 h.
- **Fase posterior:** un nodo `agent` conectado tras E4, con herramientas de solo lectura.

La IA interviene en un único punto: la extracción de monto y monedas en E1. Todo texto con tasas, comisiones, montos y cuentas lo entrega una herramienta de la API, nunca el modelo.

## 4. Estados de la operación (propuesta)

| Estado | Lo fija | Etapa que atiende |
|---|---|---|
| `cotizada` | Kapso (E1) | E1, luego E2 |
| `pendiente` | Backend, al crear la operación (E2) | E3 |
| `esperando_transferencia` | Backend, al mostrar la cuenta de BrasPer (E3) | E3 |
| `en_validacion` | Backend, al guardar foto y N° (E3) | E4 |
| `verificada` | Operador de banco | E4 |
| `enviada` / `completada` | Backend | E4 |
| `cancelada` | Cliente en E3, o tasa vencida sin continuar | ninguna |
| `escalada` | `handoff_to_human` | Persona |

Los nombres de estado deben alinearse con quien construya el backend. Mientras tanto son los de este spec.

## 5. Especificación por etapa

Los textos entre llaves `{...}` los entrega una herramienta de la API.

### E1 Cotiza

- **Entrada:** texto libre ("Hola, quiero enviar 500 reales a Perú") o cualquier otro mensaje.
- **Flujo:** un nodo `agent` extrae monto, moneda de origen y moneda de destino. Luego `function get_rate_quote` y un `send_interactive` con la cotización.
- **Mensaje:** "¡Hola! Hoy 1 BRL = {tasa} PEN. Comisión {comision}. Recibirás {recibe} PEN. Tasa asegurada hasta las {hora}."
- **Botones de respuesta (máximo 3, título de hasta 20 caracteres):** Continuar, Cambiar monto, Hablar con persona.
- **Enlaces:** un mensaje `cta_url` aparte por canal alternativo, porque cada `cta_url` admite un solo botón. Botón "Abrir formulario web" (20 caracteres). La web aún no admite la cotización por parámetros: abre la calculadora. El enlace a la app se agrega cuando exista su URL.
- **Respaldo:** si la extracción no obtiene los tres datos, botones de moneda de origen, moneda de destino y un monto en texto. Monto inválido: se repite la pregunta.
- **Escala a persona:** 2 fallos seguidos, o `get_rate_quote` sin respuesta ("Ahora no puedo cotizar con seguridad. Te paso con una persona del equipo para ayudarte.").
- **Salida:** estado `cotizada`; Continuar lleva a E2.

### E2 Datos

Una pregunta por mensaje, en este orden:

1. DNI o CPF. Se valida el formato (DNI 8 dígitos, CPF 11, a confirmar con el backend).
2. Origen de fondos, con las opciones de la imagen 2 (Ahorros, Venta de un bien, Otro). La lista definitiva está pendiente.
3. Banco de origen, con una lista de WhatsApp filtrada por la moneda que envía el cliente (acción `route_moneda`), con "Otro" al final. BRL: Banco do Brasil, Itaú, Bradesco, Nubank, Caixa. PEN: BCP, Interbank, BBVA, Scotiabank. USD: los de Perú y Brasil sin Caixa. Solo el banco, sin número de cuenta.
4. Cuenta de destino. Con `get_client` y `list_accounts`: "Tengo guardada tu cuenta Banco ••9956. ¿Recibes ahí? Debe estar a tu nombre." con Sí, esa / Otra cuenta.

**Cuenta nueva:** lista de banco, número de cuenta en texto, confirmación enmascarada ("Confirmo: Banco {banco} ••4821. ¿Está a tu nombre?") con Sí, guardar / Corregir, y luego `save_account`. Si el banco es "Otro" o hay 2 intentos inválidos, se envía un botón con enlace al formulario web para agregarla y volver al chat.

- **Escala a persona:** 2 fallos seguidos en cualquier campo.
- **Salida:** `create_operation` devuelve el id BR-{id} y estado `pendiente`.

### E3 Pago y constancia

- **Cuenta de BrasPer:** `get_company_account(moneda, banco de origen)`. Mensaje: "Transfiere {monto} BRL a: Titular: BrasPer, Banco: {banco}, Cuenta: {cuenta}. Usa la cuenta de BRL, no otra moneda. Tasa asegurada hasta las {hora}."
- **Fuera de horario:** si `check_hours` indica cerrado, se agrega "Fuera de horario: tu operación se verificará {día} a las {hora}."
- **Botones:** Ya transferí, Cancelar operación.
- **Constancia:** tras "Ya transferí" se pide la foto y el N° de operación bancaria. `attach_proof` los guarda. El asistente no lee ni evalúa la foto. Si llega solo texto, repite la petición; 2 fallos pasan a persona.
- **Cierre:** "Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo." El estado pasa a `en_validacion`.
- **Cancelar:** confirmación Sí, cancelar / Continuar y luego `cancel_operation`.
- **Tasa vencida:** antes de transferir, recotiza y pide confirmar. Si el cliente no continúa, la operación pasa a `cancelada`.

### E4 Estado

- **Disparo:** el backend inicia el workflow con el ID de la operación y el teléfono. En la demo se inicia a mano.
- **Decisión:** ventana de 24 h abierta, texto libre. Cerrada, plantilla de Meta (solo producción).
- **Mensajes:** "✅ Pago verificado. Enviamos tu dinero a la cuenta ••9956." y "¡Listo! Recibiste {recibe} PEN. Te enviamos tu comprobante por correo."
- **Pago no validado (por confirmar):** "No pudimos validar tu pago de la operación BR-{id}. Una persona del equipo te contactará." y handoff.
- **Consulta o problema:** botón "Hablar con persona" y `handoff` con el resumen. El texto libre abierto lo atiende una persona hasta que exista el agente.

## 6. Contrato de la API

| Herramienta | Entrada | Salida | Etapa |
|---|---|---|---|
| `get_rate_quote` | monto, moneda origen, moneda destino | tasa, comisión, total a recibir, tasa asegurada hasta | E1, E3 |
| `check_hours` | fecha y hora actual | abierto o cerrado, próxima verificación | E3 |
| `get_status` | teléfono u operación | estado y etapa de la operación activa | W0 |
| `get_client` | teléfono | cliente existente o no, cuentas guardadas, correo | W0, E2 |
| `list_accounts` | cliente, moneda | alias, banco y últimos 4 dígitos | E2 |
| `save_account` | cliente, banco, número de cuenta, moneda | id de cuenta | E2 |
| `create_operation` | cliente, DNI/CPF, origen de fondos, banco origen, cuenta destino, cotización | id BR-…, estado `pendiente` | E2 |
| `get_company_account` | moneda, banco de origen | titular, banco, número de cuenta | E3 |
| `attach_proof` | operación, foto, N° de operación bancaria | estado `en_validacion` | E3 |
| `cancel_operation` | operación | estado `cancelada` | E3 |
| `handoff_to_human` | motivo, resumen, operación | persona o ticket asignado | todas |

**Eventos del backend hacia Kapso** (trigger `api_call` del workflow E4): `payment_verified`, `payment_sent` y `payment_rejected` (por confirmar). Cada uno lleva id de operación y teléfono, más monto, moneda y últimos 4 dígitos según el caso.

## 7. Demo frente a producción

| Aspecto | Demo | Producción |
|---|---|---|
| API | Una Kapso Function (Cloudflare Worker) que persiste en `env.DB` (D1) o `env.KV`. Tasas y horarios de demostración, rotulados como tales. | Backend de BrasPer. Solo cambia el destino de las llamadas. |
| Cuenta de BrasPer | Datos ficticios rotulados "DEMO". Nunca cuentas reales. | `get_company_account` real. |
| Datos del cliente | Solo datos de prueba. DNI/CPF y números de cuenta de prueba, sin personas reales. | Datos reales bajo las políticas de BrasPer. |
| Aviso de pago | Se inicia el workflow E4 a mano. Texto libre. | El backend llama al trigger. Plantilla fuera de la ventana de 24 h. |
| Número | Sandbox de Kapso (solo conversa con números unidos). | Número de producción. |

## 8. Restricciones de plataforma

**Verificadas en la documentación de Kapso y de Meta (2026-10-11)**
- Los botones de respuesta admiten como máximo 3. Las listas admiten hasta 10 filas. `cta_url` admite un solo botón por mensaje.
- El texto libre solo se puede enviar dentro de las 24 horas posteriores al último mensaje del cliente. Observado en el sandbox: el envío fuera de la ventana devuelve `Cannot send non-template messages outside the 24-hour window`.
- `api_call` inicia un workflow por HTTP con `phone_number` y variables. Con un número sandbox no se admite `recipient`; sí `phone_number`.
- Las Kapso Functions corren en Cloudflare Workers con `env.KV` y `env.DB`.
- El nodo `agent` retiene la ejecución hasta `complete_task`. El nodo `handoff` detiene la ejecución y deja la conversación a una persona.
- Tras un `handoff` en un workflow hijo, el padre (W0) queda en `waiting` y el hijo en `handoff`. Para reiniciar una conversación hay que cerrar ambas ejecuciones (`ended`), además de `reset_demo`.
- La prueba de envío y recepción del sandbox con el flujo "Respuesta de prueba sandbox" funcionó.

**Por verificar antes de construir**
1. Cómo el nodo `agent` entrega monto y monedas a variables del workflow. Alternativa: extraerlos con una función.
2. Comportamiento del trigger `inbound_message` cuando ya hay una ejecución en espera. Se espera que el mensaje reanude esa ejecución y W0 solo arranque cuando no haya ninguna.
3. Si iniciar E4 a mano por API con el teléfono del cliente funciona en el sandbox.
4. Si el sandbox admite el tipo de mensaje de lista y `cta_url`.

## 9. Ajuste respecto al diseño aprobado en Figma

El E1 aprobado muestra cinco opciones en un solo mensaje. WhatsApp permite 3 botones de respuesta y un solo botón de enlace por mensaje, así que el spec los divide: 3 botones de respuesta (Continuar, Cambiar monto, Hablar con persona) y un mensaje aparte con el enlace al formulario web. El enlace a la app se añade cuando exista su URL. El Figma se actualiza en consecuencia.

## 10. Pruebas y criterios de aceptación (demo)

1. Camino feliz E1 a E4 en el sandbox: cotización, datos, cuenta de BrasPer, constancia y aviso de pago verificado.
2. Primer mensaje que no es una cotización ("hola"): el menú con botones lleva a la misma cotización.
3. Dato inválido dos veces seguidas: la conversación pasa a persona.
4. Cancelar operación: estado `cancelada` y confirmación al cliente.
5. Servicio de tasas caído (simulado): no se escribe ninguna tasa y se escala.
6. Abandonar a mitad y volver: el enrutador retoma en la etapa que indica el estado.
7. Ninguna tasa, comisión, monto ni cuenta sale del texto del modelo.
8. El aviso de E4 llega como texto libre dentro de la ventana de 24 h.
9. Se desactiva el workflow "Respuesta de prueba sandbox" al publicar el enrutador real.

## 11. Pendientes (NEEDS_HUMAN)

| Tema | Por qué importa | Recomendación | Bloquea |
|---|---|---|---|
| Correo del cliente | El comprobante sale por correo y el formulario no lo pide. | Tomarlo de `get_client`; si no existe, pedirlo en E2. | E2, E4 |
| Cuentas en Brasil | Puede ser llave Pix o banco, agencia y conta. | Definir el formato; mientras tanto, Brasil se agrega por el formulario web. | E2 (cuenta nueva) |
| Cliente recurrente | Reconocer solo por teléfono permitiría suplantación con un DNI ajeno. | Identificar por teléfono, pedir siempre DNI/CPF, mostrar solo los últimos 4 dígitos. | E2 |
| Hablar con una persona | Falta definir responsable, canal y horario. | Definir responsable y canal; Kapso tiene inbox con asignación. | handoff |
| Horarios y feriados | Hoy solo están en la web. | Exponerlos desde `check_hours`. | aviso fuera de horario |
| Límites de monto | Montos altos podrían requerir revisión humana. | Definir el umbral y escalar antes de mostrar la cuenta. | E1, E3 |
| Opciones cerradas | Origen de fondos y bancos de origen definitivos. | Confirmar con BrasPer; las listas admiten hasta 10 filas. | E2 |
| Plantillas de Meta | Los avisos fuera de la ventana de 24 h las exigen. La aprobación no es inmediata. | Iniciarla en paralelo; no bloquea la demo. | producción |
| Idiomas | El sitio ofrece ES, PT y EN. | Confirmar si el chat responde en los tres. Las plantillas se aprueban por idioma. | textos, plantillas |
| Número real | El sandbox solo conversa con números unidos. | Decidir cuándo pasar a un número de producción. | salida a producción |

## 12. Riesgos

- La extracción con IA puede equivocarse en el monto o las monedas. Mitigación: el cliente ve la cotización y confirma con Continuar antes de avanzar.
- Dos ejecuciones simultáneas (la de prueba y el enrutador) duplicarían respuestas. Mitigación: desactivar el flujo de prueba al publicar.
- Los puntos de la sección 8 "por verificar" pueden obligar a ajustar nodos al construir. Se resuelven con un spike corto al empezar el plan.
- Las tasas y cuentas de la demo son ficticias. No deben presentarse como datos reales de BrasPer.
