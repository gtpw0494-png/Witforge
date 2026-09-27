#!/usr/bin/env python3
from __future__ import annotations
import json, os, sqlite3, sys
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parent.parent
DB=Path(os.getenv("IUV_PLATFORM_STATE_DB") or ROOT/"state"/"platform-intelligence.sqlite3")
TABLES={
  "memory-item":"memory_items",
  "memory-settings":"memory_settings",
  "provenance-node":"provenance_nodes",
  "provenance-edge":"provenance_edges",
  "model-artifact":"model_artifacts",
  "evaluation-run":"evaluation_runs",
  "policy-simulation":"policy_simulations",
  "code-file":"code_files",
  "code-symbol":"code_symbols",
  "code-edge":"code_edges",
  "media-artifact":"media_artifacts",
  "verified-knowledge":"verified_knowledge",
}
def now(): return datetime.now(timezone.utc).isoformat()
def connect():
    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB,timeout=10,isolation_level=None)
    c.row_factory=sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=FULL")
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA busy_timeout=5000")
    for table in TABLES.values():
        c.execute(f"""CREATE TABLE IF NOT EXISTS {table}(
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          state TEXT NOT NULL,
          owner_id TEXT,
          subject_id TEXT,
          source_id TEXT,
          body_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )""")
        c.execute(f"CREATE INDEX IF NOT EXISTS {table}_state_idx ON {table}(state,updated_at DESC)")
        c.execute(f"CREATE INDEX IF NOT EXISTS {table}_owner_idx ON {table}(owner_id,updated_at DESC)")
        c.execute(f"CREATE INDEX IF NOT EXISTS {table}_subject_idx ON {table}(subject_id,updated_at DESC)")
        c.execute(f"CREATE INDEX IF NOT EXISTS {table}_source_idx ON {table}(source_id,updated_at DESC)")
    c.execute("""CREATE TABLE IF NOT EXISTS platform_events(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      body_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )""")
    c.execute("CREATE INDEX IF NOT EXISTS platform_events_record_idx ON platform_events(kind,id,seq)")
    return c
def emit(x): print(json.dumps(x,separators=(",",":"),ensure_ascii=False))
def table_for(kind):
    t=TABLES.get(str(kind or ""))
    if not t: raise ValueError("Unsupported platform-state record kind.")
    return t
def meta(body):
    state=str(body.get("state") or body.get("status") or body.get("deletionState") or "ACTIVE")
    owner=body.get("ownerId") or body.get("owner") or None
    subject=body.get("subjectId") or body.get("memoryId") or body.get("modelId") or body.get("fromId") or None
    source=body.get("sourceId") or body.get("source") or None
    return state,owner,subject,source
def main():
    req=json.load(sys.stdin); action=req.get("action"); c=connect()
    try:
      if action=="status":
        counts={k:c.execute(f"SELECT COUNT(*) n FROM {t}").fetchone()["n"] for k,t in TABLES.items()}
        states={}
        for k,t in TABLES.items():
            states[k]={r["state"]:r["n"] for r in c.execute(f"SELECT state,COUNT(*) n FROM {t} GROUP BY state")}
        emit({"state":"SUCCESS","path":str(DB),"backend":"python-sqlite3","journalMode":c.execute("PRAGMA journal_mode").fetchone()[0],"tables":TABLES,"counts":counts,"states":states});return
      kind=str(req.get("kind") or ""); t=table_for(kind); rid=str(req.get("id") or "")
      if action=="get":
        r=c.execute(f"SELECT body_json,version FROM {t} WHERE id=?",(rid,)).fetchone()
        emit({"state":"SUCCESS","record":json.loads(r["body_json"]),"version":r["version"]} if r else {"state":"FAILURE","message":"Record not found."});return
      if action=="list":
        limit=max(1,min(10000,int(req.get("limit") or 100))); filters=req.get("filters") or {}
        allowed={"state":"state","ownerId":"owner_id","subjectId":"subject_id","sourceId":"source_id"}
        where=[]; args=[]
        for key,col in allowed.items():
            if filters.get(key) is not None:
                where.append(f"{col}=?");args.append(str(filters.get(key)))
        sql=f"SELECT body_json,version FROM {t}"+((" WHERE "+" AND ".join(where)) if where else "")+" ORDER BY updated_at DESC LIMIT ?"
        args.append(limit); rows=c.execute(sql,tuple(args)).fetchall()
        emit({"state":"SUCCESS","records":[dict(json.loads(r["body_json"]),_version=r["version"]) for r in rows]});return
      if action=="create":
        body=req.get("body") or {}; rid=str(body.get("id") or rid); ts=now()
        if not rid: emit({"state":"BLOCKED","message":"id required"});return
        state,owner,subject,source=meta(body)
        c.execute("BEGIN IMMEDIATE")
        try:
          c.execute(f"INSERT INTO {t}(id,version,state,owner_id,subject_id,source_id,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    (rid,1,state,owner,subject,source,json.dumps(body,separators=(",",":"),sort_keys=True),ts,ts))
          c.execute("INSERT INTO platform_events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)",
                    (kind,rid,"create",json.dumps(body,separators=(",",":"),sort_keys=True),ts))
          c.execute("COMMIT");emit({"state":"SUCCESS","record":body,"version":1});return
        except sqlite3.IntegrityError:
          c.execute("ROLLBACK");emit({"state":"BLOCKED","message":"Record already exists."});return
      if action=="cas":
        expected=int(req.get("expectedVersion") or 0);body=req.get("body") or {};event=req.get("event") or {"type":"update"};ts=now()
        state,owner,subject,source=meta(body)
        c.execute("BEGIN IMMEDIATE")
        r=c.execute(f"SELECT version FROM {t} WHERE id=?",(rid,)).fetchone()
        if not r: c.execute("ROLLBACK");emit({"state":"FAILURE","message":"Record not found."});return
        if r["version"]!=expected:
            c.execute("ROLLBACK");emit({"state":"CONFLICT","message":"Version conflict.","expected":expected,"actual":r["version"]});return
        newv=expected+1
        cur=c.execute(f"UPDATE {t} SET version=?,state=?,owner_id=?,subject_id=?,source_id=?,body_json=?,updated_at=? WHERE id=? AND version=?",
                      (newv,state,owner,subject,source,json.dumps(body,separators=(",",":"),sort_keys=True),ts,rid,expected))
        if cur.rowcount!=1: c.execute("ROLLBACK");emit({"state":"CONFLICT","message":"Concurrent update conflict."});return
        c.execute("INSERT INTO platform_events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)",
                  (kind,rid,str(event.get("type") or "update"),json.dumps(event,separators=(",",":"),sort_keys=True),ts))
        c.execute("COMMIT");emit({"state":"SUCCESS","record":body,"version":newv});return
      if action=="delete":
        c.execute("BEGIN IMMEDIATE")
        r=c.execute(f"SELECT body_json FROM {t} WHERE id=?",(rid,)).fetchone()
        if not r: c.execute("ROLLBACK");emit({"state":"FAILURE","message":"Record not found."});return
        event=req.get("event") or {"type":"delete"}
        c.execute(f"DELETE FROM {t} WHERE id=?",(rid,))
        c.execute("INSERT INTO platform_events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)",
                  (kind,rid,str(event.get("type") or "delete"),json.dumps(event,separators=(",",":"),sort_keys=True),now()))
        c.execute("COMMIT");emit({"state":"SUCCESS","deleted":True,"id":rid});return
      if action=="events":
        rows=c.execute("SELECT seq,event_type,body_json,created_at FROM platform_events WHERE kind=? AND id=? ORDER BY seq",(kind,rid)).fetchall()
        emit({"state":"SUCCESS","events":[{"seq":r["seq"],"type":r["event_type"],"body":json.loads(r["body_json"]),"createdAt":r["created_at"]} for r in rows]});return
      emit({"state":"BLOCKED","message":"Unknown platform-state DB action."})
    except ValueError as e:
      emit({"state":"BLOCKED","message":str(e)})
    finally:
      c.close()
if __name__=="__main__": main()
