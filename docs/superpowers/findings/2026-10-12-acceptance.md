# Prueba de aceptación del flujo de WhatsApp (spec §10)

Sandbox de Kapso, teléfono de prueba, datos ficticios. Fecha: 2026-10-12 (hora Lima).

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Camino feliz E1→E4 | Pasa | Operación `BR-0001` pasó a `en_validacion`; E4 envió "✅ Pago verificado…" y "¡Listo! Recibiste 350.00 PEN…". |
| 2 | Menú BRL/PEN/USD llega a la misma cotización | Pasa | Ejecución de W0 con selección por botones y misma oferta. |
| 3 | DNI inválido dos veces → persona | Pasa | "123" y "12": la ejecución de E2 quedó en `handoff`. |
| 4 | Cancelar operación | Pasa | "Cancelar operación" → "¿Seguro que quieres cancelar la operación BR-0002?" → "Sí, cancelar" → "Listo, cancelé la operación BR-0002." |
| 5 | Tasas caídas | Parcial: la función responde `sin_servicio` (`get_rate_quote` con `simular_tasas_caidas`); prueba en vivo pendiente | invocación `a45c6ac7…` |
| 6 | Volver con operación en curso | Parcial: `get_status` enruta `en_validacion` → arista `estado` con `estado_texto` "en validación: una persona revisa tu pago"; prueba en vivo pendiente | invocación `fb206f54…` |
| 7 | Ningún dato sale del modelo | Pasa (revisión de código) | El único nodo `agent` es `extraer` de E1, solo con `save_variable` y `complete_task`; DNI, banco y cuenta se piden después, en E2, con nodos de texto. |
| 8 | Ventana de 24 h cerrada | Pasa | Tras `reset_demo`, `check_window` → `cerrada`; E4 (`0104fb55…`) terminó en el nodo `plantilla` con `aviso_pendiente=plantilla_requerida` y sin enviar mensaje. |
| 9 | Sin respuestas duplicadas | Pasa | Solo W0 tiene un trigger de mensaje entrante activo; el flujo antiguo `6bc23f75…` y los del spike están inactivos; la conversación muestra una respuesta por paso. |

Verificaciones adicionales en vivo:

- Lista de bancos para BRL: 6 filas (Banco do Brasil, Itaú, Bradesco, Nubank, Caixa, Otro), sin bancos peruanos.
- Aviso fuera de horario: "Fuera de horario: tu operación se verificará mañana a las 7:00 a. m." (un solo punto).
- Latencia: cada paso con función tarda 4–5 s en Kapso (p. ej. toque en "Continuar" 21:42:52 → pregunta de DNI 21:42:57).

## Incidencias

- El sandbox dejó de ingresar mensajes en dos ocasiones (18:32–18:40 y ~21:35) con la sesión en `Active`; se resolvió recreando la sesión del sandbox. Causa no confirmada.
- Tras un `handoff` en un workflow hijo, el padre queda en `waiting` y el hijo en `handoff`: hay que cerrar ambas ejecuciones para repetir la demo (documentado en `kapso/README.md`).

## Revisión final de la rama (revisor independiente) y arreglos

Corregidos con pruebas (46/46) y republicados en Kapso (función, E2 y E4):

- "Otro" como banco de una cuenta nueva ahora lleva al formulario web y a una persona (antes guardaba una cuenta con banco "Otro").
- "Otro" como banco de origen ya no aparece como banco de BrasPer: se usa un banco por defecto de la moneda.
- Una operación avisada como verificada pasa a `completada` y libera al cliente (antes quedaba atrapado en "verificada" en cada mensaje).
- `parseMonto` rechaza "2 mil", "3k" y "-500" en vez de interpretarlos mal.
- Pruebas nuevas: USD sin Caixa, bordes de horario (L–V 18:00, sáb 14:00, dom 14:00), "Otro" y cierre de operación.

Diferidos (sin cambio en esta entrega):

- La vigencia de la tasa se revisa al entrar a E3, no al tocar "Ya transferí": con más de 15 min entre ambos se adjunta la constancia con la tasa vencida. Costo si es un problema: recotizar al adjuntar la constancia.
- Solo se ofrece una cuenta guardada por moneda y se pueden duplicar (`list_accounts` sin uso).
- Estado `escalada`/`rechazada`: el cliente sigue viendo "una persona atiende tu caso" hasta que se cierre a mano (la demo no modela la resolución).
- Estado `cotizada` del spec no se persiste (la operación nace en E2 como `pendiente`); E4 no ofrece el botón "Hablar con persona"; el spec §8 aún lista como "por verificar" puntos que el spike resolvió.
- Menores: botones antiguos con el mismo id se aceptan; `simular_ahora` inválido devuelve 500; contadores `seq_*` no atómicos; "¡Hola!" se repite tras "Cambiar monto"; hora de vigencia en 24 h frente a a. m./p. m. en el aviso de horario.

Riesgo abierto a verificar en vivo: el nodo `agent` de E1 podría recibir la conversación anterior del cliente (incluido el DNI) si escribe de nuevo tras cancelar. Ver "Verificación del agente" más abajo.
