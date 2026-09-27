import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {LocalIdentity} from "../src/governance/identity.js";
import {AuditLog} from "../src/audit.js";

const directRoot=fs.mkdtempSync(path.join(os.tmpdir(),"uai-auth-direct-"));
try{
  const audit=new AuditLog(directRoot);
  const local=new LocalIdentity(directRoot,audit,{sessionHours:1});
  const initial=local.status();
  assert.equal(initial.identityConfigured,false);
  assert.equal(initial.enrollmentRequired,true);

  const enrolled=local.enroll("owner@example.local","DirectIdentityPassword-12345");
  assert.equal(enrolled.state,"SUCCESS");
  assert.equal(local.status().identityConfigured,true);
  assert.equal(local.verify("owner@example.local","DirectIdentityPassword-12345"),true);
  assert.equal(local.verify("owner@example.local","wrong-password"),false);
  assert.equal(local.enroll("other@example.local","AnotherPassword-12345").state,"DENIED");

  const login=local.login("owner@example.local","DirectIdentityPassword-12345");
  assert.equal(login.state,"SUCCESS");
  assert.ok(login.sessionToken&&login.csrfToken);
  const req={headers:{cookie:`uai_session=${encodeURIComponent(login.sessionToken)}; uai_csrf=${encodeURIComponent(login.csrfToken)}`}};
  const auth=local.authenticateRequest(req);
  assert.equal(auth.authenticated,true);
  assert.equal(auth.identityId,"owner-local");
  assert.equal(local.verifyCsrf(auth,login.csrfToken),true);
  assert.equal(local.verifyCsrf(auth,"wrong-csrf"),false);
  assert.equal(local.logout(req).state,"SUCCESS");
  assert.equal(local.authenticateRequest(req).authenticated,false);
  assert.equal(audit.verify().state,"SUCCESS");
}finally{
  fs.rmSync(directRoot,{recursive:true,force:true});
}

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-api-current-"));
const db=path.join(root,"knowledge.sqlite3");
const objects=path.join(root,"objects");
const state=path.join(root,"state");
const email="owner-http@example.local";
const password="HttpOwnerPassword-123456";
const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
const child=spawn(process.execPath,[path.resolve("server.js")],{
  cwd:path.resolve(path.dirname(new URL(import.meta.url).pathname),".."),
  env:{...process.env,PORT:String(port),IUV_STATE_DIR:state,IUV_DB_PATH:db,IUV_OBJECT_ROOT:objects,IUV_RATE_LIMIT_PER_MINUTE:"10"},
  stdio:["ignore","pipe","pipe"]
});
let stdout="",stderr="";child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);
const base=`http://127.0.0.1:${port}`;

async function parse(r){const t=await r.text();let x={};try{x=t?JSON.parse(t):{};}catch{x={raw:t};}return {r,x};}
async function req(url,{method="GET",headers={},body}={}){
  const h={...headers};if(body!==undefined&&!h["content-type"])h["content-type"]="application/json";
  return parse(await fetch(base+url,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}));
}
function authFrom(response,body){
  const raw=response.headers.get("set-cookie")||"";
  const session=raw.match(/uai_session=([^;,]+)/)?.[1];
  const csrfCookie=raw.match(/uai_csrf=([^;,]+)/)?.[1];
  const csrf=body.csrfToken||decodeURIComponent(csrfCookie||"");
  assert.ok(session&&csrf);
  return {cookie:`uai_session=${session}; uai_csrf=${csrfCookie}`,csrf};
}

try{
  let ready=false;
  for(let i=0;i<80;i++){
    try{const r=await fetch(base+"/api/status");if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(ready,true,`server did not start\nstdout=${stdout}\nstderr=${stderr}`);

  const statusRaw=await fetch(base+"/api/status",{headers:{"x-correlation-id":"corr-auth-current"}});
  const status=await statusRaw.json();
  assert.equal(status.governanceKernel.authorityModel,"LOCAL_SELF_GOVERNED");
  assert.equal(status.governanceKernel.externalGovernanceRequired,false);
  assert.equal(statusRaw.headers.get("x-content-type-options"),"nosniff");
  assert.match(statusRaw.headers.get("content-security-policy")||"",/default-src 'self'/);
  assert.equal(statusRaw.headers.get("x-correlation-id"),"corr-auth-current");
  assert.match(statusRaw.headers.get("x-request-id")||"",/^req-/);

  const authBefore=await req("/api/auth/status");
  assert.equal(authBefore.x.enrollmentRequired,true);
  assert.equal(authBefore.x.authenticated,false);

  const noAuth=await req("/api/onechat",{method:"POST",body:{message:"hello"}});
  assert.equal(noAuth.r.status,401);
  assert.equal(noAuth.x.state,"UNAUTHENTICATED");

  const badOrigin=await req("/api/auth/enroll",{method:"POST",headers:{origin:"https://evil.example"},body:{email,password}});
  assert.equal(badOrigin.r.status,403);
  assert.equal(badOrigin.x.state,"BLOCKED");

  const weak=await req("/api/auth/enroll",{method:"POST",body:{email,password:"short"}});
  assert.equal(weak.r.status,400);
  assert.equal(weak.x.state,"BLOCKED");

  const enroll=await req("/api/auth/enroll",{method:"POST",body:{email,password}});
  assert.equal(enroll.r.status,201);
  assert.equal(enroll.x.state,"SUCCESS");
  assert.equal(enroll.x.enrollment,"COMPLETE");
  assert.equal(enroll.x.sessionToken,undefined);
  assert.ok(enroll.x.csrfToken);
  const auth=authFrom(enroll.r,enroll.x);

  const secondEnroll=await req("/api/auth/enroll",{method:"POST",body:{email:"other@example.local",password:"OtherPassword-123456"}});
  assert.equal(secondEnroll.r.status,409);
  assert.equal(secondEnroll.x.state,"DENIED");

  const badLogin=await req("/api/auth/login",{method:"POST",body:{email,password:"WrongPassword-123456"}});
  assert.equal(badLogin.r.status,401);
  assert.equal(badLogin.x.state,"DENIED");

  const login=await req("/api/auth/login",{method:"POST",body:{email,password}});
  assert.equal(login.r.status,200);
  assert.equal(login.x.state,"SUCCESS");
  assert.equal(login.x.sessionToken,undefined);
  assert.ok(login.x.csrfToken);

  const cookieNoCsrf=await req("/api/onechat",{method:"POST",headers:{cookie:auth.cookie},body:{message:"hello"}});
  assert.equal(cookieNoCsrf.r.status,403);
  assert.match(cookieNoCsrf.x.message,/CSRF/i);

  const invalidDoc=await req("/api/documents/ingest",{method:"POST",headers:{cookie:auth.cookie,"x-uai-csrf":auth.csrf},body:{source_id:"missing-text"}});
  assert.equal(invalidDoc.r.status,400);
  assert.equal(invalidDoc.x.state,"BLOCKED");

  const chat=await req("/api/onechat",{method:"POST",headers:{cookie:auth.cookie,"x-uai-csrf":auth.csrf},body:{message:"hello"}});
  assert.equal(chat.r.status,200);
  assert.ok(["SUCCESS","PARTIAL","UNAVAILABLE"].includes(chat.x.state));

  const authStatus=await req("/api/auth/status",{headers:{cookie:auth.cookie}});
  assert.equal(authStatus.x.authenticated,true);
  assert.equal(authStatus.x.identity.id,"owner-local");
  assert.equal(authStatus.x.identity.email,email);

  const grantBody={scope:["test.operation"],riskCeiling:"low",maxActions:1,durationMs:60000};
  const ask=await req("/api/autonomy/grant",{method:"POST",headers:{cookie:auth.cookie,"x-uai-csrf":auth.csrf},body:grantBody});
  assert.equal(ask.r.status,409);
  assert.equal(ask.x.state,"ASK");
  assert.equal(ask.x.binding.actor,"owner-local");
  assert.equal(ask.x.binding.capability,"governance.autonomy");

  const approvalReq=await req("/api/approvals/request",{method:"POST",headers:{cookie:auth.cookie,"x-uai-csrf":auth.csrf},body:{...ask.x.binding,risk:"high",reason:"current exact HTTP authorization test"}});
  assert.equal(approvalReq.r.status,200);
  assert.equal(approvalReq.x.state,"SUCCESS");
  const approvalId=approvalReq.x.approval.id;

  const decision=await req("/api/approvals/decide",{method:"POST",headers:{cookie:auth.cookie,"x-uai-csrf":auth.csrf},body:{id:approvalId,decision:"APPROVE"}});
  assert.equal(decision.r.status,200);
  assert.equal(decision.x.state,"SUCCESS");

  const granted=await req("/api/autonomy/grant",{method:"POST",headers:{cookie:auth.cookie,"x-uai-csrf":auth.csrf},body:{...grantBody,approvalId}});
  assert.equal(granted.r.status,200);
  assert.equal(granted.x.state,"SUCCESS");

  for(let i=0;i<10;i++){
    const r=await req("/api/models",{headers:{cookie:auth.cookie}});
    assert.equal(r.r.status,200);
  }
  const limited=await req("/api/models",{headers:{cookie:auth.cookie}});
  assert.equal(limited.r.status,429);
  assert.equal(limited.x.state,"BLOCKED");

  const auditRes=await req("/api/audit?limit=500",{headers:{cookie:auth.cookie}});
  assert.equal(auditRes.r.status,200);
  assert.ok(auditRes.x.some(x=>x.type==="api.authorize"&&x.actor==="owner-local"&&x.requestId&&x.correlationId));

  const logout=await req("/api/auth/logout",{method:"POST",headers:{cookie:auth.cookie,"x-uai-csrf":auth.csrf},body:{}});
  assert.equal(logout.r.status,200);
  const afterLogout=await req("/api/auth/status",{headers:{cookie:auth.cookie}});
  assert.equal(afterLogout.x.authenticated,false);
}finally{
  child.kill("SIGTERM");
  await new Promise(resolve=>{child.once("close",resolve);setTimeout(resolve,1000);});
  fs.rmSync(root,{recursive:true,force:true});
}
console.log("Current secure API owner identity, session, CSRF, approval and rate-limit tests passed");
