import assert from "node:assert/strict";
import {OneChatRouter} from "../src/onechat.js";

const records=[];
const store={
  add:r=>{const x={id:"k-"+(records.length+1),...r};records.push(x);return x;},
  list:()=>records.map(x=>({id:x.id})),
  get:id=>records.find(x=>x.id===id)||null
};
const registered=[];
const multimodalPipeline={
  register:({path,sourceId,ownerId,metadata})=>{
    const modality=path.endsWith(".png")?"image":path.endsWith(".wav")?"audio":path.endsWith(".mp4")?"video":"text";
    const artifact={id:"media-"+registered.length,path,modality,sourceId:sourceId||"file:"+path,contentHash:"a".repeat(64),bytes:10};
    registered.push({artifact,ownerId,metadata});return {state:"SUCCESS",artifact};
  },
  extract:id=>({state:"SUCCESS",artifact:{derived:[{text:"document attachment evidence",locator:{}}]}})
};
const calls=[];
const conversation={
  ensureHistory:()=>[],
  _history:()=>[],
  chatMultimodal:async input=>{calls.push(input);return {state:"SUCCESS",message:"multimodal answer",text:"multimodal answer",runtime:"forgemultimodal",model:"ForgeLM",modelUsed:true,evidence:[{modality:"image"}]};},
  chat:async()=>({state:"SUCCESS",message:"plain answer",modelUsed:true})
};
const responseComposer={compose:({contributions})=>({message:contributions.find(x=>x.agent==="conversation")?.result?.message||"fallback",mode:"native-conversation",modelUsed:true,evidence:{sources:[]}})};
const audit={append:()=>{}};
const router=new OneChatRouter({conversation,multimodalPipeline,store,audit,responseComposer});

const out=await router.handle({
  chatId:"chat-mm",
  ownerId:"owner-test",
  message:"Analyse these attachments together.",
  attachments:[
    {path:"/safe/photo.png",sourceId:"photo-source"},
    {path:"/safe/note.txt",sourceId:"note-source"}
  ]
});
assert.equal(out.state,"SUCCESS");
assert.equal(out.message,"multimodal answer");
assert.equal(calls.length,1);
assert.equal(calls[0].attachments.image,"/safe/photo.png");
assert.match(calls[0].document,/document attachment evidence/);
assert.equal(out.attachments.length,2);
assert.equal(records.length,1);
assert.equal(records[0].attachments.length,2);
assert.ok(records[0].evidenceEnvelope.claims[0].support.some(x=>x.provenance?.mediaId));
assert.equal(registered[0].ownerId,"owner-test");
console.log("onechat multimodal attachments: ok");
