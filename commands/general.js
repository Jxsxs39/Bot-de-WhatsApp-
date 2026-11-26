import {styleBotReply} from '../bot-style.js';
// Cada objeto contiene el nombre del comando y la función que ejecuta.
const historiaImageUrl = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQuJNQnSpOsMvWoDllNutNEUIvxnfcTcKNn2oCi76KyjQ&s=10';
const IMAGE_SEARCH_LIMIT=3;

function plainMetadata(value,maxLength=120) {
 return String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"').replace(/&#39;|&#039;/gi,"'").replace(/\s+/g,' ').trim().slice(0,maxLength);
}

export async function searchWikimediaImages(query,fetchImpl=globalThis.fetch) {
 const url=new URL('https://commons.wikimedia.org/w/api.php');
 for(const [key,value] of Object.entries({
  action:'query',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'12',
  prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'900',format:'json'
 })) url.searchParams.set(key,value);
 const response=await fetchImpl(url,{headers:{'user-agent':'HistoriaReissBot/1.0 (WhatsApp image search)'} ,signal:AbortSignal.timeout(12_000)});
 if(!response.ok) throw new Error(`Wikimedia search returned HTTP ${response.status}`);
 const data=await response.json();
 return Object.values(data.query?.pages||{})
  .sort((a,b)=>(a.index||0)-(b.index||0))
  .filter(page=>/\.(jpe?g|png|webp)$/i.test(page.title||''))
  .map(page=>{
   const info=page.imageinfo?.[0];
   if(!info) return null;
   const imageUrl=info.thumburl||info.url;
   let parsedUrl;
   try {parsedUrl=new URL(imageUrl);} catch {return null;}
   if(parsedUrl.protocol!=='https:' || !['thumb.wikimedia.org','upload.wikimedia.org'].includes(parsedUrl.hostname)) return null;
   const descriptionUrl=info.descriptionurl;
   let parsedDescription;
   try {parsedDescription=new URL(descriptionUrl);} catch {return null;}
   if(parsedDescription.protocol!=='https:' || parsedDescription.hostname!=='commons.wikimedia.org') return null;
   const metadata=info.extmetadata||{};
   return {
    imageUrl:parsedUrl.href,
    title:plainMetadata(metadata.ObjectName?.value||page.title.replace(/^File:/,'')),
    artist:plainMetadata(metadata.Artist?.value||metadata.Attribution?.value||'Autor no indicado'),
    license:plainMetadata(metadata.LicenseShortName?.value||'Licencia libre',40),
    descriptionUrl:parsedDescription.href
   };
  })
  .filter(Boolean)
  .filter((image,index,images)=>images.findIndex(item=>item.imageUrl===image.imageUrl)===index)
  .slice(0,IMAGE_SEARCH_LIMIT);
}

export default [
 // Diagnóstico en grupos y privados: muestra solo la identidad del remitente autenticado.
 {name:'id', async run({reply,chatId,userId,rawMessage,sock}) {
  const key=rawMessage?.key;
  const ids=[userId,...(chatId.endsWith('@g.us')?[key?.participantAlt,key?.participant]:[key?.remoteJidAlt,chatId])].filter(x=>typeof x==='string').map(x=>x.replace(/:\d+@/,'@'));
  const pn=ids.find(x=>/^\d+@s\.whatsapp\.net$/.test(x));
  let lid=ids.find(x=>/^\d+@lid$/.test(x));
  if(!lid && pn) try {lid=await sock?.signalRepository?.lidMapping?.getLIDForPN(pn);} catch {}
  if(lid && !/^\d+@lid$/.test(lid)) lid=undefined;
  await reply('Tu identidad de WhatsApp\nNúmero JID: '+(pn||'No disponible')+'\nLID: '+(lid||'No disponible'));
 }},
 // Ping público: mide el tiempo real de envío de una respuesta a WhatsApp.
 ...['ping','p'].map(name=>({name,async run({reply,sock,chatId}){
  const start=performance.now();
  const sent=await reply('🏓 ¡Pong!\nEstado: Activo\nLatencia: midiendo…');
  const elapsed=performance.now()-start;
  if(!sent?.key) throw new Error('No se recibió la clave del mensaje');
  await sock.sendMessage(chatId,{text:styleBotReply('🏓 ¡Pong!\nEstado: Activo\nLatencia: '+elapsed.toFixed(2)+' ms','ping'),edit:sent.key});
 }})),
 {name:'tt', async run({reply,args}) {
  const link=args.join(' ').trim();
  if(!link) return reply('Uso: .tt <enlace de TikTok>. Para descargar, usa la opción oficial si el creador la permite.');
  let url;
  try { url=new URL(link); } catch { return reply('El enlace no parece válido. Usa un enlace https://www.tiktok.com/...'); }
  const allowedHosts=new Set(['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com']);
  if(url.protocol!=='https:' || !allowedHosts.has(url.hostname.toLowerCase())) {
   return reply('Ese no parece ser un enlace válido de TikTok. Usa un enlace https://www.tiktok.com/...');
  }
  await reply('Para respetar los permisos del creador, no descargo el video automáticamente. Ábrelo en TikTok y usa Compartir → Guardar video si esa opción está habilitada.');
 }},
 ...['pin','pinterest'].map(name=>({name,async run({reply,replyWithImage,args}) {
  const query=args.join(' ').trim();
  if(!query) return reply('Uso: .pin <contexto>. Enviaré hasta tres fotos relacionadas y un enlace de Pinterest.');
  if(query.length>200) return reply('El tema de búsqueda no puede superar los 200 caracteres.');
  const pinterestUrl=new URL('https://www.pinterest.com/search/pins/');
  pinterestUrl.searchParams.set('q',query);
  try {
   const images=await searchWikimediaImages(query);
   if(!images.length) return reply(`No encontré fotos con licencia libre para “${query}”. Busca más ideas en Pinterest:\n${pinterestUrl.href}`);
   await reply(`Encontré ${images.length} foto${images.length===1?'':'s'} relacionadas con “${query}”. Las imágenes vienen de Wikimedia Commons; más ideas en Pinterest:\n${pinterestUrl.href}`);
   for(const image of images) {
    await replyWithImage(image.imageUrl,`📷 ${image.title}\n© ${image.artist} · ${image.license}\nFuente: ${image.descriptionUrl}`);
   }
  } catch(error) {
   console.error('[PIN] Falló la búsqueda de imágenes:',error?.name||'Error');
   await reply('No pude buscar fotos ahora. Inténtalo de nuevo más tarde o abre Pinterest con este enlace:\n'+pinterestUrl.href);
  }
 }})),
 // Menú dinámico: se actualiza al registrar otro comando.
 {name:'menu', async run(ctx) {
  const {replyWithImage,commands}=ctx;
  const sections=[['General',['ping','p','menu','id','historia','dato','perfil','stats','chatgpt','pin']],['Economía',['work','daily']],['Stickers',['sticker','s','stiker']]];
  const known=new Set(sections.flatMap(([,names])=>names));
  sections.push(['Otros',[...commands.keys()].filter(n=>!known.has(n))]);
  const blocks=sections.map(([title,names])=>[title,names.filter(n=>commands.has(n))]);
  const banner='╭━━━･ﾟ✧ 👑 ✧ﾟ･━━━╮\n   *HISTORIA REISS*\n  _Tu guía por el reino_\n╰━━━━━━━━━━━━━━━━╯';
  const menu=blocks.filter(([,names])=>names.length).map(([title,names])=>'*'+title+'*\n'+names.map(n=>'• .'+n).join('\n')).join('\n\n');
  await replyWithImage(historiaImageUrl,banner+'\n\n📜 *Menú principal*\n\n'+menu);
 }},
 // Texto narrativo editable sin tocar el motor del bot.
 {name:'historia', async run({replyWithImage}) { await replyWithImage(historiaImageUrl,'📖 *Historia Reiss*\n\nEn un pequeño pueblo oculto entre montañas, existía un reloj que no marcaba horas, sino recuerdos olvidados...'); }},
 // Dato fijo; puede ampliarse a una colección posteriormente.
 {name:'dato', async run({reply}) { await reply('🏛️ *Dato curioso:* La Universidad de Oxford es más antigua que el Imperio Azteca.'); }},
 // Consulta únicamente el perfil de quien envía el mensaje.
 {name:'perfil', async run({reply,db,userId}) { const u=await db.getStats(userId); await reply('👤 *Tu perfil*\n• Coins: '+u.coins+'\n• Nivel: '+u.level+'\n• XP: '+u.xp); }},
 // Muestra estadísticas personales sin publicar identificadores privados.
 {name:'stats', async run({reply,db,userId}) { const u=await db.getStats(userId); await reply('📊 *Estadísticas*\n• Mensajes: '+u.messages+'\n• Coins: '+u.coins+'\n• XP: '+u.xp+'\n• Nivel: '+u.level); }}
];
