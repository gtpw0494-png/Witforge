import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {ApprovalStore} from "../src/approval-store.js";
import {AuditLog} from "../src/audit.js";
import {AutonomyStore} from "../src/autonomy-store.js";
import {IdempotencyStore} from "../src/idempotency-store.js";
import {PluginGateway} from "../src/plugin-gateway.js";
import {PluginRegistry,pluginManifestDigest} from "../src/plugin-registry.js";
import {PluginSecretBroker} from "../src/plugin-secret-broker.js";
import {PolicyEngine} from "../src/policy-engine.js";
import {validateSchema} from "../src/schema-validator.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-plugin-v044-"));
const audit=new AuditLog(root);
const approvals=new ApprovalStore(root,audit);
const autonomy=new AutonomyStore(root,audit);
const idem=new IdempotencyStore(root,audit);

assert.equal(validateSchema({type:"object",required:["n"],properties:{n:{type:"integer",minimum:1}},additionalProperties:false},{n:2}).state,"SUCCESS");
assert.equal(validateSchema({type:"object",required:["n"],properties:{n:{type:"integer"}},additionalProperties:false},{n:2.5}).state,"BLOCKED");
assert.equal(validateSchema({type:"object",additionalProperties:false},{extra:true}).state,"BLOCKED");

const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const manifest={
  apiVersion:"2",
  id:"gateway.fixture",
  name:"Gateway Fixture",
  version:"2.0.0",
  publisher:"uai-tests",
  entrypoint:"fixture.js",
  capabilities:["fixture.echo"],
  permissions:{
    filesystem:{read:["workspace:read"],write:[]},
    network:{allow:["api.example.com","*.allowed.example"]},
    process:{spawn:false},
    secrets:["API_KEY"]
  },
  risk:"low",
  timeoutMs:2000,
  reversible:true,
  resourceLimits:{cpuMs:1000,memoryMb:64,maxOutputBytes:4096},
  operations:[
    {name:"read",risk:"low",external:false,reversible:true,inputSchema:{type:"object",required:["q"],properties:{q:{type:"string",minLength:1}},additionalProperties:false},outputSchema:{type:"object",required:["ok"],properties:{ok:{type:"boolean"}},additionalProperties:false}},
    {name:"fetch",risk:"medium",external:true,reversible:true,idempotencyRequired:true,inputSchema:{type:"object",required:["url"],properties:{url:{type:"string"}},additionalProperties:false},outputSchema:{type:"object",required:["ok"],properties:{ok:{type:"boolean"}},additionalProperties:false}},
    {name:"write",risk:"high",external:true,reversible:false,idempotencyRequired:true,secrets:["API_KEY"],requiresCapabilities:["network.http"],inputSchema:{type:"object",required:["url","value"],properties:{url:{type:"string"},value:{type:"string"}},additionalProperties:false},outputSchema:{type:"object",required:["ok","secret"],properties:{ok:{type:"boolean"},secret:{type:"string"}},additionalProperties:false}},
    {name:"badout",risk:"low",external:false,reversible:true,inputSchema:{type:"object"},outputSchema:{type:"object",required:["ok"],properties:{ok:{type:"boolean"}},additionalProperties:false}},
    {name:"flood",risk:"low",external:false,reversible:true,resourceLimits:{maxOutputBytes:1024},inputSchema:{type:"object"}},
    {name:"sleep",risk:"low",external:false,reversible:true,timeoutMs:150,inputSchema:{type:"object"}},
    {name:"sleep-long",risk:"low",external:false,reversible:true,timeoutMs:5000,inputSchema:{type:"object"}},
    {name:"needs-cap",risk:"low",external:false,reversible:true,requiresCapabilities:["device.fixture"],inputSchema:{type:"object"},outputSchema:{type:"object",required:["ok"],properties:{ok:{type:"boolean"}},additionalProperties:false}}
  ],
  provenance:{source:"fixture",sha256:"1".repeat(64)}
};
manifest.signature={
  algorithm:"ed25519",
  publicKeyPem:publicKey.export({type:"spki",format:"pem"}),
  signatureBase64:crypto.sign(null,Buffer.from(pluginManifestDigest(manifest),"utf8"),privateKey).toString("base64")
};

const registry=new PluginRegistry(root,audit);
const registered=registry.register(manifest);
assert.equal(registered.state,"SUCCESS");
assert.equal(registered.plugin.signatureState,"SIGNED_VERIFIED");
assert.equal(registry.operation("gateway.fixture","write").risk,"high");

const oldSandbox=process.env.IUV_PLUGIN_SANDBOX_COMMAND;
process.env.IUV_PLUGIN_SANDBOX_COMMAND=[
  'cat >/dev/null',
  'case "$IUV_PLUGIN_OPERATION" in',
  '  read|fetch|needs-cap) echo \'{"ok":true}\' ;;',
  '  write) printf \'{"ok":true,"secret":"%s"}\\n\' "$IUV_SECRET_API_KEY" ;;',
  '  badout) echo \'{"wrong":true}\' ;;',
  '  flood) printf \'%*s\' 5000 \'\' | tr \' \' x ;;',
  '  sleep|sleep-long) sleep 2; echo \'{"ok":true}\' ;;',
  '  *) exit 9 ;;',
  'esac'
].join("\n");

const connectedCaps=async()=>[
  {id:"network.http",availability:"CONNECTED",executable:true},
  {id:"device.fixture",availability:"CONNECTED",executable:true}
];
const gateway=new PluginGateway({
  registry,
  policyEngine:new PolicyEngine(),
  approvalStore:approvals,
  autonomyStore:autonomy,
  idempotencyStore:idem,
  capabilityStatus:connectedCaps,
  secretBroker:new PluginSecretBroker({getter:name=>name==="API_KEY"?"TOPSECRET":undefined}),
  audit
});

try{
  const read=await gateway.execute("gateway.fixture","read",{q:"hello"});
  assert.equal(read.state,"SUCCESS");
  assert.deepEqual(read.result,{ok:true});

  const invalid=await gateway.execute("gateway.fixture","read",{q:"hello",extra:true});
  assert.equal(invalid.state,"BLOCKED");

  const deniedHost=await gateway.execute("gateway.fixture","fetch",{url:"https://evil.example/x"},{idempotencyKey:"fetch-deny"});
  assert.equal(deniedHost.state,"DENIED");

  const fetch1=await gateway.execute("gateway.fixture","fetch",{url:"https://api.example.com/x"},{idempotencyKey:"fetch-1"});
  assert.equal(fetch1.state,"SUCCESS");
  const fetchReplay=await gateway.execute("gateway.fixture","fetch",{url:"https://api.example.com/x"},{idempotencyKey:"fetch-1"});
  assert.equal(fetchReplay.state,"SUCCESS");
  assert.equal(fetchReplay.idempotentReplay,true);
  const fetchCollision=await gateway.execute("gateway.fixture","fetch",{url:"https://api.example.com/y"},{idempotencyKey:"fetch-1"});
  assert.equal(fetchCollision.state,"DENIED");

  const missingKey=await gateway.execute("gateway.fixture","write",{url:"https://api.example.com/write",value:"a"});
  assert.equal(missingKey.state,"ASK");

  const firstAsk=await gateway.execute("gateway.fixture","write",{url:"https://api.example.com/write",value:"a"},{idempotencyKey:"write-1"});
  assert.equal(firstAsk.state,"ASK");
  assert.ok(firstAsk.binding);
  const approval=approvals.request({...firstAsk.binding,risk:"high",reason:"test exact plugin write"});
  assert.equal(approvals.decide(approval.id,"APPROVE").state,"SUCCESS");

  const write=await gateway.execute("gateway.fixture","write",{url:"https://api.example.com/write",value:"a"},{approvalId:approval.id,idempotencyKey:"write-1"});
  assert.equal(write.state,"SUCCESS");
  assert.equal(write.result.ok,true);
  assert.equal(write.result.secret,"[REDACTED]");

  const mutated=await gateway.execute("gateway.fixture","write",{url:"https://api.example.com/write",value:"changed"},{approvalId:approval.id,idempotencyKey:"write-2"});
  assert.equal(mutated.state,"ASK");

  const badout=await gateway.execute("gateway.fixture","badout",{});
  assert.equal(badout.state,"BLOCKED");
  assert.match(badout.message,/output failed schema/i);

  const flood=await gateway.execute("gateway.fixture","flood",{});
  assert.equal(flood.state,"BLOCKED");
  assert.match(flood.message,/output exceeded/i);

  const timed=await gateway.execute("gateway.fixture","sleep",{});
  assert.equal(timed.state,"TIMEOUT");

  const controller=new AbortController();
  setTimeout(()=>controller.abort(),50);
  const cancelled=await gateway.execute("gateway.fixture","sleep-long",{}, {signal:controller.signal});
  assert.equal(cancelled.state,"CANCELLED");

  const missingCapGateway=new PluginGateway({
    registry,policyEngine:new PolicyEngine(),approvalStore:approvals,autonomyStore:autonomy,idempotencyStore:idem,
    capabilityStatus:async()=>[{id:"device.fixture",availability:"UNAVAILABLE",executable:false}],
    secretBroker:new PluginSecretBroker({getter:()=>undefined}),audit
  });
  const capBlocked=await missingCapGateway.execute("gateway.fixture","needs-cap",{});
  assert.equal(capBlocked.state,"UNAVAILABLE");

  const lease=autonomy.grant({scope:["plugin.read"],riskCeiling:"low",maxActions:1,durationMs:60000}).lease;
  const leased=await gateway.execute("gateway.fixture","read",{q:"lease"},{autonomyLeaseId:lease.id});
  assert.equal(leased.state,"SUCCESS");
  const exhausted=await gateway.execute("gateway.fixture","read",{q:"lease2"},{autonomyLeaseId:lease.id});
  assert.equal(exhausted.state,"DENIED");

  assert.equal(audit.verify().state,"SUCCESS");
}finally{
  if(oldSandbox===undefined)delete process.env.IUV_PLUGIN_SANDBOX_COMMAND;
  else process.env.IUV_PLUGIN_SANDBOX_COMMAND=oldSandbox;
}

console.log("v0.44 governed plugin gateway tests passed");
