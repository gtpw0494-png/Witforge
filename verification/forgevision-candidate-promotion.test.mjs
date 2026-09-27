import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {ForgeVisionCandidatePromotion} from "../src/forgevision-candidate-promotion.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-vision-promote-"));
const candidate=path.join(root,"model","runs","vision-candidate","forgevision.pt");
const dataset=path.join(root,"vision-eval.jsonl");
fs.mkdirSync(path.dirname(candidate),{recursive:true});
fs.writeFileSync(candidate,"vision-candidate");
fs.writeFileSync(dataset,'{"image":"fixture.png","text":"fixture"}\n');

const calls=[];
const promotion=new ForgeVisionCandidatePromotion({
  root,
  stateRoot:path.join(root,"state"),
  runner:async(command,args)=>{calls.push([command,args]);return{state:"SUCCESS",code:0,stdout:JSON.stringify({state:"SUCCESS",passed:true,candidateMeanCosine:0.8,baselineMeanCosine:null,externalModels:false})+"\n",stderr:""};}
});

const status0=promotion.status();
assert.equal(status0.state,"UNAVAILABLE");
const evaluation=await promotion.evaluate({candidate,dataset,minCosine:0.1});
assert.equal(evaluation.eligible,true);
assert.equal(evaluation.baseline,null);
assert.equal(promotion.promote({candidate,evaluation}).state,"WAITING_APPROVAL");

const first=promotion.promote({candidate,evaluation,approved:true,approvalId:"approval-vision-1"});
assert.equal(first.state,"SUCCESS");
assert.equal(first.bootstrap,true);
assert.equal(first.previous,null);
assert.equal(fs.readFileSync(promotion.live,"utf8"),"vision-candidate");
assert.equal(promotion.status().state,"CONFIGURED");

fs.writeFileSync(candidate,"vision-candidate-v2");
const evaluation2=await promotion.evaluate({candidate,dataset});
assert.equal(evaluation2.eligible,true);
const second=promotion.promote({candidate,evaluation:evaluation2,approved:true,approvalId:"approval-vision-2"});
assert.equal(second.state,"SUCCESS");
assert.ok(second.previous?.id);
assert.equal(fs.readFileSync(promotion.live,"utf8"),"vision-candidate-v2");

fs.writeFileSync(candidate,"tampered-after-eval");
assert.equal(promotion.promote({candidate,evaluation:evaluation2,approved:true,approvalId:"approval-vision-2"}).state,"BLOCKED");

const rollback=promotion.rollback(second.previous.id,{reason:"test-regression"});
assert.equal(rollback.state,"SUCCESS");
assert.equal(fs.readFileSync(promotion.live,"utf8"),"vision-candidate");
assert.ok(calls.some(([,args])=>args.includes("model/eval/vision_compare.py")));
console.log("forgevision candidate promotion: ok");
