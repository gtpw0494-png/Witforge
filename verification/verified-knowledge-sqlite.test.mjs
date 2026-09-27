import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VerifiedKnowledgeStore } from "../src/verified-knowledge-store.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-vk-sqlite-"));
const legacyDir=path.join(root,"knowledge-autonomy");
fs.mkdirSync(legacyDir,{recursive:true});
const legacyFact={
  fact_id:"legacy-fact-1",
  subject:"legacy",
  claim:"verified migrated fact",
  source_id:"source-a",
  source_url:"https://a.example/doc",
  verification:{verified:true,training_rights_verified:true},
  training_eligible:true,
  stored_at:"2026-01-01T00:00:00.000Z"
};
fs.writeFileSync(path.join(legacyDir,"verified-facts.json"),JSON.stringify([legacyFact],null,2));

const first=new VerifiedKnowledgeStore({stateRoot:root});
let snap=first.snapshot();
assert.equal(snap.count,1);
assert.equal(snap.training_eligible,1);
assert.equal(snap.journal_mode.toLowerCase(),"wal");
assert.equal(snap.migration.migrated,1);
assert.equal(fs.existsSync(path.join(legacyDir,"verified-facts.json")),false);
assert.equal(fs.existsSync(path.join(legacyDir,"verified-facts.json.migrated")),true);

const fact={
  subject:"new",
  claim:"sqlite deduplicates verified knowledge",
  source_id:"source-b",
  source_url:"https://b.example/doc",
  verification:{verified:true,training_rights_verified:true},
  training_eligible:true
};
let out=first.upsertMany([fact]);
assert.equal(out.state,"SUCCESS");
assert.equal(out.written,1);
assert.equal(out.total,2);

const second=new VerifiedKnowledgeStore({stateRoot:root});
out=second.upsertMany([fact]);
assert.ok(["SUCCESS","PARTIAL"].includes(out.state));
snap=second.snapshot();
assert.equal(snap.count,2);
assert.equal(snap.training_eligible,2);
assert.match(snap.integrity_sha256,/^[a-f0-9]{64}$/);
assert.equal(snap.integrity_complete,true);

const denied={
  subject:"bad",
  claim:"must not persist",
  source_id:"source-x",
  source_url:"https://x.example/doc",
  verification:{verified:true,training_rights_verified:false},
  training_eligible:true
};
assert.equal(second.upsertMany([denied]).written,0);
assert.equal(second.snapshot().count,2);

first.close();
second.close();
console.log("verified knowledge sqlite migration: ok");
