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
