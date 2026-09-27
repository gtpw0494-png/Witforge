#!/usr/bin/env python3
from __future__ import annotations
import argparse,gzip,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from storage.db import connect,init_schema,upsert_source,add_dialogue,now
SOURCE={
 'id':'openassistant-oasst1','name':'OpenAssistant OASST1','source_type':'conversation-dataset','license':'Apache-2.0','license_url':'https://huggingface.co/datasets/OpenAssistant/oasst1/blob/main/LICENSE','source_url':'https://huggingface.co/datasets/OpenAssistant/oasst1','training_eligible':True,
 'metadata':{'purpose':'multilingual human-generated assistant conversations; usable as dialogue/banter material with provenance preserved'}
}
def op(path): return gzip.open(path,'rt',encoding='utf-8') if str(path).endswith('.gz') else open(path,'r',encoding='utf-8')
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--input',default=str(ROOT/'vendor-data'/'oasst1'/'2023-04-12_oasst_ready.messages.jsonl.gz'));ap.add_argument('--language',default='en');ap.add_argument('--limit',type=int,default=0);ap.add_argument('--db');a=ap.parse_args();path=Path(a.input)
 if not path.exists():raise FileNotFoundError(path)
 c,p=connect(a.db);init_schema(c);upsert_source(c,SOURCE);cur=c.execute("INSERT INTO ingest_runs(source_id,kind,input_path,state,started_at) VALUES(?,?,?,?,?)",(SOURCE['id'],'dialogue',str(path),'RUNNING',now()));run_id=cur.lastrowid
 accepted=skipped=0
 try:
  with op(path) as f:
   for line in f:
    if a.limit and accepted>=a.limit:break
    try:r=json.loads(line)
    except Exception:skipped+=1;continue
    text=str(r.get('text') or '').strip();lang=str(r.get('lang') or '')
    if not text or (a.language and lang!=a.language) or r.get('deleted') is True:skipped+=1;continue
    labels=r.get('labels') or {};quality=None
    if isinstance(labels,dict):
      vals=[]
      for v in labels.values():
       if isinstance(v,dict) and isinstance(v.get('value'),(int,float)):vals.append(float(v['value']))
       elif isinstance(v,(int,float)):vals.append(float(v))
      if vals:quality=sum(vals)/len(vals)
    rec={'message_id':r.get('message_id'),'parent_id':r.get('parent_id'),'conversation_id':r.get('message_tree_id') or r.get('tree_id'),'role':r.get('role'),'language':lang,'text':text,'quality':quality,'source_id':SOURCE['id'],'metadata':{'rank':r.get('rank'),'review_result':r.get('review_result'),'synthetic':r.get('synthetic',False)}}
    if add_dialogue(c,rec):accepted+=1
    else:skipped+=1
    if accepted%1000==0:c.commit()
  c.commit();c.execute("UPDATE ingest_runs SET accepted=?,skipped=?,state='SUCCESS',completed_at=? WHERE id=?",(accepted,skipped,now(),run_id));c.commit();print(json.dumps({'state':'SUCCESS','database':str(p),'accepted':accepted,'skipped':skipped,'source':SOURCE['id'],'language':a.language},ensure_ascii=False))
 except Exception as e:
  c.execute("UPDATE ingest_runs SET accepted=?,skipped=?,state='ERROR',details_json=?,completed_at=? WHERE id=?",(accepted,skipped,json.dumps({'error':str(e)}),now(),run_id));c.commit();raise
 finally:c.close()
if __name__=='__main__':main()
