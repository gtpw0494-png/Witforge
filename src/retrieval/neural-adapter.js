import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export class NeuralRetrievalAdapter{
  constructor({python=process.env.PYTHON||"python3"}={}){this.python=python;this.script=path.join(root,"model","dense_runtime.py");}
  _run(payload,timeout=120000){
    const p=spawnSync(this.python,[this.script],{cwd:root,input:JSON.stringify(payload),encoding:"utf8",timeout,maxBuffer:32_000_000,env:process.env});
    if(p.error)return {state:"UNAVAILABLE",message:p.error.message};if(p.status!==0)return {state:"ERROR",message:(p.stderr||p.stdout||"dense runtime failed").slice(0,4000)};
    try{return JSON.parse((p.stdout||"{}").trim().split(/\n/).filter(Boolean).at(-1)||"{}");}catch{return {state:"ERROR",message:"Invalid dense runtime response."};}
  }
  status(){return this._run({action:"status"},15000);}
  embed(texts=[]){return this._run({action:"embed",texts:Array.isArray(texts)?texts.slice(0,512):[]});}
  rerank(query,texts=[]){return this._run({action:"rerank",query:String(query||""),texts:Array.isArray(texts)?texts.slice(0,512):[]});}
}
