// Genera kapso/dist/<slug>.json con { name, slug, description, definition, triggers } listo para workflows.create/update.
// Uso: node build/emit.js [--strict] [--spike]
//   --strict  exige kapso/ids.json con los IDs reales (functionId y workflows.<clave>)
//   --spike   genera los workflows desechables de build/spike.js en dist/spike/
const fs = require('fs');
const path = require('path');
const { buildFlows } = require('./workflows');
const { buildSpike } = require('./spike');
const { validar } = require('./flow');

const strict = process.argv.includes('--strict');
const spike = process.argv.includes('--spike');
const flows = spike ? buildSpike() : buildFlows();
const claves = Object.keys(flows);
const idsPath = path.join(__dirname, '..', 'ids.json');
const PENDIENTE = 'PENDIENTE';
const ids = fs.existsSync(idsPath)
  ? JSON.parse(fs.readFileSync(idsPath, 'utf8'))
  : { functionId: PENDIENTE, workflows: Object.fromEntries(claves.map((k) => [k, PENDIENTE])) };

const faltan = [ids.functionId, ...claves.map((k) => (ids.workflows || {})[k])].filter((v) => !v || v === PENDIENTE);
if (strict && faltan.length) {
  console.error('Faltan IDs en kapso/ids.json (functionId y workflows.E1..W0).');
  process.exit(1);
}

const dist = path.join(__dirname, '..', 'dist', spike ? 'spike' : '');
fs.mkdirSync(dist, { recursive: true });
for (const f of Object.values(flows)) {
  const errs = validar(f, claves);
  if (errs.length) {
    console.error(`${f.key} inválido:\n- ${errs.join('\n- ')}`);
    process.exit(1);
  }
  const salida = { name: f.name, slug: f.slug, description: f.description, definition: f.definition(ids), triggers: f.triggers };
  fs.writeFileSync(path.join(dist, `${f.slug}.json`), JSON.stringify(salida, null, 2));
  console.log(`${f.key}: ${salida.definition.nodes.length} nodos, ${salida.definition.edges.length} aristas -> ${path.relative(path.join(__dirname, '..'), path.join(dist, `${f.slug}.json`))}`);
}
