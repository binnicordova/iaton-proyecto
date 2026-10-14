// Piezas comunes de los grafos v2 (mismas ideas que kapso/build/workflows.js, con las acciones del backend real).
const { PHONE_NUMBER_ID } = require('../../../../kapso/build/flow');

const MSG_PERSONA = 'Te paso con una persona del equipo para ayudarte 🙋';
const MSG_SIN_TASAS = 'Ahora no puedo cotizar con seguridad. Te paso con una persona del equipo para ayudarte 🙋';
const FORMULARIO_WEB = 'https://brasper.com/es';
const MONEDAS = ['BRL', 'PEN', 'USD'];
const NOMBRE_MONEDA = { BRL: '🇧🇷 Reales (BRL)', PEN: '🇵🇪 Soles (PEN)', USD: '🇺🇸 Dólares (USD)' };
const MONEDAS_BTN = MONEDAS.map((m) => ({ id: m, title: NOMBRE_MONEDA[m] }));
// Bancos de demostración por moneda (máximo 10 filas por lista). "Otro" pide escribir el nombre.
const BANCOS_POR_MONEDA = {
  BRL: ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro'],
  PEN: ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro'],
  USD: ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Otro'],
};
const TIPOS_DOC = [{ id: 'DNI', title: 'DNI (Perú)' }, { id: 'CE', title: 'CE (extranjería)' }, { id: 'RUC', title: 'RUC (empresa)' }, { id: 'CPF', title: 'CPF (Brasil)' }];
// Cuántos dígitos espera el backend por tipo de documento (se dice al pedir el número).
const LARGO_DOC = { DNI: '8 dígitos', CE: '9 a 12 caracteres', RUC: '11 dígitos', CPF: '11 dígitos' };
// Los ids son los valores que acepta el backend (fundsSource).
const FONDOS = [
  { id: 'savings', title: 'Ahorros' }, { id: 'salary', title: 'Sueldo' }, { id: 'business', title: 'Negocio propio' },
  { id: 'asset_sale', title: 'Venta de un bien' }, { id: 'donation', title: 'Donación' }, { id: 'other', title: 'Otro' },
];
const ids = (opciones) => opciones.map((o) => o.id);

// Handoff a persona: abre el ticket (requestHuman), avisa con la posición en la cola y detiene la ejecución.
function escalar(f, nombre, motivo, { mensaje = MSG_PERSONA, cta } = {}) {
  f.api(`${nombre}_reg`, `handoff_to_human:${motivo}`);
  f.text(`${nombre}_msg`, `${mensaje}{{vars.cola_texto}}`);
  f.link(`${nombre}_reg`, `${nombre}_msg`);
  let ultimo = `${nombre}_msg`;
  if (cta) {
    f.cta(`${nombre}_cta`, cta.body, cta.label, cta.url);
    f.link(ultimo, `${nombre}_cta`);
    ultimo = `${nombre}_cta`;
  }
  f.handoff(`${nombre}_fin`);
  f.link(ultimo, `${nombre}_fin`);
  return `${nombre}_reg`;
}

// Pregunta de texto libre con validación; el segundo fallo seguido escala. El llamador conecta `salida` con 'valido'.
function pregunta(f, n, { prompt, guardar, validar, error, motivo, escalarOpts }) {
  f.text(`${n}_ask`, prompt);
  f.wait(`${n}_wait`, { save: guardar });
  f.api(`${n}_val`, `validate:${validar}`, { edges: ['valido', 'invalido', 'escalar'] });
  f.text(`${n}_err`, error);
  const esc = escalar(f, `${n}_esc`, motivo, escalarOpts);
  f.link(`${n}_ask`, `${n}_wait`).link(`${n}_wait`, `${n}_val`);
  f.link(`${n}_val`, `${n}_err`, 'invalido').link(`${n}_err`, `${n}_wait`);
  f.link(`${n}_val`, esc, 'escalar');
  return { entrada: `${n}_ask`, salida: `${n}_val` };
}

// Elección por botones o lista; una respuesta fuera de las opciones repite el mensaje y el segundo fallo escala.
// El llamador conecta `ruta` con cada id de `opciones`.
// `siInvalido`: nodo al que va una respuesta que no es una opción (por defecto, repite la pregunta).
function elegir(f, n, { tipo, body, opciones, boton = 'Elegir', variable, motivo, siInvalido }) {
  if (tipo === 'list') f.list(`${n}_ask`, body, boton, opciones);
  else f.buttons(`${n}_ask`, body, opciones);
  f.wait(`${n}_wait`);
  f.api(`${n}_route`, `route_reply:${variable}`, { edges: [...ids(opciones), 'invalido', 'escalar'] });
  const esc = escalar(f, `${n}_esc`, motivo);
  f.link(`${n}_ask`, `${n}_wait`).link(`${n}_wait`, `${n}_route`);
  f.link(`${n}_route`, siInvalido || `${n}_ask`, 'invalido');
  f.link(`${n}_route`, esc, 'escalar');
  return { entrada: `${n}_ask`, ruta: `${n}_route` };
}

// Como `elegir` con lista, pero la lista depende de la moneda guardada en `monedaVar`.
function elegirPorMoneda(f, n, { monedaVar, body, boton = 'Elegir banco', listas, variable, motivo }) {
  const todas = [...new Set(Object.values(listas).flat())];
  f.api(`${n}_mon`, `route_moneda:${monedaVar}`, { edges: MONEDAS });
  f.wait(`${n}_wait`);
  for (const m of MONEDAS) {
    f.list(`${n}_ask_${m}`, body, boton, listas[m].map((b) => ({ id: b, title: b })));
    f.link(`${n}_mon`, `${n}_ask_${m}`, m).link(`${n}_ask_${m}`, `${n}_wait`);
  }
  f.api(`${n}_route`, `route_reply:${variable}`, { edges: [...todas, 'invalido', 'escalar'] });
  const esc = escalar(f, `${n}_esc`, motivo);
  f.link(`${n}_wait`, `${n}_route`).link(`${n}_route`, `${n}_mon`, 'invalido').link(`${n}_route`, esc, 'escalar');
  return { entrada: `${n}_mon`, ruta: `${n}_route`, ids: todas };
}

// Lista cuyas filas salen de una variable del estado (p. ej. las cuentas guardadas del cliente).
function listaDinamica(f, id, { body, boton, filasVar }) {
  return f._add(id, 'send_interactive', { interactive_type: 'list', body_text: body, list_button_text: boton, rows_var: filasVar, phone_number_id: PHONE_NUMBER_ID });
}

module.exports = {
  MSG_PERSONA, MSG_SIN_TASAS, FORMULARIO_WEB, MONEDAS, MONEDAS_BTN, BANCOS_POR_MONEDA, TIPOS_DOC, LARGO_DOC, FONDOS, ids,
  escalar, pregunta, elegir, elegirPorMoneda, listaDinamica,
};
