import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {AuditLog} from "../src/audit.js";
import {AgentRegistry} from "../src/agent-system.js";
import {AvailabilityLedger} from "../src/availability-ledger.js";
import {ControlCenter} from "../src/control-center.js";
import {IdempotencyStore} from "../src/idempotency-store.js";
import {PluginExecutor} from "../src/plugin-executor.js";
import {PluginRegistry,pluginManifestDigest} from "../src/plugin-registry.js";
import {PolicyEngine} from "../src/policy-engine.js";

// Tamper-evident audit log anchors legacy records and owns its integrity metadata.
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-audit-v043-"));
  fs.writeFileSync(path.join(root,"audit.jsonl"),JSON.stringify({id:"legacy-1",at:"2026-01-01T00:00:00Z",type:"legacy"})+"\n");
  const audit=new AuditLog(root);
  const a=audit.append({type:"fixture.first",chainVersion:"attacker-value",prevHash:"attacker-value"});
  assert.equal(a.chainVersion,"uai-audit-v1");
  assert.notEqual(a.prevHash,"attacker-value");
  audit.append({type:"fixture.second"});
  const verified=audit.verify();
  assert.equal(verified.state,"SUCCESS");
  assert.equal(verified.legacyRecords,1);
  assert.equal(verified.verifiedRecords,2);

  const lines=fs.readFileSync(audit.file,"utf8").trimEnd().split("\n");
  lines[0]=JSON.stringify({id:"legacy-1",at:"2026-01-01T00:00:00Z",type:"tampered"});
  fs.writeFileSync(audit.file,lines.join("\n")+"\n");
  assert.equal(audit.verify().state,"DENIED");
}

// Legacy JSON registries migrate into the transactional governance store without deleting data.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-control-v043-"));
fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(path.join(root,"agents.json"),JSON.stringify([
  {id:"legacy-specialist",name:"Legacy Specialist",role:"specialist",capabilities:["knowledge.read"],builtin:false,parentId:"explorative",createdAt:"2026-01-01T00:00:00Z",lineage:["explorative","legacy-specialist"]}
],null,2));
fs.writeFileSync(path.join(root,"accounts.json"),JSON.stringify([
  {id:"acct-legacy",name:"Legacy Account",provider:"local",credentialState:"NOT_STORED_HERE",createdAt:"2026-01-01T00:00:00Z"}
],null,2));
fs.writeFileSync(path.join(root,"subscriptions.json"),JSON.stringify([
  {id:"sub-legacy",name:"Legacy Plan",provider:"manual",plan:"Legacy",liveBillingVerified:false,createdAt:"2026-01-01T00:00:00Z"}
],null,2));
fs.writeFileSync(path.join(root,"plugins.json"),JSON.stringify([
  {id:"legacy-plugin",name:"Legacy Plugin",kind:"manifest",availability:"REGISTERED_NOT_VERIFIED",capabilities:[],createdAt:"2026-01-01T00:00:00Z"}
],null,2));
fs.writeFileSync(path.join(root,"availability.json"),JSON.stringify([
  {observedAt:"2026-01-01T00:00:00Z",total:1,connected:1,configured:0,entries:[{id:"legacy.cap",availability:"CONNECTED",executable:true}]}
],null,2));

const audit=new AuditLog(root);
const agents=new AgentRegistry(root,audit);
assert.ok(agents.get("legacy-specialist"));
assert.ok(agents.get("research"));
assert.ok(fs.existsSync(path.join(root,"agents.json.migrated-v043")));
const spawned=agents.spawn({parentId:"explorative",name:"Bounded Child",capabilities:["knowledge.read","source.apply"]});
assert.equal(spawned.state,"SUCCESS");
assert.deepEqual(spawned.agent.capabilities,["knowledge.read"]);
assert.deepEqual(spawned.deniedCapabilities,["source.apply"]);

const control=new ControlCenter(root,audit);
assert.ok(control.accounts.get("acct-legacy"));
assert.ok(control.subscriptions.get("sub-legacy"));
assert.ok(control.plugins.get("legacy-plugin"));
assert.ok(control.plugins.get("local-knowledge"));
const newAccount=control.addAccount({name:"New",provider:"local"});
assert.equal(control.accounts.get(newAccount.id).credentialState,"NOT_STORED_HERE");
assert.ok(fs.existsSync(path.join(root,"accounts.json.migrated-v043")));
assert.ok(fs.existsSync(path.join(root,"subscriptions.json.migrated-v043")));
assert.ok(fs.existsSync(path.join(root,"plugins.json.migrated-v043")));

const availability=new AvailabilityLedger(root);
assert.equal(availability.latest().entries[0].id,"legacy.cap");
const snap=availability.record([
  {id:"local.ok",availability:"CONNECTED",executable:true},
  {id:"configured.only",availability:"CONFIGURED",executable:false}
]);
assert.equal(snap.connected,1);
assert.equal(snap.configured,1);
assert.equal(availability.latest().id,snap.id);
assert.ok(fs.existsSync(path.join(root,"availability.json.migrated-v043")));

// Plugin idempotency prevents duplicate execution and key reuse for a different request.
const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const manifest={
  id:"idempotent.fixture",
  name:"Idempotent Fixture",
  version:"1.0.0",
  entrypoint:"fixture.js",
  capabilities:["knowledge.read"],
  permissions:{filesystem:{read:[],write:[]},network:{allow:[]},process:{spawn:false}},
  risk:"low",
  timeoutMs:2000,
  reversible:true,
  provenance:{source:"fixture",sha256:"0".repeat(64)}
};
manifest.signature={
  algorithm:"ed25519",
  publicKeyPem:publicKey.export({type:"spki",format:"pem"}),
  signatureBase64:crypto.sign(null,Buffer.from(pluginManifestDigest(manifest),"utf8"),privateKey).toString("base64")
};
const registry=new PluginRegistry(root,audit);
assert.equal(registry.register(manifest).state,"SUCCESS");
const idem=new IdempotencyStore(root,audit);
const executor=new PluginExecutor({registry,policyEngine:new PolicyEngine(),idempotencyStore:idem,audit});

const oldSandbox=process.env.IUV_PLUGIN_SANDBOX_COMMAND;
const oldHome=process.env.HOME;
process.env.HOME=root;
process.env.IUV_PLUGIN_SANDBOX_COMMAND="cat >/dev/null; printf x >> \"$HOME/plugin-counter\"; echo '{\"ok\":true}'";
try{
  const first=await executor.execute("idempotent.fixture",{q:"same"},null,"request-1");
  assert.equal(first.state,"SUCCESS");
  assert.equal(fs.readFileSync(path.join(root,"plugin-counter"),"utf8"),"x");

  const replay=await executor.execute("idempotent.fixture",{q:"same"},null,"request-1");
  assert.equal(replay.state,"SUCCESS");
  assert.equal(replay.idempotentReplay,true);
  assert.equal(fs.readFileSync(path.join(root,"plugin-counter"),"utf8"),"x");

  const collision=await executor.execute("idempotent.fixture",{q:"different"},null,"request-1");
  assert.equal(collision.state,"DENIED");
  assert.equal(fs.readFileSync(path.join(root,"plugin-counter"),"utf8"),"x");
}finally{
  if(oldSandbox===undefined)delete process.env.IUV_PLUGIN_SANDBOX_COMMAND;else process.env.IUV_PLUGIN_SANDBOX_COMMAND=oldSandbox;
  if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;
}

assert.equal(audit.verify().state,"SUCCESS");
console.log("v0.43 control-plane modernization tests passed");
