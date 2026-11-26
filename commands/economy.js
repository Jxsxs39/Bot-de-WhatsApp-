// Los tiempos se guardan en milisegundos y sobreviven a un reinicio.
export const WORK_WAIT = 5 * 60 * 1000;
export const DAILY_WAIT = 24 * 60 * 60 * 1000;
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
 {name:'daily', async run(ctx) { await reward(ctx,'daily',100,15,DAILY_WAIT); }}
];
