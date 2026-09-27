import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";

const stateRoot=fs.mkdtempSync(path.join(os.tmpdir(),"uai-v054-http-"));
const repoRoot=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const child=spawn(process.execPath,[path.resolve("server.js")],{cwd:repoRoot,env:{...process.env,PORT:String(port),IUV_STATE_DIR:stateRoot,IUV_DB_PATH:path.join(stateRoot,"data.sqlite3"),IUV_OBJECT_ROOT:path.join(stateRoot,"objects"),IUV_MEMORY_KEY:crypto.randomBytes(32).toString("base64")},stdio:["ignore","pipe","pipe"]});
let stdout="",stderr="";child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);
const base=`http://127.0.0.1:${port}`;
async function req(url,{method="GET",headers={},body}={}){
  const h={...headers};if(body!==undefined&&!h["content-type"])h["content-type"]="application/json";
  const r=await fetch(base+url,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let x={};try{x=text?JSON.parse(text):{};}catch{x={raw:text};}return {r,x};
}
function authFrom(response,body){const raw=response.headers.get("set-cookie")||"",session=raw.match(/uai_session=([^;,]+)/)?.[1],csrfCookie=raw.match(/uai_csrf=([^;,]+)/)?.[1],csrf=body.csrfToken||decodeURIComponent(csrfCookie||"");assert.ok(session&&csrf);return {cookie:`uai_session=${session}; uai_csrf=${csrfCookie}`,csrf};}
try{
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+"/api/status");if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(ready,true,`server did not start\nstdout=${stdout}\nstderr=${stderr}`);
  const publicStatus=await req("/api/status");assert.equal(publicStatus.x.memory.state,"LOCKED");

  const enroll=await req("/api/auth/enroll",{method:"POST",body:{email:"v054-owner@example.local",password:"V054-Owner-Password-123456"}});
  assert.equal(enroll.r.status,201);const auth=authFrom(enroll.r,enroll.x),read={cookie:auth.cookie},write={cookie:auth.cookie,"x-uai-csrf":auth.csrf};

  const denied=await req("/api/memory/remember",{method:"POST",headers:write,body:{text:"no consent",consent:false}});
  assert.equal(denied.r.status,200);assert.equal(denied.x.state,"DENIED");
  const remembered=await req("/api/memory/remember",{method:"POST",headers:write,body:{text:"Use local-first execution for private work",namespace:"user",sourceId:"source-http",consent:true,reason:"v0.54 HTTP explicit memory",trainingAllowed:true}});
  assert.equal(remembered.r.status,200);assert.equal(remembered.x.state,"SUCCESS");assert.equal(remembered.x.memory.trainingAllowed,false);assert.equal(remembered.x.memory.encryptionState,"AES_256_GCM");
  const memoryId=remembered.x.memory.id;
  const search=await req("/api/memory/search?q=local-first",{headers:read});assert.equal(search.r.status,200);assert.equal(search.x.results[0].id,memoryId);
  const why=await req(`/api/memory/why?id=${encodeURIComponent(memoryId)}`,{headers:read});assert.equal(why.x.reason,"v0.54 HTTP explicit memory");

  const oneRemember=await req("/api/onechat",{method:"POST",headers:write,body:{message:"remember that my UAI preference is evidence-first operation","chatId":"v054-memory"}});
  assert.equal(oneRemember.r.status,200);assert.ok(["SUCCESS","PARTIAL"].includes(oneRemember.x.state));
  const oneShow=await req("/api/onechat",{method:"POST",headers:write,body:{message:"show memory","chatId":"v054-memory"}});
  assert.equal(oneShow.r.status,200);assert.ok(JSON.stringify(oneShow.x).includes("evidence-first"));

  const sourceNode=await req("/api/provenance/nodes",{method:"POST",headers:write,body:{type:"source",subjectId:"source-http",sourceId:"source-http",uri:"https://example.test/source"}});
  assert.equal(sourceNode.x.state,"SUCCESS");
  const memoryNode=await req("/api/provenance/nodes",{method:"POST",headers:write,body:{type:"memory",subjectId:memoryId,sourceId:"source-http"}});
  assert.equal(memoryNode.x.state,"SUCCESS");
  const edge=await req("/api/provenance/edges",{method:"POST",headers:write,body:{fromId:sourceNode.x.node.id,toId:memoryNode.x.node.id,relation:"DERIVED_FROM"}});
  assert.equal(edge.x.state,"SUCCESS");
  const trace=await req(`/api/provenance/trace?id=${sourceNode.x.node.id}&direction=out`,{headers:read});assert.equal(trace.x.nodes.length,2);
  const purgePlan=await req(`/api/provenance/purge-plan?id=${sourceNode.x.node.id}`,{headers:read});assert.equal(purgePlan.x.mode,"DRY_RUN");assert.ok(purgePlan.x.memoryPurges.includes(memoryId));

  const sim=await req("/api/policy/simulate",{method:"POST",headers:write,body:{objective:"preview external source update",steps:[{operation:"source.modify",risk:"high",mutatesSource:true,dataTouched:["src/example.js"]},{operation:"external.send",risk:"medium",external:true,destination:"https://example.test",dataClassification:"private"}]}});
  assert.equal(sim.r.status,200);assert.equal(sim.x.state,"SUCCESS");assert.equal(sim.x.simulation.executionPerformed,false);assert.ok(sim.x.simulation.approvalsRequired.length>=1);

  const artifactPath=path.join(repoRoot,"model","forgelm.py"),digest=crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  const artifact=await req("/api/model-artifacts/verify",{method:"POST",headers:write,body:{path:"model/forgelm.py",expectedSha256:digest}});
  assert.equal(artifact.r.status,200);assert.equal(artifact.x.state,"SUCCESS");assert.equal(artifact.x.verified,true);assert.equal(artifact.x.runtimeAvailability,"UNVERIFIED_RUNTIME");
  const registered=await req("/api/model-artifacts/register",{method:"POST",headers:write,body:{modelId:"forgelm-source-fixture",version:"v054",path:"model/forgelm.py",expectedSha256:digest}});
  assert.equal(registered.x.state,"SUCCESS");assert.equal(registered.x.artifact.productionEligible,false);

  const evalRun=await req("/api/evaluations/record",{method:"POST",headers:write,body:{subjectId:"forgelm-source-fixture",subjectType:"model",category:"groundedness",benchmark:"v054-http-fixture",metrics:{score:0.75,citationPrecision:1},evidence:[{type:"system-test",id:"v054-http"}],verified:true}});
  assert.equal(evalRun.x.evaluation.state,"VERIFIED");
  const board=await req("/api/evaluations/leaderboard?category=groundedness&metric=score",{headers:read});assert.equal(board.x.entries[0].subjectId,"forgelm-source-fixture");

  const dashboard=await req("/api/control-plane/dashboard",{headers:read});assert.equal(dashboard.r.status,200);assert.ok(dashboard.x.memory.active>=2);assert.ok(dashboard.x.provenance.nodes>=2);assert.ok(dashboard.x.evaluations.verified>=1);assert.ok(dashboard.x.modelArtifacts.total>=1);assert.ok(dashboard.x.policySimulations.total>=1);

  const emergency=await req("/api/governance/emergency/engage",{method:"POST",headers:write,body:{reason:"v0.54 emergency-stop verification"}});
  assert.equal(emergency.x.engaged,true);
  const blocked=await req("/api/memory/remember",{method:"POST",headers:write,body:{text:"must not persist while stopped",consent:true}});
  assert.equal(blocked.r.status,423);assert.equal(blocked.x.state,"BLOCKED");

  console.log("v0.54 memory/provenance/policy/artifact/evaluation HTTP integration tests passed");
}finally{
  child.kill("SIGTERM");await new Promise(resolve=>{child.once("close",resolve);setTimeout(resolve,1500);});fs.rmSync(stateRoot,{recursive:true,force:true});
}
