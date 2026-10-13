// Carga y valida los grafos v2. validar() de kapso/ no conoce las listas dinámicas (`rows_var`), así que para validar
// se sustituyen por una lista fija de ejemplo.
const { validar } = require('../../../../kapso/build/flow');
const { e1 } = require('./e1');
const { e2 } = require('./e2');
const { e3 } = require('./e3');
const { e4, w0 } = require('./e4w0');

function paraValidar(flow) {
  const nodes = flow.nodes.map((n) => (n.config && n.config.rows_var
    ? { ...n, config: { ...n.config, list_sections: [{ title: 'Opciones', rows: [{ id: 'x', title: 'x' }] }] } }
    : n));
  return { ...flow, nodes };
}

function cargarFlujosV2() {
  const flujos = { E1: e1(), E2: e2(), E3: e3(), E4: e4(), W0: w0() };
  const claves = Object.keys(flujos);
  for (const f of Object.values(flujos)) {
    const errs = validar(paraValidar(f), claves);
    if (errs.length) throw new Error(`${f.key} (v2) inválido:\n- ${errs.join('\n- ')}`);
  }
  return flujos;
}

module.exports = { cargarFlujosV2 };
