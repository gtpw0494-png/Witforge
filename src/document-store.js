import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(args,{input=null,timeout=60000}={}){
  return new Promise(resolve=>{
    const p=spawn(process.env.PYTHON||"python3",[path.join(root,"storage","documents.py"),...args],{cwd:root,env:process.env});
    let out="",err="",settled=false;
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
    const timer=setTimeout(()=>{p.kill("SIGKILL");finish({state:"TIMEOUT",message:"Document data-plane command timed out."});},timeout);
    p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
    p.on("error",e=>finish({state:"UNAVAILABLE",message:e.message}));
    p.on("close",code=>{
      if(settled)return;
      if(code!==0)return finish({state:"ERROR",message:(err||out||`Document command exited ${code}`).slice(0,4000)});
      try{finish(JSON.parse(out.trim().split(/\n/).filter(Boolean).at(-1)||"{}"));}catch{finish({state:"ERROR",message:(err||out||"Invalid document-store response").slice(0,4000)});}
    });
    if(input!==null)p.stdin.end(JSON.stringify(input));else p.stdin.end();
  });
}

export class DocumentStore{
  init(){return run(["init"]);}
  status(){return run(["status"]);}
  ingest(document){return run(["ingest"],{input:document,timeout:120000});}
  search(query,limit=8){return run(["search","--query",String(query),"--limit",String(limit)]);}
  get(id){return run(["get","--id",String(id)]);}
  list({limit=100,status=null}={}){const a=["list","--limit",String(limit)];if(status)a.push("--status",String(status));return run(a);}
  delete(id,reason="user-requested deletion"){return run(["delete","--id",String(id),"--reason",String(reason)]);}
  purge(id,reason="user-requested purge"){return run(["purge","--id",String(id),"--reason",String(reason)]);}
  reindex(){return run(["reindex"],{timeout:120000});}
}
