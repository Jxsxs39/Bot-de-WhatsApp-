// Cada objeto contiene el nombre del comando y la función que ejecuta.
export default [
 // Saludo y orientación para usuarios nuevos.
 {name:'hola', async run({replyWithImage}) { await replyWithImage('https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=85','¡Hola! Soy *Historia Reiss Bot* 👑\nUn paisaje tranquilo para acompañar tu aventura.\nEscribe .menu para ver mis comandos.'); }},
 // Menú dinámico: se actualiza al registrar otro comando.
 {name:'menu', async run({reply,commands}) { await reply('👑 *Menú principal*\n\n'+[...commands.keys()].map(name=>'• .'+name).join('\n')); }},
 // Texto narrativo editable sin tocar el motor del bot.
 {name:'historia', async run({replyWithImage}) { await replyWithImage('https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=85','📖 *Historia Reiss*\n\nEn un pequeño pueblo oculto entre montañas, existía un reloj que no marcaba horas, sino recuerdos olvidados...'); }},
 // Dato fijo; puede ampliarse a una colección posteriormente.
 {name:'dato', async run({reply}) { await reply('🏛️ *Dato curioso:* La Universidad de Oxford es más antigua que el Imperio Azteca.'); }},
 // Consulta únicamente el perfil de quien envía el mensaje.
 {name:'perfil', async run({reply,db,userId}) { const u=await db.getStats(userId); await reply('👤 *Tu perfil*\n• Coins: '+u.coins+'\n• Nivel: '+u.level+'\n• XP: '+u.xp); }},
 // Muestra estadísticas personales sin publicar identificadores privados.
 {name:'stats', async run({reply,db,userId}) { const u=await db.getStats(userId); await reply('📊 *Estadísticas*\n• Mensajes: '+u.messages+'\n• Coins: '+u.coins+'\n• XP: '+u.xp+'\n• Nivel: '+u.level); }}
];
