import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {ForgeSpeechCandidatePromotion} from "../src/forgespeech-candidate-promotion.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-speech-promote-"));
const candidate=path.join(root,"model","runs","speech-candidate","forgespeech.pt");
const dataset=path.join(root,"speech-eval.jsonl");
fs.mkdirSync(path.dirname(candidate),{recursive:true});fs.writeFileSync(candidate,"speech-candidate");fs.writeFileSync(dataset,'{"audio":"fixture.wav","text":"fixture"}\n');
const promotion=new ForgeSpeechCandidatePromotion({root,stateRoot:path.join(root,"state"),runner:async()=>({state:"SUCCESS",code:0,stdout:JSON.stringify({state:"SUCCESS",passed:true,candidateLoss:0.5,baselineLoss:null,externalModels:false})+"\n",stderr:""})});
assert.equal(promotion.status().state,"UNAVAILABLE");
const ev=await promotion.evaluate({candidate,dataset});assert.equal(ev.eligible,true);
assert.equal(promotion.promote({candidate,evaluation:ev}).state,"WAITING_APPROVAL");
const first=promotion.promote({candidate,evaluation:ev,approved:true,approvalId:"speech-1"});assert.equal(first.state,"SUCCESS");assert.equal(first.bootstrap,true);
fs.writeFileSync(candidate,"speech-candidate-v2");const ev2=await promotion.evaluate({candidate,dataset});const second=promotion.promote({candidate,evaluation:ev2,approved:true,approvalId:"speech-2"});assert.equal(second.state,"SUCCESS");assert.ok(second.previous?.id);
fs.writeFileSync(candidate,"tampered");assert.equal(promotion.promote({candidate,evaluation:ev2,approved:true,approvalId:"speech-2"}).state,"BLOCKED");
assert.equal(promotion.rollback(second.previous.id,{reason:"test"}).state,"SUCCESS");
console.log("forgespeech candidate promotion: ok");
