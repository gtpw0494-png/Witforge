import {ShadowAgentRegistry} from "./shadow-agent-registry.js";
import {ShadowRunStore} from "./shadow-run-store.js";
import {CandidateStore} from "./candidate-store.js";
import {detectDisagreement} from "./disagreement-detector.js";
import {PromotionGate} from "./promotion-gate.js";
import {BoundedWorkerScheduler} from "../control-plane-scheduler.js";

const ACTIVE=new Set(["CREATED","QUEUED","RESEARCHING","SIMULATING","GENERATING","CRITIQUING","EVALUATING","PENDING_PROMOTION"]);

export class ShadowCoordinator{
  constructor({stateRoot,audit=null,maxWorkers=4,maxQueue=64,executor=null,scheduler=null}={}){
    this.audit=audit;this.registry=new ShadowAgentRegistry();this.runs=new ShadowRunStore(stateRoot,audit);
    this.candidates=new CandidateStore(stateRoot,audit);this.promotion=new PromotionGate({audit});this.maxWorkers=Math.max(1,Math.min(16,Number(maxWorkers)||4));this.executor=executor;
    this.scheduler=scheduler||new BoundedWorkerScheduler({stateRoot,audit,maxWorkers:this.maxWorkers,maxQueue});
  }
  status(){
    const runs=this.runs.list({limit:10000}),candidates=this.candidates.list(10000),jobs=this.scheduler.list({limit:10000,queue:"shadow"});
    return {state:"SUCCESS",mode:"BOUNDED_VIRTUAL_AGENTS",maxWorkers:this.maxWorkers,agents:this.registry.list().length,
      active:runs.filter(x=>ACTIVE.has(x.state)).length,runs:runs.length,candidates:candidates.length,
      scheduler:{queued:jobs.filter(x=>x.state==="QUEUED").length,running:jobs.filter(x=>x.state==="RUNNING").length,total:jobs.length,mode:this.scheduler.status().mode},
      storage:this.runs.db.status(),restrictions:["quarantine-write-only","no-self-deploy","no-self-approval","no-direct-training-promotion","bounded-descendants"]};
  }
  submit({agentType,objective,budget={},parentRunId=null,provenance={},simulationInput={}}={}){
    const profile=this.registry.get(agentType);if(!profile)return {state:"BLOCKED",message:"Unknown shadow agent type.",available:this.registry.list().map(x=>x.id)};
    if(!String(objective||"").trim())return {state:"BLOCKED",message:"Shadow objective is required."};
    const scheduler=this.scheduler.status();if((scheduler.queued||0)+(scheduler.running||0)>=scheduler.maxQueue)return {state:"BLOCKED",message:"Shadow scheduler queue is full.",maxQueue:scheduler.maxQueue};
    const run=this.runs.create({agentType:profile.id,objective,budget,parentRunId,provenance:{...provenance,profile:profile.id}});
    if(run.state&&run.state!=="CREATED")return run;
    const queued=this.runs.transition(run.id,"QUEUED",{reason:"scheduler-admission"});if(queued.state!=="QUEUED")return queued;
    const job=this.scheduler.submit({queue:"shadow",subjectId:run.id,agentType:profile.id,payload:{input:simulationInput},expiresAt:queued.expiresAt});
    if(job.state!=="SUCCESS"){this.runs.transition(run.id,"REJECTED",{reason:"scheduler-admission-failed"});return {...job,run:this.runs.get(run.id)};}
    return {state:"SUCCESS",run:queued,profile,job:job.job};
  }
  async simulate(id,{evidence=[],observations=[],outputs=[]}={},options={}){
    const run=this.runs.get(id);if(!run)return {state:"FAILURE",message:"Shadow run not found."};
    if(run.state!=="QUEUED")return {state:"BLOCKED",message:"Only QUEUED shadow runs may start simulation.",current:run.state};
    const budget=this.runs.debit(id,{concurrency:1,runtimeMs:1,tokens:Math.min(5000,String(run.objective).length*4)});if(budget.state!=="SUCCESS")return budget;
    this.runs.transition(id,"SIMULATING",{evidenceCount:evidence.length});
    let execution={state:"SUCCESS",mode:"deterministic-simulation",proposal:{objective:run.objective,agentType:run.agentType,steps:["inspect approved evidence","identify gaps and disagreements","produce quarantined candidate","require independent promotion"]}};
    if(this.executor){try{const x=await this.executor({run:this.runs.get(id),evidence,observations});execution=x&&typeof x==="object"?x:execution;}catch(e){execution={state:"ERROR",message:String(e?.message||e)};}}
    this.runs.transition(id,"GENERATING",{executionState:execution.state});const disagreement=detectDisagreement(outputs.length?outputs:observations);this.runs.transition(id,"EVALUATING",{disagreement:disagreement.disagreement});
    const candidate=this.candidates.create({runId:id,kind:"shadow-research",payload:execution,evidence,scores:{disagreement:disagreement.disagreement},provenance:{agentType:run.agentType,simulation:true}});if(candidate.state&&candidate.state!=="QUARANTINED")return candidate;
    const pending=this.candidates.setState(candidate.id,"PENDING_PROMOTION",{evaluation:{state:execution.state,disagreement,verifiedEvidenceCount:evidence.length}});this.runs.transition(id,"PENDING_PROMOTION",{candidateId:candidate.id});
    const resultState=execution.state==="ERROR"?"PARTIAL":"SUCCESS";if(!options.fromScheduler)this.scheduler.settleSubject("shadow",id,{resultState,result:{candidateId:candidate.id},mode:"manual-api"});
    return {state:resultState,run:this.runs.get(id),candidate:pending,disagreement};
  }
  async dispatchNext(workerId="shadow-worker"){return this.scheduler.runNext(workerId,{shadow:job=>this.simulate(job.subjectId,job.payload?.input||{},{fromScheduler:true})},"shadow");}
  maintenance(now=Date.now()){const runs=this.runs.expire(now),scheduler=this.scheduler.maintenance(now);return {state:"SUCCESS",runs,scheduler};}
  promote(candidateId,authorization,{evidence=false,evaluation=false}={}){
    const candidate=this.candidates.get(candidateId),gate=this.promotion.evaluate({kind:"shadow",record:candidate,authorization,checks:{evidence,evaluation}});if(!gate.eligible)return gate;
    const accepted=this.candidates.setState(candidateId,"ACCEPTED",{productionEligible:false,trainingEligible:false,promotion:gate});const runId=accepted?.runId;if(runId){const run=this.runs.get(runId);if(run?.state==="PENDING_PROMOTION")this.runs.transition(runId,"ACCEPTED",{candidateId});}
    return {state:"SUCCESS",candidate:accepted,promotion:gate,message:"Candidate accepted for governed downstream review. Acceptance does not deploy code or add training data."};
  }
  reject(candidateId,reason="rejected"){
    const candidate=this.candidates.get(candidateId);if(!candidate)return {state:"FAILURE",message:"Candidate not found."};const out=this.candidates.setState(candidateId,"REJECTED",{rejectionReason:String(reason).slice(0,2000)});
    const run=this.runs.get(candidate.runId);if(run?.state==="PENDING_PROMOTION")this.runs.transition(run.id,"REJECTED",{reason});if(candidate.runId)this.scheduler.settleSubject("shadow",candidate.runId,{resultState:"FAILURE",result:{reason},mode:"rejected"});return {state:"SUCCESS",candidate:out};
  }
}
