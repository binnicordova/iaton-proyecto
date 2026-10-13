const test = require('node:test');
const assert = require('node:assert/strict');
const { crearVigilante } = require('../src/vigilante');
const { crearMundoV2, hastaInstrucciones, T, CHAT } = require('./helpers/mundo-v2');
const { ErrorBackend } = require('../src/backend/real/errores');

const conMundo = async (fn, opciones) => { const m = await crearMundoV2(opciones); try { await fn(m); } finally { await m.cerrar(); } };
const vigilante = (m, extra = {}) => crearVigilante({ almacen: m.almacen, firestore: m.backend.firestore, funciones: m.backend.funciones, motor: m.motor, proveedor: m.proveedor, ahora: m.ahora, registrar: (e) => m.registrados.push(e), ...extra });

// Un cliente con la orden BR-0001 en validación (foto y número ya registrados).
async function validando(m) {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
}
const textos = (m) => m.proveedor.enviados.filter((e) => e.tipo === 'texto').map((e) => e.texto);

test('al aprobarse la orden avisa una sola vez, aunque se revise varias veces', () => conMundo(async (m) => {
  await validando(m);
  const v = vigilante(m);
  const antes = m.proveedor.enviados.length;
  await v.tick();
  assert.equal(m.proveedor.enviados.length, antes); // todavía en validación: no hay nada que avisar
  m.falso.aprobar('BR-0001');
  await v.tick();
  assert.equal(m.ultimo().texto, '✅ Pago verificado. Enviamos tu dinero a la cuenta ••7890.');
  await v.tick();
  await v.tick();
  assert.equal(textos(m).filter((t) => t.startsWith('✅ Pago verificado')).length, 1);
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, 'approved');
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 0); // falta el recibo
}));

test('cuando la factura está aceptada manda el recibo real como documento y cierra el seguimiento', () => conMundo(async (m) => {
  await validando(m);
  const v = vigilante(m);
  m.falso.aprobar('BR-0001');
  await v.tick();
  m.falso.exportar('BR-0001');
  await v.tick(); // exportada pero sin factura: el recibo aún no está listo
  assert.ok(!m.proveedor.enviados.some((e) => e.tipo === 'documento'));
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 0);
  m.falso.facturar('BR-0001');
  await v.tick();
  const doc = m.proveedor.enviados.find((e) => e.tipo === 'documento');
  assert.equal(doc.chatId, CHAT);
  assert.equal(doc.nombre, 'B001-00000001.pdf');
  assert.equal(doc.mimetype, 'application/pdf');
  assert.equal(doc.texto, 'Tu comprobante de la operación BR-0001');
  assert.match(Buffer.from(doc.base64, 'base64').toString(), /^%PDF-1\.4/);
  const s = m.almacen.seguimiento('BR-0001');
  assert.deepEqual([s.reciboEnviado, s.cerrado], [1, 1]);
  await v.tick();
  assert.equal(m.proveedor.enviados.filter((e) => e.tipo === 'documento').length, 1);
}));

test('si la orden salta de aprobada a facturada entre dos revisiones, igual se avisa la aprobación y se manda el recibo', () => conMundo(async (m) => {
  await validando(m);
  m.falso.aprobar('BR-0001'); m.falso.exportar('BR-0001'); m.falso.facturar('BR-0001');
  await vigilante(m).tick();
  assert.equal(textos(m).filter((t) => t.startsWith('✅ Pago verificado')).length, 1);
  assert.equal(m.proveedor.enviados.filter((e) => e.tipo === 'documento').length, 1);
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 1);
}));

test('un pago rechazado avisa el motivo, abre un ticket con una persona y cierra el seguimiento', () => conMundo(async (m) => {
  await validando(m);
  m.falso.rechazar('BR-0001', 'El monto transferido no coincide');
  await vigilante(m).tick();
  assert.ok(textos(m).includes('No pudimos validar tu pago de la operación BR-0001: El monto transferido no coincide.'));
  assert.match(m.ultimo().texto, /^Una persona del equipo te contactará\. Estás en la posición 1/);
  assert.equal(m.falso.tickets.size, 1);
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 1);
}));

test('si el cliente está en otra conversación, el aviso se aplaza y no se marca como enviado', () => conMundo(async (m) => {
  await validando(m);
  const v = vigilante(m);
  m.almacen.guardarEjecucion(T, { flujo: 'E2', telefono: T, chatId: CHAT, nodo: 'x', vars: {}, entrantes: [], esperando: { guardar: null, opciones: null } }); // el cliente está a mitad de otra operación
  m.falso.aprobar('BR-0001');
  const antes = m.proveedor.enviados.length;
  await v.tick();
  assert.equal(m.proveedor.enviados.length, antes);
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, null);
  m.almacen.borrarEjecucion(T); // la conversación termina
  await v.tick();
  assert.equal(m.ultimo().texto, '✅ Pago verificado. Enviamos tu dinero a la cuenta ••7890.');
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, 'approved');
}));

test('persiste a los reinicios: un vigilante nuevo sobre la misma base no repite avisos', () => conMundo(async (m) => {
  await validando(m);
  m.falso.aprobar('BR-0001');
  await vigilante(m).tick();
  const n = m.proveedor.enviados.length;
  await vigilante(m).tick(); // "reinicio"
  assert.equal(m.proveedor.enviados.length, n);
}));

test('un fallo de red al leer la orden no rompe la revisión: se reintenta en la siguiente', () => conMundo(async (m) => {
  await validando(m);
  m.falso.aprobar('BR-0001');
  const v = vigilante(m);
  m.falso.fallar('/orders/BR-0001', { estado: 502, veces: 2 }); // la lectura y su reintento fallan
  await v.tick();
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, null);
  await v.tick();
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, 'approved');
}));

test('una revisión con fallo no impide revisar las demás órdenes', () => conMundo(async (m) => {
  await validando(m);
  m.almacen.abrirSeguimiento({ ordenId: 'BR-9999', telefono: '51900000000', chatId: '51900000000@c.us', creado: m.ahora().toISOString() }); // no existe: sin acceso
  m.falso.aprobar('BR-0001');
  await vigilante(m).tick();
  assert.equal(m.almacen.seguimiento('BR-0001').estadoAvisado, 'approved');
  assert.equal(m.almacen.seguimiento('BR-9999').cerrado, 1); // sin acceso a esa orden: se deja de vigilar
  assert.ok(m.registrados.some((e) => e.tipo === 'seguimiento_sin_acceso'));
}));

test('las órdenes de más de 7 días o canceladas dejan de vigilarse', () => conMundo(async (m) => {
  await validando(m);
  const hace8 = new Date(m.ahora().getTime() - 8 * 24 * 3600 * 1000).toISOString();
  m.bd.prepare('UPDATE seguimientos SET creado = ? WHERE orden_id = ?').run(hace8, 'BR-0001');
  await vigilante(m).tick();
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 1);
  assert.ok(!textos(m).some((t) => t.startsWith('✅')));
}));

test('iniciar y detener manejan el temporizador sin dejar el proceso colgado', async () => {
  let llamadas = 0;
  const v = crearVigilante({ almacen: { seguimientosAbiertos: () => { llamadas += 1; return []; } }, firestore: {}, funciones: {}, motor: {}, proveedor: {}, ahora: () => new Date(), registrar: () => {}, intervaloMs: 10 });
  v.iniciar();
  await new Promise((r) => setTimeout(r, 60));
  v.detener();
  const n = llamadas;
  assert.ok(n >= 2, `se revisó ${n} veces`);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(llamadas, n);
});
