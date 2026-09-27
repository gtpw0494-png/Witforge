const clean=x=>String(x??"").trim();
const routable=h=>["CONNECTED","CONFIGURED"].includes(h?.availability)&&h?.executable!==false;
const quality=e=>{
  if(!e||typeof e!=="object")return 0;
  const vals=["groundedness","toolAccuracy","answerQuality","reliability"].map(k=>Number(e[k])).filter(Number.isFinite);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
};
function candidateScore(c,r){
  let s=100;
  if(c.local)s+=r.privacy==="local-only"?50:15;
  if(c.offline)s+=r.offline?30:5;
  if((c.tasks||[]).includes(r.task))s+=30;
  if((c.modalities||["text"]).includes(r.modality||"text"))s+=20;
  if(c.contextTokens&&r.contextTokens&&c.contextTokens>=r.contextTokens)s+=10;
  if(r.maxLatencyMs&&c.latencyMs&&c.latencyMs>r.maxLatencyMs)s-=25;
  s+=quality(c.evaluation)*20;
  return s;
}
function satisfies(c,r){
  if(r.privacy==="local-only"&&!c.local)return false;
  if(r.offline&&!c.offline)return false;
  if(r.provider&&String(c.provider)!==String(r.provider))return false;
  if(r.model&&String(c.model||c.id)!==String(r.model)&&String(c.id)!==String(r.model))return false;
  if(r.task&&(c.tasks||[]).length&&!(c.tasks||[]).includes(r.task))return false;
  if(r.modality&&(c.modalities||[]).length&&!(c.modalities||[]).includes(r.modality))return false;
  if(r.contextTokens&&c.contextTokens&&c.contextTokens<r.contextTokens)return false;
  return true;
}
export class ModelRouter{
  constructor({candidates=[],audit=null}={}){this.candidates=[...candidates];this.audit=audit;}
  describe(){
    return {state:"SUCCESS",candidates:this.candidates.map(c=>({id:c.id,provider:c.provider,model:c.model||null,local:Boolean(c.local),offline:Boolean(c.offline),privacy:c.privacy||null,tasks:c.tasks||[],modalities:c.modalities||["text"],contextTokens:c.contextTokens||null,evaluation:c.evaluation||null}))};
  }
  async probe(){
    const out=[];
    for(const c of this.candidates){
      let h;try{h=await c.health();}catch(e){h={availability:"UNAVAILABLE",executable:false,reason:String(e.message||e)};}
      out.push({...h,id:c.id,provider:c.provider,model:c.model||null});
    }
    return out;
  }
  async route(requirements={}){
    const r={task:"chat",modality:"text",privacy:"local-only",offline:false,...requirements};
    const health=await this.probe(),ranked=[];
    for(const c of this.candidates){
      const h=health.find(x=>x.id===c.id)||{availability:"UNAVAILABLE",executable:false};
      if(!routable(h)||!satisfies(c,r))continue;
      ranked.push({candidate:c,health:h,score:candidateScore(c,r)});
    }
    ranked.sort((a,b)=>b.score-a.score);
    if(!ranked.length)return {state:"UNAVAILABLE",message:"No configured model satisfies the requested execution constraints.",requirements:r,candidates:health};
    return {state:"SUCCESS",requirements:r,selected:{id:ranked[0].candidate.id,provider:ranked[0].candidate.provider,model:ranked[0].candidate.model||null,score:ranked[0].score,health:ranked[0].health},alternatives:ranked.slice(1,4).map(x=>({id:x.candidate.id,provider:x.candidate.provider,model:x.candidate.model||null,score:x.score,health:x.health})),ranked};
  }
  async generate(requirements={},prompt="",options={}){
    const route=await this.route(requirements);
    if(route.state!=="SUCCESS")return route;
    const attempts=[];const {acceptResult=null,...generationOptions}=options||{};
    for(const item of route.ranked){
      let result;const started=Date.now();
      try{result=await item.candidate.generate({prompt:String(prompt),...generationOptions,requirements:route.requirements});}
      catch(e){result={state:"ERROR",message:String(e.message||e)};}
      const text=clean(result?.text||result?.message);
      const acceptsNonText=["image","embeddings","rerank"].includes(route.requirements.modality)||["image","embeddings","rerank"].includes(route.requirements.task);
      const toolProposal=Array.isArray(result?.toolCalls)&&result.toolCalls.length>0;
      const usable=result?.state==="SUCCESS"&&(acceptsNonText||text||toolProposal)&&(!acceptResult||toolProposal||acceptResult(text,result)!==false);
      const attempt={id:item.candidate.id,provider:item.candidate.provider,model:item.candidate.model||null,state:usable?"SUCCESS":(result?.state==="SUCCESS"?"REJECTED_OUTPUT":result?.state||"UNKNOWN"),latencyMs:Date.now()-started};
      attempts.push(attempt);
      if(usable){
        const routedText=text||(toolProposal?`Model proposed ${result.toolCalls.length} tool call(s); execution remains subject to UAI governance and authorization.`:"");
        const out={...result,state:"SUCCESS",text:routedText,route:{requirements:route.requirements,selected:{id:item.candidate.id,provider:item.candidate.provider,model:item.candidate.model||null,score:item.score},alternatives:route.alternatives,attempts}};
        this.audit?.append({type:"model.route.generate",selected:item.candidate.id,provider:item.candidate.provider,model:item.candidate.model||null,attempts,requirements:route.requirements});
        return out;
      }
    }
    this.audit?.append({type:"model.route.failure",attempts,requirements:route.requirements});
    return {state:"UNAVAILABLE",message:"Configured model candidates did not produce a usable runtime result.",requirements:route.requirements,attempts,candidates:route.candidates};
  }
}

export function buildLocalModelCandidates({llamaRuntime=null,forgelm=null}={}){
  const out=[];
  if(llamaRuntime)out.push({
    id:"llamacpp-local",provider:"llama.cpp",local:true,offline:true,privacy:"local-only",
    tasks:["chat","planning","summarization","reasoning","code"],modalities:["text"],contextTokens:null,
    health:async()=>{const s=await llamaRuntime.status();return {...s,executable:s.executable!==false&&s.availability==="CONNECTED"};},
    generate:async({prompt,system="",maxTokens=768,model="local",messages=null,tools=null,temperature=0.7})=>llamaRuntime.chat(prompt,{system,maxTokens,model,messages,tools,temperature})
  });
  if(forgelm)out.push({
    id:"forgelm-local",provider:"forgelm",local:true,offline:true,privacy:"local-only",
    tasks:["chat","classification","summarization","reasoning","planning","code","structured-output","embeddings","rerank","long-context"],modalities:["text"],contextTokens:null,
    health:async()=>{const s=await forgelm.status();const ok=s?.state==="SUCCESS"&&s?.checkpointExists===true;return {availability:ok?"CONNECTED":"UNAVAILABLE",executable:ok,reason:ok?"Verified ForgeLM checkpoint is locally available.":(s?.message||"ForgeLM checkpoint is unavailable."),evidence:s};},
    generate:async({prompt,system="",maxTokens=384,documents=[],sourceText="",requirements={},signal=null,onEvent=null})=>{
      if(requirements.task==="embeddings")return forgelm.embeddings(prompt);
      if(requirements.task==="rerank")return forgelm.rerank(prompt,documents);
      if(requirements.task==="long-context")return forgelm.longContext(prompt,sourceText||documents.join("\n\n"),maxTokens);
      return forgelm.chat([system,prompt].filter(Boolean).join("\n\n"),maxTokens,{signal,onEvent});
    }
  });
  return out;
}

export function buildProviderModelCandidates(providerHub){
  if(!providerHub?.list)return [];
  return providerHub.list().map(cfg=>({
    id:`provider-${cfg.id}`,provider:cfg.id,model:cfg.model,local:false,offline:false,privacy:"external-provider",
    tasks:["chat",...(cfg.capabilities.includes("code")?["code"]:[]),...(cfg.capabilities.includes("reasoning")?["reasoning","planning"]:[]),"summarization","classification",...(cfg.capabilities.includes("structured-output")?["structured-output"]:[]),...(cfg.capabilities.includes("embeddings")?["embeddings"]:[]),...(cfg.capabilities.includes("rerank")?["rerank"]:[])],
    modalities:["text",...(cfg.capabilities.includes("vision")?["vision"]:[]),...(cfg.capabilities.includes("image")?["image"]:[]),...(cfg.capabilities.includes("audio")?["audio"]:[]),...(cfg.capabilities.includes("video")?["video"]:[]),...(cfg.capabilities.includes("pdf")?["pdf"]:[])],
    contextTokens:null,
    health:()=>providerHub.health(cfg.id),
    generate:async({prompt,system="",maxTokens=1024,temperature=0.7,images=[],media=[],documents=[],schema=null,tools=null,requirements={}})=>{
      const task=requirements.task||"chat",modality=requirements.modality||"text";
      if(task==="embeddings")return providerHub.embeddings(cfg.id,prompt,{model:cfg.model});
      if(task==="rerank")return providerHub.rerank(cfg.id,prompt,Array.isArray(documents)?documents:[],{model:cfg.model});
      if(modality==="image"||task==="image")return providerHub.image(cfg.id,prompt,{});
      if(modality==="vision")return providerHub.vision(cfg.id,prompt,images,{system,maxTokens});
      if(["audio","video","pdf"].includes(modality))return providerHub.media(cfg.id,prompt,media.length?media:images,{system,maxTokens});
      if(task==="structured-output"&&schema)return providerHub.structured(cfg.id,prompt,schema,{system,maxTokens,temperature,tools});
      return providerHub.chat(cfg.id,prompt,system,{maxTokens,temperature,tools,responseSchema:schema||undefined});
    }
  }));
}
