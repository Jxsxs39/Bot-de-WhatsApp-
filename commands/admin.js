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
// Ambos identificadores pertenecen al mismo propietario principal.
const primaryLid='10707890389140@lid';
const isPrimary=id=>id===primary() || id===primaryLid;
const ownerFile=()=>process.env.BOT_OWNERS_FILE || 'data/owners.json';
async function owners(){
  try {const list=JSON.parse(await readFile(ownerFile(),'utf8'));if(!Array.isArray(list)) throw new Error('Formato de owners inválido');return list;}
  catch(e){if(e.code==='ENOENT') return [];throw e;}
}
function authenticatedSender(ctx){
  return /^\d+@(s\.whatsapp\.net|lid)$/.test(ctx.userId);
}
export async function ownerPriority(ctx){
  // Los permisos dependen del remitente autenticado, no del tipo de chat.
  if(!authenticatedSender(ctx)) return 0;
  if(isPrimary(ctx.userId)) return 100;
  return (await owners()).includes(ctx.userId) ? 90 : 0;
}
export async function isAdmin(ctx){return (await ownerPriority(ctx))>=90;}
export const adminNames=new Set(['getcode','setcode','savefile','test','update','restart','reload','logs','setowner','delowner','owners','admin','rollback']);
// Una sola política controla el menú y la ejecución administrativa.
const primaryOnly=new Set(['setowner','delowner']);
export function visibleAdminNames(priority){return [...adminNames].filter(name=>priority>=90 && (priority>=100 || !primaryOnly.has(name)));}
export function adminMenuLines(){return [...adminNames].map(n=>'• .'+n+' — '+(n==='admin'?'Todos':primaryOnly.has(n)?'Solo owner principal':'Solo owners'));}
export async function handleAdmin(ctx) {
  if(ctx.command==='admin') return ctx.reply('👑 *Administración*\n\n'+adminMenuLines().join('\n'));
  const priority=await ownerPriority(ctx);
  if(priority<90) return ctx.reply('Acceso administrativo denegado.');
  if(primaryOnly.has(ctx.command) && priority<100) return ctx.reply('Solo el propietario principal puede ejecutar este comando.');
  const [file,token]=ctx.args;
  const cmd=ctx.command;
  audit('administración: '+cmd);
  if(cmd==='owners') return ctx.reply('Principal: '+primary().split('@')[0]+' (100)\n'+(await owners()).map(x=>x.split('@')[0]+' (90)').join('\n'));
  if(cmd==='setowner' || cmd==='delowner'){
    if(!isPrimary(ctx.userId)) return ctx.reply('Solo el propietario principal puede administrar owners.');
    // Usa las menciones reales de WhatsApp o el autor del mensaje citado.
    const info=Object.values(ctx.rawMessage?.message || {}).find(x=>x?.contextInfo)?.contextInfo;
    const mentions=info?.mentionedJid || [];
    if(mentions.length>1) return ctx.reply('Menciona solo a un usuario.');
    const number=ctx.args.join('').replace(/^\+/,'').replace(/-/g,'');
    let jid=mentions[0] || (info?.quotedMessage && info.participant) || (/^\d{8,15}$/.test(number)?number+'@s.whatsapp.net':null);
    jid=typeof jid==='string'?jid.replace(/:\d+@/,'@'):null;
    if(!jid || !/^\d+@(s\.whatsapp\.net|lid)$/.test(jid)) return ctx.reply('Menciona a un usuario, responde a su mensaje o indica su número internacional.');
    const ids=new Set([jid]);
    try {
      const map=ctx.sock?.signalRepository?.lidMapping;
      const other=jid.endsWith('@lid')?await map?.getPNForLID(jid):await map?.getLIDForPN(jid);
      if(typeof other==='string' && /^\d+@(s\.whatsapp\.net|lid)$/.test(other)) ids.add(other);
    } catch {}
    if([...ids].some(isPrimary)) return ctx.reply('El propietario principal no se puede modificar.');
    const list=new Set(await owners());
    for(const id of ids) {if(cmd==='setowner') list.add(id); else list.delete(id);}
    const path=ownerFile();
    await mkdir((await import('node:path')).dirname(path),{recursive:true,mode:0o700});
    await writeFile(path+'.tmp',JSON.stringify([...list]),{mode:0o600});
    await rename(path+'.tmp',path);
    return ctx.reply(cmd==='setowner'?'Owner agregado.':'Owner eliminado.');
  }
  if(cmd==='getcode' || cmd==='setcode' || cmd==='savefile' || cmd==='test' || cmd==='rollback'){
    const aliases={menu:'general.js',historia:'general.js',dato:'general.js',perfil:'general.js',stats:'general.js',work:'economy.js',daily:'economy.js',sticker:'stickers.js'};
    const target=aliases[file] || file;
    if(!files.has(target)) return ctx.reply('Archivos permitidos: '+[...files].join(', '));
    if(cmd==='getcode'){
      const source=await readFile('commands/'+target,'utf8');
      for(let i=0;i<source.length;i+=3000) await ctx.reply('commands/'+target+'\n'+source.slice(i,i+3000));
      return;
    }
    if(cmd==='rollback'){
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
    const candidate='.admin-stage/'+target;
    await writeFile(candidate,code,{mode:0o600});
    try {await run(process.execPath,['--check',candidate],{timeout:10000});}
    catch{return ctx.reply('Sintaxis inválida. El archivo activo no cambió.');}
    if(cmd==='test') return ctx.reply('Sintaxis válida. No se ejecutó el código.');
    // Todos los owners autorizados pueden instalar código ejecutable.
    const path='commands/'+target;
    await writeFile(candidate+'.backup',await readFile(path),{mode:0o600});
    await writeFile(path+'.tmp',code,{mode:0o600});
    await rename(path+'.tmp',path);
    return ctx.reply('Archivo activo actualizado: '+path+'. Usa .reload para cargarlo. Respaldo disponible con .rollback '+target+'.');
  }
  if(cmd==='logs') return ctx.reply(readAudit().join('\n') || 'Sin eventos registrados.');
  if(cmd==='reload'){await reloadCommands();return ctx.reply('Comandos recargados: '+commands.size);}
  const key=(isPrimary(ctx.userId)?primary():ctx.userId)+':'+ctx.chatId+':'+cmd;
  const entry=pending.get(key);
  if(!entry || entry.token!==file || entry.until<Date.now()){
    const value=randomBytes(4).toString('hex');
    pending.set(key,{token:value,until:Date.now()+60000});
    return ctx.reply('Confirma en 60 segundos: .'+cmd+' '+value);
  }
  pending.delete(key);
  if(cmd==='update'){
    const hook=process.env.RENDER_DEPLOY_HOOK;
    if(!hook) return ctx.reply('El servicio de actualización no está configurado.');
    const url=new URL(hook);
    if(url.protocol!=='https:' || url.hostname!=='api.render.com' || !url.pathname.startsWith('/deploy/')) return ctx.reply('Hook no válido.');
    const result=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000)});
    return ctx.reply(result.ok?'Actualización solicitada.':'No se pudo solicitar la actualización.');
  }
  await ctx.reply('Reinicio solicitado.');
  setTimeout(()=>process.kill(process.pid,'SIGTERM'),500).unref();
}
