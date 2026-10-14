// Formatos de texto para los mensajes del chat.
const pad2 = (n) => String(n).padStart(2, '0');

const dinero = (n) => (n === undefined || n === null || n === '' || Number.isNaN(Number(n)) ? '' : Number(n).toFixed(2));

// Hora de Lima (UTC-5, sin horario de verano) como la escribe el cliente en Perú: "4:47 p. m.", "12:05 p. m.".
function hora12Lima(iso) {
  const f = new Date(iso);
  if (!iso || Number.isNaN(f.getTime())) return '';
  const lima = new Date(f.getTime() - 5 * 3600 * 1000);
  const h = lima.getUTCHours();
  return `${((h + 11) % 12) + 1}:${pad2(lima.getUTCMinutes())} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

module.exports = { dinero, hora12Lima };
