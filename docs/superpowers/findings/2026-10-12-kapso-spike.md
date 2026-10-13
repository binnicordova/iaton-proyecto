# Spike de plataforma de Kapso: resultados

- **Fecha:** 2026-10-12
- **Plan:** `docs/superpowers/plans/2026-10-12-brasper-whatsapp-kapso.md`, tarea 4
- **Entorno:** sandbox de Kapso (`597907523413541`), función `brasper-api` desplegada (`1546f30d-a659-4197-a52a-af7696f0fca0`)

| Spike | Resultado | Evidencia | Decisión |
|---|---|---|---|
| S1: el agente extrae monto y monedas a variables sin hablar por su cuenta | PASA | Ejecución `e44a0b77-d3dc-4a9d-bd34-18fd69fcb3b0`. Una sola respuesta saliente: `S1 monto=500.0 origen=BRL destino=PEN`. Modelo `claude-haiku-5-5`. | Se mantiene el agente en E1. La tarea 5 (contingencia) no se ejecuta. `check_extraction` normaliza `500.0` a `500`. |
| S2: un hijo en espera se reanuda con el mensaje y el padre continúa | PASA | Padre `8ee53262-4ca2-4df9-9487-fa7e022f6336` (1 ejecución, terminó) e hijo `ef804304-6518-4b24-90a4-d27d19c123b2`. Mensajes en orden: `S2 hijo: dime algo`, `S2 hijo: recibí uno`, `S2 padre: el hijo terminó, dato=uno`. | La estructura W0 con nodos `call` funciona. El segundo mensaje reanuda al hijo y no crea una ejecución nueva del padre. |
| S3: inicio por API y decisión por ventana de 24 h | PASA | Ejecución `eec609ba-4411-4783-8d06-754fb269cd3c`: `context.phone_number` disponible, `check_window` devolvió `abierta` y se envió `S3 API ok: ventana abierta, operación BR-TEST`. | E4 puede decidir por la ventana al iniciarse por API. La marca `seen:` la escribe cualquier llamada a la función hecha desde un workflow disparado por WhatsApp. |
| S4: botones, enlace y lista, y `decide` en modo función | PASA | Llegaron 3 botones, `cta_url` y lista. `route_reply` devolvió `eleccion=b` y `fila=Banco do Brasil`, y las variables se leyeron en los mensajes siguientes. Con texto libre llegó `S4 respuesta fuera de las opciones`. | Los tipos de mensaje y el enrutado por función funcionan en el sandbox. |

## Observaciones fuera del plan

- **Entrega de mensajes del sandbox:** los mensajes enviados entre las 6:32 y las 6:38 p. m. no ingresaron a Kapso aunque la sesión figuraba `Active`. Se resolvió creando una sesión nueva para el mismo número (código `IYBBB8`, 6:41 p. m.). Causa probable, sin confirmar: el primer código del día anterior (`MKZQNL`) activó la sesión en otro proyecto de Kapso. Si vuelve a ocurrir, la primera comprobación es recrear la sesión.
- **Configuración del agente:** Kapso aceptó la definición del agente y añadió por su cuenta la herramienta `handoff_to_human` a `enabled_default_tools`. No afecta al flujo, porque las instrucciones del agente le prohíben escribir al cliente.
- **Definiciones:** Kapso aceptó sin cambios todas las definiciones generadas por `build/flow.js`. Añade `id` a cada condición de los nodos `decide` y `flow_condition_id` a las aristas.
- **Herramientas MCP:** durante la sesión el servidor MCP de Kapso se reconectó y pasó de herramientas agrupadas por recurso (`workflows`, `functions`) a herramientas por acción (`list_workflow_executions`, `invoke_function`, etc.).

## Decisión

Los cuatro supuestos se cumplen. Se continúa con la tarea 6 (publicar el enrutador y las etapas). La tarea 5 queda sin ejecutar.
