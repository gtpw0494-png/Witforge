import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function sha256File(file){const h=crypto.createHash("sha256");h.update(fs.readFileSync(file));return h.digest("hex")}
function atomicCopy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});const tmp=dst+".tmp-"+process.pid+"-"+Date.now();fs.copyFileSync(src,tmp);fs.renameSync(tmp,dst)}
function run(command,args,{cwd=process.cwd(),timeoutMs=300000}={}){
  return new Promise(resolve=>{
    const child=spawn(command,args,{cwd,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="",settled=false;
    const finish=o=>{if(settled)return;settled=true;clearTimeout(timer);resolve(o)};
    child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);
    child.on("error",e=>finish({state:"UNAVAILABLE",message:String(e.message||e),stdout,stderr}));
    child.on("close",code=>finish({state:code===0?"SUCCESS":"FAILURE",code,stdout,stderr}));
    const timer=setTimeout(()=>{child.kill("SIGTERM");finish({state:"TIMEOUT",stdout,stderr})},timeoutMs);
  });
}
function lastJson(text=""){for(const line of String(text).trim().split(/\r?\n/).reverse()){try{return JSON.parse(line)}catch{}}return null}

export class ForgeLMCandidatePromotion{
  constructor({root=process.cwd(),stateRoot=path.resolve("state"),python=process.env.PYTHON||"python3",runner=run,audit=null}={}){
    this.root=root;this.stateRoot=stateRoot;this.python=python;this.runner=runner;this.audit=audit;
    this.live=path.join(root,"model","checkpoints","forgelm-seed.pt");
    this.dir=path.join(stateRoot,"model-rollbacks");fs.mkdirSync(this.dir,{recursive:true});
  }
  async evaluate({candidate,dataset,maxRelativeRegression=0.02}={}){
    const cand=path.resolve(candidate||"");const data=path.resolve(dataset||"");
    if(!fs.existsSync(cand))return{state:"UNAVAILABLE",eligible:false,message:"Candidate checkpoint missing."};
    if(!fs.existsSync(this.live)){
      const args=["model/eval/bootstrap_candidate.py","--candidate",cand];
      const raw=await this.runner(this.python,args,{cwd:this.root});
      const comparison=lastJson(raw.stdout)||{state:raw.state,message:raw.stderr||"Bootstrap candidate evaluation produced no JSON."};
      const candidateSha=sha256File(cand);
      return{state:comparison.state,eligible:comparison.state==="SUCCESS"&&comparison.passed===true,bootstrap:true,candidate:cand,candidate_sha256:candidateSha,baseline:null,baseline_sha256:null,comparison,command:[this.python,...args]};
    }
    const args=["model/eval/checkpoint_compare.py","--baseline",this.live,"--candidate",cand,"--dataset",data,"--max-relative-regression",String(maxRelativeRegression)];
    const raw=await this.runner(this.python,args,{cwd:this.root});
    const comparison=lastJson(raw.stdout)||{state:raw.state,message:raw.stderr||"Checkpoint comparison produced no JSON."};
    const candidateSha=sha256File(cand),baselineSha=sha256File(this.live);
    return{state:comparison.state,eligible:comparison.state==="SUCCESS"&&comparison.passed===true,candidate:cand,candidate_sha256:candidateSha,baseline:this.live,baseline_sha256:baselineSha,comparison,command:[this.python,...args]};
  }
  snapshotBaseline(label="pre-promotion"){
    if(!fs.existsSync(this.live))return{state:"SUCCESS",snapshot:null,bootstrap:true};
    const id="model-rollback-"+crypto.randomUUID();const backup=path.join(this.dir,id+".pt");atomicCopy(this.live,backup);
    const record={id,label,backup,sha256:sha256File(backup),created_at:new Date().toISOString()};fs.writeFileSync(path.join(this.dir,id+".json"),JSON.stringify(record,null,2)+"\n","utf8");
    return{state:"SUCCESS",snapshot:record};
  }
  promote({candidate,evaluation,approved=false,approvalId=null}={}){
    if(!evaluation?.eligible)return{state:"BLOCKED",promoted:false,message:"Candidate has not passed regression evaluation."};
    if(!approved||!approvalId)return{state:"WAITING_APPROVAL",promoted:false,message:"Explicit owner-bound approval is required.",candidate_sha256:evaluation.candidate_sha256};
    if(sha256File(candidate)!==evaluation.candidate_sha256)return{state:"BLOCKED",promoted:false,message:"Candidate hash changed after evaluation."};
    const snapshot=this.snapshotBaseline("pre-forgelm-promotion");if(snapshot.state!=="SUCCESS")return snapshot;
    atomicCopy(candidate,this.live);const liveSha=sha256File(this.live);
    const out={state:"SUCCESS",promoted:true,approval_id:approvalId,live_checkpoint:this.live,live_sha256:liveSha,previous:snapshot.snapshot||null,bootstrap:snapshot.bootstrap===true,candidate_sha256:evaluation.candidate_sha256,promoted_at:new Date().toISOString()};
    this.audit?.append?.({type:"forgelm.candidate.promoted",approvalId,candidateSha256:evaluation.candidate_sha256,liveSha256:liveSha,rollbackId:snapshot.snapshot?.id||null,bootstrap:out.bootstrap});
    return out;
  }
  rollback(id,{reason="model regression"}={}){
    const meta=path.join(this.dir,String(id)+".json");if(!fs.existsSync(meta))return{state:"FAILURE",message:"Rollback snapshot not found."};
    const record=JSON.parse(fs.readFileSync(meta,"utf8"));if(!fs.existsSync(record.backup))return{state:"FAILURE",message:"Rollback artifact missing."};
    if(sha256File(record.backup)!==record.sha256)return{state:"BLOCKED",message:"Rollback artifact integrity check failed."};
    atomicCopy(record.backup,this.live);const liveSha=sha256File(this.live);
    this.audit?.append?.({type:"forgelm.rollback",rollbackId:id,reason,liveSha256:liveSha});
    return{state:"SUCCESS",rolled_back:true,rollback_id:id,reason,live_sha256:liveSha};
  }
}
export default ForgeLMCandidatePromotion;
