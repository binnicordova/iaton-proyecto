# Flujo de WhatsApp de BrasPer en Kapso: plan de implementación

> **Para quien ejecute este plan:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementarlo tarea por tarea. Los pasos usan casillas `- [ ]` para el seguimiento.

**Objetivo:** construir en Kapso el flujo de WhatsApp de pasos fijos de BrasPer (enrutador W0 y etapas E1 a E4) sobre una API simulada con Kapso Functions, y comprobarlo de punta a punta en el sandbox.

**Arquitectura:** el código vive en `kapso/` y se prueba sin conexión con `node:test`. Una Kapso Function (`brasper-api`) simula la API futura de BrasPer y guarda el estado en `env.KV`. Un constructor en JavaScript (`build/flow.js`, `build/workflows.js`) genera el JSON de cada workflow y valida su grafo y los límites de WhatsApp. Un procedimiento único (P) publica cada JSON en Kapso con las herramientas MCP `kapso`. Antes de publicar, un spike comprueba cuatro supuestos de plataforma con workflows desechables.

**Stack:** Node 24 (`node:test`, sin dependencias), Kapso Functions (Cloudflare Workers con `env.KV`), Kapso workflows y MCP `kapso`, WhatsApp Cloud API (sandbox de Kapso).

**Spec:** `docs/superpowers/specs/2026-10-11-brasper-whatsapp-flow-design.md`. Diseño visual: https://www.figma.com/design/tymrlM4tRU7O3dztzAN9QV

## Restricciones globales

Valen para todas las tareas. Los valores salen del spec o de la documentación verificada de Kapso y Meta.

- Número del sandbox: `phone_number_id` `597907523413541`. Teléfono de prueba de David: `51944686794`.
- Botones de respuesta: como máximo 3, título de hasta 20 caracteres y únicos. Listas: hasta 10 filas, título de fila de hasta 24, texto del botón de hasta 20. `cta_url`: un solo botón por mensaje, etiqueta de hasta 20, URL `https`. Cuerpo de botones y de `cta_url`: hasta 1024 caracteres.
- **Ajuste respecto al spec:** "Hablar con una persona" (22) y "Usar el formulario web" (22) exceden 20. Se usan **"Hablar con persona"** y **"Abrir formulario web"**. La tarea 8 corrige el spec y el Figma.
- El texto libre solo se envía dentro de las 24 h posteriores al último mensaje del cliente. En la demo no se usan plantillas de Meta.
- Pasos 1 a 4 rígidos: respuesta inválida repite la pregunta y el segundo fallo seguido escala a una persona.
- La IA solo extrae monto y monedas del primer mensaje. Tasas, comisiones, montos y cuentas los entrega siempre una herramienta de la API, nunca el modelo.
- El estado del pago solo lo cambia una persona (en la demo, `set_status` invocado a mano). El chat nunca dice que un pago fue recibido o aprobado por su cuenta.
- Todos los textos al cliente van en español.
- Datos de la demo ficticios: tasas, cuenta de BrasPer (`DEMO-…`) y cliente sembrado. Nunca cuentas reales ni datos de personas reales.
- No se versionan secretos. `kapso/ids.json` solo guarda IDs de recursos de Kapso.
- No se hace merge a `main` ni force-push. El trabajo va en la rama `feat/brasper-whatsapp-kapso`.

## Revisión: casos que el spec implica y que conviene fijar con pruebas

1. **Texto libre cuando se espera un botón** ("hola", "cancelar" escrito): repite el mensaje y, al segundo intento, pasa a persona. Prueba `route_reply…` (tarea 1) y prueba de grafo "invalido y escalar" (tarea 2).
2. **Foto enviada como texto, o sin foto:** repite la petición y escala al segundo fallo. Prueba `media:comprobante…` (tarea 1).
3. **Montos con formatos distintos** ("1.500,50", "500 reales", "0"): se interpretan o se rechazan sin inventar. Prueba `parseMonto…` (tarea 1).
4. **Cliente con una operación activa que escribe "hola":** el enrutador lo lleva a su etapa o le informa el estado, no reinicia la cotización. Prueba `ciclo de una operación…` (tarea 1) y criterio 6 de la tarea 7.
5. **Aviso de pago con la ventana de 24 h cerrada:** no se intenta enviar texto libre. Prueba `check_window…` (tarea 1) y criterio 8 de la tarea 7.

---

## Procedimiento P: publicar un workflow desde `kapso/dist/`

Lo usan las tareas 4 y 6. `node build/emit.js` deja en `kapso/dist/<slug>.json` un objeto `{ name, slug, description, definition, triggers }`.

- [ ] **P1.** Lee `kapso/dist/<slug>.json` con la herramienta Read.
- [ ] **P2.** Llama a `workflows` con `action: "create"` y `params: { name, slug, description, status: "draft", definition }`. Pasa `definition` tal cual, sin editarla a mano. Anota el `id` devuelto.
- [ ] **P3.** Por cada elemento de `triggers`, llama a `workflows` con `action: "create_trigger"` y `params: { workflow_id: <id>, ...trigger }`. Si el procedimiento lo pide, usa `active: false`.
- [ ] **P4.** Llama a `workflows` con `action: "publish"` y `params: { id }`.
- [ ] **P5.** Verifica con `workflows` `action: "get_definition"`, `params: { id }`: la cantidad de nodos y de aristas debe coincidir con la del archivo.
- [ ] **Si P2 rechaza la definición:** lee el mensaje de error, corrige la forma de configuración en `build/flow.js` según la documentación de Kapso (herramienta `search`, fuente `docs`), vuelve a ejecutar `node --test` y regenera el JSON. No edites el JSON a mano.

---

### Tarea 1: Función `brasper-api` con pruebas

**Archivos:**
- Crear: `kapso/package.json`
- Crear: `kapso/functions/brasper-api.js`
- Probar: `kapso/functions/brasper-api.test.js`
- Modificar: `.gitignore` (crear si no existe)

**Interfaces:**
- Produce: `handler(request, env)` con el contrato de Kapso Functions. Recibe `{ action?, phone?, vars?, available_edges?, execution_context: { vars, context: { phone_number } }, whatsapp_context? }`. La acción sale de `body.action` o de `vars.api_action`, con formato `accion` o `accion:argumento`. Devuelve `{ vars, next_edge? }`. Si hay `available_edges` y `next_edge` no está entre ellas, responde 500 `edge_no_declarado`.
- Produce, por acción (aristas de salida, cuando son nodo decide):
  - `validate:<dni_cpf|monto|numero_cuenta|n_operacion>` → `valido | invalido | escalar`
  - `route_reply:<variable>` → el id del botón elegido, o `invalido | escalar`
  - `media:comprobante` → `foto | sin_foto | escalar`
  - `check_extraction` → `completa | incompleta`
  - `get_rate_quote` → `ok | sin_servicio | par_invalido`
  - `check_tasa` → `vigente | vencida`
  - `check_hours` → `abierto | cerrado`
  - `check_window` → `abierta | cerrada`
  - `check_continue` → `seguir | fin`
  - `get_status` → `e1 | e3 | estado | escalada`
  - `get_client` → `con_cuenta | sin_cuenta`
  - `route_estado` → `verificada | rechazada | otro`
  - sin aristas: `get_operation`, `list_accounts`, `save_account`, `create_operation`, `get_company_account`, `attach_proof`, `cancel_operation`, `handoff_to_human:<motivo>`, `set_status`, `seed_demo`, `reset_demo`
- Produce: variables que usan los mensajes de los workflows: `moneda_origen`, `moneda_destino`, `tasa_txt`, `comision_txt`, `recibe_txt`, `total_enviar_txt`, `monto_txt`, `tasa_hasta`, `cuenta_banco`, `cuenta_ultimos4`, `brasper_titular`, `brasper_banco`, `brasper_cuenta`, `proxima_verificacion`, `operacion_id`, `estado_texto`.

- [ ] **Paso 1: Crear la rama y el andamiaje**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git checkout -b feat/brasper-whatsapp-kapso
mkdir -p kapso/functions kapso/build
node --version   # Esperado: v18 o superior (con node:test)
printf 'kapso/dist/\nnode_modules/\n' >> .gitignore
```

`kapso/package.json`:

```json
{
  "name": "brasper-kapso",
  "private": true,
  "description": "Función simulada y definiciones de workflows de Kapso para el flujo de WhatsApp de BrasPer",
  "scripts": {
    "test": "node --test",
    "emit": "node build/emit.js"
  }
}
```

- [ ] **Paso 2: Escribir las pruebas (deben fallar)**

`kapso/functions/brasper-api.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { handler, parseMonto, normMoneda } = require('./brasper-api.js');

class MemKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { const v = this.m.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
}

const TEL = '51944686794';
function mundo() {
  const env = { KV: new MemKV() };
  const call = async (action, { vars = {}, edges = [], phone = TEL, ahora, wa } = {}) => {
    const body = {
      action,
      execution_context: { vars: { ...vars, ...(ahora ? { simular_ahora: ahora } : {}) }, context: { phone_number: `+${phone}` } },
      available_edges: edges,
      whatsapp_context: wa,
    };
    const res = await handler(new Request('http://f/x', { method: 'POST', body: JSON.stringify(body) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  return { env, call };
}
const entrante = (extra) => ({ messages: [{ direction: 'inbound', created_at: '2026-10-12T15:00:00Z', ...extra }] });
const COTIZACION = { monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' };

test('parseMonto entiende formatos habituales', () => {
  assert.equal(parseMonto('500'), 500);
  assert.equal(parseMonto('500 reales'), 500);
  assert.equal(parseMonto('1.500,50'), 1500.5);
  assert.equal(parseMonto('1,500.50'), 1500.5);
  assert.equal(parseMonto('1.500'), 1500);
  assert.equal(parseMonto('500,5'), 500.5);
  assert.equal(parseMonto('0'), null);
  assert.equal(parseMonto('abc'), null);
  assert.equal(parseMonto(undefined), null);
});

test('normMoneda acepta alias con y sin acentos', () => {
  assert.equal(normMoneda('reales'), 'BRL');
  assert.equal(normMoneda('Soles'), 'PEN');
  assert.equal(normMoneda('dólares'), 'USD');
  assert.equal(normMoneda('euros'), null);
});

test('acción desconocida devuelve 400', async () => {
  const { call } = mundo();
  const r = await call('no_existe');
  assert.equal(r.status, 400);
});

test('validate:dni_cpf distingue DNI y CPF y escala al segundo fallo', async () => {
  const { call } = mundo();
  const E = ['valido', 'invalido', 'escalar'];
  const dni = await call('validate:dni_cpf', { vars: { dni_raw: '12345678' }, edges: E });
  assert.equal(dni.next_edge, 'valido');
  assert.equal(dni.vars.tipo_doc, 'DNI');
  const cpf = await call('validate:dni_cpf', { vars: { dni_raw: '123.456.789-09' }, edges: E });
  assert.equal(cpf.vars.tipo_doc, 'CPF');
  assert.equal(cpf.vars.dni_cpf, '12345678909');
  const f1 = await call('validate:dni_cpf', { vars: { dni_raw: '123' }, edges: E });
  assert.equal(f1.next_edge, 'invalido');
  assert.equal(f1.vars.fallos_dni_cpf, 1);
  const f2 = await call('validate:dni_cpf', { vars: { dni_raw: '12', fallos_dni_cpf: 1 }, edges: E });
  assert.equal(f2.next_edge, 'escalar');
});

test('un dato válido reinicia el contador de fallos', async () => {
  const { call } = mundo();
  const r = await call('validate:monto', { vars: { monto_raw: '500', fallos_monto: 1 }, edges: ['valido', 'invalido', 'escalar'] });
  assert.equal(r.next_edge, 'valido');
  assert.equal(r.vars.fallos_monto, 0);
  assert.equal(r.vars.monto, 500);
});

test('validate:numero_cuenta y n_operacion exigen solo dígitos', async () => {
  const { call } = mundo();
  const E = ['valido', 'invalido', 'escalar'];
  const cta = await call('validate:numero_cuenta', { vars: { numero_cuenta_raw: '1234 5678 4821' }, edges: E });
  assert.equal(cta.vars.cuenta_ultimos4, '4821');
  assert.equal((await call('validate:numero_cuenta', { vars: { numero_cuenta_raw: 'abc' }, edges: E })).next_edge, 'invalido');
  assert.equal((await call('validate:n_operacion', { vars: { n_operacion_raw: '000123' }, edges: E })).next_edge, 'valido');
  assert.equal((await call('validate:n_operacion', { vars: { n_operacion_raw: '12' }, edges: E })).next_edge, 'invalido');
});

test('route_reply devuelve el id del botón y escala tras dos respuestas inválidas', async () => {
  const { call } = mundo();
  const E = ['continuar', 'cambiar_monto', 'persona', 'invalido', 'escalar'];
  const ok = await call('route_reply:accion_e1', { edges: E, wa: entrante({ reply_option_id: 'cambiar_monto' }) });
  assert.equal(ok.next_edge, 'cambiar_monto');
  assert.equal(ok.vars.accion_e1, 'cambiar_monto');
  const f1 = await call('route_reply:accion_e1', { edges: E, wa: entrante({ content: 'hola' }) });
  assert.equal(f1.next_edge, 'invalido');
  const f2 = await call('route_reply:accion_e1', { vars: { fallos_accion_e1: 1 }, edges: E, wa: entrante({ content: 'cancelar' }) });
  assert.equal(f2.next_edge, 'escalar');
});

test('media:comprobante acepta imagen o documento y repite si llega texto', async () => {
  const { call } = mundo();
  const E = ['foto', 'sin_foto', 'escalar'];
  const img = await call('media:comprobante', { edges: E, wa: entrante({ has_media: true, message_type: 'image', whatsapp_message_id: 'wamid.1' }) });
  assert.equal(img.next_edge, 'foto');
  assert.equal(img.vars.comprobante_msg_id, 'wamid.1');
  const txt = await call('media:comprobante', { edges: E, wa: entrante({ message_type: 'text', content: '000123' }) });
  assert.equal(txt.next_edge, 'sin_foto');
  const txt2 = await call('media:comprobante', { vars: { fallos_comprobante: 1 }, edges: E, wa: entrante({ message_type: 'text' }) });
  assert.equal(txt2.next_edge, 'escalar');
});

test('check_extraction normaliza alias y exige monedas distintas', async () => {
  const { call } = mundo();
  const E = ['completa', 'incompleta'];
  const ok = await call('check_extraction', { vars: { monto: '500', moneda_origen: 'reales', moneda_destino: 'Soles' }, edges: E });
  assert.deepEqual([ok.next_edge, ok.vars.moneda_origen, ok.vars.moneda_destino, ok.vars.monto], ['completa', 'BRL', 'PEN', 500]);
  assert.equal((await call('check_extraction', { vars: { monto: 500, moneda_origen: 'BRL' }, edges: E })).next_edge, 'incompleta');
  assert.equal((await call('check_extraction', { vars: { monto: 500, moneda_origen: 'BRL', moneda_destino: 'reales' }, edges: E })).next_edge, 'incompleta');
  assert.equal((await call('check_extraction', { vars: {}, edges: E })).next_edge, 'incompleta');
});

test('get_rate_quote calcula con datos de demostración y fija 15 minutos de vigencia', async () => {
  const { call } = mundo();
  const E = ['ok', 'sin_servicio', 'par_invalido'];
  const r = await call('get_rate_quote', { vars: COTIZACION, edges: E, ahora: '2026-10-12T15:00:00Z' });
  assert.equal(r.next_edge, 'ok');
  assert.equal(r.vars.recibe_txt, '350.00');
  assert.equal(r.vars.comision_txt, '5.00');
  assert.equal(r.vars.total_enviar_txt, '505.00');
  assert.equal(r.vars.tasa_txt, '0.7');
  assert.equal(r.vars.tasa_hasta, '10:15');
  assert.equal(r.vars.tasa_hasta_iso, '2026-10-12T15:15:00.000Z');
});

test('get_rate_quote: servicio caído y par inválido no inventan tasa', async () => {
  const { call } = mundo();
  const E = ['ok', 'sin_servicio', 'par_invalido'];
  const caido = await call('get_rate_quote', { vars: { ...COTIZACION, simular_tasas_caidas: true }, edges: E });
  assert.equal(caido.next_edge, 'sin_servicio');
  assert.equal(caido.vars.tasa, undefined);
  assert.equal((await call('get_rate_quote', { vars: { ...COTIZACION, moneda_destino: 'BRL' }, edges: E })).next_edge, 'par_invalido');
  assert.equal((await call('get_rate_quote', { vars: { ...COTIZACION, monto: 0 }, edges: E })).next_edge, 'par_invalido');
});

test('check_tasa distingue tasa vigente y vencida', async () => {
  const { call } = mundo();
  const E = ['vigente', 'vencida'];
  const vars = { tasa_hasta_iso: '2026-10-12T15:15:00.000Z' };
  assert.equal((await call('check_tasa', { vars, edges: E, ahora: '2026-10-12T15:10:00Z' })).next_edge, 'vigente');
  assert.equal((await call('check_tasa', { vars, edges: E, ahora: '2026-10-12T15:20:00Z' })).next_edge, 'vencida');
  assert.equal((await call('check_tasa', { vars: {}, edges: E })).next_edge, 'vencida');
});

test('check_hours usa el horario de Lima y dice cuándo se verifica', async () => {
  const { call } = mundo();
  const E = ['abierto', 'cerrado'];
  const dom10 = await call('check_hours', { edges: E, ahora: '2026-10-11T15:00:00Z' }); // domingo 10:00 Lima
  assert.equal(dom10.next_edge, 'cerrado');
  assert.equal(dom10.vars.proxima_verificacion, 'hoy a las 12:00 p. m.');
  const dom15 = await call('check_hours', { edges: E, ahora: '2026-10-11T20:00:00Z' }); // domingo 15:00 Lima
  assert.equal(dom15.vars.proxima_verificacion, 'mañana a las 7:00 a. m.');
  const sab15 = await call('check_hours', { edges: E, ahora: '2026-10-10T20:00:00Z' }); // sábado 15:00 Lima
  assert.equal(sab15.vars.proxima_verificacion, 'mañana a las 12:00 p. m.');
  const lun6 = await call('check_hours', { edges: E, ahora: '2026-10-12T11:00:00Z' }); // lunes 06:00 Lima
  assert.equal(lun6.vars.proxima_verificacion, 'hoy a las 7:00 a. m.');
  assert.equal((await call('check_hours', { edges: E, ahora: '2026-10-12T17:00:00Z' })).next_edge, 'abierto'); // lunes 12:00 Lima
});

test('check_window: abierta solo si el cliente escribió hace menos de 23 h', async () => {
  const { call } = mundo();
  const E = ['abierta', 'cerrada'];
  assert.equal((await call('check_window', { edges: E })).next_edge, 'cerrada');
  await call('get_status', { edges: ['e1', 'e3', 'estado', 'escalada'], wa: entrante({ created_at: '2026-10-12T15:00:00Z' }) });
  assert.equal((await call('check_window', { edges: E, ahora: '2026-10-12T20:00:00Z' })).next_edge, 'abierta');
  assert.equal((await call('check_window', { edges: E, ahora: '2026-10-13T16:00:00Z' })).next_edge, 'cerrada');
});

test('clientes y cuentas: seed, get_client, save_account', async () => {
  const { call } = mundo();
  const E = ['con_cuenta', 'sin_cuenta'];
  const antes = await call('get_client', { vars: { moneda_destino: 'PEN' }, edges: E });
  assert.equal(antes.next_edge, 'sin_cuenta');
  await call('seed_demo');
  const seed = await call('get_client', { vars: { moneda_destino: 'PEN' }, edges: E });
  assert.deepEqual([seed.next_edge, seed.vars.cuenta_banco, seed.vars.cuenta_ultimos4], ['con_cuenta', 'Scotiabank', '9956']);
  assert.equal((await call('get_client', { vars: { moneda_destino: 'BRL' }, edges: E })).next_edge, 'sin_cuenta');
  const nueva = await call('save_account', { vars: { cuenta_banco_nuevo: 'BCP', cuenta_numero_nuevo: '19412345678904821', moneda_destino: 'BRL' } });
  assert.equal(nueva.vars.cuenta_ultimos4, '4821');
  assert.equal((await call('get_client', { vars: { moneda_destino: 'BRL' }, edges: E })).vars.cuenta_banco, 'BCP');
  assert.equal((await call('list_accounts')).vars.cuentas.length, 2);
});

test('ciclo de una operación: crear, mostrar cuenta, adjuntar comprobante, verificar', async () => {
  const { call } = mundo();
  const R = ['e1', 'e3', 'estado', 'escalada'];
  assert.equal((await call('get_status', { edges: R })).next_edge, 'e1');
  const vars = { ...COTIZACION, recibe_txt: '350.00', total_enviar_txt: '505.00', banco_origen: 'BCP', cuenta_ultimos4: '9956' };
  const op = await call('create_operation', { vars });
  assert.equal(op.vars.operacion_id, 'BR-0001');
  assert.equal(op.vars.estado, 'pendiente');
  const e3 = await call('get_status', { edges: R });
  assert.equal(e3.next_edge, 'e3');
  assert.equal(e3.vars.operacion_id, 'BR-0001');
  assert.equal(e3.vars.total_enviar_txt, '505.00');
  const cta = await call('get_company_account', { vars: { operacion_id: 'BR-0001', moneda_origen: 'BRL', banco_origen: 'BCP' } });
  assert.deepEqual([cta.vars.brasper_titular, cta.vars.brasper_banco, cta.vars.brasper_cuenta], ['BrasPer (DEMO)', 'BCP', 'DEMO-BRL-0001']);
  await call('attach_proof', { vars: { operacion_id: 'BR-0001', comprobante_msg_id: 'wamid.1', n_operacion_bancaria: '000123' } });
  const val = await call('get_status', { edges: R });
  assert.equal(val.next_edge, 'estado');
  assert.equal(val.vars.estado, 'en_validacion');
  assert.match(val.vars.estado_texto, /una persona revisa tu pago/);
  await call('set_status', { vars: { operacion_id: 'BR-0001', estado: 'verificada' } });
  const op2 = await call('get_operation', { vars: { operacion_id: 'BR-0001' } });
  assert.deepEqual([op2.vars.estado, op2.vars.recibe_txt], ['verificada', '350.00']);
  assert.equal((await call('route_estado', { vars: { estado: 'verificada' }, edges: ['verificada', 'rechazada', 'otro'] })).next_edge, 'verificada');
  assert.equal((await call('route_estado', { vars: { estado: 'rechazada' }, edges: ['verificada', 'rechazada', 'otro'] })).next_edge, 'rechazada');
  assert.equal((await call('route_estado', { vars: { estado: 'en_validacion' }, edges: ['verificada', 'rechazada', 'otro'] })).next_edge, 'otro');
});

test('operaciones sucesivas incrementan el id y cancelar libera al cliente', async () => {
  const { call } = mundo();
  const R = ['e1', 'e3', 'estado', 'escalada'];
  await call('create_operation', { vars: COTIZACION });
  const dos = await call('create_operation', { vars: COTIZACION });
  assert.equal(dos.vars.operacion_id, 'BR-0002');
  await call('cancel_operation', { vars: { operacion_id: 'BR-0002' } });
  assert.equal((await call('get_status', { edges: R })).next_edge, 'e1');
});

test('handoff_to_human marca la operación como escalada y get_status lo refleja', async () => {
  const { call } = mundo();
  const R = ['e1', 'e3', 'estado', 'escalada'];
  await call('create_operation', { vars: COTIZACION });
  const h = await call('handoff_to_human:tasas_no_disponibles', { vars: { operacion_id: 'BR-0001' } });
  assert.equal(h.vars.escalada, true);
  assert.equal((await call('get_status', { edges: R })).next_edge, 'escalada');
});

test('get_rate_quote actualiza la cotización de la operación al recotizar', async () => {
  const { call } = mundo();
  await call('create_operation', { vars: { ...COTIZACION, tasa_txt: '0.7' } });
  await call('get_rate_quote', { vars: { ...COTIZACION, operacion_id: 'BR-0001', monto: 1000 }, edges: ['ok', 'sin_servicio', 'par_invalido'], ahora: '2026-10-12T15:00:00Z' });
  const op = await call('get_operation', { vars: { operacion_id: 'BR-0001' } });
  assert.equal(op.vars.recibe_txt, '700.00');
});

test('check_continue y reset_demo', async () => {
  const { call } = mundo();
  assert.equal((await call('check_continue', { vars: { continuar: 'si' }, edges: ['seguir', 'fin'] })).next_edge, 'seguir');
  assert.equal((await call('check_continue', { vars: { continuar: 'no' }, edges: ['seguir', 'fin'] })).next_edge, 'fin');
  await call('create_operation', { vars: COTIZACION });
  await call('reset_demo');
  assert.equal((await call('get_status', { edges: ['e1', 'e3', 'estado', 'escalada'] })).next_edge, 'e1');
});

test('si la función devuelve una arista no declarada, responde 500 en vez de enrutar mal', async () => {
  const { call } = mundo();
  const r = await call('check_continue', { vars: { continuar: 'si' }, edges: ['otra'] });
  assert.equal(r.status, 500);
  assert.equal(r.error, 'edge_no_declarado');
});

test('set_status rechaza estados inválidos y operaciones inexistentes', async () => {
  const { call } = mundo();
  assert.equal((await call('set_status', { vars: { operacion_id: 'BR-0009', estado: 'verificada' } })).status, 500);
  await call('create_operation', { vars: COTIZACION });
  assert.equal((await call('set_status', { vars: { operacion_id: 'BR-0001', estado: 'inventado' } })).status, 500);
});

test('el teléfono se normaliza: con y sin signo + apuntan al mismo cliente', async () => {
  const { call } = mundo();
  await call('seed_demo', { phone: '+51944686794' });
  const r = await call('get_client', { vars: { moneda_destino: 'PEN' }, edges: ['con_cuenta', 'sin_cuenta'], phone: '51944686794' });
  assert.equal(r.next_edge, 'con_cuenta');
});
```

- [ ] **Paso 3: Ejecutar y comprobar que falla**

Ejecuta: `cd kapso && node --test`

Esperado: FALLA con `Cannot find module './brasper-api.js'`.

- [ ] **Paso 4: Escribir la implementación**

`kapso/functions/brasper-api.js`:

```javascript
// Kapso Function (Cloudflare Worker): API simulada de BrasPer para la demo.
// Contrato: la acción llega en vars.api_action ("accion" o "accion:argumento").
// Todos los datos son de demostración: tasas, cuenta de BrasPer y clientes son ficticios.

const MONEDAS = ['BRL', 'PEN', 'USD'];
const ALIAS_MONEDA = {
  BRL: 'BRL', REAL: 'BRL', REALES: 'BRL', 'R$': 'BRL',
  PEN: 'PEN', SOL: 'PEN', SOLES: 'PEN', 'S/': 'PEN',
  USD: 'USD', DOLAR: 'USD', DOLARES: 'USD', $: 'USD',
};
const TASAS_DEMO = { 'BRL>PEN': 0.7, 'PEN>BRL': 1.4, 'USD>PEN': 3.4, 'PEN>USD': 0.29, 'USD>BRL': 5.3, 'BRL>USD': 0.19 };
const COMISION_PCT = 0.01;
const VIGENCIA_TASA_MIN = 15;
const VENTANA_HORAS = 23;
// [apertura, cierre] en hora de Lima, por día de la semana (0 = domingo). Fuente: sección de horarios de brasper.com/es.
const HORARIO = { 0: [12, 14], 1: [7, 18], 2: [7, 18], 3: [7, 18], 4: [7, 18], 5: [7, 18], 6: [8, 14] };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ESTADOS = ['pendiente', 'esperando_transferencia', 'en_validacion', 'verificada', 'enviada', 'completada', 'rechazada', 'cancelada', 'escalada'];
const RUTA_ESTADO = { pendiente: 'e3', esperando_transferencia: 'e3', en_validacion: 'estado', verificada: 'estado', enviada: 'estado', rechazada: 'estado', escalada: 'escalada' };
const ESTADO_TEXTO = {
  en_validacion: 'en validación: una persona revisa tu pago',
  verificada: 'verificada: estamos enviando tu dinero',
  enviada: 'enviada: tu dinero ya fue enviado',
  rechazada: 'con un problema de validación: una persona te contactará',
};
const SNAP_KEYS = [
  'monto', 'moneda_origen', 'moneda_destino', 'tasa', 'tasa_txt', 'comision_txt', 'recibe_txt', 'total_enviar_txt',
  'monto_txt', 'tasa_hasta', 'tasa_hasta_iso', 'banco_origen', 'origen_fondos', 'dni_cpf', 'tipo_doc',
  'cuenta_id', 'cuenta_banco', 'cuenta_ultimos4',
];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const round2 = (n) => Math.round(n * 100) / 100;
const normPhone = (p) => String(p || '').replace(/\D/g, '');
const sinAcentos = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const digitos = (s) => String(s || '').replace(/[\s.\-]/g, '');

function normMoneda(s) {
  if (s === undefined || s === null) return null;
  return ALIAS_MONEDA[sinAcentos(String(s)).trim().toUpperCase()] || null;
}

function parseMonto(s) {
  const m = String(s === undefined || s === null ? '' : s).match(/\d[\d.,]*/);
  if (!m) return null;
  let t = m[0].replace(/[.,]+$/, '');
  const sep = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  if (sep > -1 && t.length - sep - 1 <= 2) t = `${t.slice(0, sep).replace(/[.,]/g, '')}.${t.slice(sep + 1)}`;
  else t = t.replace(/[.,]/g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

// Hora de Lima (UTC-5, sin horario de verano).
function lima(date) {
  const d = new Date(date.getTime() - 5 * 3600 * 1000);
  return { dow: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes() };
}
const fmtHora = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'a. m.' : 'p. m.'}`;
const pad2 = (n) => String(n).padStart(2, '0');

function proximaApertura(now) {
  const { dow, h } = lima(now);
  for (let off = 0; off <= 7; off++) {
    const dia = (dow + off) % 7;
    const [ap] = HORARIO[dia];
    if (off === 0 && h >= ap) continue;
    const cuando = off === 0 ? 'hoy' : off === 1 ? 'mañana' : `el ${DIAS[dia]}`;
    return `${cuando} a las ${fmtHora(ap)}`;
  }
  return '';
}

const kv = (env) => ({
  get: (k) => env.KV.get(k, 'json'),
  put: (k, v) => env.KV.put(k, JSON.stringify(v)),
  del: (k) => env.KV.delete(k),
});

const getOp = (db, id) => (id ? db.get(`op:${id}`) : Promise.resolve(null));
async function getActiveOp(db, phone) {
  return getOp(db, await db.get(`active:${phone}`));
}
const saveOp = (db, op) => db.put(`op:${op.id}`, op);
const snapDe = (vars) => Object.fromEntries(SNAP_KEYS.filter((k) => vars[k] !== undefined).map((k) => [k, vars[k]]));

// Fallos consecutivos por paso: el segundo escala a una persona.
function fallo(vars, key) {
  const n = (Number(vars[`fallos_${key}`]) || 0) + 1;
  return { vars: { [`fallos_${key}`]: n }, next_edge: n >= 2 ? 'escalar' : 'invalido' };
}
const reinicio = (key, extra = {}) => ({ [`fallos_${key}`]: 0, ...extra });

const ultimoEntrante = (wa) => [...((wa && wa.messages) || [])].reverse().find((m) => m.direction === 'inbound');

const VALIDADORES = {
  dni_cpf: {
    src: 'dni_raw',
    run: (s) => {
      const d = digitos(s);
      if (/^\d{8}$/.test(d)) return { dni_cpf: d, tipo_doc: 'DNI' };
      if (/^\d{11}$/.test(d)) return { dni_cpf: d, tipo_doc: 'CPF' };
      return null;
    },
  },
  monto: {
    src: 'monto_raw',
    run: (s) => {
      const n = parseMonto(s);
      return n ? { monto: n } : null;
    },
  },
  numero_cuenta: {
    src: 'numero_cuenta_raw',
    run: (s) => {
      const d = digitos(s);
      return /^\d{8,20}$/.test(d) ? { cuenta_numero_nuevo: d, cuenta_ultimos4: d.slice(-4) } : null;
    },
  },
  n_operacion: {
    src: 'n_operacion_raw',
    run: (s) => {
      const d = digitos(s);
      return /^\d{4,20}$/.test(d) ? { n_operacion_bancaria: d } : null;
    },
  },
};

const ACCIONES = {
  validate: async ({ vars, arg }) => {
    const v = VALIDADORES[arg];
    if (!v) throw new Error(`validador desconocido: ${arg}`);
    const res = v.run(vars[v.src]);
    if (!res) return fallo(vars, arg);
    return { vars: reinicio(arg, res), next_edge: 'valido' };
  },

  route_reply: async ({ vars, arg, edges, wa }) => {
    const m = ultimoEntrante(wa);
    const id = m && m.reply_option_id;
    if (id && edges.includes(id)) return { vars: reinicio(arg, { [arg]: id }), next_edge: id };
    return fallo(vars, arg);
  },

  media: async ({ vars, arg, wa }) => {
    const m = ultimoEntrante(wa);
    if (m && m.has_media && ['image', 'document'].includes(m.message_type)) {
      return { vars: reinicio(arg, { comprobante_msg_id: m.whatsapp_message_id || m.id }), next_edge: 'foto' };
    }
    const f = fallo(vars, arg);
    return { vars: f.vars, next_edge: f.next_edge === 'invalido' ? 'sin_foto' : 'escalar' };
  },

  check_extraction: async ({ vars }) => {
    const monto = parseMonto(vars.monto);
    const o = normMoneda(vars.moneda_origen);
    const d = normMoneda(vars.moneda_destino);
    if (monto && o && d && o !== d) {
      return { vars: { monto, moneda_origen: o, moneda_destino: d }, next_edge: 'completa' };
    }
    return { vars: {}, next_edge: 'incompleta' };
  },

  get_rate_quote: async ({ env, vars, now }) => {
    const db = kv(env);
    const o = normMoneda(vars.moneda_origen);
    const d = normMoneda(vars.moneda_destino);
    const monto = parseMonto(vars.monto);
    if (vars.simular_tasas_caidas || env.TASAS_CAIDAS === '1') return { vars: { cotizacion_ok: false }, next_edge: 'sin_servicio' };
    const tasa = TASAS_DEMO[`${o}>${d}`];
    if (!o || !d || o === d || !tasa || !monto) return { vars: { cotizacion_ok: false }, next_edge: 'par_invalido' };
    const comision = round2(monto * COMISION_PCT);
    const hasta = new Date(now.getTime() + VIGENCIA_TASA_MIN * 60000);
    const hl = lima(hasta);
    const out = {
      cotizacion_ok: true, monto, moneda_origen: o, moneda_destino: d, tasa,
      tasa_txt: String(Number(tasa.toFixed(4))),
      monto_txt: monto.toFixed(2), comision_txt: comision.toFixed(2),
      recibe_txt: round2(monto * tasa).toFixed(2), total_enviar_txt: round2(monto + comision).toFixed(2),
      tasa_hasta: `${pad2(hl.h)}:${pad2(hl.m)}`, tasa_hasta_iso: hasta.toISOString(),
    };
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, snap: { ...op.snap, ...snapDe(out) } });
    return { vars: out, next_edge: 'ok' };
  },

  check_tasa: async ({ vars, now }) => ({
    vars: {},
    next_edge: vars.tasa_hasta_iso && new Date(vars.tasa_hasta_iso) > now ? 'vigente' : 'vencida',
  }),

  check_hours: async ({ now }) => {
    const { dow, h } = lima(now);
    const [ap, ci] = HORARIO[dow];
    if (h >= ap && h < ci) return { vars: { horario_abierto: true, proxima_verificacion: '' }, next_edge: 'abierto' };
    return { vars: { horario_abierto: false, proxima_verificacion: proximaApertura(now) }, next_edge: 'cerrado' };
  },

  check_window: async ({ env, phone, now }) => {
    const visto = await kv(env).get(`seen:${phone}`);
    const abierta = visto && now - new Date(visto) < VENTANA_HORAS * 3600 * 1000;
    return { vars: {}, next_edge: abierta ? 'abierta' : 'cerrada' };
  },

  check_continue: async ({ vars }) => ({ vars: {}, next_edge: vars.continuar === 'si' ? 'seguir' : 'fin' }),

  get_status: async ({ env, phone }) => {
    const op = await getActiveOp(kv(env), phone);
    if (!op) return { vars: { estado: 'sin_operacion' }, next_edge: 'e1' };
    const ruta = RUTA_ESTADO[op.estado] || 'e1';
    if (ruta === 'e1') return { vars: { estado: op.estado }, next_edge: 'e1' };
    return {
      vars: { ...op.snap, operacion_id: op.id, estado: op.estado, estado_texto: ESTADO_TEXTO[op.estado] || op.estado },
      next_edge: ruta,
    };
  },

  get_operation: async ({ env, vars, phone }) => {
    const db = kv(env);
    const op = (await getOp(db, vars.operacion_id)) || (await getActiveOp(db, phone));
    if (!op) return { vars: { estado: 'sin_operacion' } };
    return { vars: { ...op.snap, operacion_id: op.id, estado: op.estado } };
  },

  route_estado: async ({ vars }) => ({
    vars: {},
    next_edge: ['verificada', 'enviada', 'completada'].includes(vars.estado) ? 'verificada' : vars.estado === 'rechazada' ? 'rechazada' : 'otro',
  }),

  get_client: async ({ env, vars, phone }) => {
    const cliente = await kv(env).get(`client:${phone}`);
    const cuenta = cliente && cliente.cuentas.find((c) => c.moneda === normMoneda(vars.moneda_destino));
    if (!cuenta) return { vars: { cliente_existe: Boolean(cliente) }, next_edge: 'sin_cuenta' };
    return {
      vars: { cliente_existe: true, cuenta_id: cuenta.id, cuenta_banco: cuenta.banco, cuenta_ultimos4: cuenta.ultimos4, correo: cliente.correo || '' },
      next_edge: 'con_cuenta',
    };
  },

  list_accounts: async ({ env, phone }) => {
    const cliente = await kv(env).get(`client:${phone}`);
    return { vars: { cuentas: (cliente && cliente.cuentas) || [] } };
  },

  save_account: async ({ env, vars, phone }) => {
    const db = kv(env);
    const cliente = (await db.get(`client:${phone}`)) || { cuentas: [], correo: '' };
    const n = (Number(await db.get('seq_cuentas')) || 0) + 1;
    await db.put('seq_cuentas', n);
    const cuenta = {
      id: `acc_${n}`, banco: vars.cuenta_banco_nuevo, ultimos4: String(vars.cuenta_numero_nuevo).slice(-4),
      moneda: normMoneda(vars.moneda_destino),
    };
    cliente.cuentas.push(cuenta);
    await db.put(`client:${phone}`, cliente);
    return { vars: { cuenta_id: cuenta.id, cuenta_banco: cuenta.banco, cuenta_ultimos4: cuenta.ultimos4 } };
  },

  create_operation: async ({ env, vars, phone, now }) => {
    const db = kv(env);
    const n = (Number(await db.get('seq_operaciones')) || 0) + 1;
    await db.put('seq_operaciones', n);
    const id = `BR-${String(n).padStart(4, '0')}`;
    await saveOp(db, { id, phone, estado: 'pendiente', creada: now.toISOString(), snap: snapDe(vars) });
    await db.put(`active:${phone}`, id);
    return { vars: { operacion_id: id, estado: 'pendiente' } };
  },

  get_company_account: async ({ env, vars }) => {
    const db = kv(env);
    const op = await getOp(db, vars.operacion_id);
    if (op && op.estado === 'pendiente') await saveOp(db, { ...op, estado: 'esperando_transferencia' });
    return {
      vars: {
        brasper_titular: 'BrasPer (DEMO)',
        brasper_banco: vars.banco_origen || 'Banco DEMO',
        brasper_cuenta: `DEMO-${normMoneda(vars.moneda_origen) || 'XXX'}-0001`,
      },
    };
  },

  attach_proof: async ({ env, vars }) => {
    const db = kv(env);
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, estado: 'en_validacion', proof: { mensaje: vars.comprobante_msg_id, n_operacion: vars.n_operacion_bancaria } });
    return { vars: { estado: 'en_validacion' } };
  },

  cancel_operation: async ({ env, vars, phone }) => {
    const db = kv(env);
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, estado: 'cancelada' });
    await db.del(`active:${phone}`);
    return { vars: { estado: 'cancelada' } };
  },

  handoff_to_human: async ({ env, vars, phone, arg, now }) => {
    const db = kv(env);
    await db.put(`handoff:${phone}`, { motivo: arg || 'sin_motivo', operacion_id: vars.operacion_id || null, en: now.toISOString() });
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, estado: 'escalada' });
    return { vars: { escalada: true } };
  },

  // --- Simulación del backend y utilidades de demo: se invocan a mano con functions.invoke ---
  set_status: async ({ env, vars }) => {
    const db = kv(env);
    if (!ESTADOS.includes(vars.estado)) throw new Error(`estado inválido: ${vars.estado}`);
    const op = await getOp(db, vars.operacion_id);
    if (!op) throw new Error(`operación no encontrada: ${vars.operacion_id}`);
    await saveOp(db, { ...op, estado: vars.estado });
    return { vars: { estado: vars.estado, operacion_id: op.id } };
  },

  seed_demo: async ({ env, phone }) => {
    await kv(env).put(`client:${phone}`, {
      correo: 'demo@example.com',
      cuentas: [{ id: 'acc_demo', banco: 'Scotiabank', ultimos4: '9956', moneda: 'PEN' }],
    });
    return { vars: { seed: true } };
  },

  reset_demo: async ({ env, phone }) => {
    const db = kv(env);
    for (const k of ['active', 'seen', 'handoff']) await db.del(`${k}:${phone}`);
    return { vars: { reset: true } };
  },
};

async function tocarVisto({ env, phone, wa }) {
  const m = ultimoEntrante(wa);
  if (phone && m && m.created_at) await kv(env).put(`seen:${phone}`, m.created_at);
}

async function handler(request, env) {
  const body = await request.json().catch(() => ({}));
  const ctx = body.execution_context || {};
  const vars = { ...(ctx.vars || {}), ...(body.vars || {}) };
  const edges = body.available_edges || [];
  const phone = normPhone(body.phone || (ctx.context && ctx.context.phone_number));
  const raw = String(body.action || vars.api_action || '');
  const i = raw.indexOf(':');
  const accion = i === -1 ? raw : raw.slice(0, i);
  const arg = i === -1 ? '' : raw.slice(i + 1);
  const fn = ACCIONES[accion];
  if (!fn) return json({ error: 'accion_desconocida', accion }, 400);
  const now = vars.simular_ahora ? new Date(vars.simular_ahora) : new Date();
  const io = { env, vars, phone, edges, arg, now, wa: body.whatsapp_context || null };
  try {
    await tocarVisto(io);
    const out = await fn(io);
    if (edges.length && !edges.includes(out.next_edge)) {
      return json({ error: 'edge_no_declarado', next_edge: out.next_edge, edges }, 500);
    }
    return json(out);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

// Solo para las pruebas locales con node:test. En Cloudflare Workers `module` no existe.
if (typeof module !== 'undefined') module.exports = { handler, parseMonto, normMoneda, MONEDAS, TASAS_DEMO };
```

- [ ] **Paso 5: Ejecutar y comprobar que pasa**

Ejecuta: `cd kapso && node --test`

Esperado: `tests 23`, `pass 23`, `fail 0`.

- [ ] **Paso 6: Comprobar que las pruebas detectan errores**

```bash
cd kapso && cp functions/brasper-api.js /tmp/brasper-api.orig
sed -i '' "s/n >= 2 ? 'escalar'/n >= 3 ? 'escalar'/" functions/brasper-api.js && node --test 2>&1 | grep -E 'ℹ (pass|fail)'
cp /tmp/brasper-api.orig functions/brasper-api.js
sed -i '' "s/const COMISION_PCT = 0.01/const COMISION_PCT = 0.02/" functions/brasper-api.js && node --test 2>&1 | grep -E 'ℹ (pass|fail)'
cp /tmp/brasper-api.orig functions/brasper-api.js && node --test 2>&1 | grep -E 'ℹ (pass|fail)'
```

Esperado: la primera ejecución muestra `fail 3`, la segunda `fail 1` y la tercera `pass 23`, `fail 0`. En Linux, usa `sed -i` sin `''`.

- [ ] **Paso 7: Commit**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git add .gitignore kapso/package.json kapso/functions/brasper-api.js kapso/functions/brasper-api.test.js
git commit -m "feat: función brasper-api simulada con pruebas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: Constructor y definiciones de los workflows

**Archivos:**
- Crear: `kapso/build/flow.js`, `kapso/build/workflows.js`, `kapso/build/spike.js`, `kapso/build/emit.js`
- Probar: `kapso/build/workflows.test.js`

**Interfaces:**
- Consume: los nombres de acción y las aristas de la tarea 1 (cada `f.api(id, accion, { edges })` debe usar exactamente esas aristas).
- Produce: `buildFlows()` → `{ E1, E2, E3, E4, W0 }` y `buildSpike()` → `{ S1, S2C, S2P, S3, S4 }`; cada uno es un `Flow` con `definition(ids)`, `triggers`, `nodes`, `edges`. `validar(flow, clavesConocidas)` → lista de errores. `node build/emit.js [--strict] [--spike]` escribe `kapso/dist/<slug>.json`. `ids` tiene la forma `{ functionId, workflows: { E1, E2, E3, E4, W0, S2C, ... } }` y se lee de `kapso/ids.json`.

- [ ] **Paso 1: Escribir las pruebas (deben fallar)**

`kapso/build/workflows.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFlows } = require('./workflows');
const { buildSpike } = require('./spike');
const { validar, Flow, LIMITES } = require('./flow');

const flows = buildFlows();
const claves = Object.keys(flows);
const IDS = { functionId: 'fn-1', workflows: Object.fromEntries(claves.map((k) => [k, `wf-${k}`])) };

// Variables que producen la función brasper-api, los nodos wait y el agente de extracción.
const VARS_CONOCIDAS = new Set([
  'moneda_origen', 'moneda_destino', 'tasa_txt', 'comision_txt', 'recibe_txt', 'total_enviar_txt', 'monto_txt', 'tasa_hasta',
  'cuenta_banco', 'cuenta_ultimos4', 'cuenta_banco_nuevo', 'brasper_titular', 'brasper_banco', 'brasper_cuenta',
  'proxima_verificacion', 'operacion_id', 'estado_texto',
]);

for (const k of claves) {
  test(`${k}: el grafo es consistente y respeta los límites de WhatsApp`, () => {
    assert.deepEqual(validar(flows[k], claves), []);
  });
}

test('las variables usadas en los mensajes existen', () => {
  const usadas = new Set();
  for (const f of Object.values(flows)) {
    for (const n of f.nodes) {
      const c = n.config;
      const textos = [c.message, c.body_text, ...((c.buttons || []).map((b) => b.title))].filter(Boolean);
      for (const t of textos) for (const m of t.matchAll(/\{\{vars\.(\w+)\}\}/g)) usadas.add(m[1]);
    }
  }
  const desconocidas = [...usadas].filter((v) => !VARS_CONOCIDAS.has(v));
  assert.deepEqual(desconocidas, []);
});

test('toda respuesta por botón o lista tiene salida para "invalido" y "escalar"', () => {
  for (const f of Object.values(flows)) {
    for (const n of f.nodes.filter((x) => x.nodeType === 'decide')) {
      const labels = n.config.conditions.map((c) => c.label);
      if (labels.includes('invalido')) assert.ok(labels.includes('escalar'), `${f.key}/${n.id} sin escalar`);
    }
  }
});

test('definition() resuelve function_id y workflow_id y no deja claves temporales', () => {
  const def = flows.W0.definition(IDS);
  const call = def.nodes.find((n) => n.id === 'c1');
  assert.equal(call.data.config.workflow_id, 'wf-E1');
  assert.equal('workflow_key' in call.data.config, false);
  const decide = def.nodes.find((n) => n.id === 'estado');
  assert.equal(decide.data.config.function_id, 'fn-1');
  assert.ok(def.edges.every((e) => e.id && e.source && e.target && e.label));
  assert.ok(def.nodes.every((n) => n.type === 'flow-node' && n.position.x >= 100));
});

test('W0 se dispara por mensaje entrante y E4 por API', () => {
  assert.equal(flows.W0.triggers[0].trigger_type, 'inbound_message');
  assert.equal(flows.E4.triggers[0].trigger_type, 'api_call');
  assert.deepEqual(flows.E1.triggers, []);
});

test('E1 ofrece exactamente 3 botones de respuesta y un enlace aparte', () => {
  const oferta = flows.E1.nodes.find((n) => n.id === 'oferta').config;
  assert.deepEqual(oferta.buttons.map((b) => b.title), ['Continuar', 'Cambiar monto', 'Hablar con persona']);
  assert.equal(flows.E1.nodes.find((n) => n.id === 'web').config.interactive_type, 'cta_url');
});

test('el validador detecta errores reales', () => {
  const malo = new Flow('X', 'x', 'x');
  malo.start();
  malo.buttons('b', 'cuerpo', [{ id: 'a', title: 'Hablar con una persona' }, { id: 'b', title: 'Otro' }, { id: 'c', title: 'Tres' }, { id: 'd', title: 'Cuatro' }]);
  malo.api('d', 'route_reply:x', { edges: ['a', 'b'] });
  malo.link('start', 'b').link('b', 'd').link('d', 'b', 'a');
  malo.text('huerfano', 'hola');
  const errs = validar(malo, []).join('\n');
  assert.match(errs, /excede 20 caracteres/);
  assert.match(errs, /de 1 a 3 botones/);
  assert.match(errs, /condiciones \[a\|b\] != aristas \[a\]/);
  assert.match(errs, /inalcanzable desde start: huerfano/);
  assert.equal(LIMITES.botonTitulo, 20);
});

test('los workflows del spike también son consistentes', () => {
  const spike = buildSpike();
  const todas = [...Object.keys(spike), ...claves];
  for (const f of Object.values(spike)) assert.deepEqual(validar(f, todas), [], f.key);
});
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecuta: `cd kapso && node --test build/workflows.test.js`

Esperado: FALLA con `Cannot find module './workflows'`.

- [ ] **Paso 3: Escribir el constructor y su validador**

`kapso/build/flow.js`:

```javascript
// Constructor de workflows de Kapso: genera el JSON de `definition` que acepta workflows.create/update.
// Cada paso que llama a la API simulada se expande en dos nodos: set_variable(api_action) + function/decide.

const PHONE_NUMBER_ID = '597907523413541'; // sandbox de Kapso

// Límites de la API de WhatsApp Cloud (Meta, mensajes interactivos).
const LIMITES = {
  botones: 3, botonTitulo: 20, cuerpoBotones: 1024,
  filas: 10, filaTitulo: 24, filaDescripcion: 72, listaBoton: 20, cuerpoLista: 4096,
  ctaEtiqueta: 20, cuerpoCta: 1024, texto: 4096,
};

class Flow {
  constructor(key, name, slug, description = '') {
    this.key = key;
    this.name = name;
    this.slug = slug;
    this.description = description;
    this.nodes = [];
    this.edges = [];
    this.apis = new Set();
    this.triggers = [];
  }

  _add(id, nodeType, config, displayName) {
    if (this.nodes.some((n) => n.id === id)) throw new Error(`nodo duplicado: ${id}`);
    this.nodes.push({ id, nodeType, config, displayName: displayName || id });
    return this;
  }

  start() { return this._add('start', 'start', {}, 'Start'); }
  text(id, message) { return this._add(id, 'send_text', { message, phone_number_id: PHONE_NUMBER_ID, delay_seconds: 0 }); }
  buttons(id, body, buttons) {
    return this._add(id, 'send_interactive', { interactive_type: 'button', body_text: body, buttons, phone_number_id: PHONE_NUMBER_ID });
  }
  list(id, body, buttonText, rows) {
    return this._add(id, 'send_interactive', {
      interactive_type: 'list', body_text: body, list_button_text: buttonText,
      list_sections: [{ title: 'Opciones', rows }], phone_number_id: PHONE_NUMBER_ID,
    });
  }
  cta(id, body, label, url) {
    return this._add(id, 'send_interactive', { interactive_type: 'cta_url', body_text: body, cta_display_text: label, cta_url: url, phone_number_id: PHONE_NUMBER_ID });
  }
  wait(id, { save, timeoutSeconds } = {}) {
    return this._add(id, 'wait_for_response', {
      ...(save ? { save_response_to: save } : {}),
      ...(timeoutSeconds ? { has_timeout: true, timeout_seconds: timeoutSeconds } : {}),
    });
  }
  setvar(id, name, value, valueType = 'string') {
    return this._add(id, 'set_variable', { variable_name: name, variable_value: value, value_type: valueType });
  }
  call(id, workflowKey) { return this._add(id, 'call', { workflow_key: workflowKey }); }
  handoff(id) { return this._add(id, 'handoff', {}); }
  agent(id, config) { return this._add(id, 'agent', config); }

  // Paso de API: `${id}_set` fija vars.api_action y `${id}` ejecuta la función (decide si hay `edges`).
  api(id, action, { edges } = {}) {
    this.apis.add(id);
    this.setvar(`${id}_set`, 'api_action', action);
    if (edges) this._add(id, 'decide', { decision_type: 'function', conditions: edges.map((label) => ({ label, description: `Resultado: ${label}` })) });
    else this._add(id, 'function', { save_response_to: `${id}_respuesta` });
    this.edges.push({ source: `${id}_set`, target: id, label: 'next' });
    return this;
  }

  _entrada(id) { return this.apis.has(id) ? `${id}_set` : id; }
  link(from, to, label = 'next') { this.edges.push({ source: from, target: this._entrada(to), label }); return this; }
  linkAll(from, to, labels) { labels.forEach((l) => this.link(from, to, l)); return this; }

  trigger(t) { this.triggers.push(t); return this; }

  // ids = { functionId, workflows: { E1: uuid, ... } }
  definition(ids) {
    const nivel = new Map([['start', 0]]);
    const cola = ['start'];
    while (cola.length) {
      const n = cola.shift();
      for (const e of this.edges.filter((x) => x.source === n)) {
        if (!nivel.has(e.target)) { nivel.set(e.target, nivel.get(n) + 1); cola.push(e.target); }
      }
    }
    const porNivel = {};
    const nodes = this.nodes.map((n) => {
      const lv = nivel.has(n.id) ? nivel.get(n.id) : 0;
      const fila = (porNivel[lv] = (porNivel[lv] || 0) + 1) - 1;
      const config = { ...n.config };
      if (n.nodeType === 'function' || (n.nodeType === 'decide' && config.decision_type === 'function')) config.function_id = ids.functionId;
      if (n.nodeType === 'call') { config.workflow_id = ids.workflows[config.workflow_key]; delete config.workflow_key; }
      return { id: n.id, type: 'flow-node', position: { x: 100 + lv * 300, y: 100 + fila * 170 }, data: { node_type: n.nodeType, display_name: n.displayName, config } };
    });
    const edges = this.edges.map((e, i) => ({ id: `e${i + 1}`, source: e.source, target: e.target, label: e.label }));
    return { nodes, edges };
  }
}

// Devuelve una lista de errores; vacía si el flujo es consistente.
function validar(flow, clavesConocidas = []) {
  const errs = [];
  const ids = new Set(flow.nodes.map((n) => n.id));
  const starts = flow.nodes.filter((n) => n.nodeType === 'start');
  if (starts.length !== 1) errs.push(`debe haber exactamente un start (hay ${starts.length})`);
  for (const e of flow.edges) {
    if (!ids.has(e.source)) errs.push(`arista con origen inexistente: ${e.source}`);
    if (!ids.has(e.target)) errs.push(`arista con destino inexistente: ${e.target}`);
  }
  for (const n of flow.nodes) {
    const salientes = flow.edges.filter((e) => e.source === n.id);
    if (n.nodeType === 'decide') {
      const conds = n.config.conditions.map((c) => c.label).sort().join('|');
      const labels = [...new Set(salientes.map((e) => e.label))].sort().join('|');
      if (conds !== labels) errs.push(`decide ${n.id}: condiciones [${conds}] != aristas [${labels}]`);
    } else {
      if (salientes.length > 1) errs.push(`${n.id}: más de una arista saliente`);
      if (salientes.some((e) => e.label !== 'next')) errs.push(`${n.id}: arista con etiqueta distinta de next`);
    }
    if (n.nodeType === 'call' && !clavesConocidas.includes(n.config.workflow_key)) errs.push(`call ${n.id}: workflow desconocido ${n.config.workflow_key}`);
    errs.push(...limites(n));
  }
  const alcanzados = new Set(['start']);
  const cola = ['start'];
  while (cola.length) {
    const n = cola.shift();
    for (const e of flow.edges.filter((x) => x.source === n)) if (!alcanzados.has(e.target)) { alcanzados.add(e.target); cola.push(e.target); }
  }
  for (const n of flow.nodes) if (!alcanzados.has(n.id)) errs.push(`nodo inalcanzable desde start: ${n.id}`);
  return errs;
}

function limites(n) {
  const c = n.config;
  const e = [];
  const max = (txt, lim, que) => { if (String(txt).length > lim) e.push(`${n.id}: ${que} excede ${lim} caracteres (${String(txt).length}): "${txt}"`); };
  if (n.nodeType === 'send_text') max(c.message, LIMITES.texto, 'mensaje');
  if (n.nodeType !== 'send_interactive') return e;
  if (c.interactive_type === 'button') {
    max(c.body_text, LIMITES.cuerpoBotones, 'cuerpo');
    if (c.buttons.length < 1 || c.buttons.length > LIMITES.botones) e.push(`${n.id}: debe tener de 1 a ${LIMITES.botones} botones`);
    c.buttons.forEach((b) => max(b.title, LIMITES.botonTitulo, `título de botón "${b.title}"`));
    if (new Set(c.buttons.map((b) => b.title)).size !== c.buttons.length) e.push(`${n.id}: títulos de botón repetidos`);
  }
  if (c.interactive_type === 'list') {
    max(c.body_text, LIMITES.cuerpoLista, 'cuerpo');
    max(c.list_button_text, LIMITES.listaBoton, 'texto del botón de lista');
    const filas = c.list_sections.flatMap((s) => s.rows);
    if (filas.length < 1 || filas.length > LIMITES.filas) e.push(`${n.id}: la lista debe tener de 1 a ${LIMITES.filas} filas`);
    filas.forEach((r) => { max(r.title, LIMITES.filaTitulo, `título de fila "${r.title}"`); if (r.description) max(r.description, LIMITES.filaDescripcion, 'descripción de fila'); });
  }
  if (c.interactive_type === 'cta_url') {
    max(c.body_text, LIMITES.cuerpoCta, 'cuerpo');
    max(c.cta_display_text, LIMITES.ctaEtiqueta, 'etiqueta del botón de enlace');
    if (!/^https:\/\//.test(c.cta_url)) e.push(`${n.id}: cta_url debe ser https`);
  }
  return e;
}

module.exports = { Flow, validar, LIMITES, PHONE_NUMBER_ID };
```

- [ ] **Paso 4: Escribir las definiciones de los workflows**

`kapso/build/workflows.js`:

```javascript
// Definiciones de los workflows del flujo de WhatsApp de BrasPer (ver el spec en docs/superpowers/specs/).
// Convención: `entrada` es el primer nodo de un bloque; `ruta`/`salida` es el nodo decide cuyas aristas conecta quien llama.
const { Flow, PHONE_NUMBER_ID } = require('./flow');

const MODELO_EXTRACCION = '7c2cc054-60af-4ca8-aa15-030db79ce9db'; // claude-haiku-5-5 (Anthropic), de workflows list_provider_models
const FORMULARIO_WEB = 'https://brasper.com/es'; // la web aún no admite cotización por parámetros: abre la calculadora
const MSG_PERSONA = 'Te paso con una persona del equipo para ayudarte.';
const MSG_SIN_TASAS = 'Ahora no puedo cotizar con seguridad. Te paso con una persona del equipo para ayudarte.';
const MONEDAS = ['BRL', 'PEN', 'USD'];
const MONEDAS_BTN = MONEDAS.map((m) => ({ id: m, title: m }));
// Lista de demostración: la definitiva está pendiente de BrasPer (máximo 10 filas).
const BANCOS = ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro'].map((b) => ({ id: b, title: b }));
const ORIGEN_FONDOS = ['Ahorros', 'Venta de un bien', 'Otro'].map((o) => ({ id: o, title: o }));
const ids = (opciones) => opciones.map((o) => o.id);

const PROMPT_EXTRACCION = [
  'Eres un extractor de datos para BrasPer, una casa de cambio. Lee el último mensaje del cliente.',
  'Guarda con la herramienta save_variable solo los datos que el cliente haya dicho de forma explícita:',
  '- monto: el número a enviar (value_type float, solo el número, sin moneda).',
  '- moneda_origen: la moneda que envía (value_type string, solo BRL, PEN o USD).',
  '- moneda_destino: la moneda que recibe (value_type string, solo BRL, PEN o USD).',
  'Interpreta "reales" como BRL, "soles" como PEN y "dólares" como USD. "A Perú" implica moneda_destino PEN y "a Brasil" implica BRL.',
  'Si el cliente no menciona un dato, no lo guardes ni lo inventes.',
  'No escribas ningún mensaje al cliente. Cuando termines, llama a complete_task.',
].join('\n');

const AGENTE_EXTRACCION = {
  system_prompt: PROMPT_EXTRACCION,
  provider_model_id: MODELO_EXTRACCION,
  temperature: 0,
  max_iterations: 6,
  enabled_default_tools: ['save_variable', 'complete_task'],
  message_delivery_mode: 'auto_send_assistant_text',
};

// Handoff a persona: registra el motivo, avisa al cliente (con enlace opcional) y detiene la ejecución.
function escalar(f, nombre, motivo, { mensaje = MSG_PERSONA, cta } = {}) {
  f.api(`${nombre}_reg`, `handoff_to_human:${motivo}`);
  f.text(`${nombre}_msg`, mensaje);
  f.link(`${nombre}_reg`, `${nombre}_msg`);
  let ultimo = `${nombre}_msg`;
  if (cta) {
    f.cta(`${nombre}_cta`, cta.body, cta.label, cta.url);
    f.link(ultimo, `${nombre}_cta`);
    ultimo = `${nombre}_cta`;
  }
  f.handoff(`${nombre}_fin`);
  f.link(ultimo, `${nombre}_fin`);
  return `${nombre}_reg`;
}

// Pregunta de texto libre con validación; el segundo fallo seguido escala. El llamador conecta `salida` con 'valido'.
function pregunta(f, n, { prompt, guardar, validar, error, motivo, escalarOpts }) {
  f.text(`${n}_ask`, prompt);
  f.wait(`${n}_wait`, { save: guardar });
  f.api(`${n}_val`, `validate:${validar}`, { edges: ['valido', 'invalido', 'escalar'] });
  f.text(`${n}_err`, error);
  const esc = escalar(f, `${n}_esc`, motivo, escalarOpts);
  f.link(`${n}_ask`, `${n}_wait`).link(`${n}_wait`, `${n}_val`);
  f.link(`${n}_val`, `${n}_err`, 'invalido').link(`${n}_err`, `${n}_wait`);
  f.link(`${n}_val`, esc, 'escalar');
  return { entrada: `${n}_ask`, salida: `${n}_val` };
}

// Elección por botones o lista; una respuesta fuera de las opciones repite el mensaje y el segundo fallo escala.
// El llamador conecta `ruta` con cada id de `opciones`.
function elegir(f, n, { tipo, body, opciones, boton = 'Elegir', variable, motivo }) {
  if (tipo === 'list') f.list(`${n}_ask`, body, boton, opciones);
  else f.buttons(`${n}_ask`, body, opciones);
  f.wait(`${n}_wait`);
  f.api(`${n}_route`, `route_reply:${variable}`, { edges: [...ids(opciones), 'invalido', 'escalar'] });
  const esc = escalar(f, `${n}_esc`, motivo);
  f.link(`${n}_ask`, `${n}_wait`).link(`${n}_wait`, `${n}_route`);
  f.link(`${n}_route`, `${n}_ask`, 'invalido');
  f.link(`${n}_route`, esc, 'escalar');
  return { entrada: `${n}_ask`, ruta: `${n}_route` };
}

function e1() {
  const f = new Flow('E1', 'BrasPer · E1 Cotiza', 'brasper-e1-cotiza', 'Etapa 1: extrae monto y monedas, cotiza y ofrece continuar.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.agent('extraer', AGENTE_EXTRACCION);
  f.link('init', 'extraer');
  f.api('verifica', 'check_extraction', { edges: ['completa', 'incompleta'] });
  f.link('extraer', 'verifica');
  f.api('cotiza', 'get_rate_quote', { edges: ['ok', 'sin_servicio', 'par_invalido'] });
  f.link('verifica', 'cotiza', 'completa');

  // Respaldo: el mensaje no trae los tres datos.
  const mo = elegir(f, 'mo', { tipo: 'buttons', body: '¡Hola! Soy el asistente de BrasPer. ¿Qué moneda quieres enviar?', opciones: MONEDAS_BTN, variable: 'moneda_origen', motivo: 'moneda_origen' });
  const md = elegir(f, 'md', { tipo: 'buttons', body: '¿En qué moneda recibe tu destinatario?', opciones: MONEDAS_BTN, variable: 'moneda_destino', motivo: 'moneda_destino' });
  const monto = pregunta(f, 'monto', { prompt: '¿Cuánto quieres enviar? Escribe solo el monto.', guardar: 'monto_raw', validar: 'monto', error: 'No entendí el monto. Escribe solo el número, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('verifica', mo.entrada, 'incompleta');
  f.linkAll(mo.ruta, md.entrada, MONEDAS);
  f.linkAll(md.ruta, monto.entrada, MONEDAS);
  f.link(monto.salida, 'cotiza', 'valido');

  // Resultados de la cotización.
  f.text('par_err', 'Esa combinación de monedas no está disponible. Elige otras.');
  f.link('cotiza', 'par_err', 'par_invalido').link('par_err', mo.entrada);
  f.link('cotiza', escalar(f, 'tasas', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS }), 'sin_servicio');
  f.buttons('oferta', '¡Hola! Hoy 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}. Comisión {{vars.comision_txt}} {{vars.moneda_origen}}. Recibirás {{vars.recibe_txt}} {{vars.moneda_destino}}. Tasa asegurada hasta las {{vars.tasa_hasta}}.', [
    { id: 'continuar', title: 'Continuar' }, { id: 'cambiar_monto', title: 'Cambiar monto' }, { id: 'persona', title: 'Hablar con persona' },
  ]);
  f.cta('web', '¿Prefieres hacerlo desde la web?', 'Abrir formulario web', FORMULARIO_WEB);
  f.wait('oferta_wait');
  f.api('oferta_route', 'route_reply:accion_e1', { edges: ['continuar', 'cambiar_monto', 'persona', 'invalido', 'escalar'] });
  f.link('cotiza', 'oferta', 'ok').link('oferta', 'web').link('web', 'oferta_wait').link('oferta_wait', 'oferta_route');
  f.link('oferta_route', 'oferta', 'invalido');
  f.link('oferta_route', escalar(f, 'oferta_esc', 'oferta_sin_respuesta'), 'escalar');
  f.link('oferta_route', escalar(f, 'persona', 'cliente_pide_persona'), 'persona');
  const m2 = pregunta(f, 'monto2', { prompt: '¿Cuánto quieres enviar? Escribe solo el monto.', guardar: 'monto_raw', validar: 'monto', error: 'No entendí el monto. Escribe solo el número, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('oferta_route', m2.entrada, 'cambiar_monto');
  f.link(m2.salida, 'cotiza', 'valido');
  f.setvar('listo', 'continuar', 'si');
  f.link('oferta_route', 'listo', 'continuar');
  return f;
}

function e2() {
  const f = new Flow('E2', 'BrasPer · E2 Datos', 'brasper-e2-datos', 'Etapa 2: DNI/CPF, origen de fondos, banco de origen y cuenta destino; crea la operación.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  const dni = pregunta(f, 'dni', { prompt: '¿Cuál es tu DNI o CPF?', guardar: 'dni_raw', validar: 'dni_cpf', error: 'No reconozco ese formato. Revisa tu DNI (8 dígitos) o CPF (11 dígitos) y envíalo de nuevo.', motivo: 'dni_invalido' });
  f.link('init', dni.entrada);
  const of = elegir(f, 'of', { tipo: 'buttons', body: '¿De dónde provienen los fondos?', opciones: ORIGEN_FONDOS, variable: 'origen_fondos', motivo: 'origen_fondos' });
  f.link(dni.salida, of.entrada, 'valido');
  const bo = elegir(f, 'bo', { tipo: 'list', body: '¿Desde qué banco nos envías tu dinero?', boton: 'Elegir banco', opciones: BANCOS, variable: 'banco_origen', motivo: 'banco_origen' });
  f.linkAll(of.ruta, bo.entrada, ids(ORIGEN_FONDOS));
  f.api('cliente', 'get_client', { edges: ['con_cuenta', 'sin_cuenta'] });
  f.linkAll(bo.ruta, 'cliente', ids(BANCOS));

  // Cuenta destino guardada.
  const cu = elegir(f, 'cu', {
    tipo: 'buttons', body: 'Tengo guardada tu cuenta {{vars.cuenta_banco}} ••{{vars.cuenta_ultimos4}}. ¿Recibes ahí? Debe estar a tu nombre.',
    opciones: [{ id: 'si_esa', title: 'Sí, esa' }, { id: 'otra_cuenta', title: 'Otra cuenta' }], variable: 'cuenta_destino', motivo: 'cuenta_destino',
  });
  f.link('cliente', cu.entrada, 'con_cuenta');

  // Cuenta nueva: banco por lista, número en texto y confirmación enmascarada.
  const bn = elegir(f, 'bn', { tipo: 'list', body: 'Vamos a agregar tu cuenta. ¿En qué banco está?', boton: 'Elegir banco', opciones: BANCOS, variable: 'cuenta_banco_nuevo', motivo: 'banco_cuenta_nueva' });
  f.link('cliente', bn.entrada, 'sin_cuenta').link(cu.ruta, bn.entrada, 'otra_cuenta');
  const num = pregunta(f, 'num', {
    prompt: 'Escribe el número de cuenta.', guardar: 'numero_cuenta_raw', validar: 'numero_cuenta',
    error: 'Ese número no parece válido. Escríbelo solo con dígitos.', motivo: 'numero_cuenta_invalido',
    escalarOpts: { mensaje: 'No pude validar el número de cuenta. Puedes agregarla desde el formulario web y una persona del equipo te ayudará.', cta: { body: 'Agrega tu cuenta desde la web.', label: 'Abrir formulario web', url: FORMULARIO_WEB } },
  });
  f.linkAll(bn.ruta, num.entrada, ids(BANCOS));
  const cf = elegir(f, 'cf', {
    tipo: 'buttons', body: 'Confirmo: {{vars.cuenta_banco_nuevo}} ••{{vars.cuenta_ultimos4}}. ¿Está a tu nombre?',
    opciones: [{ id: 'guardar', title: 'Sí, guardar' }, { id: 'corregir', title: 'Corregir' }], variable: 'confirma_cuenta', motivo: 'confirma_cuenta',
  });
  f.link(num.salida, cf.entrada, 'valido');
  f.link(cf.ruta, num.entrada, 'corregir');
  f.api('guarda', 'save_account');
  f.link(cf.ruta, 'guarda', 'guardar');

  // Crear la operación.
  f.api('crea', 'create_operation');
  f.link(cu.ruta, 'crea', 'si_esa').link('guarda', 'crea');
  f.setvar('listo', 'continuar', 'si');
  f.link('crea', 'listo');
  return f;
}

function e3() {
  const f = new Flow('E3', 'BrasPer · E3 Pago y constancia', 'brasper-e3-pago', 'Etapa 3: cuenta de BrasPer, aviso de horario, constancia (foto y N° de operación) o cancelación.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.api('vigencia', 'check_tasa', { edges: ['vigente', 'vencida'] });
  f.link('init', 'vigencia');
  f.api('cuenta', 'get_company_account');
  f.link('vigencia', 'cuenta', 'vigente');

  // Tasa vencida: recotiza y pide confirmar.
  f.api('recotiza', 'get_rate_quote', { edges: ['ok', 'sin_servicio', 'par_invalido'] });
  f.link('vigencia', 'recotiza', 'vencida');
  const tn = elegir(f, 'tn', {
    tipo: 'buttons', body: 'La tasa asegurada venció. Nueva cotización: 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}. Recibirás {{vars.recibe_txt}} {{vars.moneda_destino}}.',
    opciones: [{ id: 'continuar', title: 'Continuar' }, { id: 'cancelar', title: 'Cancelar operación' }], variable: 'tasa_nueva', motivo: 'tasa_nueva',
  });
  f.link('recotiza', tn.entrada, 'ok');
  const sinTasa = escalar(f, 'tasas', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS });
  f.link('recotiza', sinTasa, 'sin_servicio').link('recotiza', sinTasa, 'par_invalido');
  f.link(tn.ruta, 'cuenta', 'continuar');
  f.api('cancela', 'cancel_operation');
  f.text('cancelada', 'Listo, cancelé la operación {{vars.operacion_id}}.');
  f.link('cancela', 'cancelada');
  f.link(tn.ruta, 'cancela', 'cancelar');

  // Cuenta de BrasPer y aviso fuera de horario.
  f.text('instr', 'Transfiere {{vars.total_enviar_txt}} {{vars.moneda_origen}} a:\nTitular: {{vars.brasper_titular}}\nBanco: {{vars.brasper_banco}}\nCuenta: {{vars.brasper_cuenta}}\nUsa la cuenta de {{vars.moneda_origen}}, no otra moneda.\nTasa asegurada hasta las {{vars.tasa_hasta}}.');
  f.link('cuenta', 'instr');
  f.api('horario', 'check_hours', { edges: ['abierto', 'cerrado'] });
  f.link('instr', 'horario');
  f.text('fuera', 'Fuera de horario: tu operación se verificará {{vars.proxima_verificacion}}.');
  const ac = elegir(f, 'ac', {
    tipo: 'buttons', body: 'Cuando termines la transferencia, toca "Ya transferí".',
    opciones: [{ id: 'ya_transferi', title: 'Ya transferí' }, { id: 'cancelar', title: 'Cancelar operación' }], variable: 'accion_e3', motivo: 'accion_e3',
  });
  f.link('horario', 'fuera', 'cerrado').link('horario', ac.entrada, 'abierto').link('fuera', ac.entrada);

  // Cancelar con confirmación.
  const cc = elegir(f, 'cc', {
    tipo: 'buttons', body: '¿Seguro que quieres cancelar la operación {{vars.operacion_id}}?',
    opciones: [{ id: 'si_cancelar', title: 'Sí, cancelar' }, { id: 'continuar', title: 'Continuar' }], variable: 'confirma_cancelar', motivo: 'confirma_cancelar',
  });
  f.link(ac.ruta, cc.entrada, 'cancelar').link(cc.ruta, 'cancela', 'si_cancelar').link(cc.ruta, ac.entrada, 'continuar');

  // Constancia: foto y número de operación bancaria. El asistente no evalúa el comprobante.
  f.text('pide_foto', 'Perfecto. Envíame la foto del comprobante.');
  f.wait('esp_foto');
  f.api('foto', 'media:comprobante', { edges: ['foto', 'sin_foto', 'escalar'] });
  f.text('sin_foto', 'No recibí una foto. Envíame la foto o captura del comprobante.');
  f.link(ac.ruta, 'pide_foto', 'ya_transferi').link('pide_foto', 'esp_foto').link('esp_foto', 'foto');
  f.link('foto', 'sin_foto', 'sin_foto').link('sin_foto', 'esp_foto');
  f.link('foto', escalar(f, 'foto_esc', 'comprobante_no_recibido'), 'escalar');
  const nop = pregunta(f, 'nop', { prompt: 'Ahora escribe el número de operación bancaria.', guardar: 'n_operacion_raw', validar: 'n_operacion', error: 'Ese número no parece válido. Escríbelo solo con dígitos.', motivo: 'n_operacion_invalido' });
  f.link('foto', nop.entrada, 'foto');
  f.api('adjunta', 'attach_proof');
  f.link(nop.salida, 'adjunta', 'valido');
  f.text('cierre', 'Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo.');
  f.setvar('listo', 'continuar', 'si');
  f.link('adjunta', 'cierre').link('cierre', 'listo');
  return f;
}

function e4() {
  const f = new Flow('E4', 'BrasPer · E4 Estado', 'brasper-e4-estado', 'Etapa 4: avisa al cliente cuando el backend cambia el estado del pago. Se inicia por API.');
  f.start();
  f.api('operacion', 'get_operation');
  f.link('start', 'operacion');
  f.api('ventana', 'check_window', { edges: ['abierta', 'cerrada'] });
  f.link('operacion', 'ventana');
  f.api('ruta', 'route_estado', { edges: ['verificada', 'rechazada', 'otro'] });
  f.link('ventana', 'ruta', 'abierta');
  // Ventana de 24 h cerrada: en producción aquí va la plantilla de Meta (posterior a la demo).
  f.setvar('plantilla', 'aviso_pendiente', 'plantilla_requerida');
  f.link('ventana', 'plantilla', 'cerrada');
  f.text('verificado', '✅ Pago verificado. Enviamos tu dinero a la cuenta ••{{vars.cuenta_ultimos4}}.');
  f.text('listo', '¡Listo! Recibiste {{vars.recibe_txt}} {{vars.moneda_destino}}. Te enviamos tu comprobante por correo.');
  f.link('ruta', 'verificado', 'verificada').link('verificado', 'listo');
  f.link('ruta', escalar(f, 'rech', 'pago_no_validado', { mensaje: 'No pudimos validar tu pago de la operación {{vars.operacion_id}}. Una persona del equipo te contactará.' }), 'rechazada');
  f.setvar('omitido', 'aviso_omitido', 'si');
  f.link('ruta', 'omitido', 'otro');
  f.trigger({ trigger_type: 'api_call', active: true });
  return f;
}

function w0() {
  const f = new Flow('W0', 'BrasPer · W0 Enrutador', 'brasper-w0-enrutador', 'Enruta cada conversación nueva a la etapa que corresponde según el estado de la operación.');
  f.start();
  f.api('estado', 'get_status', { edges: ['e1', 'e3', 'estado', 'escalada'] });
  f.link('start', 'estado');
  f.call('c1', 'E1').api('sigue1', 'check_continue', { edges: ['seguir', 'fin'] });
  f.call('c2', 'E2').api('sigue2', 'check_continue', { edges: ['seguir', 'fin'] });
  f.call('c3', 'E3');
  f.setvar('fin', 'flujo_terminado', 'si');
  f.link('estado', 'c1', 'e1').link('c1', 'sigue1').link('sigue1', 'c2', 'seguir').link('c2', 'sigue2').link('sigue2', 'c3', 'seguir');
  f.link('sigue1', 'fin', 'fin').link('sigue2', 'fin', 'fin');
  f.link('estado', 'c3', 'e3');
  f.text('status', 'Tu operación {{vars.operacion_id}} está {{vars.estado_texto}}.');
  f.link('estado', 'status', 'estado');
  f.text('esc', 'Una persona del equipo ya está atendiendo tu caso.');
  f.link('estado', 'esc', 'escalada');
  f.trigger({ trigger_type: 'inbound_message', phone_number_id: PHONE_NUMBER_ID, active: true });
  return f;
}

function buildFlows() {
  return { E1: e1(), E2: e2(), E3: e3(), E4: e4(), W0: w0() };
}

module.exports = { buildFlows, AGENTE_EXTRACCION, FORMULARIO_WEB };
```

- [ ] **Paso 5: Escribir los workflows del spike**

`kapso/build/spike.js`:

```javascript
// Workflows desechables para verificar supuestos de plataforma antes de publicar el flujo real (spike).
const { Flow, PHONE_NUMBER_ID } = require('./flow');
const { AGENTE_EXTRACCION, FORMULARIO_WEB } = require('./workflows');

const entrante = { trigger_type: 'inbound_message', phone_number_id: PHONE_NUMBER_ID, active: true };

// S1: ¿el agente de extracción escribe monto y monedas en variables sin enviar mensajes propios?
function s1() {
  const f = new Flow('S1', 'SPIKE · extracción', 'spike-extraccion');
  f.start();
  f.agent('extraer', AGENTE_EXTRACCION);
  f.text('resultado', 'S1 monto={{vars.monto}} origen={{vars.moneda_origen}} destino={{vars.moneda_destino}}');
  f.link('start', 'extraer').link('extraer', 'resultado');
  return f.trigger(entrante);
}

// S2: un workflow que llama a otro que espera respuesta. ¿El mensaje reanuda al hijo y el padre continúa al terminar?
function s2Hijo() {
  const f = new Flow('S2C', 'SPIKE · hijo', 'spike-hijo');
  f.start();
  f.text('pregunta', 'S2 hijo: dime algo');
  f.wait('espera', { save: 'dato' });
  f.text('recibido', 'S2 hijo: recibí {{vars.dato}}');
  f.link('start', 'pregunta').link('pregunta', 'espera').link('espera', 'recibido');
  return f;
}
function s2Padre() {
  const f = new Flow('S2P', 'SPIKE · padre', 'spike-padre');
  f.start();
  f.call('c', 'S2C');
  f.text('fin', 'S2 padre: el hijo terminó, dato={{vars.dato}}');
  f.link('start', 'c').link('c', 'fin');
  return f.trigger(entrante);
}

// S3: inicio por API y decisión por ventana de 24 h con la función real (check_window).
function s3() {
  const f = new Flow('S3', 'SPIKE · api', 'spike-api');
  f.start();
  f.api('ventana', 'check_window', { edges: ['abierta', 'cerrada'] });
  f.text('abierta', 'S3 API ok: ventana abierta, operación {{vars.operacion_id}}');
  f.setvar('cerrada', 'aviso_pendiente', 'plantilla_requerida');
  f.link('start', 'ventana').link('ventana', 'abierta', 'abierta').link('ventana', 'cerrada', 'cerrada');
  return f.trigger({ trigger_type: 'api_call', active: true });
}

// S4: botones, enlace y lista en el sandbox, y enrutado con la función real (route_reply como decide).
function s4() {
  const f = new Flow('S4', 'SPIKE · interactivos', 'spike-interactivos');
  f.start();
  f.buttons('botones', 'S4 prueba de botones', [{ id: 'a', title: 'Hablar con persona' }, { id: 'b', title: 'Cambiar monto' }, { id: 'c', title: 'Continuar' }]);
  f.cta('web', 'S4 prueba de enlace', 'Abrir formulario web', FORMULARIO_WEB);
  f.wait('espera1');
  f.api('ruta1', 'route_reply:eleccion', { edges: ['a', 'b', 'c', 'invalido', 'escalar'] });
  f.text('dijo', 'S4 botón elegido: {{vars.eleccion}}');
  f.text('mal1', 'S4 respuesta fuera de las opciones');
  f.list('lista', 'S4 prueba de lista', 'Elegir banco', [{ id: 'BCP', title: 'BCP' }, { id: 'Banco do Brasil', title: 'Banco do Brasil' }, { id: 'Otro', title: 'Otro' }]);
  f.wait('espera2');
  f.api('ruta2', 'route_reply:fila', { edges: ['BCP', 'Banco do Brasil', 'Otro', 'invalido', 'escalar'] });
  f.text('fila', 'S4 fila elegida: {{vars.fila}}');
  f.link('start', 'botones').link('botones', 'web').link('web', 'espera1').link('espera1', 'ruta1');
  f.linkAll('ruta1', 'dijo', ['a', 'b', 'c']).link('ruta1', 'mal1', 'invalido').link('ruta1', 'mal1', 'escalar');
  f.link('dijo', 'lista').link('lista', 'espera2').link('espera2', 'ruta2');
  f.linkAll('ruta2', 'fila', ['BCP', 'Banco do Brasil', 'Otro']).link('ruta2', 'fila', 'invalido').link('ruta2', 'fila', 'escalar');
  return f.trigger(entrante);
}

function buildSpike() {
  return { S1: s1(), S2C: s2Hijo(), S2P: s2Padre(), S3: s3(), S4: s4() };
}

module.exports = { buildSpike };
```

- [ ] **Paso 6: Ejecutar todas las pruebas**

Ejecuta: `cd kapso && node --test`

Esperado: `tests 35`, `pass 35`, `fail 0`.

- [ ] **Paso 7: Escribir el generador de JSON y probarlo**

`kapso/build/emit.js`:

```javascript
// Genera kapso/dist/<slug>.json con { name, slug, description, definition, triggers } listo para workflows.create/update.
// Uso: node build/emit.js [--strict] [--spike]
//   --strict  exige kapso/ids.json con los IDs reales (functionId y workflows.<clave>)
//   --spike   genera los workflows desechables de build/spike.js en dist/spike/
const fs = require('fs');
const path = require('path');
const { buildFlows } = require('./workflows');
const { buildSpike } = require('./spike');
const { validar } = require('./flow');

const strict = process.argv.includes('--strict');
const spike = process.argv.includes('--spike');
const flows = spike ? buildSpike() : buildFlows();
const claves = Object.keys(flows);
const idsPath = path.join(__dirname, '..', 'ids.json');
const PENDIENTE = 'PENDIENTE';
const ids = fs.existsSync(idsPath)
  ? JSON.parse(fs.readFileSync(idsPath, 'utf8'))
  : { functionId: PENDIENTE, workflows: Object.fromEntries(claves.map((k) => [k, PENDIENTE])) };

const faltan = [ids.functionId, ...claves.map((k) => (ids.workflows || {})[k])].filter((v) => !v || v === PENDIENTE);
if (strict && faltan.length) {
  console.error('Faltan IDs en kapso/ids.json (functionId y workflows.E1..W0).');
  process.exit(1);
}

const dist = path.join(__dirname, '..', 'dist', spike ? 'spike' : '');
fs.mkdirSync(dist, { recursive: true });
for (const f of Object.values(flows)) {
  const errs = validar(f, claves);
  if (errs.length) {
    console.error(`${f.key} inválido:\n- ${errs.join('\n- ')}`);
    process.exit(1);
  }
  const salida = { name: f.name, slug: f.slug, description: f.description, definition: f.definition(ids), triggers: f.triggers };
  fs.writeFileSync(path.join(dist, `${f.slug}.json`), JSON.stringify(salida, null, 2));
  console.log(`${f.key}: ${salida.definition.nodes.length} nodos, ${salida.definition.edges.length} aristas -> ${path.relative(path.join(__dirname, '..'), path.join(dist, `${f.slug}.json`))}`);
}
```

```bash
cd kapso
node build/emit.js
node build/emit.js --spike
node build/emit.js --strict; echo "exit=$?"
```

Esperado: lista `E1: 60 nodos, 71 aristas`, `E2: 68 nodos, 97 aristas`, `E3: 65 nodos, 74 aristas`, `E4: 15 nodos, 14 aristas`, `W0: 13 nodos, 14 aristas`, y los cinco del spike. El tercer comando termina con `Faltan IDs en kapso/ids.json` y `exit=1`, porque aún no hay IDs reales.

- [ ] **Paso 8: Comprobar que el validador detecta un grafo roto**

En `kapso/build/workflows.js`, elimina temporalmente la línea `f.link(cf.ruta, num.entrada, 'corregir');`. Ejecuta `node --test`.

Esperado: falla `E2: el grafo es consistente…` con `decide cf_route: condiciones [corregir|escalar|guardar|invalido] != aristas [escalar|guardar|invalido]`. Restaura la línea y vuelve a ejecutar `node --test` (`pass 35`).

- [ ] **Paso 9: Commit**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git add kapso/build
git commit -m "feat: constructor y definiciones de los workflows de WhatsApp" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 3: Desplegar la función en Kapso y comprobarla

**Archivos:**
- Crear: `kapso/ids.json`

**Interfaces:**
- Consume: `kapso/functions/brasper-api.js` (tarea 1).
- Produce: `kapso/ids.json` con `{ "functionId": "<uuid>", "workflows": {} }`, que leen `emit.js` y las tareas 4 y 6.

- [ ] **Paso 1: Crear la función**

Lee `kapso/functions/brasper-api.js` con Read. Llama a `functions` con:

```json
{ "action": "create", "params": { "name": "brasper-api", "slug": "brasper-api", "description": "API simulada de BrasPer para la demo (datos ficticios)", "code": "<contenido completo del archivo>", "public_endpoint": false } }
```

Anota el `id` y el `lock_version`.

- [ ] **Paso 2: Desplegar y esperar**

Llama a `functions` con `{ "action": "deploy", "params": { "id": "<id>" } }`. Repite `{ "action": "get", "params": { "id": "<id>" } }` hasta que `status` sea `deployed`.

Esperado: `deployed`. Si queda en error, revisa `functions list_invocations` y la respuesta de `get`.

- [ ] **Paso 3: Guardar el ID**

Crea `kapso/ids.json` con `{ "functionId": "<id>", "workflows": {} }`.

- [ ] **Paso 4: Invocar la función y comprobar cada respuesta**

Llama a `functions` con `action: "invoke"` y estos `body`. Las acciones directas leen `body.phone` y `body.vars`.

| # | `body` | Esperado |
|---|---|---|
| 1 | `{"action":"reset_demo","phone":"51944686794"}` | `{"vars":{"reset":true}}` |
| 2 | `{"action":"seed_demo","phone":"51944686794"}` | `{"vars":{"seed":true}}` |
| 3 | `{"action":"get_client","phone":"51944686794","vars":{"moneda_destino":"PEN"},"available_edges":["con_cuenta","sin_cuenta"]}` | `next_edge` `con_cuenta`, `cuenta_banco` `Scotiabank`, `cuenta_ultimos4` `9956` |
| 4 | `{"action":"get_rate_quote","vars":{"monto":500,"moneda_origen":"BRL","moneda_destino":"PEN"},"available_edges":["ok","sin_servicio","par_invalido"]}` | `next_edge` `ok`, `recibe_txt` `350.00`, `total_enviar_txt` `505.00` |
| 5 | `{"action":"check_hours","available_edges":["abierto","cerrado"]}` | `abierto` o `cerrado` con `proxima_verificacion` coherente con la hora de Lima |
| 6 | `{"action":"accion_inexistente"}` | estado 400 `accion_desconocida` |

Si el 3 devuelve `sin_cuenta` justo después del 2, `env.KV` tiene lectura eventual: espera unos segundos y repite. Si aparece un error por `env.KV` no definido, detente y repórtalo a David: la alternativa es `env.DB` (D1) y cambia el diseño del almacenamiento.

- [ ] **Paso 5: Commit**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git add kapso/ids.json
git commit -m "chore: IDs de recursos de Kapso (función brasper-api)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: Spike de supuestos de plataforma (S1 a S4)

**Archivos:**
- Crear: `docs/superpowers/findings/2026-10-12-kapso-spike.md`
- Modificar: `kapso/ids.json` (agrega `S2C`)

**Interfaces:**
- Consume: `buildSpike()` (tarea 2), la función desplegada (tarea 3), el Procedimiento P.
- Produce: la decisión de continuar, de ejecutar la tarea 5 o de detenerse.

Los cuatro supuestos:

| Spike | Qué se comprueba |
|---|---|
| S1 | El nodo `agent` guarda monto y monedas en variables sin enviar mensajes propios |
| S2 | Un mensaje del cliente reanuda al workflow hijo que espera, el padre continúa al terminar y no nace una ejecución nueva |
| S3 | Un workflow iniciado por API usa `context.phone_number` y decide por la ventana de 24 h |
| S4 | El sandbox admite botones, `cta_url` y lista, y un nodo `decide` en modo función lee la respuesta y devuelve `vars` que los mensajes siguientes leen |

- [ ] **Paso 1: Silenciar el flujo de prueba anterior**

Llama a `workflows` con `{ "action": "update_trigger", "params": { "id": "a122705c-3a3b-4a79-9c83-414838c66058", "active": false } }`.

Esperado: el trigger queda `active: false`. Hasta que se publique W0, el sandbox no responde a mensajes entrantes.

- [ ] **Paso 2: Generar y publicar los workflows del spike, con triggers inactivos**

```bash
cd kapso && node build/emit.js --spike
```

Aplica el Procedimiento P a `spike-hijo.json` (S2C). Agrega su id a `kapso/ids.json` como `"workflows": { "S2C": "<id>" }` y vuelve a ejecutar `node build/emit.js --spike`, para que `spike-padre.json` lleve el `workflow_id` correcto. Aplica P a `spike-extraccion.json`, `spike-padre.json`, `spike-api.json` y `spike-interactivos.json`. **En P3 crea todos los triggers con `active: false`.**

- [ ] **Paso 3: S1, extracción con agente**

Activa solo el trigger de `S1` (`update_trigger`, `active: true`). Pide a David que envíe desde su WhatsApp: `Hola, quiero enviar 500 reales a Perú`.

Esperado: un único mensaje del sandbox, `S1 monto=500 origen=BRL destino=PEN` (el monto puede aparecer como `500` o `500.0`). Comprueba con `whatsapp_messages` `list` (`phone_number_id` `597907523413541`, `direction` `outbound`) que no hay otros mensajes salientes del agente, y con `workflow_executions` `get` y `list_events` el estado y los pasos.

Resultado: **PASA** si hay un solo mensaje con los tres datos. **FALLA** si faltan variables o el agente escribe texto propio: ejecuta la tarea 5 y sigue.

Desactiva el trigger de S1.

- [ ] **Paso 4: S2, padre e hijo con espera**

Activa solo el trigger de `S2P`. David envía `hola`; luego `uno`.

Esperado, en orden: `S2 hijo: dime algo`; `S2 hijo: recibí uno`; `S2 padre: el hijo terminó, dato=uno`. Con `workflow_executions` `list` (`workflow_id` de S2P): una sola ejecución, estado terminado. 

**FALLA** si el segundo mensaje inicia una ejecución nueva (otro `S2 hijo: dime algo`) o el padre nunca continúa. En ese caso **detente y repórtalo a David** con los ids de ejecución: el enrutador W0 no puede funcionar como está diseñado y hay que decidir otra estructura.

Desactiva el trigger de S2P.

- [ ] **Paso 5: S4, interactivos y decide en modo función**

Activa solo el trigger de `S4`. David envía cualquier texto.

Esperado: llegan un mensaje con 3 botones (`Hablar con persona`, `Cambiar monto`, `Continuar`) y otro con el botón `Abrir formulario web`. David toca `Cambiar monto`: llega `S4 botón elegido: b`; luego una lista con `BCP`, `Banco do Brasil`, `Otro`; David elige `Banco do Brasil`: llega `S4 fila elegida: Banco do Brasil`.

Repite con texto libre en vez de tocar un botón: llega `S4 respuesta fuera de las opciones`.

**FALLA** si Kapso rechaza algún tipo de mensaje (revisa `workflow_executions` `list_events`) o la variable `eleccion` o `fila` llega vacía. Detente y repórtalo.

Desactiva el trigger de S4.

- [ ] **Paso 6: S3, inicio por API y ventana de 24 h**

El Paso 5 dejó registrado el último mensaje entrante de David, así que la ventana está abierta. Activa el trigger `api_call` de `S3` y llama a `workflow_executions`:

```json
{ "action": "start", "params": { "workflow_id": "<id de S3>", "confirm": true, "phone_number": "+51944686794", "phone_number_id": "597907523413541", "variables": { "operacion_id": "BR-TEST" } } }
```

Esperado: llega `S3 API ok: ventana abierta, operación BR-TEST`.

**FALLA** si llega `cerrada` (sin mensaje) tras haber escrito David hace minutos: la función no recibió `whatsapp_context` o el teléfono no coincide. Detente y repórtalo con la ejecución.

Desactiva el trigger de S3.

- [ ] **Paso 7: Registrar los resultados**

Crea `docs/superpowers/findings/2026-10-12-kapso-spike.md` con: una tabla de cuatro columnas (`Spike`, `Resultado` PASA o FALLA, `Evidencia` con los ids de ejecución y los mensajes observados, `Decisión`) y una fila por cada spike S1 a S4. Debajo, un párrafo por cada FALLA con la causa probable. Anota también cualquier diferencia con la documentación.

- [ ] **Paso 8: Decidir**

- Todos PASAN: continúa con la tarea 6 (salta la 5).
- Solo S1 FALLA: ejecuta la tarea 5 y sigue con la 6.
- S2, S3 o S4 FALLAN: detente y reporta a David con el archivo de hallazgos (formato `NEEDS_HUMAN` de la política operativa). No improvises otra estructura.

- [ ] **Paso 9: Commit**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git add docs/superpowers/findings/2026-10-12-kapso-spike.md kapso/ids.json
git commit -m "docs: resultados del spike de plataforma de Kapso" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: Contingencia, solo si S1 falla: extracción sin agente

Se ejecuta únicamente si el spike S1 falló. Sustituye el nodo `agent` de E1 por una acción determinista de la función. Se pierde la comprensión de frases libres, y la regla "la IA solo extrae" queda sin IA: informa a David al terminar.

**Archivos:**
- Modificar: `kapso/functions/brasper-api.js`, `kapso/functions/brasper-api.test.js`, `kapso/build/workflows.js`

**Interfaces:**
- Produce: acción `extract_from_text` sin aristas. Lee el último mensaje entrante de `whatsapp_context.messages` y devuelve `vars` con `monto`, `moneda_origen` y `moneda_destino` solo para lo que encuentre.

- [ ] **Paso 1: Escribir la prueba (debe fallar)**

Agrega al final de `kapso/functions/brasper-api.test.js`:

```javascript
test('extract_from_text interpreta frases habituales y no inventa datos', async () => {
  const { call } = mundo();
  const dice = (content) => call('extract_from_text', { wa: entrante({ content }) });
  assert.deepEqual((await dice('Hola, quiero enviar 500 reales a Perú')).vars, { monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' });
  assert.deepEqual((await dice('quiero cambiar 100 dólares a soles')).vars, { monto: 100, moneda_origen: 'USD', moneda_destino: 'PEN' });
  assert.deepEqual((await dice('quiero mandar 1.500,50 soles a Brasil')).vars, { monto: 1500.5, moneda_origen: 'PEN', moneda_destino: 'BRL' });
  assert.deepEqual((await dice('hola')).vars, {});
});
```

Ejecuta: `cd kapso && node --test functions/brasper-api.test.js`. Esperado: FALLA con 400 `accion_desconocida` en `extract_from_text`.

- [ ] **Paso 2: Implementar**

En `kapso/functions/brasper-api.js`, dentro del objeto `ACCIONES`, justo antes del bloque `check_extraction`, agrega:

```javascript
  extract_from_text: async ({ wa }) => {
    const m = ultimoEntrante(wa);
    const t = sinAcentos((m && m.content) || '').toLowerCase();
    const posicion = (re) => { const x = re.exec(t); return x ? x.index : -1; };
    const monedas = [['BRL', /\b(reales|real|brl)\b/], ['PEN', /\b(soles|sol|pen)\b/], ['USD', /\b(dolares|dolar|usd)\b/]]
      .map(([cod, re]) => [cod, posicion(re)]).filter(([, p]) => p >= 0).sort((a, b) => a[1] - b[1]);
    const monto = parseMonto(t);
    const origen = monedas[0] && monedas[0][0];
    let destino = monedas[1] && monedas[1][0];
    if (!destino && /\ba (peru|lima)\b/.test(t)) destino = 'PEN';
    if (!destino && /\ba brasil\b/.test(t)) destino = 'BRL';
    return { vars: { ...(monto ? { monto } : {}), ...(origen ? { moneda_origen: origen } : {}), ...(destino ? { moneda_destino: destino } : {}) } };
  },

```

Ejecuta `cd kapso && node --test functions/brasper-api.test.js`. Esperado: `pass 24`.

- [ ] **Paso 3: Cambiar E1 para usar la acción**

En `kapso/build/workflows.js`, dentro de `e1()`, reemplaza estas dos líneas:

```javascript
  f.agent('extraer', AGENTE_EXTRACCION);
  f.link('init', 'extraer');
```

por:

```javascript
  f.api('extraer', 'extract_from_text');
  f.link('init', 'extraer');
```

Ejecuta `cd kapso && node --test`. Esperado: todas pasan (`pass 36`).

- [ ] **Paso 4: Volver a desplegar la función y comprobarla**

Repite el paso 1 y el paso 2 de la tarea 3, usando `functions` `update` (`id`, `code`, `lock_version` de `functions get`) en lugar de `create`, y luego `deploy`. Invoca `{"action":"extract_from_text","whatsapp_context":{"messages":[{"direction":"inbound","content":"Hola, quiero enviar 500 reales a Perú"}]}}`. Esperado: `vars` con `monto` 500, `moneda_origen` `BRL`, `moneda_destino` `PEN`.

- [ ] **Paso 5: Commit**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git add kapso/functions kapso/build/workflows.js
git commit -m "feat: extracción determinista en E1 (el agente falló en el spike)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Publicar el enrutador y las cuatro etapas

**Archivos:**
- Modificar: `kapso/ids.json`

**Interfaces:**
- Consume: Procedimiento P; `emit.js`; los IDs de la tarea 3.
- Produce: cinco workflows activos en Kapso y sus ids en `kapso/ids.json` (`E1`, `E2`, `E3`, `E4`, `W0`).

- [ ] **Paso 1: Generar y publicar las etapas hijas**

```bash
cd kapso && node build/emit.js
```

Aplica P a `brasper-e1-cotiza.json`, `brasper-e2-datos.json`, `brasper-e3-pago.json` y `brasper-e4-estado.json`, en ese orden. E1 a E3 no llevan trigger; E4 lleva uno `api_call` (créalo con `active: true`). Agrega cada `id` a `kapso/ids.json`, bajo `workflows`, con las claves `E1`, `E2`, `E3`, `E4`.

- [ ] **Paso 2: Generar y publicar el enrutador**

```bash
cd kapso && node build/emit.js --strict
```

Esperado: termina bien y lista los cinco, porque `ids.json` ya tiene `functionId` y los ids de `E1` a `E4`. El id de `W0` no hace falta todavía: ningún workflow lo llama. Si `--strict` se queja de `W0`, agrega temporalmente `"W0": "pendiente"` en `workflows`, genera, y reemplázalo por el id real tras el paso siguiente. Aplica P a `brasper-w0-enrutador.json`: crea el trigger `inbound_message` con `active: true`, y publica.

- [ ] **Paso 3: Comprobar el estado**

Llama a `workflows` con `{ "action": "list", "params": {} }`.

Esperado: `BrasPer · W0 Enrutador`, `E1`, `E2`, `E3` y `E4` en estado `active`. El trigger de "Respuesta de prueba sandbox" sigue inactivo (tarea 4, paso 1), y los cinco workflows del spike sin triggers activos. Llama a `workflows` `list_triggers` con `workflow_id` `6bc23f75-0217-4668-9c5a-69f0b6c67490` y confirma `active: false`.

- [ ] **Paso 4: Commit**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git add kapso/ids.json
git commit -m "chore: publicar enrutador y etapas E1 a E4 en Kapso" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 7: Prueba de aceptación en el sandbox

**Archivos:**
- Crear: `docs/superpowers/findings/2026-10-12-acceptance.md`

**Interfaces:**
- Consume: los cinco workflows publicados (tarea 6) y la función con sus utilidades de demo (`reset_demo`, `seed_demo`, `set_status`, `get_operation`).

Convención: «David» envía mensajes desde su WhatsApp al sandbox. «Verifica» significa leer con `whatsapp_messages` `list` (`phone_number_id` `597907523413541`, `phone_number` `51944686794`) y con `workflow_executions` `list`, `get` y `list_events`. Antes de cada criterio, deja el estado limpio con `functions invoke` `{"action":"reset_demo","phone":"51944686794"}` y `{"action":"seed_demo","phone":"51944686794"}`. Anota por criterio: PASA o FALLA, y los ids de ejecución.

- [ ] **Criterio 1, camino feliz E1 a E4**

David envía `Hola, quiero enviar 500 reales a Perú`.

1. Esperado: `¡Hola! Hoy 1 BRL = 0.7 PEN. Comisión 5.00 BRL. Recibirás 350.00 PEN. Tasa asegurada hasta las HH:MM.` con botones `Continuar`, `Cambiar monto`, `Hablar con persona`, y un mensaje aparte con `Abrir formulario web`. David toca `Continuar`.
2. Esperado: `¿Cuál es tu DNI o CPF?`. David envía `12345678`. Luego `¿De dónde provienen los fondos?`: toca `Ahorros`. Luego la lista de bancos: elige `BCP`. Luego `Tengo guardada tu cuenta Scotiabank ••9956. ¿Recibes ahí? Debe estar a tu nombre.`: toca `Sí, esa`.
3. Esperado: `Transfiere 505.00 BRL a:` con `Titular: BrasPer (DEMO)`, `Banco: BCP`, `Cuenta: DEMO-BRL-0001`. Si es fuera de horario, también `Fuera de horario: tu operación se verificará …`. Invoca `get_operation` con `vars.operacion_id` (el `BR-000N` de la operación) y confirma `estado` `esperando_transferencia`. David toca `Ya transferí`.
4. Esperado: `Perfecto. Envíame la foto del comprobante.`. David envía una foto. Luego `Ahora escribe el número de operación bancaria.`: envía `000123`. Esperado: `Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo.`. `get_operation` → `en_validacion`.
5. Simula al backend: invoca `{"action":"set_status","vars":{"operacion_id":"<BR-000N>","estado":"verificada"}}` y llama a `workflow_executions` `start` sobre E4 con `phone_number` `+51944686794`, `phone_number_id` `597907523413541`, `variables` `{"operacion_id":"<BR-000N>"}`, `confirm: true`.
6. Esperado: `✅ Pago verificado. Enviamos tu dinero a la cuenta ••9956.` y `¡Listo! Recibiste 350.00 PEN. Te enviamos tu comprobante por correo.`.

- [ ] **Criterio 2, mensaje que no es una cotización**

`reset_demo`. David envía `hola`. Esperado: `¡Hola! Soy el asistente de BrasPer. ¿Qué moneda quieres enviar?` con `BRL`, `PEN`, `USD`. Toca `BRL`; luego `¿En qué moneda recibe tu destinatario?`: toca `PEN`; luego `¿Cuánto quieres enviar? Escribe solo el monto.`: envía `500`. Esperado: la misma cotización del criterio 1.

- [ ] **Criterio 3, dato inválido dos veces**

`reset_demo`. Llega a la pregunta del DNI. David envía `123`: esperado `No reconozco ese formato. Revisa tu DNI (8 dígitos) o CPF (11 dígitos) y envíalo de nuevo.`. Envía `12`: esperado `Te paso con una persona del equipo para ayudarte.`. `workflow_executions get` muestra estado `handoff`.

- [ ] **Criterio 4, cancelar**

`reset_demo`, `seed_demo` y recorre hasta la cuenta de BrasPer. David toca `Cancelar operación`; esperado `¿Seguro que quieres cancelar la operación BR-000N?`. Toca `Sí, cancelar`: esperado `Listo, cancelé la operación BR-000N.`. `get_operation` → `cancelada`. David envía `hola`: arranca E1 de nuevo, no un estado.

- [ ] **Criterio 5, servicio de tasas caído**

Llama a `functions` `set_secret` con `{ "id": "<functionId>", "name": "TASAS_CAIDAS", "secret_value": "1" }`. Si el secreto no surte efecto de inmediato, vuelve a desplegar la función (`deploy`). `reset_demo`. David envía `Hola, quiero enviar 500 reales a Perú`. Esperado: `Ahora no puedo cotizar con seguridad. Te paso con una persona del equipo para ayudarte.`, sin ninguna cifra de tasa, y ejecución en `handoff`. Luego llama a `functions` `delete_secret` con `{ "id": "<functionId>", "name": "TASAS_CAIDAS" }`.

- [ ] **Criterio 6, volver con una operación en curso**

Completa el criterio 1 hasta el paso 4 (estado `en_validacion`; la ejecución de W0 ya terminó). David envía `hola`. Esperado: `Tu operación BR-000N está en validación: una persona revisa tu pago.`, y no una cotización nueva.

- [ ] **Criterio 7, ningún dato sale del modelo**

Con los mensajes salientes de los criterios 1 y 2, comprueba que cada cifra y cada cuenta coincide con lo que devolvió la función: `tasa` 0.7, `recibe_txt` 350.00, `total_enviar_txt` 505.00 y la cuenta `DEMO-BRL-0001`. Revisa con `workflow_executions` `list_events` que los mensajes del cliente salen de nodos `send_text` o `send_interactive`, no del nodo `agent`.

- [ ] **Criterio 8, ventana de 24 h**

Con la operación del criterio 1 en `verificada`, invoca `{"action":"reset_demo","phone":"51944686794"}` (esto borra la marca de último mensaje) y vuelve a iniciar E4 con `workflow_executions` `start`. Esperado: no llega ningún mensaje, y `list_events` de la ejecución muestra el paso `plantilla` con `aviso_pendiente` `plantilla_requerida`.

- [ ] **Criterio 9, sin respuestas duplicadas**

En todos los criterios anteriores, ninguna respuesta duplicada ni `Hola recibido el mensaje` (el flujo de prueba antiguo). Confirma con `workflows list_triggers` que su trigger sigue `active: false`.

- [ ] **Registrar y decidir**

Escribe `docs/superpowers/findings/2026-10-12-acceptance.md` con una tabla de tres columnas (`Criterio`, `Resultado`, `Evidencia`) y una fila por criterio 1 a 9. Para cada FALLA, el id de ejecución, el mensaje observado frente al esperado y la causa probable. Si hay FALLAS, corrige en la capa que corresponda (función con prueba nueva, o `build/workflows.js` con prueba nueva), vuelve a publicar con P (`workflows update` con la definición nueva y `publish`) y repite solo el criterio que falló. Si el arreglo exige cambiar el diseño, detente y repórtalo a David.

- [ ] **Commit**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git add docs/superpowers/findings/2026-10-12-acceptance.md
git commit -m "docs: resultados de la prueba de aceptación en el sandbox" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 8: Documentación, corrección del spec y cierre

**Archivos:**
- Crear: `kapso/README.md`
- Modificar: `docs/superpowers/specs/2026-10-11-brasper-whatsapp-flow-design.md`

- [ ] **Paso 1: Escribir el manual de la demo**

`kapso/README.md`:

````markdown
# Flujo de WhatsApp de BrasPer en Kapso

Spec: `docs/superpowers/specs/2026-10-11-brasper-whatsapp-flow-design.md`. Todo es de demostración: tasas, cuenta de BrasPer y cliente son ficticios.

## Estructura

- `functions/brasper-api.js`: función de Kapso que simula la API de BrasPer (estado en `env.KV`). Pruebas: `functions/brasper-api.test.js`.
- `build/flow.js`, `build/workflows.js`: generan y validan los workflows. `build/spike.js`: workflows desechables de verificación.
- `ids.json`: IDs de la función y los workflows en Kapso.

## Comandos

```bash
cd kapso
node --test                 # pruebas de la función y de los grafos
node build/emit.js          # genera dist/<slug>.json de E1, E2, E3, E4 y W0
node build/emit.js --strict # igual, exigiendo ids.json completo
```

Para publicar o actualizar un workflow en Kapso, sigue el Procedimiento P del plan (`docs/superpowers/plans/2026-10-12-brasper-whatsapp-kapso.md`).

## Antes de cada demo

Con las herramientas MCP `kapso`, `functions invoke` sobre `brasper-api`:

1. `{"action":"reset_demo","phone":"<TELÉFONO_DE_PRUEBA>"}` limpia la operación activa del teléfono.
2. `{"action":"seed_demo","phone":"<TELÉFONO_DE_PRUEBA>"}` siembra un cliente con la cuenta `Scotiabank ••9956` en PEN.

El teléfono va en formato internacional, sin `+` o con él. Debe haberse unido al sandbox.

## Simular al backend (aviso de pago)

1. `{"action":"set_status","vars":{"operacion_id":"BR-000N","estado":"verificada"}}`.
2. `workflow_executions start` sobre el workflow `BrasPer · E4 Estado`, con `phone_number`, `phone_number_id` `597907523413541`, `variables` `{"operacion_id":"BR-000N"}` y `confirm: true`.

El aviso sale como texto libre y solo si el cliente escribió hace menos de 23 horas. Si no, E4 anota `aviso_pendiente = plantilla_requerida` y no envía nada.

## Estados

`pendiente`, `esperando_transferencia`, `en_validacion`, `verificada`, `enviada`, `completada`, `rechazada`, `cancelada`, `escalada`. `rechazada` en `set_status` hace que E4 avise y pase a una persona.

## Limitaciones conocidas

- El botón "Abrir formulario web" abre `https://brasper.com/es`: la web aún no admite la cotización por parámetros. El enlace a la app no existe todavía.
- Listas de bancos y de origen de fondos, horarios sin feriados, y comisión (1 % sobre el monto) son de demostración.
- Las plantillas de Meta no se usan: fuera de la ventana de 24 h el aviso queda pendiente.
- `env.KV` es de lectura eventual: tras una escritura, una lectura inmediata desde otra región podría tardar en reflejarla.
````

- [ ] **Paso 2: Corregir los textos de botón en el spec**

En `docs/superpowers/specs/2026-10-11-brasper-whatsapp-flow-design.md`, haz estas ediciones exactas con la herramienta Edit:

1. En la sección 5, E1: reemplaza `- **Botones de respuesta (máximo 3):** Continuar, Cambiar monto, Hablar con una persona.` por `- **Botones de respuesta (máximo 3, título de hasta 20 caracteres):** Continuar, Cambiar monto, Hablar con persona.`
2. En la sección 5, E1: reemplaza `Formulario web con la cotización cargada.` por `Botón "Abrir formulario web" (20 caracteres). La web aún no admite la cotización por parámetros: abre la calculadora.`
3. En la sección 9: reemplaza `3 botones de respuesta (Continuar, Cambiar monto, Hablar con una persona)` por `3 botones de respuesta (Continuar, Cambiar monto, Hablar con persona)`.

- [ ] **Paso 3: Actualizar el Figma**

Con `use_figma` (archivo `tymrlM4tRU7O3dztzAN9QV`, `skillNames` `resource:figma-use`), en la página `2 · Chat por etapa`, dentro de la etapa `Etapa 1`, reemplaza el texto `Hablar con una persona` por `Hablar con persona` en el botón de la pantalla A, y el texto `🌐 Usar el formulario web` por `🌐 Abrir formulario web`. Carga la fuente de cada texto con `getStyledTextSegments(['fontName'])` antes de cambiar `characters`. En la página `1 · Arquitectura`, en la tarjeta E1, reemplaza `Hablar con una persona → handoff` por `Hablar con persona → handoff`.

- [ ] **Paso 4: Revisar el árbol de trabajo antes de cerrar**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git status --short
cd kapso && node --test 2>&1 | grep -E 'ℹ (tests|pass|fail)'
```

Esperado: solo archivos intencionales (`kapso/`, `docs/`, `.gitignore`; `reference/` sigue sin seguimiento y no se toca), y todas las pruebas pasan.

- [ ] **Paso 5: Commit**

```bash
cd /Users/davidrodriguez/Programming/iaton-repo
git add kapso/README.md docs/superpowers/specs/2026-10-11-brasper-whatsapp-flow-design.md
git commit -m "docs: manual de la demo y límites de título de botón en el spec" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git log --oneline | head -10
```

---

## Cobertura del spec

| Sección del spec | Tarea |
|---|---|
| 2. Decisiones 1 a 8 | 1, 2 (API simulada, pasos rígidos, extracción, enlaces, aviso, cuentas, estructura, campos) |
| 3. Arquitectura W0 y E1 a E4 | 2, 6 |
| 4. Estados de la operación | 1 (`RUTA_ESTADO`, `ESTADOS`, `set_status`) |
| 5. Especificación por etapa | 2 (`e1` a `e4`, `w0`), 7 |
| 6. Contrato de la API y eventos | 1 (acciones), 7 (evento simulado con `set_status` + `start` de E4) |
| 7. Demo frente a producción | 3, 8 (README) |
| 8. Restricciones de plataforma "por verificar" | 4 |
| 9. Ajuste respecto al Figma | 8 |
| 10. Pruebas de aceptación 1 a 9 | 7 |
| 11. Pendientes (`NEEDS_HUMAN`) | fuera del alcance: siguen abiertos (correo, Brasil/Pix, cliente recurrente, responsable de "persona", horarios y feriados, límites de monto, listas definitivas, plantillas, idiomas, número real) |
| 12. Riesgos | 4 (extracción, ejecución en espera), 6 (flujo de prueba), 8 (datos ficticios) |
