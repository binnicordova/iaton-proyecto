const test = require('node:test');
const assert = require('node:assert/strict');
const { datosComprobante } = require('../src/comprobante/datos');

const OP = {
  id: 'BR-0002', phone: '51944686794', estado: 'completada', creada: '2026-10-13T19:03:00.000Z',
  snap: {
    monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN', tasa: 0.7, tasa_txt: '0.7', monto_txt: '500.00', comision_txt: '5.00',
    recibe_txt: '350.00', total_enviar_txt: '505.00', banco_origen: 'Banco do Brasil', origen_fondos: 'Ahorros',
    dni_cpf: '12345678', tipo_doc: 'DNI', cuenta_banco: 'BCP', cuenta_ultimos4: '1111',
  },
  proof: { n_operacion: '123456', tasa_vencida: false },
};
const fila = (d, seccion, etiqueta) => d.secciones.find((s) => s.titulo === seccion).filas.find((f) => f[0] === etiqueta)[1];

test('arma el comprobante con los datos de la operación, la fecha en hora de Lima y el rótulo de demostración', () => {
  const d = datosComprobante(OP);
  assert.equal(d.numero, 'BR-0002');
  assert.equal(d.fecha, '13/10/2026 14:03');
  assert.equal(d.aviso, 'DOCUMENTO DE DEMOSTRACIÓN');
  assert.match(d.pie, /no es un comprobante.*SUNAT/i);
  assert.equal(fila(d, 'Operación', 'Estado'), 'Completada');
  assert.equal(fila(d, 'Envío', 'Monto enviado'), '500.00 BRL');
  assert.equal(fila(d, 'Envío', 'Comisión'), '5.00 BRL');
  assert.equal(fila(d, 'Envío', 'Total transferido'), '505.00 BRL');
  assert.equal(fila(d, 'Envío', 'Tasa'), '1 BRL = 0.7 PEN');
  assert.equal(fila(d, 'Destino', 'Monto recibido'), '350.00 PEN');
  assert.equal(fila(d, 'Destino', 'Cuenta de destino'), 'BCP ••1111');
  assert.equal(fila(d, 'Origen', 'Banco de origen'), 'Banco do Brasil');
  assert.equal(fila(d, 'Origen', 'Origen de fondos'), 'Ahorros');
  assert.equal(fila(d, 'Origen', 'N.º de operación bancaria'), '123456');
});

test('el documento del cliente va completo (es su propio comprobante), con el tipo de documento', () => {
  assert.equal(fila(datosComprobante(OP), 'Origen', 'Documento'), 'DNI 12345678');
  const cpf = datosComprobante({ ...OP, snap: { ...OP.snap, dni_cpf: '12345678901', tipo_doc: 'CPF' } });
  assert.equal(fila(cpf, 'Origen', 'Documento'), 'CPF 12345678901');
  const sinTipo = datosComprobante({ ...OP, snap: { ...OP.snap, tipo_doc: undefined } });
  assert.equal(fila(sinTipo, 'Origen', 'Documento'), 'DNI 12345678');
});

test('con una operación incompleta no falla: los datos que faltan quedan vacíos para que el PDF muestre un guion', () => {
  const d = datosComprobante({ id: 'BR-0009', estado: 'completada', creada: '2026-10-13T19:03:00.000Z', snap: {} });
  assert.equal(d.numero, 'BR-0009');
  assert.equal(fila(d, 'Destino', 'Cuenta de destino'), undefined);
  assert.equal(fila(d, 'Origen', 'Documento'), undefined);
  assert.equal(fila(d, 'Origen', 'N.º de operación bancaria'), undefined);
});
