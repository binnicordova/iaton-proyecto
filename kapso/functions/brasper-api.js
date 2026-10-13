// Kapso Function (Cloudflare Worker): API simulada de BrasPer para la demo.
// Contrato: la acción llega en vars.api_action ("accion" o "accion:argumento").
// Todos los datos son de demostración: tasas, cuenta de BrasPer y clientes son ficticios.

const MONEDAS = ['BRL', 'PEN', 'USD'];
const ALIAS_MONEDA = {
  BRL: 'BRL', REAL: 'BRL', REALES: 'BRL', 'R$': 'BRL',
  PEN: 'PEN', SOL: 'PEN', SOLES: 'PEN', 'S/': 'PEN',
  USD: 'USD', DOLAR: 'USD', DOLARES: 'USD', $: 'USD',
};
const TASAS_DEMO = { 'BRL>PEN': 0.7, 'PEN>BRL': 1.4, 'USD>PEN': 3.4, 'PEN>USD': 0.29, 'USD>BRL': 5.3, 'BRL>USD': 0.19 };
const COMISION_PCT = 0.01;
const VIGENCIA_TASA_MIN = 15;
const VENTANA_HORAS = 23;
// [apertura, cierre] en hora de Lima, por día de la semana (0 = domingo). Fuente: sección de horarios de brasper.com/es.
const HORARIO = { 0: [12, 14], 1: [7, 18], 2: [7, 18], 3: [7, 18], 4: [7, 18], 5: [7, 18], 6: [8, 14] };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ESTADOS = ['pendiente', 'esperando_transferencia', 'en_validacion', 'verificada', 'enviada', 'completada', 'rechazada', 'cancelada', 'escalada'];
const RUTA_ESTADO = { pendiente: 'e3', esperando_transferencia: 'e3', en_validacion: 'estado', verificada: 'estado', enviada: 'estado', rechazada: 'estado', escalada: 'escalada' };
const ESTADO_TEXTO = {
  en_validacion: 'en validación: una persona revisa tu pago',
  verificada: 'verificada: estamos enviando tu dinero',
  enviada: 'enviada: tu dinero ya fue enviado',
  rechazada: 'con un problema de validación: una persona te contactará',
};
// Banco de BrasPer que se muestra al cliente: el de origen, salvo "Otro" o vacío (entonces uno por defecto de la moneda).
const BANCO_DEFECTO = { BRL: 'Banco do Brasil', PEN: 'BCP', USD: 'BCP' };
const bancoDeBrasper = (vars) => (vars.banco_origen && vars.banco_origen !== 'Otro' ? vars.banco_origen : BANCO_DEFECTO[normMoneda(vars.moneda_origen)] || 'Banco DEMO');
const SNAP_KEYS = [
  'monto', 'moneda_origen', 'moneda_destino', 'tasa', 'tasa_txt', 'comision_txt', 'recibe_txt', 'total_enviar_txt',
  'monto_txt', 'tasa_hasta', 'tasa_hasta_iso', 'banco_origen', 'origen_fondos', 'dni_cpf', 'tipo_doc',
  'cuenta_id', 'cuenta_banco', 'cuenta_ultimos4',
];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const round2 = (n) => Math.round(n * 100) / 100;
const normPhone = (p) => String(p || '').replace(/\D/g, '');
const sinAcentos = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const digitos = (s) => String(s || '').replace(/[\s.\-]/g, '');

function normMoneda(s) {
  if (s === undefined || s === null) return null;
  return ALIAS_MONEDA[sinAcentos(String(s)).trim().toUpperCase()] || null;
}

function parseMonto(s) {
  const txt = String(s === undefined || s === null ? '' : s);
  const m = txt.match(/\d[\d.,]*/);
  if (!m) return null;
  // "-500" y "2 mil"/"3k" no se interpretan: se rechazan en vez de inventar un monto.
  if (txt[m.index - 1] === '-' || /^\s*(mil|k|mm|millon|millones)\b/i.test(sinAcentos(txt.slice(m.index + m[0].length)))) return null;
  let t = m[0].replace(/[.,]+$/, '');
  const sep = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  if (sep > -1 && t.length - sep - 1 <= 2) t = `${t.slice(0, sep).replace(/[.,]/g, '')}.${t.slice(sep + 1)}`;
  else t = t.replace(/[.,]/g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

// Hora de Lima (UTC-5, sin horario de verano).
function lima(date) {
  const d = new Date(date.getTime() - 5 * 3600 * 1000);
  return { dow: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes() };
}
const fmtHora = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'a. m.' : 'p. m.'}`;
const pad2 = (n) => String(n).padStart(2, '0');

function proximaApertura(now) {
  const { dow, h } = lima(now);
  for (let off = 0; off <= 7; off++) {
    const dia = (dow + off) % 7;
    const [ap] = HORARIO[dia];
    if (off === 0 && h >= ap) continue;
    const cuando = off === 0 ? 'hoy' : off === 1 ? 'mañana' : `el ${DIAS[dia]}`;
    return `${cuando} a las ${fmtHora(ap)}`;
  }
  return '';
}

const kv = (env) => ({
  get: (k) => env.KV.get(k, 'json'),
  put: (k, v) => env.KV.put(k, JSON.stringify(v)),
  del: (k) => env.KV.delete(k),
});

const cuentasDe = (cliente, vars) => (cliente.cuentas || []).filter((c) => c.moneda === normMoneda(vars.moneda_destino));
const varsCuenta = (c) => ({ cuenta_id: c.id, cuenta_banco: c.banco, cuenta_ultimos4: c.ultimos4 });

const getOp = (db, id) => (id ? db.get(`op:${id}`) : Promise.resolve(null));
async function getActiveOp(db, phone) {
  return getOp(db, await db.get(`active:${phone}`));
}
const saveOp = (db, op) => db.put(`op:${op.id}`, op);
const snapDe = (vars) => Object.fromEntries(SNAP_KEYS.filter((k) => vars[k] !== undefined).map((k) => [k, vars[k]]));

// Fallos consecutivos por paso: el segundo escala a una persona.
function fallo(vars, key) {
  const n = (Number(vars[`fallos_${key}`]) || 0) + 1;
  return { vars: { [`fallos_${key}`]: n }, next_edge: n >= 2 ? 'escalar' : 'invalido' };
}
const reinicio = (key, extra = {}) => ({ [`fallos_${key}`]: 0, ...extra });

const ultimoEntrante = (wa) => [...((wa && wa.messages) || [])].reverse().find((m) => m.direction === 'inbound');

const VALIDADORES = {
  dni_cpf: {
    src: 'dni_raw',
    run: (s) => {
      const d = digitos(s);
      if (/^\d{8}$/.test(d)) return { dni_cpf: d, tipo_doc: 'DNI' };
      if (/^\d{11}$/.test(d)) return { dni_cpf: d, tipo_doc: 'CPF' };
      return null;
    },
  },
  monto: {
    src: 'monto_raw',
    run: (s) => {
      const n = parseMonto(s);
      return n ? { monto: n } : null;
    },
  },
  numero_cuenta: {
    src: 'numero_cuenta_raw',
    run: (s) => {
      const d = digitos(s);
      return /^\d{8,20}$/.test(d) ? { cuenta_numero_nuevo: d, cuenta_ultimos4: d.slice(-4) } : null;
    },
  },
  n_operacion: {
    src: 'n_operacion_raw',
    run: (s) => {
      const d = digitos(s);
      return /^\d{4,20}$/.test(d) ? { n_operacion_bancaria: d } : null;
    },
  },
};

const ACCIONES = {
  validate: async ({ vars, arg }) => {
    const v = VALIDADORES[arg];
    if (!v) throw new Error(`validador desconocido: ${arg}`);
    const res = v.run(vars[v.src]);
    if (!res) return fallo(vars, arg);
    return { vars: reinicio(arg, res), next_edge: 'valido' };
  },

  route_reply: async ({ vars, arg, edges, wa }) => {
    const m = ultimoEntrante(wa);
    const id = m && m.reply_option_id;
    if (id && edges.includes(id)) return { vars: reinicio(arg, { [arg]: id }), next_edge: id };
    return fallo(vars, arg);
  },

  media: async ({ vars, arg, wa }) => {
    const m = ultimoEntrante(wa);
    if (m && m.has_media && ['image', 'document'].includes(m.message_type)) {
      return { vars: reinicio(arg, { comprobante_msg_id: m.whatsapp_message_id || m.id }), next_edge: 'foto' };
    }
    const f = fallo(vars, arg);
    return { vars: f.vars, next_edge: f.next_edge === 'invalido' ? 'sin_foto' : 'escalar' };
  },

  check_extraction: async ({ vars }) => {
    const monto = parseMonto(vars.monto);
    const o = normMoneda(vars.moneda_origen);
    const d = normMoneda(vars.moneda_destino);
    if (monto && o && d && o !== d) {
      return { vars: { monto, moneda_origen: o, moneda_destino: d }, next_edge: 'completa' };
    }
    return { vars: {}, next_edge: 'incompleta' };
  },

  get_rate_quote: async ({ env, vars, now }) => {
    const db = kv(env);
    const o = normMoneda(vars.moneda_origen);
    const d = normMoneda(vars.moneda_destino);
    const monto = parseMonto(vars.monto);
    if (vars.simular_tasas_caidas || env.TASAS_CAIDAS === '1') return { vars: { cotizacion_ok: false }, next_edge: 'sin_servicio' };
    const tasa = TASAS_DEMO[`${o}>${d}`];
    if (!o || !d || o === d || !tasa || !monto) return { vars: { cotizacion_ok: false }, next_edge: 'par_invalido' };
    const comision = round2(monto * COMISION_PCT);
    const hasta = new Date(now.getTime() + VIGENCIA_TASA_MIN * 60000);
    const hl = lima(hasta);
    const out = {
      cotizacion_ok: true, monto, moneda_origen: o, moneda_destino: d, tasa,
      tasa_txt: String(Number(tasa.toFixed(4))),
      monto_txt: monto.toFixed(2), comision_txt: comision.toFixed(2),
      recibe_txt: round2(monto * tasa).toFixed(2), total_enviar_txt: round2(monto + comision).toFixed(2),
      tasa_hasta: `${pad2(hl.h)}:${pad2(hl.m)}`, tasa_hasta_iso: hasta.toISOString(),
    };
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, snap: { ...op.snap, ...snapDe(out) } });
    return { vars: out, next_edge: 'ok' };
  },

  check_tasa: async ({ vars, now }) => ({
    vars: {},
    next_edge: vars.tasa_hasta_iso && new Date(vars.tasa_hasta_iso) > now ? 'vigente' : 'vencida',
  }),

  check_hours: async ({ now }) => {
    const { dow, h } = lima(now);
    const [ap, ci] = HORARIO[dow];
    if (h >= ap && h < ci) return { vars: { horario_abierto: true, proxima_verificacion: '' }, next_edge: 'abierto' };
    return { vars: { horario_abierto: false, proxima_verificacion: proximaApertura(now) }, next_edge: 'cerrado' };
  },

  check_window: async ({ env, phone, now }) => {
    const visto = await kv(env).get(`seen:${phone}`);
    const abierta = visto && now - new Date(visto) < VENTANA_HORAS * 3600 * 1000;
    return { vars: {}, next_edge: abierta ? 'abierta' : 'cerrada' };
  },

  check_continue: async ({ vars }) => ({ vars: {}, next_edge: vars.continuar === 'si' ? 'seguir' : 'fin' }),

  // Enruta por la moneda guardada en la variable `arg`; si no es válida cae en la primera arista.
  route_moneda: async ({ vars, arg, edges }) => {
    const m = normMoneda(vars[arg]);
    return { vars: {}, next_edge: edges.includes(m) ? m : edges[0] };
  },

  get_status: async ({ env, phone }) => {
    const op = await getActiveOp(kv(env), phone);
    if (!op) return { vars: { estado: 'sin_operacion' }, next_edge: 'e1' };
    const ruta = RUTA_ESTADO[op.estado] || 'e1';
    if (ruta === 'e1') return { vars: { estado: op.estado }, next_edge: 'e1' };
    return {
      vars: { ...op.snap, operacion_id: op.id, estado: op.estado, estado_texto: ESTADO_TEXTO[op.estado] || op.estado },
      next_edge: ruta,
    };
  },

  get_operation: async ({ env, vars, phone }) => {
    const db = kv(env);
    const op = (await getOp(db, vars.operacion_id)) || (await getActiveOp(db, phone));
    if (!op) return { vars: { estado: 'sin_operacion' } };
    return { vars: { ...op.snap, operacion_id: op.id, estado: op.estado } };
  },

  route_estado: async ({ vars }) => ({
    vars: {},
    next_edge: ['verificada', 'enviada', 'completada'].includes(vars.estado) ? 'verificada' : vars.estado === 'rechazada' ? 'rechazada' : 'otro',
  }),

  get_client: async ({ env, vars, phone }) => {
    const cliente = await kv(env).get(`client:${phone}`);
    const cuenta = cliente && cuentasDe(cliente, vars)[0];
    if (!cuenta) return { vars: { cliente_existe: Boolean(cliente) }, next_edge: 'sin_cuenta' };
    return {
      vars: { cliente_existe: true, cuenta_idx: 0, ...varsCuenta(cuenta), correo: cliente.correo || '' },
      next_edge: 'con_cuenta',
    };
  },

  // "Otra cuenta": primero se ofrecen las demás cuentas guardadas de la moneda; al agotarse, se pasa a agregar una nueva.
  next_account: async ({ env, vars, phone }) => {
    const cliente = await kv(env).get(`client:${phone}`);
    const idx = (Number(vars.cuenta_idx) || 0) + 1;
    const cuenta = cliente && cuentasDe(cliente, vars)[idx];
    if (!cuenta) return { vars: {}, next_edge: 'nueva' };
    return { vars: { cuenta_idx: idx, ...varsCuenta(cuenta) }, next_edge: 'otra_guardada' };
  },

  list_accounts: async ({ env, phone }) => {
    const cliente = await kv(env).get(`client:${phone}`);
    return { vars: { cuentas: (cliente && cliente.cuentas) || [] } };
  },

  save_account: async ({ env, vars, phone }) => {
    const db = kv(env);
    const cliente = (await db.get(`client:${phone}`)) || { cuentas: [], correo: '' };
    const banco = vars.cuenta_banco_nuevo;
    const ultimos4 = String(vars.cuenta_numero_nuevo).slice(-4);
    const moneda = normMoneda(vars.moneda_destino);
    let cuenta = cliente.cuentas.find((c) => c.banco === banco && c.ultimos4 === ultimos4 && c.moneda === moneda);
    if (!cuenta) {
      const n = (Number(await db.get('seq_cuentas')) || 0) + 1;
      await db.put('seq_cuentas', n);
      cuenta = { id: `acc_${n}`, banco, ultimos4, moneda };
      cliente.cuentas.push(cuenta);
      await db.put(`client:${phone}`, cliente);
    }
    return { vars: varsCuenta(cuenta) };
  },

  create_operation: async ({ env, vars, phone, now }) => {
    const db = kv(env);
    const n = (Number(await db.get('seq_operaciones')) || 0) + 1;
    await db.put('seq_operaciones', n);
    const id = `BR-${String(n).padStart(4, '0')}`;
    await saveOp(db, { id, phone, estado: 'pendiente', creada: now.toISOString(), snap: snapDe(vars) });
    await db.put(`active:${phone}`, id);
    return { vars: { operacion_id: id, estado: 'pendiente' } };
  },

  get_company_account: async ({ env, vars }) => {
    const db = kv(env);
    const op = await getOp(db, vars.operacion_id);
    if (op && op.estado === 'pendiente') await saveOp(db, { ...op, estado: 'esperando_transferencia' });
    return {
      vars: {
        brasper_titular: 'BrasPer (DEMO)',
        brasper_banco: bancoDeBrasper(vars),
        brasper_cuenta: `DEMO-${normMoneda(vars.moneda_origen) || 'XXX'}-0001`,
      },
    };
  },

  attach_proof: async ({ env, vars }) => {
    const db = kv(env);
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, estado: 'en_validacion', proof: { mensaje: vars.comprobante_msg_id, n_operacion: vars.n_operacion_bancaria, tasa_vencida: vars.tasa_vencida === 'si' } });
    return { vars: { estado: 'en_validacion' } };
  },

  cancel_operation: async ({ env, vars, phone }) => {
    const db = kv(env);
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, estado: 'cancelada' });
    await db.del(`active:${phone}`);
    return { vars: { estado: 'cancelada' } };
  },

  complete_operation: async ({ env, vars, phone }) => {
    const db = kv(env);
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, estado: 'completada' });
    await db.del(`active:${phone}`);
    return { vars: { estado: 'completada' } };
  },

  handoff_to_human: async ({ env, vars, phone, arg, now }) => {
    const db = kv(env);
    await db.put(`handoff:${phone}`, { motivo: arg || 'sin_motivo', operacion_id: vars.operacion_id || null, en: now.toISOString() });
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, estado: 'escalada' });
    return { vars: { escalada: true } };
  },

  // Una persona (o el backend) cierra un caso escalado: la operación pasa a un estado final y el cliente queda libre.
  resolve_handoff: async ({ env, vars, phone }) => {
    const db = kv(env);
    const final = vars.estado || 'cancelada';
    if (!['completada', 'cancelada'].includes(final)) throw new Error(`estado final inválido: ${final}`);
    const op = await getOp(db, vars.operacion_id);
    if (op) await saveOp(db, { ...op, estado: final });
    await db.del(`active:${phone}`);
    await db.del(`handoff:${phone}`);
    return { vars: { estado: final } };
  },

  // --- Simulación del backend y utilidades de demo: se invocan a mano con functions.invoke ---
  set_status: async ({ env, vars }) => {
    const db = kv(env);
    if (!ESTADOS.includes(vars.estado)) throw new Error(`estado inválido: ${vars.estado}`);
    const op = await getOp(db, vars.operacion_id);
    if (!op) throw new Error(`operación no encontrada: ${vars.operacion_id}`);
    await saveOp(db, { ...op, estado: vars.estado });
    return { vars: { estado: vars.estado, operacion_id: op.id } };
  },

  // `vars.cuentas = 2` siembra además una cuenta BCP en PEN para probar el recorrido de cuentas guardadas.
  seed_demo: async ({ env, phone, vars }) => {
    const cuentas = [{ id: 'acc_demo', banco: 'Scotiabank', ultimos4: '9956', moneda: 'PEN' }];
    if (Number(vars.cuentas) === 2) cuentas.push({ id: 'acc_demo2', banco: 'BCP', ultimos4: '1111', moneda: 'PEN' });
    await kv(env).put(`client:${phone}`, { correo: 'demo@example.com', cuentas });
    return { vars: { seed: true } };
  },

  reset_demo: async ({ env, phone }) => {
    const db = kv(env);
    for (const k of ['active', 'seen', 'handoff']) await db.del(`${k}:${phone}`);
    return { vars: { reset: true } };
  },
};

async function tocarVisto({ env, phone, wa }) {
  const m = ultimoEntrante(wa);
  if (phone && m && m.created_at) await kv(env).put(`seen:${phone}`, m.created_at);
}

async function handler(request, env) {
  const body = await request.json().catch(() => ({}));
  const ctx = body.execution_context || {};
  const vars = { ...(ctx.vars || {}), ...(body.vars || {}) };
  const edges = body.available_edges || [];
  const phone = normPhone(body.phone || (ctx.context && ctx.context.phone_number));
  const raw = String(body.action || vars.api_action || '');
  const i = raw.indexOf(':');
  const accion = i === -1 ? raw : raw.slice(0, i);
  const arg = i === -1 ? '' : raw.slice(i + 1);
  const fn = ACCIONES[accion];
  if (!fn) return json({ error: 'accion_desconocida', accion }, 400);
  const now = vars.simular_ahora ? new Date(vars.simular_ahora) : new Date();
  const io = { env, vars, phone, edges, arg, now, wa: body.whatsapp_context || null };
  try {
    await tocarVisto(io);
    const out = await fn(io);
    if (edges.length && !edges.includes(out.next_edge)) {
      return json({ error: 'edge_no_declarado', next_edge: out.next_edge, edges }, 500);
    }
    return json(out);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

// Solo para las pruebas locales con node:test. En Cloudflare Workers `module` no existe.
if (typeof module !== 'undefined') module.exports = { handler, parseMonto, normMoneda, MONEDAS, TASAS_DEMO };
