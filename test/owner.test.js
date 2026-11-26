import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerPriority,handleAdmin} from '../commands/admin.js';
const id='584149164536@s.whatsapp.net';
test('owner principal conserva permisos en todos los chats',async()=>{
 const ctx={userId:id,chatId:id,rawMessage:{key:{fromMe:true}},args:['584149164536'],command:'delowner'};
 assert.equal(await ownerPriority(ctx),100);
 assert.equal(await ownerPriority({...ctx,chatId:'123@g.us'}),100);
 assert.equal(await ownerPriority({...ctx,chatId:'123@s.whatsapp.net'}),100);
 let reply;await handleAdmin({...ctx,reply:async text=>{reply=text;}});
 assert.match(reply,/no se puede modificar/);
});
