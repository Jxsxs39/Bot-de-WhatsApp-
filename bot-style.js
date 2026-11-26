const commandEmojis = {
  id: '🪞',
  ping: '🏓',
  tt: '🎬',
  menu: '📜',
  historia: '🌼',
  dato: '🏛️',
  perfil: '👤',
  stats: '📊',
  work: '💰',
  daily: '🌞',
  s1: '🎞️',
  s2: '🖼️',
  admin: '👑',
  getcode: '💻',
  setcode: '🛠️',
  savefile: '💾',
  test: '🧪',
  update: '🚀',
  restart: '🔄',
  reload: '♻️',
  setowner: '🔐',
  delowner: '🔐',
  owners: '👑',
  rollback: '↩️'
};

const plainTextCommands = new Set(['getcode', 'logs']);

export function styleBotReply(text, command) {
  if (typeof text !== 'string' || plainTextCommands.has(command)) return text;

  const emoji = commandEmojis[command] || '✨';
  return `╭─･ﾟ✧ 👑 *Historia Reiss* ${emoji} ✧ﾟ･─╮\n\n${text}\n\n╰─ ✨ _Con cariño, Historia_ ✨`;
}
