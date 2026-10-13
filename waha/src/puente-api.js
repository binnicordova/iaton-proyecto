// Llama en proceso al handler de la Kapso Function, con el mismo contrato que usa Kapso.
const { handler } = require('../../kapso/functions/brasper-api.js');

function crearLlamadorFuncion({ kvEnv, envExtra = {}, varsFijas = {}, handlerFn = handler }) {
  const env = { KV: kvEnv, ...envExtra };
  return async function llamarFuncion({ vars, phone, edges, wa }) {
    const cuerpo = {
      execution_context: { vars: { ...vars, ...varsFijas }, context: { phone_number: `+${phone}` } },
      available_edges: edges,
      whatsapp_context: wa,
    };
    const res = await handlerFn(new Request('http://local/brasper-api', { method: 'POST', body: JSON.stringify(cuerpo) }), env);
    const out = await res.json();
    if (res.status !== 200) throw new Error(`brasper-api ${res.status}: ${out.error || 'error'}`);
    return out;
  };
}

module.exports = { crearLlamadorFuncion };
