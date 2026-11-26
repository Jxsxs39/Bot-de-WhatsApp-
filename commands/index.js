import general from './general.js';
import economy from './economy.js';
// Para agregar comandos, importa su archivo y añádelo a esta lista.
export const commands = new Map([...general, ...economy].map(cmd => [cmd.name, cmd]));
