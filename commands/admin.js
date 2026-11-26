import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
const run=promisify(execFile);
const files=new Set(['general.js','economy.js','stickers.js']);
const pending=new Map();
// El propietario principal fijo tiene prioridad 100 y no puede eliminarse por chat.
const primary=()=> '584149164536@s.whatsapp.net';
const ownerFile=()=>process.env.BOT_OWNERS_FILE || 'data/owners.json';
async function owners(){
  try {const list=JSON.parse(await readFile(ownerFile(),'utf8'));if(!Array.isArray(list)) throw new Error('Formato de owners inválido');return list;}
  catch(e){if(e.code==='ENOENT') return [];throw e;}
}
function privateSender(ctx){
  return !ctx.chatId.endsWith('@g.us') && (!ctx.rawMessage?.key?.fromMe || ctx.chatId===ctx.userId) && /^\d+@s\.whatsapp\.net$/.test(ctx.userId);
}
export async function ownerPriority(ctx){
  if(!privateSender(ctx)) return 0;
  if(ctx.userId===primary()) return 100;
  return (await owners()).includes(ctx.userId) ? 90 : 0;
}
export async function isAdmin(ctx){return (await ownerPriority(ctx))>=90;}
export const adminNames=new Set(['getcode','setcode','savefile','test','update','restart','reload','logs','setowner','delowner']);
export async function handleAdmin(ctx) {
  if(!await isAdmin(ctx)) return ctx.reply('Acceso administrativo denegado.');
  const [file,token]=ctx.args;
  const cmd=ctx.command;
  if(cmd==='setowner' || cmd==='delowner'){
    if(ctx.userId!==primary()) return ctx.reply('Solo el propietario principal puede administrar owners.');
    const number=ctx.args.join('').replace(/^\+/,'').replace(/-/g,'');
    if(!/^\d{8,15}$/.test(number)) return ctx.reply('Indica el número internacional.');
    const jid=number+'@s.whatsapp.net';
    if(jid===primary()) return ctx.reply('El propietario principal no se puede modificar.');
    const list=new Set(await owners());
    if(cmd==='setowner') list.add(jid); else list.delete(jid);
    const path=ownerFile();
    await mkdir((await import('node:path')).dirname(path),{recursive:true,mode:0o700});
    await writeFile(path+'.tmp',JSON.stringify([...list]),{mode:0o600});
    await rename(path+'.tmp',path);
    return ctx.reply(cmd==='setowner'?'Owner agregado.':'Owner eliminado.');
  }
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
