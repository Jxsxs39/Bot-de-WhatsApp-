import {audit} from './admin-audit.js';
import {adminNames,handleAdmin} from './commands/admin.js';
import { commands } from './commands/index.js';
import { normalizeMessageContent } from '@whiskeysockets/baileys';
import { styleBotReply } from './bot-style.js';

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
  const candidates = (isGroup ? [key.participantAlt,key.participant] : [key.remoteJidAlt,chatId]).map(normalizeJid).filter(Boolean);
  const raw = candidates.find(id=>/^\d+@s\.whatsapp\.net$/.test(id)) || candidates[0];
  if (!raw || !/@(s\.whatsapp\.net|lid)$/.test(raw)) return null;
  const content = normalizeMessageContent(msg.message);
  const text = (
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    ''
  ).trim();
  // El prefijo . distingue comandos del texto normal.
  const match = /^\.(\S+)(?:\s+(.*))?$/s.exec(text);
  let userId = normalizeJid(raw);
  if (key.fromMe) {
    const selfIds = new Set(selfJids.map(normalizeJid).filter(Boolean));
    const authorIds = isGroup ? [key.participantAlt, key.participant] : [key.remoteJidAlt, chatId];
    const authorId = authorIds.map(normalizeJid).find(id => selfIds.has(id));
    // Only the linked account's own commands are handled; its replies cannot loop back.
    if (!match || !authorId) return null;
    userId = [...selfIds].find(id=>/^\d+@s\.whatsapp\.net$/.test(id)) || authorId;
  }
  return { chatId, userId, ...(key.fromMe && !isGroup && chatId!==userId ? {selfChat:true}:{}), command: match?.[1].toLowerCase(), args: match?.[2]?.split(/\s+/) || [] };
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
      const result = await sock.sendMessage(ctx.chatId, { text: styleBotReply(text, ctx.command) });
      console.log('[RESPUESTA] Enviada al chat');
      return result;
    };
    const replyWithImage = async (url, caption) => {
      const result = await sock.sendMessage(ctx.chatId, {
        image: { url },
        caption: styleBotReply(caption, ctx.command)
      });
      console.log('[RESPUESTA] Imagen enviada al chat');
      return result;
    };
    let stage='registro SQLite';
    try {
      // Resuelve LID mediante el mapa autenticado de Baileys, nunca mediante texto del usuario.
      if(ctx.userId.endsWith('@lid')) {
        try {const pn=normalizeJid(await sock.signalRepository?.lidMapping?.getPNForLID(ctx.userId));if(pn && /^\d+@s\.whatsapp\.net$/.test(pn)) ctx.userId=pn;} catch {console.log('[IDENTIDAD] LID sin resolver');}
      }
      // Cuenta mensajes normales también; solo los comandos reciben respuesta.
      await db.registerMessage(ctx.userId);
      if (!ctx.command) return;
      if(adminNames.has(ctx.command)) { stage='autorización administrativa'; return await handleAdmin({...ctx,reply,rawMessage:msg}); }
      stage='búsqueda de comando';
      const cmd = commands.get(ctx.command);
      console.log('[COMANDO]', cmd ? ctx.command : 'desconocido');
      if (!cmd) return await reply('❌ Comando no encontrado. Escribe .menu.');
      stage='ejecución o envío';
      const replyWithSticker = async (sticker, isAnimated = false) => {
        const result = await sock.sendMessage(ctx.chatId, { sticker, isAnimated });
        console.log('[RESPUESTA] Sticker enviado al chat');
        return result;
      };
      const replyWithAudio = async audio => {
        const result = await sock.sendMessage(ctx.chatId, {
          audio,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: false
        });
        console.log('[RESPUESTA] Audio enviado al chat');
        return result;
      };
      await cmd.run({ ...ctx, db, reply, replyWithImage, replyWithSticker, replyWithAudio, commands, sock, rawMessage: msg });
      audit('comando completado: '+ctx.command);
      console.log('[COMANDO] Finalizado');
    } catch (error) {
      audit('error de procesamiento');
      console.error('[ERROR]',stage,error?.name ?? 'Error',error?.code ?? error?.output?.statusCode ?? 'sin código');
      if (ctx.command) await reply('Ocurrió un error. Intenta más tarde.').catch(() => console.error('[RESPUESTA] No se pudo enviar el aviso de error'));
    }
  }};
}
