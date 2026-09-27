import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ForgeLMCandidatePromotion } from "../src/forgelm-candidate-promotion.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-promote-"));
const live=path.join(root,"model","checkpoints","forgelm-seed.pt");
const candidate=path.join(root,"model","runs","candidate","forgelm.pt");
const dataset=path.join(root,"state","knowledge-autonomy","training-jobs","job","dataset");
fs.mkdirSync(path.dirname(live),{recursive:true});
fs.mkdirSync(path.dirname(candidate),{recursive:true});
fs.mkdirSync(dataset,{recursive:true});
fs.writeFileSync(live,"baseline");
fs.writeFileSync(candidate,"candidate");
fs.writeFileSync(path.join(dataset,"train.jsonl"),'{"text":"x"}\n');

const promotion=new ForgeLMCandidatePromotion({
  root,stateRoot:path.join(root,"state"),
  runner:async()=>({state:"SUCCESS",code:0,stdout:JSON.stringify({state:"SUCCESS",passed:true,relative_regression:-0.1})+"\n",stderr:""})
});
const evaluation=await promotion.evaluate({candidate,dataset});
assert.equal(evaluation.eligible,true);
assert.equal(promotion.promote({candidate,evaluation}).state,"WAITING_APPROVAL");
const promoted=promotion.promote({candidate,evaluation,approved:true,approvalId:"approval-test"});
assert.equal(promoted.state,"SUCCESS");
assert.equal(fs.readFileSync(live,"utf8"),"candidate");
assert.ok(promoted.previous.id);
const rolled=promotion.rollback(promoted.previous.id,{reason:"test"});
assert.equal(rolled.state,"SUCCESS");
assert.equal(fs.readFileSync(live,"utf8"),"baseline");

fs.writeFileSync(candidate,"tampered");
assert.equal(promotion.promote({candidate,evaluation,approved:true,approvalId:"approval-test"}).state,"BLOCKED");
console.log("forgelm candidate promotion: ok");
