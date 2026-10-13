// Los grafos se importan de kapso/ sin copiarlos: una sola fuente de verdad.
const { buildFlows } = require('../../kapso/build/workflows');
const { validar } = require('../../kapso/build/flow');

function cargarFlujos() {
  const flujos = buildFlows();
  const claves = Object.keys(flujos);
  for (const f of Object.values(flujos)) {
    const errs = validar(f, claves);
    if (errs.length) throw new Error(`${f.key} inválido:\n- ${errs.join('\n- ')}`);
  }
  return flujos;
}

module.exports = { cargarFlujos };
