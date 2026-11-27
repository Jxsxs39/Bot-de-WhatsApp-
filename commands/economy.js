// Los tiempos se guardan en milisegundos y sobreviven a un reinicio.
export const WORK_WAIT = 5 * 60 * 1000;
export const DAILY_WAIT = 24 * 60 * 60 * 1000;
export const SHOP_ITEMS=[
  {id:'aprendiz',title:'Aprendiz',price:250},
  {id:'aventurero',title:'Aventurero',price:750},
  {id:'noble',title:'Noble',price:2000},
  {id:'leyenda',title:'Leyenda',price:5000}
];
const itemsById=new Map(SHOP_ITEMS.map(item=>[item.id,item]));
// Centraliza la entrega de premios y la respuesta de espera.
async function reward(ctx, kind, coins, xp, wait) {
  const result = await ctx.db.claim(ctx.userId, kind, coins, xp, wait);
  if (!result.ok) return ctx.reply('⏳ Espera '+Math.ceil(result.remaining/60000)+' minuto(s).');
  await ctx.reply('🎁 Recibiste '+coins+' coins y '+xp+' XP.');
}
export default [
 // Premio aleatorio: 20–119 monedas y 5–24 XP cada cinco minutos.
 {name:'work', async run(ctx) { await reward(ctx,'work',20+Math.floor(Math.random()*100),5+Math.floor(Math.random()*20),WORK_WAIT); }},
 // Premio fijo diario: 100 monedas y 15 XP cada 24 horas.
 {name:'daily', async run(ctx) { await reward(ctx,'daily',100,15,DAILY_WAIT); }},
 {name:'tienda',async run({reply}) {
  const lines=SHOP_ITEMS.map(item=>`• ${item.title} — ${item.price} coins (id: ${item.id})`);
  await reply('🛒 *Tienda — títulos para tu perfil*\n'+lines.join('\n')+'\n\nCompra con .comprar <id>.');
 }},
 {name:'comprar',async run({reply,args,userId,db}) {
  const item=args.length===1?itemsById.get(args[0].toLowerCase()):null;
  if(!item) return reply('Indica un id válido. Usa .tienda para ver los artículos.');
  const result=await db.buyItem(userId,item.id,item.price);
  if(!result.ok) {
   if(result.reason==='owned') return reply(`Ya tienes el título *${item.title}*.`);
   return reply(`No tienes suficientes coins para *${item.title}*. Precio: ${item.price}; saldo: ${result.coins}.`);
  }
  await reply(`Compraste el título *${item.title}* por ${item.price} coins. Saldo restante: ${result.coins}. Usa .equipar ${item.id} para mostrarlo en tu perfil.`);
 }},
 {name:'inventario',async run({reply,userId,db}) {
  const inventory=await db.getInventory(userId);
  if(!inventory.items.length) return reply('Tu inventario está vacío. Usa .tienda para ver los artículos.');
  const lines=inventory.items.map(id=>{
   const item=itemsById.get(id);
   return item?`• ${item.title}${inventory.equipped===id?' — equipado':''}`:null;
  }).filter(Boolean);
  await reply('🎒 *Tus títulos*\n'+lines.join('\n')+'\n\nUsa .equipar <id> para elegir uno.');
 }},
 {name:'equipar',async run({reply,args,userId,db}) {
  if(args.length!==1) return reply('Uso: .equipar <id|ninguno>. Consulta tus artículos con .inventario.');
  const id=args[0].toLowerCase();
  if(id==='ninguno') {
   await db.equipTitle(userId,null);
   return reply('Quitaste el título de tu perfil.');
  }
  const item=itemsById.get(id);
  if(!item) return reply('Ese título no existe. Consulta .inventario.');
  if(!await db.equipTitle(userId,id)) return reply('Todavía no tienes ese título. Puedes comprarlo en .tienda.');
  await reply(`Equipaste el título *${item.title}* en tu perfil.`);
 }}
];
