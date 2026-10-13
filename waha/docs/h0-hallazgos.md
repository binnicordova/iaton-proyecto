# H0: hallazgos

Fecha: 2026-10-13. WAHA 2026.9.2, imagen `devlikeapro/waha:arm` (`devlikeapro/waha@sha256:bafb399a27a133352523c01e16d7bcfbf77f29d938650bb9fa65e1218a2382c7`). Mac arm64: `:latest` y los tags por versión no tienen imagen arm64. Número dedicado de WhatsApp personal (no Business) vinculado por QR; teléfono de prueba aparte.

## Decisión

**Motor `NOWEB` y `WAHA_INTERACTIVOS=nativo`**, donde "nativo" significa: todas las opciones salen como **lista de WhatsApp**; los botones de respuesta se envían como lista (botón "Elegir"); el enlace sale como texto con la URL. `WAHA_INTERACTIVOS=texto` (menú numerado) sigue disponible como respaldo.

## Resultados por motor

| Tipo | WEBJS | NOWEB |
|---|---|---|
| Texto (`sendText`) | 201, llega | 201, llega |
| Botones de respuesta (`sendButtons`) | **501** "not implemented by 'WEBJS' engine" | 201, **no se entrega** (no aparece en el chat del destinatario) |
| Lista (`sendList`) | **501** | 201, **llega y funciona** ("Elegir banco" abre la lista) |
| Botón de enlace (`sendButtons` tipo `url`) | **501** | 201, **no se entrega** |

Se verificó en el teléfono del destinatario (capturas de pantalla del usuario). Lo que no se probó: si los botones llegarían con una cuenta de WhatsApp Business (la prueba fue con un número personal).

## Respuesta del cliente a una lista (evento real, NOWEB)

Llega como evento `message` con `body` = título de la fila y el id en
`payload._data.message.listResponseMessage.singleSelectReply.selectedRowId`. Fixture sanitizado: `fixtures/waha/respuesta_lista.json`. No existe fixture de botón: los botones no llegan.

## Identidad del remitente: llega como `@lid`

Con WEBJS y con NOWEB el mensaje entrante trae `from: <número>@lid` y `to: <número dedicado>@c.us`, no el teléfono real. WAHA lo resuelve con `GET /api/{session}/lids/{lid}` → `{ lid, pn }`. El servidor traduce el LID al teléfono real (con caché en el KV) para que `demo:reset`, `demo:seed` y los avisos de E4 usen el mismo número del cliente; si no se resuelve, usa el LID. Se responde siempre al `chatId` original.

## Notas operativas

- Cada motor guarda sus propias sesiones (`.sessions/webjs`, `.sessions/noweb`); cambiar de motor exige volver a escanear el QR.
- La respuesta de `GET /api/sessions/{name}` incluye `config.webhooks[].hmac.key` en claro: nunca imprimir esa respuesta completa.
- `WAHA_APPS_ENABLED=True` exige Redis; MCP queda apagado.
