import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-doc-http-v045-"));
const db=path.join(root,"knowledge.sqlite3");
const objects=path.join(root,"objects");
const state=path.join(root,"state");
const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
const child=spawn(process.execPath,[path.resolve("server.js")],{
  cwd:path.resolve(path.dirname(new URL(import.meta.url).pathname),".."),
  env:{...process.env,PORT:String(port),IUV_STATE_DIR:state,IUV_DB_PATH:db,IUV_OBJECT_ROOT:objects},
  stdio:["ignore","pipe","pipe"]
});
let stdout="",stderr="";child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);
const base=`http://127.0.0.1:${port}`;
const email="document-test@example.local",password="DocumentTestPassword-12345";
let sessionHeaders=null;

async function parse(res){const t=await res.text();let x={};try{x=t?JSON.parse(t):{};}catch{x={raw:t};}return {res,x};}
async function json(url,{method="GET",headers={},body}={}){
  const merged={...(sessionHeaders?.read||{}),...headers};
  if(!["GET","HEAD","OPTIONS"].includes(method))Object.assign(merged,sessionHeaders?.write||{});
  return parse(await fetch(base+url,{method,headers:merged,body:body===undefined?undefined:JSON.stringify(body)}));
}
try{
  let ready=false;
  for(let i=0;i<80;i++){
    try{const r=await fetch(base+"/api/status");if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(ready,true,`server did not start\nstdout=${stdout}\nstderr=${stderr}`);

  const enrollRaw=await fetch(base+"/api/auth/enroll",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
  const enroll=await enrollRaw.json();
  assert.equal(enrollRaw.status,201);
  assert.equal(enroll.state,"SUCCESS");
  const raw=enrollRaw.headers.get("set-cookie")||"";
  const session=raw.match(/uai_session=([^;,]+)/)?.[1],csrfCookie=raw.match(/uai_csrf=([^;,]+)/)?.[1];
  const csrf=enroll.csrfToken||decodeURIComponent(csrfCookie||"");
  assert.ok(session&&csrf);
  const cookie=`uai_session=${session}; uai_csrf=${csrfCookie}`;
  sessionHeaders={read:{cookie},write:{cookie,"x-uai-csrf":csrf,"content-type":"application/json"}};

  const status=(await json("/api/status")).x;
  const expectedVersion=JSON.parse(fs.readFileSync(path.resolve("package.json"),"utf8")).version;
  assert.equal(status.version,expectedVersion);
  assert.equal(status.documentDataPlane.state,"SUCCESS");

  const doc={
    source_id:"fixture:manual",source_name:"Manual Fixture",source_type:"test",
    canonical_uri:"file:///fixture/evidence.txt",original_uri:"file:///fixture/evidence.txt",
    title:"Evidence Fixture",language:"en",mime_type:"text/plain",license:"USER-OWNED",license_source:"fixture",
    retrieval_eligible:true,source_training_eligible:false,training_approved:false,
    provenance:{owner:"test-user",path:"fixture/evidence.txt"},security:{risk:"LOW"},
    text:"UAI keeps evidence provenance attached to each retrieved chunk.\n\nTraining permission remains separate from retrieval permission."
  };
  const ing=(await json("/api/documents/ingest",{method:"POST",body:doc})).x;
  assert.equal(ing.state,"SUCCESS");
  assert.equal(ing.document.status,"RETRIEVAL_ELIGIBLE");
  assert.equal(ing.document.training_eligible,0);
  assert.ok(ing.document.id.startsWith("doc-"));

  const search=(await json("/api/documents/search?q=provenance&limit=5")).x;
  assert.equal(search.state,"SUCCESS");
  assert.ok(search.matches.length>=1);
  assert.equal(search.matches[0].source_id,"fixture:manual");
  assert.ok(search.matches[0].chunk_id.startsWith("chunk-"));
  assert.equal(search.matches[0].provenance.owner,"test-user");

  const chat=(await json("/api/onechat",{method:"POST",body:{message:"document search provenance"}})).x;
  assert.equal(chat.state,"SUCCESS");
  assert.equal(chat.responseMode,"evidence-retrieval");
  assert.equal(chat.evidence.status,"SUPPORTED");
  assert.ok(chat.evidence.sources[0].chunkId.startsWith("chunk-"));
  assert.equal(chat.evidence.sources[0].sourceId,"fixture:manual");

  const deleted=(await json("/api/documents/delete",{method:"POST",body:{id:ing.document.id,reason:"integration test"}})).x;
  assert.equal(deleted.state,"SUCCESS");
  const after=(await json("/api/documents/search?q=provenance&limit=5")).x;
  assert.ok((after.matches||[]).every(x=>x.document_id!==ing.document.id));

  const ds=(await json("/api/documents/status")).x;
  assert.equal(ds.documents,1);
  assert.equal(ds.byStatus.DELETED,1);
}finally{
  child.kill("SIGTERM");
  await new Promise(resolve=>{child.once("close",resolve);setTimeout(resolve,1000);});
  fs.rmSync(root,{recursive:true,force:true});
}
console.log("v0.45 document HTTP and OneChat integration tests passed with owner session + CSRF");
