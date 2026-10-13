// Equivalentes de reset_demo y seed_demo del README de Kapso, ahora sobre la base local.
const vacio = { messages: [] };

// clienteNuevo: además olvida la sesión de Firebase, para repetir el recorrido de un cliente que llega por primera vez.
async function resetDemo({ almacen, llamarFuncion, telefono, clienteNuevo = false }) {
  almacen.borrarEjecucion(telefono);
  if (clienteNuevo) almacen.borrarSesionFirebase(telefono);
  await llamarFuncion({ vars: { api_action: 'reset_demo' }, phone: telefono, edges: [], wa: vacio });
}

async function seedDemo({ llamarFuncion, telefono, cuentas = 1 }) {
  await llamarFuncion({ vars: { api_action: 'seed_demo', cuentas }, phone: telefono, edges: [], wa: vacio });
}

module.exports = { resetDemo, seedDemo };
