import assert from "node:assert/strict";
import http from "node:http";
import {ConversationEngine} from "../src/conversation-engine.js";
import {OneChatRouter} from "../src/onechat.js";
import {WebResearchEngine} from "../src/web-research-engine.js";

const audit={rows:[],append(x){this.rows.push(x);}};
const modelRouter={
 async generate(req,prompt){
  assert.equal(req.task,"chat");assert.match(prompt,/user:/i);
  return {state:"SUCCESS",text:prompt.includes("WEB RESEARCH EVIDENCE")?"Grounded synthesis using [S1].":"Natural conversational answer.",route:{selected:{id:"test-model",provider:"test"},alternatives:[],attempts:[]}};
 }
};
const conversation=new ConversationEngine({modelRouter,audit,maxContextTokens:2048});
let a=await conversation.chat({chatId:"c1",message:"Explain local-first AI"});
assert.equal(a.state,"SUCCESS");
a=await conversation.chat({chatId:"c1",message:"and why does that matter?"});
assert.equal(a.contextTurns,2);

const researchServer=http.createServer((req,res)=>{
 if(req.url.startsWith("/search")){res.writeHead(200,{"content-type":"text/html"});return res.end('<a href="/a">Primary architecture source</a><a href="/b">Independent evidence source</a>');}
 res.writeHead(200,{"content-type":"text/html"});res.end(req.url==="/a"?"Local-first AI keeps user data and inference under local control.":"Evidence-grounded systems attach provenance and citations to claims.");
});
await new Promise(r=>researchServer.listen(0,"127.0.0.1",r));
const port=researchServer.address().port;
const webResearch=new WebResearchEngine({audit,searchEndpoints:[`http://127.0.0.1:${port}/search?q={q}`]});
webResearch.fetchSource=async(item,query)=>({state:"SUCCESS",url:item.url,title:item.title,publisher:"fixture",retrievedAt:new Date().toISOString(),contentType:"text/html",text:item.url.endsWith("/a")?"Local-first AI keeps user data and inference under local control.":"Evidence-grounded systems attach provenance and citations to claims.",security:{risk:"LOW",promptInjectionSignals:0,secretSignals:0},relevance:0.8});
const rr=await webResearch.research("research local-first evidence",{maxSources:2});
assert.equal(rr.state,"SUCCESS");assert.equal(rr.sources.length,2);assert.match(rr.context,/\[S1\]/);
const store={rows:[],add(x){const row={id:"k-"+(this.rows.length+1),...x};this.rows.push(row);return row;},list(){return this.rows.map(x=>({id:x.id}));},get(id){return this.rows.find(x=>x.id===id);}};
const explorative={chat:async()=>({state:"SUCCESS",message:"Research helper context."})};
const knowledge={search:()=>[]};
const sourceRegistry=[];
const modelLab={analyzeSources:async()=>({state:"SUCCESS",message:"Fixture source snapshot.",sources:[]})};
const onechat=new OneChatRouter({conversation,webResearch,store,audit,explorative,knowledge,sourceRegistry,modelLab,responseComposer:{compose({contributions}){const x=contributions.find(c=>c.agent==="conversation")?.result;return {message:x?.message||"none",mode:"native-conversation",modelUsed:true,evidence:null};}}});
const out=await onechat.handle({chatId:"c2",message:"research the latest local-first evidence"});
assert.ok(["SUCCESS","PARTIAL"].includes(out.state));assert.equal(out.evidenceEnvelope.metadata.researchRunId!=null,true);assert.equal(out.evidenceEnvelope.claims[0].support.length,2);assert.match(out.message,/\[S1\]/);
researchServer.close();
console.log("v0.50.0 conversational continuity and governed web-research tests passed");
