import assert from "node:assert/strict";
import {ConversationEngine} from "../src/conversation-engine.js";
import {OneChatRouter} from "../src/onechat.js";

const persisted=[
  {id:"turn-1",kind:"chat-turn",chatId:"persisted-chat",user:"My project codename is Atlas.",answer:"I will remember Atlas for this chat.",createdAt:"2026-09-25T00:00:00.000Z"},
  {id:"other-1",kind:"chat-turn",chatId:"other-chat",user:"Ignore me.",answer:"Different chat.",createdAt:"2026-09-25T00:01:00.000Z"}
];
const store={
  rows:persisted,
  list(){return this.rows.map(x=>({id:x.id,kind:x.kind,createdAt:x.createdAt}));},
  get(id){return this.rows.find(x=>x.id===id)||null;}
};
const audit={events:[],append(x){this.events.push(x);}};
let promptSeen="";
const modelRouter={
  async generate(meta,prompt){
    promptSeen=prompt;
    return {state:"SUCCESS",text:"Atlas is still the project codename.",route:{selected:{id:"fixture-model",provider:"fixture"}}};
  }
};

const conversation=new ConversationEngine({modelRouter,store,audit,maxContextTokens:2048});
assert.equal(conversation._history("persisted-chat").length,0);
const intent=new OneChatRouter({conversation})._intent("continue","persisted-chat");
assert.equal(intent.followup,true);
assert.equal(intent.historyTurns,2);
assert.equal(conversation._history("persisted-chat")[0].content,"My project codename is Atlas.");
assert.equal(conversation._history("persisted-chat")[1].content,"I will remember Atlas for this chat.");
assert.ok(audit.events.some(x=>x.type==="conversation.rehydrate"&&x.chatId==="persisted-chat"&&x.restoredTurns===2));

const reply=await conversation.chat({chatId:"persisted-chat",message:"What is the codename?"});
assert.equal(reply.state,"SUCCESS");
assert.match(promptSeen,/user: My project codename is Atlas\./);
assert.match(promptSeen,/assistant: I will remember Atlas for this chat\./);
assert.match(promptSeen,/user: What is the codename\?/);
assert.equal(conversation._history("persisted-chat").length,4);

const restarted=new ConversationEngine({modelRouter,store,audit,maxContextTokens:2048});
restarted.ensureHistory("persisted-chat");
assert.equal(restarted._history("persisted-chat").length,2);
assert.equal(restarted._history("other-chat").length,0);

const many=[];
for(let i=0;i<30;i++)many.push({id:"m-"+i,kind:"chat-turn",chatId:"bounded",user:"user "+i+" "+("x".repeat(60)),answer:"assistant "+i+" "+("y".repeat(60)),createdAt:new Date(1000+i).toISOString()});
const boundedStore={rows:many,list(){return this.rows.map(x=>({id:x.id}));},get(id){return this.rows.find(x=>x.id===id)||null;}};
const bounded=new ConversationEngine({modelRouter,store:boundedStore,audit,maxContextTokens:1024});
bounded.ensureHistory("bounded");
assert.ok(bounded._history("bounded").length>0);
assert.ok(bounded._history("bounded").length<=40);
assert.match(bounded._history("bounded").at(-1).content,/assistant 29/);

console.log("v0.51.0 durable conversation rehydration tests passed");
