import assert from "node:assert/strict";
import {OneChatRouter} from "../src/onechat.js";

class Store{
  constructor(){this.rows=[];}
  list(){return this.rows.map(x=>({id:x.id}));}
  get(id){return this.rows.find(x=>x.id===id)||null;}
  add(x){const r={...x,id:x.id||"r-"+(this.rows.length+1),createdAt:x.createdAt||new Date(1700000000000+this.rows.length*1000).toISOString()};this.rows.push(r);return r;}
  remove(id){this.rows=this.rows.filter(x=>x.id!==id);return {state:"SUCCESS",id};}
}
const store=new Store(),audit={append:()=>{}};
const router=new OneChatRouter({store,audit,conversation:{histories:new Map()}});
const t1=store.add({
  kind:"chat-turn",chatId:"chat-a",ownerId:"owner-1",user:"First meaningful question for title",answer:"answer one",state:"SUCCESS",responseMode:"native-conversation",
  attachments:[{id:"media-1",modality:"image",label:"pic.png",sourceId:"fixture",mediaType:"image/png",contentHash:"a".repeat(64),bytes:12,path:"/private/secret/pic.png"}],
  evidenceEnvelope:{id:"ev1",responseId:"resp1",promptVersion:"onechat",model:{id:"ForgeLM"},claims:[{claim:"answer one",status:"SUPPORTED",support:[{source_id:"fixture",uri:"file:/private/secret/pic.png",provenance:{mediaId:"media-1",modality:"image",contentHash:"a".repeat(64)}}]}],toolCalls:[],integrity:{digest:"d1"}}
});
const t2=store.add({kind:"chat-turn",chatId:"chat-a",ownerId:"owner-1",user:"second",answer:"answer two",state:"SUCCESS",responseMode:"native-conversation",attachments:[],evidenceEnvelope:null});

const turn=router.turn(t1.id,{ownerId:"owner-1"});
assert.equal(turn.state,"SUCCESS");
assert.equal(turn.turn.attachments[0].id,"media-1");
assert.equal(turn.turn.evidenceEnvelope.claims[0].support[0].uri,"media:media-1");
assert.ok(!JSON.stringify(turn).includes("/private/secret"));

assert.equal(router.turn(t1.id,{ownerId:"owner-2"}).state,"DENIED");
const branch=router.branchFromTurn(t2.id,{ownerId:"owner-1",includeTurn:false,newChatId:"chat-branch"});
assert.equal(branch.state,"SUCCESS");
assert.equal(branch.copiedTurns,1);
const branchHistory=router.history("chat-branch",{ownerId:"owner-1"});
assert.equal(branchHistory.turns.length,1);
assert.equal(branchHistory.turns[0].user,"First meaningful question for title");

router._ensureAutoTitle("chat-title","A first user message that becomes a concise local conversation title","owner-1");
const listed=router.conversations({ownerId:"owner-1",includeArchived:true});
assert.ok(listed.conversations.some(x=>x.chatId==="chat-title"&&x.title.startsWith("A first user message")));

const exported=router.exportTurn(t1.id,{ownerId:"owner-1"});
assert.equal(exported.state,"SUCCESS");
assert.ok(!JSON.stringify(exported).includes("/private/secret"));

console.log("onechat turn controls: ok");
