#!/usr/bin/env python3
"""Build the tokenizer/training text from the already-governed dataset-v2."""
import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data';dataset=DATA/'dataset-v2';seed=DATA/'seed.txt';out=DATA/'training-corpus.txt'
parts=[seed.read_text(encoding='utf-8',errors='replace') if seed.exists() else '']
count=0
for name in ('train.jsonl','validation.jsonl'):
 p=dataset/name
 if not p.exists():continue
 for line in p.open(encoding='utf-8',errors='replace'):
  if not line.strip():continue
  try:x=json.loads(line)
  except:continue
  t=str(x.get('text') or '').strip()
  if t:parts.append(t);count+=1
body='\n'.join(parts);out.write_text(body,encoding='utf-8')
print(json.dumps({'state':'SUCCESS','output':str(out),'characters':len(body),'datasetRecords':count,'sha256':hashlib.sha256(body.encode()).hexdigest()}))
