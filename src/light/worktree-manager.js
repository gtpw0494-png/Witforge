import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {ControlPlaneStore} from "../control-plane-store.js";
import {GovernanceDb} from "../governance-db.js";
const iso=()=>new Date().toISOString();
const safeId=id=>String(id||"").replace(/[^A-Za-z0-9._-]/g,"-").slice(0,160);
export class WorktreeManager{
  constructor({root,stateRoot,audit=null,ttlMs=24*3600000}={}){
    this.root=path.resolve(root||process.cwd());this.stateRoot=path.resolve(stateRoot||path.join(this.root,"state"));this.audit=audit;this.ttlMs=Math.max(60000,Number(ttlMs)||86400000);
    this.dir=path.join(this.stateRoot,"light-worktrees");fs.mkdirSync(this.dir,{recursive:true});this.db=new ControlPlaneStore(this.stateRoot);
    const legacy=new GovernanceDb(this.stateRoot);this.migration=this.db.migrateLegacy("light-worktree",legacy.list("light-worktree",10000).records||[]);legacy.close();
  }
  available(){try{return execFileSync("git",["-C",this.root,"rev-parse","--is-inside-work-tree"],{encoding:"utf8",timeout:5000}).trim()==="true";}catch{return false;}}
  plan(patchId,baseRef="HEAD"){const id=safeId(patchId),target=path.join(this.dir,id);return {state:this.available()?"SUCCESS":"UNAVAILABLE",patchId:id,baseRef:String(baseRef||"HEAD"),target,mode:"DETACHED_ISOLATED_WORKTREE",protectedMainWrite:false};}
  create(patchId,baseRef="HEAD"){
    const p=this.plan(patchId,baseRef);if(p.state!=="SUCCESS")return {...p,message:"Git worktrees are unavailable."};if(fs.existsSync(p.target))return {state:"BLOCKED",message:"Patch worktree already exists.",...p};fs.mkdirSync(this.dir,{recursive:true});
    try{execFileSync("git",["-C",this.root,"worktree","add","--detach",p.target,p.baseRef],{encoding:"utf8",timeout:30000,stdio:["ignore","pipe","pipe"]});const rec={id:"worktree-"+p.patchId,patchId:p.patchId,path:p.target,baseRef:p.baseRef,status:"ACTIVE",createdAt:iso(),expiresAt:new Date(Date.now()+this.ttlMs).toISOString()};this.db.create("light-worktree",rec);this.audit?.append({type:"light.worktree.created",patchId:p.patchId,path:p.target,baseRef:p.baseRef});return {state:"SUCCESS",worktree:rec};}catch(e){return {state:"ERROR",message:String(e?.stderr||e?.message||e).slice(0,2000)};}
  }
  remove(patchId,reason="cleanup"){
    const id=safeId(patchId),target=path.join(this.dir,id);if(!target.startsWith(this.dir+path.sep))return {state:"BLOCKED",message:"Worktree path is outside the managed root."};
    try{if(fs.existsSync(target))execFileSync("git",["-C",this.root,"worktree","remove","--force",target],{encoding:"utf8",timeout:30000,stdio:["ignore","pipe","pipe"]});}catch(e){return {state:"ERROR",message:String(e?.stderr||e?.message||e).slice(0,2000)};}
    const key="worktree-"+id,cur=this.db.get("light-worktree",key);if(cur.record)this.db.cas("light-worktree",key,cur.version,{...cur.record,status:"REMOVED",removedAt:iso(),removeReason:reason},{type:"remove"});this.audit?.append({type:"light.worktree.removed",patchId:id,reason});return {state:"SUCCESS",patchId:id,removed:true};
  }
  expire(now=Date.now()){const rows=this.db.list("light-worktree",10000).records||[],expired=[];for(const r of rows)if(r.status==="ACTIVE"&&Date.parse(r.expiresAt||0)<=now){const x=this.remove(r.patchId,"expired");expired.push({patchId:r.patchId,state:x.state});}return {state:"SUCCESS",expired};}
}
