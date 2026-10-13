const test = require('node:test');
const assert = require('node:assert/strict');
const { generarPdf } = require('../src/comprobante/pdf');

const DATOS = {
  emisor: 'BrasPer', titulo: 'Comprobante de operación', aviso: 'DOCUMENTO DE DEMOSTRACIÓN', numero: 'BR-0002', fecha: '13/10/2026 14:03',
  secciones: [
    { titulo: 'Envío', filas: [['Monto enviado', '500.00 BRL'], ['Tasa', '1 BRL = 0.7 PEN']] },
    { titulo: 'Destino', filas: [['Cuenta', 'BCP ••1111']] },
  ],
  pie: 'Constancia de demostración (no es un comprobante electrónico de SUNAT).',
};
const latin1 = (s) => Buffer.from(s, 'latin1');

test('es un PDF bien formado: cabecera, EOF y tabla xref con offsets exactos', () => {
  const pdf = generarPdf(DATOS);
  assert.ok(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
  assert.ok(pdf.subarray(-6).toString('latin1').includes('%%EOF'));
  const inicio = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf.toString('latin1'))[1]);
  assert.equal(pdf.subarray(inicio, inicio + 4).toString('latin1'), 'xref');
  const tabla = pdf.subarray(inicio).toString('latin1').split('\n');
  const total = Number(/^0 (\d+)$/.exec(tabla[1])[1]);
  assert.equal(total, 7); // objeto 0 libre + 6 objetos
  for (let n = 1; n < total; n++) {
    const off = Number(tabla[2 + n].slice(0, 10));
    assert.ok(pdf.subarray(off, off + 12).toString('latin1').startsWith(`${n} 0 obj`), `offset del objeto ${n}`);
  }
});

test('el /Length del contenido coincide con los bytes reales del stream', () => {
  const s = generarPdf(DATOS).toString('latin1');
  const largo = Number(/\/Length (\d+)>>\nstream\n/.exec(s)[1]);
  const ini = s.indexOf('stream\n') + 7;
  assert.equal(s.indexOf('\nendstream'), ini + largo);
});

test('trae los textos del comprobante con tildes y viñetas codificadas en WinAnsi', () => {
  const pdf = generarPdf(DATOS);
  for (const t of ['BR-0002', 'Monto enviado', '500.00 BRL', '1 BRL = 0.7 PEN', '13/10/2026 14:03']) assert.ok(pdf.includes(latin1(`(${t})`)), t);
  assert.ok(pdf.includes(latin1('(Comprobante de operaci\xf3n)')));
  assert.ok(pdf.includes(latin1('(BCP \x95\x951111)'))); // "••" es 0x95 en WinAnsi
});

test('escapa paréntesis y barras, y reemplaza lo que no existe en WinAnsi por "?"', () => {
  const pdf = generarPdf({ ...DATOS, secciones: [{ titulo: 'Nota', filas: [['Texto', 'a (b) \\ c ✅']] }] });
  assert.ok(pdf.includes(latin1('(a \\(b\\) \\\\ c ?)')));
});

test('es una sola página, usa Helvetica y pesa pocos KB', () => {
  const pdf = generarPdf(DATOS);
  const s = pdf.toString('latin1');
  assert.match(s, /\/Count 1/);
  assert.match(s, /\/BaseFont\s*\/Helvetica-Bold/);
  assert.ok(pdf.length < 6000, `pesa ${pdf.length} bytes`);
});

test('con datos incompletos no falla y muestra un guion', () => {
  const pdf = generarPdf({ numero: 'BR-0009', secciones: [{ titulo: 'Envío', filas: [['Monto', undefined], ['Tasa', null]] }] });
  assert.ok(pdf.includes(latin1('(\x97)')) || pdf.includes(latin1('(-)')));
});

test('alinea a la derecha con los anchos reales de Helvetica (el borde derecho cae en el margen)', () => {
  const s = generarPdf(DATOS).toString('latin1');
  // "BR-0002" en negrita 16 pt mide 64.0 pt (B 722, R 722, - 333, 4 dígitos de 556) → x = 555 - 64.0 = 491.0
  assert.ok(s.includes('491.0 794 Td (BR-0002)'));
  // "13/10/2026 14:03" en regular 10 pt mide 77.84 pt → x = 555 - 77.84 = 477.2
  assert.ok(s.includes('477.2 770 Td (13/10/2026 14:03)'));
});
