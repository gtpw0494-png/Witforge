#!/usr/bin/env python3
from __future__ import annotations
import json, os, sqlite3, sys, time
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DB=Path(os.getenv('IUV_GOV_DB') or ROOT/'state'/'governance.sqlite3')

def now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()

def connect():
    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB,timeout=10,isolation_level=None)
    c.row_factory=sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA synchronous=FULL')
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA busy_timeout=5000')
    c.executescript('''
    CREATE TABLE IF NOT EXISTS records(
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      body_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(kind,id)
    );
    CREATE INDEX IF NOT EXISTS records_kind_updated_idx ON records(kind,updated_at DESC);
    CREATE TABLE IF NOT EXISTS events(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      body_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_record_idx ON events(kind,id,seq);
    ''')
    return c

def emit(x): print(json.dumps(x,separators=(',',':'),ensure_ascii=False))

def main():
    req=json.load(sys.stdin)
    action=req.get('action')
    c=connect()
    try:
      if action=='status':
        counts={r['kind']:r['n'] for r in c.execute('SELECT kind,COUNT(*) n FROM records GROUP BY kind')}
        emit({'state':'SUCCESS','path':str(DB),'journalMode':c.execute('PRAGMA journal_mode').fetchone()[0],'counts':counts});return
      kind=str(req.get('kind') or '')
      rid=str(req.get('id') or '')
      if action=='get':
        r=c.execute('SELECT body_json,version FROM records WHERE kind=? AND id=?',(kind,rid)).fetchone()
        emit({'state':'SUCCESS','record':json.loads(r['body_json']),'version':r['version']} if r else {'state':'FAILURE','message':'Record not found.'});return
      if action=='list':
        limit=max(1,min(10000,int(req.get('limit') or 100)))
        rows=c.execute('SELECT body_json,version FROM records WHERE kind=? ORDER BY updated_at DESC LIMIT ?',(kind,limit)).fetchall()
        emit({'state':'SUCCESS','records':[dict(json.loads(r['body_json']),_version=r['version']) for r in rows]});return
      if action=='create':
        body=req.get('body') or {}; rid=str(body.get('id') or rid); ts=now()
        if not rid: emit({'state':'BLOCKED','message':'id required'});return
        c.execute('BEGIN IMMEDIATE')
        try:
          c.execute('INSERT INTO records(kind,id,version,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',(kind,rid,1,json.dumps(body,separators=(',',':'),sort_keys=True),ts,ts))
          c.execute('INSERT INTO events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)',(kind,rid,'create',json.dumps(body,separators=(',',':'),sort_keys=True),ts))
          c.execute('COMMIT')
          emit({'state':'SUCCESS','record':body,'version':1});return
        except sqlite3.IntegrityError:
          c.execute('ROLLBACK');emit({'state':'BLOCKED','message':'Record already exists.'});return
      if action=='cas':
        expected=int(req.get('expectedVersion') or 0);body=req.get('body') or {};event=req.get('event') or {'type':'update'};ts=now()
        c.execute('BEGIN IMMEDIATE')
        r=c.execute('SELECT version FROM records WHERE kind=? AND id=?',(kind,rid)).fetchone()
        if not r: c.execute('ROLLBACK');emit({'state':'FAILURE','message':'Record not found.'});return
        if r['version']!=expected:
          c.execute('ROLLBACK');emit({'state':'CONFLICT','message':'Version conflict.','expected':expected,'actual':r['version']});return
        newv=expected+1
        cur=c.execute('UPDATE records SET version=?,body_json=?,updated_at=? WHERE kind=? AND id=? AND version=?',(newv,json.dumps(body,separators=(',',':'),sort_keys=True),ts,kind,rid,expected))
        if cur.rowcount!=1: c.execute('ROLLBACK');emit({'state':'CONFLICT','message':'Concurrent update conflict.'});return
        c.execute('INSERT INTO events(kind,id,event_type,body_json,created_at) VALUES(?,?,?,?,?)',(kind,rid,str(event.get('type') or 'update'),json.dumps(event,separators=(',',':'),sort_keys=True),ts))
        c.execute('COMMIT');emit({'state':'SUCCESS','record':body,'version':newv});return
      if action=='events':
        rows=c.execute('SELECT seq,event_type,body_json,created_at FROM events WHERE kind=? AND id=? ORDER BY seq',(kind,rid)).fetchall()
        emit({'state':'SUCCESS','events':[{'seq':r['seq'],'type':r['event_type'],'body':json.loads(r['body_json']),'createdAt':r['created_at']} for r in rows]});return
      emit({'state':'BLOCKED','message':'Unknown governance DB action.'})
    finally:c.close()
if __name__=='__main__': main()
