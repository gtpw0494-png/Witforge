import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {GovernanceDb} from "./governance-db.js";

const BUILTIN = [
  {id:"research",name:"Research Agent",role:"research",capabilities:["knowledge.read","knowledge.write","source.registry.read","source.snapshot","reference.compare"]},
  {id:"web-research",name:"Web Research Agent",role:"web-research",capabilities:["web.registry.read","web.fetch","knowledge.write","provenance.write","license.track"]},
  {id:"development",name:"Development Agent",role:"development",capabilities:["knowledge.read","knowledge.write","source.inspect","source.propose","selfdev.stage"]},
  {id:"explorative",name:"Explorative Agent",role:"exploration",capabilities:["knowledge.read","agent.spawn","task.plan","source.registry.read"]},
  {id:"knowledge",name:"Knowledge Agent",role:"knowledge",capabilities:["knowledge.read","knowledge.write","knowledge.export","knowledge.import","reference.compare"]},
  {id:"verifier",name:"Verification Agent",role:"verification",capabilities:["knowledge.read","truth.verify","audit.read"]},
  {id:"forgelm",name:"ForgeLM Agent",role:"local-model",capabilities:["model.status","model.infer","model.train","model.benchmark","model.presets","knowledge.read"]},
  {id:"learning",name:"Learning Agent",role:"learning",capabilities:["learning.export","learning.dataset","knowledge.read","model.train"]},
  {id:"systems",name:"Systems Agent",role:"systems",capabilities:["accounts.read","subscriptions.read","plugins.read","capabilities.read","hardware.read","release.integrity.read","storage.read"]},
  {id:"lexicon",name:"Lexicon Agent",role:"lexicon",capabilities:["definitions.read","definitions.search","storage.read"]},
  {id:"dialogue",name:"Dialogue Agent",role:"dialogue",capabilities:["dialogue.read","dialogue.search","storage.read","knowledge.read"]}
];

export class AgentRegistry {
  constructor(stateRoot,audit){
    this.audit=audit;
    this.db=new GovernanceDb(stateRoot);
    this.legacy=path.join(stateRoot,"agents.json");
    fs.mkdirSync(stateRoot,{recursive:true});
    this._migrate();
    this._seedBuiltins();
  }

  _strip(x){
    if(!x)return null;
    const y={...x};delete y._version;return y;
  }

  _migrate(){
    if(!fs.existsSync(this.legacy))return;
    let rows=[];try{rows=JSON.parse(fs.readFileSync(this.legacy,"utf8"));}catch{return;}
    for(const row of rows){
      if(row?.id&&!this.db.get("agent",row.id).record)this.db.create("agent",row);
    }
    if(rows.length){try{fs.renameSync(this.legacy,this.legacy+".migrated-v043");}catch{}}
  }

  _seedBuiltins(){
    for(const x of BUILTIN){
      if(this.db.get("agent",x.id).record)continue;
      const rec={...x,builtin:true,parentId:null,createdAt:new Date().toISOString(),lineage:[x.id]};
      const r=this.db.create("agent",rec);
      if(r.state!=="SUCCESS")throw new Error(r.message||`Failed to seed builtin agent ${x.id}`);
    }
  }

  list(){
    return (this.db.list("agent",10000).records||[]).map(x=>this._strip(x));
  }

  get(id){
    const r=this.db.get("agent",id);
    return r.record?this._strip(r.record):null;
  }

  spawn({parentId="explorative",name,role="specialist",instructions="",capabilities=[]}){
    const parent=this.get(parentId);
    if(!parent)return {state:"FAILURE",message:"Parent agent not found."};
    const allowed=new Set(parent.capabilities);
    const requested=[...new Set((capabilities||[]).map(String))];
    const granted=requested.filter(x=>allowed.has(x));
    const denied=requested.filter(x=>!allowed.has(x));
    const agent={
      id:`agent-${crypto.randomUUID()}`,
      name:String(name||"Derived Agent"),
      role:String(role),
      instructions:String(instructions),
      capabilities:granted,
      builtin:false,
      parentId:parent.id,
      createdAt:new Date().toISOString(),
      lineage:[...(parent.lineage||[parent.id]),parent.id]
    };
    const r=this.db.create("agent",agent);
    if(r.state!=="SUCCESS")return {state:r.state,message:r.message||"Derived agent persistence failed."};
    this.audit?.append({type:"agent.spawn",agentId:agent.id,parentId:parent.id,granted,denied});
    return {state:"SUCCESS",message:"Derived logical agent created with parent-bounded capabilities.",agent,deniedCapabilities:denied};
  }
}

export class TaskEngine {
  constructor({store,knowledge,providers,research,development,explorative,agents,audit,taskStore=null,actionEnvelopes=null,policyEngine=null,approvalStore=null}){
    Object.assign(this,{store,knowledge,providers,research,development,explorative,agents,audit,taskStore,actionEnvelopes,policyEngine,approvalStore});
  }
  _policyForStep(step={}){
    if(!this.policyEngine)return {state:'SUCCESS',decision:'ALLOW',reason:'No policy engine configured; downstream component gates remain authoritative.'};
    const op=String(step.op||'');
    return this.policyEngine.evaluate({operation:op,risk:step.risk||((step.physical||step.mutatesSource)?'high':'low'),external:step.external===true||op==='provider',physical:step.physical===true,mutatesSource:step.mutatesSource===true,requiresCredential:step.requiresCredential===true||op==='provider'});
  }
  _approvalInput(task,envelope,step,index,policy){return {actionEnvelopeId:envelope?.id||task?.envelopeId||null,taskId:task?.id||null,operation:String(step.op||''),arguments:{index,step},capability:String(step.capability||step.op||''),actor:'user:onechat',toolVersion:'task-engine-v0.38',risk:String(step.risk||'high'),reason:policy?.reason||'Policy requires explicit approval.'};}
  _ensureApproval(task,envelope,step,index,policy){
    if(!this.approvalStore)return {state:'DENIED',message:'Policy requires approval but approval store is unavailable.'};
    const input=this._approvalInput(task,envelope,step,index,policy);
    if(task?.pendingApprovalId){const valid=this.approvalStore.validate(task.pendingApprovalId,input);if(valid.state==='SUCCESS')return {state:'SUCCESS',approval:valid.approval};}
    const approval=this.approvalStore.request(input);this.actionEnvelopes?.bindApproval(envelope?.id||task?.envelopeId,approval);
    if(task?.id)this.taskStore.update(task.id,{pendingApprovalId:approval.id,pendingStep:index});
    return {state:policy.decision==='ESCALATE'?'ESCALATED':'ASK',message:`Explicit approval required for ${step.op}.`,approval};
  }
  plan(input){
    const text=String(input||''); const steps=[];
    if(/research|examine|analyse|analyze|compare|definition|knowledge/i.test(text))steps.push({op:'research'});
    if(/external api|provider call/i.test(text))steps.push({op:'provider',requires:'explicit provider id + configured credentials'});
    if(/code|build|develop|file|source|implement|update|repair/i.test(text))steps.push({op:'develop-propose',requires:'target path/content for executable mutation'});
    if(!steps.length)steps.push({op:'explore'});
    return {state:'SUCCESS',input:text,steps,truth:'A plan is not execution. Each step reports its own result state.'};
  }
  list(opts={}){return this.taskStore?this.taskStore.list(opts):[];}
  status(id){const task=this.taskStore?.get(id);return task?{state:'SUCCESS',message:`Task ${id} is ${task.state}.`,task}:{state:'FAILURE',message:'Task not found.'};}
  async _executeStep(step,spec={}){
    if(step.op==='research')return this.research.examine({title:step.title||spec.title||'Task research',source:step.source||spec.source||'task',text:step.text||spec.text||spec.request||''});
    if(step.op==='explore')return this.explorative.chat(step.message||spec.request||'');
    if(step.op==='provider')return this.providers.chat(step.provider||spec.provider,step.message||spec.request||'',step.system);
    if(step.op==='develop-propose')return this.development.propose({request:step.request||spec.request||'',path:step.path||spec.path,content:step.content??spec.content});
    return {state:'UNAVAILABLE',message:`Unknown task operation: ${step.op}`};
  }
  async run(spec={}){
    const plan=spec.steps?.length?{state:'SUCCESS',input:spec.request||'',steps:spec.steps,truth:'Caller-supplied steps remain subject to per-step truth states.'}:this.plan(spec.request||'');
    const envelope=this.actionEnvelopes?.create({intent:spec.request||'',plan,capabilityScope:plan.steps.map(x=>x.op)});
    let task=this.taskStore?.create({request:spec.request||'',plan,title:spec.title||'Agent task run',envelopeId:envelope?.id||null});
    const runId=task?.id||`run-${crypto.randomUUID()}`; const outputs=[];
    if(task){this.taskStore.transition(runId,'PLANNING',{reason:'plan-created'});this.taskStore.transition(runId,'AUTHORIZED',{reason:'bounded orchestration authorized; downstream gates remain active'});this.taskStore.transition(runId,'EXECUTING',{reason:'task-run-start'});} 
    this.actionEnvelopes?.transition(envelope?.id,'EXECUTING',{taskId:runId});
    this.audit?.append({type:'task.start',runId,actionId:envelope?.id||null,request:spec.request||'',steps:plan.steps});
    for(let index=0;index<plan.steps.length;index++){
      const step=plan.steps[index];const policy=this._policyForStep(step);
      if(['DENY','BLOCK'].includes(policy.decision)){const stepResult={state:policy.decision,message:policy.reason,policy};const entry={index,step,result:stepResult,at:new Date().toISOString()};outputs.push(entry);this.taskStore?.update(runId,{outputs:[...outputs],nextStep:index});this.actionEnvelopes?.appendStep(envelope?.id,entry);break;}
      if(['ASK','ESCALATE'].includes(policy.decision)){const gate=this._ensureApproval(this.taskStore?.get(runId),envelope,step,index,policy);if(gate.state!=='SUCCESS'){this.taskStore?.transition(runId,'WAITING_APPROVAL',{reason:policy.reason,details:{approvalId:gate.approval?.id,index}});this.actionEnvelopes?.transition(envelope?.id,'WAITING_APPROVAL',{approvalId:gate.approval?.id,index});return {state:gate.state,message:gate.message,runId,taskId:runId,actionEnvelopeId:envelope?.id||null,approval:gate.approval,plan,outputs,persistedTask:this.taskStore?.get(runId)||null};}}
      const stepResult=await this._executeStep(step,spec);const entry={index,step,result:stepResult,policy,at:new Date().toISOString()};outputs.push(entry);
      if(task)this.taskStore.update(runId,{outputs:[...outputs],nextStep:['ERROR','FAILURE','DENIED','BLOCKED'].includes(stepResult.state)?index:index+1});this.actionEnvelopes?.appendStep(envelope?.id,entry);
      this.audit?.append({type:'task.step',runId,actionId:envelope?.id||null,index,op:step.op,state:stepResult.state});
      if(['ERROR','FAILURE','DENIED','BLOCKED'].includes(stepResult.state)&&step.continueOnFailure!==true)break;
    }
    const states=outputs.map(x=>x.result.state);const state=states.length&&states.every(x=>x==='SUCCESS')?'SUCCESS':states.some(x=>x==='SUCCESS')?'PARTIAL':states.at(-1)||'UNKNOWN';
    if(task){this.taskStore.transition(runId,'VERIFYING',{reason:'step-results-collected'});this.taskStore.update(runId,{outputs,resultState:state});this.taskStore.transition(runId,state==='SUCCESS'?'COMPLETED':'FAILED',{reason:`result-state:${state}`});task=this.taskStore.get(runId);}
    this.actionEnvelopes?.verify(envelope?.id,{state:state==='SUCCESS'?'SUCCESS':state,evidence:outputs.map(x=>({type:'task-step',index:x.index,op:x.step.op,state:x.result.state}))});
    this.actionEnvelopes?.transition(envelope?.id,state==='SUCCESS'?'COMPLETED':'FAILED',{resultState:state});
    const record=this.store.add({kind:'task-run',title:spec.title||'Agent task run',request:spec.request||'',runId,state,plan,outputs,verified:state==='SUCCESS',actionEnvelopeId:envelope?.id||null});
    this.audit?.append({type:'task.complete',runId,actionId:envelope?.id||null,state,knowledgeId:record.id});
    return {state,message:`Task ${runId} completed with ${state}.`,runId,taskId:runId,actionEnvelopeId:envelope?.id||null,plan,outputs,knowledgeId:record.id,persistedTask:task||null};
  }
  async resume(id){
    if(!this.taskStore)return {state:'UNAVAILABLE',message:'Durable task store is not configured.'};
    const task=this.taskStore.get(id);if(!task)return {state:'FAILURE',message:'Task not found.'};
    if(task.state==='COMPLETED')return {state:'SUCCESS',message:'Task is already completed.',task};
    if(task.state==='CANCELLED')return {state:'CANCELLED',message:'Cancelled tasks are not resumed automatically.',task};
    const start=Math.max(0,Number(task.pendingStep??task.nextStep??0));
    let approvedPendingIndex=null;
    if(task.state==='WAITING_APPROVAL'){const step=(task.plan?.steps||[])[start];if(!step)return {state:'FAILURE',message:'Pending approval step is missing.',task};const policy=this._policyForStep(step);const valid=this.approvalStore?.validate(task.pendingApprovalId,this._approvalInput(task,{id:task.envelopeId},step,start,policy));if(!valid||valid.state!=='SUCCESS')return {state:valid?.state||'DENIED',message:valid?.message||'Required approval is not valid.',task,approval:valid?.approval||null};approvedPendingIndex=start;this.taskStore.transition(id,'AUTHORIZED',{reason:'exact-operation approval validated',details:{approvalId:task.pendingApprovalId,index:start}});this.taskStore.update(id,{pendingApprovalId:null,pendingStep:null});}
    const refreshed=this.taskStore.get(id);
    const start2=Math.max(0,Number(refreshed.nextStep||start));const remaining=(refreshed.plan?.steps||[]).slice(start2);if(!remaining.length)return {state:'PARTIAL',message:'No remaining steps are available to resume.',task};
    if(refreshed.state==='FAILED'){this.taskStore.transition(id,'RECOVERING',{reason:'explicit-resume'});if(refreshed.envelopeId)this.actionEnvelopes?.recover(refreshed.envelopeId,'explicit task resume');this.taskStore.transition(id,'CONTINUING',{reason:`resume-from-step:${start2}`});}
    if(['AUTHORIZED','CONTINUING','RECOVERING'].includes(this.taskStore.get(id).state))this.taskStore.transition(id,'EXECUTING',{reason:`resume-execution-from-step:${start2}`});
    const prior=[...(refreshed.outputs||[])];const spec={request:refreshed.request,title:refreshed.title,steps:remaining};
    if(refreshed.envelopeId)this.actionEnvelopes?.transition(refreshed.envelopeId,'EXECUTING',{resumeFrom:start2});
    const newOutputs=[];
    for(let offset=0;offset<remaining.length;offset++){
      const index=start2+offset, step=remaining[offset], policy=this._policyForStep(step);
      if(['DENY','BLOCK'].includes(policy.decision)){const stepResult={state:policy.decision,message:policy.reason,policy};const entry={index,step,result:stepResult,policy,at:new Date().toISOString(),resumed:true};newOutputs.push(entry);this.taskStore.update(id,{outputs:[...prior,...newOutputs],nextStep:index});if(refreshed.envelopeId)this.actionEnvelopes?.appendStep(refreshed.envelopeId,entry);break;}
      if(['ASK','ESCALATE'].includes(policy.decision)&&index!==approvedPendingIndex){const current=this.taskStore.get(id);const gate=this._ensureApproval(current,{id:refreshed.envelopeId},step,index,policy);if(gate.state!=='SUCCESS'){this.taskStore.transition(id,'WAITING_APPROVAL',{reason:policy.reason,details:{approvalId:gate.approval?.id,index}});if(refreshed.envelopeId)this.actionEnvelopes?.transition(refreshed.envelopeId,'WAITING_APPROVAL',{approvalId:gate.approval?.id,index,resumed:true});return {state:gate.state,message:gate.message,task:this.taskStore.get(id),approval:gate.approval,outputs:newOutputs};}}
      const stepResult=await this._executeStep(step,spec), entry={index,step,result:stepResult,policy,at:new Date().toISOString(),resumed:true};newOutputs.push(entry);
      this.taskStore.update(id,{outputs:[...prior,...newOutputs],nextStep:['ERROR','FAILURE','DENIED','BLOCKED'].includes(stepResult.state)?index:index+1});if(refreshed.envelopeId)this.actionEnvelopes?.appendStep(refreshed.envelopeId,entry);
      this.audit?.append({type:'task.resume.step',runId:id,index,op:step.op,state:stepResult.state,policyDecision:policy.decision});
      if(['ERROR','FAILURE','DENIED','BLOCKED'].includes(stepResult.state)&&step.continueOnFailure!==true)break;
    }
    const latestByIndex=new Map(prior.map(x=>[x.index,x]));for(const x of newOutputs)latestByIndex.set(x.index,x);const all=[...latestByIndex.values()].sort((a,b)=>a.index-b.index), states=all.map(x=>x.result.state);const resultState=states.length&&states.every(x=>x==='SUCCESS')?'SUCCESS':states.some(x=>x==='SUCCESS')?'PARTIAL':states.at(-1)||'UNKNOWN';
    this.taskStore.transition(id,'VERIFYING',{reason:'resume-results-collected'});this.taskStore.update(id,{outputs:all,resultState});this.taskStore.transition(id,resultState==='SUCCESS'?'COMPLETED':'FAILED',{reason:`resume-result:${resultState}`});
    if(refreshed.envelopeId){this.actionEnvelopes?.verify(refreshed.envelopeId,{state:resultState,evidence:all.map(x=>({type:'task-step',index:x.index,op:x.step.op,state:x.result.state}))});this.actionEnvelopes?.transition(refreshed.envelopeId,resultState==='SUCCESS'?'COMPLETED':'FAILED',{resultState,resumed:true});}
    return {state:resultState,message:`Task ${id} resume completed with ${resultState}.`,task:this.taskStore.get(id),outputs:newOutputs};
  }
  cancel(id){
    if(!this.taskStore)return {state:'UNAVAILABLE',message:'Durable task store is not configured.'};const task=this.taskStore.get(id);if(!task)return {state:'FAILURE',message:'Task not found.'};if(task.state==='COMPLETED')return {state:'BLOCKED',message:'Completed tasks cannot be cancelled.',task};
    const updated=this.taskStore.transition(id,'CANCELLED',{reason:'explicit-user-cancel'});if(task.envelopeId)this.actionEnvelopes?.transition(task.envelopeId,'CANCELLED',{reason:'explicit-user-cancel'});this.audit?.append({type:'task.cancel',runId:id});return {state:'CANCELLED',message:`Task ${id} cancelled.`,task:updated};
  }
}
