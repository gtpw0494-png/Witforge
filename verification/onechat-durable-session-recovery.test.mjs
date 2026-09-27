import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {OneChatTurnSessions} from "../src/onechat-turn-sessions.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-turn-recovery-"));
const dir=path.join(root,"onechat-turn-sessions");fs.mkdirSync(dir,{recursive:true});
const now=new Date().toISOString();

function writeSession(id,state,input,seq=0){
  fs.writeFileSync(path.join(dir,id+".json"),JSON.stringify({
    format:"uai.onechat.turn-session.v1",id,chatId:input.chatId,ownerId:input.ownerId,state,
    createdAt:now,updatedAt:now,seq,cancelRequested:false,result:null,error:null,input,recoveredFrom:null
  },null,2));
}
function writeEvents(id,events){
  fs.writeFileSync(path.join(dir,id+".events.jsonl"),events.map(x=>JSON.stringify(x)).join("\n")+"\n");
}

writeSession("turn-session-running","RUNNING",{chatId:"chat-r",ownerId:"owner-1",message:"resume me"},2);
writeEvents("turn-session-running",[
  {seq:1,at:now,type:"state",state:"QUEUED"},
  {seq:2,at:now,type:"state",state:"RUNNING"}
]);
writeSession("turn-session-queued","QUEUED",{chatId:"chat-q",ownerId:"owner-1",message:"queued work"},1);
writeEvents("turn-session-queued",[{seq:1,at:now,type:"state",state:"QUEUED"}]);

const calls=[];
const fakeOneChat={
  async handle({message,onEvent}){
    calls.push(message);onEvent?.({type:"phase",phase:"test",message:"executing"});
    return {state:"SUCCESS",message:"done "+message,knowledgeId:"k-"+calls.length};
  }
};
const mgr=new OneChatTurnSessions({onechat:fakeOneChat,stateRoot:root,maxEvents:50});
await new Promise(r=>setTimeout(r,30));

const interrupted=mgr.get("turn-session-running",{ownerId:"owner-1"});
assert.equal(interrupted.state,"SUCCESS");
assert.equal(interrupted.session.state,"INTERRUPTED");
assert.equal(interrupted.session.resumable,true);
assert.ok(interrupted.events.some(e=>e.type==="recovery"&&e.state==="INTERRUPTED"));
assert.ok(interrupted.events.some(e=>e.seq>2));

const queued=mgr.get("turn-session-queued",{ownerId:"owner-1"});
assert.equal(queued.session.state,"SUCCESS");
assert.equal(queued.session.result.message,"done queued work");
assert.ok(calls.includes("queued work"));

const resumed=mgr.resume("turn-session-running",{ownerId:"owner-1"});
assert.equal(resumed.state,"SUCCESS");
assert.equal(resumed.recoveredFrom,"turn-session-running");
assert.ok(resumed.session.id!== "turn-session-running");
await new Promise(r=>setTimeout(r,30));
const resumedDone=mgr.get(resumed.session.id,{ownerId:"owner-1"});
assert.equal(resumedDone.session.state,"SUCCESS");
assert.equal(resumedDone.session.recoveredFrom,"turn-session-running");
assert.equal(resumedDone.session.result.message,"done resume me");

const reloaded=new OneChatTurnSessions({onechat:fakeOneChat,stateRoot:root,maxEvents:50});
const replay=reloaded.get("turn-session-running",{ownerId:"owner-1",since:2});
assert.equal(replay.session.state,"INTERRUPTED");
assert.ok(replay.events.every(e=>e.seq>2));
assert.equal(reloaded.get("turn-session-running",{ownerId:"owner-2"}).state,"DENIED");

fs.rmSync(root,{recursive:true,force:true});
console.log("onechat durable session recovery: ok");
