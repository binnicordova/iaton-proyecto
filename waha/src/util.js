// Utilidades comunes. El texto de los mensajes nunca se registra; los chats se enmascaran.
const soloDigitos = (id) => String(id || '').split('@')[0].replace(/\D/g, '');

function enmascarar(chatId) {
  const d = soloDigitos(chatId);
  return d ? `***${d.slice(-4)}` : '***';
}

module.exports = { soloDigitos, enmascarar };
