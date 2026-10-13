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
