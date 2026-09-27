#!/usr/bin/env python3
from __future__ import annotations
import argparse, importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
REG=ROOT/'research'/'learning_methods.json'
def have(x): return importlib.util.find_spec(x) is not None
def status():
 deps={x:have(x) for x in ['torch','transformers','peft','trl','datasets','accelerate']}
 methods=json.loads(REG.read_text())['methods']
 resolved=[]
 for m in methods:
  req=[x for x in m.get('requires',[]) if x not in ('sqlite','compatible quantization backend')]
  available=all(deps.get(x,False) for x in req) if req else True
  resolved.append({**m,'dependenciesAvailable':available})
 return {'state':'SUCCESS','dependencies':deps,'methods':resolved,'truth':'A method being described in the registry does not mean the required runtime is installed or that training has been executed.'}
def plan(method,model,dataset):
 st=status();m=next((x for x in st['methods'] if x['id']==method),None)
 if not m:return {'state':'BLOCKED','message':'Unknown adaptation method.'}
 if m['status'] in ('PLANNED_UNAVAILABLE','RESEARCH_ONLY'):return {'state':'UNAVAILABLE','message':f"{m['name']} is not an executable training path in this build.",'method':m}
 if not m['dependenciesAvailable']:return {'state':'UNAVAILABLE','message':'Required adaptation dependencies are not installed.','method':m,'dependencies':st['dependencies']}
 return {'state':'CONFIGURED','message':'Adaptation prerequisites are importable. This command creates a governed plan only; it does not start training without an explicit model, dataset and training command.','method':m,'model':model,'dataset':dataset,'checks':['model license/provenance','dataset training eligibility','holdout regression set','hardware budget','checkpoint destination','rollback metadata']}
def main():
 ap=argparse.ArgumentParser();sp=ap.add_subparsers(dest='cmd',required=True);sp.add_parser('status');p=sp.add_parser('plan');p.add_argument('--method',required=True);p.add_argument('--model',required=True);p.add_argument('--dataset',required=True);a=ap.parse_args();print(json.dumps(status() if a.cmd=='status' else plan(a.method,a.model,a.dataset),ensure_ascii=False))
if __name__=='__main__':main()
