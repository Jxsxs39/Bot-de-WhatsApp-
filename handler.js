import { commands } from './commands/index.js';

// El chat es el destino; el participante es quien ejecuta el comando.
export function parseMessage(msg) {
  const key = msg?.key;
  const chatId = key?.remoteJid;
  if (!chatId || key.fromMe || !(/@(g\.us|s\.whatsapp\.net|lid)$/.test(chatId))) return null;
  const raw = chatId.endsWith('@g.us') ? (key.participantAlt || key.participant) : (key.remoteJidAlt || chatId);
  if (!raw || !/@(s\.whatsapp\.net|lid)$/.test(raw)) return null;
  const userId = raw.replace(/:\d+@/, '@');
  const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
  const match = /^\+(\S+)(?:\s+(.*))?$/s.exec(text);
  return { chatId, userId, command: match?.[1].toLowerCase(), args: match?.[2]?.split(/\s+/) || [] };
}
export function createCommandHandler(sock, db) {
  return { async handleMessage(msg) {
    const ctx = parseMessage(msg);
    if (!ctx || !msg.message) return;
    const reply = text => sock.sendMessage(ctx.chatId, { text });
    try {
      await db.registerMessage(ctx.userId);
      if (!ctx.command) return;
      const cmd = commands.get(ctx.command);
      if (!cmd) return await reply('❌ Comando no encontrado. Escribe +menu.');
      await cmd.run({ ...ctx, db, reply, commands });
    } catch (error) {
      console.error('Error procesando mensaje:', error.name);
      if (ctx.command) await reply('Ocurrió un error. Intenta más tarde.').catch(() => {});
    }
  }};
}
