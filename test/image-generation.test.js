import test from 'node:test';
import assert from 'node:assert/strict';
import {buildImagePrompt,createImageGenerationCommand,generateImage} from '../commands/image-generation.js';

function jsonResponse(body,status=200) {
 return {ok:status>=200&&status<300,status,json:async()=>body};
}

test('.img submits a free community request and sends the generated image',async()=>{
 const expectedImage=Buffer.from('webp image bytes');
 const requests=[];
 const fetchImpl=async(url,options={})=>{
  const parsed=new URL(url);
  requests.push({url:parsed,options});
  if(parsed.pathname.endsWith('/generate/async')) {
   assert.equal(options.method,'POST');
   assert.equal(options.headers.apikey,'0000000000');
   const payload=JSON.parse(options.body);
   assert.match(payload.prompt,/un zorro con una bufanda roja/);
   assert.match(payload.prompt,/one clear recognizable main subject/);
   assert.match(payload.prompt,/### blurry, low resolution/);
   assert.equal(payload.shared,true);
   assert.equal(payload.nsfw,false);
   assert.equal(payload.censor_nsfw,true);
   assert.equal(payload.params.n,1);
   assert.equal(payload.params.steps,30);
   assert.equal(payload.params.width,768);
   assert.deepEqual(payload.models,['AlbedoBase XL 3.1','Juggernaut XL']);
   return jsonResponse({id:'job-123'});
  }
  if(parsed.pathname.endsWith('/generate/check/job-123')) return jsonResponse({done:true});
  if(parsed.pathname.endsWith('/generate/status/job-123')) {
   return jsonResponse({generations:[{img:expectedImage.toString('base64')}]});
  }
  throw new Error('Unexpected API endpoint');
 };
 let delivered;
 let resolveDelivered;
 const imageDelivered=new Promise(resolve=>{resolveDelivered=resolve;});
 const replies=[];
 const command=createImageGenerationCommand({fetchImpl,sleep:async()=>{}});
 await command.run({
  args:['un','zorro','con','una','bufanda','roja'],
  userId:'image-user-1',
  reply:async text=>replies.push(text),
  replyWithImage:async image=>{delivered=image;resolveDelivered();}
 });
 await imageDelivered;
 assert.equal(delivered.toString(),expectedImage.toString());
 assert.match(replies[0],/AI Horde/);
 assert.equal(requests.length,3);
});

test('.img expande el nombre de Tralalero Tralala para identificar el personaje',()=>{
 const prompt=buildImagePrompt('un tralalelo');
 assert.match(prompt,/Tralalero Tralala/);
 assert.match(prompt,/bright blue cartoon shark with three human legs/);
 assert.match(prompt,/colorful sneakers, no logos/);
});

test('.img valida descripciones y comunica límite del servicio',async()=>{
 const replies=[];
 const command=createImageGenerationCommand({fetchImpl:async()=>{throw new Error('No debe llamar al API');}});
 const ctx={userId:'image-user-2',reply:async text=>replies.push(text),args:[]};
 await command.run(ctx);
 await command.run({...ctx,args:['x'.repeat(501)]});
 assert.match(replies[0],/Uso: \.img/);
 assert.match(replies[1],/500 caracteres/);
});

test('AI Horde informa cuando la cola gratuita está llena',async()=>{
 await assert.rejects(
  generateImage('un paisaje',{
   fetchImpl:async()=>jsonResponse({message:'busy'},429)
  }),
  error=>error.code==='QUEUE_LIMIT'
 );
});
