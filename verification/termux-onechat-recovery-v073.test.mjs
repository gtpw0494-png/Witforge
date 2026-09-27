import assert from "node:assert/strict";
import {termuxSafeEnv,nodeChildEnv,absoluteNodeScript,nodeScriptInvocation} from "../src/process-compat.js";
import {OneChatRouter} from "../src/onechat.js";

const env=termuxSafeEnv({LD_PRELOAD:"/data/data/com.termux/files/usr/lib/libtermux-exec.so",TERMUX_VERSION:"test"});
assert.equal(env.LD_PRELOAD,undefined);
const nodeEnv=nodeChildEnv({LD_PRELOAD:"/data/data/com.termux/files/usr/lib/libtermux-exec.so",TERMUX_VERSION:"test"});
assert.match(nodeEnv.LD_PRELOAD,/libtermux-exec/);
assert.ok(absoluteNodeScript("/tmp/uai","server.js").startsWith("/"));
const invocation=nodeScriptInvocation("/tmp/uai","test.js",["--sample"]);
assert.equal(invocation.command,process.execPath);
assert.equal(invocation.args[0],absoluteNodeScript("/tmp/uai","test.js"));
assert.equal(invocation.args[1],"--sample");

const store={rows:[],add(x){const r={id:"r-"+(this.rows.length+1),createdAt:new Date().toISOString(),...x};this.rows.push(r);return r;},list(){return this.rows.map(x=>({id:x.id}));},get(id){return this.rows.find(x=>x.id===id)||null;}};
const caps=[
  {id:"local.onechat",availability:"CONNECTED"},
  {id:"local.forgelm.infer",availability:"UNAVAILABLE",reason:"checkpoint missing"},
  {id:"local.web.research",availability:"CONFIGURED"},
  {id:"local.documents",availability:"CONNECTED"},
  {id:"local.multimodal",availability:"UNAVAILABLE"}
];
const ingested=[];
const chat=new OneChatRouter({
  store,
  capabilityStatus:async()=>caps,
  webResearch:{search:async()=>({state:"UNAVAILABLE",results:[],errors:[{engine:"duckduckgo.com",message:"fetch failed: getaddrinfo ENOTFOUND"}],providers:[],structuredProvider:"UNAVAILABLE"})},
  webCorpus:{ingestUrl:async x=>{ingested.push(x);return {state:"SUCCESS",message:"URL ingested",url:x.url};}},
  control:{accounts:{list:()=>[]},subscriptions:{list:()=>[]},plugins:{list:()=>[]}}
});

const abilities=await chat.handle({chatId:"help",message:"What else can you do?",ownerId:"owner"});
assert.equal(abilities.state,"SUCCESS");
assert.match(abilities.message,/capabilities CONNECTED/i);
assert.match(abilities.message,/report unavailable functions/i);

const web=await chat.handle({chatId:"web",message:"Can you search the web",ownerId:"owner"});
assert.equal(web.state,"UNAVAILABLE");
assert.match(web.message,/configured, but live search is not reachable/i);
assert.match(web.message,/ENOTFOUND|fetch failed/i);

const ingest=await chat.handle({chatId:"ingest",message:"Can you ingest www.example.com",ownerId:"owner"});
assert.equal(ingest.state,"SUCCESS");
assert.equal(ingested.length,1);
assert.equal(ingested[0].url,"https://www.example.com");

console.log("v0.73 Termux and natural OneChat recovery tests passed");
