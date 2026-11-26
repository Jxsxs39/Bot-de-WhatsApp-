// Cada objeto contiene el nombre del comando y la función que ejecuta.
export default [
 {name:'hola', async run({reply}) { await reply('¡Hola! Soy *Historia Reiss Bot* 👑\nEscribe +menu para ver mis comandos.'); }},
 {name:'menu', async run({reply,commands}) { await reply('👑 *Menú principal*\n\n'+[...commands.keys()].map(name=>'• +'+name).join('\n')); }},
 {name:'historia', async run({reply}) { await reply('📖 *Historia Reiss*\n\nEn un pequeño pueblo oculto entre montañas, existía un reloj que no marcaba horas, sino recuerdos olvidados...'); }},
 {name:'dato', async run({reply}) { await reply('🏛️ *Dato curioso:* La Universidad de Oxford es más antigua que el Imperio Azteca.'); }},
 {name:'perfil', async run({reply,db,userId}) { const u=await db.getStats(userId); await reply('👤 *Tu perfil*\n• Coins: '+u.coins+'\n• Nivel: '+u.level+'\n• XP: '+u.xp); }},
 {name:'stats', async run({reply,db,userId}) { const u=await db.getStats(userId); await reply('📊 *Estadísticas*\n• Mensajes: '+u.messages+'\n• Coins: '+u.coins+'\n• XP: '+u.xp+'\n• Nivel: '+u.level); }}
];
