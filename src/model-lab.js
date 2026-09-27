import {spawn} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function py(script,args=[],timeout=240000){
  return new Promise(resolve=>{
    const p=spawn(process.env.PYTHON||"python3",[path.join(ROOT,script),...args],{cwd:ROOT});
    let out="",err="",settled=false;
    const done=x=>{if(settled)return;settled=true;clearTimeout(timer);resolve(x)};
    const timer=setTimeout(()=>{p.kill("SIGKILL");done({state:"TIMEOUT",message:`${script} timed out.`})},timeout);
    p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
    p.on("error",e=>done({state:"UNAVAILABLE",message:e.message}));
    p.on("close",code=>{
      if(settled)return;
      const lines=out.trim().split(/\r?\n/).filter(Boolean).reverse();let parsed=null;
      for(const line of lines){try{parsed=JSON.parse(line);break}catch{}}
      done(parsed?{...parsed,exitCode:code}:{state:code===0?"SUCCESS":"ERROR",message:(err||out||`${script} exited ${code}`).slice(0,4000),exitCode:code});
    });
  });
}
function sha256(file){const h=crypto.createHash("sha256");h.update(fs.readFileSync(file));return h.digest("hex")}

export class ModelLab{
  constructor({learning,audit,stateRoot,candidatePromotion=null}){
    this.learning=learning;this.audit=audit;this.stateRoot=stateRoot;this.candidatePromotion=candidatePromotion;
    this.stateFile=path.join(stateRoot,"model-runs.json");
    fs.mkdirSync(path.dirname(this.stateFile),{recursive:true});
    if(!fs.existsSync(this.stateFile))fs.writeFileSync(this.stateFile,"[]");
  }
  presets(){try{return JSON.parse(fs.readFileSync(path.join(ROOT,"model","config_presets.json"),"utf8"))}catch(e){return {format:"unavailable",presets:{},error:e.message}}}
  runs(){try{const v=JSON.parse(fs.readFileSync(this.stateFile,"utf8"));return Array.isArray(v)?v:[]}catch{return []}}
  _write(rows){const tmp=this.stateFile+".tmp-"+process.pid+"-"+Date.now();fs.writeFileSync(tmp,JSON.stringify(rows.slice(-200),null,2)+"\n");fs.renameSync(tmp,this.stateFile)}
  remember(run){const all=this.runs();const row={runId:run.runId||`model-run-${crypto.randomUUID()}`,recordedAt:new Date().toISOString(),...run};all.push(row);this._write(all);return row}
  update(runId,patch={}){const all=this.runs(),i=all.findIndex(x=>x.runId===runId);if(i<0)return{state:"UNAVAILABLE",message:"Model Lab run not found."};all[i]={...all[i],...patch,updatedAt:new Date().toISOString()};this._write(all);return{state:"SUCCESS",run:all[i]}}
  get(runId){return this.runs().find(x=>x.runId===runId)||null}
  async prepareDataset(){
    const learned=this.learning.build();if(learned.state!=="SUCCESS")return learned;
    const language=await py("storage/export_training.py",["--definitions",process.env.FORGELM_MAX_DEFINITIONS||"5000","--dialogues",process.env.FORGELM_MAX_DIALOGUES||"5000"],60000);
    const built=await py("model/data_pipeline.py",["--extra","model/data/seed.txt","--web-corpus","model/data/web-corpus.jsonl","--max-web-records",process.env.FORGELM_MAX_WEB_RECORDS||"5000","--language-database","model/data/language-database.jsonl"],60000);
    if(built.state==="SUCCESS")await py("model/build_corpus.py",[],60000);
    this.audit?.append({type:"model.dataset.build",state:built.state,accepted:built.counts?.accepted||0});
    return {...built,learningExport:learned,languageDatabase:language};
  }
  async train({steps=40,preset="termux-tiny",gradAccum=1}={}){
    const prep=await this.prepareDataset();
    if(prep.state!=="SUCCESS")return {state:"FAILURE",message:"Dataset preparation failed; training was not started.",dataset:prep};
    const runId=`model-run-${crypto.randomUUID()}`;
    const r=await py("model/trainer.py",["--steps",String(steps),"--preset",preset,"--grad-accum",String(gradAccum),"--dataset","model/data/dataset-v2","--run-name",runId],300000);
    const candidate=r.modelCheckpoint?path.resolve(ROOT,r.modelCheckpoint):null;
    const exists=Boolean(candidate&&fs.existsSync(candidate));
    const row=this.remember({
      runId,state:r.state==="SUCCESS"&&exists?"CANDIDATE_READY":"TRAINING_FAILED",
      preset,steps,gradAccum,dataset:"model/data/dataset-v2",candidateCheckpoint:exists?candidate:null,
      candidateSha256:exists?sha256(candidate):null,training:r,promoted:false,productionEligible:false
    });
    this.audit?.append({type:"model.train.candidate",state:row.state,preset,steps,runId,candidateSha256:row.candidateSha256});
    return{state:row.state==="CANDIDATE_READY"?"SUCCESS":"FAILURE",message:row.state==="CANDIDATE_READY"?"ForgeLM candidate trained; evaluation and explicit promotion are still required.":"ForgeLM candidate training failed.",run:row,dataset:{counts:prep.counts,integrity:prep.integrity}};
  }
  async evaluateCandidate(runId,{maxRelativeRegression=0.02}={}){
    const run=this.get(runId);if(!run)return{state:"UNAVAILABLE",message:"Model Lab run not found."};
    if(!this.candidatePromotion)return{state:"UNAVAILABLE",message:"Candidate promotion service is not configured."};
    const evaluation=await this.candidatePromotion.evaluate({candidate:run.candidateCheckpoint,dataset:path.join(ROOT,run.dataset||"model/data/dataset-v2"),maxRelativeRegression});
    const updated=this.update(runId,{evaluation,state:evaluation.eligible?"EVALUATED":"REJECTED",productionEligible:false});
    return{state:evaluation.state,evaluation,run:updated.run||run};
  }
  promoteCandidate(runId,{approvalId,approved=false}={}){
    const run=this.get(runId);if(!run)return{state:"UNAVAILABLE",message:"Model Lab run not found."};
    if(!run.evaluation?.eligible)return{state:"BLOCKED",message:"Candidate has not passed evaluation.",run};
    const out=this.candidatePromotion.promote({candidate:run.candidateCheckpoint,evaluation:run.evaluation,approvalId,approved});
    const updated=this.update(runId,{promotion:out,state:out.state==="SUCCESS"?"PROMOTED":out.state,promoted:out.state==="SUCCESS",productionEligible:out.state==="SUCCESS"});
    return{...out,run:updated.run||run};
  }
  rollback(runId,{reason="model regression"}={}){
    const run=this.get(runId);if(!run)return{state:"UNAVAILABLE",message:"Model Lab run not found."};
    const rollbackId=run?.promotion?.previous?.id;if(!rollbackId)return{state:"BLOCKED",message:"Run has no promoted rollback snapshot."};
    const out=this.candidatePromotion.rollback(rollbackId,{reason});
    const updated=this.update(runId,{rollback:out,state:out.state==="SUCCESS"?"ROLLED_BACK":"ROLLBACK_FAILED",productionEligible:false});
    return{...out,run:updated.run||run};
  }
  trainTokenizer(vocabSize=512){return py("model/tokenizer.py",["train","--corpus","model/data/training-corpus.txt","--vocab-size",String(vocabSize)],120000)}
  benchmark(){return py("model/benchmark_inference.py",[],60000)}
  analyzeSources(){return py("research/analyze_sources.py",[],60000)}
  hardware(){return py("model/hardware_profile.py",[],20000)}
  status(){const ps=this.presets();const tok=fs.existsSync(path.join(ROOT,"model","tokenizers","forgelm.pyngram.json"))?"python-byte-ngram":(fs.existsSync(path.join(ROOT,"model","tokenizers","forgelm.model"))?"sentencepiece-or-byte-fallback":"byte-action");return {state:"SUCCESS",presets:Object.keys(ps.presets||{}),presetDetails:ps.presets||{},tokenizer:tok,runs:this.runs().slice(-20),truth:ps.truth||null,candidateFirst:true};}
}
