import {validateSchema} from "./schema-validator.js";
const trimSlash = s => String(s || "").replace(/\/+$/, "");
const env = name => process.env[name] || "";
const now = () => new Date().toISOString();
const textOf = value => typeof value === "string" ? value : JSON.stringify(value);
const parseDataUrl = value => {
  const m = String(value || "").match(/^data:([^;,]+);base64,(.+)$/);
  return m ? {mediaType:m[1],data:m[2]} : null;
};
const imageList = images => (Array.isArray(images) ? images : [images]).filter(Boolean).map(x => {
  if (typeof x === "string") return {url:x};
  return {url:x.url || x.uri || "", mediaType:x.mediaType || x.mimeType || "", data:x.data || x.base64 || ""};
});
const requiredFields = schema => Array.isArray(schema?.required) ? schema.required : [];

const PROVIDERS = [
  { id:"openai", label:"OpenAI", kind:"openai-compatible", keyEnv:"OPENAI_API_KEY", baseEnv:"OPENAI_BASE_URL", defaultBase:"https://api.openai.com/v1", modelEnv:"OPENAI_MODEL", defaultModel:"gpt-6-astra", capabilities:["chat","code","reasoning","vision","image","tools","structured-output","embeddings"] },
  { id:"anthropic", label:"Anthropic/Claude", kind:"anthropic", keyEnv:"ANTHROPIC_API_KEY", baseEnv:"ANTHROPIC_BASE_URL", defaultBase:"https://api.anthropic.com/v1", modelEnv:"ANTHROPIC_MODEL", defaultModel:"claude-sonnet-5", capabilities:["chat","code","reasoning","vision","tools","structured-output"] },
  { id:"gemini", label:"Google Gemini", kind:"gemini", keyEnv:"GEMINI_API_KEY", baseEnv:"GEMINI_BASE_URL", defaultBase:"https://generativelanguage.googleapis.com/v1beta", modelEnv:"GEMINI_MODEL", defaultModel:"gemini-3.8-flash", capabilities:["chat","code","reasoning","vision","image","tools","structured-output","embeddings","audio","video","pdf"] },
  { id:"xai", label:"xAI/Grok", kind:"openai-compatible", keyEnv:"XAI_API_KEY", baseEnv:"XAI_BASE_URL", defaultBase:"https://api.x.ai/v1", modelEnv:"XAI_MODEL", defaultModel:"grok-4.7", capabilities:["chat","code","reasoning","vision","image","tools","structured-output"] },
  { id:"deepseek", label:"DeepSeek", kind:"openai-compatible", keyEnv:"DEEPSEEK_API_KEY", baseEnv:"DEEPSEEK_BASE_URL", defaultBase:"https://api.deepseek.com", modelEnv:"DEEPSEEK_MODEL", defaultModel:"deepseek-v4.1-flash", capabilities:["chat","code","reasoning","tools","structured-output"] },
  { id:"cohere", label:"Cohere", kind:"cohere", keyEnv:"COHERE_API_KEY", baseEnv:"COHERE_BASE_URL", defaultBase:"https://api.cohere.com/v2", modelEnv:"COHERE_MODEL", defaultModel:"command-a-plus", capabilities:["chat","code","reasoning","vision","tools","structured-output","embeddings","rerank"] },
  { id:"minimax", label:"MiniMax", kind:"openai-compatible", keyEnv:"MINIMAX_API_KEY", baseEnv:"MINIMAX_BASE_URL", defaultBase:"https://api.minimax.io/v1", modelEnv:"MINIMAX_MODEL", defaultModel:"MiniMax-M3", capabilities:["chat","code","reasoning","vision","tools","structured-output"] },
  { id:"inference", label:"Inference.net / specialty", kind:"openai-compatible", keyEnv:"INFERENCE_API_KEY", baseEnv:"INFERENCE_BASE_URL", defaultBase:"https://api.inference.net/v1", modelEnv:"INFERENCE_MODEL", defaultModel:"schematron-v2-small", capabilities:["chat","code","vision","structured-output","embeddings"] },
  { id:"puter", label:"Puter", kind:"openai-compatible", keyEnv:"PUTER_AUTH_TOKEN", baseEnv:"PUTER_BASE_URL", defaultBase:"https://api.puter.com/puterai/openai/v1", modelEnv:"PUTER_MODEL", defaultModel:"openai/gpt-5-nano", capabilities:["chat","code","reasoning","vision","image","tools","structured-output","embeddings"] },
  { id:"huggingface", label:"Hugging Face / open ecosystem", kind:"generic-json", keyEnv:"HUGGINGFACE_API_KEY", baseEnv:"HUGGINGFACE_ENDPOINT", defaultBase:"", modelEnv:"HUGGINGFACE_MODEL", defaultModel:"", capabilities:["chat","code","vision","image","embeddings"] },
  { id:"custom", label:"Custom OpenAI-compatible endpoint", kind:"openai-compatible", keyEnv:"UAI_PROVIDER_API_KEY", baseEnv:"UAI_PROVIDER_BASE_URL", defaultBase:"", modelEnv:"UAI_PROVIDER_MODEL", defaultModel:"", capabilities:["chat","code","reasoning","vision","image","tools","structured-output","embeddings"] }
];

export const providerDefinitions = () => PROVIDERS.map(x => ({...x, capabilities:[...x.capabilities]}));

export class ProviderHub {
  constructor(audit) { this.audit = audit; this.runtime = new Map(); this.providers = providerDefinitions(); }
  config(def) {
    const key = env(def.keyEnv), base = trimSlash(env(def.baseEnv) || def.defaultBase), model = env(def.modelEnv) || def.defaultModel;
    const observed = this.runtime.get(def.id);
    return { id:def.id, label:def.label, kind:def.kind, model, base, capabilities:def.capabilities, availability:observed?.availability || (key && base ? "CONFIGURED" : "UNAVAILABLE"), executable:Boolean(key && base), reason:key && base ? null : `Configure ${def.keyEnv}${base ? "" : ` and ${def.baseEnv}`}` };
  }
  list() { return this.providers.map(x => this.config(x)); }
  get(id) { const def=this.providers.find(x=>x.id===id); if(!def) throw new Error(`Unknown provider: ${id}`); return {def,cfg:this.config(def),key:env(def.keyEnv)}; }
  supports(id, capability) { const {def}=this.get(id); return def.capabilities.includes(capability); }
  _endpoint(def,cfg,operation) {
    if(def.kind==="openai-compatible") {
      if(operation==="image") return `${cfg.base}/images/generations`;
      if(operation==="embeddings") return `${cfg.base}/embeddings`;
      return `${cfg.base}/chat/completions`;
    }
    if(def.kind==="anthropic") return `${cfg.base}/messages`;
    if(def.kind==="gemini") return `${cfg.base}/models/${encodeURIComponent(cfg.model)}:${operation==="embeddings"?"embedContent":"generateContent"}?key=${encodeURIComponent(env(def.keyEnv))}`;
    if(def.kind==="cohere") return `${cfg.base}/${operation==="embeddings"?"embed":operation==="rerank"?"rerank":"chat"}`;
    return cfg.base;
  }
  async _request(id, operation, payload, extract) {
    const {def,cfg,key}=this.get(id);
    if(!cfg.executable) return {state:"UNAVAILABLE",provider:id,model:cfg.model,message:cfg.reason};
    const started=Date.now();
    try {
      const url=this._endpoint(def,cfg,operation); let headers={"content-type":"application/json"};
      if(def.kind==="openai-compatible"||def.kind==="cohere"||def.kind==="generic-json") headers.authorization=`Bearer ${key}`;
      else if(def.kind==="anthropic") { headers["x-api-key"]=key; headers["anthropic-version"]="2023-06-01"; }
      const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(Number(process.env.UAI_PROVIDER_TIMEOUT_MS||60000))});
      const raw=await r.text(); let json; try { json=JSON.parse(raw); } catch { json={raw:raw.slice(0,4000)}; }
      if(!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(json).slice(0,1200)}`);
      const value=extract(json); if(value===undefined||value===null||value==="") throw new Error("Provider response contained no recognized output");
      const structuredValue=value&&typeof value==="object"&&!Array.isArray(value)&&(Object.hasOwn(value,"text")||Object.hasOwn(value,"toolCalls"));
      if(structuredValue&&!String(value.text||"")&&!(Array.isArray(value.toolCalls)&&value.toolCalls.length)) throw new Error("Provider response contained neither text nor tool calls.");
      this.runtime.set(id,{availability:"CONNECTED",lastSuccess:now(),operation});
      const evidence={type:"provider-call",provider:id,model:cfg.model,operation,latencyMs:Date.now()-started}; this.audit?.append(evidence);
      const structured=structuredValue;
      return {state:"SUCCESS",provider:id,model:cfg.model,output:structured?(value.output??value):value,text:structured?String(value.text||""):(typeof value==="string"?value:undefined),toolCalls:structured?(value.toolCalls||[]):undefined,evidence:[evidence]};
    } catch(error) {
      this.runtime.set(id,{availability:"ERROR",lastError:now(),operation});
      this.audit?.append({type:"provider-error",provider:id,operation,error:String(error.message||error)});
      return {state:"ERROR",provider:id,model:cfg.model,message:String(error.message||error)};
    }
  }
  _chatShape(id,message,system,options={}) {
    const {def,cfg}=this.get(id), tools=Array.isArray(options.tools)?options.tools:null, schema=options.responseSchema||null;
    const messages=Array.isArray(message)?message:[{role:"user",content:textOf(message)}];
    if(def.kind==="anthropic") {
      const payload={model:cfg.model,max_tokens:options.maxTokens||1024,system,messages};
      if(tools) payload.tools=tools.map(t=>({name:t.name,description:t.description||"",input_schema:t.input_schema||t.parameters||{type:"object",properties:{}}}));
      return {payload,extract:j=>({text:j?.content?.map?.(x=>x?.text||"").join("")||"",toolCalls:(j?.content||[]).filter(x=>x?.type==="tool_use").map(x=>({id:x.id,name:x.name,arguments:x.input||{}}))})};
    }
    if(def.kind==="gemini") {
      const joined=messages.map(x=>({role:x.role==="assistant"?"model":"user",parts:[{text:textOf(x.content)}]}));
      const payload={systemInstruction:{parts:[{text:system}]},contents:joined};
      if(tools) payload.tools=[{functionDeclarations:tools.map(t=>({name:t.name,description:t.description||"",parameters:t.input_schema||t.parameters||{type:"OBJECT",properties:{}}}))}];
      if(schema) payload.generationConfig={...(payload.generationConfig||{}),responseMimeType:"application/json",responseJsonSchema:schema};
      return {payload,extract:j=>{const parts=j?.candidates?.[0]?.content?.parts||[];return {text:parts.map(x=>x.text||"").join(""),toolCalls:parts.filter(x=>x.functionCall).map(x=>({id:null,name:x.functionCall.name,arguments:x.functionCall.args||{}}))};}};
    }
    if(def.kind==="cohere") {
      const payload={model:cfg.model,messages:[{role:"system",content:system},...messages]};
      if(tools) payload.tools=tools;
      if(schema) payload.response_format={type:"json_object",schema};
      return {payload,extract:j=>({text:j?.message?.content?.map?.(x=>x?.text||"").join("")||j?.text||"",toolCalls:j?.message?.tool_calls||j?.tool_calls||[]})};
    }
    if(def.kind==="generic-json") return {payload:{inputs:textOf(message),parameters:{max_new_tokens:options.maxTokens||512}},extract:j=>Array.isArray(j)?j[0]?.generated_text:j?.generated_text||j?.text};
    const payload={model:cfg.model,messages:[{role:"system",content:system},...messages],temperature:options.temperature,max_tokens:options.maxTokens};
    if(tools) payload.tools=tools.map(t=>t.type? t : {type:"function",function:{name:t.name,description:t.description||"",parameters:t.input_schema||t.parameters||{type:"object",properties:{}}}});
    if(schema) payload.response_format={type:"json_schema",json_schema:{name:options.schemaName||"uai_response",strict:true,schema}};
    return {payload,extract:j=>{const m=j?.choices?.[0]?.message||{};return {text:m.content||"",toolCalls:m.tool_calls||[]};}};
  }
  chat(id,message,system="You are a concise research assistant.",options={}) {
    const {payload,extract}=this._chatShape(id,message,system,options);
    return this._request(id,"chat",payload,extract);
  }
  vision(id,message,images=[],options={}) {
    if(!this.supports(id,"vision")) return Promise.resolve({state:"UNAVAILABLE",provider:id,message:"Provider is not registered for vision input."});
    const {def,cfg}=this.get(id), normalized=imageList(images);
    if(!normalized.length) return Promise.resolve({state:"BLOCKED",provider:id,message:"Vision requires at least one image."});
    if(def.kind==="anthropic") {
      const content=[{type:"text",text:String(message)}];
      for(const im of normalized) {
        if(im.data) content.push({type:"image",source:{type:"base64",media_type:im.mediaType||"image/png",data:im.data}});
        else { const d=parseDataUrl(im.url); content.push(d?{type:"image",source:{type:"base64",media_type:d.mediaType,data:d.data}}:{type:"image",source:{type:"url",url:im.url}}); }
      }
      return this._request(id,"chat",{model:cfg.model,max_tokens:options.maxTokens||1024,system:options.system||"Analyze only the supplied image evidence.",messages:[{role:"user",content}]},j=>j?.content?.map?.(x=>x?.text||"").join(""));
    }
    if(def.kind==="gemini") {
      const parts=[{text:String(message)}];
      for(const im of normalized) {
        if(im.data) parts.push({inlineData:{mimeType:im.mediaType||"image/png",data:im.data}});
        else { const d=parseDataUrl(im.url); parts.push(d?{inlineData:{mimeType:d.mediaType,data:d.data}}:{fileData:{mimeType:im.mediaType||"image/*",fileUri:im.url}}); }
      }
      const payload={contents:[{role:"user",parts}]};
      return this._request(id,"chat",payload,j=>j?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join(""));
    }
    const content=[{type:"text",text:String(message)},...normalized.map(im=>({type:"image_url",image_url:{url:im.data?`data:${im.mediaType||"image/png"};base64,${im.data}`:im.url}}))];
    return this._request(id,"chat",{model:cfg.model,messages:[{role:"user",content}],max_tokens:options.maxTokens||1024},j=>j?.choices?.[0]?.message?.content);
  }
  media(id,message,media=[],options={}) {
    const {def,cfg}=this.get(id), items=imageList(media);
    if(!items.length) return Promise.resolve({state:"BLOCKED",provider:id,message:"Multimodal input requires at least one media item."});
    const kinds=new Set(items.map(x=>String(x.mediaType||parseDataUrl(x.url)?.mediaType||"application/octet-stream").split("/")[0]));
    for(const kind of kinds) if(!this.supports(id,kind==="application"?"pdf":kind)) return Promise.resolve({state:"UNAVAILABLE",provider:id,message:`Provider is not registered for ${kind} input.`});
    if(def.kind!=="gemini") return Promise.resolve({state:"UNAVAILABLE",provider:id,message:"General audio/video/PDF input is currently implemented only for the Gemini adapter; use vision() for image-capable providers."});
    const parts=[{text:String(message)}];
    for(const item of items){
      const d=item.data?{mediaType:item.mediaType||"application/octet-stream",data:item.data}:parseDataUrl(item.url);
      if(d) parts.push({inlineData:{mimeType:d.mediaType,data:d.data}});
      else parts.push({fileData:{mimeType:item.mediaType||"application/octet-stream",fileUri:item.url}});
    }
    return this._request(id,"chat",{contents:[{role:"user",parts}]},j=>({text:j?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("")||"",toolCalls:(j?.candidates?.[0]?.content?.parts||[]).filter(x=>x.functionCall).map(x=>({id:null,name:x.functionCall.name,arguments:x.functionCall.args||{}}))}));
  }
  image(id,prompt,options={}) {
    if(!this.supports(id,"image")) return Promise.resolve({state:"UNAVAILABLE",provider:id,message:"Provider is not registered for image generation."});
    const {def,cfg}=this.get(id);
    if(def.kind==="gemini") {
      const payload={contents:[{role:"user",parts:[{text:String(prompt)}]}],generationConfig:{responseModalities:["TEXT","IMAGE"]}};
      return this._request(id,"image",payload,j=>j?.candidates?.[0]?.content?.parts||j?.data);
    }
    return this._request(id,"image",{model:cfg.model,prompt:String(prompt),size:options.size||"1024x1024",n:options.n||1,response_format:options.responseFormat||"url",quality:options.quality},j=>j?.data||j?.images);
  }
  async structured(id,message,schema,{system="Return only JSON matching the schema.",...options}={}) {
    if(!schema||typeof schema!=="object") return {state:"BLOCKED",provider:id,message:"Structured output requires a JSON schema object."};
    const r=await this.chat(id,message,system,{...options,responseSchema:schema});
    if(r.state!=="SUCCESS") return r;
    let value; try { value=JSON.parse(r.text); } catch { return {...r,state:"FAILURE",message:"Provider returned invalid JSON.",rawText:r.text}; }
    const missing=requiredFields(schema).filter(k=>!(k in (value&&typeof value==="object"?value:{})));
    if(missing.length) return {...r,state:"FAILURE",message:`Structured output is missing required fields: ${missing.join(", ")}`,value};
    const validation=validateSchema(schema,value);
    if(validation.state!=="SUCCESS") return {...r,state:"FAILURE",message:"Provider JSON did not satisfy the requested schema.",value,validation};
    return {...r,value,validation};
  }
  embeddings(id,input,options={}) {
    if(!this.supports(id,"embeddings")) return Promise.resolve({state:"UNAVAILABLE",provider:id,message:"Provider is not registered for embeddings."});
    const {def,cfg}=this.get(id);
    if(def.kind==="gemini") return this._request(id,"embeddings",{model:`models/${cfg.model}`,content:{parts:[{text:Array.isArray(input)?input.join("\n"):String(input)}]}},j=>j?.embedding?.values||j?.embeddings);
    if(def.kind==="cohere") return this._request(id,"embeddings",{model:options.model||cfg.model,texts:Array.isArray(input)?input:[String(input)],input_type:options.inputType||"search_document"},j=>j?.embeddings?.float||j?.embeddings);
    return this._request(id,"embeddings",{model:options.model||cfg.model,input},j=>j?.data?.map?.(x=>x.embedding)||j?.embedding);
  }
  rerank(id,query,documents=[],options={}) {
    if(!this.supports(id,"rerank")) return Promise.resolve({state:"UNAVAILABLE",provider:id,message:"Provider is not registered for reranking."});
    const {cfg}=this.get(id);
    return this._request(id,"rerank",{model:options.model||cfg.model,query:String(query),documents,top_n:options.topN||documents.length},j=>j?.results);
  }
  async health(id) { const c=this.config(this.providers.find(x=>x.id===id)); return {state:"SUCCESS",...c,checkedAt:now()}; }
}
