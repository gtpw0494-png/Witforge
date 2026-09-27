import {GovernanceDb} from "../governance-db.js";
const owner=a=>Boolean(a?.allowed&&a?.auth?.authenticated&&a.auth.role==="owner");
const iso=()=>new Date().toISOString();
export class EmergencyStop{
  constructor(stateRoot,audit=null){this.db=new GovernanceDb(stateRoot);this.audit=audit;this.id="emergency-stop";}
  status(){const x=this.db.get("governance-control",this.id).record;return {state:"SUCCESS",engaged:x?.engaged===true,record:x||null};}
  engage(reason="owner emergency stop"){
    const cur=this.db.get("governance-control",this.id),now=iso(),body={id:this.id,engaged:true,reason:String(reason).slice(0,2000),engagedAt:now};
    const r=cur.record?this.db.cas("governance-control",this.id,cur.version,{...cur.record,...body},{type:"emergency.engage"}):this.db.create("governance-control",body);
    if(r.state==="SUCCESS")this.audit?.append({type:"governance.emergency.engaged",reason:body.reason});return r.state==="SUCCESS"?{state:"SUCCESS",...body}:r;
  }
  release(authorization,reason="owner release"){
    if(!owner(authorization))return {state:"DENIED",message:"Authenticated local-owner authority is required to release the emergency stop."};
    const cur=this.db.get("governance-control",this.id);if(!cur.record)return {state:"SUCCESS",engaged:false};
    const body={...cur.record,engaged:false,releasedAt:iso(),releaseReason:String(reason).slice(0,2000),releasedBy:authorization.auth.identityId};
    const r=this.db.cas("governance-control",this.id,cur.version,body,{type:"emergency.release"});if(r.state==="SUCCESS")this.audit?.append({type:"governance.emergency.released",releasedBy:body.releasedBy});return r.state==="SUCCESS"?{state:"SUCCESS",...body}:r;
  }
}
