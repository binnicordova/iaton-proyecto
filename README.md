# BrasPer · Agente de WhatsApp para remesas

Un agente de WhatsApp que cotiza una remesa entre **soles (PEN), reales (BRL) y dólares (USD)**, registra la operación en el backend real de BrasPer, recibe la foto del comprobante, avisa cuando el pago se verifica y entrega el **comprobante en PDF**, todo dentro del chat.

Reto de la IAthon: *mejorar el proceso de ventas y facturación de BrasPer*. Hoy, 4 personas de Ventas y 3 de Facturación atienden a mano unas 60 transacciones diarias por WhatsApp, y el cliente puede esperar hasta 3 días por su comprobante.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/01-cotizacion.png" width="190"><br><sub>1. Cotiza</sub></td>
    <td align="center"><img src="docs/screenshots/03-confirmas.png" width="190"><br><sub>2. Confirma</sub></td>
    <td align="center"><img src="docs/screenshots/04-como-pagar.png" width="190"><br><sub>3. Recibe cómo pagar</sub></td>
    <td align="center"><img src="docs/screenshots/05-comprobante.png" width="190"><br><sub>4. Envía el comprobante</sub></td>
    <td align="center"><img src="docs/screenshots/06-pago-verificado-y-pdf.png" width="190"><br><sub>5. Pago verificado y PDF</sub></td>
  </tr>
</table>

> Las capturas son maquetas hechas con los textos reales del bot y datos de demostración.

## Qué hace

- **Entiende la remesa en una frase** ("Quiero enviar 500 soles a Brasil"): una IA (Claude Haiku) extrae solo el monto y las monedas. Las tasas, comisiones y estados los entrega siempre el backend, nunca el modelo.
- **Conversación de pasos fijos**: cotización, datos del cliente, cuentas, resumen, pago y comprobante. Cada error dice qué hacer y el segundo fallo seguido pasa a una persona.
- **Backend real de BrasPer** (Firebase): cotiza con `createQuote`, crea la orden con `createOrder`, sube la foto a Storage y registra el pago con `submitProof`.
- **Una persona valida el pago**: la IA nunca aprueba ni juzga un comprobante.
- **Avisos y recibo automáticos**: un vigilante lee el estado de la orden y avisa la aprobación (o el rechazo); cuando la factura queda aceptada, envía el PDF real.
- **Dos sentidos**: Brasil → Perú (BRL → PEN, con Pix) y Perú → Brasil (PEN → BRL).
- **Sin credenciales de administrador**: el bot actúa como un usuario anónimo de Firebase por teléfono; las reglas del proyecto aíslan a cada cliente.

### Perú → Brasil

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/07-peru-brasil-cotizacion.png" width="190"><br><sub>Cotización en soles</sub></td>
    <td align="center"><img src="docs/screenshots/08-peru-brasil-como-pagar.png" width="190"><br><sub>Cómo pagar en soles (sin Pix)</sub></td>
  </tr>
</table>

## Cómo interactúa el cliente con el flujo

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente (WhatsApp)
    participant W as WAHA
    participant S as Servidor del bot
    participant IA as IA (Claude Haiku)
    participant F as Backend Firebase
    actor P as Personal de BrasPer

    C->>W: "Quiero enviar 500 soles a Brasil"
    W->>S: webhook firmado (HMAC)
    S->>IA: extrae monto y monedas
    IA-->>S: 500 PEN a BRL
    S->>F: createQuote (usuario anonimo por telefono)
    F-->>S: tasa, comision, impuesto, total y vigencia
    S-->>C: cotizacion y opciones
    C->>S: "Si, continuar"
    S-->>C: pide nombre, documento, correo, fondos y bancos
    C->>S: sus datos (validados al instante)
    S->>F: createOrder
    F-->>S: orden BR-000N y cuenta de pago
    S-->>C: instrucciones de pago
    C->>W: foto del comprobante y numero de operacion
    W->>S: webhook con el archivo
    S->>F: sube la foto a Storage y llama a submitProof
    F-->>S: orden en validacion
    S-->>C: "Una persona validara tu pago"
    P->>F: aprueba, exporta y factura la orden
    loop cada 20 segundos (vigilante)
        S->>F: lee la orden con el token del cliente
    end
    F-->>S: aprobada
    S-->>C: "Pago verificado"
    F-->>S: factura aceptada
    S->>F: getReceipt
    F-->>S: PDF
    S-->>C: comprobante en PDF
    Note over C,P: Si el pago se rechaza, el cliente recibe el motivo y un enlace al WhatsApp humano de BrasPer
```

## Arquitectura

```
WhatsApp ⇄ WAHA (Docker) ⇄ Servidor Node ── Motor de flujo ── Backend
                                │                              ├─ real      → funciones, Firestore y Storage (Firebase)
                                │                              └─ simulado  → API de demostración (modo de respaldo)
                                └─ SQLite: conversaciones, sesiones, seguimientos
```

| Carpeta | Qué contiene |
|---|---|
| `waha/` | El bot: servidor, motor de flujo, backend real, vigilante, pruebas. Ver [`waha/README.md`](waha/README.md). |
| `kapso/` | El flujo original en Kapso y la API simulada que usa el modo `simulado`. |
| `docs/superpowers/` | Diseños (specs) y planes de implementación. |
| `.env.example` | Variables de entorno (obligatorias y opcionales). |

## Cómo ejecutarlo

### Requisitos
- **Node 24** o superior (sin dependencias de npm) y **Docker** con Compose.
- Un **número de WhatsApp dedicado** para vincular a WAHA (no el de uso diario).
- `ANTHROPIC_API_KEY` (la IA) y, para el modo real, `FIREBASE_API_KEY` (la clave web pública del proyecto de BrasPer).

> **WAHA no es una vía oficial de WhatsApp**: el número puede restringirse o bloquearse. Es para la demo y el hackathon. Para producción se usaría la API oficial de WhatsApp.

### 1. Probar sin nada instalado (modo simulado)
```bash
git clone https://github.com/davidrodriguez2712/iaton-proyecto
cd iaton-proyecto
npm --prefix waha test        # 268 pruebas del bot
npm --prefix kapso test       # 58 pruebas del flujo original
```

### 2. Levantar el bot con WhatsApp
```bash
cp .env.example .env          # completa ANTHROPIC_API_KEY y, para el modo real, BACKEND=real y FIREBASE_API_KEY
cd waha
npm run setup                 # genera los secretos de WAHA en waha/.env (no los muestra)
docker compose up -d waha     # WAHA; en x86 usa WAHA_TAG=latest
npm run sesion                # crea la sesión "demo" con el webhook firmado
```
Abre `http://127.0.0.1:3010/dashboard` (usuario y contraseña en `waha/.env`), pide el QR de la sesión `demo` y escanéalo desde WhatsApp → *Dispositivos vinculados*. Cuando la sesión esté en `WORKING`:
```bash
npm start                     # servidor en 127.0.0.1:8010
npm run preflight -- --ia     # comprueba WAHA, el servidor, la base, la clave y la IA
```

### 3. Probarlo desde tu teléfono
Escribe al número vinculado: **"Quiero enviar 500 soles a Brasil"**. Antes de cada demo puedes limpiar tu estado con `npm run demo:reset -- <teléfono>` (código de país, sin `+`).

### Modo real contra Firebase
Con `BACKEND=real` el bot usa el backend del equipo (proyecto Firebase `aibrasper`, base de **pruebas**). `npm run contrato` repite contra el proyecto real las llamadas seguras y comprueba que su forma coincide con la del servidor falso de las pruebas; no crea órdenes. El backend vive en [binnicordova/iathon-fintech](https://github.com/binnicordova/iathon-fintech). Más detalle en [`waha/README.md`](waha/README.md).

### Variables de entorno
Todas están en [`.env.example`](.env.example); solo 10 son obligatorias y el resto tiene un valor por defecto.

## Privacidad y seguridad

- Sin credenciales de administrador: el bot usa la clave web pública de Firebase y un usuario anónimo por teléfono.
- Los registros guardan ids, estados y latencias; nunca documento, correo, cuentas ni la foto. Los teléfonos se enmascaran.
- Los datos personales salen del estado de la conversación en cuanto se crea la orden, y las conversaciones inactivas se borran a las 24 horas.
- La base SQLite y sus archivos quedan con permisos 600.

---

Hecho por **David Rodriguez** para la **IAthon Construye Perú (IATHON)**, reto de **BRASPER**.
