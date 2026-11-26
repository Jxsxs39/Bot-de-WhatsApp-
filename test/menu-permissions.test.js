import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdmin,visibleAdminNames,adminNames} from '../commands/admin.js';
import {commands} from '../commands/index.js';
test('menús según permisos',async()=>{
 assert.deepEqual(visibleAdminNames(0),[]);
 assert.ok(visibleAdminNames(90).includes('reload'));
 assert.ok(visibleAdminNames(90).includes('setcode'));
 assert.ok(visibleAdminNames(90).includes('rollback'));
 assert.ok(visibleAdminNames(90).includes('code'));
 assert.ok(!visibleAdminNames(90).includes('setowner'));
 assert.deepEqual(visibleAdminNames(100),[...adminNames]);
 let output;
 const id='584149164536@s.whatsapp.net';
 const ctx={commands,userId:id,chatId:id,replyWithImage:async(_url,caption)=>{output=caption;}};
 await commands.get('menu').run(ctx);
 assert.match(output,/\.chatgpt/);
 assert.doesNotMatch(output,/\.setcode|\.setowner|\.restart/);
 let adminOutput;
 await handleAdmin({command:'admin',reply:async text=>{adminOutput=text;}});
 assert.match(adminOutput,/\.setcode/);
 assert.match(adminOutput,/\.setowner — Solo owner principal/);
 assert.match(adminOutput,/\.code — Solicitar subbot; activar\/desactivar solo owners/);
});
test('solo los owners pueden pausar y reactivar solicitudes de subbot',async()=>{
 let enabled;
 const subbots={
  setCodeEnabled:async value=>{enabled=value;},
  getStatus:()=>({codeEnabled:enabled,connected:2,registered:2,pending:1})
 };
 const replies=[];
 const owner='584149164536@s.whatsapp.net';
 await handleAdmin({command:'code',args:['off'],userId:owner,subbots,reply:async text=>replies.push(text)});
 assert.equal(enabled,false);
 assert.match(replies[0],/desactivado/);
 await handleAdmin({command:'code',args:['status'],userId:owner,subbots,reply:async text=>replies.push(text)});
 assert.match(replies[1],/Subbots conectados: 2/);
 await handleAdmin({command:'code',args:['on'],userId:owner,subbots,reply:async text=>replies.push(text)});
 assert.equal(enabled,true);

 let denied;
 await handleAdmin({command:'code',args:['on'],userId:'999999999@s.whatsapp.net',subbots,reply:async text=>{denied=text;}});
 assert.equal(enabled,true);
 assert.match(denied,/Acceso administrativo denegado/);
});
