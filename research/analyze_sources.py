#!/usr/bin/env python3
"""Create a reproducible manifest for locally fetched reference repositories."""
from __future__ import annotations
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent;REG=ROOT/'research'/'source_registry.json';VENDOR=ROOT/'vendor-reference';OUT=ROOT/'research'/'local_source_snapshot.json'
DIRS={'OpenAI gpt-oss':'openai-gpt-oss','xAI Grok-1':'xai-grok-1','DeepSeek-V3 code':'deepseek-v3','Google DeepMind Gemma':'google-deepmind-gemma','Hugging Face Transformers':'huggingface-transformers','Sarus Arena':'sarus-arena'}
def cmd(args,cwd):
 try:return subprocess.check_output(args,cwd=cwd,text=True,stderr=subprocess.DEVNULL).strip()
 except Exception:return None
def file_hash(path):return hashlib.sha256(path.read_bytes()).hexdigest()
reg=json.loads(REG.read_text());rows=[]
for src in reg['sources']:
 d=VENDOR/DIRS.get(src['name'],'') if src['name'] in DIRS else None
 present=bool(d and d.exists())
 row={'name':src['name'],'declaredLicense':src['license'],'registryStatus':src['status'],'present':present}
 if present:
  row['path']=str(d);row['commit']=cmd(['git','rev-parse','HEAD'],d);row['origin']=cmd(['git','remote','get-url','origin'],d)
  licenses=[p for n in ('LICENSE','LICENSE.md','LICENSE.txt','COPYING') if (p:=d/n).exists()]
  row['licenseFiles']=[{'path':p.name,'sha256':file_hash(p)} for p in licenses]
 rows.append(row)
out={'format':'iu-local-source-snapshot-v1','sources':rows,'truth':'Presence and git commit are measured locally. License compatibility is not inferred from filenames.'}
OUT.write_text(json.dumps(out,indent=2));print(json.dumps({'state':'SUCCESS','output':str(OUT),'present':sum(x['present'] for x in rows),'registered':len(rows)}))
