#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,json,math,re,sys
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from storage.db import connect,init_schema,now
DIM=512
TOKEN=re.compile(r"[\w'-]+",re.UNICODE)

def features(text):
 words=[w.lower() for w in TOKEN.findall(str(text or '')) if len(w)>1]
 grams=words+[f'{a}_{b}' for a,b in zip(words,words[1:])]
 c=Counter(grams);v={}
 for term,n in c.items():
  h=int.from_bytes(hashlib.blake2b(term.encode(),digest_size=8).digest(),'big');idx=h%DIM;sign=1.0 if (h>>9)&1 else -1.0
  v[idx]=v.get(idx,0.0)+sign*(1.0+math.log(n))
 norm=math.sqrt(sum(x*x for x in v.values())) or 1.0
 return {str(k):x/norm for k,x in v.items()}

def cosine(a,b):
 if len(a)>len(b):a,b=b,a
 return sum(float(v)*float(b.get(k,0.0)) for k,v in a.items())

def schema(c):
 c.execute('CREATE TABLE IF NOT EXISTS semantic_vectors(kind TEXT NOT NULL,record_id INTEGER NOT NULL,vector_json TEXT NOT NULL,vector_hash TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,record_id))')
 c.execute('CREATE INDEX IF NOT EXISTS semantic_kind_idx ON semantic_vectors(kind)');c.commit()

def build(c):
 schema(c);counts={'definition':0,'dialogue':0}
 c.execute('DELETE FROM semantic_vectors')
 current=now()
 queries=[
  ('definition','''SELECT d.id,d.term||" "||d.definition||" "||coalesce(d.example,"") text FROM definitions d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?)'''),
  ('dialogue','''SELECT d.id,d.text FROM dialogue_messages d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?)''')
 ]
 for kind,sql in queries:
  for row in c.execute(sql,(current,)):
   v=features(row['text']);raw=json.dumps(v,separators=(',',':'),sort_keys=True);vh=hashlib.sha256(raw.encode()).hexdigest()
   c.execute('INSERT OR REPLACE INTO semantic_vectors(kind,record_id,vector_json,vector_hash,updated_at) VALUES(?,?,?,?,?)',(kind,row['id'],raw,vh,now()));counts[kind]+=1
   if counts[kind]%1000==0:c.commit()
 c.commit();return counts

def candidates(c,kind,limit=2500):
 kinds=['definition','dialogue'] if kind=='all' else [kind];out=[];current=now()
 for k in kinds:
  if k=='definition':
   sql='''SELECT v.kind,v.record_id,v.vector_json FROM semantic_vectors v JOIN definitions d ON d.id=v.record_id JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE v.kind=? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) ORDER BY v.record_id DESC LIMIT ?'''
  else:
   sql='''SELECT v.kind,v.record_id,v.vector_json FROM semantic_vectors v JOIN dialogue_messages d ON d.id=v.record_id JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE v.kind=? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) ORDER BY v.record_id DESC LIMIT ?'''
  out.extend(c.execute(sql,(k,current,limit)).fetchall())
 return out

def _lexical(c,q,kind,limit=100):
 terms=[w.lower() for w in TOKEN.findall(str(q or '')) if len(w)>1][:12]
 if not terms:return {}
 match=' OR '.join('"'+t.replace('"','')+'"' for t in terms)
 out={}
 try:
  if kind in ('all','definition'):
   for rank,row in enumerate(c.execute('''SELECT f.rowid FROM definitions_fts f JOIN definitions d ON d.id=f.rowid JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE definitions_fts MATCH ? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) ORDER BY bm25(definitions_fts) LIMIT ?''',(match,now(),limit)).fetchall(),1):out[('definition',row['rowid'])]=1.0/rank
  if kind in ('all','dialogue'):
   for rank,row in enumerate(c.execute('''SELECT f.rowid FROM dialogue_fts f JOIN dialogue_messages d ON d.id=f.rowid JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE dialogue_fts MATCH ? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?) ORDER BY bm25(dialogue_fts) LIMIT ?''',(match,now(),limit)).fetchall(),1):out[('dialogue',row['rowid'])]=1.0/rank
 except Exception:pass
 return out

def search(c,q,kind,limit):
 qv=features(q);sparse={}
 for r in candidates(c,kind):
  score=cosine(qv,json.loads(r['vector_json']))
  if score>0:sparse[(r['kind'],r['record_id'])]=score
 lexical=_lexical(c,q,kind,max(100,limit*20));keys=set(sparse)|set(lexical);scored=[]
 for key in keys:
  ss=sparse.get(key,0.0);ls=lexical.get(key,0.0);combined=.72*ss+.28*ls;scored.append((combined,ss,ls,key[0],key[1]))
 scored.sort(reverse=True);matches=[]
 for score,ss,ls,k,rid in scored[:limit]:
  if k=='definition':row=c.execute('''SELECT d.id,d.term title,d.definition text,d.pos,d.synset,s.id source_id,s.name source,s.license FROM definitions d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE d.id=? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?)''',(rid,now())).fetchone()
  else:row=c.execute('''SELECT d.id,substr(d.text,1,120) title,d.text,d.role,d.conversation_id,s.id source_id,s.name source,s.license FROM dialogue_messages d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE d.id=? AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>?)''',(rid,now())).fetchone()
  if row:matches.append({'score':score,'sparseScore':ss,'lexicalScore':ls,'kind':k,'recordId':rid,**dict(row)})
 return matches

def main():
 ap=argparse.ArgumentParser();sp=ap.add_subparsers(dest='cmd',required=True);sp.add_parser('build');s=sp.add_parser('search');s.add_argument('--query',required=True);s.add_argument('--kind',choices=['all','definition','dialogue'],default='all');s.add_argument('--limit',type=int,default=8);a=ap.parse_args();c,p=connect();init_schema(c);schema(c)
 try:
  if a.cmd=='build':counts=build(c);out={'state':'SUCCESS','database':str(p),'dimensions':DIM,'algorithm':'signed-hashed-token-bigram-cosine','neural':False,'counts':counts}
  else:
   if c.execute('SELECT COUNT(*) FROM semantic_vectors').fetchone()[0]==0:build(c)
   m=search(c,a.query,a.kind,a.limit);out={'state':'SUCCESS' if m else 'UNAVAILABLE','query':a.query,'algorithm':'hybrid-fts5-plus-signed-hashed-token-bigram-cosine','neural':False,'matches':m,'message':f'Found {len(m)} ranked local semantic-vector match(es).' if m else 'No semantic-vector matches found.'}
  print(json.dumps(out,ensure_ascii=False))
 finally:c.close()
if __name__=='__main__':main()
