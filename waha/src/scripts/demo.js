// Uso: node src/scripts/demo.js reset|seed <telefono> [--cuentas 2] [--cliente-nuevo]
const path = require('node:path');
const { cargarConfig, cargarEnvDeArchivos } = require('../config');
const { abrirDb } = require('../estado/db');
const { crearAlmacen } = require('../estado/almacen');
const { crearLlamadorFuncion } = require('../puente-api');
const { resetDemo, seedDemo } = require('../demo');

(async () => {
  const [orden, tel, ...resto] = process.argv.slice(2);
  const telefono = String(tel || '').replace(/\D/g, '');
  if (!['reset', 'seed'].includes(orden) || !telefono) { console.error('Uso: demo.js reset|seed <telefono> [--cuentas 2]'); process.exit(1); }
  const config = cargarConfig({ ...cargarEnvDeArchivos(path.join(__dirname, '..', '..')), ...process.env });
  const almacen = crearAlmacen(abrirDb(config.dbPath));
  const llamarFuncion = crearLlamadorFuncion({ kvEnv: almacen.kvEnv() });
  if (orden === 'reset') await resetDemo({ almacen, llamarFuncion, telefono, clienteNuevo: resto.includes('--cliente-nuevo') });
  else await seedDemo({ llamarFuncion, telefono, cuentas: resto.includes('--cuentas') ? Number(resto[resto.indexOf('--cuentas') + 1]) : 1 });
  console.log(`${orden} listo para ${'*'.repeat(Math.max(0, telefono.length - 4))}${telefono.slice(-4)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
