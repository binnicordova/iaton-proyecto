const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizarEvento, extraerOpcion } = require('../src/webhook/normalizar');

const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'waha', `${n}.json`), 'utf8'));

test('normaliza un mensaje de texto', () => {
  const m = normalizarEvento(fx('message_text'));
  assert.equal(m.tipo, 'mensaje');
  assert.equal(m.eventoId, 'evt_text_1');
  assert.equal(m.mensajeId, 'false_51999999999@c.us_AAA1');
  assert.equal(m.chatId, '51999999999@c.us');
  assert.equal(m.telefono, '51999999999');
  assert.equal(m.texto, 'Hola, quiero enviar 500 reales a Perú');
  assert.equal(m.tipoMensaje, 'text');
  assert.equal(m.tieneMedia, false);
  assert.equal(m.opcionId, null);
  assert.equal(m.creado, new Date(1760000000 * 1000).toISOString());
});

test('una imagen sin descargar se reconoce como media tipo image', () => {
  const m = normalizarEvento(fx('message_image'));
  assert.equal(m.tieneMedia, true);
  assert.equal(m.tipoMensaje, 'image');
  assert.equal(m.texto, '');
});

test('se ignoran mensajes propios, de la API, de grupos y de difusiones', () => {
  assert.equal(normalizarEvento(fx('message_from_me')), null);
  assert.equal(normalizarEvento(fx('message_group')), null);
  const b = fx('message_text');
  b.payload.from = 'status@broadcast';
  assert.equal(normalizarEvento(b), null);
  const api = fx('message_text');
  api.payload.source = 'api';
  assert.equal(normalizarEvento(api), null);
});

test('un remitente @lid se acepta y conserva su chatId original', () => {
  const e = fx('message_text');
  e.payload.from = '184512345678901@lid';
  const m = normalizarEvento(e);
  assert.equal(m.chatId, '184512345678901@lid');
  assert.equal(m.telefono, '184512345678901');
});

test('el estado de la sesión se normaliza y los eventos desconocidos se ignoran', () => {
  assert.deepEqual(normalizarEvento(fx('session_status')), { tipo: 'sesion', estado: 'WORKING' });
  assert.equal(normalizarEvento({ event: 'message.ack', payload: {} }), null);
  assert.equal(normalizarEvento(null), null);
  assert.equal(normalizarEvento({ event: 'message' }), null);
});

test('mensajes que no son texto (sticker, audio) llegan con texto vacío y tipo other', () => {
  const e = fx('message_text');
  e.payload.body = '';
  e.payload.hasMedia = true;
  e.payload.media = { url: null, mimetype: 'audio/ogg' };
  const m = normalizarEvento(e);
  assert.equal(m.texto, '');
  assert.equal(m.tipoMensaje, 'other');
});

test('extraerOpcion lee el id de la fila tocada en el evento real capturado en H0 (NOWEB)', () => {
  const lista = fx('respuesta_lista');
  assert.equal(extraerOpcion(lista.payload), 'BCP');
  assert.equal(extraerOpcion(fx('message_text').payload), null);
});

test('la respuesta a una lista se normaliza con el id de la fila y el título como texto', () => {
  const m = normalizarEvento(fx('respuesta_lista'));
  assert.equal(m.tipo, 'mensaje');
  assert.equal(m.opcionId, 'BCP');
  assert.equal(m.texto, 'BCP');
  assert.equal(m.chatId, '184512345678901@lid');
});

test('con NOWEB el teléfono real viene en _data.key.remoteJidAlt aunque el remitente sea @lid', () => {
  const m = normalizarEvento(fx('respuesta_lista'));
  assert.equal(m.chatId, '184512345678901@lid'); // se responde al chat original
  assert.equal(m.telefono, '51999999999');
});

test('un @lid sin remoteJidAlt conserva el LID como teléfono (se resuelve después con la API de WAHA)', () => {
  const e = fx('respuesta_lista');
  delete e.payload._data.key.remoteJidAlt;
  assert.equal(normalizarEvento(e).telefono, '184512345678901');
});

test('el mensaje con archivo trae la URL de descarga y el tipo cuando WAHA los entrega', () => {
  const e = fx('message_image');
  e.payload.media = { url: 'http://localhost:3000/api/files/f.jpeg', mimetype: 'image/jpeg' };
  const m = normalizarEvento(e);
  assert.equal(m.mediaUrl, 'http://localhost:3000/api/files/f.jpeg');
  assert.equal(m.mimetype, 'image/jpeg');
  const sinUrl = normalizarEvento(fx('message_image'));
  assert.equal(sinUrl.mediaUrl, null);
  assert.equal(sinUrl.mimetype, 'image/jpeg');
  assert.equal(normalizarEvento(fx('message_text')).mediaUrl, null);
  assert.equal(normalizarEvento(fx('message_text')).mimetype, null);
});
