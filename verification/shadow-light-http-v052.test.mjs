import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-v052-http-"));
const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
const child=spawn(process.execPath,[path.resolve("server.js")],{
  cwd:path.resolve(path.dirname(new URL(import.meta.url).pathname),".."),
  env:{...process.env,PORT:String(port),IUV_STATE_DIR:root,IUV_DB_PATH:path.join(root,"data.sqlite3"),IUV_OBJECT_ROOT:path.join(root,"objects")},
  stdio:["ignore","pipe","pipe"]
});
let stdout="",stderr="";child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);
const base=`http://127.0.0.1:${port}`;
async function req(url,{method="GET",headers={},body}={}){
  const h={...headers};if(body!==undefined&&!h["content-type"])h["content-type"]="application/json";
  const r=await fetch(base+url,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let x={};try{x=text?JSON.parse(text):{};}catch{x={raw:text};}
  return {r,x};
}
function authFrom(response,body){
  const raw=response.headers.get("set-cookie")||"";
  const session=raw.match(/uai_session=([^;,]+)/)?.[1],csrfCookie=raw.match(/uai_csrf=([^;,]+)/)?.[1];
  const csrf=body.csrfToken||decodeURIComponent(csrfCookie||"");assert.ok(session&&csrf);
  return {cookie:`uai_session=${session}; uai_csrf=${csrfCookie}`,csrf};
}
try{
  let ready=false;
  for(let i=0;i<80;i++){try{const r=await fetch(base+"/api/status");if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(ready,true,`server did not start\nstdout=${stdout}\nstderr=${stderr}`);
  const enroll=await req("/api/auth/enroll",{method:"POST",body:{email:"v052-owner@example.local",password:"V052-Owner-Password-123456"}});
  assert.equal(enroll.r.status,201);const auth=authFrom(enroll.r,enroll.x);
  const read={cookie:auth.cookie},write={cookie:auth.cookie,"x-uai-csrf":auth.csrf};

  const status=await req("/api/status");
  assert.equal(status.x.version,JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname),".."),"package.json"),"utf8")).version);
  assert.equal(status.x.shadow.mode,"BOUNDED_VIRTUAL_AGENTS");
  assert.equal(status.x.light.mode,"ISOLATED_WORKTREE_ONLY");
  assert.equal(status.x.light.directMainCommit,false);

  const roadmap=await req("/api/platform/roadmap",{headers:read});
  assert.equal(roadmap.r.status,200);
  assert.equal(roadmap.x.partialOrNotDemonstrated.find(x=>x.id==="full-multimodal-ingestion").claimableAsComplete,false);

  const shadowAgents=await req("/api/shadow/agents",{headers:read});
  assert.equal(shadowAgents.r.status,200);assert.ok(shadowAgents.x.agents.length>=20);
  const shadowRun=await req("/api/shadow/runs",{method:"POST",headers:write,body:{agentType:"research-discovery",objective:"compare approved evidence only"}});
  assert.equal(shadowRun.r.status,200);assert.equal(shadowRun.x.state,"SUCCESS");assert.equal(shadowRun.x.run.state,"QUEUED");

  const sim=await req("/api/shadow/simulate",{method:"POST",headers:write,body:{id:shadowRun.x.run.id,evidence:[{source:"fixture",verified:true}],observations:["alpha","beta"]}});
  assert.equal(sim.r.status,200);assert.equal(sim.x.candidate.state,"PENDING_PROMOTION");assert.equal(sim.x.candidate.productionEligible,false);assert.equal(sim.x.candidate.trainingEligible,false);

  const lightAgents=await req("/api/light/agents",{headers:read});
  assert.equal(lightAgents.r.status,200);assert.ok(lightAgents.x.agents.length>=20);
  const patch=await req("/api/light/patches",{method:"POST",headers:write,body:{agentType:"test-repair",objective:"reproduce and repair a deterministic test"}});
  assert.equal(patch.r.status,200);assert.equal(patch.x.patch.state,"PROPOSED");

  const emergency=await req("/api/governance/emergency/engage",{method:"POST",headers:write,body:{reason:"v0.52 HTTP verification"}});
  assert.equal(emergency.r.status,200);assert.equal(emergency.x.engaged,true);
  const blocked=await req("/api/shadow/runs",{method:"POST",headers:write,body:{agentType:"research-discovery",objective:"must be blocked while stopped"}});
  assert.equal(blocked.r.status,423);assert.equal(blocked.x.state,"BLOCKED");

  const gov=await req("/api/governance/status",{headers:read});
  assert.equal(gov.r.status,200);assert.equal(gov.x.emergencyStop.engaged,true);
  assert.ok(gov.x.protectedRules.includes("protected-branch"));
}finally{
  child.kill("SIGTERM");
  await new Promise(resolve=>{child.once("close",resolve);setTimeout(resolve,1000);});
  fs.rmSync(root,{recursive:true,force:true});
}
console.log("v0.52 shadow/light/governance HTTP integration tests passed");
