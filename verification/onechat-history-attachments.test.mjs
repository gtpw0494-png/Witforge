import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {OneChatRouter} from "../src/onechat.js";
import {MultimodalPipeline} from "../src/multimodal/pipeline.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-history-media-"));
const mediaRoot=path.join(root,"media-input");fs.mkdirSync(mediaRoot,{recursive:true});
const file=path.join(mediaRoot,"note.txt");fs.writeFileSync(file,"governed attachment");
const pipeline=new MultimodalPipeline({stateRoot:path.join(root,"state"),allowedRoots:[mediaRoot]});
const reg=pipeline.register({path:file,ownerId:"owner-1",sourceId:"fixture"});
assert.equal(reg.state,"SUCCESS");
assert.ok(reg.artifact.id);
assert.equal(pipeline.contentDescriptor(reg.artifact.id,{ownerId:"owner-1"}).state,"SUCCESS");
assert.equal(pipeline.contentDescriptor(reg.artifact.id,{ownerId:"owner-2"}).state,"DENIED");

const rows=[{
  id:"turn-1",
  kind:"chat-turn",
  chatId:"chat-history",
  createdAt:"2026-09-26T00:00:00.000Z",
  user:"read the attachment",
  answer:"attachment reviewed",
  state:"SUCCESS",
  responseMode:"native-conversation",
  attachments:[{
    id:reg.artifact.id,
    modality:"text",
    path:file,
    label:"note.txt",
    sourceId:"fixture",
    mediaType:"text/plain",
    contentHash:reg.artifact.contentHash,
    bytes:reg.artifact.bytes
  }],
  evidenceEnvelope:{id:"evidence-1"}
}];
const store={list:()=>rows.map(x=>({id:x.id})),get:id=>rows.find(x=>x.id===id)||null};
const onechat=new OneChatRouter({store});
const history=onechat.history("chat-history",{limit:20});
assert.equal(history.state,"SUCCESS");
assert.equal(history.turns.length,1);
assert.equal(history.turns[0].attachments.length,1);
assert.equal(history.turns[0].attachments[0].id,reg.artifact.id);
assert.equal(history.turns[0].attachments[0].label,"note.txt");
assert.ok(!("path" in history.turns[0].attachments[0]));
assert.ok(!JSON.stringify(history).includes(file));

fs.rmSync(root,{recursive:true,force:true});
console.log("onechat persistent attachment history: ok");
