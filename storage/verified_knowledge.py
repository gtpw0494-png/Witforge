#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, os, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path

DB=Path(os.getenv("IUV_VERIFIED_KNOWLEDGE_DB") or Path(__file__).resolve().parents[1]/"state"/"verified-knowledge.sqlite3")

def now(): return datetime.now(timezone.utc).isoformat()
def connect():
    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB,timeout=10,isolation_level=None)
    c.row_factory=sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=FULL")
    c.execute("PRAGMA busy_timeout=5000")
    c.execute("""CREATE TABLE IF NOT EXISTS knowledge_facts(
      fact_id TEXT PRIMARY KEY,
      claim_hash TEXT,
      subject TEXT NOT NULL,
      claim TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_trust REAL NOT NULL DEFAULT 0,
      corroboration INTEGER NOT NULL DEFAULT 0,
      rights_corroboration INTEGER NOT NULL DEFAULT 0,
      training_eligible INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT,
      observed_at TEXT,
      body_json TEXT NOT NULL,
      stored_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )""")
    c.execute("CREATE INDEX IF NOT EXISTS knowledge_facts_training_idx ON knowledge_facts(training_eligible,updated_at DESC)")
    c.execute("CREATE INDEX IF NOT EXISTS knowledge_facts_claim_idx ON knowledge_facts(claim_hash)")
    c.execute("CREATE INDEX IF NOT EXISTS knowledge_facts_source_idx ON knowledge_facts(source_id,updated_at DESC)")
    return c

def eligible(f):
    v=f.get("verification") or {}
    return f.get("training_eligible") is True and v.get("verified") is True and v.get("training_rights_verified") is True

def fact_id(f):
    raw="|".join(str(f.get(k) or "") for k in ("subject","claim","source_id","source_url"))
    return str(f.get("fact_id") or hashlib.sha256(raw.encode()).hexdigest())

def emit(x): print(json.dumps(x,separators=(",",":"),ensure_ascii=False))
def integrity(c):
    h=hashlib.sha256()
    for r in c.execute("SELECT fact_id,claim_hash,content_hash,updated_at FROM knowledge_facts ORDER BY fact_id"):
        h.update("|".join(str(r[k] or "") for k in ("fact_id","claim_hash","content_hash","updated_at")).encode())
        h.update(b"\n")
    return h.hexdigest()

def main():
    req=json.load(sys.stdin);action=req.get("action");c=connect()
    try:
      if action=="status":
        total=c.execute("SELECT COUNT(*) n FROM knowledge_facts").fetchone()["n"]
        train=c.execute("SELECT COUNT(*) n FROM knowledge_facts WHERE training_eligible=1").fetchone()["n"]
        emit({"state":"SUCCESS","backend":"python-sqlite3","path":str(DB),"journalMode":c.execute("PRAGMA journal_mode").fetchone()[0],"count":total,"training_eligible":train,"integrity_sha256":integrity(c)});return
      if action=="upsert":
        facts=req.get("facts") or [];written=0;ts=now();c.execute("BEGIN IMMEDIATE")
        try:
          for raw in facts:
            if not eligible(raw): continue
            f=dict(raw);fid=fact_id(f);f["fact_id"]=fid;f["stored_at"]=f.get("stored_at") or ts
            c.execute("""INSERT INTO knowledge_facts(fact_id,claim_hash,subject,claim,source_id,source_url,source_trust,corroboration,rights_corroboration,training_eligible,content_hash,observed_at,body_json,stored_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(fact_id) DO UPDATE SET claim_hash=excluded.claim_hash,subject=excluded.subject,claim=excluded.claim,source_id=excluded.source_id,source_url=excluded.source_url,source_trust=excluded.source_trust,corroboration=excluded.corroboration,rights_corroboration=excluded.rights_corroboration,training_eligible=excluded.training_eligible,content_hash=excluded.content_hash,observed_at=excluded.observed_at,body_json=excluded.body_json,updated_at=excluded.updated_at""",
              (fid,f.get("claim_hash"),str(f.get("subject") or ""),str(f.get("claim") or ""),str(f.get("source_id") or ""),str(f.get("source_url") or ""),float(f.get("source_trust") or 0),int(f.get("corroboration") or 0),int(f.get("rights_corroboration") or 0),1,f.get("content_hash"),f.get("observed_at"),json.dumps(f,separators=(",",":"),sort_keys=True),f["stored_at"],ts))
            written+=1
          c.execute("COMMIT")
        except Exception:
          c.execute("ROLLBACK");raise
        total=c.execute("SELECT COUNT(*) n FROM knowledge_facts").fetchone()["n"]
        emit({"state":"SUCCESS","written":written,"total":total});return
      if action in {"list","training"}:
        limit=max(1,min(100000,int(req.get("limit") or 100)))
        where=" WHERE training_eligible=1" if action=="training" else ""
        rows=c.execute(f"SELECT body_json FROM knowledge_facts{where} ORDER BY updated_at DESC LIMIT ?",(limit,)).fetchall()
        emit({"state":"SUCCESS","records":[json.loads(r["body_json"]) for r in rows]});return
      emit({"state":"BLOCKED","message":"Unknown verified-knowledge action."})
    finally:c.close()
if __name__=="__main__": main()
