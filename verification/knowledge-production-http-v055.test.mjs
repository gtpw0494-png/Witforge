import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";

const stateRoot=fs.mkdtempSync(path.join(os.tmpdir(),"uai-v055-http-"));
const repoRoot=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const child=spawn(process.execPath,[path.resolve("server.js")],{cwd:repoRoot,env:{...process.env,PORT:String(port),IUV_STATE_DIR:stateRoot,IUV_DB_PATH:path.join(stateRoot,"data.sqlite3"),IUV_OBJECT_ROOT:path.join(stateRoot,"objects")},stdio:["ignore","pipe","pipe"]});
let stdout="",stderr="";child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);
const base=`http://127.0.0.1:${port}`;

async function req(url,{method="GET",headers={},body}={}){
  const h={...headers};if(body!==undefined&&!h["content-type"])h["content-type"]="application/json";
  const r=await fetch(base+url,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let x={};try{x=text?JSON.parse(text):{};}catch{x={raw:text};}
  return{r,x};
}
function authFrom(response,body){
  const raw=response.headers.get("set-cookie")||"";
  const session=raw.match(/uai_session=([^;,]+)/)?.[1],csrfCookie=raw.match(/uai_csrf=([^;,]+)/)?.[1],csrf=body.csrfToken||decodeURIComponent(csrfCookie||"");
  assert.ok(session&&csrf);
  return{cookie:`uai_session=${session}; uai_csrf=${csrfCookie}`,csrf};
}

try{
  let ready=false;
  for(let i=0;i<100;i++){try{const r=await fetch(base+"/api/status");if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(ready,true,`server did not start\nstdout=${stdout}\nstderr=${stderr}`);

  const enroll=await req("/api/auth/enroll",{method:"POST",body:{email:"v055-owner@example.local",password:"V055-Owner-Password-123456"}});
  assert.equal(enroll.r.status,201);
  const auth=authFrom(enroll.r,enroll.x),read={cookie:auth.cookie},write={cookie:auth.cookie,"x-uai-csrf":auth.csrf};

  const status=await req("/api/knowledge/autonomy/status",{headers:read});
  assert.equal(status.r.status,200);
  assert.equal(status.x.verification,"independent-approved-source-corroboration");

  const ingest=await req("/api/knowledge/autonomy/verify-ingest",{method:"POST",headers:write,body:{items:[
    {subject:"fixture",claim:"A verified fixture claim.",source_id:"python-docs",source_url:"https://docs.python.org/3/reference/"},
    {subject:"fixture",claim:"A verified fixture claim.",source_id:"github-docs",source_url:"https://docs.github.com/en"}
  ]}});
  assert.equal(ingest.r.status,200);
  assert.equal(ingest.x.verification.verified,1);
  assert.equal(ingest.x.verification.training_eligible,1);
  assert.equal(ingest.x.persisted.local.written,1);
  assert.equal(ingest.x.persisted.durability,"LOCAL_ONLY");

  const store=await req("/api/knowledge/store/status",{headers:read});
  assert.equal(store.r.status,200);
  assert.equal(store.x.local.training_eligible,1);

  const trainBlocked=await req("/api/knowledge/learning/train",{method:"POST",headers:write,body:{limit:10,steps:1,preset:"termux-tiny"}});
  assert.equal(trainBlocked.r.status,409);
  assert.ok(["ASK","ESCALATE"].includes(trainBlocked.x.state));

  const scheduleBlocked=await req("/api/knowledge/research/schedule",{method:"POST",headers:write,body:{topics:["python"],intervalMs:60000,enabled:true}});
  assert.equal(scheduleBlocked.r.status,409);
  assert.ok(["ASK","ESCALATE"].includes(scheduleBlocked.x.state));

  const cloudSyncBlocked=await req("/api/knowledge/cloud/sync",{method:"POST",headers:write,body:{limit:100}});
  assert.equal(cloudSyncBlocked.r.status,409);
  assert.ok(["ASK","ESCALATE"].includes(cloudSyncBlocked.x.state));

  const promoteBlocked=await req("/api/model/promote",{method:"POST",headers:write,body:{runId:"model-run-missing",approvalId:"approval-missing"}});
  assert.equal(promoteBlocked.r.status,403);
  assert.ok(["DENIED","BLOCKED","FAILURE"].includes(promoteBlocked.x.state));

  const evalMissing=await req("/api/model/evaluate",{method:"POST",headers:write,body:{runId:"model-run-missing"}});
  assert.equal(evalMissing.r.status,409);
  assert.equal(evalMissing.x.state,"UNAVAILABLE");

  console.log("v0.55 production knowledge HTTP boundaries passed");
}finally{
  child.kill("SIGTERM");
  await new Promise(resolve=>{child.once("close",resolve);setTimeout(resolve,1500);});
  fs.rmSync(stateRoot,{recursive:true,force:true});
}
