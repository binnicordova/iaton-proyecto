// Validadores del backend de BrasPer (misma regla que functions/ y src/domain/validators.ts del repositorio del equipo).
// El bot los aplica antes para responder al instante; la autoridad final es el backend.

const soloDigitos = (v) => String(v === undefined || v === null ? '' : v).replace(/\D/g, '');

function normalizarDocumento(tipo, valor) {
  const s = String(valor === undefined || valor === null ? '' : valor);
  return tipo === 'CE' ? s.trim().toUpperCase() : soloDigitos(s);
}

function cpfValido(valor) {
  const cpf = soloDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (largo) => {
    let suma = 0;
    for (let i = 0; i < largo; i += 1) suma += Number(cpf[i]) * (largo + 1 - i);
    const resto = (suma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

function rucValido(valor) {
  const ruc = soloDigitos(valor);
  if (ruc.length !== 11 || !/^(10|15|17|20)/.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(ruc[i]), 0);
  return (11 - (suma % 11)) % 10 === Number(ruc[10]);
}

function documentoValido(tipo, valor) {
  switch (tipo) {
    case 'DNI': return /^\d{8}$/.test(soloDigitos(valor));
    case 'CE': return /^[A-Z0-9]{9,12}$/.test(String(valor === undefined || valor === null ? '' : valor).trim().toUpperCase());
    case 'RUC': return rucValido(valor);
    case 'CPF': return cpfValido(valor);
    default: return false;
  }
}

const correoValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v === undefined || v === null ? '' : v).trim());
const nombreValido = (v) => {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return s.length >= 3 && /\s/.test(s);
};
const operacionValida = (v) => /^[A-Za-z0-9-]{4,24}$/.test(String(v === undefined || v === null ? '' : v).trim());
const cuentaValida = (v) => String(v === undefined || v === null ? '' : v).trim().length >= 4;

// Para mostrar al cliente sin exponer el dato completo.
function enmascararCorreo(correo) {
  const s = String(correo || '');
  const i = s.indexOf('@');
  return i < 1 ? '***' : `${s[0]}***${s.slice(i)}`;
}
const ultimos4 = (cuenta) => String(cuenta || '').replace(/[^0-9A-Za-z]/g, '').slice(-4);

// Texto libre del cliente (nombre, banco, cuenta): sin controles, espacios colapsados y con largo máximo.
function limpiarTexto(valor, max) {
  // eslint-disable-next-line no-control-regex
  return String(valor === undefined || valor === null ? '' : valor).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = {
  soloDigitos, normalizarDocumento, documentoValido, cpfValido, rucValido,
  correoValido, nombreValido, operacionValida, cuentaValida, enmascararCorreo, ultimos4, limpiarTexto,
};
