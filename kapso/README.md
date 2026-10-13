# Flujo de WhatsApp de BrasPer en Kapso

Spec: `docs/superpowers/specs/2026-10-11-brasper-whatsapp-flow-design.md`. Todo es de demostración: tasas, cuenta de BrasPer y cliente son ficticios.

## Estructura

- `functions/brasper-api.js`: función de Kapso que simula la API de BrasPer (estado en `env.KV`). Pruebas: `functions/brasper-api.test.js`.
- `build/flow.js`, `build/workflows.js`: generan y validan los workflows. `build/spike.js`: workflows desechables de verificación.
- `ids.json`: IDs de la función y los workflows en Kapso.
- Workflows: `W0 Enrutador` (único con trigger de mensaje entrante) y `E1 Cotiza`, `E2 Datos`, `E3 Pago y constancia`, `E4 Estado` (E4 con trigger de API).

## Comandos

```bash
cd kapso
node --test                 # pruebas de la función y de los grafos
node build/emit.js          # genera dist/<slug>.json de E1, E2, E3, E4 y W0
node build/emit.js --strict # igual, exigiendo ids.json completo
```

Para publicar o actualizar un workflow en Kapso, sigue el Procedimiento P del plan (`docs/superpowers/plans/2026-10-12-brasper-whatsapp-kapso.md`). Tras copiar un JSON grande a `create_workflow`/`update_workflow`, compara nodos, aristas y textos contra `dist/<slug>.json`: un error de transcripción pasa sin aviso.

## Antes de cada demo

Con las herramientas MCP `kapso`, `invoke_function` sobre `brasper-api`:

1. `{"action":"reset_demo","phone":"<TELÉFONO_DE_PRUEBA>"}` limpia la operación activa, el "visto" (ventana de 24 h) y el handoff del teléfono.
2. `{"action":"seed_demo","phone":"<TELÉFONO_DE_PRUEBA>"}` siembra un cliente con la cuenta `Scotiabank ••9956` en PEN.
3. Si la demo anterior terminó en **handoff** (DNI inválido dos veces, "Hablar con persona", etc.), cierra también las ejecuciones que quedaron abiertas: el padre (W0) queda en `waiting` y el hijo en `handoff`. Usa `update_workflow_execution_status` con `ended` en ambas; si no, el siguiente mensaje se enruta a la ejecución vieja.

El teléfono va en formato internacional, sin `+` o con él. Debe haberse unido al sandbox.

## Simular al backend (aviso de pago)

1. `{"action":"set_status","vars":{"operacion_id":"BR-000N","estado":"verificada"}}`.
2. `start_workflow_execution` sobre el workflow `BrasPer · E4 Estado`, con `phone_number`, `phone_number_id` `597907523413541`, `variables` `{"operacion_id":"BR-000N"}` y `confirm: true`.

El aviso sale como texto libre y solo si el cliente escribió hace menos de 23 horas. Si no, E4 anota `aviso_pendiente = plantilla_requerida` y no envía nada.

## Cerrar un caso escalado

Cuando una persona resuelve un handoff, el cliente sigue viendo "una persona atiende tu caso" hasta que se cierre la operación. Con `invoke_function`:

`{"action":"resolve_handoff","phone":"<TELÉFONO>","vars":{"operacion_id":"BR-000N","estado":"completada"}}` (o `cancelada`). La operación pasa a ese estado, se borra el handoff y el cliente puede cotizar de nuevo. Cualquier otro estado se rechaza.

## Varias cuentas guardadas

`seed_demo` con `"vars":{"cuentas":2}` siembra Scotiabank ••9956 y BCP ••1111 en PEN. Al elegir "Otra cuenta" el chat ofrece primero la siguiente cuenta guardada y solo al agotarlas pide una nueva. Una cuenta con el mismo banco, últimos 4 dígitos y moneda no se duplica.

## Simular fallos

- **Tasas caídas:** `set_function_secret` `TASAS_CAIDAS=1`; al terminar, `delete_function_secret`. Con la variable activa, E1 responde que no hay tasas y pasa a una persona.
- **Estado de una operación:** `set_status` con `en_validacion`, `verificada`, `enviada`, `rechazada`, etc. Al escribir de nuevo, W0 enruta según el estado.

## Estados

`pendiente`, `esperando_transferencia`, `en_validacion`, `verificada`, `enviada`, `completada`, `rechazada`, `cancelada`, `escalada`. `rechazada` en `set_status` hace que E4 avise y pase a una persona.

## Listas de bancos de origen

Se filtran por moneda con la acción `route_moneda`:

- BRL: Banco do Brasil, Itaú, Bradesco, Nubank, Caixa, Otro.
- PEN: BCP, Interbank, BBVA, Scotiabank, Otro.
- USD: los de Perú y de Brasil, sin Caixa.

## Limitaciones conocidas

- El botón "Abrir formulario web" abre `https://brasper.com/es`: la web aún no admite la cotización por parámetros. El enlace a la app no existe todavía.
- Listas de bancos y de origen de fondos, horarios sin feriados, y comisión (1 % sobre el monto) son de demostración.
- El agente de E1 queda en `tool_only` y con un prompt que prohíbe herramientas distintas de `save_variable` y `complete_task`. Kapso agrega por su cuenta `handoff_to_human`, `send_notification_to_user` y `enter_waiting` e ignora `default_tool_configs`: no se pueden quitar por API.
- Las plantillas de Meta no se usan: fuera de la ventana de 24 h el aviso queda pendiente.
- Cada paso con función tarda unos 4–5 s (varias llamadas encadenadas); es latencia de Kapso, no un fallo.
- El sandbox de Kapso a veces deja de recibir mensajes aunque la sesión figure `Active`; se resuelve recreando la sesión del sandbox.
- `env.KV` es de lectura eventual: tras una escritura, una lectura inmediata desde otra región podría tardar en reflejarla.
