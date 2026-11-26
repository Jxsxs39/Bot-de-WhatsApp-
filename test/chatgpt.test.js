import test from 'node:test';
import assert from 'node:assert/strict';
import chatgptCommands, {requestHistoriaAI} from '../commands/chatgpt.js';

test('.chatgpt consulta la API con la personalidad de Historia', async()=>{
 let request;
 const prompt='¿Cómo puedo ayudar a una amiga?';
 const answer=await requestHistoriaAI(prompt,{
  apiKey:'test-api-key',
  model:'test-model',
  fetchImpl:async(url,options)=>{
   request={url,options};
   return {ok:true,status:200,json:async()=>({choices:[{message:{content:'  Cuenta conmigo.  '}}]})};
  }
 });
 assert.equal(answer,'Cuenta conmigo.');
 assert.equal(request.url,'https://api.openai.com/v1/chat/completions');
 assert.equal(request.options.headers.authorization,'Bearer test-api-key');
 const body=JSON.parse(request.options.body);
 assert.equal(body.model,'test-model');
 assert.equal(body.messages[1].content,prompt);
 assert.match(body.messages[0].content,/Historia Reiss/);
});

test('.chatgpt reporta cuando falta la clave de API', async()=>{
 await assert.rejects(
  requestHistoriaAI('Hola',{apiKey:'',fetchImpl:async()=>assert.fail('No debe llamar a la API')}),
  error=>error.code==='NO_API_KEY' && /OPENAI_API_KEY/.test(error.userMessage)
 );
});

test('.chatgpt pide una pregunta si no se proporciona texto', async()=>{
 let response;
 await chatgptCommands[0].run({
  args:[],
  reply:async text=>{response=text;}
 });
 assert.match(response,/Escribe tu pregunta/);
});
