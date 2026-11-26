import {rm} from 'node:fs/promises';
import {isAbsolute,parse,relative,resolve,sep} from 'node:path';

export async function clearWhatsAppAuthState(directory) {
 const target=resolve(directory);
 const workingDirectory=resolve(process.cwd());
 const workingDirectoryFromTarget=relative(target,workingDirectory);
 const containsWorkingDirectory=workingDirectoryFromTarget===''||
  (!isAbsolute(workingDirectoryFromTarget)&&workingDirectoryFromTarget!=='..'&&!workingDirectoryFromTarget.startsWith('..'+sep));
 if(target===parse(target).root || containsWorkingDirectory) {
  throw new Error('El directorio de sesión no es seguro para borrar');
 }
 await rm(target,{recursive:true,force:true});
}
