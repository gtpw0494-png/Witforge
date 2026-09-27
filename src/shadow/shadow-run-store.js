import crypto from "node:crypto";
import {ControlPlaneStore} from "../control-plane-store.js";
import {GovernanceDb} from "../governance-db.js";
import {normalizeAgentBudget,zeroUsage,checkBudget} from "../agent-budget.js";
const iso=ms=>new Date(ms??Date.now()).toISOString();
export const SHADOW_STATES=Object.freeze(["CREATED","QUEUED","RESEARCHING","SIMULATING","GENERATING","CRITIQUING","EVALUATING","PENDING_PROMOTION","ACCEPTED","REJECTED","EXPIRED","ARCHIVED"]);
const allowed={
CREATED:["QUEUED","REJECTED","EXPIRED"],QUEUED:["RESEARCHING","SIMULATING","REJECTED","EXPIRED"],RESEARCHING:["SIMULATING","GENERATING","REJECTED","EXPIRED"],
SIMULATING:["GENERATING","CRITIQUING","EVALUATING","REJECTED","EXPIRED"],GENERATING:["CRITIQUING","EVALUATING","PENDING_PROMOTION","REJECTED","EXPIRED"],
CRITIQUING:["EVALUATING","REJECTED","EXPIRED"],EVALUATING:["PENDING_PROMOTION","REJECTED","EXPIRED"],PENDING_PROMOTION:["ACCEPTED","REJECTED","EXPIRED"],
ACCEPTED:["ARCHIVED"],REJECTED:["ARCHIVED"],EXPIRED:["ARCHIVED"],ARCHIVED:[]
};
const ACTIVE=new Set(["CREATED","QUEUED","RESEARCHING","SIMULATING","GENERATING","CRITIQUING","EVALUATING","PENDING_PROMOTION"]);
export class ShadowRunStore{
  constructor(stateRoot,audit=null){
    this.db=new ControlPlaneStore(stateRoot);this.audit=audit;this.ttlMs=Math.max(60000,Number(process.env.IUV_SHADOW_TTL_MS||86400000));
    const legacy=new GovernanceDb(stateRoot);this.migration=this.db.migrateLegacy("shadow-run",legacy.list("shadow-run",10000).records||[]);legacy.close();
  }
  create({agentType,objective,budget={},parentRunId=null,provenance={}}){
    const id="shadow-"+crypto.randomUUID(),now=Date.now(),record={id,agentType:String(agentType),objective:String(objective||"").slice(0,20000),parentRunId,budget:normalizeAgentBudget(budget),usage:zeroUsage(),state:"CREATED",provenance,createdAt:iso(now),updatedAt:iso(now),expiresAt:iso(now+this.ttlMs)};
    const r=this.db.create("shadow-run",record);if(r.state==="SUCCESS")this.audit?.append({type:"shadow.run.created",runId:id,agentType});return r.state==="SUCCESS"?record:r;
  }
  get(id){return this.db.get("shadow-run",id).record||null;}
  list({limit=100,state=null}={}){return this.db.list("shadow-run",limit,state).records||[];}
  transition(id,state,event={}){
    const cur=this.db.get("shadow-run",id);if(!cur.record)return {state:"FAILURE",message:"Shadow run not found."};
    if(!SHADOW_STATES.includes(state)||!allowed[cur.record.state]?.includes(state))return {state:"BLOCKED",message:`Illegal shadow transition ${cur.record.state} -> ${state}.`};
    const body={...cur.record,state,updatedAt:iso()};const r=this.db.cas("shadow-run",id,cur.version,body,{type:"shadow.transition",from:cur.record.state,to:state,...event});
    if(r.state==="SUCCESS")this.audit?.append({type:"shadow.run.transition",runId:id,from:cur.record.state,to:state});return r.state==="SUCCESS"?body:r;
  }
  debit(id,delta){
    const cur=this.db.get("shadow-run",id);if(!cur.record)return {state:"FAILURE",message:"Shadow run not found."};
    const gate=checkBudget(cur.record.budget,cur.record.usage,delta);if(!gate.allowed)return {...gate,message:"Shadow run resource budget exceeded."};
    const body={...cur.record,usage:gate.next,updatedAt:iso()};const r=this.db.cas("shadow-run",id,cur.version,body,{type:"shadow.budget",delta});
    return r.state==="SUCCESS"?{state:"SUCCESS",record:body}:r;
  }
  expire(now=Date.now()){
    const expired=[];for(const run of this.list({limit:10000}))if(ACTIVE.has(run.state)&&Date.parse(run.expiresAt||"")<=now){const out=this.transition(run.id,"EXPIRED",{reason:"ttl-expired"});if(out?.state==="EXPIRED")expired.push(run.id);}
    return {state:"SUCCESS",expired};
  }
}
