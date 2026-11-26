import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
const run=promisify(execFile);
const files=new Set(['general.js','economy.js','stickers.js']);
const pending=new Map();
// Solo cuentas autorizadas explícitamente, en privado. Nunca se confía en el destinatario de un mensaje propio.
export function isAdmin(ctx) {
  return !ctx.rawMessage?.key?.fromMe && !ctx.chatId.endsWith('@g.us') &&
    (process.env.BOT_OWNER_JIDS || '').split(',').map(x=>x.trim()).includes(ctx.userId);
}
export const adminNames=new Set(['getcode','setcode','savefile','test','update','restart','reload','logs']);
export async function handleAdmin(ctx) {
  if(!isAdmin(ctx)) return ctx.reply('Acceso administrativo denegado.');
  const [file,token]=ctx.args;
  const cmd=ctx.command;
  if(cmd==='getcode' || cmd==='setcode' || cmd==='savefile' || cmd==='test'){
    if(!files.has(file)) return ctx.reply('Archivos permitidos: '+[...files].join(', '));
    if(cmd==='getcode'){
      const source=await readFile('commands/'+file,'utf8');
      for(let i=0;i<source.length;i+=3000) await ctx.reply('commands/'+file+'\n'+source.slice(i,i+3000));
      return;
    }
    if(cmd==='test'){
      try {await run(process.execPath,['--check','.admin-stage/'+file],{timeout:10000});return ctx.reply('Sintaxis válida. No se ejecutó ni publicó el código.');}
      catch{return ctx.reply('La prueba de sintaxis falló o no existe el borrador.');}
    }
    // El código se toma de un mensaje citado y se guarda fuera de los módulos activos.
    const source=ctx.rawMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const code=source?.conversation || source?.extendedTextMessage?.text;
    if(!code || Buffer.byteLength(code)>65536) return ctx.reply('Responde a un mensaje de código de hasta 64 KiB.');
    await mkdir('.admin-stage',{recursive:true,mode:0o700});
    await writeFile('.admin-stage/'+file,code,{mode:0o600});
    return ctx.reply('Borrador guardado. Usa .test '+file+'. No se ha publicado.');
  }
  if(cmd==='logs') return ctx.reply('Consulta los registros privados en Render. No se exponen credenciales por WhatsApp.');
  if(cmd==='reload') return ctx.reply('Usa .restart para recargar el proceso completo.');
  const key=ctx.userId+':'+cmd;
  const entry=pending.get(key);
  if(!entry || entry.token!==file || entry.until<Date.now()){
    const value=randomBytes(4).toString('hex');
    pending.set(key,{token:value,until:Date.now()+60000});
    return ctx.reply('Confirma en 60 segundos: .'+cmd+' '+value);
  }
  pending.delete(key);
  if(cmd==='update'){
    const hook=process.env.RENDER_DEPLOY_HOOK;
    if(!hook) return ctx.reply('Configura RENDER_DEPLOY_HOOK en Render.');
    const url=new URL(hook);
    if(url.protocol!=='https:' || url.hostname!=='api.render.com' || !url.pathname.startsWith('/deploy/')) return ctx.reply('Hook no válido.');
    const result=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000)});
    return ctx.reply(result.ok?'Despliegue solicitado. Revisa Render.':'Render rechazó la solicitud.');
  }
  await ctx.reply('Reinicio solicitado. Render debe supervisar el proceso.');
  setTimeout(()=>process.kill(process.pid,'SIGTERM'),500).unref();
}
