# H0: hallazgos (en curso)

Fecha: 2026-10-13. WAHA 2026.9.2, imagen `devlikeapro/waha:arm` (Mac arm64; `:latest` y los tags por versión no tienen arm64). Número dedicado de WhatsApp personal (no Business) vinculado por QR.

## WEBJS (probado)

| Tipo | Resultado |
|---|---|
| Texto (`/api/sendText`) | HTTP 201; el destinatario lo recibe |
| Botones (`/api/sendButtons`) | **HTTP 501**: "The method is not implemented by 'WEBJS' engine" |
| Lista (`/api/sendList`) | **HTTP 501**: igual |
| Botón de enlace (`sendButtons` tipo `url`) | **HTTP 501**: igual |

Conclusión provisional: con WEBJS no hay interactivos nativos; `WAHA_INTERACTIVOS=texto` (menú numerado). Falta probar NOWEB, que según el changelog de WAHA implementa `sendButtons` (requiere volver a vincular el QR).

## Identidad del remitente: llega como `@lid`

El mensaje entrante del teléfono de prueba llegó con `from: <número>@lid` y `to: <número dedicado>@c.us`; no con el teléfono real. WAHA resuelve el LID con `GET /api/{session}/lids/{lid}` → `{ lid, pn }`. El servidor lo traduce al teléfono real (con caché en el KV) para que `demo:reset`, `demo:seed` y los avisos de E4 usen el mismo número que el cliente. Si WAHA no lo resuelve, se usa el LID como identidad. Se responde siempre al `chatId` original (`@lid`); el envío de texto a `@c.us` también funciona (WAHA lo resuelve a LID).

## Pendiente

- Probar NOWEB (botones, lista, enlace y el campo del evento con el id de la opción tocada).
- Reemplazar `fixtures/waha/respuesta_boton.json` y `respuesta_lista.json` (hoy provisionales) con eventos reales, o dejar `extraerOpcion` solo para modo texto si no hay interactivos.
- Fijar el digest de la imagen de WAHA.
