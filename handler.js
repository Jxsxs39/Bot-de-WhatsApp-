import { commands } from './commands/index.js';

function normalizeJid(jid) {
  return typeof jid === 'string' ? jid.replace(/:\d+@/, '@') : undefined;
}

// El chat es el destino; el participante es quien ejecuta el comando.
export function parseMessage(msg, selfJids = []) {
  // Descarta estados y chats no compatibles.
  const key = msg?.key;
  const chatId = key?.remoteJid;
  if (!chatId || !(/@(g\.us|s\.whatsapp\.net|lid)$/.test(chatId))) return null;
  // En grupos se usa el participante, no el identificador del grupo.
  const isGroup = chatId.endsWith('@g.us');
  const raw = isGroup ? (key.participantAlt || key.participant) : (key.remoteJidAlt || chatId);
  if (!raw || !/@(s\.whatsapp\.net|lid)$/.test(raw)) return null;
  const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
  // El prefijo . distingue comandos del texto normal.
  const match = /^\.(\S+)(?:\s+(.*))?$/s.exec(text);
  let userId = normalizeJid(raw);
  if (key.fromMe) {
    const selfIds = new Set(selfJids.map(normalizeJid).filter(Boolean));
    const authorIds = isGroup ? [key.participantAlt, key.participant] : [key.remoteJidAlt, chatId];
    const authorId = authorIds.map(normalizeJid).find(id => selfIds.has(id));
    // Only the linked account's own commands are handled; its replies cannot loop back.
    if (!match || !authorId) return null;
    userId = authorId;
  }
  return { chatId, userId, command: match?.[1].toLowerCase(), args: match?.[2]?.split(/\s+/) || [] };
}
// Inyectar socket y base permite probar sin conectarse a WhatsApp.
export function createCommandHandler(sock, db) {
  return { async handleMessage(msg) {
    const ctx = parseMessage(msg, [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber]);
    // Diagnóstico sin mostrar números, contenido de mensajes ni credenciales.
    if (!ctx || !msg.message) {
      console.log('[MENSAJE] Ignorado:', msg?.key?.fromMe ? 'mensaje propio' : !msg?.message ? 'sin contenido' : 'chat o remitente no compatible');
      return;
    }
    const reply = async text => {
      const result = await sock.sendMessage(ctx.chatId, { text });
      console.log('[RESPUESTA] Enviada al chat');
      return result;
    };
    const replyWithImage = async (url, caption) => {
      const result = await sock.sendMessage(ctx.chatId, { image: { url }, caption });
      console.log('[RESPUESTA] Imagen enviada al chat');
      return result;
    };
    let stage='registro SQLite';
    try {
      // Cuenta mensajes normales también; solo los comandos reciben respuesta.
      await db.registerMessage(ctx.userId);
      if (!ctx.command) return;
      stage='búsqueda de comando';
      const cmd = commands.get(ctx.command);
      console.log('[COMANDO]', cmd ? ctx.command : 'desconocido');
      if (!cmd) return await reply('❌ Comando no encontrado. Escribe .menu.');
      stage='ejecución o envío';
      await cmd.run({ ...ctx, db, reply, replyWithImage, commands });
      console.log('[COMANDO] Finalizado');
    } catch (error) {
      console.error('[ERROR]',stage,error?.name ?? 'Error',error?.code ?? error?.output?.statusCode ?? 'sin código');
      if (ctx.command) await reply('Ocurrió un error. Intenta más tarde.').catch(() => console.error('[RESPUESTA] No se pudo enviar el aviso de error'));
    }
  }};
}
