import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {GovernanceDb} from "./governance-db.js";

export class AvailabilityLedger {
  constructor(stateRoot){
    fs.mkdirSync(stateRoot,{recursive:true});
    this.db=new GovernanceDb(stateRoot);
    this.legacy=path.join(stateRoot,"availability.json");
    this._migrate();
  }

  _strip(r){
    if(!r)return null;
    const x={...r};delete x._version;return x;
  }

  _migrate(){
    if(!fs.existsSync(this.legacy))return;
    let rows=[];try{rows=JSON.parse(fs.readFileSync(this.legacy,"utf8"));}catch{return;}
    for(const snap of rows){
      const id=snap.id||`availability-${crypto.createHash("sha256").update(JSON.stringify(snap)).digest("hex").slice(0,24)}`;
      if(!this.db.get("availability",id).record)this.db.create("availability",{id,...snap});
    }
    if(rows.length){try{fs.renameSync(this.legacy,this.legacy+".migrated-v043");}catch{}}
  }

  record(capabilities=[]){
    const observedAt=new Date().toISOString();
    const entries=capabilities.map(c=>({
      id:c.id,
      availability:c.availability||"UNKNOWN",
      executable:c.executable===true,
      reason:c.reason||null,
      constraints:c.constraints||[],
      evidenceClass:c.availability==="CONNECTED"
        ?(c.executable?"LOCAL_OR_LIVE_RUNTIME":"REGISTERED_SOURCE")
        :(c.availability==="CONFIGURED"?"CONFIGURATION_ONLY":"NO_CONNECTED_EVIDENCE")
    }));
    const snap={
      id:`availability-${crypto.randomUUID()}`,
      observedAt,
      observedEpochMs:Date.now(),
      total:entries.length,
      connected:entries.filter(x=>x.availability==="CONNECTED").length,
      configured:entries.filter(x=>x.availability==="CONFIGURED").length,
      entries
    };
    const r=this.db.create("availability",snap);
    if(r.state!=="SUCCESS")throw new Error(r.message||"Availability persistence failed.");
    return snap;
  }

  latest(){
    const rows=this.list(1000);
    rows.sort((a,b)=>{
      const av=Number(a.observedEpochMs)||Date.parse(a.observedAt||0)||0;
      const bv=Number(b.observedEpochMs)||Date.parse(b.observedAt||0)||0;
      return bv-av;
    });
    return rows[0]||{id:null,observedAt:null,observedEpochMs:null,total:0,connected:0,configured:0,entries:[]};
  }

  list(limit=50){
    return (this.db.list("availability",Math.max(1,Math.min(1000,Number(limit)||50))).records||[]).map(x=>this._strip(x));
  }
}
