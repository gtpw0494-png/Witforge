import crypto from "node:crypto";
import {GovernanceDb} from "../governance-db.js";
const iso=()=>new Date().toISOString();
const owner=a=>Boolean(a?.allowed&&a?.auth?.authenticated&&a.auth.role==="owner");
export class PolicyStore{
  constructor(stateRoot,audit=null){this.db=new GovernanceDb(stateRoot);this.audit=audit;}
  list(limit=100){return this.db.list("governance-policy",limit).records||[];}
  get(id){return this.db.get("governance-policy",String(id||"")).record||null;}
  put({id=null,name,policy,version=1}={},authorization){
    if(!owner(authorization))return {state:"DENIED",message:"Authenticated local-owner authority is required to change governance policy."};
    const pid=id||"policy-"+crypto.randomUUID(),now=iso(),body={id:pid,name:String(name||pid).slice(0,256),policy:policy&&typeof policy==="object"?policy:{},version:Number(version)||1,updatedAt:now};
    const cur=this.db.get("governance-policy",pid),r=cur.record?this.db.cas("governance-policy",pid,cur.version,{...cur.record,...body},{type:"policy.update"}):this.db.create("governance-policy",{...body,createdAt:now});
    if(r.state==="SUCCESS")this.audit?.append({type:"governance.policy.changed",policyId:pid,authorizedBy:authorization.auth.identityId});return r;
  }
}
