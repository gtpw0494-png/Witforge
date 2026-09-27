import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {pluginManifestDigest} from "../src/plugin-registry.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-http-v044-"));
const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();
  s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});
});

const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const manifest={
  apiVersion:"2",
  id:"http.fixture",
  name:"HTTP Fixture",
  version:"1.0.0",
  entrypoint:"fixture.js",
  capabilities:["fixture.http"],
  permissions:{filesystem:{read:[],write:[]},network:{allow:["api.example.com"]},process:{spawn:false},secrets:[]},
  risk:"medium",
  timeoutMs:2000,
  reversible:true,
  operations:[{
    name:"fetch",
    risk:"medium",
    external:true,
    reversible:true,
    idempotencyRequired:true,
    inputSchema:{type:"object",required:["url"],properties:{url:{type:"string"}},additionalProperties:false},
    outputSchema:{type:"object",required:["ok"],properties:{ok:{type:"boolean"}},additionalProperties:false}
  }],
  provenance:{source:"http-test",sha256:"2".repeat(64)}
};
manifest.signature={
  algorithm:"ed25519",
  publicKeyPem:publicKey.export({type:"spki",format:"pem"}),
  signatureBase64:crypto.sign(null,Buffer.from(pluginManifestDigest(manifest),"utf8"),privateKey).toString("base64")
};

let stdout="",stderr="";
const child=spawn(process.execPath,[path.resolve("server.js")],{
  cwd:path.resolve(path.dirname(new URL(import.meta.url).pathname),".."),
  env:{
    ...process.env,
    PORT:String(port),
    IUV_STATE_DIR:root,
    IUV_PLUGIN_SANDBOX_COMMAND:"cat >/dev/null; echo '{\"ok\":true}'"
  },
  stdio:["ignore","pipe","pipe"]
});
child.stdout.on("data",d=>stdout+=d);
child.stderr.on("data",d=>stderr+=d);

const base=`http://127.0.0.1:${port}`;
const email="plugin-test@example.local",password="PluginTestPassword-12345";
function sessionFrom(res,body){
  const raw=res.headers.get("set-cookie")||"";
  const session=raw.match(/uai_session=([^;,]+)/)?.[1];
  const csrfCookie=raw.match(/uai_csrf=([^;,]+)/)?.[1];
  const csrf=body.csrfToken||decodeURIComponent(csrfCookie||"");
  assert.ok(session&&csrf);
  return {cookie:`uai_session=${session}; uai_csrf=${csrfCookie}`,csrf};
}
try{
  let ready=false;
  for(let i=0;i<60;i++){
    try{const r=await fetch(base+"/api/status");if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(ready,true,`server did not start\nstdout=${stdout}\nstderr=${stderr}`);

  const enrollRaw=await fetch(base+"/api/auth/enroll",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
  const enroll=await enrollRaw.json();
  assert.equal(enrollRaw.status,201);
  assert.equal(enroll.state,"SUCCESS");
  const auth=sessionFrom(enrollRaw,enroll);
  const readHeaders={cookie:auth.cookie};
  const writeHeaders={"content-type":"application/json","cookie":auth.cookie,"x-uai-csrf":auth.csrf};

  const reg=await fetch(base+"/api/plugins-v1/register",{method:"POST",headers:writeHeaders,body:JSON.stringify({manifest})});
  const registered=await reg.json();
  assert.equal(registered.state,"SUCCESS");
  assert.equal(registered.plugin.signatureState,"SIGNED_VERIFIED");

  const body={pluginId:"http.fixture",operation:"fetch",input:{url:"https://api.example.com/search?q=uai"}};
  const call=()=>fetch(base+"/api/plugins-v1/execute",{
    method:"POST",
    headers:{...writeHeaders,"Idempotency-Key":"http-key-1"},
    body:JSON.stringify(body)
  }).then(r=>r.json());

  const first=await call();
  assert.equal(first.state,"SUCCESS");
  assert.deepEqual(first.result,{ok:true});

  const second=await call();
  assert.equal(second.state,"SUCCESS");
  assert.equal(second.idempotentReplay,true);

  const audit=await fetch(base+"/api/audit?limit=200",{headers:readHeaders}).then(r=>r.json());
  const sandboxRuns=audit.filter(x=>x.type==="plugin.sandbox.complete"&&x.pluginId==="http.fixture");
  assert.equal(sandboxRuns.length,1);

  const collision=await fetch(base+"/api/plugins-v1/execute",{
    method:"POST",
    headers:{...writeHeaders,"Idempotency-Key":"http-key-1"},
    body:JSON.stringify({...body,input:{url:"https://api.example.com/other"}})
  }).then(r=>r.json());
  assert.equal(collision.state,"DENIED");

  const status=await fetch(base+"/api/status").then(r=>r.json());
  const expectedVersion=JSON.parse(fs.readFileSync(path.resolve("package.json"),"utf8")).version;
  assert.equal(status.version,expectedVersion);
  assert.equal(status.pluginGateway.version,"0.44");
  assert.equal(status.pluginGateway.sandboxConfigured,true);
}finally{
  child.kill("SIGTERM");
  await new Promise(resolve=>{child.once("close",resolve);setTimeout(resolve,1000);});
  fs.rmSync(root,{recursive:true,force:true});
}
console.log("v0.44 plugin HTTP gateway integration tests passed with owner session + CSRF");
