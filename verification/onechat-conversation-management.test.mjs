import assert from "node:assert/strict";
import {OneChatRouter} from "../src/onechat.js";

class Store{
  constructor(){this.rows=[];}
  list(){return this.rows.map(x=>({id:x.id}));}
  get(id){return this.rows.find(x=>x.id===id)||null;}
  add(x){const r={...x,id:"r-"+(this.rows.length+1),createdAt:x.createdAt||new Date(1700000000000+this.rows.length*1000).toISOString()};this.rows.push(r);return r;}
  remove(id){this.rows=this.rows.filter(x=>x.id!==id);return {state:"SUCCESS",id};}
}
const store=new Store(),audit={append:()=>{}},router=new OneChatRouter({store,audit});
store.add({kind:"chat-turn",chatId:"chat-a",ownerId:"owner-1",user:"alpha question",answer:"alpha answer",attachments:[{id:"m1"}],evidenceEnvelope:{id:"e1"}});
store.add({kind:"chat-turn",chatId:"chat-b",ownerId:"owner-1",user:"beta question",answer:"beta answer",attachments:[],evidenceEnvelope:null});
store.add({kind:"chat-turn",chatId:"chat-other",ownerId:"owner-2",user:"secret",answer:"secret"});

let list=router.conversations({ownerId:"owner-1"});
assert.equal(list.conversations.length,2);
assert.ok(list.conversations.some(x=>x.chatId==="chat-a"&&x.attachments===1&&x.evidence===1));
assert.equal(router.conversationControl("chat-a",{ownerId:"owner-1",title:"Renamed alpha"}).state,"SUCCESS");
assert.equal(router.conversationControl("chat-b",{ownerId:"owner-1",archived:true}).state,"SUCCESS");

list=router.conversations({ownerId:"owner-1"});
assert.equal(list.conversations.length,1);
assert.equal(list.conversations[0].title,"Renamed alpha");
assert.equal(router.conversations({ownerId:"owner-1",query:"alpha"}).conversations.length,1);
assert.equal(router.conversations({ownerId:"owner-1",includeArchived:true}).conversations.length,2);

const exp=router.exportConversation("chat-a",{ownerId:"owner-1"});
assert.equal(exp.state,"SUCCESS");
assert.equal(exp.title,"Renamed alpha");
assert.equal(exp.turns.length,1);
assert.ok(!JSON.stringify(exp).includes("chat-other"));

const del=router.deleteConversation("chat-a",{ownerId:"owner-1"});
assert.equal(del.state,"SUCCESS");
assert.ok(del.recordsDeleted>=2);
assert.equal(router.history("chat-a",{ownerId:"owner-1"}).turns.length,0);

console.log("onechat conversation management: ok");
