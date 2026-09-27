import assert from "node:assert/strict";
import {ProviderHub} from "../src/providers.js";
import {ModelRouter,buildProviderModelCandidates} from "../src/models/router.js";

const before={...process.env};
const originalFetch=globalThis.fetch;
process.env.PUTER_AUTH_TOKEN="test-token";
process.env.PUTER_BASE_URL="https://api.puter.test/puterai/openai/v1";
process.env.PUTER_MODEL="openai/gpt-6-astra";
process.env.COHERE_API_KEY="test-cohere";
process.env.COHERE_BASE_URL="https://api.cohere.test/v2";
process.env.COHERE_MODEL="command-a-plus";
process.env.GEMINI_API_KEY="test-gemini";
process.env.GEMINI_BASE_URL="https://api.gemini.test/v1beta";
process.env.GEMINI_MODEL="gemini-3.8-flash";

const calls=[];
const reply=(json,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(json)});
globalThis.fetch=async(url,options={})=>{
  const body=JSON.parse(options.body||"{}");calls.push({url:String(url),headers:options.headers||{},body});
  if(String(url).endsWith("/embeddings"))return reply({data:[{embedding:[0.1,0.2,0.3]}]});
  if(String(url).endsWith("/rerank"))return reply({results:[{index:1,relevance_score:0.9}]});
  if(String(url).endsWith("/embed"))return reply({embeddings:{float:[[0.4,0.5]]}});
  if(String(url).includes(":generateContent"))return reply({candidates:[{content:{parts:[{text:"Gemini media evidence"}]}}]});
  if(body.tools)return reply({choices:[{message:{content:null,tool_calls:[{id:"call-1",type:"function",function:{name:"lookup",arguments:'{"q":"uai"}'}}]}}]});
  return reply({choices:[{message:{content:'{"ok":true}'}}]});
};

try{
  const hub=new ProviderHub();
  const configured=hub.list().find(x=>x.id==="puter");
  assert.equal(configured.availability,"CONFIGURED");
  assert.equal(configured.executable,true);
  assert.equal(configured.base,"https://api.puter.test/puterai/openai/v1");

  const router=new ModelRouter({candidates:buildProviderModelCandidates(hub)});
  const localOnly=await router.route({task:"chat",modality:"text",privacy:"local-only",offline:false,provider:"puter"});
  assert.equal(localOnly.state,"UNAVAILABLE");
  const cloud=await router.route({task:"chat",modality:"text",privacy:"cloud-ok",offline:false,provider:"puter"});
  assert.equal(cloud.state,"SUCCESS");
  assert.equal(cloud.selected.provider,"puter");
  assert.equal(cloud.selected.model,"openai/gpt-6-astra");

  const vision=await hub.vision("puter","inspect image",["data:image/png;base64,AAAA"]);
  assert.equal(vision.state,"SUCCESS");
  const visionCall=calls.at(-1);
  assert.ok(Array.isArray(visionCall.body.messages[0].content));
  assert.equal(visionCall.body.messages[0].content[1].type,"image_url");
  assert.ok(visionCall.body.messages[0].content[1].image_url.url.startsWith("data:image/png;base64,"));

  const schema={type:"object",required:["ok"],properties:{ok:{type:"boolean"}}};
  const structured=await hub.structured("puter","return ok",schema);
  assert.equal(structured.state,"SUCCESS");
  assert.equal(structured.value.ok,true);
  const structuredCall=calls.at(-1);
  assert.equal(structuredCall.body.response_format.type,"json_schema");


  const tools=await hub.chat("puter","lookup UAI","tools", {tools:[{name:"lookup",description:"Lookup evidence",parameters:{type:"object",properties:{q:{type:"string"}},required:["q"]}}]});
  assert.equal(tools.state,"SUCCESS");
  assert.equal(tools.toolCalls[0].function.name,"lookup");
  assert.equal(tools.text,"");

  const media=await hub.media("gemini","transcribe and summarize",[{mediaType:"audio/wav",data:"AAAA"}]);
  assert.equal(media.state,"SUCCESS");
  assert.equal(media.text,"Gemini media evidence");
  const mediaCall=calls.at(-1);
  assert.equal(mediaCall.body.contents[0].parts[1].inlineData.mimeType,"audio/wav");
  assert.equal(mediaCall.body.contents[0].parts[1].inlineData.data,"AAAA");

  const embeddings=await hub.embeddings("puter",["alpha","beta"]);
  assert.equal(embeddings.state,"SUCCESS");
  assert.deepEqual(embeddings.output,[[0.1,0.2,0.3]]);

  const rerank=await hub.rerank("cohere","query",["first","second"]);
  assert.equal(rerank.state,"SUCCESS");
  assert.equal(rerank.output[0].index,1);

  console.log("frontier provider routing verification passed");
}finally{
  globalThis.fetch=originalFetch;
  for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];
  for(const [key,value] of Object.entries(before))process.env[key]=value;
}
