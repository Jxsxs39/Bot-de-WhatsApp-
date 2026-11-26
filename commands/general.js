// Cada objeto contiene el nombre del comando y la función que ejecuta.
export default [
 // Saludo y orientación para usuarios nuevos.
 {name:'hola', async run({replyWithImage}) { await replyWithImage('https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTz-Aiu59NlPmS7N0XXbyubXSZlEx6EgIypqmI70JMH47mc7YMxve845HJYp42YQYV2Mulslsp9GlBlf20SZZS10nqg3iqdJuVbONoMdeMCnA&s=10','¡Hola! Soy *Historia Reiss Bot* 👑\nEscribe .menu para ver mis comandos.'); }},
 // Menú dinámico: se actualiza al registrar otro comando.
 {name:'menu', async run({reply,commands}) { await reply('👑 *Menú principal*\n\n'+[...commands.keys()].map(name=>'• .'+name).join('\n')); }},
 // Texto narrativo editable sin tocar el motor del bot.
 {name:'historia', async run({replyWithImage}) { await replyWithImage('https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQuJNQnSpOsMvWoDllNutNEUIvxnfcTcKNn2oCi76KyjQ&s=10','📖 *Historia Reiss*\n\nEn un pequeño pueblo oculto entre montañas, existía un reloj que no marcaba horas, sino recuerdos olvidados...'); }},
 // Dato fijo; puede ampliarse a una colección posteriormente.
 {name:'dato', async run({reply}) { await reply('🏛️ *Dato curioso:* La Universidad de Oxford es más antigua que el Imperio Azteca.'); }},
 // Consulta únicamente el perfil de quien envía el mensaje.
 {name:'perfil', async run({reply,db,userId}) { const u=await db.getStats(userId); await reply('👤 *Tu perfil*\n• Coins: '+u.coins+'\n• Nivel: '+u.level+'\n• XP: '+u.xp); }},
 // Muestra estadísticas personales sin publicar identificadores privados.
 {name:'stats', async run({reply,db,userId}) { const u=await db.getStats(userId); await reply('📊 *Estadísticas*\n• Mensajes: '+u.messages+'\n• Coins: '+u.coins+'\n• XP: '+u.xp+'\n• Nivel: '+u.level); }}
];
