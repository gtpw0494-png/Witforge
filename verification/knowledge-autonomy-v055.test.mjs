import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KnowledgeVerifier } from "../src/knowledge-verifier.js";
import { VerifiedKnowledgeStore } from "../src/verified-knowledge-store.js";
import { KnowledgePromotion } from "../src/knowledge-promotion.js";

const registry=[
 {id:"a",domain:"a.example",allowed:true,trust:.95,training_policy:"FACT_EXTRACTION_ALLOWED"},
 {id:"b",domain:"b.example",allowed:true,trust:.90,training_policy:"FACT_EXTRACTION_ALLOWED"},
 {id:"blocked",domain:"bad.example",allowed:false,trust:1}
];
const verifier=new KnowledgeVerifier({registry,minIndependentSources:2});
let r=verifier.verifyGroup([
 {subject:"x",claim:"same fact",source_id:"a",source_url:"https://a.example/doc"},
 {subject:"x",claim:"same fact",source_id:"b",source_url:"https://b.example/doc"}
]);
assert.equal(r.verified,1);
assert.equal(r.facts[0].training_eligible,true);
r=verifier.verifyGroup([{subject:"x",claim:"unverified",source_id:"blocked",source_url:"https://bad.example"}]);
assert.equal(r.verified,0);
r=verifier.verifyGroup([{subject:"x",claim:"spoof",source_id:"a",source_url:"https://evil.example"}]);
assert.equal(r.verified,0);

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-knowledge-"));
const store=new VerifiedKnowledgeStore({stateRoot:root});
const verified=verifier.verifyGroup([
 {subject:"x",claim:"same fact",source_id:"a",source_url:"https://a.example/doc"},
 {subject:"x",claim:"same fact",source_id:"b",source_url:"https://b.example/doc"}
]).facts;
assert.equal(store.upsertMany(verified).written,1);
assert.equal(store.filterTrainingEligible(10).length,1);
assert.match(store.snapshot().integrity_sha256,/^[a-f0-9]{64}$/);

const promotion=new KnowledgePromotion({benchmarkThreshold:.75});
assert.equal(promotion.evaluateBatch({count:1,training_eligible:1},{score:.8}).eligible_for_training,true);
assert.equal(promotion.evaluateBatch({count:1,training_eligible:1},{score:.5}).eligible_for_training,false);
console.log("knowledge autonomy v055: ok");
