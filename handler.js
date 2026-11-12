export function createCommandHandler(sock, db) {
  const commands = new Map();

  const register = (name, fn) => {
    commands.set(name.toLowerCase(), fn);
  };

  const parseCommand = (text) => {
    if (!text) return null;

    const trimmed = text.trim();
    if (!trimmed.startsWith('+')) return null;

    const args = trimmed.slice(1).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    return { command, args };
  };

  const formatUserStats = async (userId) => {
    const stats = await db.getStats(userId);
    return [
      '📊 *Estadísticas*',
      `• Mensajes: ${stats.messages}`,
      `• Coins: ${stats.coins}`,
      `• XP: ${stats.xp}`,
      `• Nivel: ${stats.level}`,
    ].join('\n');
  };

  register('hola', async ({ from }) => {
    await sock.sendMessage(from, {
      text: '¡Hola! Soy *Historia Reiss Bot* 👑\nEscribe +menu para ver mis comandos.',
    });
  });

  register('menu', async ({ from }) => {
    await sock.sendMessage(from, {
      text: [
        '👑 *Menú principal*',
        '',
        '• +hola',
        '• +menu',
        '• +historia',
        '• +dato',
        '• +perfil',
        '• +stats',
        '• +work',
        '• +daily',
      ].join('\n'),
    });
  });

  register('historia', async ({ from }) => {
    await sock.sendMessage(from, {
      text: '📖 *Historia Reiss* \n\nEn un pequeño pueblo oculto entre montañas, existía un reloj que no marcaba horas, sino recuerdos olvidados...',
    });
  });

  register('dato', async ({ from }) => {
    await sock.sendMessage(from, {
      text: '🏛️ *Dato curioso:* La Universidad de Oxford es más antigua que el Imperio Azteca.',
    });
  });

  register('perfil', async ({ from }) => {
    const user = await db.getUser(from);
    await sock.sendMessage(from, {
      text: [
        '👤 *Tu perfil*',
        `• ID: ${user.id}`,
        `• Coins: ${user.coins || 0}`,
        `• Nivel: ${user.level || 1}`,
        `• XP: ${user.xp || 0}`,
      ].join('\n'),
    });
  });

  register('stats', async ({ from }) => {
    const statsText = await formatUserStats(from);
    await sock.sendMessage(from, { text: statsText });
  });

  register('work', async ({ from }) => {
    const payout = Math.floor(Math.random() * 100) + 20;
    const bonus = Math.floor(Math.random() * 20) + 5;

    await db.addCoins(from, payout);
    await db.addXp(from, bonus);

    await sock.sendMessage(from, {
      text: `💼 *Trabajo completado*\nGanaste ${payout} coins y ${bonus} XP.`,
    });
  });

  register('daily', async ({ from }) => {
    const payout = 100;
    await db.addCoins(from, payout);
    await db.addXp(from, 15);

    await sock.sendMessage(from, {
      text: `🎁 *Daily bonus*\nRecibiste ${payout} coins y 15 XP.`,
    });
  });

  return {
    handleMessage: async (msg) => {
      if (!msg || !msg.key || !msg.key.remoteJid) return;

      const from = msg.key.remoteJid;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

      if (!text) return;

      const { command } = parseCommand(text);
      if (!command) return;

      await db.registerMessage(from);

      const fn = commands.get(command);
      if (!fn) {
        await sock.sendMessage(from, {
          text: '❌ Comando no encontrado. Escribe +menu para ver los disponibles.',
        });
        return;
      }

      await fn({ from, text, msg });
    },
  };
}
