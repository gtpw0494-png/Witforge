import fs from "node:fs";import path from "node:path";import os from "node:os";import crypto from "node:crypto";import {spawnSync} from "node:child_process";import {nodeChildEnv,nodeScriptInvocation} from "./process-compat.js";
function copyFilter(src){const b=path.basename(src);return !["node_modules","vendor-reference","snapshots","sandboxes"].includes(b);}
export class SelfDevelopmentEngine{
  constructor({root,stateRoot,store,workspace,audit}){Object.assign(this,{root:path.resolve(root),stateRoot,store,workspace,audit});this.sandboxRoot=path.join(os.tmpdir(),"intraultuniversalion-selfdev");fs.mkdirSync(this.sandboxRoot,{recursive:true});this.index=path.join(stateRoot,"selfdev.json");if(!fs.existsSync(this.index))fs.writeFileSync(this.index,"[]");}
  list(){return JSON.parse(fs.readFileSync(this.index,"utf8"));}
  save(rec){const all=this.list();const i=all.findIndex(x=>x.id===rec.id);if(i>=0)all[i]=rec;else all.push(rec);fs.writeFileSync(this.index,JSON.stringify(all,null,2));return rec;}
  stage(proposalId){
    const p=this.store.get(proposalId);if(!p||p.kind!=="development-proposal")return {state:"FAILURE",message:"Development proposal not found."};
    if(!p.targetPath||p.proposedContent==null)return {state:"BLOCKED",message:"Proposal does not contain an executable target/content change."};
    const id=`stage-${crypto.randomUUID()}`,dir=path.join(this.sandboxRoot,id,"workspace");fs.mkdirSync(dir,{recursive:true});
    fs.cpSync(this.root,dir,{recursive:true,filter:(src)=>!src.startsWith(this.sandboxRoot)&&copyFilter(src)});
    const target=path.resolve(dir,p.targetPath);if(target!==dir&&!target.startsWith(dir+path.sep))return {state:"BLOCKED",message:"Target escapes sandbox."};
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,String(p.proposedContent));
    const checks=[];
    if(p.targetPath.endsWith(".js")){const r=spawnSync(process.execPath,["--check",target],{encoding:"utf8",timeout:20000,env:nodeChildEnv()});checks.push({name:"node-syntax",state:r.status===0?"SUCCESS":"FAILURE",output:((r.stderr||r.stdout||"")+(r.error?"\n"+r.error.message:"")).slice(0,3000)});}
    if(p.targetPath.endsWith(".py")){const r=spawnSync(process.env.PYTHON||"python3",["-m","py_compile",target],{encoding:"utf8",timeout:20000});checks.push({name:"python-syntax",state:r.status===0?"SUCCESS":"FAILURE",output:(r.stderr||r.stdout||"").slice(0,3000)});}
    const testRun=nodeScriptInvocation(dir,"test.js");const npm=spawnSync(testRun.command,testRun.args,{cwd:dir,encoding:"utf8",timeout:120000,env:nodeChildEnv({IU_SELFDEV_SANDBOX:"1"})});const npmOutput=((npm.stdout||"")+"\n"+(npm.stderr||"")+(npm.error?"\n"+npm.error.message:"")).slice(-5000);checks.push({name:"repository-tests",state:npm.status===0?"SUCCESS":"FAILURE",output:npmOutput});
    const state=checks.every(x=>x.state==="SUCCESS")?"SUCCESS":"FAILURE";
    const rec={id,proposalId,targetPath:p.targetPath,expectedHash:p.expectedHash||null,approvalId:p.approvalId,state,checks,createdAt:new Date().toISOString(),promoted:false};this.save(rec);this.audit?.append({type:"selfdev.stage",stageId:id,proposalId,state,checks:checks.map(x=>({name:x.name,state:x.state}))});
    return {state,message:state==="SUCCESS"?"Candidate change passed isolated validation.":"Candidate change failed isolated validation; promotion is blocked.",stageId:id,checks};
  }
  promote(stageId,approvalId){
    const stage=this.list().find(x=>x.id===stageId);if(!stage)return {state:"FAILURE",message:"Stage not found."};if(stage.state!=="SUCCESS")return {state:"BLOCKED",message:"Only a successfully validated stage can be promoted."};if(stage.promoted)return {state:"BLOCKED",message:"Stage was already promoted."};
    const p=this.store.get(stage.proposalId);if(!p)return {state:"FAILURE",message:"Proposal missing."};if(p.approvalId!==approvalId)return {state:"DENIED",message:"Approval ID does not match the staged proposal."};
    const result=this.workspace.apply({path:p.targetPath,content:p.proposedContent,expectedHash:p.expectedHash,approval:true,reason:`validated self-development stage ${stageId}: ${p.request}`});
    if(result.state==="SUCCESS"){stage.promoted=true;stage.promotedAt=new Date().toISOString();stage.promotion=result;this.save(stage);this.audit?.append({type:"selfdev.promote",stageId,proposalId:p.id,path:p.targetPath,snapshotId:result.snapshotId});}
    return result;
  }
}
