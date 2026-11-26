import makeWASocket, {useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion} from '@whiskeysockets/baileys';
import {startHealthServer} from './health.js';
import pino from 'pino';
import {createInterface} from 'node:readline/promises';
import Database from './database.js';
import {createCommandHandler} from './handler.js';

// Una base de datos para toda la vida del proceso, no una por reconexión.
// Permisos privados para los archivos nuevos de sesión y base de datos.
process.umask(0o077);
const db=new Database();
let socket, retry, stopping=false, attempts=0, queue=Promise.resolve(), rl;
// Render y otros servidores sin terminal pueden proporcionar el número por variable de entorno.
// Render Web Service exige un puerto HTTP. No expone datos ni credenciales del bot.
const healthServer=process.env.PORT ? startHealthServer(process.env.PORT) : undefined;
let phone=process.env.WHATSAPP_PHONE?.replace(/\D/g,'');
// Crea el socket y recupera la sesión existente; no pide otro código si ya está registrada.
async function connect() {
  if(stopping) return;
  const {state,saveCreds}=await useMultiFileAuthState(process.env.WHATSAPP_SESSION_DIR || 'sesion_historia');
  if(!state.creds.registered && !phone) {
    if (!process.stdin.isTTY) throw new Error('Configura WHATSAPP_PHONE en las variables de entorno del servidor');
    rl=createInterface({input:process.stdin,output:process.stdout});
    try { phone=(await rl.question('Número internacional sin +: ')).replace(/\D/g,''); }
    finally { rl.close(); rl=null; }
  }
  if(!state.creds.registered && !/^\d{8,15}$/.test(phone || '')) throw new Error('Número internacional inválido');
  const {version}=await fetchLatestBaileysVersion();
  if(stopping) return;
  const sock=makeWASocket({version,auth:state,logger:pino({level:'silent'}),browser:['Ubuntu','Chrome','22.04']});
  socket=sock;
  const handler=createCommandHandler(sock,db);
  let pairingRequested=false;
  // Espera la señal QR de Baileys: indica que el servidor está listo para vincular.
  const requestCode=async()=>{
    if(pairingRequested || state.creds.registered || stopping || socket!==sock) return;
    pairingRequested=true;
    try {
      const code=await sock.requestPairingCode(phone);
      if(socket===sock && !stopping) console.log('Código de vinculación:',code);
    } catch(err) {
      console.error('Solicitud de vinculación fallida; estado:',err?.output?.statusCode ?? err?.name ?? 'desconocido');
      if(socket===sock && !stopping) sock.end(undefined);
    }
  };
  // La cola evita escrituras y procesamiento simultáneos fuera de orden.
  const onCreds=()=>{queue=queue.then(saveCreds).catch(()=>console.error('No se pudo guardar la sesión'));};
  const onMessages=({messages,type})=>{
    if(type!=='notify'||stopping||socket!==sock) return;
    queue=queue.then(async()=>{for(const msg of messages) await handler.handleMessage(msg);}).catch(()=>console.error('Error procesando mensajes'));
  };
  // Retira los listeners del socket anterior para evitar respuestas duplicadas.
  const cleanup=()=>{
    sock.ev.off('creds.update',onCreds);
    sock.ev.off('messages.upsert',onMessages);
    sock.ev.off('connection.update',onConnection);
  };
  // Distingue desconexiones recuperables de una sesión revocada.
  const onConnection=({connection,lastDisconnect,qr})=>{
    if(socket!==sock||stopping) return;
    if(qr && !state.creds.registered) void requestCode();
    if(connection==='open'){attempts=0;console.log('Historia Reiss conectada. Prefijo +');}
    if(connection==='close'){
      cleanup();socket=null;
      const code=lastDisconnect?.error?.output?.statusCode;
      console.log('Conexión cerrada; estado:',code ?? 'desconocido');
      if(code===DisconnectReason.loggedOut || code===DisconnectReason.connectionReplaced){
        console.error('Sesión cerrada o reemplazada. Revisa dispositivos vinculados.');void shutdown();return;
      }
      schedule();
    }
  };
  sock.ev.on('creds.update',onCreds);
  sock.ev.on('messages.upsert',onMessages);
  sock.ev.on('connection.update',onConnection);
  // El código se solicita desde connection.update, no mediante un tiempo fijo.
}
// Espera creciente para evitar reconectar sin parar.
function schedule(){
  if(stopping||retry) return;
  retry=setTimeout(()=>{retry=null;void queue.then(connect).catch(err=>{console.error('Error de conexión:',err.name);schedule();});},Math.min(60000,2000*2**Math.min(attempts++,5)));
}
// Cierre ordenado: cancela temporizadores, espera mensajes y cierra SQLite.
async function shutdown(){
  if(stopping)return;stopping=true;clearTimeout(retry);rl?.close();
  socket?.end(undefined);healthServer?.close();await queue;await db.close();
}
process.on('SIGINT',()=>void shutdown());
process.on('SIGTERM',()=>void shutdown());
try {await db.init();await connect();}
catch(err){console.error('No se pudo iniciar:',err.message);process.exitCode=1;await shutdown();}
