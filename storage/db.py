#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, sqlite3, sys
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / 'data' / 'intraultuniversalion.sqlite3'

def now(): return datetime.now(timezone.utc).isoformat()
def digest(*parts):
    h=hashlib.sha256()
    for p in parts: h.update(str(p or '').encode('utf-8')); h.update(b'\0')
    return h.hexdigest()

def connect(db_path=None):
    p=Path(db_path or os.getenv('IUV_DB_PATH') or DEFAULT_DB)
    p.parent.mkdir(parents=True, exist_ok=True)
    c=sqlite3.connect(p)
    c.row_factory=sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA synchronous=NORMAL')
    return c,p

def init_schema(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS sources(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      license TEXT NOT NULL DEFAULT 'UNKNOWN',
      license_url TEXT,
      source_url TEXT,
      training_eligible INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS definitions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL,
      pos TEXT,
      definition TEXT NOT NULL,
      example TEXT,
      synset TEXT,
      source_id TEXT NOT NULL REFERENCES sources(id),
      record_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS definitions_term_idx ON definitions(term COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS lexical_relations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_synset TEXT NOT NULL,
      target_synset TEXT NOT NULL,
      relation TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      record_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lexical_rel_source_idx ON lexical_relations(source_synset,relation);
    CREATE INDEX IF NOT EXISTS lexical_rel_target_idx ON lexical_relations(target_synset,relation);
    CREATE TABLE IF NOT EXISTS dialogue_messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      parent_id TEXT,
      conversation_id TEXT,
      role TEXT,
      language TEXT,
      text TEXT NOT NULL,
      quality REAL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      record_hash TEXT NOT NULL UNIQUE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS dialogue_conv_idx ON dialogue_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS dialogue_parent_idx ON dialogue_messages(parent_id);
    CREATE TABLE IF NOT EXISTS knowledge_records(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      source_id TEXT,
      record_hash TEXT NOT NULL UNIQUE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ingest_runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT,
      kind TEXT NOT NULL,
      input_path TEXT,
      accepted INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS source_lifecycle(
      source_id TEXT PRIMARY KEY REFERENCES sources(id),
      retention_until TEXT,
      deleted_at TEXT,
      deletion_reason TEXT,
      updated_at TEXT NOT NULL
    );
    ''')
    fts=False
    try:
        c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS definitions_fts USING fts5(term, definition, example, content='definitions', content_rowid='id')")
        c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS dialogue_fts USING fts5(text, content='dialogue_messages', content_rowid='id')")
        c.executescript('''
        CREATE TRIGGER IF NOT EXISTS definitions_ai AFTER INSERT ON definitions BEGIN
          INSERT INTO definitions_fts(rowid,term,definition,example) VALUES(new.id,new.term,new.definition,coalesce(new.example,''));
        END;
        CREATE TRIGGER IF NOT EXISTS definitions_ad AFTER DELETE ON definitions BEGIN
          INSERT INTO definitions_fts(definitions_fts,rowid,term,definition,example) VALUES('delete',old.id,old.term,old.definition,coalesce(old.example,''));
        END;
        CREATE TRIGGER IF NOT EXISTS dialogue_ai AFTER INSERT ON dialogue_messages BEGIN
          INSERT INTO dialogue_fts(rowid,text) VALUES(new.id,new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS dialogue_ad AFTER DELETE ON dialogue_messages BEGIN
          INSERT INTO dialogue_fts(dialogue_fts,rowid,text) VALUES('delete',old.id,old.text);
        END;
        ''')
        fts=True
    except sqlite3.OperationalError:
        pass
    c.commit()
    return fts

def upsert_source(c, rec):
    sid=str(rec.get('id') or '').strip()
    if not sid: raise ValueError('source id required')
    c.execute('''INSERT INTO sources(id,name,source_type,license,license_url,source_url,training_eligible,metadata_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,source_type=excluded.source_type,license=excluded.license,
      license_url=excluded.license_url,source_url=excluded.source_url,training_eligible=excluded.training_eligible,metadata_json=excluded.metadata_json''',(
      sid,rec.get('name') or sid,rec.get('source_type') or 'dataset',rec.get('license') or 'UNKNOWN',rec.get('license_url'),rec.get('source_url'),1 if rec.get('training_eligible') else 0,json.dumps(rec.get('metadata') or {},sort_keys=True),now()))
    c.commit(); return sid

def add_definition(c, rec):
    rh=rec.get('record_hash') or digest(rec.get('term'),rec.get('pos'),rec.get('definition'),rec.get('example'),rec.get('synset'),rec.get('source_id'))
    cur=c.execute('''INSERT OR IGNORE INTO definitions(term,pos,definition,example,synset,source_id,record_hash,created_at) VALUES(?,?,?,?,?,?,?,?)''',(
      rec['term'],rec.get('pos'),rec['definition'],rec.get('example'),rec.get('synset'),rec['source_id'],rh,now()))
    return cur.rowcount>0

def add_lexical_relation(c, rec):
    rh=rec.get('record_hash') or digest(rec.get('source_synset'),rec.get('target_synset'),rec.get('relation'),rec.get('source_id'))
    cur=c.execute("INSERT OR IGNORE INTO lexical_relations(source_synset,target_synset,relation,source_id,record_hash,created_at) VALUES(?,?,?,?,?,?)",(
      rec['source_synset'],rec['target_synset'],rec['relation'],rec['source_id'],rh,now()))
    return cur.rowcount>0

def add_dialogue(c, rec):
    rh=rec.get('record_hash') or digest(rec.get('message_id'),rec.get('parent_id'),rec.get('conversation_id'),rec.get('role'),rec.get('language'),rec.get('text'),rec.get('source_id'))
    cur=c.execute('''INSERT OR IGNORE INTO dialogue_messages(message_id,parent_id,conversation_id,role,language,text,quality,source_id,record_hash,metadata_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(
      rec.get('message_id'),rec.get('parent_id'),rec.get('conversation_id'),rec.get('role'),rec.get('language'),rec['text'],rec.get('quality'),rec['source_id'],rh,json.dumps(rec.get('metadata') or {},sort_keys=True),now()))
    return cur.rowcount>0

def stats(c,p,fts):
    counts={t:c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ['sources','definitions','lexical_relations','dialogue_messages','knowledge_records','ingest_runs','source_lifecycle']}
    return {'state':'SUCCESS','path':str(p),'sqliteVersion':sqlite3.sqlite_version,'fts5':bool(fts),'counts':counts,'bytes':p.stat().st_size if p.exists() else 0}

def define(c, term, limit=8):
    rows=c.execute('''SELECT d.term,d.pos,d.definition,d.example,d.synset,s.name source,s.license,s.source_url
                      FROM definitions d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id
                      WHERE lower(d.term)=lower(?) AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) ORDER BY d.id LIMIT ?''',(term,now(),limit)).fetchall()
    if not rows:
        # fallback lexical search
        try:
            rows=c.execute('''SELECT d.term,d.pos,d.definition,d.example,d.synset,s.name source,s.license,s.source_url
              FROM definitions_fts f JOIN definitions d ON d.id=f.rowid JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id
              WHERE definitions_fts MATCH ? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) LIMIT ?''',(term,now(),limit)).fetchall()
        except sqlite3.OperationalError:
            rows=c.execute('''SELECT d.term,d.pos,d.definition,d.example,d.synset,s.name source,s.license,s.source_url
              FROM definitions d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE d.term LIKE ? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) LIMIT ?''',(f'%{term}%',now(),limit)).fetchall()
    return {'state':'SUCCESS' if rows else 'UNAVAILABLE','term':term,'definitions':[dict(r) for r in rows], 'message':f'Found {len(rows)} definition record(s).' if rows else 'No local definition found. Import WordNet first.'}

def related(c, term, relation=None, limit=12):
    synsets=[r[0] for r in c.execute("""SELECT DISTINCT d.synset FROM definitions d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE lower(d.term)=lower(?) AND d.synset IS NOT NULL AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?)""",(term,now())).fetchall()]
    if not synsets:
        return {'state':'UNAVAILABLE','term':term,'relations':[],'message':'No local WordNet synset found for that term.'}
    qmarks=','.join('?' for _ in synsets)
    params=list(synsets)
    where=f"lr.source_synset IN ({qmarks})"
    if relation:
        where+=' AND lr.relation=?';params.append(relation)
    params.append(limit)
    sql=f"""SELECT DISTINCT lr.relation,sd.term source_term,td.term target_term,td.pos target_pos,td.definition target_definition,
                      lr.source_synset,lr.target_synset,s.name source,s.license
                      FROM lexical_relations lr
                      JOIN definitions sd ON sd.synset=lr.source_synset
                      JOIN definitions td ON td.synset=lr.target_synset
                      JOIN sources s ON s.id=lr.source_id
                      LEFT JOIN source_lifecycle l ON l.source_id=s.id
                      WHERE {where} AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) ORDER BY lr.relation,td.term LIMIT ?"""
    params.insert(-1,now())
    rows=c.execute(sql,params).fetchall()
    return {'state':'SUCCESS' if rows else 'UNAVAILABLE','term':term,'relation':relation,'relations':[dict(r) for r in rows],
            'message':f'Found {len(rows)} lexical relationship record(s).' if rows else 'No stored lexical relationships matched.'}

def style_profile(text):
    t=str(text or '').strip(); low=t.lower(); words=t.split(); ex=t.count('!'); qs=t.count('?')
    casual=sum(x in low for x in [' lol',' haha',' hey',' yeah',' yep',' cool',' awesome',' nice',' btw',' :)',':D'])
    technical=sum(x in low for x in [' algorithm',' model',' data',' code',' system',' function',' network',' database',' api',' python',' javascript'])
    humorous=sum(x in low for x in [' joke',' funny',' pun',' haha',' lol',' 😂',' 😄'])
    return {'short':len(words)<=28,'question':qs>0,'enthusiastic':ex>0,'casual':casual>0,'technical':technical>0,'humorous':humorous>0,'wordCount':len(words)}

def _style_score(profile, wanted):
    if not wanted:return 0.0
    tags={x.strip().lower() for x in str(wanted).split(',') if x.strip()}; score=0.0
    for tag in tags:
        if tag in profile and isinstance(profile[tag],bool): score += 1.0 if profile[tag] else -0.25
    return score

def search_dialogue(c,q,limit=8,style=None):
    rows=[]
    if q:
        try:
            rows=c.execute('''SELECT d.message_id,d.parent_id,d.conversation_id,d.role,d.language,d.text,d.quality,s.name source,s.license
              FROM dialogue_fts f JOIN dialogue_messages d ON d.id=f.rowid JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id
              WHERE dialogue_fts MATCH ? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) LIMIT ?''',(q,now(),limit)).fetchall()
        except sqlite3.OperationalError:
            rows=c.execute('''SELECT d.message_id,d.parent_id,d.conversation_id,d.role,d.language,d.text,d.quality,s.name source,s.license
              FROM dialogue_messages d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE d.text LIKE ? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) LIMIT ?''',(f'%{q}%',now(),limit)).fetchall()
    else:
        rows=c.execute('''SELECT d.message_id,d.parent_id,d.conversation_id,d.role,d.language,d.text,d.quality,s.name source,s.license
          FROM dialogue_messages d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) ORDER BY random() LIMIT ?''',(now(),limit)).fetchall()
    messages=[dict(r) for r in rows]
    for m in messages: m['style']=style_profile(m.get('text'))
    if style: messages=sorted(messages,key=lambda m:_style_score(m['style'],style),reverse=True)[:limit]
    return {'state':'SUCCESS' if messages else 'UNAVAILABLE','query':q,'style':style,'messages':messages,'message':f'Found {len(messages)} dialogue record(s).' if messages else 'No local dialogue records found. Import OASST1 first.'}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('command',choices=['init','status','source','definition','relation','dialogue','define','related','banter']);ap.add_argument('--db');ap.add_argument('--json');ap.add_argument('--term');ap.add_argument('--query',default='');ap.add_argument('--relation');ap.add_argument('--style');ap.add_argument('--limit',type=int,default=8)
    a=ap.parse_args(); c,p=connect(a.db); fts=init_schema(c)
    try:
        if a.command in ('init','status'): out=stats(c,p,fts)
        elif a.command=='source': out={'state':'SUCCESS','sourceId':upsert_source(c,json.loads(a.json or '{}'))}
        elif a.command=='definition': out={'state':'SUCCESS','inserted':add_definition(c,json.loads(a.json or '{}'))};c.commit()
        elif a.command=='relation': out={'state':'SUCCESS','inserted':add_lexical_relation(c,json.loads(a.json or '{}'))};c.commit()
        elif a.command=='dialogue': out={'state':'SUCCESS','inserted':add_dialogue(c,json.loads(a.json or '{}'))};c.commit()
        elif a.command=='define': out=define(c,a.term or a.query,a.limit)
        elif a.command=='related': out=related(c,a.term or a.query,a.relation,a.limit)
        else: out=search_dialogue(c,a.query,a.limit,a.style)
        print(json.dumps(out,ensure_ascii=False))
    finally: c.close()
if __name__=='__main__': main()
