import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {LocalIdentity} from "../src/governance/identity.js";
import {AuditLog} from "../src/audit.js";

const directRoot=fs.mkdtempSync(path.join(os.tmpdir(),"uai-owner-v049-direct-"));
try{
  const audit=new AuditLog(directRoot);
  const identity=new LocalIdentity(directRoot,audit,{sessionHours:1});
  const email="owner-v049@example.local",password="BootstrapPassword-123456";
  const boot=identity.bootstrapFromEnvironment({UAI_OWNER_EMAIL:email,UAI_OWNER_PASSWORD:password});
  assert.equal(boot.state,"SUCCESS");
  assert.equal(boot.bootstrapped,true);
  assert.equal(identity.status().identityConfigured,true);
  assert.equal(identity.status().enrollmentRequired,false);
  assert.equal(identity.status().authenticationMode,"email-password-session");
  assert.equal(identity.status().legacyBearerTokenAccepted,false);
  const stored=identity.db.get("identity","owner-local").record;
  assert.equal(stored.email,email);
  assert.equal(stored.credentialSource,"ENV_BOOTSTRAP");
  assert.notEqual(stored.passwordHash,password);
  assert.equal(JSON.stringify(stored).includes(password),false);

  const login=identity.login(email,password);
  assert.equal(login.state,"SUCCESS");
  const bearerOnly=identity.authenticateRequest({headers:{authorization:"Bearer legacy-owner-token"}});
  assert.equal(bearerOnly.authenticated,false);

  const req={headers:{cookie:`uai_session=${encodeURIComponent(login.sessionToken)}; uai_csrf=${encodeURIComponent(login.csrfToken)}`}};
  assert.equal(identity.authenticateRequest(req).authenticated,true);

  const rotated=identity.configureOwner("rotated-v049@example.local","RotatedPassword-123456",{replace:true,credentialSource:"LOCAL_CLI"});
  assert.equal(rotated.state,"SUCCESS");
  assert.ok(rotated.revokedSessions>=1);
  assert.equal(identity.authenticateRequest(req).authenticated,false);
  assert.equal(identity.verify(email,password),false);
  assert.equal(identity.verify("rotated-v049@example.local","RotatedPassword-123456"),true);
  assert.equal(audit.verify().state,"SUCCESS");
}finally{
  fs.rmSync(directRoot,{recursive:true,force:true});
}

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-owner-v049-http-"));
const state=path.join(root,"state"),db=path.join(root,"knowledge.sqlite3"),objects=path.join(root,"objects");
const email="bootstrap-http@example.local",password="BootstrapHttpPassword-123456";
const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
const child=spawn(process.execPath,[path.resolve("server.js")],{
  cwd:path.resolve(path.dirname(new URL(import.meta.url).pathname),".."),
  env:{...process.env,PORT:String(port),IUV_STATE_DIR:state,IUV_DB_PATH:db,IUV_OBJECT_ROOT:objects,UAI_OWNER_EMAIL:email,UAI_OWNER_PASSWORD:password},
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
  const session=raw.match(/uai_session=([^;,]+)/)?.[1],csrfCookie=raw.match(/uai_csrf=([^;,]+)/)?.[1];
  const csrf=body.csrfToken||decodeURIComponent(csrfCookie||"");
  assert.ok(session&&csrf);
  return {cookie:`uai_session=${session}; uai_csrf=${csrfCookie}`,csrf};
}
try{
  let ready=false;
  for(let i=0;i<80;i++){try{const r=await fetch(base+"/api/status");if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(ready,true,`server did not start\nstdout=${stdout}\nstderr=${stderr}`);

  const status=await req("/api/status");
  assert.equal(status.r.status,200);
  assert.equal(status.x.ownerAuthentication.mode,"email-password-session");
  assert.equal(status.x.ownerAuthentication.legacyBearerTokenAccepted,false);
  assert.equal(status.x.ownerAuthentication.bootstrapApplied,true);

  const authStatus=await req("/api/auth/status");
  assert.equal(authStatus.x.identityConfigured,true);
  assert.equal(authStatus.x.enrollmentRequired,false);

  const bearer=await req("/api/models",{headers:{authorization:"Bearer obsolete-owner-token"}});
  assert.equal(bearer.r.status,401);
  assert.equal(bearer.x.state,"UNAUTHENTICATED");

  const enroll=await req("/api/auth/enroll",{method:"POST",body:{email:"other@example.local",password:"OtherPassword-123456"}});
  assert.equal(enroll.r.status,409);
  assert.equal(enroll.x.state,"DENIED");

  const login=await req("/api/auth/login",{method:"POST",body:{email,password}});
  assert.equal(login.r.status,200);
  assert.equal(login.x.state,"SUCCESS");
  assert.equal(login.x.sessionToken,undefined);
  const auth=authFrom(login.r,login.x);

  const chat=await req("/api/onechat",{method:"POST",headers:{cookie:auth.cookie,"x-uai-csrf":auth.csrf},body:{message:"hello",chatId:"owner-v049"}});
  assert.equal(chat.r.status,200);
  assert.ok(["SUCCESS","PARTIAL","UNAVAILABLE"].includes(chat.x.state));
}finally{
  child.kill("SIGTERM");
  await new Promise(resolve=>{child.once("close",resolve);setTimeout(resolve,1000);});
  fs.rmSync(root,{recursive:true,force:true});
}
console.log("v0.49 owner email/password bootstrap, rotation and bearer-token retirement tests passed");
