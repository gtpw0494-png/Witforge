#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, re, sqlite3, sys, uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from storage.db import connect, init_schema, now, upsert_source

ACTIVE=("RETRIEVAL_ELIGIBLE","TRAINING_ELIGIBLE")
STATES={"RAW","QUARANTINED","PARSED","NORMALIZED","REVIEW_REQUIRED","RETRIEVAL_ELIGIBLE","TRAINING_ELIGIBLE","REJECTED","DELETED"}
DEFAULT_OBJECT_ROOT=ROOT/"data"/"objects"

def emit(x): print(json.dumps(x,ensure_ascii=False))
def sha(text): return hashlib.sha256(str(text).encode("utf-8")).hexdigest()
def canonical_uri(value):
    s=str(value or "").strip()
    if not s:return ""
    try:
        u=urlsplit(s)
        if u.scheme.lower() in ("http","https"):
            host=(u.hostname or "").lower()
            port=f":{u.port}" if u.port and not ((u.scheme.lower()=="http" and u.port==80) or (u.scheme.lower()=="https" and u.port==443)) else ""
            path=u.path or "/"
            return urlunsplit((u.scheme.lower(),host+port,path,u.query,""))
    except Exception:pass
    return s

def normalize_text(text):
    x=str(text or "").replace("\r\n","\n").replace("\r","\n")
    x="\n".join(line.rstrip() for line in x.split("\n"))
    x=re.sub(r"[\t ]+"," ",x)
    x=re.sub(r"\n{3,}","\n\n",x)
    return x.strip()

def chunks(text,max_chars=1200):
    max_chars=max(200,min(8000,int(max_chars or 1200)))
    paras=[x.strip() for x in re.split(r"\n\s*\n",text) if x.strip()]
    out=[];buf=""
    def flush():
        nonlocal buf
        if buf.strip():out.append(buf.strip())
        buf=""
    for para in paras:
        if len(para)<=max_chars:
            candidate=(buf+"\n\n"+para).strip() if buf else para
            if len(candidate)<=max_chars:buf=candidate
            else:flush();buf=para
            continue
        flush();words=para.split();piece=""
        for word in words:
            candidate=(piece+" "+word).strip()
            if len(candidate)>max_chars and piece:out.append(piece);piece=word
            else:piece=candidate
        if piece:out.append(piece)
    flush()
    return out or ([text] if text else [])

def schema(c):
    c.executescript("""
    CREATE TABLE IF NOT EXISTS documents(
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      canonical_uri TEXT NOT NULL,
      original_uri TEXT,
      title TEXT,
      language TEXT,
      revision INTEGER NOT NULL,
      status TEXT NOT NULL,
      mime_type TEXT,
      publisher TEXT,
      retrieved_at TEXT,
      content_hash TEXT NOT NULL,
      object_relpath TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      normalization_version TEXT NOT NULL,
      quality_score REAL,
      retrieval_eligible INTEGER NOT NULL DEFAULT 0,
      training_eligible INTEGER NOT NULL DEFAULT 0,
      training_approved INTEGER NOT NULL DEFAULT 0,
      provenance_json TEXT NOT NULL DEFAULT '{}',
      security_json TEXT NOT NULL DEFAULT '{}',
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(canonical_uri,revision)
    );
    CREATE INDEX IF NOT EXISTS documents_source_idx ON documents(source_id,status);
    CREATE INDEX IF NOT EXISTS documents_hash_idx ON documents(content_hash);
    CREATE INDEX IF NOT EXISTS documents_uri_idx ON documents(canonical_uri,revision DESC);
    CREATE TABLE IF NOT EXISTS document_chunks(
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(document_id,ordinal)
    );
    CREATE INDEX IF NOT EXISTS document_chunks_doc_idx ON document_chunks(document_id,ordinal);
    CREATE TABLE IF NOT EXISTS ingestion_events(
      id TEXT PRIMARY KEY,
      document_id TEXT,
      source_id TEXT,
      stage TEXT NOT NULL,
      state TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ingestion_events_doc_idx ON ingestion_events(document_id,created_at);
    """)
    fts=False
    try:
        c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(chunk_id UNINDEXED,text)")
        fts=True
    except sqlite3.OperationalError:
        pass
    c.commit();return fts

def object_root(value=None):
    p=Path(value or os.getenv("IUV_OBJECT_ROOT") or DEFAULT_OBJECT_ROOT)
    p.mkdir(parents=True,exist_ok=True);return p

def object_path(root,digest):
    p=root/digest[:2]/f"{digest}.txt";p.parent.mkdir(parents=True,exist_ok=True);return p

def event(c,document_id,source_id,stage,state,details=None):
    c.execute("INSERT INTO ingestion_events(id,document_id,source_id,stage,state,details_json,created_at) VALUES(?,?,?,?,?,?,?)",
              (f"evt-{uuid.uuid4()}",document_id,source_id,stage,state,json.dumps(details or {},sort_keys=True),now()))

def source_payload(rec):
    return {
      "id":rec["source_id"],"name":rec.get("source_name") or rec["source_id"],
      "source_type":rec.get("source_type") or "document",
      "license":rec.get("license") or "UNKNOWN","license_url":rec.get("license_url"),
      "source_url":rec.get("source_url") or rec.get("canonical_uri") or rec.get("original_uri"),
      "training_eligible":bool(rec.get("source_training_eligible") or rec.get("training_eligible")),
      "metadata":{"licenseSource":rec.get("license_source") or "UNVERIFIED","owner":rec.get("owner"),"publisher":rec.get("publisher")}
    }

def ingest(c,root,rec):
    sid=str(rec.get("source_id") or "").strip()
    if not sid:return {"state":"BLOCKED","message":"source_id is required."}
    text=normalize_text(rec.get("text"))
    if not text:return {"state":"BLOCKED","message":"Document text is empty after normalization."}
    uri=canonical_uri(rec.get("canonical_uri") or rec.get("original_uri") or f"urn:uai:{sid}:{sha(text)}")
    digest=sha(text)
    existing=c.execute("SELECT * FROM documents WHERE source_id=? AND canonical_uri=? AND content_hash=? AND deleted_at IS NULL ORDER BY revision DESC LIMIT 1",(sid,uri,digest)).fetchone()
    if existing:return {"state":"SUCCESS","duplicate":True,"document":dict(existing),"message":"Identical active document revision already exists."}

    upsert_source(c,source_payload({**rec,"source_id":sid,"canonical_uri":uri}))
    security=rec.get("security") or {}
    risk=str(security.get("risk") or "LOW").upper()
    requested_retrieval=bool(rec.get("retrieval_eligible"))
    approved=bool(rec.get("training_approved"))
    source_training=bool(rec.get("source_training_eligible") or rec.get("training_eligible"))
    retrieval=requested_retrieval and risk!="HIGH"
    training=retrieval and source_training and approved
    if risk=="HIGH":status="QUARANTINED"
    elif training:status="TRAINING_ELIGIBLE"
    elif retrieval:status="RETRIEVAL_ELIGIBLE"
    else:status="REVIEW_REQUIRED"
    if status not in STATES:raise ValueError("invalid document state")

    revision=int(c.execute("SELECT COALESCE(MAX(revision),0)+1 FROM documents WHERE canonical_uri=?",(uri,)).fetchone()[0])
    doc_id=f"doc-{uuid.uuid4()}"
    obj=object_path(root,digest)
    if not obj.exists():obj.write_text(text,encoding="utf-8")
    rel=str(obj.relative_to(root))
    ts=now()
    c.execute("BEGIN IMMEDIATE")
    try:
        event(c,doc_id,sid,"RAW","SUCCESS",{"originalUri":rec.get("original_uri"),"mimeType":rec.get("mime_type")})
        event(c,doc_id,sid,"NORMALIZED","SUCCESS",{"contentHash":digest,"normalizationVersion":rec.get("normalization_version") or "uai-normalize-v1"})
        c.execute("""INSERT INTO documents(id,source_id,canonical_uri,original_uri,title,language,revision,status,mime_type,publisher,retrieved_at,content_hash,object_relpath,parser_version,normalization_version,quality_score,retrieval_eligible,training_eligible,training_approved,provenance_json,security_json,deleted_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",(
          doc_id,sid,uri,rec.get("original_uri"),rec.get("title"),rec.get("language") or "unknown",revision,status,
          rec.get("mime_type") or "text/plain",rec.get("publisher"),rec.get("retrieved_at"),digest,rel,
          rec.get("parser_version") or "uai-parser-text-v1",rec.get("normalization_version") or "uai-normalize-v1",
          rec.get("quality_score"),1 if retrieval else 0,1 if training else 0,1 if approved else 0,
          json.dumps(rec.get("provenance") or {},sort_keys=True),json.dumps(security,sort_keys=True),None,ts,ts))
        built=chunks(text,rec.get("chunk_max_chars") or 1200)
        for ordinal,chunk in enumerate(built):
            cid=f"chunk-{uuid.uuid4()}";ch=sha(chunk)
            c.execute("INSERT INTO document_chunks(id,document_id,ordinal,text,token_count,content_hash,status,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (cid,doc_id,ordinal,chunk,len(chunk.split()),ch,status,json.dumps({"language":rec.get("language") or "unknown"},sort_keys=True),ts))
            if retrieval:
                try:c.execute("INSERT INTO document_chunks_fts(chunk_id,text) VALUES(?,?)",(cid,chunk))
                except sqlite3.OperationalError:pass
        event(c,doc_id,sid,status,"SUCCESS",{"chunks":len(built),"retrievalEligible":retrieval,"trainingEligible":training,"trainingApproved":approved})
        c.execute("COMMIT")
    except Exception:
        c.execute("ROLLBACK");raise
    row=c.execute("SELECT * FROM documents WHERE id=?",(doc_id,)).fetchone()
    return {"state":"SUCCESS","duplicate":False,"document":dict(row),"chunks":len(built),"objectPath":str(obj),"message":f"Document revision {revision} stored as {status}."}

def get_doc(c,doc_id):
    row=c.execute("SELECT * FROM documents WHERE id=?",(doc_id,)).fetchone()
    if not row:return {"state":"FAILURE","message":"Document not found."}
    d=dict(row);d["provenance"]=json.loads(d.pop("provenance_json") or "{}");d["security"]=json.loads(d.pop("security_json") or "{}")
    d["chunks"]=[dict(x) for x in c.execute("SELECT id,ordinal,token_count,content_hash,status FROM document_chunks WHERE document_id=? ORDER BY ordinal",(doc_id,))]
    return {"state":"SUCCESS","document":d}

def list_docs(c,limit=100,status=None):
    params=[];where=""
    if status:where="WHERE d.status=?";params.append(status)
    params.append(max(1,min(1000,int(limit or 100))))
    rows=[dict(x) for x in c.execute(f"""SELECT d.id,d.source_id,d.canonical_uri,d.title,d.language,d.revision,d.status,d.mime_type,d.publisher,d.retrieved_at,d.content_hash,d.retrieval_eligible,d.training_eligible,d.training_approved,d.deleted_at,d.created_at,d.updated_at,COUNT(ch.id) chunk_count
      FROM documents d LEFT JOIN document_chunks ch ON ch.document_id=d.id {where} GROUP BY d.id ORDER BY d.updated_at DESC LIMIT ?""",params)]
    return {"state":"SUCCESS","documents":rows}

def search(c,query,limit=8):
    q=str(query or "").strip();limit=max(1,min(100,int(limit or 8)))
    if not q:return {"state":"BLOCKED","message":"query is required.","matches":[]}
    rows=[]
    try:
        terms=[x for x in re.findall(r"[\w'-]+",q,re.UNICODE) if len(x)>1][:16]
        match=" OR ".join('"'+x.replace('"',"")+'"' for x in terms)
        if match:
            rows=c.execute("""SELECT ch.id chunk_id,ch.document_id,ch.ordinal,ch.text,ch.token_count,ch.content_hash,
              d.title,d.canonical_uri,d.source_id,d.revision,d.status,d.publisher,d.retrieved_at,d.provenance_json,
              bm25(document_chunks_fts) bm25
              FROM document_chunks_fts f JOIN document_chunks ch ON ch.id=f.chunk_id JOIN documents d ON d.id=ch.document_id
              WHERE document_chunks_fts MATCH ? AND d.deleted_at IS NULL AND d.retrieval_eligible=1 AND d.status IN ('RETRIEVAL_ELIGIBLE','TRAINING_ELIGIBLE')
              ORDER BY bm25(document_chunks_fts) LIMIT ?""",(match,limit)).fetchall()
    except sqlite3.OperationalError:rows=[]
    if not rows:
        rows=c.execute("""SELECT ch.id chunk_id,ch.document_id,ch.ordinal,ch.text,ch.token_count,ch.content_hash,
          d.title,d.canonical_uri,d.source_id,d.revision,d.status,d.publisher,d.retrieved_at,d.provenance_json,NULL bm25
          FROM document_chunks ch JOIN documents d ON d.id=ch.document_id
          WHERE d.deleted_at IS NULL AND d.retrieval_eligible=1 AND d.status IN ('RETRIEVAL_ELIGIBLE','TRAINING_ELIGIBLE') AND lower(ch.text) LIKE lower(?)
          ORDER BY d.updated_at DESC,ch.ordinal LIMIT ?""",(f"%{q}%",limit)).fetchall()
    matches=[]
    for r in rows:
        x=dict(r);x["provenance"]=json.loads(x.pop("provenance_json") or "{}");matches.append(x)
    return {"state":"SUCCESS" if matches else "UNAVAILABLE","query":q,"matches":matches,"message":f"Found {len(matches)} eligible document chunk(s)." if matches else "No eligible document chunks matched."}

def set_deleted(c,root,doc_id,hard=False,reason="user-requested deletion"):
    row=c.execute("SELECT * FROM documents WHERE id=?",(doc_id,)).fetchone()
    if not row:return {"state":"FAILURE","message":"Document not found."}
    chunk_ids=[x[0] for x in c.execute("SELECT id FROM document_chunks WHERE document_id=?",(doc_id,))]
    c.execute("BEGIN IMMEDIATE")
    try:
        for cid in chunk_ids:
            try:c.execute("DELETE FROM document_chunks_fts WHERE chunk_id=?",(cid,))
            except sqlite3.OperationalError:pass
        if hard:
            c.execute("DELETE FROM documents WHERE id=?",(doc_id,))
            event(c,None,row["source_id"],"DELETED","SUCCESS",{"documentId":doc_id,"mode":"HARD_PURGE","reason":reason})
        else:
            ts=now();c.execute("UPDATE documents SET status='DELETED',retrieval_eligible=0,training_eligible=0,deleted_at=?,updated_at=? WHERE id=?",(ts,ts,doc_id))
            c.execute("UPDATE document_chunks SET status='DELETED' WHERE document_id=?",(doc_id,))
            event(c,doc_id,row["source_id"],"DELETED","SUCCESS",{"mode":"SOFT_DELETE","reason":reason})
        c.execute("COMMIT")
    except Exception:
        c.execute("ROLLBACK");raise
    object_removed=False
    if hard:
        refs=c.execute("SELECT COUNT(*) FROM documents WHERE content_hash=?",(row["content_hash"],)).fetchone()[0]
        if refs==0:
            p=root/row["object_relpath"]
            if p.exists():p.unlink();object_removed=True
    return {"state":"SUCCESS","documentId":doc_id,"mode":"HARD_PURGE" if hard else "SOFT_DELETE","objectRemoved":object_removed}

def reindex(c):
    schema(c)
    try:
        c.execute("DELETE FROM document_chunks_fts")
        rows=c.execute("""SELECT ch.id,ch.text FROM document_chunks ch JOIN documents d ON d.id=ch.document_id
          WHERE d.deleted_at IS NULL AND d.retrieval_eligible=1 AND d.status IN ('RETRIEVAL_ELIGIBLE','TRAINING_ELIGIBLE')""").fetchall()
        c.executemany("INSERT INTO document_chunks_fts(chunk_id,text) VALUES(?,?)",[(r["id"],r["text"]) for r in rows]);c.commit()
        return {"state":"SUCCESS","indexed":len(rows),"fts5":True}
    except sqlite3.OperationalError as e:return {"state":"UNAVAILABLE","indexed":0,"fts5":False,"message":str(e)}

def status(c,root,fts):
    counts={r["status"]:r["n"] for r in c.execute("SELECT status,COUNT(*) n FROM documents GROUP BY status")}
    return {"state":"SUCCESS","documents":sum(counts.values()),"byStatus":counts,"chunks":c.execute("SELECT COUNT(*) FROM document_chunks").fetchone()[0],
            "events":c.execute("SELECT COUNT(*) FROM ingestion_events").fetchone()[0],"fts5":fts,"objectRoot":str(root),
            "objects":sum(1 for p in root.rglob("*.txt") if p.is_file())}

def main():
    ap=argparse.ArgumentParser();sp=ap.add_subparsers(dest="cmd",required=True)
    for cmd in ["init","status","reindex"]:sp.add_parser(cmd)
    i=sp.add_parser("ingest");i.add_argument("--json")
    s=sp.add_parser("search");s.add_argument("--query",required=True);s.add_argument("--limit",type=int,default=8)
    g=sp.add_parser("get");g.add_argument("--id",required=True)
    l=sp.add_parser("list");l.add_argument("--limit",type=int,default=100);l.add_argument("--status")
    for name in ["delete","purge"]:
        x=sp.add_parser(name);x.add_argument("--id",required=True);x.add_argument("--reason",default="user-requested deletion")
    ap.add_argument("--db");ap.add_argument("--object-root")
    a=ap.parse_args();c,p=connect(a.db);init_schema(c);fts=schema(c);root=object_root(a.object_root)
    try:
        if a.cmd=="init":out={"state":"SUCCESS","database":str(p),"fts5":fts,"objectRoot":str(root)}
        elif a.cmd=="status":out=status(c,root,fts)
        elif a.cmd=="ingest":
            raw=a.json if a.json is not None else sys.stdin.read()
            out=ingest(c,root,json.loads(raw or "{}"))
        elif a.cmd=="search":out=search(c,a.query,a.limit)
        elif a.cmd=="get":out=get_doc(c,a.id)
        elif a.cmd=="list":out=list_docs(c,a.limit,a.status)
        elif a.cmd=="delete":out=set_deleted(c,root,a.id,False,a.reason)
        elif a.cmd=="purge":out=set_deleted(c,root,a.id,True,a.reason)
        else:out=reindex(c)
        emit(out)
    finally:c.close()
if __name__=="__main__":main()
