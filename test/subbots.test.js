import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {access,mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MessageDeduplicator} from '../message-deduplicator.js';
import {SubbotManager} from '../subbot-manager.js';

test('una misma actualización solo se procesa una vez entre sockets',async()=>{
 const deduplicator=new MessageDeduplicator();
 const message={key:{remoteJid:'123@g.us',id:'message-1'}};
 let handled=0;
 const handler={handleMessage:async()=>{handled++;}};
 await Promise.all([
  deduplicator.dispatch(handler,message),
  deduplicator.dispatch(handler,message)
 ]);
 assert.equal(handled,1);
});

test('registra eventos de mensajes de subbot y procesa notificaciones en vivo',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'subbot-events-test-'));
 const authDirectory=path.join(directory,'sessions');
 const phone='123456789';
 await mkdir(path.join(authDirectory,phone),{recursive:true});
 const logLines=[];
 let dispatched=0;
 let subbotSocket;
 const manager=new SubbotManager({
  authDirectory,
  settingsFile:path.join(directory,'data','subbots.json'),
  createCommandHandler:()=>({handleMessage:async()=>{}}),
  dispatchMessage:async()=>{dispatched++;},
  loadAuthState:async()=>({state:{creds:{registered:true}},saveCreds:async()=>{}}),
  getBaileysVersion:async()=>({version:[2,3000,101]}),
  makeSocket:()=>{
   const ev=new EventEmitter();
   subbotSocket={ev,end:()=>{}};
   return subbotSocket;
  },
  logger:{log:(...args)=>logLines.push(args),error(){}}
 });
 try {
  await manager.start();
  subbotSocket.ev.emit('connection.update',{connection:'open'});
  const message={key:{remoteJid:'chat@s.whatsapp.net',id:'message-1'}};
  subbotSocket.ev.emit('messages.upsert',{messages:[message],type:'notify'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dispatched,1);
  assert.ok(logLines.some(args=>args[0]==='[SUBBOT] messages.upsert:'&&args[1]==='notify'&&args[3]===1));
 } finally {
  await manager.shutdown();
  await rm(directory,{recursive:true,force:true});
 }
});

test('.code solo genera un código en privado y vincula el número del solicitante',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'subbot-test-'));
 let requestedPhone;
 const manager=new SubbotManager({
  authDirectory:path.join(directory,'sessions'),
  settingsFile:path.join(directory,'data','subbots.json'),
  createCommandHandler:()=>({handleMessage:async()=>{}}),
  dispatchMessage:async()=>{},
  loadAuthState:async()=>({state:{creds:{registered:false}},saveCreds:async()=>{}}),
  getBaileysVersion:async()=>({version:[2,3000,101]}),
  makeSocket:()=>{
   const ev=new EventEmitter();
   const sock={
    ev,
    requestPairingCode:async phone=>{requestedPhone=phone;return 'ABCD-1234';},
    end:()=>{}
   };
   setImmediate(()=>ev.emit('connection.update',{qr:'qr'}));
   return sock;
  },
  logger:{log(){},error(){}}
 });
 try {
  await manager.start();
  const replies=[];
  await manager.requestPairingCode({
   chatId:'123456789@s.whatsapp.net',
   userId:'123456789@s.whatsapp.net',
   sock:{user:{id:'999999999@s.whatsapp.net'}},
   reply:async text=>replies.push(text)
  });
  assert.equal(requestedPhone,'123456789');
  assert.match(replies[0],/ABCD-1234/);
  assert.equal(manager.getStatus().pending,1);

  const before=manager.getStatus().pending;
  await manager.requestPairingCode({
   chatId:'123@g.us',
   userId:'456789123@s.whatsapp.net',
   sock:{user:{id:'999999999@s.whatsapp.net'}},
   reply:async text=>replies.push(text)
  });
  assert.match(replies[1],/chat privado/);
  assert.equal(manager.getStatus().pending,before);
  await manager.setCodeEnabled(false);
  assert.equal(manager.getStatus().pending,0);
  assert.match(replies[2],/código de vinculación quedó invalidado/);
 } finally {
  await manager.shutdown();
  await rm(directory,{recursive:true,force:true});
 }
});

test('.code distingue credenciales antiguas y permite reiniciar una sesión desconectada',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'subbot-stale-test-'));
 const authDirectory=path.join(directory,'sessions');
 const phone='123456789';
 const sessionDirectory=path.join(authDirectory,phone);
 await mkdir(sessionDirectory,{recursive:true});
 let registered=true;
 let requestedPhone;
 const sockets=[];
 const manager=new SubbotManager({
  authDirectory,
  settingsFile:path.join(directory,'data','subbots.json'),
  createCommandHandler:()=>({handleMessage:async()=>{}}),
  dispatchMessage:async()=>{},
  loadAuthState:async()=>({state:{creds:{registered}},saveCreds:async()=>{}}),
  getBaileysVersion:async()=>({version:[2,3000,101]}),
  makeSocket:()=>{
   const ev=new EventEmitter();
   const sock={ev,requestPairingCode:async value=>{requestedPhone=value;return 'ABCD-1234';},end:()=>{}};
   sockets.push(sock);
   setImmediate(()=>ev.emit('connection.update',{qr:'qr'}));
   return sock;
  },
  logger:{log(){},error(){}}
 });
 try {
  await manager.start();
  const replies=[];
  const ctx={
   chatId:`${phone}@s.whatsapp.net`,
   userId:`${phone}@s.whatsapp.net`,
   sock:{user:{id:'999999999@s.whatsapp.net'}},
   reply:async text=>replies.push(text)
  };
  await manager.requestPairingCode(ctx);
  assert.match(replies[0],/credenciales de una sesión anterior/);
  assert.equal(requestedPhone,undefined);

  assert.deepEqual(await manager.resetSession(phone),{ok:true});
  await assert.rejects(access(sessionDirectory));
  registered=false;
  await manager.requestPairingCode(ctx);
  assert.match(replies[1],/ABCD-1234/);
  assert.equal(requestedPhone,phone);
  sockets.at(-1).ev.emit('connection.update',{connection:'open'});
  assert.deepEqual(await manager.resetSession(phone),{ok:false,reason:'online'});
 } finally {
  await manager.shutdown();
  await rm(directory,{recursive:true,force:true});
 }
});

test('el estado de disponibilidad de .code persiste y bloquea solicitudes',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'subbot-settings-test-'));
 const options={
  authDirectory:path.join(directory,'sessions'),
  settingsFile:path.join(directory,'data','subbots.json'),
  createCommandHandler:()=>({handleMessage:async()=>{}}),
  dispatchMessage:async()=>{},
  logger:{log(){},error(){}}
 };
 try {
  const manager=new SubbotManager(options);
  await manager.start();
  await manager.setCodeEnabled(false);
  const restored=new SubbotManager(options);
  await restored.start();
  assert.equal(restored.getStatus().codeEnabled,false);
  const replies=[];
  await restored.requestPairingCode({
   chatId:'123456789@s.whatsapp.net',
   userId:'123456789@s.whatsapp.net',
   reply:async text=>replies.push(text)
  });
  assert.match(replies[0],/desactivado/);
  await restored.setCodeEnabled(true);
  const reenabled=new SubbotManager(options);
  await reenabled.start();
  assert.equal(reenabled.getStatus().codeEnabled,true);
  await manager.shutdown();
  await restored.shutdown();
  await reenabled.shutdown();
 } finally {
  await rm(directory,{recursive:true,force:true});
 }
});
