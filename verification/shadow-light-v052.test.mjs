import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {AuditLog} from "../src/audit.js";
import {ShadowCoordinator} from "../src/shadow/shadow-coordinator.js";
import {LightCoordinator} from "../src/light/light-coordinator.js";
import {platformCapabilityCatalog} from "../src/platform-capability-catalog.js";
import {PROTECTED_GOVERNANCE_RULES} from "../src/governance/promotion-rules.js";

const stateRoot=fs.mkdtempSync(path.join(os.tmpdir(),"uai-v052-")),audit=new AuditLog(stateRoot);
const shadow=new ShadowCoordinator({stateRoot,audit,maxWorkers:2});
assert.ok(shadow.registry.list().length>=20);
const s=shadow.submit({agentType:"research-discovery",objective:"compare approved retrieval evidence",budget:{concurrency:999,depth:999}});
assert.equal(s.state,"SUCCESS");assert.equal(s.run.state,"QUEUED");assert.ok(s.run.budget.concurrency<=4);assert.ok(s.run.budget.depth<=4);
const sim=await shadow.simulate(s.run.id,{evidence:[{source:"fixture",verified:true}],observations:["claim a","claim b"]});
assert.equal(sim.state,"SUCCESS");assert.equal(sim.candidate.state,"PENDING_PROMOTION");assert.equal(sim.candidate.trainingEligible,false);assert.equal(sim.candidate.productionEligible,false);
assert.equal(shadow.promote(sim.candidate.id,null,{evidence:true,evaluation:true}).state,"DENIED");
const ownerAuth={allowed:true,auth:{authenticated:true,role:"owner",identityId:"owner-local"}};
const promoted=shadow.promote(sim.candidate.id,ownerAuth,{evidence:true,evaluation:true});
assert.equal(promoted.state,"SUCCESS");assert.equal(promoted.candidate.productionEligible,false);assert.equal(promoted.candidate.trainingEligible,false);

const light=new LightCoordinator({root:process.cwd(),stateRoot,audit,maxWorkers:2});
assert.ok(light.registry.list().length>=20);
const p=light.propose({agentType:"test-repair",objective:"repair a failing deterministic test",baseRef:"HEAD"});
assert.equal(p.state,"SUCCESS");assert.equal(p.patch.state,"PROPOSED");assert.equal(light.status().directMainCommit,false);
const bad=light.evaluator.evaluate({tests:[{state:"FAILURE"}],security:true,shadowReview:true,changedFiles:["x.js"]});
assert.equal(bad.state,"BLOCKED");assert.ok(bad.blockers.includes("tests"));
const good=light.evaluator.evaluate({tests:[{state:"SUCCESS"}],security:{state:"SUCCESS"},shadowReview:{state:"SUCCESS"},changedFiles:["x.js"]});
assert.equal(good.state,"SUCCESS");assert.equal(good.eligible,true);

const catalog=platformCapabilityCatalog();
assert.equal(catalog.principle.includes("no universal-superiority claim"),true);
assert.equal(catalog.partialOrNotDemonstrated.find(x=>x.id==="full-multimodal-ingestion").claimableAsComplete,false);
assert.ok(catalog.pluginTypes.includes("shadow.spawn"));assert.ok(catalog.toolAbilities.includes("light-patching"));
assert.ok(PROTECTED_GOVERNANCE_RULES.includes("protected-branch"));
console.log("v0.52 shadow/light/governance truth tests passed");
