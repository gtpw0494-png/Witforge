#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'release-manifest.json'
include=[]
for base in ['src','model','public','research','requirements','scripts','docs','storage','schemas','governance','verification','.github']:
 for p in (ROOT/base).rglob('*'):
  rel=p.relative_to(ROOT)
  mutable=(rel.parts[:2] in [('model','data'),('model','runs'),('model','checkpoints'),('model','tokenizers')] or rel==Path('research/local_source_snapshot.json'))
  if p.is_file() and not mutable and '__pycache__' not in p.parts and 'vendor-reference' not in p.parts and p.name not in {'.DS_Store'}:
   include.append(p)
for name in ['package.json','server.js','README.md','PROJECT_STATUS.md','RELEASES.md','TERMUX-RUN.md','run-termux.sh','CONTRIBUTING.md','.gitignore','test.js','security-test.js']:
 p=ROOT/name
 if p.exists():include.append(p)
rows=[]
for p in sorted(set(include)):
 rows.append({'path':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
version=json.loads((ROOT/'package.json').read_text()).get('version','UNKNOWN')
manifest={'format':'iu-release-manifest-v1','version':version,'files':rows,'policy':'Manifest covers shipped source/model-support files. Runtime state, fetched vendor references and mutable knowledge are excluded.'}
OUT.write_text(json.dumps(manifest,indent=2));print(json.dumps({'state':'SUCCESS','files':len(rows),'output':str(OUT)}))
