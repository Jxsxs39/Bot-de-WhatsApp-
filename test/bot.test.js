import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {parseMessage,createCommandHandler} from '../handler.js';
import {styleBotReply} from '../bot-style.js';
import Database from '../database.js';
test('identidad de grupo y mensajes normales',()=>{
 const msg={key:{remoteJid:'123@g.us',participant:'456:2@s.whatsapp.net'},message:{conversation:'hola'}};
 assert.equal(parseMessage(msg).userId,'456@s.whatsapp.net');
 assert.equal(parseMessage(msg).command,undefined);
 assert.equal(parseMessage({...msg,message:{conversation:'.ping'}}).command,'ping');
 assert.equal(parseMessage({...msg,message:{conversation:'+ping'}}).command,undefined);
 assert.equal(parseMessage({...msg,message:{videoMessage:{caption:'.s1'}}}).command,'s1');
 assert.equal(parseMessage({...msg,message:{imageMessage:{caption:'.s2'}}}).command,'s2');
 assert.equal(parseMessage({...msg,key:{...msg.key,fromMe:true}}),null);
 const ownCommand={...msg,key:{...msg.key,fromMe:true},message:{conversation:'.ping'}};
 assert.equal(parseMessage(ownCommand,['456:2@s.whatsapp.net']).userId,'456@s.whatsapp.net');
 assert.equal(parseMessage(ownCommand,['789@s.whatsapp.net']),null);
 const ownPrivateMessage={key:{remoteJid:'456@s.whatsapp.net',fromMe:true},message:{conversation:'hola'}};
 assert.equal(parseMessage(ownPrivateMessage,['456:2@s.whatsapp.net']).userId,'456@s.whatsapp.net');
 assert.equal(parseMessage(ownPrivateMessage,['456@s.whatsapp.net']).command,undefined);
 assert.equal(parseMessage({...ownPrivateMessage,key:{remoteJid:'123@s.whatsapp.net',fromMe:true}},['456@s.whatsapp.net']),null);
});
test('premios concurrentes y usuarios independientes',async()=>{
 const db=await new Database(':memory:').init();
 try {
 const results=await Promise.all([db.claim('a','daily',100,15,86400000,1000),db.claim('a','daily',100,15,86400000,1000)]);
 assert.equal(results.filter(r=>r.ok).length,1);
 assert.equal((await db.getStats('a')).coins,100);
 assert.equal((await db.getStats('b')).coins,0);
 assert.equal((await db.claim('a','daily',100,15,86400000,86401000)).ok,true);
 }finally{await db.close();}
});
test('mensaje normal no genera respuesta ni error',async()=>{
 const db=await new Database(':memory:').init();
 try{const sent=[];const handler=createCommandHandler({sendMessage:async(...args)=>sent.push(args)},db);
 await handler.handleMessage({key:{remoteJid:'123@s.whatsapp.net'},message:{conversation:'hola'}});
 assert.equal(sent.length,0);assert.equal((await db.getStats('123@s.whatsapp.net')).messages,1);
 }finally{await db.close();}
});
test('comandos propios de la cuenta vinculada sí reciben respuesta',async()=>{
 const db=await new Database(':memory:').init();
 try {
  const sent=[];
  const handler=createCommandHandler({user:{id:'456:2@s.whatsapp.net'},sendMessage:async(...args)=>{
   sent.push(args);
   return {key:{remoteJid:args[0],id:`sent-${sent.length}`}};
  }},db);
  await handler.handleMessage({
   key:{remoteJid:'123@g.us',participant:'456:2@s.whatsapp.net',fromMe:true},
   message:{conversation:'.ping'}
  });
  assert.equal(sent.length,2);
  assert.equal(sent[0][2].quoted.message.conversation,'.ping');
  assert.match(sent[0][1].text,/Pong/);
  assert.equal(sent[1][1].edit.id,'sent-1');
  assert.equal((await db.getStats('456@s.whatsapp.net')).messages,1);
 }finally{await db.close();}
});
test('comandos desde el chat privado del bot funcionan sin responder a sus propios textos',async()=>{
 const db=await new Database(':memory:').init();
 try {
  const sent=[];
  const handler=createCommandHandler({user:{id:'456:2@s.whatsapp.net'},sendMessage:async(...args)=>{
   sent.push(args);
   return {key:{remoteJid:args[0],id:`sent-${sent.length}`}};
  }},db);
  await handler.handleMessage({
   key:{remoteJid:'456@s.whatsapp.net',fromMe:true},
   message:{conversation:'.ping'}
  });
  assert.equal(sent.length,2);
  assert.match(sent[0][1].text,/Pong/);
  await handler.handleMessage({
   key:{remoteJid:'456@s.whatsapp.net',fromMe:true},
   message:{conversation:'🏓 ¡Pong!'}
  });
  assert.equal(sent.length,2);
 }finally{await db.close();}
});
test('.ping confirma actividad y .tt guía a la descarga oficial',async()=>{
 const db=await new Database(':memory:').init();
 try {
  const sent=[];
  const handler=createCommandHandler({sendMessage:async(...args)=>{
   sent.push(args);
   return {key:{remoteJid:args[0],id:`sent-${sent.length}`}};
  }},db);
  await handler.handleMessage({
   key:{remoteJid:'123@s.whatsapp.net'},
   message:{conversation:'.ping'}
  });
  await handler.handleMessage({
   key:{remoteJid:'123@s.whatsapp.net'},
   message:{conversation:'.tt https://www.tiktok.com/@creator/video/123'}
  });
  assert.equal(sent.length,3);
  assert.match(sent[0][1].text,/Pong/);
  assert.equal(sent[1][1].edit.id,'sent-1');
  assert.match(sent[0][1].text,/\*Historia Reiss\* 🏓/);
  assert.match(sent[0][1].text,/_Con cariño, Historia_/);
  assert.match(sent[2][1].text,/no descargo el video automáticamente/);
 }finally{await db.close();}
});
test('.code envía la solicitud al servicio de subbots',async()=>{
 const db=await new Database(':memory:').init();
 try {
  const sent=[];
  let requester;
  const subbots={requestPairingCode:async ctx=>{requester=ctx.userId;await ctx.reply('Código de subbot');}};
  const handler=createCommandHandler({sendMessage:async(...args)=>sent.push(args)},db,undefined,subbots);
  await handler.handleMessage({
   key:{remoteJid:'123@s.whatsapp.net'},
   message:{conversation:'.code'}
  });
  assert.equal(requester,'123@s.whatsapp.net');
  assert.equal(sent.length,1);
  assert.match(sent[0][1].text,/Código de subbot/);
 }finally{await db.close();}
});
test('.calc evalúa operaciones de forma segura',async()=>{
 const db=await new Database(':memory:').init();
 try {
  const sent=[];
  const handler=createCommandHandler({sendMessage:async(...args)=>sent.push(args)},db);
  for(const expression of ['(12 + 8) / 4','2^3^2','-2^2','1,5 * 2','30%30000','10 / 0','2 +']) {
   await handler.handleMessage({
    key:{remoteJid:'123@s.whatsapp.net'},
    message:{conversation:`.calc ${expression}`}
   });
  }
  assert.match(sent[0][1].text,/Resultado: 5/);
  assert.match(sent[1][1].text,/Resultado: 512/);
  assert.match(sent[2][1].text,/Resultado: -4/);
  assert.match(sent[3][1].text,/Resultado: 3/);
  assert.match(sent[4][1].text,/Resultado: 9000/);
  assert.match(sent[5][1].text,/No se puede dividir entre cero/);
  assert.match(sent[6][1].text,/Operación no válida/);
 }finally{await db.close();}
});
test('.tag menciona a todos en grupos y limita el uso a administradores',async()=>{
 const db=await new Database(':memory:').init();
 try {
  const sent=[];
  const participants=[
   {id:'123@s.whatsapp.net',admin:'admin'},
   {id:'456:2@s.whatsapp.net',admin:null}
  ];
  const handler=createCommandHandler({
   groupMetadata:async()=>({participants}),
   sendMessage:async(...args)=>{sent.push(args);return {key:{id:'tagged'}};}
  },db);
  const rawMessage={
   key:{remoteJid:'789@g.us',participant:'123:4@s.whatsapp.net',id:'command-1'},
   message:{conversation:'.tag Aviso importante'}
  };
  await handler.handleMessage(rawMessage);
  assert.equal(sent.length,1);
  assert.equal(sent[0][1].text,'Aviso importante\n\n@123 @456');
  assert.deepEqual(sent[0][1].mentions,['123@s.whatsapp.net','456@s.whatsapp.net']);
  assert.equal(sent[0][2].quoted,rawMessage);

  participants[0].admin=null;
  await handler.handleMessage({
   key:{remoteJid:'789@g.us',participant:'123@s.whatsapp.net'},
   message:{conversation:'.tag No autorizado'}
  });
  assert.equal(sent.length,2);
  assert.match(sent[1][1].text,/Solo los administradores/);

  await handler.handleMessage({
   key:{remoteJid:'123@s.whatsapp.net'},
   message:{conversation:'.tag No es un grupo'}
  });
  assert.equal(sent.length,3);
  assert.match(sent[2][1].text,/solo funciona en grupos/);
 } finally {await db.close();}
});
test('.pin busca el tema indicado en Pinterest y valida la entrada',async()=>{
 const db=await new Database(':memory:').init();
 const pages={};
 for(let index=0;index<4;index++) pages[String(index)]={
  index,
  title:`File:foto-${index}.jpg`,
  imageinfo:[{
   thumburl:`https://thumb.wikimedia.org/image-${index}.jpg`,
   descriptionurl:`https://commons.wikimedia.org/wiki/File:foto-${index}.jpg`,
   extmetadata:{
    ObjectName:{value:`Foto ${index}`},
    Artist:{value:'<a href="https://commons.wikimedia.org/wiki/User:Artist">Artista</a>'},
    LicenseShortName:{value:'CC BY-SA 4.0'}
   }
  }]
 };
 const bingResults=['playa resultado uno','playa resultado dos'].map((title,index)=>{
  const metadata=JSON.stringify({
   t:title,
   turl:`https://ts${index+1}.mm.bing.net/th?id=photo-${index}`,
   purl:`https://example.com/photo-${index}`
  }).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  return `<a class="iusc" m="${metadata}"></a>`;
 }).join('');
 const fetchMock=mock.method(globalThis,'fetch',async url=>{
  const parsedUrl=new URL(url);
  if(parsedUrl.hostname==='commons.wikimedia.org') {
   assert.equal(parsedUrl.searchParams.get('gsrlimit'),'50');
   return {ok:true,json:async()=>({query:{pages:parsedUrl.searchParams.get('gsrsearch')==='vestidos de verano'?pages:{}}})};
  }
  if(parsedUrl.hostname==='es.wikipedia.org') {
   return {ok:true,json:async()=>({query:{pages:{
    1:{index:1,title:'Playa',fullurl:'https://es.wikipedia.org/wiki/Playa',thumbnail:{source:'https://upload.wikimedia.org/wikipedia/commons/beach.jpg'}}
   }}})};
  }
  assert.equal(parsedUrl.hostname,'www.bing.com');
  return {ok:true,text:async()=>bingResults};
 });
 try {
  const sent=[];
  const handler=createCommandHandler({sendMessage:async(...args)=>{sent.push(args);return {key:{remoteJid:args[0],id:`sent-${sent.length}`}};}},db);
  await handler.handleMessage({
   key:{remoteJid:'123@s.whatsapp.net'},
   message:{conversation:'.pin vestidos de verano'}
  });
  assert.equal(sent.length,3);
  assert.equal(sent[0][1].image.url,'https://thumb.wikimedia.org/image-0.jpg');
  assert.equal(sent[2][1].image.url,'https://thumb.wikimedia.org/image-2.jpg');
  assert.ok(sent.every(([,message])=>message.image && !('caption' in message) && !('text' in message)));
  assert.ok(sent.slice(0,3).every(([, ,options])=>options?.quoted?.message.conversation==='.pin vestidos de verano'));

  await handler.handleMessage({
   key:{remoteJid:'123@s.whatsapp.net'},
   message:{conversation:'.pin contexto sin archivos commons'}
  });
  assert.equal(sent.length,6);
  assert.equal(sent[3][1].image.url,'https://upload.wikimedia.org/wikipedia/commons/beach.jpg');
  assert.equal(sent[4][1].image.url,'https://ts1.mm.bing.net/th?id=photo-0');
  assert.equal(sent[5][1].image.url,'https://ts2.mm.bing.net/th?id=photo-1');
  assert.ok(sent.every(([,message])=>message.image && !('caption' in message) && !('text' in message)));

  await handler.handleMessage({
   key:{remoteJid:'123@s.whatsapp.net'},
   message:{conversation:'.pin'}
  });
  assert.match(sent[6][1].text,/Uso: \.pin/);
 }finally{fetchMock.mock.restore();await db.close();}
});
test('respuestas conservan código y logs sin decoración',()=>{
 const code='const command = true;';
 const logs='[audit] comando completado';
 assert.equal(styleBotReply(code,'getcode'),code);
 assert.equal(styleBotReply(logs,'logs'),logs);
 assert.match(styleBotReply('Listo.','ping'),/🏓/);
});
test('.menu muestra el banner y .hola ya no está disponible',async()=>{
 const db=await new Database(':memory:').init();
 try {
  const sent=[];
  const handler=createCommandHandler({sendMessage:async(...args)=>{sent.push(args);}},db);
  for(const command of ['.historia','.menu','.hola']) {
   await handler.handleMessage({key:{remoteJid:'123@s.whatsapp.net'},message:{conversation:command}});
  }
  assert.equal(sent.length,3);
  assert.ok(sent[0][1].image?.url && sent[0][1].caption);
  assert.ok(sent[1][1].image?.url && sent[1][1].caption);
  assert.match(sent[1][1].caption,/HISTORIA REISS/);
  assert.match(sent[1][1].caption,/\.menu/);
  assert.match(sent[1][1].caption,/• \.s1/);
  assert.match(sent[1][1].caption,/• \.s2/);
  assert.match(sent[1][1].caption,/• \.ping/);
  assert.match(sent[1][1].caption,/• \.calc/);
  assert.match(sent[1][1].caption,/• \.tt/);
  assert.match(sent[1][1].caption,/• \.pin/);
  assert.match(sent[1][1].caption,/• \.chatgpt/);
  assert.doesNotMatch(sent[1][1].caption,/\.hola/);
  assert.match(sent[2][1].text,/Comando no encontrado/);
  assert.equal(sent[2][1].image,undefined);
 }finally{await db.close();}
});
