import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-v053-http-"));
const repoRoot=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
const child=spawn(process.execPath,[path.resolve("server.js")],{
  cwd:repoRoot,
  env:{...process.env,PORT:String(port),IUV_STATE_DIR:root,IUV_DB_PATH:path.join(root,"data.sqlite3"),IUV_OBJECT_ROOT:path.join(root,"objects"),IUV_AGENT_WORKERS:"1",IUV_AGENT_QUEUE:"16",IUV_AGENT_LEASE_MS:"5000"},
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
  for(let i=0;i<100;i++){try{const r=await fetch(base+"/api/status");if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(ready,true,`server did not start\nstdout=${stdout}\nstderr=${stderr}`);

  const enroll=await req("/api/auth/enroll",{method:"POST",body:{email:"v053-owner@example.local",password:"V053-Owner-Password-123456"}});
  assert.equal(enroll.r.status,201);const auth=authFrom(enroll.r,enroll.x);
  const read={cookie:auth.cookie},write={cookie:auth.cookie,"x-uai-csrf":auth.csrf};

  const cp=await req("/api/control-plane/status",{headers:read});
  assert.equal(cp.r.status,200);assert.equal(cp.x.scheduler.mode,"PERSISTENT_BOUNDED_LEASE_QUEUE");
  assert.equal(cp.x.storage.tables["shadow-run"],"shadow_runs");
  assert.equal(cp.x.storage.tables["shadow-candidate"],"shadow_candidates");
  assert.equal(cp.x.storage.tables["light-patch"],"light_patches");
  assert.equal(cp.x.storage.tables["light-worktree"],"light_worktrees");
  assert.equal(cp.x.storage.tables["agent-job"],"agent_jobs");

  const dashboard=await req("/api/control-plane/dashboard",{headers:read});
  assert.equal(dashboard.r.status,200);assert.equal(dashboard.x.generatedFor,JSON.parse(fs.readFileSync(path.join(repoRoot,"package.json"),"utf8")).version);
  assert.ok(dashboard.x.tasks&&dashboard.x.capabilities&&dashboard.x.models&&dashboard.x.plugins&&dashboard.x.approvals);
  assert.ok(dashboard.x.shadow&&dashboard.x.light&&dashboard.x.scheduler&&dashboard.x.evidence&&dashboard.x.audit);
  assert.ok(dashboard.x.evidence.features.some(x=>x.id==="typed-agent-control-plane-v053"));
  const home=await fetch(base+"/");assert.equal(home.status,200);assert.match(await home.text(),/Operations dashboard/);

  const shadowRun=await req("/api/shadow/runs",{method:"POST",headers:write,body:{agentType:"research-discovery",objective:"dispatch a governed research simulation",simulationInput:{evidence:[{source:"fixture",verified:true}],observations:["alpha","beta"]}}});
  assert.equal(shadowRun.r.status,200);assert.equal(shadowRun.x.state,"SUCCESS");assert.equal(shadowRun.x.job.state,"QUEUED");
  const shadowDispatch=await req("/api/control-plane/dispatch",{method:"POST",headers:write,body:{queue:"shadow",workerId:"http-shadow-worker"}});
  assert.equal(shadowDispatch.r.status,200);assert.equal(shadowDispatch.x.state,"SUCCESS");assert.equal(shadowDispatch.x.job.state,"COMPLETED");
  assert.equal(shadowDispatch.x.execution.candidate.state,"PENDING_PROMOTION");
  assert.equal(shadowDispatch.x.execution.candidate.productionEligible,false);
  const jobs=await req("/api/control-plane/jobs?queue=shadow",{headers:read});
  assert.equal(jobs.r.status,200);assert.ok(jobs.x.jobs.some(x=>x.subjectId===shadowRun.x.run.id&&x.state==="COMPLETED"));

  const lightPatch=await req("/api/light/patches",{method:"POST",headers:write,body:{agentType:"test-repair",objective:"create an isolated worktree for governed HTTP verification",baseRef:"HEAD"}});
  assert.equal(lightPatch.r.status,200);assert.equal(lightPatch.x.state,"SUCCESS");assert.equal(lightPatch.x.job.state,"QUEUED");
  const lightDispatch=await req("/api/light/dispatch",{method:"POST",headers:write,body:{workerId:"http-light-worker"}});
  assert.equal(lightDispatch.r.status,200);assert.equal(lightDispatch.x.state,"SUCCESS");assert.equal(lightDispatch.x.execution.patch.state,"WORKTREE_CREATED");
  assert.ok(lightDispatch.x.execution.worktree.path.includes("light-worktrees"));
  const rollback=await req("/api/light/rollback",{method:"POST",headers:write,body:{id:lightPatch.x.patch.id,reason:"v0.53 HTTP test cleanup"}});
  assert.equal(rollback.r.status,200);assert.equal(rollback.x.state,"SUCCESS");assert.equal(rollback.x.patch.state,"REJECTED");

  const maintenance=await req("/api/control-plane/maintenance",{method:"POST",headers:write,body:{}});
  assert.equal(maintenance.r.status,200);assert.equal(maintenance.x.state,"SUCCESS");

  const pending=await req("/api/shadow/runs",{method:"POST",headers:write,body:{agentType:"research-discovery",objective:"must remain queued once emergency stop engages"}});
  assert.equal(pending.r.status,200);assert.equal(pending.x.job.state,"QUEUED");
  const emergency=await req("/api/governance/emergency/engage",{method:"POST",headers:write,body:{reason:"v0.53 control-plane emergency verification"}});
  assert.equal(emergency.r.status,200);assert.equal(emergency.x.engaged,true);
  const blocked=await req("/api/control-plane/dispatch",{method:"POST",headers:write,body:{queue:"shadow",workerId:"blocked-worker"}});
  assert.equal(blocked.r.status,423);assert.equal(blocked.x.state,"BLOCKED");

  console.log("v0.53 governed control-plane HTTP integration tests passed");
}finally{
  child.kill("SIGTERM");
  await new Promise(resolve=>{child.once("close",resolve);setTimeout(resolve,1500);});
  fs.rmSync(root,{recursive:true,force:true});
}
