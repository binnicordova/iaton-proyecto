const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { entregarComprobante } = require('../src/comprobante/entrega');
const { ErrorEnvio } = require('../src/provider/waha');
const { ProveedorFalso } = require('./helpers/proveedor-falso');

const T = '51944686794';
const OP = {
  id: 'BR-0002', phone: T, estado: 'completada', creada: '2026-10-13T19:03:00.000Z',
  snap: { moneda_origen: 'BRL', moneda_destino: 'PEN', monto_txt: '500.00', total_enviar_txt: '505.00', recibe_txt: '350.00', tasa_txt: '0.7', cuenta_banco: 'BCP', cuenta_ultimos4: '1111', dni_cpf: '12345678', tipo_doc: 'DNI' },
  proof: { n_operacion: '123456' },
};

async function mundo(op = OP) {
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const kv = almacen.kvEnv();
  if (op) await kv.put(`op:${op.id}`, JSON.stringify(op));
  const proveedor = new ProveedorFalso();
  const eventos = [];
  const entregar = (extra = {}) => entregarComprobante({ kv, proveedor, registrar: (e) => eventos.push(e), telefono: T, chatId: `${T}@c.us`, operacionId: 'BR-0002', ...extra });
  return { kv, proveedor, eventos, entregar };
}

test('con la operación completada envía el PDF por el chat, con su nombre y su texto', async () => {
  const m = await mundo();
  const r = await m.entregar();
  assert.equal(r.enviado, true);
  assert.equal(m.proveedor.enviados.length, 1);
  const d = m.proveedor.enviados[0];
  assert.equal(d.tipo, 'documento');
  assert.equal(d.chatId, `${T}@c.us`);
  assert.equal(d.nombre, 'comprobante-BR-0002.pdf');
  assert.equal(d.mimetype, 'application/pdf');
  assert.equal(d.texto, 'Tu comprobante de la operación BR-0002');
  const pdf = Buffer.from(d.base64, 'base64');
  assert.ok(pdf.subarray(0, 5).toString('latin1') === '%PDF-');
  assert.ok(pdf.includes(Buffer.from('(BR-0002)', 'latin1')));
  assert.equal(r.bytes, pdf.length);
});

test('no envía nada si la operación no existe, no está completada o es de otro cliente', async () => {
  const sin = await mundo(null);
  assert.deepEqual(await sin.entregar(), { enviado: false, motivo: 'sin_operacion' });
  const pendiente = await mundo({ ...OP, estado: 'en_validacion' });
  assert.deepEqual(await pendiente.entregar(), { enviado: false, motivo: 'no_completada' });
  const ajena = await mundo({ ...OP, phone: '51988888888' });
  assert.deepEqual(await ajena.entregar(), { enviado: false, motivo: 'otro_cliente' });
  for (const m of [sin, pendiente, ajena]) assert.equal(m.proveedor.enviados.length, 0);
});

test('no repite el envío si se avisa dos veces la misma operación', async () => {
  const m = await mundo();
  assert.equal((await m.entregar()).enviado, true);
  assert.deepEqual(await m.entregar(), { enviado: false, motivo: 'ya_enviado' });
  assert.equal(m.proveedor.enviados.length, 1);
});

test('un fallo de transporte se registra sin el archivo y deja reintentar después', async () => {
  const m = await mundo();
  m.proveedor.fallar.push(new ErrorEnvio('WAHA caído', { estado: 502, reintentable: true }));
  assert.deepEqual(await m.entregar(), { enviado: false, motivo: 'error_envio' });
  assert.equal(m.eventos.length, 1);
  assert.equal(m.eventos[0].tipo, 'error_comprobante');
  assert.ok(!JSON.stringify(m.eventos).includes('JVBER'));
  assert.equal((await m.entregar()).enviado, true); // no quedó marcado como enviado
});
