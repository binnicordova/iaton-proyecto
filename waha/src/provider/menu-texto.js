// Respaldo de botones y listas: menú numerado en texto y su interpretación.
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[.!¡¿?,;:]+/g, ' ').replace(/\s+/g, ' ').trim();

function renderMenu(cuerpo, opciones) {
  const lineas = opciones.map((o, i) => `${i + 1}. ${o.title}`).join('\n');
  return `${cuerpo}\n\n${lineas}\n\nResponde con el número o el nombre de la opción.`;
}

function interpretarRespuesta(texto, opciones) {
  const t = norm(texto);
  if (!t || !opciones || !opciones.length) return null;
  if (/^\d+$/.test(t)) {
    const o = opciones[Number(t) - 1];
    return o ? o.id : null;
  }
  const o = opciones.find((x) => norm(x.title) === t);
  return o ? o.id : null;
}

module.exports = { renderMenu, interpretarRespuesta };
