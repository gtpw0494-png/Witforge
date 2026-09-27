import fs from "node:fs";
import path from "node:path";

function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+".tmp-"+process.pid+"-"+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n","utf8");fs.renameSync(tmp,file)}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}

export class KnowledgeScheduler {
  constructor({intervalMs=Number(process.env.IUV_KNOWLEDGE_INTERVAL_MS||1800000),runner=null,stateRoot=path.resolve("state")}={}) {
    this.intervalMs=Math.max(60000,Number(intervalMs)||1800000);
    this.runner=runner;this.timer=null;this.running=false;
    this.file=path.join(stateRoot,"knowledge-autonomy","scheduler.json");
    this.state=readJson(this.file,{enabled:false,topics:[],cursor:0,last_run:null,last_result:null,next_run:null,runs:0,failures:0});
  }
  persist(){writeJson(this.file,this.state)}
  configure({topics,intervalMs,enabled}={}){
    if(Array.isArray(topics))this.state.topics=[...new Set(topics.map(x=>String(x).trim()).filter(Boolean))].slice(0,1000);
    if(intervalMs!==undefined)this.intervalMs=Math.max(60000,Number(intervalMs)||this.intervalMs);
    if(enabled!==undefined)this.state.enabled=Boolean(enabled);
    this.persist();return this.status();
  }
  nextTopic(){
    const topics=this.state.topics||[];if(!topics.length)return null;
    const i=Math.max(0,Number(this.state.cursor)||0)%topics.length;this.state.cursor=(i+1)%topics.length;return topics[i];
  }
  async runOnce(topic=null){
    if(this.running)return{state:"BLOCKED",message:"Knowledge research run already active."};
    if(typeof this.runner!=="function")return{state:"UNAVAILABLE",message:"No research runner configured."};
    const selected=String(topic||this.nextTopic()||"").trim();
    if(!selected)return{state:"BLOCKED",message:"No research topic configured."};
    this.running=true;
    try{
      const result=await this.runner(selected);
      this.state.last_run=new Date().toISOString();this.state.last_result={state:result?.state||"UNKNOWN",topic:selected,stored:result?.stored||0,evidence_count:result?.evidence_count||0};
      this.state.runs=(this.state.runs||0)+1;if(!["SUCCESS","PARTIAL"].includes(result?.state))this.state.failures=(this.state.failures||0)+1;
      this.state.next_run=this.state.enabled?new Date(Date.now()+this.intervalMs).toISOString():null;this.persist();return result;
    }finally{this.running=false}
  }
  start(){
    if(this.timer)return this.status();
    this.state.enabled=true;this.state.next_run=new Date(Date.now()+this.intervalMs).toISOString();this.persist();
    this.timer=setInterval(()=>{this.runOnce().catch(()=>{})},this.intervalMs);
    this.timer.unref?.();
    return this.status();
  }
  stop(){
    if(this.timer)clearInterval(this.timer);this.timer=null;this.state.enabled=false;this.state.next_run=null;this.persist();return this.status();
  }
  status(){
    return{state:"SUCCESS",enabled:Boolean(this.state.enabled),active:Boolean(this.timer),running:this.running,intervalMs:this.intervalMs,topics:(this.state.topics||[]).length,next_run:this.state.next_run,last_run:this.state.last_run,last_result:this.state.last_result,runs:this.state.runs||0,failures:this.state.failures||0,process_bound:true,truth:"Scheduled research runs only while the UAI localhost process is running; state persists across restarts."};
  }
}
export default KnowledgeScheduler;
