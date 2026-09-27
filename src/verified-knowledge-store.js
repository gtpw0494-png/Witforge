import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PlatformStateStore } from "./platform-state-store.js";

function stable(value){
  if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";
  return JSON.stringify(value);
}

export class VerifiedKnowledgeStore {
  constructor({stateRoot=path.resolve("state")}={}) {
    this.stateRoot=stateRoot;
    this.dir=path.join(stateRoot,"knowledge-autonomy");
    this.legacyFile=path.join(this.dir,"verified-facts.json");
    this.db=new PlatformStateStore(stateRoot);
    fs.mkdirSync(this.dir,{recursive:true});
    this.migration=this._migrateLegacy();
  }

  factId(fact) {
    return crypto.createHash("sha256").update([fact.subject,fact.claim,fact.source_id,fact.source_url].join("|")).digest("hex");
  }

  _eligible(raw){
    return raw?.training_eligible===true &&
      raw?.verification?.verified===true &&
      raw?.verification?.training_rights_verified===true;
  }

  _record(raw){
    const fact_id=raw.fact_id||this.factId(raw);
    return {
      ...raw,
      id:fact_id,
      fact_id,
      state:"TRAINING_ELIGIBLE",
      subjectId:String(raw.subject||"").slice(0,512)||null,
      sourceId:String(raw.source_id||"").slice(0,1024)||null,
      stored_at:raw.stored_at||new Date().toISOString()
    };
  }

  _migrateLegacy(){
    if(!fs.existsSync(this.legacyFile))return{state:"SUCCESS",migrated:0,skipped:0,legacy:false};
    let rows=[];
    try{const parsed=JSON.parse(fs.readFileSync(this.legacyFile,"utf8"));rows=Array.isArray(parsed)?parsed:[];}
    catch{return{state:"PARTIAL",migrated:0,skipped:0,legacy:true,message:"Legacy verified-facts.json could not be parsed."};}
    let migrated=0,skipped=0;
    for(const raw of rows){
      if(!this._eligible(raw)){skipped++;continue;}
      const body=this._record(raw);
      const existing=this.db.get("verified-knowledge",body.id);
      if(existing.state==="SUCCESS"){skipped++;continue;}
      const out=this.db.create("verified-knowledge",body);
      if(out.state==="SUCCESS")migrated++;else skipped++;
    }
    if(migrated+skipped===rows.length){
      const archived=this.legacyFile+".migrated";
      try{if(fs.existsSync(archived))fs.rmSync(archived,{force:true});fs.renameSync(this.legacyFile,archived);}catch{}
    }
    return{state:"SUCCESS",migrated,skipped,legacy:true};
  }

  read(limit=100000){
    const out=this.db.list("verified-knowledge",Math.max(1,Math.min(100000,Number(limit)||100000)),{state:"TRAINING_ELIGIBLE"});
    return (out.records||[]).map(({_version,...x})=>x);
  }

  upsertMany(facts=[]) {
    let written=0,updated=0,skipped=0,conflicts=0;
    for(const raw of Array.isArray(facts)?facts:[]){
      if(!this._eligible(raw)){skipped++;continue;}
      const body=this._record(raw);
      const existing=this.db.get("verified-knowledge",body.id);
      if(existing.state==="SUCCESS"){
        const merged={...existing.record,...body,stored_at:existing.record.stored_at||body.stored_at,updated_at:new Date().toISOString()};
        const out=this.db.cas("verified-knowledge",body.id,existing.version,merged,{type:"knowledge.upsert"});
        if(out.state==="SUCCESS"){written++;updated++;}
        else if(out.state==="CONFLICT")conflicts++;
        else skipped++;
      }else{
        const out=this.db.create("verified-knowledge",body);
        if(out.state==="SUCCESS")written++;
        else if(out.state==="BLOCKED")conflicts++;
        else skipped++;
      }
    }
    const total=Number(this.db.status()?.counts?.["verified-knowledge"]||0);
    return{state:conflicts?"PARTIAL":"SUCCESS",written,updated,skipped,conflicts,total,backend:"sqlite-wal"};
  }

  filterTrainingEligible(limit=100) {
    const rows=this.db.list("verified-knowledge",Math.max(1,Math.min(100000,Number(limit)||100)),{state:"TRAINING_ELIGIBLE"}).records||[];
    return rows.filter(x=>this._eligible(x)).map(({_version,...x})=>x);
  }

  snapshot() {
    const status=this.db.status();
    const rows=this.read(100000).sort((a,b)=>String(a.fact_id).localeCompare(String(b.fact_id)));
    const count=Number(status?.counts?.["verified-knowledge"]??rows.length);
    const complete=rows.length===count;
    return {
      state:"SUCCESS",
      backend:status.backend||"sqlite",
      journal_mode:status.journalMode||"unknown",
      database:status.path||this.db.dbPath,
      count,
      training_eligible:rows.filter(x=>this._eligible(x)).length,
      integrity_sha256:crypto.createHash("sha256").update(stable(rows)).digest("hex"),
      integrity_complete:complete,
      migration:this.migration
    };
  }

  close(){this.db.close?.();}
}
export default VerifiedKnowledgeStore;
