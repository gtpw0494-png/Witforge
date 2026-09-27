import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VerifiedKnowledgeStore } from "../src/verified-knowledge-store.js";
import { CloudKnowledgeStore } from "../src/cloud-knowledge-store.js";
import { HybridKnowledgeStore } from "../src/hybrid-knowledge-store.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-cloud-knowledge-"));
const local=new VerifiedKnowledgeStore({stateRoot:root});
const fact={subject:"x",claim:"verified",source_id:"a",source_url:"https://a.example",verification:{verified:true,training_rights_verified:true},training_eligible:true,fact_id:"f1"};
let calls=0;
const cloud=new CloudKnowledgeStore({endpoint:"https://db.example",apiKey:"secret",fetchImpl:async(url,opts)=>{calls++;assert.equal(opts.method,"POST");assert.ok(!opts.body.includes("unverified"));return{ok:true,status:201}}});
const hybrid=new HybridKnowledgeStore({local,cloud});
const out=await hybrid.upsertMany([fact,{subject:"x",claim:"unverified",verification:{verified:false},training_eligible:false}]);
assert.equal(out.durability,"LOCAL_AND_CLOUD");
assert.equal(calls,1);
assert.equal(local.filterTrainingEligible(10).length,1);
const unavailable=new CloudKnowledgeStore();
assert.equal(unavailable.status().state,"UNAVAILABLE");
assert.equal((await unavailable.putMany([fact])).state,"UNAVAILABLE");
console.log("cloud knowledge storage: ok");

const recoveryRoot=fs.mkdtempSync(path.join(os.tmpdir(),"uai-cloud-recovery-"));
const recoveryLocal=new VerifiedKnowledgeStore({stateRoot:recoveryRoot});
const fakeCloud={
  status:()=>({state:"CONFIGURED",configured:true}),
  list:async()=>({state:"SUCCESS",records:[{
    subject:"recovery",claim:"must be reverified",training_eligible:true,
    supporting_sources:[
      {source_id:"a",source_url:"https://a.example/doc",content_hash:"1"},
      {source_id:"b",source_url:"https://b.example/doc",content_hash:"2"}
    ]
  }]})
};
let verifierCalls=0;
const recoveryHybrid=new HybridKnowledgeStore({local:recoveryLocal,cloud:fakeCloud});
const recovery=await recoveryHybrid.recoverFromCloud({verifier:{verifyFacts(items){verifierCalls++;assert.equal(items.length,2);return{state:"SUCCESS",verified:0,training_eligible:0,facts:[{subject:"recovery",claim:"must be reverified",source_id:"a",source_url:"https://a.example/doc",verification:{verified:false,training_rights_verified:false},training_eligible:false}]};}}});
assert.equal(verifierCalls,1);
assert.equal(recovery.recovered,0);
assert.equal(recoveryLocal.filterTrainingEligible(10).length,0);

const syncRoot=fs.mkdtempSync(path.join(os.tmpdir(),"uai-cloud-sync-"));
const syncLocal=new VerifiedKnowledgeStore({stateRoot:syncRoot});
syncLocal.upsertMany([fact]);
let synced=0;
const syncHybrid=new HybridKnowledgeStore({local:syncLocal,cloud:{status:()=>({state:"CONFIGURED"}),putMany:async rows=>{synced=rows.length;return{state:"SUCCESS",written:rows.length,connected:true}}}});
const syncResult=await syncHybrid.syncCloud({limit:10});
assert.equal(syncResult.state,"SUCCESS");
assert.equal(syncResult.attempted,1);
assert.equal(syncResult.written,1);
assert.equal(synced,1);
syncLocal.close();
console.log("cloud reconciliation: ok");
