#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,json,random
from pathlib import Path
ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data'
def main():
 ap=argparse.ArgumentParser();sp=ap.add_subparsers(dest='cmd',required=True)
 s=sp.add_parser('snapshot');s.add_argument('--dataset',type=Path,default=DATA/'dataset-v2'/'train.jsonl');s.add_argument('--output',type=Path,default=DATA/'replay-buffer.jsonl');s.add_argument('--limit',type=int,default=1000);s.add_argument('--seed',type=int,default=17)
 c=sp.add_parser('compare');c.add_argument('--baseline',type=Path,required=True);c.add_argument('--candidate',type=Path,required=True);c.add_argument('--max-regression',type=float,default=.05)
 a=ap.parse_args()
 if a.cmd=='snapshot':
  rows=[x for x in a.dataset.read_text(encoding='utf8').splitlines() if x.strip()] if a.dataset.exists() else []
  rnd=random.Random(a.seed);rnd.shuffle(rows);rows=rows[:max(0,a.limit)];a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(('\n'.join(rows)+'\n') if rows else '',encoding='utf8');print(json.dumps({'state':'SUCCESS','records':len(rows),'output':str(a.output),'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'policy':'Replay snapshots are deterministic samples from already-approved training data; they do not import raw chat history.'}));return
 b=json.loads(a.baseline.read_text());n=json.loads(a.candidate.read_text());keys=sorted(set(b)&set(n));reg={k:float(b[k])-float(n[k]) for k in keys if isinstance(b[k],(int,float)) and isinstance(n[k],(int,float))};bad={k:v for k,v in reg.items() if v>a.max_regression};print(json.dumps({'state':'FAILURE' if bad else 'SUCCESS','regressions':reg,'violations':bad,'maxRegression':a.max_regression}))
if __name__=='__main__':main()
