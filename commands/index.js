import general from './general.js';
import economy from './economy.js';
import stickers from './stickers.js';
import chatgpt from './chatgpt.js';
// Para agregar comandos, importa su archivo y añádelo a esta lista.
export const commands = new Map([...general, ...economy, ...stickers, ...chatgpt].map(cmd => [cmd.name, cmd]));

// Carga primero todos los módulos y valida antes de sustituir el registro activo.
let generation=0;
export async function reloadCommands(){
 const modules=await Promise.all(['general','economy','stickers','chatgpt'].map(name=>import('./'+name+'.js?reload='+(++generation))));
 const next=new Map();
 for(const module of modules) for(const cmd of module.default){
  if(typeof cmd.name!=='string'||typeof cmd.run!=='function'||next.has(cmd.name)) throw new Error('Registro inválido');
  next.set(cmd.name,cmd);
 }
 commands.clear();for(const [name,cmd] of next) commands.set(name,cmd);
}
