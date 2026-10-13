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

const filas = (flow, id) => flow.nodes.find((n) => n.id === id).config.list_sections.flatMap((s) => s.rows.map((r) => r.id));

test('E2 ofrece bancos según la moneda: reales solo bancos de Brasil y soles solo bancos de Perú', () => {
  const e2 = flows.E2;
  for (const n of ['bo', 'bn']) {
    const brl = filas(e2, `${n}_ask_BRL`);
    const pen = filas(e2, `${n}_ask_PEN`);
    assert.ok(brl.includes('Banco do Brasil') && !brl.includes('BCP'), `${n} BRL: ${brl}`);
    assert.ok(pen.includes('BCP') && !pen.includes('Banco do Brasil'), `${n} PEN: ${pen}`);
    assert.ok(filas(e2, `${n}_ask_USD`).length <= LIMITES.filas);
  }
});

test('la lista incorrecta se reenvía por moneda al responder fuera de las opciones', () => {
  const e2 = flows.E2;
  const aristas = e2.edges.filter((e) => e.source === 'bo_route' && e.label === 'invalido');
  assert.deepEqual(aristas.map((e) => e.target), ['bo_mon_set']);
});

test('el aviso fuera de horario no termina en punto tras la variable (evita "a. m..")', () => {
  const fuera = flows.E3.nodes.find((n) => n.id === 'fuera').config.message;
  assert.ok(!fuera.endsWith('}}.'), fuera);
  assert.ok(fuera.includes('{{vars.proxima_verificacion}}'));
});

test('la lista de USD no incluye Caixa y la de BRL sí', () => {
  assert.ok(!filas(flows.E2, 'bo_ask_USD').includes('Caixa'));
  assert.ok(filas(flows.E2, 'bo_ask_BRL').includes('Caixa'));
});

test('banco "Otro" al agregar una cuenta nueva lleva al formulario web, no a pedir el número', () => {
  const e2 = flows.E2;
  const aristas = e2.edges.filter((e) => e.source === 'bn_route' && e.label === 'Otro');
  assert.equal(aristas.length, 1);
  assert.ok(aristas[0].target.startsWith('bnotro'), aristas[0].target);
  const cta = e2.nodes.find((n) => n.id === 'bnotro_cta');
  assert.equal(cta.config.cta_url, 'https://brasper.com/es');
});

test('E4 cierra la operación como completada tras avisar al cliente', () => {
  const e = flows.E4.edges.find((x) => x.source === 'listo');
  assert.equal(e.target, 'cierra_set');
  const set = flows.E4.nodes.find((n) => n.id === 'cierra_set');
  assert.equal(JSON.stringify(set.config).includes('complete_operation'), true);
});

test('E3 revisa la vigencia de la tasa al tocar "Ya transferí" y avisa si venció', () => {
  const e3 = flows.E3;
  const desde = (src, label) => e3.edges.filter((e) => e.source === src && e.label === label).map((e) => e.target);
  assert.deepEqual(desde('ac_route', 'ya_transferi'), ['vigencia2_set']);
  assert.deepEqual(desde('vigencia2', 'vigente'), ['pide_foto']);
  assert.deepEqual(desde('vigencia2', 'vencida'), ['marca_vencida']);
  assert.deepEqual(desde('marca_vencida', 'next'), ['aviso_vencida']);
  assert.deepEqual(desde('aviso_vencida', 'next'), ['pide_foto']);
  assert.match(e3.nodes.find((n) => n.id === 'aviso_vencida').config.message, /venció/);
});

test('el agente de E1 solo envía mensajes por herramientas (tool_only)', () => {
  const agente = flows.E1.nodes.find((n) => n.id === 'extraer').config;
  assert.equal(agente.message_delivery_mode, 'tool_only');
});

test('"Otra cuenta" recorre las demás cuentas guardadas antes de pedir una nueva', () => {
  const e2 = flows.E2;
  const desde = (src, label) => e2.edges.filter((e) => e.source === src && e.label === label).map((e) => e.target);
  assert.deepEqual(desde('cu_route', 'otra_cuenta'), ['sig_set']);
  assert.deepEqual(desde('sig', 'otra_guardada'), ['cu_ask']);
  assert.deepEqual(desde('sig', 'nueva'), ['bn_mon_set']);
});

test('el agente de E1 solo pide save_variable y complete_task y el prompt prohíbe las demás herramientas', () => {
  const agente = flows.E1.nodes.find((n) => n.id === 'extraer').config;
  assert.deepEqual(agente.enabled_default_tools, ['save_variable', 'complete_task']);
  assert.match(agente.system_prompt, /solo.*save_variable.*complete_task.*nunca otra/is);
  assert.equal(agente.message_delivery_mode, 'tool_only');
});
