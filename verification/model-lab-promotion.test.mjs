import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelLab } from "../src/model-lab.js";

const stateRoot=fs.mkdtempSync(path.join(os.tmpdir(),"uai-model-lab-"));
const calls=[];
const promotion={
  evaluate:async input=>{calls.push(["evaluate",input]);return{state:"SUCCESS",eligible:true,candidate_sha256:"a".repeat(64),comparison:{passed:true}};},
  promote:input=>{calls.push(["promote",input]);return input.approved&&input.approvalId?{state:"SUCCESS",promoted:true,previous:{id:"rb-1"}}:{state:"WAITING_APPROVAL",promoted:false};},
  rollback:(id,input)=>{calls.push(["rollback",id,input]);return{state:"SUCCESS",rolled_back:true,rollback_id:id};}
};
const lab=new ModelLab({learning:{build:()=>({state:"SUCCESS"})},audit:null,stateRoot,candidatePromotion:promotion});
lab.remember({runId:"model-run-test",state:"CANDIDATE_READY",dataset:"model/data/dataset-v2",candidateCheckpoint:"/tmp/candidate.pt",candidateSha256:"a".repeat(64),promoted:false,productionEligible:false});

const evaluated=await lab.evaluateCandidate("model-run-test",{maxRelativeRegression:0.01});
assert.equal(evaluated.state,"SUCCESS");
assert.equal(evaluated.run.state,"EVALUATED");
assert.equal(evaluated.run.productionEligible,false);

const waiting=lab.promoteCandidate("model-run-test",{approved:false});
assert.equal(waiting.state,"WAITING_APPROVAL");
const promoted=lab.promoteCandidate("model-run-test",{approved:true,approvalId:"approval-1"});
assert.equal(promoted.state,"SUCCESS");
assert.equal(promoted.run.productionEligible,true);
assert.equal(promoted.run.state,"PROMOTED");

const rolled=lab.rollback("model-run-test",{reason:"regression"});
assert.equal(rolled.state,"SUCCESS");
assert.equal(rolled.run.state,"ROLLED_BACK");
assert.equal(rolled.run.productionEligible,false);
assert.equal(lab.status().candidateFirst,true);
assert.ok(calls.some(x=>x[0]==="evaluate"));
assert.ok(calls.some(x=>x[0]==="promote"));
assert.ok(calls.some(x=>x[0]==="rollback"));
console.log("model lab candidate lifecycle: ok");
