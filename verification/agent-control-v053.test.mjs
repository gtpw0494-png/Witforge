import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {AuditLog} from "../src/audit.js";
import {GovernanceDb} from "../src/governance-db.js";
import {ControlPlaneStore} from "../src/control-plane-store.js";
import {BoundedWorkerScheduler} from "../src/control-plane-scheduler.js";
import {CandidateStore} from "../src/shadow/candidate-store.js";
import {ShadowCoordinator} from "../src/shadow/shadow-coordinator.js";
import {LightCoordinator} from "../src/light/light-coordinator.js";

const roots=[];
const tmp=prefix=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),prefix));roots.push(p);return p;};
try{
  const storageRoot=tmp("uai-v053-store-"),store=new ControlPlaneStore(storageRoot);
  const status=store.status();
  assert.equal(status.state,"SUCCESS");
  assert.equal(status.tables["shadow-run"],"shadow_runs");
  assert.equal(status.tables["shadow-candidate"],"shadow_candidates");
  assert.equal(status.tables["light-patch"],"light_patches");
  assert.equal(status.tables["light-worktree"],"light_worktrees");
  assert.equal(status.tables["agent-job"],"agent_jobs");

  const legacyRoot=tmp("uai-v053-migrate-"),legacy=new GovernanceDb(legacyRoot);
  assert.equal(legacy.create("shadow-candidate",{id:"candidate-legacy",runId:"shadow-legacy",kind:"research",state:"QUARANTINED",trainingEligible:false,productionEligible:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}).state,"SUCCESS");
  const migrated=new CandidateStore(legacyRoot);
  assert.equal(migrated.get("candidate-legacy").id,"candidate-legacy");
  assert.equal(migrated.db.status().counts["shadow-candidate"],1);
  legacy.close();

  let now=1_800_000_000_000;
  const schedulerRoot=tmp("uai-v053-scheduler-"),audit=new AuditLog(schedulerRoot);
  const scheduler=new BoundedWorkerScheduler({stateRoot:schedulerRoot,audit,maxWorkers:1,maxQueue:3,leaseMs:5000,clock:()=>now});
  const first=scheduler.submit({queue:"shadow",subjectId:"subject-1",agentType:"research-discovery",priority:80});
  const second=scheduler.submit({queue:"shadow",subjectId:"subject-2",agentType:"research-discovery",priority:10});
  assert.equal(first.state,"SUCCESS");assert.equal(second.state,"SUCCESS");
  const claim=scheduler.claim("worker-a",{queue:"shadow"});
  assert.equal(claim.state,"SUCCESS");assert.equal(claim.job.subjectId,"subject-1");assert.equal(claim.job.state,"RUNNING");
  assert.equal(scheduler.claim("worker-b",{queue:"shadow"}).state,"BLOCKED");
  now+=6000;
  const recovered=scheduler.maintenance(now);
  assert.ok(recovered.recovered.includes(claim.job.id));
  const reclaimed=scheduler.claim("worker-b",{queue:"shadow"});
  assert.equal(reclaimed.state,"SUCCESS");assert.equal(reclaimed.job.subjectId,"subject-1");assert.equal(reclaimed.job.attempts,2);
  assert.equal(scheduler.finish(reclaimed.job.id,"worker-a",{resultState:"SUCCESS"}).state,"DENIED");
  assert.equal(scheduler.finish(reclaimed.job.id,"worker-b",{resultState:"SUCCESS",result:{verified:true}}).job.state,"COMPLETED");
  const exp=scheduler.submit({queue:"light",subjectId:"subject-exp",expiresAt:new Date(now+1000).toISOString()});
  assert.equal(exp.state,"SUCCESS");now+=2000;
  const expired=scheduler.maintenance(now);assert.ok(expired.expired.includes(exp.job.id));
  assert.equal(scheduler.db.get("agent-job",exp.job.id).record.state,"EXPIRED");

  const shadowRoot=tmp("uai-v053-shadow-"),shadowAudit=new AuditLog(shadowRoot);
  const shadowScheduler=new BoundedWorkerScheduler({stateRoot:shadowRoot,audit:shadowAudit,maxWorkers:1,maxQueue:8,leaseMs:5000});
  const shadow=new ShadowCoordinator({stateRoot:shadowRoot,audit:shadowAudit,maxWorkers:1,scheduler:shadowScheduler});
  const run=shadow.submit({agentType:"research-discovery",objective:"evaluate governed retrieval evidence",simulationInput:{evidence:[{source:"fixture",verified:true}],observations:["alpha","beta"]}});
  assert.equal(run.state,"SUCCESS");assert.equal(run.run.state,"QUEUED");assert.equal(run.job.state,"QUEUED");
  const dispatched=await shadow.dispatchNext("shadow-worker-v053");
  assert.equal(dispatched.state,"SUCCESS");assert.equal(dispatched.job.state,"COMPLETED");
  assert.equal(dispatched.execution.candidate.state,"PENDING_PROMOTION");
  assert.equal(dispatched.execution.candidate.trainingEligible,false);
  assert.equal(dispatched.execution.candidate.productionEligible,false);
  assert.equal(shadowScheduler.list({queue:"shadow"}).filter(x=>x.state==="RUNNING").length,0);

  const lightRoot=tmp("uai-v053-light-"),lightAudit=new AuditLog(lightRoot);
  process.env.IUV_LIGHT_PATCH_TTL_MS="60000";
  const lightScheduler=new BoundedWorkerScheduler({stateRoot:lightRoot,audit:lightAudit,maxWorkers:1,maxQueue:8});
  const light=new LightCoordinator({root:process.cwd(),stateRoot:lightRoot,audit:lightAudit,maxWorkers:1,scheduler:lightScheduler});
  const proposal=light.propose({agentType:"test-repair",objective:"reproduce a deterministic failing test",baseRef:"HEAD"});
  assert.equal(proposal.state,"SUCCESS");assert.equal(proposal.patch.state,"PROPOSED");assert.equal(proposal.job.state,"QUEUED");
  const maintained=light.maintenance(Date.now()+61000);
  assert.ok(maintained.rejected.includes(proposal.patch.id));
  assert.equal(light.get(proposal.patch.id).state,"REJECTED");
  assert.equal(lightScheduler.list({queue:"light"}).find(x=>x.subjectId===proposal.patch.id).state,"EXPIRED");
  delete process.env.IUV_LIGHT_PATCH_TTL_MS;

  console.log("v0.53 typed control-plane, scheduler, recovery and migration tests passed");
}finally{
  delete process.env.IUV_LIGHT_PATCH_TTL_MS;
  for(const root of roots)fs.rmSync(root,{recursive:true,force:true});
}
