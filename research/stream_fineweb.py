#!/usr/bin/env python3
"""Optional FineWeb streamer. Requires `datasets` and internet access."""
import argparse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'model'/'data'/'fineweb-sample.jsonl'
def main():
 p=argparse.ArgumentParser();p.add_argument('--split',default='train');p.add_argument('--config',default='sample-10BT');p.add_argument('--limit',type=int,default=1000);p.add_argument('--output',type=Path,default=OUT);a=p.parse_args()
 try:from datasets import load_dataset
 except Exception as e:print(json.dumps({'state':'UNAVAILABLE','message':f'datasets dependency unavailable: {e}'}));return
 ds=load_dataset('HuggingFaceFW/fineweb',name=a.config,split=a.split,streaming=True);a.output.parent.mkdir(parents=True,exist_ok=True);n=0
 with a.output.open('w',encoding='utf-8') as f:
  for r in ds:
   f.write(json.dumps({k:r.get(k) for k in ('id','url','date','text','language','language_score')},ensure_ascii=False)+'\n');n+=1
   if n>=a.limit:break
 print(json.dumps({'state':'SUCCESS','records':n,'output':str(a.output),'next':f'python3 research/import_web_corpus.py --source fineweb --input {a.output} --format jsonl'}))
if __name__=='__main__':main()
