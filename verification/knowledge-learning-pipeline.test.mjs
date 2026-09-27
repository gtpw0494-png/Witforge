import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KnowledgeJobStore } from "../src/knowledge-job-store.js";
import { KnowledgeLearningPipeline } from "../src/knowledge-learning-pipeline.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-klifecycle-"));
const jobs=new KnowledgeJobStore({stateRoot:root});
const trainingJob={execute:async()=>({
  state:"SUCCESS",job_id:"job-1",trained:true,batch_count:2,dataset:"/dataset",
  dataset_manifest:{records:2},candidate_checkpoint:"/candidate.pt",candidate_sha256:"a".repeat(64),
  promoted:false,production_eligible:false
})};
const promotion={
  evaluate:async()=>({state:"SUCCESS",eligible:true,candidate_sha256:"a".repeat(64),comparison:{passed:true}}),
  promote:({approved,approvalId})=>approved&&approvalId?{state:"SUCCESS",promoted:true,previous:{id:"rb-1"}}:{state:"WAITING_APPROVAL",promoted:false},
  rollback:id=>({state:"SUCCESS",rolled_back:true,rollback_id:id})
};
const pipeline=new KnowledgeLearningPipeline({trainingJob,promotion,jobStore:jobs});
const trained=await pipeline.trainCandidate({count:2,batch:[{},{}]});
assert.equal(trained.job.phase,"CANDIDATE_READY");
const evaluated=await pipeline.evaluateCandidate("job-1");
assert.equal(evaluated.job.phase,"EVALUATED");
assert.equal(pipeline.promoteCandidate("job-1").state,"WAITING_APPROVAL");
const promoted=pipeline.promoteCandidate("job-1",{approved:true,approvalId:"approval-1"});
assert.equal(promoted.state,"SUCCESS");
assert.equal(promoted.job.production_eligible,true);
const rolled=pipeline.rollbackPromotion("job-1",{reason:"regression"});
assert.equal(rolled.state,"SUCCESS");
assert.equal(rolled.job.phase,"ROLLED_BACK");
assert.equal(rolled.job.production_eligible,false);
console.log("knowledge learning lifecycle: ok");
