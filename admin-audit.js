// Registro acotado, exclusivamente eventos internos sin mensajes ni credenciales.
const events=[];
export function audit(event){events.push(new Date().toISOString()+' '+event);if(events.length>40)events.shift();}
export function readAudit(){return events.slice(-20);}
