// Equivalentes de reset_demo y seed_demo del README de Kapso, ahora sobre la base local.
const vacio = { messages: [] };

async function resetDemo({ almacen, llamarFuncion, telefono }) {
  almacen.borrarEjecucion(telefono);
  await llamarFuncion({ vars: { api_action: 'reset_demo' }, phone: telefono, edges: [], wa: vacio });
}

async function seedDemo({ llamarFuncion, telefono, cuentas = 1 }) {
  await llamarFuncion({ vars: { api_action: 'seed_demo', cuentas }, phone: telefono, edges: [], wa: vacio });
}

module.exports = { resetDemo, seedDemo };
