const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMundoV2, hastaInstrucciones, T } = require('./helpers/mundo-v2');

const conMundo = async (fn, opciones) => { const m = await crearMundoV2(opciones); try { await fn(m); } finally { await m.cerrar(); } };
const HORA = '\\d{1,2}:\\d\\d [ap]\\. m\\.';

test('cliente nuevo: de la cotización hasta que la orden queda en validación en el backend', () => conMundo(async (m) => {
  const e = m.proveedor.enviados;
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  assert.equal(e[0].tipo, 'botones');
  assert.match(e[0].texto, new RegExp(`^¡Hola! Hoy 1 BRL = 0\\.6745 PEN\\. Comisión 12\\.00 \\+ impuesto 2\\.16 BRL\\. Total a transferir 514\\.16 BRL\\. Recibirás 337\\.25 PEN\\. Tasa asegurada hasta las ${HORA}$`));
  assert.deepEqual(e[0].opciones.map((o) => o.id), ['continuar', 'cambiar_monto', 'persona']);
  assert.equal(e[1].tipo, 'enlace');
  assert.equal(m.falso.llamadas.find((l) => l.nombre === 'createQuote').data.channel, 'whatsapp');

  await m.tocar('continuar', 'Continuar');
  assert.equal(m.ultimo().texto, '¿Cuál es tu nombre completo? Escribe nombre y apellido.');
  await m.decir('Ana Paula Souza');
  assert.equal(m.ultimo().tipo, 'lista');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['DNI', 'CE', 'RUC', 'CPF']);
  await m.tocar('CPF');
  assert.equal(m.ultimo().texto, 'Escribe tu número de CPF.');
  await m.decir('529.982.247-25');
  assert.equal(m.ultimo().texto, '¿A qué correo electrónico te enviamos tu comprobante?');
  await m.decir('ana@example.com');
  assert.equal(m.ultimo().texto, '¿De dónde provienen los fondos?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['savings', 'salary', 'business', 'asset_sale', 'donation', 'other']);
  await m.tocar('savings', 'Ahorros');
  assert.equal(m.ultimo().texto, '¿Desde qué banco nos envías tu dinero?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro']);
  await m.tocar('Nubank');
  assert.equal(m.ultimo().texto, 'Escribe el número de la cuenta en Nubank.');
  await m.decir('0001-12345678-9');
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro']);
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  assert.equal(m.ultimo().texto, 'Envías 514.16 BRL desde Nubank ••6789.\nRecibe 337.25 PEN en BCP ••7890.\nTasa 0.6745. ¿Confirmas?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['confirmar', 'cambiar', 'cancelar']);
  assert.equal(m.falso.ordenes.size, 0); // todavía no se creó nada

  await m.tocar('confirmar', 'Confirmar');
  const instr = e.at(-2);
  assert.match(instr.texto, new RegExp(`^Tu operación es BR-0001\\.\\nTransfiere 514\\.16 BRL a:\\nTitular: BrasPer \\(DEMO\\)\\nBanco: Nubank\\nCuenta: 0001-0000001-0\\nPix: pix@brasper\\.demo\\nUsa la cuenta de BRL, no otra moneda\\.\\nTasa asegurada hasta las ${HORA}$`));
  assert.equal(m.ultimo().texto, 'Cuando termines la transferencia, toca "Ya transferí".');
  const o = m.falso.ordenes.get('BR-0001');
  assert.deepEqual([o.channel, o.status, o.clientName, o.docType, o.docNumber, o.email, o.fundsSource], ['whatsapp', 'pending', 'Ana Paula Souza', 'CPF', '52998224725', 'ana@example.com', 'savings']);
  assert.deepEqual([o.sourceBank, o.sourceAccount, o.destinationBank, o.destinationAccount], ['Nubank', '0001-12345678-9', 'BCP', '191-1234567890']);

  // Los datos personales ya no están en el estado de la conversación ni en el registro.
  const guardado = JSON.stringify(m.almacen.cargarEjecucion(T));
  for (const dato of ['52998224725', 'ana@example.com', 'Ana Paula Souza', '0001-12345678-9', '191-1234567890']) assert.ok(!guardado.includes(dato), `el estado no debe guardar ${dato}`);

  await m.tocar('ya_transferi', 'Ya transferí');
  assert.equal(m.ultimo().texto, 'Perfecto. Envíame la foto del comprobante (imagen o PDF).');
  await m.foto();
  assert.equal(m.ultimo().texto, 'Ahora escribe el número de operación bancaria.');
  assert.equal(m.falso.archivos.size, 1);
  assert.match([...m.falso.archivos.keys()][0], /^proofs\/uid001\/BR-0001\/proof-\d+\.jpg$/);
  await m.decir('ab-1234');
  assert.equal(m.ultimo().texto, 'Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo.');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
  assert.equal(m.falso.ordenes.get('BR-0001').operationNo, 'AB-1234');
  assert.equal(m.almacen.cargarEjecucion(T), null);
  assert.equal(m.almacen.seguimientosAbiertos().length, 1);
  // Ningún dato personal llega al registro (ni de la base ni de los eventos que se informan).
  const todo = JSON.stringify(m.bd.prepare('SELECT * FROM registro').all()) + JSON.stringify(m.registrados);
  for (const dato of ['52998224725', 'ana@example.com', 'Ana Paula', '0001-12345678-9']) assert.ok(!todo.includes(dato), `el registro no debe tener ${dato}`);
}));

// Una orden ya terminada para ese teléfono: el siguiente mensaje empieza una operación nueva con el perfil guardado.
async function cerrarLaPrimera(m) {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  m.falso.aprobar('BR-0001');
  m.almacen.actualizarSeguimiento('BR-0001', { cerrado: 1 }); // lo que hará el vigilante al terminar
}

test('cliente que vuelve: confirma sus datos y elige sus cuentas guardadas de una lista', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  const n = m.proveedor.enviados.length;
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  assert.equal(m.ultimo().texto, 'Usaremos tu CPF 52998224725 y tu correo a***@example.com. ¿Es correcto?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['si_datos', 'cambiar']);
  await m.tocar('si_datos', 'Sí, es correcto');
  assert.equal(m.ultimo().texto, '¿De dónde provienen los fondos?');
  await m.tocar('salary', 'Sueldo');
  assert.equal(m.ultimo().texto, 'Elige la cuenta desde la que vas a pagar:');
  assert.deepEqual(m.ultimo().opciones, [{ id: 'acc:0', title: 'Nubank ••6789' }, { id: 'otra', title: 'Otra cuenta' }]);
  await m.tocar('acc:0', 'Nubank ••6789');
  assert.equal(m.ultimo().texto, 'Elige la cuenta donde recibirá tu destinatario:');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.title), ['BCP ••7890', 'Otra cuenta']);
  await m.tocar('acc:0', 'BCP ••7890');
  assert.match(m.ultimo().texto, /^Envías 514\.16 BRL desde Nubank ••6789\.\nRecibe 337\.25 PEN en BCP ••7890\./);
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.falso.ordenes.get('BR-0002').fundsSource, 'salary');
  assert.equal(m.falso.ordenes.get('BR-0002').clientName, 'Ana Paula Souza');
  assert.ok(m.proveedor.enviados.length > n);
  assert.equal(m.falso.usuarios.size, 1); // el mismo usuario anónimo de siempre: así recuerda al cliente
}));

test('cliente que vuelve y elige "Otra cuenta" para el destino: pide banco y número', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.tocar('si_datos', 'Sí, es correcto');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('acc:0', 'Nubank ••6789');
  await m.tocar('otra', 'Otra cuenta');
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?');
  await m.tocar('Otro');
  assert.equal(m.ultimo().texto, 'Escribe el nombre de tu banco.');
  await m.decir('Banco Pichincha');
  assert.equal(m.ultimo().texto, 'Escribe el número de la cuenta en Banco Pichincha.');
  await m.decir('555-0099');
  await m.tocar('confirmar', 'Confirmar');
  assert.deepEqual([m.falso.ordenes.get('BR-0002').destinationBank, m.falso.ordenes.get('BR-0002').destinationAccount], ['Banco Pichincha', '555-0099']);
}));

test('si la cotización vence mientras el cliente completa los datos, se cotiza de nuevo y se pide confirmar', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.avanzar(16);
  await m.tocar('confirmar', 'Confirmar');
  assert.match(m.ultimo().texto, /^La tasa cambió\. Nueva cotización: 1 BRL = 0\.6745 PEN\. Total a transferir 514\.16 BRL\./);
  assert.equal(m.falso.ordenes.size, 0);
  await m.tocar('continuar', 'Continuar');
  assert.equal(m.falso.ordenes.size, 1);
  assert.match(m.proveedor.enviados.at(-2).texto, /^Tu operación es BR-0001\./);
}));

test('un monto por encima del límite pasa a una persona con un ticket en el backend', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 20000 reales a Perú');
  assert.equal(m.falso.ordenes.size, 0);
  assert.equal(m.falso.tickets.size, 1);
  const t = [...m.falso.tickets.values()][0];
  assert.equal(t.channel, 'whatsapp');
  assert.match(t.summary, /monto_grande/);
  assert.equal(m.ultimo().texto, 'Por el monto, te paso con una persona del equipo para ayudarte. Estás en la posición 1 (espera aproximada: 3 min).');
  assert.equal(m.almacen.cargarEjecucion(T), null);
}, { extraer: async () => ({ monto: 20000, moneda_origen: 'BRL', moneda_destino: 'PEN' }) }));

test('un monto menor al mínimo explica el mínimo y vuelve a pedir el monto', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 10 reales a Perú');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Ese monto es menor al mínimo (unos 10 USD equivalentes). Escribe un monto mayor.');
  assert.equal(m.ultimo().texto, '¿Cuánto quieres enviar? Escribe solo el monto.');
  await m.decir('500');
  assert.match(m.proveedor.enviados.at(-2).texto, /Total a transferir 514\.16 BRL/); // la oferta va antes del enlace web
}, { extraer: async () => ({ monto: 10, moneda_origen: 'BRL', moneda_destino: 'PEN' }) }));

test('datos inválidos para el backend: se repregunta solo el campo que rechazó', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.fallar('/fn/createorder', { estado: 400, veces: 1, cuerpo: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'invalid-input', details: [{ path: 'email', message: 'x' }] } }) });
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Uno de tus datos no pasó la validación. Revisémoslo.');
  assert.equal(m.ultimo().texto, '¿A qué correo electrónico te enviamos tu comprobante?');
}));

test('las respuestas inválidas en un paso de texto repiten la pregunta y el segundo fallo escala', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana');
  assert.equal(m.ultimo().texto, 'Necesito tu nombre y apellido, por ejemplo Ana Souza.');
  await m.decir('');
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte\./);
  assert.equal(m.falso.tickets.size, 1);
}));

test('documento inválido para el tipo elegido: repite y no avanza', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('DNI');
  await m.decir('1234567');
  assert.equal(m.ultimo().texto, 'Ese número no es válido para DNI. Revísalo y envíalo de nuevo.');
  await m.decir('12345678');
  assert.equal(m.ultimo().texto, '¿A qué correo electrónico te enviamos tu comprobante?');
}));

test('E3: el número de operación duplicado se avisa y se puede corregir', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.tocar('si_datos', 'Sí, es correcto');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('acc:0', 'Nubank ••6789');
  await m.tocar('acc:0', 'BCP ••7890');
  await m.tocar('confirmar', 'Confirmar');
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234'); // el mismo de la primera orden
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Ese número de operación ya está en otra operación. Revísalo y envíalo de nuevo.');
  assert.equal(m.ultimo().texto, 'Ahora escribe el número de operación bancaria.'); // vuelve a pedirlo
  assert.equal(m.falso.ordenes.get('BR-0002').status, 'pending');
  await m.decir('ZZ-9999');
  assert.equal(m.ultimo().texto, 'Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo.');
  assert.equal(m.falso.ordenes.get('BR-0002').status, 'validating');
}));

test('E3: sin foto, archivo de otro tipo o demasiado grande no avanzan; el segundo fallo escala', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.decir('ya pagué');
  assert.equal(m.ultimo().texto, 'No recibí una foto o PDF. Envíame la foto o captura del comprobante.');
  m.descargar.usar(async () => ({ bytes: Buffer.alloc(8 * 1024 * 1024), mimetype: 'image/jpeg' }));
  await m.foto();
  assert.equal(m.ultimo().texto, 'El archivo pesa más de 8 MB. Envía una foto más liviana o un PDF más pequeño.');
  m.descargar.usar(async () => ({ bytes: Buffer.from('v'), mimetype: 'video/mp4' }));
  await m.foto();
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte\./); // segundo fallo del mismo paso
  assert.equal(m.falso.archivos.size, 0);
}));

test('E3: cancelar con confirmación cancela la orden en el backend', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.tocar('cancelar', 'Cancelar operación');
  assert.equal(m.ultimo().texto, '¿Seguro que quieres cancelar la operación BR-0001?');
  await m.tocar('si_cancelar', 'Sí, cancelar');
  assert.equal(m.ultimo().texto, 'Listo, cancelé la operación BR-0001.');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'cancelled');
  await m.decir('hola'); // vuelve a empezar: no queda nada pendiente
  assert.equal(m.proveedor.enviados.at(-2).tipo, 'botones');
}));

test('E3: si el bloqueo de tasa venció cuando dice "Ya transferí", se avisa y se sigue pidiendo la foto', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  m.avanzar(31); // el bloqueo de la orden dura 30 min
  await m.tocar('ya_transferi', 'Ya transferí');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Tu tasa asegurada venció mientras transferías. Igual recibo tu constancia: una persona confirmará la tasa final al validar tu pago.');
  assert.equal(m.ultimo().texto, 'Perfecto. Envíame la foto del comprobante (imagen o PDF).');
}));

test('si Firebase no responde, se avisa del problema temporal y el siguiente mensaje reintenta sin perder lo hecho', () => conMundo(async (m) => {
  m.falso.fallar('/fn/createquote', { estado: 502, veces: 2 }); // el reintento interno también falla
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  assert.equal(m.ultimo().texto, 'Tuvimos un problema temporal. Intenta de nuevo en un momento.');
  assert.equal(m.falso.tickets.size, 0); // no se escaló a nadie
  assert.ok(m.almacen.cargarEjecucion(T));
  await m.decir('ya');
  assert.match(m.proveedor.enviados.at(-2).texto, /^¡Hola! Hoy 1 BRL = 0\.6745 PEN/);
}));

test('si createOrder falla por red, la orden no se pierde ni se duplica: el siguiente mensaje reintenta', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.fallar('/fn/createorder', { estado: 502, veces: 1 });
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.ultimo().texto, 'Tuvimos un problema temporal. Intenta de nuevo en un momento.');
  assert.equal(m.falso.ordenes.size, 0);
  await m.decir('listo');
  assert.equal(m.falso.ordenes.size, 1);
  assert.match(m.proveedor.enviados.at(-2).texto, /^Tu operación es BR-0001\./);
}));

test('W0: quien vuelve con una orden pendiente ve de nuevo las instrucciones; en validación, el estado', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  m.almacen.borrarEjecucion(T); // el cliente se fue sin transferir y la conversación quedó cerrada
  await m.decir('hola otra vez');
  assert.match(m.proveedor.enviados.at(-2).texto, /^Tu operación es BR-0001\.\nTransfiere 514\.16 BRL a:/);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  await m.decir('¿cómo va?');
  assert.equal(m.ultimo().texto, 'Tu operación BR-0001 está en validación: una persona revisa tu pago.');
  m.falso.aprobar('BR-0001');
  await m.decir('¿y ahora?');
  assert.equal(m.ultimo().texto, 'Tu operación BR-0001 está verificada: estamos enviando tu dinero.');
}));

test('"Hablar con persona" abre un ticket y los mensajes siguientes reciben el aviso de que ya los atienden', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('persona', 'Hablar con persona');
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte\. Estás en la posición 1/);
  assert.equal(m.falso.tickets.size, 1);
  await m.decir('¿hay alguien?');
  assert.equal(m.ultimo().texto, 'Una persona del equipo ya está atendiendo tu caso.');
  [...m.falso.tickets.values()][0].status = 'closed';
  await m.decir('hola');
  assert.equal(m.proveedor.enviados.at(-2).tipo, 'botones'); // el ticket se cerró: empieza de nuevo
}));

test('reinicio del servidor a mitad de los datos: retoma desde SQLite sin pedir nada otra vez', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  const { crearMotor } = require('../src/motor/motor');
  const { cargarFlujosV2 } = require('../src/flujos/v2');
  const { msg } = require('./helpers/mundo');
  const otro = crearMotor({ flujos: cargarFlujosV2(), almacen: m.almacen, proveedor: m.proveedor, llamarFuncion: m.backend.llamarFuncion, extraer: async () => ({}) });
  await otro.procesarMensaje(msg(T, 'CPF', { opcionId: 'CPF' }));
  assert.equal(m.ultimo().texto, 'Escribe tu número de CPF.');
}));

test('texto libre con llaves de plantilla (nombre de banco) se muestra tal cual y no se interpreta', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('529.982.247-25');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Otro');
  await m.decir('Banco {{vars.quote_id}} {{vars.api_action}}');
  await m.decir('0001-12345678-9');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  assert.match(m.ultimo().texto, /^Envías 514\.16 BRL desde Banco \{\{vars\.quote_id\}\} \{\{vars\.api_action\}\} ••6789\./);
}));

test('E3: una foto enviada antes de tocar "Ya transferí" no sube nada ni avanza', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.foto();
  assert.equal(m.falso.archivos.size, 0);
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'pending');
  await m.tocar('ya_transferi', 'Ya transferí'); // el flujo sigue ahí: puede continuar con normalidad
  assert.equal(m.ultimo().texto, 'Perfecto. Envíame la foto del comprobante (imagen o PDF).');
}));

test('sentido inverso PEN → BRL: bancos peruanos para enviar y brasileños para recibir, cuenta de pago en soles y orden en validación', () => conMundo(async (m) => {
  const e = m.proveedor.enviados;
  await m.decir('Quiero enviar 500 soles a Brasil');
  assert.match(e[0].texto, /^¡Hola! Hoy 1 PEN = [\d.]+ BRL\. Comisión [\d.]+ \+ impuesto [\d.]+ PEN\. Total a transferir [\d.]+ PEN\. Recibirás [\d.]+ BRL\./);
  const cot = m.falso.llamadas.find((l) => l.nombre === 'createQuote').data;
  assert.deepEqual([cot.sendCurrency, cot.receiveCurrency, cot.sendAmount, cot.channel], ['PEN', 'BRL', 500, 'whatsapp']);
  await m.tocar('continuar', 'Continuar');
  await m.decir('Luis Alberto Quispe');
  await m.tocar('DNI');
  await m.decir('45678912');
  await m.decir('luis@example.com');
  await m.tocar('salary', 'Sueldo');
  assert.equal(m.ultimo().texto, '¿Desde qué banco nos envías tu dinero?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro']);
  await m.tocar('Interbank');
  await m.decir('200-3012345678');
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro']);
  await m.tocar('Nubank');
  await m.decir('0001-98765432-1');
  assert.match(m.ultimo().texto, /^Envías [\d.]+ PEN desde Interbank ••5678\.\nRecibe [\d.]+ BRL en Nubank ••4321\./);
  await m.tocar('confirmar', 'Confirmar');
  const o = m.falso.ordenes.get('BR-0001');
  assert.deepEqual([o.sendCurrency, o.receiveCurrency, o.docType, o.fundsSource, o.sourceBank, o.destinationBank], ['PEN', 'BRL', 'DNI', 'salary', 'Interbank', 'Nubank']);
  const instr = e.at(-2).texto;
  assert.match(instr, /^Tu operación es BR-0001\.\nTransfiere [\d.]+ PEN a:\nTitular: BrasPer \(DEMO\)\nBanco: BCP\nCuenta: 191-0000000-0-00\n/);
  assert.ok(!/Pix/.test(instr), 'la cuenta en soles no tiene Pix');
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('op-5555');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
  m.falso.aprobar('BR-0001');
}, { extraer: async () => ({ monto: 500, moneda_origen: 'PEN', moneda_destino: 'BRL' }) }));

test('USD como moneda de envío ofrece la lista de bancos de dólares y cotiza en dólares', () => conMundo(async (m) => {
  await m.decir('Quiero enviar 300 dólares a Perú');
  const cot = m.falso.llamadas.find((l) => l.nombre === 'createQuote').data;
  assert.deepEqual([cot.sendCurrency, cot.receiveCurrency, cot.sendAmount], ['USD', 'PEN', 300]);
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('529.982.247-25');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Otro']);
}, { extraer: async (t) => (/dólares/.test(t) ? { monto: 300, moneda_origen: 'USD', moneda_destino: 'PEN' } : { monto: 500, moneda_origen: 'PEN', moneda_destino: 'BRL' }) }));
