import {createServer} from 'node:http';
// El endpoint solo indica que el proceso está activo, sin revelar información privada.
export function startHealthServer(port) {
  const server=createServer((req,res)=>{
    const ok=req.url==='/' || req.url==='/health';
    res.writeHead(ok?200:404,{'Content-Type':'text/plain'});
    res.end(ok?'Historia Reiss: proceso activo':'Not found');
  });
  server.listen(Number(port),'0.0.0.0');
  return server;
}
