import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleAdmin} from '../commands/admin.js';
// Trabaja en una carpeta temporal, nunca sobre los comandos reales.
test('edición directa, rechazo de sintaxis y restauración',async()=>{
 const cwd=process.cwd(), dir=await mkdtemp(join(tmpdir(),'historia-edit-'));
 try{
  process.chdir(dir);await mkdir('commands');await writeFile('package.json','{"type":"module"}');
  const original='export default [];',next='export default [{name:"demo",run(){}}];';
  await writeFile('commands/general.js',original);
  const id='584149164536@s.whatsapp.net';
  let response;
  const invoke=(command,code)=>handleAdmin({command,args:['general.js'],userId:id,chatId:id,reply:async t=>{response=t;},rawMessage:{key:{fromMe:true},message:{extendedTextMessage:{contextInfo:{quotedMessage:{conversation:code}}}}}});
  await invoke('setcode','export ???');assert.match(response,/inválida/);assert.equal(await readFile('commands/general.js','utf8'),original);
  await invoke('setcode',next);assert.equal(await readFile('commands/general.js','utf8'),next);
  await invoke('test',original);assert.equal(await readFile('commands/general.js','utf8'),next);
  await invoke('rollback');assert.equal(await readFile('commands/general.js','utf8'),original);
 }finally{process.chdir(cwd);await rm(dir,{recursive:true,force:true});}
});
