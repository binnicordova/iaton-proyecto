// Mundo de pruebas para los grafos v2: servidor Firebase falso + backend real + motor + proveedor falso.
const { abrirDb } = require('../../src/estado/db');
const { crearAlmacen } = require('../../src/estado/almacen');
const { crearMotor } = require('../../src/motor/motor');
const { crearBackend } = require('../../src/backend');
const { cargarFlujosV2 } = require('../../src/flujos/v2');
const { ProveedorFalso } = require('./proveedor-falso');
const { crearFirebaseFalso } = require('./firebase-falso');
const { msg } = require('./mundo');

const T = '51944686794';
const CHAT = `${T}@c.us`;
const COTIZA = async () => ({ monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' });
const AHORA_SIMULADO = '2026-10-14T15:00:00Z'; // miércoles 10:00 en Lima: horario abierto

async function crearMundoV2({ extraer = COTIZA, db, simular = AHORA_SIMULADO } = {}) {
  const falso = await crearFirebaseFalso();
  const bd = db || abrirDb(':memory:');
  const almacen = crearAlmacen(bd);
  const proveedor = new ProveedorFalso();
  const registrados = [];
  let descargar = async () => ({ bytes: Buffer.from('FOTO'), mimetype: 'image/jpeg' });
  let desfase = 0; // minutos que se adelanta el reloj del bot y el del backend falso
  const ahora = () => new Date(Date.now() + desfase * 60_000);
  const backend = crearBackend({
    modo: 'real', almacen, configReal: falso.config, descargarMedia: (p) => descargar(p), registrar: (e) => registrados.push(e),
    dormir: async () => {}, varsFijas: { simular_ahora: simular }, ahora,
  });
  const motor = crearMotor({ flujos: cargarFlujosV2(), almacen, proveedor, llamarFuncion: backend.llamarFuncion, extraer });
  const decir = (texto, extra = {}) => motor.procesarMensaje(msg(T, texto, extra));
  const tocar = (id, titulo = id) => decir(titulo, { opcionId: id });
  const foto = (extra = {}) => decir('', { tieneMedia: true, tipoMensaje: 'image', mensajeId: `wamid-${Math.random()}`, mediaUrl: 'http://waha/api/files/f.jpeg', mimetype: 'image/jpeg', ...extra });
  const ultimo = () => proveedor.enviados.at(-1);
  return {
    falso, almacen, bd, proveedor, motor, backend, registrados, decir, tocar, foto, ultimo, T, CHAT,
    descargar: { usar: (fn) => { descargar = fn; } },
    avanzar: (min) => { desfase += min; falso.avanzar(min); }, ahora,
    cerrar: () => falso.cerrar(),
  };
}

// Lleva a un cliente nuevo hasta recibir las instrucciones de pago (E3) con una orden creada.
async function hastaInstrucciones(m) {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('529.982.247-25');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  await m.tocar('confirmar', 'Confirmar');
}

module.exports = { crearMundoV2, hastaInstrucciones, T, CHAT };
