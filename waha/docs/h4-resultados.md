# H4: prueba real de punta a punta

Fecha: 2026-10-13. WAHA 2026.9.2 (imagen `devlikeapro/waha:arm`), motor **NOWEB**, `WAHA_INTERACTIVOS=nativo` (todo como lista de WhatsApp; enlace como texto). Número dedicado de WhatsApp personal; teléfono de prueba aparte. IA: `claude-haiku-5-5` con la clave real.

## Recorrido completo

Probado dos veces desde el teléfono, por WhatsApp real:

| Pasada | Camino | Entrantes | Salientes | Resultado |
|---|---|---|---|---|
| 1 | Cuenta nueva (sin cuentas sembradas bajo el teléfono real) | 11 | 13 | Flujo completo hasta "Una persona validará tu pago…". Reveló el fallo del LID (abajo) |
| 2 | Dos cuentas guardadas: "Otra cuenta" → BCP ••1111 → "Sí, esa" | 10 | 12 | Flujo completo, estado bajo el teléfono real, 0 errores del motor |

La pasada 2 coincide con lo esperado: 9 entrantes y 11 salientes de Kapso sin el aviso, más "Otra cuenta" y el mensaje de BCP. Con el aviso de E4 son 13 salientes en el camino de una cuenta, igual que en Kapso (cubierto por `test/paridad.test.js`).

**Aviso de pago (E4):** tras `set_status verificada` y `POST /internal/avisos`, llegaron los dos mensajes ("✅ Pago verificado…" y "¡Listo! Recibiste 350.00 PEN…").

## Latencias (pasada 2, desde `registro`)

- Todos los envíos a WAHA: HTTP 201, media 85 ms, máximo 1.2 s.
- Procesamiento por mensaje entrante: mediana 0.72 s, máximo 4.5 s (incluye la pausa de 0.7 s entre envíos y la llamada a la IA en el primer mensaje).

## Casos de borde

| Caso | Resultado |
|---|---|
| a. Dos DNI inválidos seguidos | OK: "No reconozco ese formato…" y a la segunda "Te paso con una persona…"; handoff registrado con motivo `dni_invalido` |
| b. "Hablar con persona" | OK: mensaje de persona y el flujo se detiene. Un "Hola" posterior reinicia la cotización (no hay operación creada todavía; mismo comportamiento que Kapso) |
| c. Sticker en el paso del DNI | OK: cuenta como formato inválido y sigue esperando |
| d. Dos mensajes seguidos | OK: "12345678" y "Hola" → una lista de fondos y, por el "Hola" inválido, un único reenvío; en orden y sin duplicados |
| e. Reinicio del servidor a mitad del flujo | OK: la conversación se retomó en `E2.of_wait` con `origen_fondos` y `banco_origen` conservados |
| f. Sin clave de IA | OK: no calló; preguntó moneda por moneda, pidió el monto y cotizó igual |

## Hallazgos durante la prueba

1. **LID:** NOWEB entrega al cliente como `@lid`; la API de WAHA para resolverlo exige `config.noweb.store` y no respondió. El teléfono real viene en `_data.key.remoteJidAlt` del evento; se usa ese campo (la API de LIDs queda de respaldo). Corregido con prueba.
2. **Registro:** los `sendSeen` se contaban como mensajes; ahora el registro guarda la ruta de WAHA en `detalle`.

## IA: tokens medidos

4 mensajes reales: ~882 tokens de entrada y ~70 de salida por conversación (la estimación era 600 y 100) → ~US$0.00012 por conversación con Haiku 5.5 (US$0.10 y US$0.50 por millón). Menos de US$1 al mes con 6,000 conversaciones.

## No verificado

- Cuenta de WhatsApp Business (la prueba fue con un número personal): podría mostrar botones reales.
- La vigencia de la tasa (E3, "tasa vencida") y el horario cerrado por WhatsApp real; están cubiertos por las pruebas de `kapso/`.
- Carga o varios clientes a la vez; solo se probó un teléfono.
- El envío por iniciativa propia fuera de la ventana de 23 h (queda `aviso_pendiente`, sin plantilla).
- La imagen del servidor en contenedor se construyó y se comprobó sin `.env`, pero no se ejecutó el servidor dentro del contenedor.
