import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function run(command,args,{cwd=process.cwd(),env=process.env,timeoutMs=300000}={}){
  return new Promise(resolve=>{
    const child=spawn(command,args,{cwd,env:{...env},stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="",settled=false;
    const finish=(out)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(out)};
    child.stdout.on("data",d=>stdout+=d); child.stderr.on("data",d=>stderr+=d);
    child.on("error",e=>finish({state:"UNAVAILABLE",message:String(e.message||e),stdout,stderr}));
    child.on("close",code=>finish({state:code===0?"SUCCESS":"FAILURE",code,stdout,stderr}));
    const timer=setTimeout(()=>{child.kill("SIGTERM");finish({state:"TIMEOUT",stdout,stderr})},timeoutMs);
  });
}
function lastJson(text=""){
  const lines=String(text).trim().split(/\r?\n/).filter(Boolean).reverse();
  for(const line of lines){try{return JSON.parse(line)}catch{}}
  return null;
}
function sha256File(file){
  const h=crypto.createHash("sha256");h.update(fs.readFileSync(file));return h.digest("hex");
}
function writeJsonl(file,rows){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,rows.map(x=>JSON.stringify(x)).join("\n")+(rows.length?"\n":""),"utf8")}
function materializeDataset(stateRoot,jobId,items=[]){
  const dir=path.join(stateRoot,"knowledge-autonomy","training-jobs",jobId,"dataset");
  const rows=items.filter(x=>x?.training_eligible===true&&x?.verification?.verified===true&&x?.verification?.training_rights_verified===true).map(x=>({
    text:[String(x.subject||"").trim(),String(x.claim||"").trim()].filter(Boolean).join(": "),
    fact_id:x.fact_id||null,source_id:x.source_id||null,source_url:x.source_url||null,
    verification:x.verification,training_eligible:true
  })).filter(x=>x.text);
  const split=rows.length>1?Math.max(1,Math.floor(rows.length*.8)):rows.length;
  const train=rows.slice(0,split),validation=rows.length>1?rows.slice(split):[];
  writeJsonl(path.join(dir,"train.jsonl"),train);
  writeJsonl(path.join(dir,"validation.jsonl"),validation);
  const manifest={format:"uai-knowledge-training-dataset-v1",job_id:jobId,records:rows.length,train:train.length,validation:validation.length,created_at:new Date().toISOString(),source:"verified-knowledge-store"};
  fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify(manifest,null,2)+"\n","utf8");
  return{dir,manifest};
}
export class KnowledgeTrainingJob {
  constructor({root=process.cwd(),stateRoot="state",python=process.env.PYTHON||"python3",runner=run}={}){this.root=root;this.stateRoot=stateRoot;this.python=python;this.runner=runner}
  async execute(batch,{steps=Number(process.env.IUV_KNOWLEDGE_TRAIN_STEPS||20),preset=process.env.IUV_KNOWLEDGE_TRAIN_PRESET||"termux-tiny",timeoutMs=Number(process.env.IUV_KNOWLEDGE_TRAIN_TIMEOUT_MS||900000)}={}){
    const items=Array.isArray(batch?.batch)?batch.batch:[];
    const count=Number(batch?.count||items.length||0);
    const minBatch=Math.max(2,Number(process.env.IUV_KNOWLEDGE_MIN_BATCH||2));
    if(count<minBatch||items.length<minBatch)return{state:"BLOCKED",message:`At least ${minBatch} verified examples are required so training keeps a held-out validation split.`,trained:false,min_batch:minBatch};
    const jobId="knowledge-train-"+crypto.randomUUID();
    const dataset=materializeDataset(path.resolve(this.stateRoot),jobId,items);
    if(!dataset.manifest.records)return{state:"BLOCKED",message:"Training batch contains no verified eligible records.",trained:false};
    const runName=jobId;
    const args=["model/trainer.py","--steps",String(Math.max(1,steps)),"--preset",preset,"--dataset",dataset.dir,"--run-name",runName];
    const result=await this.runner(this.python,args,{cwd:this.root,env:{...process.env,IUV_KNOWLEDGE_BATCH_ID:jobId},timeoutMs});
    const parsed=lastJson(result.stdout);
    const candidatePath=parsed?.modelCheckpoint?path.resolve(this.root,parsed.modelCheckpoint):null;
    const candidateExists=Boolean(candidatePath&&fs.existsSync(candidatePath));
    return{
      ...result,state:result.state==="SUCCESS"&&parsed?.state==="SUCCESS"&&candidateExists?"SUCCESS":result.state==="SUCCESS"?"FAILURE":result.state,
      job_id:jobId,trained:result.state==="SUCCESS"&&parsed?.state==="SUCCESS"&&candidateExists,batch_count:dataset.manifest.records,preset,steps:Math.max(1,steps),
      dataset:dataset.dir,dataset_manifest:dataset.manifest,training:parsed,candidate_checkpoint:candidateExists?candidatePath:null,
      candidate_sha256:candidateExists?sha256File(candidatePath):null,promoted:false,production_eligible:false,
      command:[this.python,...args]
    };
  }
}
export default KnowledgeTrainingJob;
