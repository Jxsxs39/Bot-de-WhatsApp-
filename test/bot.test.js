import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMessage,createCommandHandler} from '../handler.js';
import Database from '../database.js';
test('identidad de grupo y mensajes normales',()=>{
 const msg={key:{remoteJid:'123@g.us',participant:'456:2@s.whatsapp.net'},message:{conversation:'hola'}};
 assert.equal(parseMessage(msg).userId,'456@s.whatsapp.net');
 assert.equal(parseMessage(msg).command,undefined);
 assert.equal(parseMessage({...msg,message:{conversation:'.hola'}}).command,'hola');
 assert.equal(parseMessage({...msg,message:{conversation:'+hola'}}).command,undefined);
 assert.equal(parseMessage({...msg,key:{...msg.key,fromMe:true}}),null);
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
test('saludo e historia responden con imágenes y el menú usa prefijo punto',async()=>{
 const db=await new Database(':memory:').init();
 try {
  const sent=[];
  const handler=createCommandHandler({sendMessage:async(...args)=>{sent.push(args);}},db);
  for(const command of ['.hola','.historia','.menu']) {
   await handler.handleMessage({key:{remoteJid:'123@s.whatsapp.net'},message:{conversation:command}});
  }
  assert.equal(sent.length,3);
  assert.ok(sent.slice(0,2).every(([, message])=>message.image?.url && message.caption));
  assert.match(sent[0][1].caption,/\.menu/);
  assert.match(sent[2][1].text,/• \.hola/);
 }finally{await db.close();}
});
