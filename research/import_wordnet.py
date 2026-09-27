#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from storage.db import connect,init_schema,upsert_source,add_definition,add_lexical_relation,now
SOURCE={
 'id':'princeton-wordnet-3.0','name':'Princeton WordNet 3.0','source_type':'lexical-database','license':'WordNet-3.0',
 'license_url':'https://wordnet.princeton.edu/license-and-commercial-use','source_url':'https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz','training_eligible':True,
 'metadata':{'copyright':'WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.','notice':'Preserve WordNet license/copyright notices in redistributed database/documentation copies.'}
}
POS={'noun':'noun','verb':'verb','adj':'adjective','adv':'adverb'}
TARGET_POS={'n':'noun','v':'verb','a':'adj','s':'adj','r':'adv'}
REL={'!':'antonym','@':'hypernym','@i':'instance-hypernym','~':'hyponym','~i':'instance-hyponym','&':'similar-to','^':'also-see','+':'derivationally-related','=':'attribute','*':'entailment','>':'cause','$':'verb-group','\\':'pertainym-or-derived'}

def locate(p):
 p=Path(p)
 for c in ([p/'dict',p/'WordNet-3.0'/'dict',p] if p.is_dir() else []):
  if (c/'data.noun').exists():return c
 raise FileNotFoundError('WordNet dict directory not found')

def parse_data_file(path,pos_name):
 for line in path.open('r',encoding='utf-8',errors='replace'):
  if not line or line[0].isspace() or '|' not in line:continue
  left,gloss=line.rstrip('\n').split('|',1);t=left.strip().split()
  if len(t)<5:continue
  try:wcnt=int(t[3],16)
  except ValueError:continue
  words=[];i=4
  for _ in range(wcnt):
   if i+1>=len(t):break
   words.append(t[i].replace('_',' '));i+=2
  if i>=len(t):continue
  try:pcnt=int(t[i]);i+=1
  except ValueError:pcnt=0
  pointers=[]
  for _ in range(pcnt):
   if i+3>=len(t):break
   sym,off,pchar,src_tgt=t[i:i+4];i+=4
   target_pos=TARGET_POS.get(pchar,pchar)
   pointers.append({'relation':REL.get(sym,sym),'target_synset':f'{target_pos}:{off}','pointer_symbol':sym,'source_target':src_tgt})
  parts=re.split(r';\s*"',gloss.strip(),maxsplit=1);definition=parts[0].strip();example=parts[1].rstrip('"').strip() if len(parts)>1 else None
  synset=f'{pos_name}:{t[0]}'
  yield synset,words,definition,example,pointers

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--input',default=str(ROOT/'vendor-data'/'wordnet'/'WordNet-3.0'));ap.add_argument('--limit',type=int,default=0);ap.add_argument('--db');a=ap.parse_args();d=locate(a.input);c,p=connect(a.db);init_schema(c);upsert_source(c,SOURCE)
 cur=c.execute("INSERT INTO ingest_runs(source_id,kind,input_path,state,started_at) VALUES(?,?,?,?,?)",(SOURCE['id'],'definitions+relations',str(d),'RUNNING',now()));rid=cur.lastrowid;accepted=skipped=relations=0
 try:
  for short in POS:
   f=d/f'data.{short}'
   if not f.exists():continue
   for synset,words,definition,example,pointers in parse_data_file(f,short):
    if a.limit and accepted>=a.limit:break
    for term in words:
     if add_definition(c,{'term':term,'pos':POS[short],'definition':definition,'example':example,'synset':synset,'source_id':SOURCE['id']}):accepted+=1
     else:skipped+=1
    for ptr in pointers:
     if add_lexical_relation(c,{'source_synset':synset,'target_synset':ptr['target_synset'],'relation':ptr['relation'],'source_id':SOURCE['id']}):relations+=1
    if (accepted+relations)%2000==0:c.commit()
   c.commit()
   if a.limit and accepted>=a.limit:break
  c.execute("UPDATE ingest_runs SET accepted=?,skipped=?,state='SUCCESS',details_json=?,completed_at=? WHERE id=?",(accepted,skipped,json.dumps({'relations':relations}),now(),rid));c.commit()
  print(json.dumps({'state':'SUCCESS','database':str(p),'accepted':accepted,'relations':relations,'skipped':skipped,'source':SOURCE['id']}))
 except Exception as e:
  c.execute("UPDATE ingest_runs SET accepted=?,skipped=?,state='ERROR',details_json=?,completed_at=? WHERE id=?",(accepted,skipped,json.dumps({'error':str(e),'relations':relations}),now(),rid));c.commit();raise
 finally:c.close()
if __name__=='__main__':main()
