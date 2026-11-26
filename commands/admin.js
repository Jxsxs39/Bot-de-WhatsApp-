import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {commands,reloadCommands} from './index.js';
import {audit,readAudit} from '../admin-audit.js';
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
export const adminNames=new Set(['getcode','setcode','savefile','test','update','restart','reload','logs','setowner','delowner','owners','admin','rollback']);
export async function handleAdmin(ctx) {
  if(!await isAdmin(ctx)) return ctx.reply('Acceso administrativo denegado.');
  const [file,token]=ctx.args;
  const cmd=ctx.command;
  audit('administración: '+cmd);
  if(cmd==='admin') return ctx.reply([...adminNames].map(n=>'.'+n).join('\n'));
  if(cmd==='owners') return ctx.reply('Principal: '+primary().split('@')[0]+' (100)\n'+(await owners()).map(x=>x.split('@')[0]+' (90)').join('\n'));
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
  if(cmd==='getcode' || cmd==='setcode' || cmd==='savefile' || cmd==='test' || cmd==='rollback'){
    const aliases={hola:'general.js',menu:'general.js',historia:'general.js',dato:'general.js',perfil:'general.js',stats:'general.js',work:'economy.js',daily:'economy.js',sticker:'stickers.js'};
    const target=aliases[file] || file;
    if(!files.has(target)) return ctx.reply('Archivos permitidos: '+[...files].join(', '));
    if(cmd==='getcode'){
      const source=await readFile('commands/'+target,'utf8');
      for(let i=0;i<source.length;i+=3000) await ctx.reply('commands/'+target+'\n'+source.slice(i,i+3000));
      return;
    }
    if(cmd==='rollback'){
      if(ctx.userId!==primary()) return ctx.reply('Solo el owner principal puede restaurar código.');
      const previous=await readFile('.admin-stage/'+target+'.backup','utf8');
      await writeFile('commands/'+target+'.tmp',previous,{mode:0o600});
      await rename('commands/'+target+'.tmp','commands/'+target);
      return ctx.reply('Archivo restaurado. Reinicia o recarga para aplicarlo.');
    }
    // El código citado se valida antes de reemplazar el archivo activo.
    const source=ctx.rawMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const code=source?.conversation || source?.extendedTextMessage?.text;
    if(!code || Buffer.byteLength(code)>65536) return ctx.reply('Responde a un mensaje de código de hasta 64 KiB.');
    await mkdir('.admin-stage',{recursive:true,mode:0o700});
    if(cmd!=='test' && ctx.userId!==primary()) return ctx.reply('Solo el owner principal puede modificar código activo.');
    const candidate='.admin-stage/'+target;
    await writeFile(candidate,code,{mode:0o600});
    try {await run(process.execPath,['--check',candidate],{timeout:10000});}
    catch{return ctx.reply('Sintaxis inválida. El archivo activo no cambió.');}
    if(cmd==='test') return ctx.reply('Sintaxis válida. No se ejecutó el código.');
    // Solo el propietario principal puede instalar código ejecutable.
    if(ctx.userId!==primary()) return ctx.reply('Solo el owner principal puede modificar código activo.');
    const path='commands/'+target;
    await writeFile(candidate+'.backup',await readFile(path),{mode:0o600});
    await writeFile(path+'.tmp',code,{mode:0o600});
    await rename(path+'.tmp',path);
    return ctx.reply('Archivo activo actualizado: '+path+'. Usa .reload para cargarlo. Respaldo disponible con .rollback '+target+'.');
  }
  if(cmd==='logs') return ctx.reply(readAudit().join('\n') || 'Sin eventos registrados.');
  if(cmd==='reload'){await reloadCommands();return ctx.reply('Comandos recargados: '+commands.size);}
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
