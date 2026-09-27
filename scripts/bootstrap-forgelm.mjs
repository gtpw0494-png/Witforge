#!/usr/bin/env node
import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {ForgeLMCandidatePromotion} from "../src/forgelm-candidate-promotion.js";

const args=new Set(process.argv.slice(2));
const approved=args.has("--approve");
const stepsArg=process.argv.indexOf("--steps");
const steps=stepsArg>=0?Math.max(1,Number(process.argv[stepsArg+1]||80)):80;
const root=process.cwd();
const runName="bootstrap-"+Date.now();
const dataset=path.join(root,"model","data","dataset-v2");

function run(command,argv,{cwd=root}={}){
  return new Promise((resolve,reject)=>{
    const p=spawn(command,argv,{cwd,stdio:["ignore","pipe","pipe"]});let out="",err="";
    p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
    p.on("error",reject);p.on("close",code=>resolve({code,out,err}));
  });
}
function lastJson(text){
  for(const line of String(text).trim().split(/\r?\n/).reverse()){try{return JSON.parse(line)}catch{}}
  return null;
}

const live=path.join(root,"model","checkpoints","forgelm-seed.pt");
if(fs.existsSync(live)){
  console.log(JSON.stringify({state:"BLOCKED",message:"A promoted ForgeLM checkpoint already exists. Use the normal candidate evaluation/promotion lifecycle for upgrades.",liveCheckpoint:live},null,2));
  process.exit(2);
}
if(!approved){
  console.log(JSON.stringify({state:"WAITING_APPROVAL",message:"First-checkpoint bootstrap will train a local candidate, evaluate it, then promote it into the live ForgeLM path. Re-run with --approve to authorize promotion.",command:`node scripts/bootstrap-forgelm.mjs --approve --steps ${steps}`},null,2));
  process.exit(3);
}

const trained=await run(process.env.PYTHON||"python3",["model/cli.py","train","--steps",String(steps),"--preset","termux-tiny","--run-name",runName]);
const trainJson=lastJson(trained.out);
if(trained.code!==0||trainJson?.state!=="SUCCESS"){
  console.log(JSON.stringify({state:"FAILURE",stage:"train",message:trainJson?.message||trained.err||trained.out},null,2));process.exit(1);
}
const candidate=path.resolve(trainJson.candidateCheckpoint||trainJson.modelCheckpoint||"");
const promotion=new ForgeLMCandidatePromotion({root,stateRoot:path.join(root,"state")});
const evaluation=await promotion.evaluate({candidate,dataset});
if(!evaluation.eligible){
  console.log(JSON.stringify({state:evaluation.state||"FAILURE",stage:"evaluate",message:"Bootstrap candidate did not pass the first-checkpoint evaluation gate.",evaluation},null,2));process.exit(1);
}
const promoted=promotion.promote({candidate,evaluation,approved:true,approvalId:"local-bootstrap-"+Date.now()});
console.log(JSON.stringify({state:promoted.state,stage:"promote",training:trainJson,evaluation,promotion:promoted},null,2));
process.exit(promoted.state==="SUCCESS"?0:1);
