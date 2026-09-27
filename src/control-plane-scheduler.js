import crypto from "node:crypto";
import {ControlPlaneStore} from "./control-plane-store.js";
const iso=ms=>new Date(ms??Date.now()).toISOString();
const FINAL=new Set(["COMPLETED","FAILED","CANCELLED","EXPIRED"]);
export class BoundedWorkerScheduler{
  constructor({stateRoot,audit=null,maxWorkers=4,maxQueue=64,leaseMs=60000,clock=()=>Date.now()}={}){
    this.db=new ControlPlaneStore(stateRoot);this.audit=audit;this.maxWorkers=Math.max(1,Math.min(32,Number(maxWorkers)||4));this.maxQueue=Math.max(this.maxWorkers,Math.min(10000,Number(maxQueue)||64));this.leaseMs=Math.max(5000,Math.min(3600000,Number(leaseMs)||60000));this.clock=clock;
  }
  list({limit=100,state=null,queue=null}={}){let rows=this.db.list("agent-job",limit,state).records||[];if(queue)rows=rows.filter(x=>x.queue===queue);return rows;}
  status(){
    const rows=this.list({limit:10000}),counts={};for(const r of rows)counts[r.state]=(counts[r.state]||0)+1;
    return {state:"SUCCESS",mode:"PERSISTENT_BOUNDED_LEASE_QUEUE",maxWorkers:this.maxWorkers,maxQueue:this.maxQueue,leaseMs:this.leaseMs,total:rows.length,queued:counts.QUEUED||0,running:counts.RUNNING||0,counts,store:this.db.status()};
  }
  submit({queue,subjectId,agentType=null,priority=50,payload={},notBefore=null,expiresAt=null}={}){
    const q=String(queue||"").trim(),subject=String(subjectId||"").trim();if(!q||!subject)return {state:"BLOCKED",message:"queue and subjectId are required."};
    const active=this.list({limit:10000}).filter(x=>!FINAL.has(x.state));if(active.length>=this.maxQueue)return {state:"BLOCKED",message:"Scheduler queue limit reached.",maxQueue:this.maxQueue};
    const duplicate=active.find(x=>x.queue===q&&x.subjectId===subject);if(duplicate)return {state:"SUCCESS",job:duplicate,reused:true};
    const now=this.clock(),record={id:"job-"+crypto.randomUUID(),queue:q,subjectId:subject,agentType:agentType||null,priority:Math.max(0,Math.min(100,Number(priority)||50)),payload:payload&&typeof payload==="object"?payload:{},state:"QUEUED",attempts:0,leaseOwner:null,leaseExpiresAt:null,notBefore:notBefore||null,expiresAt:expiresAt||null,createdAt:iso(now),updatedAt:iso(now)};
    const r=this.db.create("agent-job",record);if(r.state==="SUCCESS")this.audit?.append({type:"scheduler.job.queued",jobId:record.id,queue:q,subjectId:subject});return r.state==="SUCCESS"?{state:"SUCCESS",job:record}:r;
  }
  _replace(cur,body,event){const r=this.db.cas("agent-job",cur.id,cur._version||this.db.get("agent-job",cur.id).version,body,event);return r.state==="SUCCESS"?{...body,_version:r.version}:r;}
  maintenance(now=this.clock()){
    const rows=this.list({limit:10000}),recovered=[],expired=[];
    for(const row of rows){
      if(FINAL.has(row.state))continue;const current=this.db.get("agent-job",row.id);if(!current.record)continue;const rec={...current.record},version=current.version;
      const expiry=Date.parse(rec.expiresAt||"");if(Number.isFinite(expiry)&&expiry<=now){const body={...rec,state:"EXPIRED",leaseOwner:null,leaseExpiresAt:null,updatedAt:iso(now),finishedAt:iso(now)};const r=this.db.cas("agent-job",rec.id,version,body,{type:"scheduler.expired"});if(r.state==="SUCCESS")expired.push(rec.id);continue;}
      const lease=Date.parse(rec.leaseExpiresAt||"");if(rec.state==="RUNNING"&&Number.isFinite(lease)&&lease<=now){const body={...rec,state:"QUEUED",leaseOwner:null,leaseExpiresAt:null,updatedAt:iso(now),lastRecoveryAt:iso(now)};const r=this.db.cas("agent-job",rec.id,version,body,{type:"scheduler.lease.recovered"});if(r.state==="SUCCESS")recovered.push(rec.id);}
    }
    if(recovered.length||expired.length)this.audit?.append({type:"scheduler.maintenance",recovered,expired});return {state:"SUCCESS",recovered,expired};
  }
  claim(workerId,{queue=null}={}){
    const worker=String(workerId||"").trim();if(!worker)return {state:"BLOCKED",message:"workerId is required."};this.maintenance();
    const all=this.list({limit:10000}),running=all.filter(x=>x.state==="RUNNING").length;if(running>=this.maxWorkers)return {state:"BLOCKED",message:"Worker pool is at its concurrency limit.",running,maxWorkers:this.maxWorkers};
    const now=this.clock(),jobs=all.filter(x=>x.state==="QUEUED"&&(!queue||x.queue===queue)&&(!x.notBefore||Date.parse(x.notBefore)<=now)&&(!x.expiresAt||Date.parse(x.expiresAt)>now)).sort((a,b)=>(b.priority||0)-(a.priority||0)||Date.parse(a.createdAt)-Date.parse(b.createdAt));
    for(const candidate of jobs){const cur=this.db.get("agent-job",candidate.id);if(!cur.record||cur.record.state!=="QUEUED")continue;const body={...cur.record,state:"RUNNING",attempts:Number(cur.record.attempts||0)+1,leaseOwner:worker,leaseExpiresAt:iso(now+this.leaseMs),startedAt:cur.record.startedAt||iso(now),updatedAt:iso(now)};const r=this.db.cas("agent-job",candidate.id,cur.version,body,{type:"scheduler.claimed",worker});if(r.state==="SUCCESS"){this.audit?.append({type:"scheduler.job.claimed",jobId:candidate.id,worker,queue:body.queue});return {state:"SUCCESS",job:body};}}
    return {state:"UNAVAILABLE",message:"No runnable jobs are queued.",queue};
  }
  finish(id,workerId,{resultState="SUCCESS",result=null}={}){
    const cur=this.db.get("agent-job",id);if(!cur.record)return {state:"FAILURE",message:"Scheduler job not found."};if(cur.record.state!=="RUNNING")return {state:"BLOCKED",message:"Only RUNNING jobs may finish.",current:cur.record.state};if(cur.record.leaseOwner!==workerId)return {state:"DENIED",message:"Worker does not own this job lease."};
    const terminal=["SUCCESS","PARTIAL"].includes(String(resultState))?"COMPLETED":"FAILED",body={...cur.record,state:terminal,resultState:String(resultState),result,leaseOwner:null,leaseExpiresAt:null,finishedAt:iso(this.clock()),updatedAt:iso(this.clock())},r=this.db.cas("agent-job",id,cur.version,body,{type:"scheduler.finished",worker:workerId,resultState});
    if(r.state==="SUCCESS")this.audit?.append({type:"scheduler.job.finished",jobId:id,worker:workerId,state:terminal,resultState});return r.state==="SUCCESS"?{state:"SUCCESS",job:body}:r;
  }
  settleSubject(queue,subjectId,{resultState="SUCCESS",result=null,mode="manual"}={}){
    const rows=this.list({limit:10000,queue}).filter(x=>x.subjectId===subjectId&&!FINAL.has(x.state));if(!rows.length)return {state:"UNAVAILABLE",message:"No active scheduler job for subject."};
    const settled=[];for(const row of rows){const cur=this.db.get("agent-job",row.id);if(!cur.record||FINAL.has(cur.record.state))continue;const terminal=["SUCCESS","PARTIAL"].includes(String(resultState))?"COMPLETED":"FAILED",body={...cur.record,state:terminal,resultState:String(resultState),result,executionMode:mode,leaseOwner:null,leaseExpiresAt:null,finishedAt:iso(this.clock()),updatedAt:iso(this.clock())},r=this.db.cas("agent-job",row.id,cur.version,body,{type:"scheduler.subject.settled",mode,resultState});if(r.state==="SUCCESS")settled.push(row.id);}return {state:"SUCCESS",settled};
  }
  async runNext(workerId,handlers={},queue=null){
    const claim=this.claim(workerId,{queue});if(claim.state!=="SUCCESS")return claim;const job=claim.job,handler=handlers[job.queue];if(typeof handler!=="function")return this.finish(job.id,workerId,{resultState:"FAILURE",result:{message:`No handler registered for queue ${job.queue}.`}});
    try{const out=await handler(job);const resultState=out?.state||"SUCCESS";return {...this.finish(job.id,workerId,{resultState,result:out}),execution:out};}catch(e){return {...this.finish(job.id,workerId,{resultState:"ERROR",result:{message:String(e?.message||e)}}),execution:{state:"ERROR",message:String(e?.message||e)}};}
  }
}
