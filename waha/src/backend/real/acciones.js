// Acciones de negocio de los grafos v2 sobre el backend real de BrasPer. Cada acción recibe el contexto del motor y devuelve
// { vars, next_edge }, igual que brasper-api.js. Las acciones genéricas (route_reply, check_extraction, check_hours…) se delegan
// al simulador. Un error de transporte (red, timeout, 5xx) se deja subir: el motor lo trata sin escalar al cliente.
const { ErrorBackend } = require('./errores');
const { dinero, hora12Lima } = require('./formato');
const V = require('./validadores');
const { extensionDe } = require('./storage');
const { parseMonto, normMoneda } = require('../../../../kapso/functions/brasper-api.js');

const MAX_COMPROBANTE_BYTES = 8 * 1024 * 1024;
const TEXTO_ESTADO = {
  validating: 'en validación: una persona revisa tu pago',
  approved: 'verificada: estamos enviando tu dinero',
  exported: 'enviada: tu dinero ya fue enviado',
  rejected: 'con un problema de validación: una persona te contactará',
};
// Datos personales del cliente: se borran del estado de la conversación en cuanto el backend los guarda en su perfil.
const SIN_DATOS_PERSONALES = {
  nombre: '', nombre_raw: '', doc_tipo: '', doc_num: '', doc_raw: '', correo: '', correo_raw: '', correo_masc: '',
  origen_cuenta: '', origen_cuenta_raw: '', destino_cuenta: '', destino_cuenta_raw: '',
  cuentas_perfil: [], cuentas_origen: [], cuentas_destino: [], opciones_origen: [], opciones_destino: [],
};

const ultimoEntrante = (wa) => [...((wa && wa.messages) || [])].reverse().find((m) => m.direction === 'inbound');
// Fallos consecutivos por paso: el segundo escala a una persona.
function fallo(vars, clave) {
  const n = (Number(vars[`fallos_${clave}`]) || 0) + 1;
  return { vars: { [`fallos_${clave}`]: n }, next_edge: n >= 2 ? 'escalar' : 'invalido' };
}
const reinicio = (clave, extra = {}) => ({ [`fallos_${clave}`]: 0, ...extra });

function varsCotizacion(q) {
  return {
    quote_id: q.id, moneda_origen: q.sendCurrency, moneda_destino: q.receiveCurrency, monto_txt: dinero(q.sendAmount),
    tasa_txt: String(q.rate), comision_txt: dinero(q.commission), impuesto_txt: dinero(q.tax), cargos_txt: dinero(Math.round((q.commission + q.tax) * 100) / 100), total_enviar_txt: dinero(q.total),
    recibe_txt: dinero(q.receiveAmount), tasa_hasta: hora12Lima(q.expiresAt), quote_expira_iso: q.expiresAt,
  };
}

function varsOrden(o) {
  const pa = o.paymentAccount || {};
  return {
    operacion_id: o.orderId, moneda_origen: o.sendCurrency, moneda_destino: o.receiveCurrency, monto_txt: dinero(o.sendAmount),
    tasa_txt: String(o.rate), comision_txt: dinero(o.commission), impuesto_txt: dinero(o.tax), total_enviar_txt: dinero(o.total),
    recibe_txt: dinero(o.receiveAmount), tasa_hasta: hora12Lima(o.rateLockedUntil), lock_iso: o.rateLockedUntil,
    pago_titular: pa.holder || '', pago_banco: pa.bank || '', pago_cuenta: pa.accountNumber || '', pago_pix_linea: pa.pixKey ? `\nPix: ${pa.pixKey}` : '',
    origen_ult4: V.ultimos4(o.sourceAccount), destino_ult4: V.ultimos4(o.destinationAccount),
  };
}

const VALIDADORES = {
  nombre: { src: 'nombre_raw', run: (s) => (V.nombreValido(s) ? { nombre: V.limpiarTexto(s, 100) } : null) },
  doc: { src: 'doc_raw', run: (s, vars) => (V.documentoValido(vars.doc_tipo, s) ? { doc_num: V.normalizarDocumento(vars.doc_tipo, s) } : null) },
  correo: { src: 'correo_raw', run: (s) => (V.correoValido(s) ? { correo: String(s).trim().toLowerCase(), correo_masc: V.enmascararCorreo(String(s).trim().toLowerCase()) } : null) },
  cuenta_origen: { src: 'origen_cuenta_raw', run: (s) => (V.cuentaValida(s) ? { origen_cuenta: V.limpiarTexto(s, 40), origen_ult4: V.ultimos4(s) } : null) },
  cuenta_destino: { src: 'destino_cuenta_raw', run: (s) => (V.cuentaValida(s) ? { destino_cuenta: V.limpiarTexto(s, 40), destino_ult4: V.ultimos4(s) } : null) },
  banco_origen: { src: 'origen_banco_raw', run: (s) => (V.limpiarTexto(s, 60).length >= 2 ? { origen_banco: V.limpiarTexto(s, 60) } : null) },
  banco_destino: { src: 'destino_banco_raw', run: (s) => (V.limpiarTexto(s, 60).length >= 2 ? { destino_banco: V.limpiarTexto(s, 60) } : null) },
  operacion: { src: 'operacion_raw', run: (s) => (V.operacionValida(s) ? { operacion_no: String(s).trim().toUpperCase() } : null) },
};

// Qué campo repreguntar cuando el backend rechaza un dato (`invalid-input` trae la ruta del campo).
function campoDe(detalles) {
  const ruta = (detalles && detalles[0] && detalles[0].path) || '';
  if (ruta === 'clientName') return 'nombre';
  if (ruta === 'docType' || ruta === 'docNumber') return 'documento';
  if (ruta === 'email') return 'correo';
  return 'otro';
}

function crearBackendReal({ funciones, firestore, storage, sesiones, almacen, descargarMedia, delegado, ahora = () => new Date(), registrar = () => {} }) {
  const esNegocio = (e) => e instanceof ErrorBackend && !e.transporte;
  const kv = almacen.kvEnv();

  async function leerOrden(tel, id) {
    try { return await firestore.leer(tel, `orders/${id}`); } catch (e) { if (esNegocio(e)) return null; throw e; }
  }

  const ACCIONES = {
    // E1: cotizar. Los códigos del backend se traducen a las aristas del grafo.
    async quote_create({ vars, phone }) {
      const monto = parseMonto(vars.monto);
      const o = normMoneda(vars.moneda_origen);
      const d = normMoneda(vars.moneda_destino);
      if (!monto || !o || !d || o === d) return { vars: {}, next_edge: 'par_invalido' };
      try {
        const q = await funciones.llamar(phone, 'createQuote', { sendCurrency: o, receiveCurrency: d, sendAmount: monto, channel: 'whatsapp' }, { reintentos: 1 });
        return { vars: varsCotizacion(q), next_edge: 'ok' };
      } catch (e) {
        if (!esNegocio(e)) throw e;
        const mapa = { 'requires-human': 'requiere_persona', 'amount-too-small': 'monto_bajo', 'same-currency': 'par_invalido', 'invalid-amount': 'par_invalido', 'invalid-input': 'par_invalido' };
        return { vars: {}, next_edge: mapa[e.codigo] || 'sin_servicio' };
      }
    },

    // E2: perfil guardado del cliente (clients/{uid}) para no repetir datos ni cuentas.
    async perfil_get({ phone }) {
      const { uid } = await sesiones.obtener(phone);
      const p = await firestore.leer(phone, `clients/${uid}`);
      if (!p || !p.clientName) return { vars: { cuentas_perfil: [] }, next_edge: 'nuevo' };
      const cuentas = (p.accounts || []).map((a) => ({ bank: a.bank, accountNumber: a.accountNumber, currency: a.currency }));
      return {
        vars: { nombre: p.clientName, doc_tipo: p.docType, doc_num: p.docNumber, correo: p.email, correo_masc: V.enmascararCorreo(p.email), cuentas_perfil: cuentas },
        next_edge: 'existe',
      };
    },

    async validate({ vars, arg }) {
      const v = VALIDADORES[arg];
      if (!v) throw new Error(`validador desconocido: ${arg}`);
      const res = v.run(vars[v.src], vars);
      if (!res) return fallo(vars, arg);
      return { vars: reinicio(arg, res), next_edge: 'valido' };
    },

    // Cuentas ya usadas por el cliente en la moneda del lado indicado (origen o destino), como filas de una lista.
    async cuentas_opciones({ vars, arg }) {
      const moneda = arg === 'origen' ? vars.moneda_origen : vars.moneda_destino;
      const guardadas = (vars.cuentas_perfil || []).filter((a) => a.currency === moneda).slice(-9).reverse();
      if (!guardadas.length) return { vars: { [`opciones_${arg}`]: [], [`cuentas_${arg}`]: [] }, next_edge: 'sin_cuentas' };
      const filas = guardadas.map((a, i) => ({ id: `acc:${i}`, title: `${a.bank} ••${V.ultimos4(a.accountNumber)}`.slice(0, 24) }));
      filas.push({ id: 'otra', title: 'Otra cuenta' });
      return { vars: { [`opciones_${arg}`]: filas, [`cuentas_${arg}`]: guardadas }, next_edge: 'con_cuentas' };
    },

    async route_cuenta({ vars, arg, wa }) {
      const m = ultimoEntrante(wa);
      const id = m && m.reply_option_id;
      if (id === 'otra') return { vars: reinicio(`cuenta_${arg}`), next_edge: 'otra' };
      const mt = /^acc:(\d+)$/.exec(id || '');
      const cuenta = mt && (vars[`cuentas_${arg}`] || [])[Number(mt[1])];
      if (cuenta) {
        return { vars: reinicio(`cuenta_${arg}`, { [`${arg}_banco`]: cuenta.bank, [`${arg}_cuenta`]: cuenta.accountNumber, [`${arg}_ult4`]: V.ultimos4(cuenta.accountNumber) }), next_edge: 'elegida' };
      }
      return fallo(vars, `cuenta_${arg}`);
    },

    async banco_set({ vars, arg }) { return { vars: { [`${arg}_banco`]: vars[`${arg}_banco_sel`] } }; },

    // Crea la orden. Ante un resultado dudoso (timeout) se consulta si llegó a crearse antes de dar nada por perdido.
    async order_create({ vars, phone, chatId }) {
      const datos = {
        quoteId: vars.quote_id, language: 'es', clientName: vars.nombre, docType: vars.doc_tipo, docNumber: vars.doc_num, email: vars.correo,
        fundsSource: vars.fondos, sourceBank: vars.origen_banco, sourceAccount: vars.origen_cuenta,
        destinationBank: vars.destino_banco, destinationAccount: vars.destino_cuenta,
      };
      let orden;
      try {
        orden = await funciones.llamar(phone, 'createOrder', datos);
      } catch (e) {
        if (!(e instanceof ErrorBackend)) throw e;
        const dudoso = e.transporte || ['quote-already-used', 'quote-expired', 'quote-not-found'].includes(e.codigo);
        // La orden pudo crearse antes de que se perdiera la respuesta: se consulta antes de recotizar. Si la consulta falla por la red, no se adivina.
        const previas = dudoso ? await firestore.ordenesPorCotizacion(phone, vars.quote_id).catch((e2) => { if (!esNegocio(e2)) throw e2; return []; }) : [];
        if (previas.length) orden = previas[0];
        else if (e.transporte) throw e;
        else {
          const mapa = { 'quote-expired': 'quote_expirada', 'quote-not-found': 'quote_expirada', 'quote-already-used': 'quote_expirada', 'requires-human': 'requiere_persona', 'invalid-input': 'dato_invalido' };
          return { vars: e.codigo === 'invalid-input' ? { campo_invalido: campoDe(e.detalles) } : {}, next_edge: mapa[e.codigo] || 'sin_servicio' };
        }
      }
      almacen.agregarOrden({ ordenId: orden.orderId, telefono: phone, chatId, creada: orden.createdAt });
      return { vars: { ...varsOrden(orden), ...SIN_DATOS_PERSONALES }, next_edge: 'ok' };
    },

    async route_campo({ vars }) { return { vars: {}, next_edge: ['nombre', 'documento', 'correo'].includes(vars.campo_invalido) ? vars.campo_invalido : 'otro' }; },

    // E3: datos de pago de la orden (si el cliente vuelve más tarde, se leen de Firestore).
    async orden_info({ vars, phone }) {
      if (vars.pago_cuenta) return { vars: {} };
      const ultima = almacen.ordenesDe(phone)[0];
      const o = ultima && (await leerOrden(phone, ultima.ordenId));
      return { vars: o ? varsOrden(o) : {} };
    },

    async check_lock({ vars }) {
      const vigente = vars.lock_iso && new Date(vars.lock_iso) > ahora();
      return { vars: {}, next_edge: vigente ? 'vigente' : 'vencida' };
    },

    // Baja la foto de WAHA y la sube a Storage con el token del cliente.
    async proof_upload({ vars, phone, wa, chatId }) {
      const m = ultimoEntrante(wa);
      const sinFoto = () => { const f = fallo(vars, 'comprobante'); return { vars: f.vars, next_edge: f.next_edge === 'invalido' ? 'sin_foto' : 'escalar' }; };
      if (!m || !m.has_media || !['image', 'document'].includes(m.message_type)) return sinFoto();
      const archivo = await descargarMedia({ chatId, mensajeId: m.whatsapp_message_id || m.id, mediaUrl: m.media_url, mimetype: m.mimetype });
      if (!archivo) return sinFoto();
      const tipo = String(archivo.mimetype || '').toLowerCase();
      if (!(tipo.startsWith('image/') || tipo === 'application/pdf')) return sinFoto();
      if (archivo.bytes.length >= MAX_COMPROBANTE_BYTES) return { vars: {}, next_edge: 'muy_grande' };
      try {
        const ruta = await storage.subir(phone, { ordenId: vars.operacion_id, nombre: `proof-${ahora().getTime()}.${extensionDe(tipo)}`, mimetype: tipo, bytes: archivo.bytes });
        return { vars: reinicio('comprobante', { proof_path: ruta }), next_edge: 'subida' };
      } catch (e) {
        if (!esNegocio(e)) throw e;
        const f = fallo(vars, 'comprobante');
        return { vars: f.vars, next_edge: f.next_edge === 'invalido' ? 'fallo_subida' : 'escalar' };
      }
    },

    async proof_submit({ vars, phone, chatId }) {
      const ya = (estado) => ['validating', 'approved', 'exported'].includes(estado);
      const confirmar = async () => ya((await leerOrden(phone, vars.operacion_id) || {}).status);
      let ok = false;
      try {
        await funciones.llamar(phone, 'submitProof', { orderId: vars.operacion_id, operationNo: vars.operacion_no, proofPath: vars.proof_path });
        ok = true;
      } catch (e) {
        if (!(e instanceof ErrorBackend)) throw e;
        if (e.transporte) { if (await confirmar().catch(() => false)) ok = true; else throw e; }
        else {
          const mapa = { 'operation-no-duplicate': 'duplicado', 'proof-not-uploaded': 'sin_subida', 'invalid-proof-path': 'sin_subida', 'proof-too-large': 'sin_subida', 'invalid-operation-no': 'invalido' };
          if (e.codigo === 'order-not-pending') {
            if (!(await confirmar())) return { vars: {}, next_edge: 'escalar' };
            almacen.abrirSeguimiento({ ordenId: vars.operacion_id, telefono: phone, chatId, creado: ahora().toISOString() }); // no-op si ya existe
            return { vars: {}, next_edge: 'ya_recibido' };
          }
          return { vars: {}, next_edge: mapa[e.codigo] || 'escalar' };
        }
      }
      if (ok) almacen.abrirSeguimiento({ ordenId: vars.operacion_id, telefono: phone, chatId, creado: ahora().toISOString() });
      return { vars: { estado: 'validating' }, next_edge: 'ok' };
    },

    async cancel_order({ vars, phone }) {
      try { await funciones.llamar(phone, 'cancelOrder', { orderId: vars.operacion_id }); } catch (e) { if (!esNegocio(e)) throw e; }
      return { vars: { estado: 'cancelled' } };
    },

    // "Hablar con persona": entra a la cola del backend con un resumen sin datos personales.
    async handoff_to_human({ vars, phone, arg }) {
      const partes = [`Cliente de WhatsApp pide ayuda (${arg || 'sin motivo'}).`];
      if (vars.monto_txt) partes.push(`Cotización: ${vars.monto_txt} ${vars.moneda_origen} → ${vars.moneda_destino}.`);
      if (vars.operacion_id) partes.push(`Operación ${vars.operacion_id}.`);
      try {
        const t = await funciones.llamar(phone, 'requestHuman', { summary: partes.join(' ').slice(0, 1500), orderId: vars.operacion_id || null, channel: 'whatsapp', language: 'es' });
        await kv.put(`handoff:${phone}`, JSON.stringify({ handoffId: t.handoffId, motivo: arg || '' }));
        return { vars: { cola_texto: ` Estás en la posición ${t.position} (espera aproximada: ${t.estimatedWaitMinutes} min).` } };
      } catch (e) {
        if (!esNegocio(e)) throw e;
        registrar({ tipo: 'error_backend', estado: String(e.estado || ''), detalle: `requestHuman:${e.codigo}` });
        return { vars: { cola_texto: '' } };
      }
    },

    // W0: ¿en qué punto está este cliente? Primero un ticket de persona abierto; luego su última orden.
    async get_status({ phone }) {
      const marca = await kv.get(`handoff:${phone}`, 'json');
      if (marca) {
        const q = await funciones.llamar(phone, 'getQueueInfo', { handoffId: marca.handoffId }).catch((e) => { if (esNegocio(e)) return null; throw e; });
        if (q && q.status !== 'closed') return { vars: {}, next_edge: 'escalada' };
        await kv.delete(`handoff:${phone}`);
      }
      const ultima = almacen.ordenesDe(phone)[0];
      if (!ultima) return { vars: { estado: 'sin_operacion' }, next_edge: 'e1' };
      const seg = almacen.seguimiento(ultima.ordenId);
      if (seg && seg.cerrado) return { vars: { estado: 'sin_operacion' }, next_edge: 'e1' };
      const o = await leerOrden(phone, ultima.ordenId);
      if (!o || ['cancelled', 'rejected', 'exported'].includes(o.status)) return { vars: { estado: 'sin_operacion' }, next_edge: 'e1' };
      if (o.status === 'pending') return { vars: { ...varsOrden(o), estado: 'pending' }, next_edge: 'e3' };
      return { vars: { ...varsOrden(o), estado: o.status, estado_texto: TEXTO_ESTADO[o.status] || o.status }, next_edge: 'estado' };
    },

    // E4 v2: lo lanza el vigilante con vars.evento.
    async route_evento({ vars }) { return { vars: {}, next_edge: ['aprobada', 'rechazada'].includes(vars.evento) ? vars.evento : 'otro' }; },
  };

  return async function llamarFuncion({ vars, phone, edges, wa, chatId }) {
    const crudo = String(vars.api_action || '');
    const i = crudo.indexOf(':');
    const nombre = i === -1 ? crudo : crudo.slice(0, i);
    const arg = i === -1 ? '' : crudo.slice(i + 1);
    const accion = ACCIONES[nombre];
    // validate:monto y el resto de acciones genéricas siguen siendo las del simulador.
    if (!accion || (nombre === 'validate' && !VALIDADORES[arg])) return delegado({ vars, phone, edges, wa, chatId });
    const out = await accion({ vars, phone, edges, wa, chatId, arg });
    if (edges && edges.length && !edges.includes(out.next_edge)) throw new Error(`edge_no_declarado: ${out.next_edge} (${crudo})`);
    return out;
  };
}

module.exports = { crearBackendReal, varsOrden, varsCotizacion, TEXTO_ESTADO, SIN_DATOS_PERSONALES };
