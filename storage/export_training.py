#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from storage.db import connect,init_schema

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--db');ap.add_argument('--output',default=str(ROOT/'model'/'data'/'language-database.jsonl'));ap.add_argument('--definitions',type=int,default=5000);ap.add_argument('--dialogues',type=int,default=5000);a=ap.parse_args()
 c,p=connect(a.db);init_schema(c);out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);n_def=n_dlg=0
 with out.open('w',encoding='utf-8') as f:
  rows=c.execute('''SELECT d.id,d.term,d.pos,d.definition,d.example,s.id source_id,s.name source,s.license FROM definitions d JOIN sources s ON s.id=d.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE s.training_eligible=1 AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>datetime('now')) ORDER BY d.id LIMIT ?''',(a.definitions,)).fetchall()
  for r in rows:
   response=r['definition']+(f" Example: {r['example']}" if r['example'] else '')
   f.write(json.dumps({'instruction':f"Define {r['term']}.",'response':response,'source':r['source'],'source_id':f"definition:{r['id']}",'license':r['license'],'kind':'lexical-definition','truth_state':'SUCCESS'},ensure_ascii=False)+'\n');n_def+=1
  rows=c.execute('''SELECT p.text prompt,c.text response,c.id,s.name source,s.license FROM dialogue_messages c JOIN dialogue_messages p ON p.message_id=c.parent_id JOIN sources s ON s.id=c.source_id LEFT JOIN source_lifecycle l ON l.source_id=s.id WHERE s.training_eligible=1 AND l.deleted_at IS NULL AND (l.retention_until IS NULL OR l.retention_until>datetime('now')) AND c.role='assistant' AND p.text<>'' AND c.text<>'' ORDER BY c.id LIMIT ?''',(a.dialogues,)).fetchall()
  for r in rows:
   f.write(json.dumps({'instruction':r['prompt'],'response':r['response'],'source':r['source'],'source_id':f"dialogue:{r['id']}",'license':r['license'],'kind':'dialogue','truth_state':'SUCCESS'},ensure_ascii=False)+'\n');n_dlg+=1
 print(json.dumps({'state':'SUCCESS','database':str(p),'output':str(out),'definitions':n_def,'dialogues':n_dlg,'total':n_def+n_dlg}))
 c.close()
if __name__=='__main__':main()
