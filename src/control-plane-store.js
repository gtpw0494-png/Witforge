import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let DatabaseSync=null;try{({DatabaseSync}=require("node:sqlite"));}catch{}
const iso=()=>new Date().toISOString();
const TABLES=Object.freeze({"shadow-run":"shadow_runs","shadow-candidate":"shadow_candidates","light-patch":"light_patches","light-worktree":"light_worktrees","agent-job":"agent_jobs"});
function meta(body={}){return {state:String(body.state||body.status||"UNKNOWN"),subject:body.subjectId||body.runId||body.patchId||body.parentRunId||null,agent:body.agentType||null,expires:body.expiresAt||null};}
export class ControlPlaneStore{
  constructor(stateRoot=null){
    this.script=path.join(root,"storage","control_plane.py");
    this.dbPath=stateRoot?path.join(stateRoot,"control-plane.sqlite3"):path.join(root,"state","control-plane.sqlite3");
    fs.mkdirSync(path.dirname(this.dbPath),{recursive:true});this.native=!!DatabaseSync;if(this.native)this._openNative();
  }
  _table(kind){const t=TABLES[kind];if(!t)throw new Error("Unsupported control-plane record kind.");return t;}
  _openNative(){
    this.db=new DatabaseSync(this.dbPath);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    for(const table of Object.values(TABLES))this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL,subject_id TEXT,agent_type TEXT,expires_at TEXT,body_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ${table}_state_idx ON ${table}(state,updated_at DESC); CREATE INDEX IF NOT EXISTS ${table}_subject_idx ON ${table}(subject_id,updated_at DESC);`);
    this.db.exec("CREATE TABLE IF NOT EXISTS control_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,event_type TEXT NOT NULL,body_json TEXT NOT NULL,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS control_events_record_idx ON control_events(kind,id,seq);");
  }
  _py(payload){const p=spawnSync(process.env.PYTHON||"python3",[this.script],{cwd:root,input:JSON.stringify(payload),encoding:"utf8",timeout:15000,maxBuffer:4_000_000,env:{...process.env,IUV_CONTROL_DB:this.dbPath}});if(p.error)return {state:"UNAVAILABLE",message:p.error.message};if(p.status!==0)return {state:"ERROR",message:(p.stderr||p.stdout||`control-plane DB exited ${p.status}`).slice(0,4000)};try{return JSON.parse((p.stdout||"{}").trim().split(/\n/).filter(Boolean).at(-1)||"{}");}catch{return {state:"ERROR",message:"Invalid control-plane DB response."};}}
  status(){
    if(!this.native)return this._py({action:"status"});
    const counts={},states={};for(const [kind,table] of Object.entries(TABLES)){counts[kind]=Number(this.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);states[kind]=Object.fromEntries(this.db.prepare(`SELECT state,COUNT(*) n FROM ${table} GROUP BY state`).all().map(r=>[r.state,Number(r.n)]));}
    return {state:"SUCCESS",path:this.dbPath,backend:"node:sqlite",journalMode:String(this.db.prepare("PRAGMA journal_mode").get().journal_mode||"wal"),tables:TABLES,counts,states};
  }
  get(kind,id){if(!this.native)return this._py({action:"get",kind,id});const table=this._table(kind),r=this.db.prepare(`SELECT body_json,version FROM ${table} WHERE id=?`).get(id);return r?{state:"SUCCESS",record:JSON.parse(r.body_json),version:Number(r.version)}:{state:"FAILURE",message:"Record not found."};}
  list(kind,limit=100,state=null){
    if(!this.native)return this._py({action:"list",kind,limit,state});const table=this._table(kind),lim=Math.max(1,Math.min(10000,Number(limit)||100));
    const rows=state?this.db.prepare(`SELECT body_json,version FROM ${table} WHERE state=? ORDER BY updated_at DESC LIMIT ?`).all(state,lim):this.db.prepare(`SELECT body_json,version FROM ${table} ORDER BY updated_at DESC LIMIT ?`).all(lim);
    return {state:"SUCCESS",records:rows.map(r=>({...JSON.parse(r.body_json),_version:Number(r.version)}))};
  }
  create(kind,body){
    if(!this.native)return this._py({action:"create",kind,id:body?.id,body});if(!body?.id)return {state:"BLOCKED",message:"id required"};
    const table=this._table(kind),m=meta(body),ts=iso();try{this.db.exec("BEGIN IMMEDIATE");this.db.prepare(`INSERT INTO ${table}(id,version,state,subject_id,agent_type,expires_at,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(body.id,1,m.state,m.subject,m.agent,m.expires,JSON.stringify(body),ts,ts);this.db.prepare("INSERT INTO control_events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)").run(kind,body.id,"create",JSON.stringify(body),ts);this.db.exec("COMMIT");return {state:"SUCCESS",record:body,version:1};}catch(e){try{this.db.exec("ROLLBACK");}catch{}return {state:/unique|constraint/i.test(e.message)?"BLOCKED":"ERROR",message:e.message};}
  }
  cas(kind,id,expectedVersion,body,event={type:"update"}){
    if(!this.native)return this._py({action:"cas",kind,id,expectedVersion,body,event});const table=this._table(kind),m=meta(body),ts=iso();
    try{this.db.exec("BEGIN IMMEDIATE");const cur=this.db.prepare(`SELECT version FROM ${table} WHERE id=?`).get(id);if(!cur){this.db.exec("ROLLBACK");return {state:"FAILURE",message:"Record not found."};}if(Number(cur.version)!==Number(expectedVersion)){this.db.exec("ROLLBACK");return {state:"CONFLICT",message:"Version conflict.",expected:Number(expectedVersion),actual:Number(cur.version)};}const nv=Number(expectedVersion)+1;const r=this.db.prepare(`UPDATE ${table} SET version=?,state=?,subject_id=?,agent_type=?,expires_at=?,body_json=?,updated_at=? WHERE id=? AND version=?`).run(nv,m.state,m.subject,m.agent,m.expires,JSON.stringify(body),ts,id,Number(expectedVersion));if(Number(r.changes)!==1){this.db.exec("ROLLBACK");return {state:"CONFLICT",message:"Concurrent update conflict."};}this.db.prepare("INSERT INTO control_events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)").run(kind,id,String(event.type||"update"),JSON.stringify(event),ts);this.db.exec("COMMIT");return {state:"SUCCESS",record:body,version:nv};}catch(e){try{this.db.exec("ROLLBACK");}catch{}return {state:"ERROR",message:e.message};}
  }
  events(kind,id){if(!this.native)return this._py({action:"events",kind,id});this._table(kind);const rows=this.db.prepare("SELECT seq,event_type,body_json,created_at FROM control_events WHERE kind=? AND id=? ORDER BY seq").all(kind,id);return {state:"SUCCESS",events:rows.map(r=>({seq:Number(r.seq),type:r.event_type,body:JSON.parse(r.body_json),createdAt:r.created_at}))};}
  migrateLegacy(kind,records=[]){let migrated=0,skipped=0;for(const raw of records){const body={...raw};delete body._version;if(!body.id){skipped++;continue;}if(this.get(kind,body.id).record){skipped++;continue;}const r=this.create(kind,body);if(r.state==="SUCCESS")migrated++;else skipped++;}return {state:"SUCCESS",kind,migrated,skipped};}
  close(){try{this.db?.close();}catch{}}
}
