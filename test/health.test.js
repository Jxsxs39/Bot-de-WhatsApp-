import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {startHealthServer} from '../health.js';
// Puerto efímero: prueba HTTP local sin solicitar códigos ni conectar a WhatsApp.
test('Render health responde sin exponer datos',async()=>{
 const server=startHealthServer(0);
 try {
  await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/health')).status,200);
  assert.equal((await fetch(url+'/private')).status,404);
 } finally { await new Promise(resolve=>server.close(resolve)); }
});
