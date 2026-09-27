import assert from "node:assert/strict";
import {ConversationEngine} from "../src/conversation-engine.js";
import {capabilityTruth,bestCapability,CAPABILITY_STATES} from "../src/capability-truth.js";
import {OneChatRouter} from "../src/onechat.js";

const auditEvents=[];
const audit={append:x=>auditEvents.push(x)};

const prompts=[];
let reply=0;
const llama={
  status:async()=>({availability:"CONNECTED"}),
  chat:async(prompt,opts)=>{
    prompts.push({prompt,opts});
    reply+=1;
    return {state:"SUCCESS",text:reply===1?"The first local response is grounded and coherent.":"The follow-up response used prior conversation context.",model:"fixture-local"};
  }
};
const neverForge={chat:async()=>{throw new Error("ForgeLM should not run while llama.cpp is connected.");}};
const conv=new ConversationEngine({llamaRuntime:llama,forgelm:neverForge,audit,maxContextTokens:2048});
const first=await conv.chat({chatId:"chat-a",message:"Explain the local evidence layer."});
assert.equal(first.state,"SUCCESS");
assert.equal(first.runtime,"llama.cpp");
assert.equal(first.contextTurns,0);
assert.equal(first.model,"fixture-local");
assert.match(prompts[0].opts.system,/Never claim an action, source, connection, memory, or verification that did not occur/);

const second=await conv.chat({chatId:"chat-a",message:"How does that relate to citations?"});
assert.equal(second.state,"SUCCESS");
assert.equal(second.contextTurns,2);
assert.match(prompts[1].prompt,/Explain the local evidence layer/);
assert.match(prompts[1].prompt,/first local response/i);
assert.ok(auditEvents.some(x=>x.type==="conversation.reply"&&x.runtime==="llama.cpp"));

const forgePrompts=[];
const forgeConv=new ConversationEngine({
  llamaRuntime:{status:async()=>({availability:"UNAVAILABLE"})},
  forgelm:{chat:async prompt=>{forgePrompts.push(prompt);return {state:"SUCCESS",text:"ForgeLM provides a coherent local fallback response."};}},
  audit
});
const fallback=await forgeConv.chat({chatId:"chat-b",message:"Use the local fallback."});
assert.equal(fallback.state,"SUCCESS");
assert.equal(fallback.runtime,"forgelm");
assert.equal(fallback.modelUsed,true);
assert.match(forgePrompts[0],/Use the local fallback/);

const unavailable=new ConversationEngine({
  llamaRuntime:{status:async()=>({availability:"UNAVAILABLE"})},
  forgelm:{chat:async()=>({state:"UNAVAILABLE",message:"no checkpoint"})}
});
const noModel=await unavailable.chat({chatId:"chat-c",message:"Can you answer?"});
assert.equal(noModel.state,"UNAVAILABLE");
assert.equal(noModel.modelUsed,false);

const storeRows=[];
const onechat=new OneChatRouter({
  conversation:new ConversationEngine({
    llamaRuntime:{status:async()=>({availability:"CONNECTED"}),chat:async()=>({state:"SUCCESS",text:"A normal conversational turn from the selected local runtime.",model:"fixture"})}
  }),
  store:{add:x=>{const row={id:"turn-"+(storeRows.length+1),...x};storeRows.push(row);return row;}},
  audit,
  responseComposer:undefined
});
const routed=await onechat.handle({chatId:"onechat-native",message:"Tell me something useful"});
assert.equal(routed.state,"SUCCESS");
assert.equal(routed.responseMode,"native-conversation");
assert.equal(routed.modelUsed,true);
assert.ok(routed.allocations.some(x=>x.agent==="conversation"));
assert.ok(routed.contributions.some(x=>x.agent==="conversation"&&x.result.runtime==="llama.cpp"));

assert.deepEqual(CAPABILITY_STATES,["CONNECTED","CONFIGURED","REGISTERED_SOURCE","DEGRADED","UNAVAILABLE","BLOCKED","EXPIRED"]);
const connected=capabilityTruth({id:"model.local",installed:true,configured:true,authenticated:true,executable:true,health:"ok",offline:true});
const configured=capabilityTruth({id:"service.config",configured:true,executable:false});
const registered=capabilityTruth({id:"source.only",sourceRegistered:true});
const degraded=capabilityTruth({id:"runtime.bad",configured:true,health:"failed"});
const blocked=capabilityTruth({id:"policy.blocked",configured:true,permitted:false});
const expired=capabilityTruth({id:"lease.expired",configured:true,expiresAt:new Date(Date.now()-1000).toISOString()});
const unavailableCap=capabilityTruth({id:"missing"});
assert.equal(connected.state,"CONNECTED");
assert.equal(configured.state,"CONFIGURED");
assert.equal(registered.state,"REGISTERED_SOURCE");
assert.equal(degraded.state,"DEGRADED");
assert.equal(blocked.state,"BLOCKED");
assert.equal(expired.state,"EXPIRED");
assert.equal(unavailableCap.state,"UNAVAILABLE");
assert.equal(bestCapability([unavailableCap,registered,configured,connected]).id,"model.local");

console.log("v0.48 native conversation and capability-truth tests passed");
