import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {GovernanceDb} from './governance-db.js';

const STATES=new Set(['NEW','PLANNING','WAITING_APPROVAL','AUTHORIZED','EXECUTING','VERIFYING','CORRECTING','CONTINUING','RECOVERING','COMPLETED','FAILED','CANCELLED']);
const TRANSITIONS={
 NEW:new Set(['PLANNING','CANCELLED']), PLANNING:new Set(['WAITING_APPROVAL','AUTHORIZED','FAILED','CANCELLED']), WAITING_APPROVAL:new Set(['AUTHORIZED','EXECUTING','FAILED','CANCELLED']),
 AUTHORIZED:new Set(['EXECUTING','CANCELLED']), EXECUTING:new Set(['WAITING_APPROVAL','VERIFYING','FAILED','RECOVERING','CANCELLED']), VERIFYING:new Set(['COMPLETED','FAILED','CORRECTING','RECOVERING','CANCELLED']),
 CORRECTING:new Set(['EXECUTING','VERIFYING','FAILED','CANCELLED']), CONTINUING:new Set(['EXECUTING','VERIFYING','FAILED','CANCELLED']), RECOVERING:new Set(['CONTINUING','FAILED','CANCELLED']),
 FAILED:new Set(['RECOVERING','CANCELLED']), COMPLETED:new Set(), CANCELLED:new Set()
};

export class TaskStore{
 constructor(stateRoot,audit=null){this.stateRoot=stateRoot;this.audit=audit;this.db=new GovernanceDb(stateRoot);fs.mkdirSync(stateRoot,{recursive:true});this.legacy=path.join(stateRoot,'tasks.json');this._migrate();}
 _strip(r){if(!r)return null;const x={...r};delete x._version;return x;}
 _migrate(){if(!fs.existsSync(this.legacy))return;let rows=[];try{rows=JSON.parse(fs.readFileSync(this.legacy,'utf8'));}catch{return;}for(const row of rows){if(row?.id&&!this.db.get('task',row.id).record)this.db.create('task',row);}if(rows.length){try{fs.renameSync(this.legacy,this.legacy+'.migrated-v037');}catch{}}}
 list({limit=100,state=null}={}){let rows=(this.db.list('task',limit).records||[]).map(x=>this._strip(x));if(state)rows=rows.filter(x=>x.state===state);return rows;}
 get(id){const r=this.db.get('task',id);return r.record?{...r.record,_version:r.version}:null;}
 _cas(id,mutator,event){for(let n=0;n<5;n++){const cur=this.get(id);if(!cur)return null;const expected=cur._version;const base=this._strip(cur);const body=mutator(base);const r=this.db.cas('task',id,expected,body,event);if(r.state==='SUCCESS')return {...r.record,_version:r.version};if(r.state!=='CONFLICT')throw new Error(r.message||'Task update failed.');}throw new Error('Task update conflicted repeatedly.');}
 create({request='',plan={steps:[]},title='Agent task',envelopeId=null}={}){const ts=new Date().toISOString();const task={id:`task-${crypto.randomUUID()}`,title,request:String(request),state:'NEW',plan,outputs:[],nextStep:0,envelopeId,resultState:null,createdAt:ts,updatedAt:ts,history:[{state:'NEW',at:ts,reason:'task-created'}]};const r=this.db.create('task',task);if(r.state!=='SUCCESS')throw new Error(r.message||'Task persistence failed.');this.audit?.append({type:'task.persist.create',taskId:task.id,envelopeId});return {...task,_version:r.version};}
 update(id,patch={}){return this._cas(id,cur=>({...cur,...patch,updatedAt:new Date().toISOString()}),{type:'update',patchKeys:Object.keys(patch)});}
 transition(id,state,{reason='',details=null}={}){if(!STATES.has(state))throw new Error(`Unsupported task state: ${state}`);const out=this._cas(id,cur=>{const from=cur.state;if(from!==state&&!TRANSITIONS[from]?.has(state))throw new Error(`Illegal task transition ${from} -> ${state}`);const at=new Date().toISOString();return {...cur,state,updatedAt:at,history:[...(cur.history||[]),{from,state,at,reason:String(reason||''),details}]};},{type:'transition',to:state,reason,details});this.audit?.append({type:'task.persist.transition',taskId:id,state,reason});return out;}
 events(id){return this.db.events('task',id).events||[];}
}
