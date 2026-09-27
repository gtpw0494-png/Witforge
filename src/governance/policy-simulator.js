import crypto from "node:crypto";
import {PlatformStateStore} from "../platform-state-store.js";
const iso=()=>new Date().toISOString();
const order={low:0,medium:1,high:2,critical:3};
export class PolicySimulator{
  constructor({policyEngine,stateRoot,audit=null}={}){this.policyEngine=policyEngine;this.db=new PlatformStateStore(stateRoot);this.audit=audit;}
  simulate(input={}){
    const steps=Array.isArray(input.steps)?input.steps:[],id="policy-sim-"+crypto.randomUUID(),evaluated=[],approvals=[],violations=[],dataTouched=[],externalTransfers=[];
    let maxRisk="low";
    for(let i=0;i<steps.length;i++){
      const step=steps[i]||{},risk=String(step.risk||"low").toLowerCase();if((order[risk]??0)>(order[maxRisk]??0))maxRisk=risk;
      const decision=this.policyEngine.evaluate({operation:step.operation||`step-${i+1}`,risk,external:Boolean(step.external),physical:Boolean(step.physical),mutatesSource:Boolean(step.mutatesSource),requiresCredential:Boolean(step.requiresCredential),actor:input.actor||"user:onechat",resource:step.resource||null,arguments:step.arguments||{},dataClassification:step.dataClassification||"local",destination:step.destination||null,policySource:"simulation"});
      const row={index:i,description:String(step.description||step.operation||`step-${i+1}`),...decision,dryRun:true};evaluated.push(row);
      if(["ASK","ESCALATE"].includes(decision.decision))approvals.push({index:i,operation:decision.operation,decision:decision.decision,reason:decision.reason});
      if(["DENY","BLOCK"].includes(decision.decision))violations.push({index:i,operation:decision.operation,decision:decision.decision,reason:decision.reason});
      for(const d of Array.isArray(step.dataTouched)?step.dataTouched:[])dataTouched.push({index:i,data:String(d)});
      if(step.external||step.destination)externalTransfers.push({index:i,destination:step.destination||"external-unspecified",dataClassification:step.dataClassification||"local"});
    }
    const saferPlan=evaluated.map((x,i)=>({index:i,operation:x.operation,action:["DENY","BLOCK"].includes(x.decision)?"REMOVE_OR_REDESIGN":["ASK","ESCALATE"].includes(x.decision)?"REQUIRE_EXPLICIT_APPROVAL":"ALLOW_IN_DRY_RUN",reason:x.reason}));
    const overall=violations.length?"BLOCK":approvals.some(x=>x.decision==="ESCALATE")?"ESCALATE":approvals.length?"ASK":"ALLOW";
    const record={id,state:"SIMULATED",actor:String(input.actor||"user:onechat"),subjectId:input.subjectId||null,objective:String(input.objective||"").slice(0,4000),policyVersion:"uai-policy-v0.54",overallDecision:overall,maxRisk,steps:evaluated,dataTouched,externalTransfers,approvalsRequired:approvals,violations,saferPlan,executionPerformed:false,createdAt:iso(),updatedAt:iso()};
    const r=this.db.create("policy-simulation",record);if(r.state==="SUCCESS")this.audit?.append({type:"policy.simulated",simulationId:id,overallDecision:overall,maxRisk,steps:evaluated.length});return r.state==="SUCCESS"?{state:"SUCCESS",simulation:record}:r;
  }
  list(limit=100){return this.db.list("policy-simulation",limit).records||[];}
  get(id){return this.db.get("policy-simulation",id).record||null;}
}
