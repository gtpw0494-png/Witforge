import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {ForgeLMCandidatePromotion} from "../src/forgelm-candidate-promotion.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-forgelm-bootstrap-"));
const candidate=path.join(root,"model","runs","bootstrap","forgelm.pt");
const dataset=path.join(root,"model","data","dataset-v2");
fs.mkdirSync(path.dirname(candidate),{recursive:true});
fs.mkdirSync(dataset,{recursive:true});
fs.writeFileSync(candidate,"candidate-bytes");

const promotion=new ForgeLMCandidatePromotion({
  root,
  stateRoot:path.join(root,"state"),
  runner:async()=>({
    state:"SUCCESS",
    code:0,
    stdout:JSON.stringify({state:"SUCCESS",passed:true,parameters:1234,lossesFinite:true,trainingTrendAcceptable:true,generatedTokens:4,externalModels:false})+"\n",
    stderr:""
  })
});

const evaluation=await promotion.evaluate({candidate,dataset});
assert.equal(evaluation.state,"SUCCESS");
assert.equal(evaluation.eligible,true);
assert.equal(evaluation.bootstrap,true);
assert.equal(evaluation.baseline,null);

assert.equal(promotion.promote({candidate,evaluation}).state,"WAITING_APPROVAL");
const promoted=promotion.promote({candidate,evaluation,approved:true,approvalId:"bootstrap-test"});
assert.equal(promoted.state,"SUCCESS");
assert.equal(promoted.bootstrap,true);
assert.equal(promoted.previous,null);
assert.ok(fs.existsSync(path.join(root,"model","checkpoints","forgelm-seed.pt")));
assert.equal(fs.readFileSync(path.join(root,"model","checkpoints","forgelm-seed.pt"),"utf8"),"candidate-bytes");

fs.rmSync(root,{recursive:true,force:true});
console.log("forgelm bootstrap promotion: ok");
