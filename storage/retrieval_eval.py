#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from storage.db import connect,init_schema
from storage.semantic import schema,build,search

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--cases',type=Path,required=True);ap.add_argument('--k',type=int,default=8);ap.add_argument('--db');a=ap.parse_args();cases=[json.loads(x) for x in a.cases.read_text().splitlines() if x.strip()];c,p=connect(a.db);init_schema(c);schema(c)
 if c.execute('SELECT COUNT(*) FROM semantic_vectors').fetchone()[0]==0:build(c)
 hits=0;rr=0.0;details=[]
 for case in cases:
  m=search(c,case['query'],case.get('kind','all'),a.k);expected=[x.lower() for x in case.get('expected',[])];rank=None
  for i,row in enumerate(m,1):
   hay=(str(row.get('title',''))+' '+str(row.get('text',''))).lower()
   if expected and any(x in hay for x in expected):rank=i;break
  if rank:hits+=1;rr+=1.0/rank
  details.append({'query':case['query'],'rank':rank,'returned':len(m)})
 n=len(cases) or 1;print(json.dumps({'state':'SUCCESS','cases':len(cases),'k':a.k,'recallAtK':hits/n,'mrr':rr/n,'details':details,'algorithm':'hybrid-fts5+sparse-hash'}));c.close()
if __name__=='__main__':main()
