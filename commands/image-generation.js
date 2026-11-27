const API_BASE='https://aihorde.net/api/v2';
const ANONYMOUS_API_KEY='0000000000';
const CLIENT_AGENT='Bot-de-WhatsApp:1.0';
const PROMPT_LIMIT=500;
const MAX_WAIT_MS=5*60*1000;
const POLL_INTERVAL_MS=5000;
const USER_COOLDOWN_MS=60*1000;
const MAX_ACTIVE_GENERATIONS=2;
const activeUsers=new Set();
const lastGenerationAt=new Map();

const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

export function buildImagePrompt(userPrompt) {
 const concept=userPrompt
  .replace(/###/g,' ')
  .replace(/\btralal(?:elo|ero)(?:\s+tralala)?\b/gi,'Tralalero Tralala, the surreal Italian brainrot meme character: a bright blue cartoon shark with three human legs wearing colorful sneakers, no logos');
 return `${concept}, one clear recognizable main subject, centered full-body composition, coherent anatomy, polished detailed digital illustration, vivid balanced colors, crisp sharp focus, high quality ### blurry, low resolution, distorted anatomy, extra limbs, duplicate subjects, text, watermark`;
}

async function apiRequest(path,options={},fetchImpl) {
 const fetcher=fetchImpl||globalThis.fetch;
 const response=await fetcher(API_BASE+path,{
  ...options,
  headers:{
   apikey:ANONYMOUS_API_KEY,
   'Client-Agent':CLIENT_AGENT,
   ...(options.headers||{})
  },
  signal:AbortSignal.timeout(15_000)
 });
 if(response.status===429) throw Object.assign(new Error('QUEUE_LIMIT'),{code:'QUEUE_LIMIT'});
 if(response.status===503) throw Object.assign(new Error('MAINTENANCE'),{code:'MAINTENANCE'});
 if(!response.ok) throw Object.assign(new Error('API_ERROR'),{code:'API_ERROR',status:response.status});
 return response.json();
}

export async function generateImage(prompt,{fetchImpl,sleep=delay,now=Date.now,maxWaitMs=MAX_WAIT_MS}={}) {
 const submission=await apiRequest('/generate/async',{
  method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({
   prompt:buildImagePrompt(prompt),
   params:{n:1,steps:30,width:768,height:768,sampler_name:'k_dpmpp_2m',scheduler:'karras',cfg_scale:6.5},
   models:['AlbedoBase XL 3.1','Juggernaut XL'],
   nsfw:false,
   censor_nsfw:true,
   replacement_filter:true,
   shared:true,
   r2:false
  })
 },fetchImpl);
 if(typeof submission.id!=='string'||!submission.id) {
  throw Object.assign(new Error('INVALID_RESPONSE'),{code:'INVALID_RESPONSE'});
 }

 const requestId=encodeURIComponent(submission.id);
 const deadline=now()+maxWaitMs;
 while(now()<deadline) {
  await sleep(POLL_INTERVAL_MS);
  const check=await apiRequest(`/generate/check/${requestId}`,{},fetchImpl);
  if(check.faulted) throw Object.assign(new Error('GENERATION_FAILED'),{code:'GENERATION_FAILED'});
  if(!check.done) continue;

  const result=await apiRequest(`/generate/status/${requestId}`,{},fetchImpl);
  const generation=result.generations?.[0];
  if(generation?.censored) throw Object.assign(new Error('CENSORED'),{code:'CENSORED'});
  if(typeof generation?.img!=='string'||!generation.img) {
   throw Object.assign(new Error('NO_IMAGE'),{code:'NO_IMAGE'});
  }
  const base64=generation.img.replace(/^data:image\/webp;base64,/i,'');
  const image=Buffer.from(base64,'base64');
  if(!image.length||image.length>8*1024*1024) {
   throw Object.assign(new Error('INVALID_IMAGE'),{code:'INVALID_IMAGE'});
  }
  return image;
 }
 throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'});
}

function errorMessage(error) {
 if(error?.code==='QUEUE_LIMIT') return 'La cola gratuita está muy ocupada. Prueba de nuevo más tarde.';
 if(error?.code==='MAINTENANCE') return 'El servicio gratuito está en mantenimiento. Inténtalo más tarde.';
 if(error?.code==='CENSORED') return 'El servicio bloqueó esa solicitud. Prueba con otra descripción.';
 if(error?.code==='TIMEOUT') return 'La cola está tardando demasiado; no se pudo terminar la imagen esta vez.';
 return 'No se pudo generar la imagen ahora. Prueba de nuevo más tarde.';
}

export function createImageGenerationCommand(options={}) {
 return {
  name:'img',
  async run({reply,replyWithImage,args,userId}) {
   const prompt=args.join(' ').trim();
   if(!prompt) return reply('Uso: .img <descripción de la imagen>. La generación es gratis, pero puede tardar según la cola.');
   if(prompt.length>PROMPT_LIMIT) return reply(`La descripción no puede superar los ${PROMPT_LIMIT} caracteres.`);
   if(activeUsers.has(userId)) return reply('Ya tienes una imagen en proceso. Espera a que termine.');
   if(activeUsers.size>=MAX_ACTIVE_GENERATIONS) return reply('Hay varias imágenes generándose. Prueba de nuevo en un momento.');
   const remaining=USER_COOLDOWN_MS-(Date.now()-(lastGenerationAt.get(userId)||0));
   if(remaining>0) return reply(`Espera ${Math.ceil(remaining/1000)} segundos antes de pedir otra imagen.`);

   activeUsers.add(userId);
   try {
    await reply('🎨 Solicitud enviada a un modelo XL de AI Horde. Puede tardar unos minutos; no envíes información privada porque las solicitudes pueden compartirse.');
   } catch(error) {
    activeUsers.delete(userId);
    throw error;
   }

   void generateImage(prompt,options)
    .then(async image=>{
     try {
      await replyWithImage(image);
     } catch(error) {
      console.error('[IMG] No se pudo enviar la imagen:',error?.code||error?.name||'Error');
      await reply('La imagen se generó, pero no se pudo enviar. Inténtalo más tarde.').catch(replyError=>{
       console.error('[IMG] No se pudo enviar el aviso:',replyError?.code||replyError?.name||'Error');
      });
     }
    })
    .catch(async error=>{
     console.error('[IMG] No se pudo generar la imagen:',error?.code||error?.name||'Error');
     await reply(errorMessage(error)).catch(replyError=>{
      console.error('[IMG] No se pudo enviar el aviso:',replyError?.code||replyError?.name||'Error');
     });
    })
    .finally(()=>{
     activeUsers.delete(userId);
     lastGenerationAt.set(userId,Date.now());
    });
  }
 };
}

export default [createImageGenerationCommand()];
