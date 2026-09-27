import crypto from "node:crypto";
import {ControlPlaneStore} from "../control-plane-store.js";
import {GovernanceDb} from "../governance-db.js";
import {LightAgentRegistry} from "./light-agent-registry.js";
import {WorktreeManager} from "./worktree-manager.js";
import {PatchEvaluator} from "./patch-evaluator.js";
import {PromotionGate} from "../shadow/promotion-gate.js";
import {normalizeAgentBudget,zeroUsage} from "../agent-budget.js";
import {BoundedWorkerScheduler} from "../control-plane-scheduler.js";
const iso=ms=>new Date(ms??Date.now()).toISOString();
export const LIGHT_STATES=Object.freeze(["OBSERVED","PROPOSED","WORKTREE_CREATED","IMPLEMENTING","TESTING","SECURITY_REVIEW","SHADOW_REVIEW","STAGED","PROMOTION_ELIGIBLE","PROMOTED","MONITORED","ROLLED_BACK","REJECTED"]);
const transitions={
OBSERVED:["PROPOSED","REJECTED"],PROPOSED:["WORKTREE_CREATED","REJECTED"],WORKTREE_CREATED:["IMPLEMENTING","TESTING","REJECTED"],IMPLEMENTING:["TESTING","REJECTED"],
TESTING:["SECURITY_REVIEW","REJECTED"],SECURITY_REVIEW:["SHADOW_REVIEW","REJECTED"],SHADOW_REVIEW:["STAGED","REJECTED"],STAGED:["PROMOTION_ELIGIBLE","REJECTED"],
PROMOTION_ELIGIBLE:["PROMOTED","REJECTED"],PROMOTED:["MONITORED","ROLLED_BACK"],MONITORED:["ROLLED_BACK"],ROLLED_BACK:[],REJECTED:[]
};
const TERMINAL=new Set(["PROMOTED","MONITORED","ROLLED_BACK","REJECTED"]);
export class LightCoordinator{
  constructor({root,stateRoot,audit=null,maxWorkers=2,maxQueue=64,scheduler=null}={}){
    this.root=root;this.stateRoot=stateRoot;this.audit=audit;this.db=new ControlPlaneStore(stateRoot);this.registry=new LightAgentRegistry();
    const legacy=new GovernanceDb(stateRoot);this.migration=this.db.migrateLegacy("light-patch",legacy.list("light-patch",10000).records||[]);legacy.close();
    this.worktrees=new WorktreeManager({root,stateRoot,audit});this.evaluator=new PatchEvaluator();this.promotion=new PromotionGate({audit});this.maxWorkers=Math.max(1,Math.min(8,Number(maxWorkers)||2));this.ttlMs=Math.max(60000,Number(process.env.IUV_LIGHT_PATCH_TTL_MS||86400000));
    this.scheduler=scheduler||new BoundedWorkerScheduler({stateRoot,audit,maxWorkers:this.maxWorkers,maxQueue});
  }
  status(){
    const patches=this.list({limit:10000}),active=patches.filter(x=>!TERMINAL.has(x.state)).length,jobs=this.scheduler.list({limit:10000,queue:"light"});
    return {state:"SUCCESS",mode:"ISOLATED_WORKTREE_ONLY",maxWorkers:this.maxWorkers,agents:this.registry.list().length,patches:patches.length,active,worktreeAvailable:this.worktrees.available(),directMainCommit:false,
      scheduler:{queued:jobs.filter(x=>x.state==="QUEUED").length,running:jobs.filter(x=>x.state==="RUNNING").length,total:jobs.length,mode:this.scheduler.status().mode},storage:this.db.status()};
  }
  get(id){return this.db.get("light-patch",id).record||null;}
  list({limit=100,state=null}={}){return this.db.list("light-patch",limit,state).records||[];}
  _transition(id,state,event={}){
    const cur=this.db.get("light-patch",id);if(!cur.record)return {state:"FAILURE",message:"Light patch not found."};
    if(!LIGHT_STATES.includes(state)||!transitions[cur.record.state]?.includes(state))return {state:"BLOCKED",message:`Illegal light transition ${cur.record.state} -> ${state}.`};
    const body={...cur.record,state,updatedAt:iso()};const r=this.db.cas("light-patch",id,cur.version,body,{type:"light.transition",from:cur.record.state,to:state,...event});
    if(r.state==="SUCCESS")this.audit?.append({type:"light.patch.transition",patchId:id,from:cur.record.state,to:state});return r.state==="SUCCESS"?body:r;
  }
  propose({agentType,objective,baseRef="HEAD",risk=null,dependencies=[],budget={}}={}){
    const profile=this.registry.get(agentType);if(!profile)return {state:"BLOCKED",message:"Unknown light-agent type.",available:this.registry.list().map(x=>x.id)};
    if(!String(objective||"").trim())return {state:"BLOCKED",message:"Patch objective is required."};
    const sched=this.scheduler.status();if((sched.queued||0)+(sched.running||0)>=sched.maxQueue)return {state:"BLOCKED",message:"Light-agent scheduler queue is full.",maxQueue:sched.maxQueue};
    const id="light-"+crypto.randomUUID(),now=Date.now(),record={id,agentType:profile.id,objective:String(objective).slice(0,20000),baseRef:String(baseRef||"HEAD"),state:"OBSERVED",
      budget:normalizeAgentBudget(budget),usage:zeroUsage(),changedFiles:[],reason:String(objective).slice(0,4000),tests:[],risk:risk||profile.risk||"medium",dependencies,rollbackPoint:baseRef,evidence:[],createdAt:iso(now),updatedAt:iso(now),expiresAt:iso(now+this.ttlMs)};
    const r=this.db.create("light-patch",record);if(r.state!=="SUCCESS")return r;const proposed=this._transition(id,"PROPOSED",{reason:"light-agent-proposal"});if(proposed.state!=="PROPOSED")return proposed;
    const job=this.scheduler.submit({queue:"light",subjectId:id,agentType:profile.id,payload:{action:"create-worktree"},expiresAt:record.expiresAt});
    if(job.state!=="SUCCESS"){this._transition(id,"REJECTED",{reason:"scheduler-admission-failed"});return {...job,patch:this.get(id)};}
    return {state:"SUCCESS",patch:proposed,profile,job:job.job};
  }
  createWorktree(id,{settle=true}={}){
    const patch=this.get(id);if(!patch)return {state:"FAILURE",message:"Light patch not found."};if(patch.state!=="PROPOSED")return {state:"BLOCKED",message:"Patch must be PROPOSED before worktree creation."};
    const w=this.worktrees.create(id,patch.baseRef);if(w.state!=="SUCCESS")return w;const next=this._transition(id,"WORKTREE_CREATED",{worktree:w.worktree.path});
    if(settle)this.scheduler.settleSubject("light",id,{resultState:"SUCCESS",result:{worktree:w.worktree.path},mode:"manual-api"});
    return {state:"SUCCESS",patch:next,worktree:w.worktree};
  }
  async dispatchNext(workerId="light-worker"){return this.scheduler.runNext(workerId,{light:job=>this.createWorktree(job.subjectId,{settle:false})},"light");}
  maintenance(now=Date.now()){
    const scheduler=this.scheduler.maintenance(now),worktrees=this.worktrees.expire(now),rejected=[];
    for(const item of worktrees.expired||[]){const p=this.get(item.patchId);if(p&&!TERMINAL.has(p.state)){const r=this._transition(p.id,"REJECTED",{reason:"worktree-expired"});if(r?.state==="REJECTED")rejected.push(p.id);}}
    for(const p of this.list({limit:10000}))if(!TERMINAL.has(p.state)&&Date.parse(p.expiresAt||"")<=now){const r=this._transition(p.id,"REJECTED",{reason:"patch-ttl-expired"});if(r?.state==="REJECTED")rejected.push(p.id);}
    return {state:"SUCCESS",scheduler,worktrees,rejected:[...new Set(rejected)]};
  }
  recordImplementation(id,{changedFiles=[],evidence=[]}={}){
    const cur=this.db.get("light-patch",id);if(!cur.record)return {state:"FAILURE",message:"Light patch not found."};
    if(!["WORKTREE_CREATED","IMPLEMENTING"].includes(cur.record.state))return {state:"BLOCKED",message:"Patch is not in an implementation state."};
    let record=cur.record,version=cur.version;if(record.state==="WORKTREE_CREATED"){record={...record,state:"IMPLEMENTING"};const a=this.db.cas("light-patch",id,version,record,{type:"light.transition",to:"IMPLEMENTING"});if(a.state!=="SUCCESS")return a;version=a.version;}
    const body={...record,changedFiles:[...new Set(changedFiles.map(String))],evidence:Array.isArray(evidence)?evidence:[],updatedAt:iso()};const r=this.db.cas("light-patch",id,version,body,{type:"light.implementation.recorded"});
    return r.state==="SUCCESS"?{state:"SUCCESS",patch:body}:r;
  }
  evaluate(id,input={}){
    let patch=this.get(id);if(!patch)return {state:"FAILURE",message:"Light patch not found."};
    if(patch.state==="IMPLEMENTING")patch=this._transition(id,"TESTING");if(patch.state!=="TESTING")return {state:"BLOCKED",message:"Patch must reach TESTING before evaluation.",current:patch.state};
    const ev=this.evaluator.evaluate({...input,changedFiles:input.changedFiles||patch.changedFiles,dependencies:input.dependencies||patch.dependencies,risk:input.risk||patch.risk,evidence:input.evidence||patch.evidence});
    if(!ev.eligible){this._transition(id,"REJECTED",{blockers:ev.blockers});return {...ev,patch:this.get(id)};}
    this._transition(id,"SECURITY_REVIEW");this._transition(id,"SHADOW_REVIEW");this._transition(id,"STAGED");
    const cur=this.db.get("light-patch",id),body={...cur.record,tests:ev.evidenceRecord.tests,evidence:[...(cur.record.evidence||[]),ev.evidenceRecord],evaluation:ev,updatedAt:iso()};
    this.db.cas("light-patch",id,cur.version,body,{type:"light.evidence.recorded"});return {state:"SUCCESS",patch:body,evaluation:ev};
  }
  markPromotionEligible(id,authorization){
    const patch=this.get(id);if(!patch)return {state:"FAILURE",message:"Light patch not found."};if(patch.state!=="STAGED")return {state:"BLOCKED",message:"Only STAGED patches can enter the promotion gate."};
    const checks=patch.evaluation?.checks||{},gate=this.promotion.evaluate({kind:"light",record:patch,authorization,checks});if(!gate.eligible)return gate;
    const next=this._transition(id,"PROMOTION_ELIGIBLE",{authorizedBy:gate.authorizedBy});return {state:"SUCCESS",patch:next,promotion:gate,message:"Patch is promotion-eligible. This action does not merge or commit to protected main."};
  }
  recordPromoted(id,authorization){
    const patch=this.get(id);if(!patch)return {state:"FAILURE",message:"Light patch not found."};if(patch.state!=="PROMOTION_ELIGIBLE")return {state:"BLOCKED",message:"Patch is not promotion-eligible."};
    if(!authorization?.allowed||!authorization?.auth?.authenticated||authorization.auth.role!=="owner")return {state:"DENIED",message:"Authenticated local-owner authority is required to record promotion."};
    const next=this._transition(id,"PROMOTED",{authorizedBy:authorization.auth.identityId});return {state:"SUCCESS",patch:next,message:"Promotion recorded. Source merging remains outside the light-agent authority boundary."};
  }
  rollback(id,reason="rollback"){
    const patch=this.get(id);if(!patch)return {state:"FAILURE",message:"Light patch not found."};this.scheduler.settleSubject("light",id,{resultState:"FAILURE",result:{reason},mode:"rollback"});
    const cleanup=this.worktrees.remove(id,reason);if(["PROMOTED","MONITORED"].includes(patch.state))return {state:"SUCCESS",patch:this._transition(id,"ROLLED_BACK",{reason}),cleanup};
    if(!["ROLLED_BACK","REJECTED"].includes(patch.state))return {state:"SUCCESS",patch:this._transition(id,"REJECTED",{reason}),cleanup};return {state:"SUCCESS",patch,cleanup};
  }
}
