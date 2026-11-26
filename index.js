import makeWASocket, {useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion} from '@whiskeysockets/baileys';
import pino from 'pino';
import {createInterface} from 'node:readline/promises';
import Database from './database.js';
import {createCommandHandler} from './handler.js';

// Una base de datos para toda la vida del proceso, no una por reconexión.
process.umask(0o077);
const db=new Database();
let socket, retry, pairingTimer, stopping=false, attempts=0, queue=Promise.resolve(), rl;
let phone;
async function connect() {
  if(stopping) return;
  const {state,saveCreds}=await useMultiFileAuthState('sesion_historia');
  if(!state.creds.registered && !phone) {
    rl=createInterface({input:process.stdin,output:process.stdout});
    try { phone=(await rl.question('Número internacional sin +: ')).replace(/\D/g,''); }
    finally { rl.close(); rl=null; }
    if(!/^\d{8,15}$/.test(phone)) throw new Error('Número inválido');
  }
  const {version}=await fetchLatestBaileysVersion();
  if(stopping) return;
  const sock=makeWASocket({version,auth:state,logger:pino({level:'silent'}),browser:['Ubuntu','Chrome','22.04']});
  socket=sock;
  const handler=createCommandHandler(sock,db);
  const onCreds=()=>{queue=queue.then(saveCreds).catch(()=>console.error('No se pudo guardar la sesión'));};
  const onMessages=({messages,type})=>{
    if(type!=='notify'||stopping||socket!==sock) return;
    queue=queue.then(async()=>{for(const msg of messages) await handler.handleMessage(msg);}).catch(()=>console.error('Error procesando mensajes'));
  };
  const cleanup=()=>{
    clearTimeout(pairingTimer);
    sock.ev.off('creds.update',onCreds);
    sock.ev.off('messages.upsert',onMessages);
    sock.ev.off('connection.update',onConnection);
  };
  const onConnection=({connection,lastDisconnect})=>{
    if(socket!==sock||stopping) return;
    if(connection==='open'){attempts=0;console.log('Historia Reiss conectada. Prefijo +');}
    if(connection==='close'){
      cleanup();socket=null;
      const code=lastDisconnect?.error?.output?.statusCode;
      if(code===DisconnectReason.loggedOut || code===DisconnectReason.connectionReplaced){
        console.error('Sesión cerrada o reemplazada. Revisa dispositivos vinculados.');void shutdown();return;
      }
      schedule();
    }
  };
  sock.ev.on('creds.update',onCreds);
  sock.ev.on('messages.upsert',onMessages);
  sock.ev.on('connection.update',onConnection);
  if(!state.creds.registered) pairingTimer=setTimeout(async()=>{
    if(stopping||socket!==sock) return;
    try {console.log('Código de vinculación:',await sock.requestPairingCode(phone));}
    catch {console.error('No se pudo vincular. Reinicia y comprueba el número.');void shutdown();}
  },3000);
}
// Espera creciente para evitar reconectar sin parar.
function schedule(){
  if(stopping||retry) return;
  retry=setTimeout(()=>{retry=null;void queue.then(connect).catch(err=>{console.error('Error de conexión:',err.name);schedule();});},Math.min(60000,2000*2**Math.min(attempts++,5)));
}
async function shutdown(){
  if(stopping)return;stopping=true;clearTimeout(retry);clearTimeout(pairingTimer);rl?.close();
  socket?.end(undefined);await queue;await db.close();
}
process.on('SIGINT',()=>void shutdown());
process.on('SIGTERM',()=>void shutdown());
try {await db.init();await connect();}
catch(err){console.error('No se pudo iniciar:',err.message);process.exitCode=1;await shutdown();}
