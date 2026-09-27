import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let DatabaseSync=null;try{({DatabaseSync}=require("node:sqlite"));}catch{}
const iso=()=>new Date().toISOString();
export const PLATFORM_TABLES=Object.freeze({
  "memory-item":"memory_items","memory-settings":"memory_settings","provenance-node":"provenance_nodes","provenance-edge":"provenance_edges",
  "model-artifact":"model_artifacts","evaluation-run":"evaluation_runs","policy-simulation":"policy_simulations",
  "code-file":"code_files","code-symbol":"code_symbols","code-edge":"code_edges","media-artifact":"media_artifacts","verified-knowledge":"verified_knowledge"
});
const meta=(body={})=>({
  state:String(body.state||body.status||body.deletionState||"ACTIVE"),
  owner:body.ownerId||body.owner||null,
  subject:body.subjectId||body.memoryId||body.modelId||body.fromId||null,
  source:body.sourceId||body.source||null
});
export class PlatformStateStore{
  constructor(stateRoot=null){
    this.script=path.join(root,"storage","platform_state.py");
    this.dbPath=stateRoot?path.join(stateRoot,"platform-intelligence.sqlite3"):path.join(root,"state","platform-intelligence.sqlite3");
    fs.mkdirSync(path.dirname(this.dbPath),{recursive:true});this.native=!!DatabaseSync;if(this.native)this._openNative();
  }
  _table(kind){const t=PLATFORM_TABLES[kind];if(!t)throw new Error("Unsupported platform-state record kind.");return t;}
  _openNative(){
    this.db=new DatabaseSync(this.dbPath);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    for(const table of Object.values(PLATFORM_TABLES))this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL,owner_id TEXT,subject_id TEXT,source_id TEXT,body_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ${table}_state_idx ON ${table}(state,updated_at DESC); CREATE INDEX IF NOT EXISTS ${table}_owner_idx ON ${table}(owner_id,updated_at DESC); CREATE INDEX IF NOT EXISTS ${table}_subject_idx ON ${table}(subject_id,updated_at DESC); CREATE INDEX IF NOT EXISTS ${table}_source_idx ON ${table}(source_id,updated_at DESC);`);
    this.db.exec("CREATE TABLE IF NOT EXISTS platform_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,event_type TEXT NOT NULL,body_json TEXT NOT NULL,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS platform_events_record_idx ON platform_events(kind,id,seq);");
  }
  _py(payload){const p=spawnSync(process.env.PYTHON||"python3",[this.script],{cwd:root,input:JSON.stringify(payload),encoding:"utf8",timeout:15000,maxBuffer:4_000_000,env:{...process.env,IUV_PLATFORM_STATE_DB:this.dbPath}});if(p.error)return {state:"UNAVAILABLE",message:p.error.message};if(p.status!==0)return {state:"ERROR",message:(p.stderr||p.stdout||`platform-state DB exited ${p.status}`).slice(0,4000)};try{return JSON.parse((p.stdout||"{}").trim().split(/\n/).filter(Boolean).at(-1)||"{}");}catch{return {state:"ERROR",message:"Invalid platform-state DB response."};}}
  status(){
    if(!this.native)return this._py({action:"status"});
    const counts={},states={};for(const [kind,table] of Object.entries(PLATFORM_TABLES)){counts[kind]=Number(this.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);states[kind]=Object.fromEntries(this.db.prepare(`SELECT state,COUNT(*) n FROM ${table} GROUP BY state`).all().map(r=>[r.state,Number(r.n)]));}
    return {state:"SUCCESS",path:this.dbPath,backend:"node:sqlite",journalMode:String(this.db.prepare("PRAGMA journal_mode").get().journal_mode||"wal"),tables:PLATFORM_TABLES,counts,states};
  }
  get(kind,id){if(!this.native)return this._py({action:"get",kind,id});const table=this._table(kind),r=this.db.prepare(`SELECT body_json,version FROM ${table} WHERE id=?`).get(id);return r?{state:"SUCCESS",record:JSON.parse(r.body_json),version:Number(r.version)}:{state:"FAILURE",message:"Record not found."};}
  list(kind,limit=100,filters={}){
    if(!this.native)return this._py({action:"list",kind,limit,filters});const table=this._table(kind),allowed={state:"state",ownerId:"owner_id",subjectId:"subject_id",sourceId:"source_id"},where=[],args=[];
    for(const [key,col] of Object.entries(allowed))if(filters?.[key]!==undefined&&filters?.[key]!==null){where.push(`${col}=?`);args.push(String(filters[key]));}
    const sql=`SELECT body_json,version FROM ${table}${where.length?" WHERE "+where.join(" AND "):""} ORDER BY updated_at DESC LIMIT ?`;args.push(Math.max(1,Math.min(10000,Number(limit)||100)));
    return {state:"SUCCESS",records:this.db.prepare(sql).all(...args).map(r=>({...JSON.parse(r.body_json),_version:Number(r.version)}))};
  }
  create(kind,body){
    if(!this.native)return this._py({action:"create",kind,id:body?.id,body});if(!body?.id)return {state:"BLOCKED",message:"id required"};const table=this._table(kind),m=meta(body),ts=iso();
    try{this.db.exec("BEGIN IMMEDIATE");this.db.prepare(`INSERT INTO ${table}(id,version,state,owner_id,subject_id,source_id,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(body.id,1,m.state,m.owner,m.subject,m.source,JSON.stringify(body),ts,ts);this.db.prepare("INSERT INTO platform_events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)").run(kind,body.id,"create",JSON.stringify(body),ts);this.db.exec("COMMIT");return {state:"SUCCESS",record:body,version:1};}catch(e){try{this.db.exec("ROLLBACK");}catch{}return {state:/unique|constraint/i.test(e.message)?"BLOCKED":"ERROR",message:e.message};}
  }
  cas(kind,id,expectedVersion,body,event={type:"update"}){
    if(!this.native)return this._py({action:"cas",kind,id,expectedVersion,body,event});const table=this._table(kind),m=meta(body),ts=iso();
    try{this.db.exec("BEGIN IMMEDIATE");const cur=this.db.prepare(`SELECT version FROM ${table} WHERE id=?`).get(id);if(!cur){this.db.exec("ROLLBACK");return {state:"FAILURE",message:"Record not found."};}if(Number(cur.version)!==Number(expectedVersion)){this.db.exec("ROLLBACK");return {state:"CONFLICT",message:"Version conflict.",expected:Number(expectedVersion),actual:Number(cur.version)};}const nv=Number(expectedVersion)+1;const r=this.db.prepare(`UPDATE ${table} SET version=?,state=?,owner_id=?,subject_id=?,source_id=?,body_json=?,updated_at=? WHERE id=? AND version=?`).run(nv,m.state,m.owner,m.subject,m.source,JSON.stringify(body),ts,id,Number(expectedVersion));if(Number(r.changes)!==1){this.db.exec("ROLLBACK");return {state:"CONFLICT",message:"Concurrent update conflict."};}this.db.prepare("INSERT INTO platform_events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)").run(kind,id,String(event.type||"update"),JSON.stringify(event),ts);this.db.exec("COMMIT");return {state:"SUCCESS",record:body,version:nv};}catch(e){try{this.db.exec("ROLLBACK");}catch{}return {state:"ERROR",message:e.message};}
  }
  delete(kind,id,event={type:"delete"}){if(!this.native)return this._py({action:"delete",kind,id,event});const table=this._table(kind);try{this.db.exec("BEGIN IMMEDIATE");const cur=this.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id);if(!cur){this.db.exec("ROLLBACK");return {state:"FAILURE",message:"Record not found."};}this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);this.db.prepare("INSERT INTO platform_events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)").run(kind,id,String(event.type||"delete"),JSON.stringify(event),iso());this.db.exec("COMMIT");return {state:"SUCCESS",deleted:true,id};}catch(e){try{this.db.exec("ROLLBACK");}catch{}return {state:"ERROR",message:e.message};}}
  events(kind,id){if(!this.native)return this._py({action:"events",kind,id});this._table(kind);return {state:"SUCCESS",events:this.db.prepare("SELECT seq,event_type,body_json,created_at FROM platform_events WHERE kind=? AND id=? ORDER BY seq").all(kind,id).map(r=>({seq:Number(r.seq),type:r.event_type,body:JSON.parse(r.body_json),createdAt:r.created_at}))};}
  close(){try{this.db?.close();}catch{}}
}
