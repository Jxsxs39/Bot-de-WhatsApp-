import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createProcessSupervisor} from '../process-supervisor.js';

test('reinicia el proceso del bot cada 30 minutos y lo vuelve a iniciar',async()=>{
 const children=[];
 const timers=[];
 const logs=[];
 const supervisor=createProcessSupervisor({
  runtimePath:'runtime.js',
  spawnProcess:(...args)=>{
   const child=new EventEmitter();
   child.killSignal=undefined;
   child.kill=signal=>{child.killSignal=signal;};
   children.push({child,args});
   queueMicrotask(()=>child.emit('spawn'));
   return child;
  },
  setTimer:(callback,delay)=>{const timer={callback,delay,cleared:false};timers.push(timer);return timer;},
  clearTimer:timer=>{if(timer) timer.cleared=true;},
  logger:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args)}
 });
 const runTimer=timer=>{
  assert.equal(timer.cleared,false);
  timer.callback();
 };

 supervisor.start();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(children.length,1);
 assert.equal(children[0].args[1][0],'runtime.js');
 const scheduledRestart=timers.find(timer=>timer.delay===30*60*1000);
 assert.ok(scheduledRestart);
 runTimer(scheduledRestart);
 assert.equal(children[0].child.killSignal,'SIGTERM');
 children[0].child.emit('close',0,'SIGTERM');

 const retry=timers.find(timer=>timer.delay===5_000&&!timer.cleared);
 assert.ok(retry);
 runTimer(retry);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(children.length,2);
 supervisor.stop();
 assert.equal(children[1].child.killSignal,'SIGTERM');
 children[1].child.emit('close',0,'SIGTERM');
 assert.equal(timers.some(timer=>timer.delay===5_000&&!timer.cleared),false);
 assert.ok(logs.some(args=>String(args[0]).includes('Reinicio programado')));
});
