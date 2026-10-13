# Flujo de WhatsApp de BrasPer sobre WAHA

Ejecuta el mismo flujo de pasos fijos de `kapso/` (cotizar, datos, pago y constancia, estado) sobre **WAHA** y un servidor Node, sin pagar mensajes a Meta. Diseño: `docs/superpowers/specs/2026-10-13-brasper-waha-design.md`. Plan: `docs/superpowers/plans/2026-10-13-brasper-waha.md`.

> **Esta vía no es oficial.** WAHA maneja WhatsApp como un dispositivo vinculado (WhatsApp Web) y contradice las reglas de WhatsApp: el número puede restringirse o bloquearse. Es para la demo y el hackathon, con un número dedicado. El camino de producción es la API oficial de Meta; por eso el servidor habla con WhatsApp a través de una interfaz (`src/provider/`) que se puede reemplazar. Todos los datos de BrasPer (tasas, cuenta, cliente) son ficticios.

## Requisitos

- Docker (con Compose) y Node 24 o superior. Sin dependencias de npm.
- Un número de WhatsApp dedicado (no el personal de uso diario) para vincular a WAHA.
- `ANTHROPIC_API_KEY` en el `.env` de la raíz del repositorio (o en `waha/.env`). Sin ella el flujo funciona igual, preguntando paso a paso.

Puertos: WAHA en `127.0.0.1:3010` y el servidor en `127.0.0.1:8010` (el 3000 y el 8000 suelen estar ocupados). Se cambian con `WAHA_PORT` y `APP_PORT` en `waha/.env`. Nada se expone a Internet.

## Puesta en marcha

```bash
cd waha
npm run setup                 # genera waha/.env con secretos aleatorios (no los muestra)
docker compose up -d waha     # WAHA con NOWEB; en Apple Silicon usa la imagen :arm (por defecto); en x86: WAHA_TAG=latest
npm run sesion                # crea la sesión "demo" con el webhook firmado (no la reinicia si ya existe)
```

Abre `http://127.0.0.1:3010/dashboard` (usuario y contraseña en `waha/.env`), pide el QR de la sesión `demo` y escanéalo desde WhatsApp → Dispositivos vinculados, con el número dedicado. Espera a que la sesión esté `WORKING`.

```bash
npm start                     # servidor en 127.0.0.1:8010
npm run preflight -- --ia     # comprueba WAHA, servidor, base, clave y una llamada real a la IA
```

## Antes de cada demo

```bash
npm run demo:reset -- <TELÉFONO>              # borra la conversación, la operación activa, el "visto" y el handoff
npm run demo:seed  -- <TELÉFONO> --cuentas 2  # cliente con Scotiabank ••9956 y BCP ••1111 en PEN (sin --cuentas, solo la primera)
```

El teléfono va con código de país, sin `+` (por ejemplo `51944686794`).

## Simular al backend (aviso de pago)

1. Cambia el estado de la operación con la API simulada (por ejemplo `verificada`):

   ```bash
   node -e "
   const { abrirDb } = require('./src/estado/db'); const { crearAlmacen } = require('./src/estado/almacen');
   const { crearLlamadorFuncion } = require('./src/puente-api');
   const a = crearAlmacen(abrirDb(require('path').join(process.cwd(), 'data', 'brasper.db')));
   crearLlamadorFuncion({ kvEnv: a.kvEnv() })({ vars: { api_action: 'set_status', operacion_id: 'BR-0001', estado: 'verificada' }, phone: '<TELÉFONO>', edges: [], wa: { messages: [] } }).then(console.log);
   "
   ```

2. Avisa al cliente (la clave interna sale de `waha/.env`; no la imprimas):

   ```bash
   set -a; . ./.env; set +a
   curl -s -X POST http://127.0.0.1:8010/internal/avisos -H "x-internal-key: $INTERNAL_API_KEY" -d '{"telefono":"<TELÉFONO>","operacion_id":"BR-0001"}'
   ```

Responde `{"iniciado":true}`. Si el cliente está en medio de una conversación responde `{"iniciado":false,"motivo":"ocupado"}` y no envía nada. Otros estados (`rechazada`, `escalada`, `cancelada`) se simulan igual con `set_status`.

## Botones y listas

Resultado de H0 (`docs/h0-hallazgos.md`): con el motor **NOWEB** y un número personal solo llegan las **listas** de WhatsApp; los botones de respuesta y el botón de enlace devuelven 201 pero no se entregan, y WEBJS responde 501. Por eso el motor por defecto es NOWEB y `WAHA_INTERACTIVOS` en `waha/.env` tiene dos modos:

- `nativo`: toda opción sale como lista de WhatsApp (los botones se envían como lista con el botón "Elegir"); el enlace sale como texto con la URL. Es el modo de la demo.
- `texto`: las opciones salen como un menú numerado ("1. Continuar") y se acepta el número o el nombre. Funciona con cualquier motor.

En ambos modos el cliente también puede escribir el nombre de la opción en vez de tocarla.

## MCP de WAHA (opcional, solo desarrollo)

**Apagado por defecto.** En esta versión de WAHA, activar las apps (`WAHA_APPS_ENABLED=True`, necesario para MCP) exige además Redis (`REDIS_URL`) y la clave en texto plano (`WAHA_API_KEY_PLAIN`); sin Redis el contenedor se cierra al arrancar. Para usarlo, añade un servicio Redis al compose y esas tres variables al servicio `waha`. No forma parte del producto ni del camino de un mensaje. Si lo conectas a Claude Code, crea una app de MCP de la sesión con permisos de **solo lectura** y nunca uses la clave de administración:

```bash
curl -s -X POST http://127.0.0.1:3010/api/apps -H "X-Api-Key: $WAHA_API_KEY" -H "Content-Type: application/json" \
  -d '{"enabled":true,"id":"app_mcp_demo","session":"demo","app":"mcp","config":{"actions":{"read":true,"send":false,"control":false,"setting":false,"app":false,"delete":false}}}'
claude mcp add --transport http whatsapp http://localhost:3010/mcp --header "X-Api-Key: <clave de la app, config.key>"
```

Leer chats expone conversaciones reales: úsalo solo con el número dedicado.

## Recuperación

- Sesión `SCAN_QR_CODE`: pide un QR nuevo en el panel, escanéalo y espera `WORKING`.
- Sesión `FAILED`: mira `docker compose logs waha`, reinicia la sesión (`POST /api/sessions/demo/restart`) y vuelve a vincular solo si hace falta.
- Errores **463** (restricción de contacto) y **475** (límite de mensajes): no reinicies ni vuelvas a vincular, no resetean nada. Deja de escribir a contactos nuevos y espera. El servidor no reintenta estos errores.
- El servidor no crea, borra ni reinicia sesiones al arrancar; solo comprueba y avisa.
- `GET /health/whatsapp` responde 200 si la sesión está `WORKING` y 503 si no.

## Contenedor del servidor (opcional)

`docker compose --profile app up -d --build` levanta también el servidor en un contenedor (la imagen no incluye ningún `.env`). Con el contenedor, crea la sesión con `WEBHOOK_URL=http://app:8010/webhooks/waha npm run sesion`. Mientras desarrollas, `npm start` en el host es lo más simple (el webhook usa `host.docker.internal`).

## Pruebas

```bash
npm test                      # unitarias, motor, paridad con Kapso e integración del servidor
(cd ../kapso && node --test)  # las 57 de la API simulada y los grafos
```

## Limitaciones y privacidad

- Solo se responde a quien escribió primero; el único envío por iniciativa propia es el aviso de E4 y solo dentro de la ventana de 23 h. Nada de envíos masivos.
- El texto del primer mensaje del cliente se envía a la API de Anthropic para extraer monto y monedas; sale de tu máquina aunque WAHA sea local. Los registros guardan metadatos, nunca el texto de los mensajes.
- Los datos que el cliente escribe (DNI, cuenta) quedan en `waha/data/brasper.db`; `npm run demo:reset` los limpia.
- Las demás limitaciones del flujo (listas de bancos y horarios de demostración, el enlace web sin cotización, etc.) son las de `kapso/README.md`.
