'use strict';
const ENDPOINT='https://api.puter.com/puterai/openai/v1/chat/completions';
const PINNED_COMMIT='922d203e18e1946c83dca2fe3b179010fde0480c';
class PuterAdapter{
 constructor({token=process.env.PUTER_AUTH_TOKEN||''}={}){this.token=String(token||'').trim();}
 status(){return{state:this.token?'CONFIGURED':'UNAVAILABLE',provider:'puter',endpoint:ENDPOINT,pinnedUpstream:{repo:'HeyPuter/puter',commit:PINNED_COMMIT,license:'AGPL-3.0-only'},executable:!!this.token,authority:'WITFORGE_GOVERNED'};}
 async chat({model,messages,max_tokens=512,temperature=0.7}={}){if(!this.token)return{state:'UNAVAILABLE',message:'PUTER_AUTH_TOKEN is not configured.',provider:'puter'};if(!model||!Array.isArray(messages)||!messages.length)return{state:'DENIED',message:'model and non-empty messages are required.',provider:'puter'};try{const r=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+this.token},body:JSON.stringify({model,messages,max_tokens,temperature,stream:false}),signal:AbortSignal.timeout(60000)});const body=await r.json().catch(()=>({}));if(!r.ok)return{state:'FAILURE',provider:'puter',httpStatus:r.status,message:body?.error?.message||`Puter HTTP ${r.status}`};return{state:'SUCCESS',provider:'puter',model:body.model||model,text:body.choices?.[0]?.message?.content??'',usage:body.usage||null,rawId:body.id||null};}catch(e){return{state:'ERROR',provider:'puter',message:String(e.message||e)};}}
}
module.exports={PuterAdapter,PUTER_ENDPOINT:ENDPOINT,PUTER_PINNED_COMMIT:PINNED_COMMIT};