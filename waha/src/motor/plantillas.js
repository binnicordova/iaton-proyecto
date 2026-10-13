// Sustituye {{vars.nombre}}. Solo nombres simples; no evalúa expresiones. Lo ausente queda vacío (como en Kapso, a verificar en la paridad).
function renderizar(texto, vars) {
  return String(texto).replace(/\{\{\s*vars\.([A-Za-z0-9_]+)\s*\}\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

module.exports = { renderizar };
