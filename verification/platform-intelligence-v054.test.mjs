import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {AuditLog} from "../src/audit.js";
import {PlatformStateStore} from "../src/platform-state-store.js";
import {MemoryStore} from "../src/memory/memory-store.js";
import {ProvenanceGraph} from "../src/provenance/graph.js";
import {PolicyEngine} from "../src/policy-engine.js";
import {PolicySimulator} from "../src/governance/policy-simulator.js";
import {ModelArtifactVerifier} from "../src/models/artifact-verifier.js";
import {EvaluationStore} from "../src/evaluation/evaluation-store.js";
import {BenchmarkRunner} from "../src/evaluation/benchmark-runner.js";
import {promotionScore} from "../src/evaluation/promotion-score.js";

const roots=[],tmp=p=>{const x=fs.mkdtempSync(path.join(os.tmpdir(),p));roots.push(x);return x;};
try{
  const stateRoot=tmp("uai-v054-"),audit=new AuditLog(stateRoot);
  const db=new PlatformStateStore(stateRoot),dbStatus=db.status();
  assert.equal(dbStatus.state,"SUCCESS");
  for(const table of ["memory_items","memory_settings","provenance_nodes","provenance_edges","model_artifacts","evaluation_runs","policy_simulations","verified_knowledge"])assert.ok(Object.values(dbStatus.tables).includes(table));

  process.env.IUV_MEMORY_KEY=crypto.randomBytes(32).toString("base64");
  const memory=new MemoryStore({stateRoot,audit});
  assert.equal(memory.remember({ownerId:"owner-a",text:"should not persist",consent:false}).state,"DENIED");
  const remembered=memory.remember({ownerId:"owner-a",namespace:"user",sourceId:"source-a",text:"Preferred local-first execution",consent:true,reason:"explicit test memory",trainingAllowed:true});
  assert.equal(remembered.state,"SUCCESS");assert.equal(remembered.memory.trainingAllowed,false);assert.equal(remembered.memory.encryptionState,"AES_256_GCM");
  const raw=db.get("memory-item",remembered.memory.id).record;assert.equal(raw.payload.mode,"AES_256_GCM");assert.equal(raw.payload.text,undefined);
  assert.equal(memory.search("local-first",{ownerId:"owner-a"}).results[0].id,remembered.memory.id);
  assert.equal(memory.why(remembered.memory.id,"owner-a").sourceId,"source-a");

  assert.equal(memory.setSettings("owner-a",{trainingEnabled:true}).state,"SUCCESS");
  const trainable=memory.remember({ownerId:"owner-a",namespace:"project",sourceId:"source-b",text:"Approved adapter preference",consent:true,trainingAllowed:true});
  assert.equal(trainable.memory.trainingAllowed,true);
  assert.equal(memory.forget(remembered.memory.id,"owner-a").state,"SUCCESS");
  assert.equal(memory.list({ownerId:"owner-a"}).some(x=>x.id===remembered.memory.id),false);
  assert.equal(memory.why(remembered.memory.id,"owner-a").deletionState,"SOFT_DELETED");

  const graph=new ProvenanceGraph({stateRoot,audit,memoryStore:memory});
  const src=graph.addNode({type:"source",subjectId:"source-b",sourceId:"source-b",ownerId:"owner-a",uri:"file://source-b"}).node;
  const memNode=graph.addNode({type:"memory",subjectId:trainable.memory.id,sourceId:"source-b",ownerId:"owner-a"}).node;
  assert.equal(graph.addEdge({fromId:src.id,toId:memNode.id,relation:"DERIVED_FROM"}).state,"SUCCESS");
  const trace=graph.trace(src.id,{direction:"out",depth:4});assert.equal(trace.nodes.length,2);
  const plan=graph.planPurge(src.id);assert.ok(plan.memoryPurges.includes(trainable.memory.id));assert.equal(plan.mode,"DRY_RUN");
  const applied=graph.purge(src.id,{apply:true,ownerId:"owner-a",reason:"test deletion propagation"});assert.equal(applied.state,"SUCCESS");assert.equal(memory.get(trainable.memory.id,{includeDeleted:true}),null);

  const engine=new PolicyEngine(),decision=engine.evaluate({operation:"plugin.send",risk:"high",external:true,requiresCredential:true,actor:"owner-a",resource:"plugin:x",arguments:{to:"example"},dataClassification:"private",destination:"https://example.test"});
  assert.equal(decision.decision,"ASK");assert.equal(decision.policyVersion,"uai-policy-v0.54");assert.match(decision.argumentsHash,/^[a-f0-9]{64}$/);assert.ok(decision.riskFactors.includes("external-transfer"));assert.ok(decision.proof.digest);
  const simulator=new PolicySimulator({policyEngine:engine,stateRoot,audit});
  const sim=simulator.simulate({actor:"owner-a",objective:"preview source-changing workflow",steps:[{operation:"source.modify",risk:"high",mutatesSource:true,dataTouched:["src/a.js"]},{operation:"web.send",risk:"medium",external:true,destination:"https://example.test",dataClassification:"private"}]});
  assert.equal(sim.state,"SUCCESS");assert.equal(sim.simulation.executionPerformed,false);assert.ok(sim.simulation.approvalsRequired.length>=1);assert.equal(simulator.list(10).length,1);

  const artifactRoot=tmp("uai-v054-artifact-"),artifactPath=path.join(artifactRoot,"model.gguf");fs.writeFileSync(artifactPath,"uai-model-artifact-fixture");
  const digest=crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  const verifier=new ModelArtifactVerifier({stateRoot,audit,allowedRoots:[artifactRoot]});
  assert.equal(verifier.verify({path:artifactPath,expectedSha256:"0".repeat(64)}).state,"DENIED");
  const verified=verifier.verify({path:artifactPath,expectedSha256:digest});assert.equal(verified.state,"SUCCESS");assert.equal(verified.verified,true);assert.equal(verified.runtimeAvailability,"UNVERIFIED_RUNTIME");
  const registered=verifier.register({modelId:"fixture-model",version:"1",path:artifactPath,expectedSha256:digest});assert.equal(registered.state,"SUCCESS");assert.equal(registered.artifact.productionEligible,false);

  const evaluations=new EvaluationStore({stateRoot,audit});
  const e1=evaluations.record({subjectId:"model-a",category:"groundedness",benchmark:"fixture-v1",metrics:{score:0.8,latencyMs:12},evidence:[{type:"fixture",digest:"a"}],verified:true});
  const e2=evaluations.record({subjectId:"model-b",category:"groundedness",benchmark:"fixture-v1",metrics:{score:0.9},evidence:[],verified:true});
  assert.equal(e1.evaluation.state,"VERIFIED");assert.equal(e2.evaluation.state,"RECORDED_UNVERIFIED");
  const board=evaluations.leaderboard({category:"groundedness",metric:"score"});assert.equal(board.entries.length,1);assert.equal(board.entries[0].subjectId,"model-a");
  const runner=new BenchmarkRunner({evaluationStore:evaluations,audit});
  const run=await runner.run({subjectId:"deterministic-tool",subjectType:"tool",category:"tool-use",benchmark:"echo-v1",cases:[{value:1,expect:1},{value:2,expect:2}],execute:async c=>({state:"SUCCESS",value:c.value}),evidence:[{type:"system-test"}]});
  assert.equal(run.metrics.successRate,1);assert.equal(run.evaluation.state,"VERIFIED");
  assert.equal(promotionScore({tests:true,security:true,privacy:true,rollback:true,provenance:true,critic:true,performanceWithinBudget:true}).eligible,true);
  assert.equal(promotionScore({tests:true}).eligible,false);

  console.log("v0.54 memory, provenance, policy simulation, artifact and evaluation tests passed");
}finally{
  delete process.env.IUV_MEMORY_KEY;
  for(const r of roots)fs.rmSync(r,{recursive:true,force:true});
}
