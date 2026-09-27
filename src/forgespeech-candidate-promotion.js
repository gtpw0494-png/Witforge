import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";

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

export class ForgeSpeechCandidatePromotion{
  constructor({root=process.cwd(),stateRoot=path.resolve("state"),python=process.env.PYTHON||"python3",runner=run,audit=null}={}){
    this.root=root;this.stateRoot=stateRoot;this.python=python;this.runner=runner;this.audit=audit;
    this.live=path.join(root,"model","checkpoints","forgespeech.pt");
    this.dir=path.join(stateRoot,"speech-rollbacks");fs.mkdirSync(this.dir,{recursive:true});
  }
  status(){
    if(!fs.existsSync(this.live))return{state:"UNAVAILABLE",checkpointExists:false,liveCheckpoint:this.live,speechGeneration:false,message:"No promoted ForgeSpeech checkpoint exists."};
    return{state:"CONFIGURED",checkpointExists:true,liveCheckpoint:this.live,sha256:sha256File(this.live),speechGeneration:false,message:"A promoted ForgeSpeech checkpoint exists; runtime health must pass before CONNECTED is reported."};
  }
  async evaluate({candidate,dataset,maxLoss=2.0,maxRelativeRegression=0.02}={}){
    const cand=path.resolve(candidate||""),data=path.resolve(dataset||"");
    if(!fs.existsSync(cand))return{state:"UNAVAILABLE",eligible:false,message:"ForgeSpeech candidate checkpoint missing."};
    if(!fs.existsSync(data))return{state:"UNAVAILABLE",eligible:false,message:"ForgeSpeech evaluation dataset missing."};
    const args=["model/eval/speech_compare.py","--candidate",cand,"--dataset",data,"--max-loss",String(maxLoss),"--max-relative-regression",String(maxRelativeRegression)];
    if(fs.existsSync(this.live))args.push("--baseline",this.live);
    const raw=await this.runner(this.python,args,{cwd:this.root});
    const comparison=lastJson(raw.stdout)||{state:raw.state,message:raw.stderr||"ForgeSpeech comparison produced no JSON."};
    const candidateSha=sha256File(cand),baselineSha=fs.existsSync(this.live)?sha256File(this.live):null;
    const out={state:comparison.state,eligible:comparison.state==="SUCCESS"&&comparison.passed===true,candidate:cand,candidate_sha256:candidateSha,baseline:fs.existsSync(this.live)?this.live:null,baseline_sha256:baselineSha,comparison,command:[this.python,...args]};
    this.audit?.append?.({type:"forgespeech.candidate.evaluated",state:out.state,eligible:out.eligible,candidateSha256:candidateSha,baselineSha256:baselineSha});
    return out;
  }
  snapshotBaseline(label="pre-promotion"){
    if(!fs.existsSync(this.live))return{state:"SUCCESS",snapshot:null,bootstrap:true};
    const id="speech-rollback-"+crypto.randomUUID(),backup=path.join(this.dir,id+".pt");atomicCopy(this.live,backup);
    const record={id,label,backup,sha256:sha256File(backup),created_at:new Date().toISOString()};fs.writeFileSync(path.join(this.dir,id+".json"),JSON.stringify(record,null,2)+"\n","utf8");
    return{state:"SUCCESS",snapshot:record,bootstrap:false};
  }
  promote({candidate,evaluation,approved=false,approvalId=null}={}){
    if(!evaluation?.eligible)return{state:"BLOCKED",promoted:false,message:"ForgeSpeech candidate has not passed evaluation."};
    if(!approved||!approvalId)return{state:"WAITING_APPROVAL",promoted:false,message:"Explicit owner-bound approval is required.",candidate_sha256:evaluation.candidate_sha256};
    const cand=path.resolve(candidate||"");
    if(!fs.existsSync(cand))return{state:"UNAVAILABLE",promoted:false,message:"Candidate checkpoint missing."};
    if(sha256File(cand)!==evaluation.candidate_sha256)return{state:"BLOCKED",promoted:false,message:"Candidate hash changed after evaluation."};
    const snapshot=this.snapshotBaseline("pre-forgespeech-promotion");if(snapshot.state!=="SUCCESS")return snapshot;
    atomicCopy(cand,this.live);const liveSha=sha256File(this.live);
    const out={state:"SUCCESS",promoted:true,approval_id:approvalId,live_checkpoint:this.live,live_sha256:liveSha,previous:snapshot.snapshot||null,bootstrap:snapshot.bootstrap===true,candidate_sha256:evaluation.candidate_sha256,promoted_at:new Date().toISOString(),runtimeAvailability:"CONFIGURED"};
    this.audit?.append?.({type:"forgespeech.candidate.promoted",approvalId,candidateSha256:evaluation.candidate_sha256,liveSha256:liveSha,rollbackId:snapshot.snapshot?.id||null,bootstrap:out.bootstrap});
    return out;
  }
  rollback(id,{reason="speech regression"}={}){
    if(!id)return{state:"BLOCKED",message:"A rollback snapshot ID is required."};
    const meta=path.join(this.dir,String(id)+".json");if(!fs.existsSync(meta))return{state:"FAILURE",message:"ForgeSpeech rollback snapshot not found."};
    const record=JSON.parse(fs.readFileSync(meta,"utf8"));if(!fs.existsSync(record.backup))return{state:"FAILURE",message:"ForgeSpeech rollback artifact missing."};
    if(sha256File(record.backup)!==record.sha256)return{state:"BLOCKED",message:"ForgeSpeech rollback artifact integrity check failed."};
    atomicCopy(record.backup,this.live);const liveSha=sha256File(this.live);
    this.audit?.append?.({type:"forgespeech.rollback",rollbackId:id,reason,liveSha256:liveSha});
    return{state:"SUCCESS",rolled_back:true,rollback_id:id,reason,live_sha256:liveSha};
  }
}
export default ForgeSpeechCandidatePromotion;
