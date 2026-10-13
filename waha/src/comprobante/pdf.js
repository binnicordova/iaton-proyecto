// Generador mínimo de PDF (una página A4, Helvetica) sin dependencias. Solo dibuja el comprobante de demostración.
// Los textos se codifican en WinAnsi (latin1 + algunos signos); lo que no existe ahí sale como "?".

const ANCHO = 595;
const ALTO = 842;
const MARGEN = 40;

// Signos de WinAnsi fuera de latin1 que usamos: viñeta (máscara de cuentas), guiones y comillas.
const WINANSI = { '•': 0x95, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '…': 0x85, '€': 0x80 };

function codificar(valor) {
  const s = valor === undefined || valor === null || valor === '' ? '—' : String(valor);
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const byte = WINANSI[ch] !== undefined ? WINANSI[ch] : cp < 256 ? cp : 0x3f;
    const c = String.fromCharCode(byte);
    out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : c;
  }
  return out;
}

// Anchos de Helvetica y Helvetica-Bold (milésimas de em) para ASCII 32-126, en el orden del código. Fuera de ASCII se usa un promedio.
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

function anchoTexto(valor, size, negrita) {
  const tabla = negrita ? W_BOLD : W_REG;
  let total = 0;
  for (const ch of String(valor)) {
    const cp = ch.codePointAt(0);
    total += cp >= 32 && cp <= 126 ? tabla[cp - 32] : ch === '•' ? 350 : ch === '—' ? 1000 : 556;
  }
  return (total * size) / 1000;
}

// Operadores de dibujo (todos devuelven texto latin1 que va dentro del stream de la página).
const rgb = (r, g, b) => `${r} ${g} ${b}`;
const rect = (x, y, w, h, color) => `${color} rg ${x} ${y} ${w} ${h} re f\n`;
const linea = (x1, y, x2, color) => `${color} RG 0.5 w ${x1} ${y} m ${x2} ${y} l S\n`;
const texto = (x, y, valor, { size = 10, negrita = false, color = rgb(0.1, 0.1, 0.1), alinear = 'izq' } = {}) => {
  const f = negrita ? 'F2' : 'F1';
  const visible = valor === undefined || valor === null || valor === '' ? '—' : valor;
  const ancho = alinear === 'der' ? anchoTexto(visible, size, negrita) : 0;
  return `BT ${color} rg /${f} ${size} Tf ${(x - ancho).toFixed(1)} ${y} Td (${codificar(valor)}) Tj ET\n`;
};

const NAVY = rgb(0.1, 0.13, 0.3);
const GRIS = rgb(0.42, 0.44, 0.5);
const BLANCO = rgb(1, 1, 1);
const ROJO = rgb(0.75, 0.1, 0.15);
const LINEA = rgb(0.85, 0.86, 0.9);

function contenido(d) {
  let c = '';
  // Cabecera
  c += rect(0, ALTO - 96, ANCHO, 96, NAVY);
  c += texto(MARGEN, ALTO - 48, d.emisor || 'BrasPer', { size: 24, negrita: true, color: BLANCO });
  c += texto(MARGEN, ALTO - 72, d.titulo || 'Comprobante de operación', { size: 12, color: BLANCO });
  c += texto(ANCHO - MARGEN, ALTO - 48, d.numero, { size: 16, negrita: true, color: BLANCO, alinear: 'der' });
  c += texto(ANCHO - MARGEN, ALTO - 72, d.fecha, { size: 10, color: BLANCO, alinear: 'der' });
  let y = ALTO - 96 - 30;
  if (d.aviso) {
    c += texto(MARGEN, y, d.aviso, { size: 9, negrita: true, color: ROJO });
    y -= 26;
  }
  // Secciones: etiqueta a la izquierda, valor a la derecha, filete entre filas.
  for (const s of d.secciones || []) {
    c += texto(MARGEN, y, s.titulo, { size: 12, negrita: true, color: NAVY });
    y -= 8;
    c += linea(MARGEN, y, ANCHO - MARGEN, NAVY);
    y -= 20;
    for (const [etiqueta, valor] of s.filas || []) {
      c += texto(MARGEN, y, etiqueta, { size: 10, color: GRIS });
      c += texto(ANCHO - MARGEN, y, valor, { size: 11, negrita: true, alinear: 'der' });
      y -= 9;
      c += linea(MARGEN, y, ANCHO - MARGEN, LINEA);
      y -= 17;
    }
    y -= 12;
  }
  if (d.pie) c += texto(MARGEN, 48, d.pie, { size: 8, color: GRIS });
  return c;
}

function generarPdf(datos) {
  const stream = Buffer.from(contenido(datos), 'latin1');
  const objetos = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${ANCHO} ${ALTO}]/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>`,
    null, // el stream se arma aparte
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>',
  ];
  const partes = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  let pos = partes[0].length;
  objetos.forEach((o, i) => {
    offsets.push(pos);
    const cuerpo = o === null
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<</Length ${stream.length}>>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    partes.push(cuerpo);
    pos += cuerpo.length;
  });
  const xref = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  partes.push(Buffer.from(`${xref}trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}

module.exports = { generarPdf };
