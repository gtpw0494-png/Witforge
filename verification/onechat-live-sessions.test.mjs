import assert from "node:assert/strict";
import {OneChatTurnSessions} from "../src/onechat-turn-sessions.js";

const events=[];
const fakeOneChat={
  async handle({signal,onEvent,message}){
    onEvent?.({type:"phase",phase:"intent",message:"intent"});
    onEvent?.({type:"token",text:"hel",tokens:1});
    onEvent?.({type:"token",text:"hello",tokens:2});
    await new Promise(resolve=>{
      const t=setTimeout(resolve,40);
      signal?.addEventListener("abort",()=>{clearTimeout(t);resolve();},{once:true});
    });
    if(signal?.aborted)return {state:"CANCELLED",message:"cancelled"};
    onEvent?.({type:"tool",agent:"conversation",state:"SUCCESS",message:"done"});
    return {state:"SUCCESS",message:"hello "+message,knowledgeId:"turn-1"};
  }
};
const audit={append:e=>events.push(e)};
const mgr=new OneChatTurnSessions({onechat:fakeOneChat,audit,maxEvents:50});

const started=mgr.start({chatId:"chat-1",ownerId:"owner-1",message:"world"});
assert.ok(started.id.startsWith("turn-session-"));
await new Promise(r=>setTimeout(r,80));
const done=mgr.get(started.id,{ownerId:"owner-1",since:0});
assert.equal(done.state,"SUCCESS");
assert.equal(done.session.state,"SUCCESS");
assert.equal(done.session.result.message,"hello world");
assert.ok(done.events.some(e=>e.type==="phase"));
assert.deepEqual(done.events.filter(e=>e.type==="token").map(e=>e.text),["hel","hello"]);
assert.ok(done.events.some(e=>e.type==="result"));
const replay=mgr.get(started.id,{ownerId:"owner-1",since:done.events[0].seq});
assert.ok(replay.events.every(e=>e.seq>done.events[0].seq));
assert.equal(mgr.get(started.id,{ownerId:"owner-2"}).state,"DENIED");

const cancelled=mgr.start({chatId:"chat-2",ownerId:"owner-1",message:"slow"});
await new Promise(r=>setTimeout(r,5));
const stop=mgr.cancel(cancelled.id,{ownerId:"owner-1"});
assert.equal(stop.state,"CANCEL_REQUESTED");
await new Promise(r=>setTimeout(r,20));
const cancelledState=mgr.get(cancelled.id,{ownerId:"owner-1"});
assert.equal(cancelledState.session.state,"CANCELLED");
assert.equal(cancelledState.session.result,null);
assert.ok(cancelledState.events.some(e=>e.state==="CANCEL_REQUESTED"));
assert.ok(cancelledState.events.some(e=>e.state==="CANCELLED"));

console.log("onechat live turn sessions: ok");
