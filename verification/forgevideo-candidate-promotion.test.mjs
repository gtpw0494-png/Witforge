import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {ForgeVideoCandidatePromotion} from "../src/forgevideo-candidate-promotion.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-video-promote-"));
const candidate=path.join(root,"model","runs","video-candidate","forgevideo.pt");
const dataset=path.join(root,"video-eval.jsonl");
fs.mkdirSync(path.dirname(candidate),{recursive:true});fs.writeFileSync(candidate,"video-candidate");fs.writeFileSync(dataset,'{"video":"fixture.mp4","text":"fixture"}\n');
const promotion=new ForgeVideoCandidatePromotion({root,stateRoot:path.join(root,"state"),runner:async()=>({state:"SUCCESS",code:0,stdout:JSON.stringify({state:"SUCCESS",passed:true,candidateMeanCosine:0.8,baselineMeanCosine:null,externalModels:false})+"\n",stderr:""})});
assert.equal(promotion.status().state,"UNAVAILABLE");
const ev=await promotion.evaluate({candidate,dataset});assert.equal(ev.eligible,true);
assert.equal(promotion.promote({candidate,evaluation:ev}).state,"WAITING_APPROVAL");
const first=promotion.promote({candidate,evaluation:ev,approved:true,approvalId:"video-1"});assert.equal(first.state,"SUCCESS");assert.equal(first.bootstrap,true);
fs.writeFileSync(candidate,"video-candidate-v2");const ev2=await promotion.evaluate({candidate,dataset});const second=promotion.promote({candidate,evaluation:ev2,approved:true,approvalId:"video-2"});assert.equal(second.state,"SUCCESS");assert.ok(second.previous?.id);
fs.writeFileSync(candidate,"tampered");assert.equal(promotion.promote({candidate,evaluation:ev2,approved:true,approvalId:"video-2"}).state,"BLOCKED");
assert.equal(promotion.rollback(second.previous.id,{reason:"test"}).state,"SUCCESS");
console.log("forgevideo candidate promotion: ok");
