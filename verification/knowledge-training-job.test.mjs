import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KnowledgeTrainingJob } from "../src/knowledge-training-job.js";
import { KnowledgeJobStore } from "../src/knowledge-job-store.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-ktrain-"));
fs.mkdirSync(path.join(root,"model","runs"),{recursive:true});
let call=null;
const job=new KnowledgeTrainingJob({
  root,
  stateRoot:path.join(root,"state"),
  runner:async(command,args,opts)=>{
    call={command,args,opts};
    const runName=args[args.indexOf("--run-name")+1];
    const runDir=path.join(root,"model","runs",runName);
    fs.mkdirSync(runDir,{recursive:true});
    const candidate=path.join(runDir,"forgelm.pt");
    fs.writeFileSync(candidate,"candidate-model");
    return{state:"SUCCESS",code:0,stdout:JSON.stringify({state:"SUCCESS",modelCheckpoint:path.relative(root,candidate)})+"\n",stderr:""};
  }
});
assert.equal((await job.execute({count:0,batch:[]})).state,"BLOCKED");
const batch={count:2,batch:[
 {subject:"a",claim:"fact one",fact_id:"1",source_id:"s1",source_url:"https://s1",verification:{verified:true,training_rights_verified:true},training_eligible:true},
 {subject:"b",claim:"fact two",fact_id:"2",source_id:"s2",source_url:"https://s2",verification:{verified:true,training_rights_verified:true},training_eligible:true}
]};
const out=await job.execute(batch,{steps:3,preset:"termux-tiny"});
assert.equal(out.state,"SUCCESS");
assert.equal(out.trained,true);
assert.equal(out.promoted,false);
assert.equal(out.production_eligible,false);
assert.equal(out.batch_count,2);
assert.match(out.candidate_sha256,/^[a-f0-9]{64}$/);
assert.equal(call.command,"python3");
assert.equal(call.args[0],"model/trainer.py");
assert.ok(call.args.includes("--dataset"));
assert.ok(call.args.includes("--run-name"));
assert.ok(fs.existsSync(path.join(out.dataset,"manifest.json")));

const store=new KnowledgeJobStore({stateRoot:root});
store.record({state:"SUCCESS",kind:"training",job_id:out.job_id,candidate_sha256:out.candidate_sha256});
assert.equal(store.list().length,1);
console.log("knowledge training job: ok");
