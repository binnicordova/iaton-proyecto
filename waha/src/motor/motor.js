// Intérprete de los grafos de kapso/build/workflows.js. Ejecuta los 10 tipos de nodo; la lógica de negocio
// vive en brasper-api.js y los textos en los grafos. Un mensaje a la vez por teléfono.
const { renderizar } = require('./plantillas');
const { crearCola } = require('./cola');
const { interpretarRespuesta } = require('../provider/menu-texto');
const { enmascarar } = require('../util');

const MAX_PASOS = 150;
const MSG_PERSONA = 'Te paso con una persona del equipo para ayudarte.';
const MSG_TEMPORAL = 'Tuvimos un problema temporal 😕 Escríbeme de nuevo en un momento y seguimos donde quedamos.';

class ErrorMotor extends Error {}

function crearMotor({ flujos, almacen, proveedor, llamarFuncion, extraer, ahora = () => new Date() }) {
  const idx = {};
  for (const [clave, f] of Object.entries(flujos)) idx[clave] = { nodos: new Map(f.nodes.map((n) => [n.id, n])), aristas: f.edges };
  const cola = crearCola();

  // Lo que se guarda no lleva el texto de los mensajes del cliente (puede traer documentos, correos o cuentas):
  // el agente lo lee en el mismo turno, antes de guardar.
  const persistible = (ej) => ({ ...ej, entrantes: ej.entrantes.map((e) => ({ ...e, text: '' })) });

  const nueva = (flujo, telefono, chatId, vars = {}) => ({
    telefono, chatId, pila: [{ flujo, nodo: 'start' }], vars, esperando: null, opciones: null, entrantes: [],
  });

  // Sigue la arista `etiqueta` desde el nodo actual. Sin aristas salientes, el workflow terminó: se vuelve al padre.
  function avanzar(ej, etiqueta) {
    while (ej.pila.length) {
      const frame = ej.pila[ej.pila.length - 1];
      const f = idx[frame.flujo];
      if (!f) throw new ErrorMotor(`workflow desconocido: ${frame.flujo}`);
      const arista = f.aristas.find((e) => e.source === frame.nodo && e.label === etiqueta);
      if (arista) { frame.nodo = arista.target; return true; }
      if (f.aristas.some((e) => e.source === frame.nodo)) throw new ErrorMotor(`sin arista "${etiqueta}" desde ${frame.flujo}.${frame.nodo}`);
      ej.pila.pop();
      etiqueta = 'next';
    }
    return false;
  }

  async function invocar(ej, edges) {
    const out = await llamarFuncion({ vars: ej.vars, phone: ej.telefono, edges, wa: { messages: ej.entrantes }, chatId: ej.chatId });
    if (out.vars) Object.assign(ej.vars, out.vars);
    return out;
  }

  async function enviarInteractivo(ej, c) {
    const cuerpo = renderizar(c.body_text, ej.vars);
    if (c.interactive_type === 'button') {
      await proveedor.enviarBotones(ej.chatId, cuerpo, c.buttons);
      ej.opciones = c.buttons;
    } else if (c.interactive_type === 'list') {
      // Las filas son fijas en el grafo o salen de una variable (`rows_var`), p. ej. las cuentas guardadas del cliente.
      const filas = c.rows_var ? (Array.isArray(ej.vars[c.rows_var]) ? ej.vars[c.rows_var].slice(0, 10) : []) : c.list_sections.flatMap((s) => s.rows);
      if (!filas.length) throw new ErrorMotor(`lista sin filas en ${c.rows_var || 'el grafo'}`);
      await proveedor.enviarLista(ej.chatId, cuerpo, c.list_button_text, filas);
      ej.opciones = filas;
    } else if (c.interactive_type === 'cta_url') {
      await proveedor.enviarEnlace(ej.chatId, cuerpo, c.cta_display_text, c.cta_url);
    } else {
      throw new ErrorMotor(`interactive_type no soportado: ${c.interactive_type}`);
    }
    return {};
  }

  async function ejecutarNodo(ej, nodo) {
    const c = nodo.config || {};
    switch (nodo.nodeType) {
      case 'start': return {};
      case 'set_variable': {
        const v = renderizar(c.variable_value, ej.vars);
        if (c.value_type === 'float') ej.vars[c.variable_name] = Number(v);
        else if (!c.value_type || c.value_type === 'string') ej.vars[c.variable_name] = v;
        else throw new ErrorMotor(`value_type no soportado: ${c.value_type}`);
        return {};
      }
      case 'send_text':
        await proveedor.enviarTexto(ej.chatId, renderizar(c.message, ej.vars));
        return {};
      case 'send_interactive': return enviarInteractivo(ej, c);
      case 'wait_for_response':
        ej.esperando = { guardar: c.save_response_to || null, opciones: ej.opciones };
        ej.opciones = null;
        return { detener: 'espera' };
      case 'function': {
        const out = await invocar(ej, []);
        if (c.save_response_to) ej.vars[c.save_response_to] = out;
        return {};
      }
      case 'decide': {
        const out = await invocar(ej, c.conditions.map((x) => x.label));
        return { etiqueta: out.next_edge };
      }
      case 'call':
        ej.pila.push({ flujo: c.workflow_key, nodo: 'start' });
        return { llamada: true };
      case 'handoff': return { detener: 'handoff' };
      case 'agent': {
        const ultimo = ej.entrantes[ej.entrantes.length - 1];
        Object.assign(ej.vars, await extraer(ultimo ? ultimo.text : ''));
        return {};
      }
      default: throw new ErrorMotor(`tipo de nodo no soportado: ${nodo.nodeType}`);
    }
  }

  async function escalarPorError(ej, e) {
    almacen.registrar({ tipo: 'error_motor', chat: enmascarar(ej.chatId), detalle: String(e.message).slice(0, 200) });
    try { await proveedor.enviarTexto(ej.chatId, MSG_PERSONA); } catch { /* ya está registrado el error original */ }
    try { await llamarFuncion({ vars: { ...ej.vars, api_action: 'handoff_to_human:error_motor' }, phone: ej.telefono, edges: [], wa: { messages: ej.entrantes } }); } catch { /* sin respaldo */ }
    almacen.borrarEjecucion(ej.telefono);
  }

  async function correr(ej) {
    let pasos = 0;
    try {
      while (ej.pila.length) {
        if (++pasos > MAX_PASOS) throw new ErrorMotor('demasiados pasos en un mensaje');
        const frame = ej.pila[ej.pila.length - 1];
        const f = idx[frame.flujo];
        if (!f) throw new ErrorMotor(`workflow desconocido: ${frame.flujo}`);
        const nodo = f.nodos.get(frame.nodo);
        if (!nodo) throw new ErrorMotor(`nodo inexistente ${frame.flujo}.${frame.nodo}`);
        const r = await ejecutarNodo(ej, nodo);
        if (r.detener === 'espera') { almacen.guardarEjecucion(ej.telefono, persistible(ej)); return 'espera'; }
        if (r.detener === 'handoff') break;
        if (r.llamada) continue;
        if (!avanzar(ej, r.etiqueta || 'next')) break;
      }
      almacen.borrarEjecucion(ej.telefono);
      return 'ok';
    } catch (e) {
      if (e && e.name === 'ErrorEnvio') {
        // Fallo de transporte (WAHA caído, 5xx agotados, 463/475): no es culpa del cliente ni del flujo. No se escala ni se
        // pierde la operación. En una conversación (W0) el estado queda en el nodo que falló y el siguiente mensaje reintenta;
        // en un aviso por API (E4) no queda conversación y el backend puede volver a avisar.
        almacen.registrar({ tipo: 'error_envio', chat: enmascarar(ej.chatId), estado: String(e.estado || 'red'), detalle: e.restriccion ? 'restriccion_whatsapp' : 'transporte' });
        if (ej.pila[0] && ej.pila[0].flujo === 'W0') almacen.guardarEjecucion(ej.telefono, persistible(ej));
        else almacen.borrarEjecucion(ej.telefono);
        return 'transporte';
      }
      if (e && e.name === 'ErrorBackend' && e.transporte) {
        // Firebase no respondió (red, timeout, 5xx): tampoco se escala. En una conversación se avisa al cliente y el siguiente
        // mensaje reintenta el paso que falló; un aviso lanzado por API no molesta al cliente y quien lo lanzó puede repetirlo.
        almacen.registrar({ tipo: 'error_backend', chat: enmascarar(ej.chatId), estado: String(e.estado || e.codigo || 'red'), detalle: e.codigo || 'transporte' });
        if (ej.pila[0] && ej.pila[0].flujo === 'W0') {
          try { await proveedor.enviarTexto(ej.chatId, MSG_TEMPORAL); } catch { /* ya hay registro del fallo */ }
          almacen.guardarEjecucion(ej.telefono, persistible(ej));
        } else {
          almacen.borrarEjecucion(ej.telefono);
        }
        return 'transporte';
      }
      await escalarPorError(ej, e);
      return 'escalado';
    }
  }

  function aWa(msg) {
    return {
      direction: 'inbound', created_at: ahora().toISOString(), id: msg.mensajeId, whatsapp_message_id: msg.mensajeId,
      message_type: msg.tipoMensaje, has_media: msg.tieneMedia, reply_option_id: null, text: msg.texto || '',
      media_url: msg.mediaUrl || null, mimetype: msg.mimetype || null,
    };
  }

  function procesarMensaje(msg) {
    return cola.ejecutar(msg.telefono, async () => {
      const ej = almacen.cargarEjecucion(msg.telefono) || nueva('W0', msg.telefono, msg.chatId);
      ej.chatId = msg.chatId;
      const wa = aWa(msg);
      let sigue = true;
      if (ej.esperando) {
        const { guardar, opciones } = ej.esperando;
        wa.reply_option_id = msg.opcionId || (opciones ? interpretarRespuesta(msg.texto, opciones) : null);
        if (guardar) ej.vars[guardar] = msg.texto || '';
        ej.esperando = null;
        ej.entrantes = [...ej.entrantes, wa].slice(-5);
        try { sigue = avanzar(ej, 'next'); } catch (e) { await escalarPorError(ej, e); return; }
      } else {
        ej.entrantes = [...ej.entrantes, wa].slice(-5);
      }
      if (!sigue) { almacen.borrarEjecucion(msg.telefono); return; }
      await correr(ej);
    });
  }

  function iniciar(flujo, telefono, chatId, vars = {}) {
    return cola.ejecutar(telefono, async () => {
      if (almacen.cargarEjecucion(telefono)) return { iniciado: false, motivo: 'ocupado' };
      const resultado = await correr(nueva(flujo, telefono, chatId, { ...vars }));
      return resultado === 'transporte' || resultado === 'escalado' ? { iniciado: true, fallo: resultado } : { iniciado: true };
    });
  }

  return { procesarMensaje, iniciar };
}

module.exports = { crearMotor, MSG_PERSONA, MSG_TEMPORAL, ErrorMotor };
