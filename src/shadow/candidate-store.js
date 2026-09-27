import crypto from "node:crypto";
import {ControlPlaneStore} from "../control-plane-store.js";
import {GovernanceDb} from "../governance-db.js";
const iso=()=>new Date().toISOString();
const digest=v=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class CandidateStore{
  constructor(stateRoot,audit=null){this.db=new ControlPlaneStore(stateRoot);this.audit=audit;const legacy=new GovernanceDb(stateRoot);this.migration=this.db.migrateLegacy("shadow-candidate",legacy.list("shadow-candidate",10000).records||[]);legacy.close();}
  create({runId,kind="research",payload,evidence=[],scores={},provenance={}}){
    const id="candidate-"+crypto.randomUUID(),record={id,runId,kind,payload,evidence,scores,provenance,integrity:{algorithm:"sha256",digest:digest({runId,kind,payload,evidence,scores,provenance})},state:"QUARANTINED",trainingEligible:false,productionEligible:false,createdAt:iso(),updatedAt:iso()};
    const r=this.db.create("shadow-candidate",record);if(r.state==="SUCCESS")this.audit?.append({type:"shadow.candidate.created",candidateId:id,runId});return r.state==="SUCCESS"?record:r;
  }
  get(id){return this.db.get("shadow-candidate",id).record||null;}
  list(limit=100){return this.db.list("shadow-candidate",limit).records||[];}
  setState(id,state,extra={}){
    const cur=this.db.get("shadow-candidate",id);if(!cur.record)return {state:"FAILURE",message:"Candidate not found."};
    const map={QUARANTINED:["PENDING_PROMOTION","REJECTED"],PENDING_PROMOTION:["ACCEPTED","REJECTED"],ACCEPTED:["ARCHIVED"],REJECTED:["ARCHIVED"],ARCHIVED:[]};
    if(!map[cur.record.state]?.includes(state))return {state:"BLOCKED",message:`Illegal candidate transition ${cur.record.state} -> ${state}.`};
    const body={...cur.record,...extra,state,updatedAt:iso()};const r=this.db.cas("shadow-candidate",id,cur.version,body,{type:"candidate.transition",to:state});return r.state==="SUCCESS"?body:r;
  }
}
