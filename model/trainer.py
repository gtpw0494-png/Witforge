#!/usr/bin/env python3
"""ForgeLM trainer v2: deterministic local training with validation and resume."""
from __future__ import annotations
import argparse, hashlib, json, math, time
from dataclasses import asdict
from pathlib import Path
import torch
from forgelm import ForgeConfig, ForgeLM
from tokenizer import load_tokenizer, tokenizer_info

ROOT=Path(__file__).resolve().parent
PRESETS=ROOT/'config_presets.json'
DATASET=ROOT/'data'/'dataset-v2'
RUNS=ROOT/'runs'

def load_presets():return json.loads(PRESETS.read_text())['presets']
def config_for(name):
 p=load_presets()
 if name not in p:raise ValueError(f"unknown preset {name}; choose one of {', '.join(p)}")
 return ForgeConfig(**p[name])

def rows(path):
 if not path.exists():return []
 out=[]
 for line in path.read_text(encoding='utf-8').splitlines():
  if line.strip():
   x=json.loads(line);out.append(str(x.get('text') or ''))
 return [x for x in out if x]

def token_chunks(texts,tok,max_seq):
 stream=[]
 for text in texts:stream.extend(tok.encode(text));stream.append(getattr(tok,"end_id",tok.encode("<|end|>")[0]))
 chunks=[]
 stride=max_seq
 for i in range(0,max(1,len(stream)-1),stride):
  c=stream[i:i+max_seq+1]
  if len(c)>1:chunks.append(c)
 return chunks

def lr_at(step,total,base,warmup):
 if step < warmup:return base*float(step+1)/max(1,warmup)
 progress=(step-warmup)/max(1,total-warmup);return base*0.5*(1+math.cos(math.pi*min(1.0,progress)))

def evaluate(model,chunks,device):
 if not chunks:return None
 model.eval();vals=[]
 with torch.no_grad():
  for c in chunks[:32]:
   x=torch.tensor([c[:-1]],dtype=torch.long,device=device);y=torch.tensor([c[1:]],dtype=torch.long,device=device);_,loss=model(x,y);vals.append(float(loss))
 model.train();return sum(vals)/len(vals)

def run_training(*,preset='termux-tiny',steps=80,dataset=DATASET,lr=3e-3,grad_accum=1,warmup=5,resume=None,device=None,run_name=None,tokenizer_spec=None):
 torch.manual_seed(7);device=device or ('cuda' if torch.cuda.is_available() else 'cpu');cfg=config_for(preset);tok=load_tokenizer(tokenizer_spec);cfg.vocab_size=tok.vocab_size;dataset=Path(dataset)
 train_rows=rows(dataset/'train.jsonl');val_rows=rows(dataset/'validation.jsonl')
 if not train_rows:
  seed=ROOT/'data'/'seed.txt';train_rows=[seed.read_text() if seed.exists() else 'IntraultUniversalion local training.<|end|>']
 train=token_chunks(train_rows,tok,cfg.max_seq_len);val=token_chunks(val_rows,tok,cfg.max_seq_len)
 model=ForgeLM(cfg).to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=lr);start_step=0
 if resume:
  state=torch.load(resume,map_location=device,weights_only=False)
  if state.get('format')!='ForgeLM-Trainer-2':raise ValueError('unsupported trainer checkpoint')
  old=ForgeConfig(**state['config'])
  if asdict(old)!=asdict(cfg):raise ValueError('resume preset/config does not match checkpoint')
  model.load_state_dict(state['model']);optimizer.load_state_dict(state['optimizer']);start_step=int(state.get('step',0))
 run_name=run_name or f"{preset}-{int(time.time())}";run_dir=RUNS/run_name;run_dir.mkdir(parents=True,exist_ok=True);latest=run_dir/'trainer-latest.pt';model_out=run_dir/'forgelm.pt'
 losses=[];optimizer.zero_grad(set_to_none=True);model.train();total=max(start_step+int(steps),1)
 for local in range(int(steps)):
  step=start_step+local;rate=lr_at(step,total,lr,warmup)
  for g in optimizer.param_groups:g['lr']=rate
  c=train[step%len(train)];x=torch.tensor([c[:-1]],dtype=torch.long,device=device);y=torch.tensor([c[1:]],dtype=torch.long,device=device);_,loss=model(x,y);(loss/max(1,grad_accum)).backward();losses.append(float(loss.detach()))
  if (local+1)%max(1,grad_accum)==0 or local==steps-1:
   torch.nn.utils.clip_grad_norm_(model.parameters(),1.0);optimizer.step();optimizer.zero_grad(set_to_none=True)
 final_step=start_step+int(steps);val_loss=evaluate(model,val,device)
 state={'format':'ForgeLM-Trainer-2','config':asdict(cfg),'model':model.state_dict(),'optimizer':optimizer.state_dict(),'step':final_step,'preset':preset}
 torch.save(state,latest)
 manifest={
  'format':'forgelm-training-run-v2','run':run_name,'preset':preset,'stepsThisRun':int(steps),'globalStep':final_step,'device':device,
  'parameters':sum(p.numel() for p in model.parameters()),'startLoss':losses[0] if losses else None,'endLoss':losses[-1] if losses else None,'validationLoss':val_loss,
  'dataset':str(dataset),'datasetManifestSha256':hashlib.sha256((dataset/'manifest.json').read_bytes()).hexdigest() if (dataset/'manifest.json').exists() else None,
  'trainerCheckpoint':str(latest),'modelCheckpoint':str(model_out),'config':asdict(cfg),'tokenizer':tokenizer_info(tok),'lossBreakdown':dict(getattr(model,'last_loss_components',{}))
 }
 model.save(model_out,metadata=manifest);(run_dir/'run.json').write_text(json.dumps(manifest,indent=2));return manifest

def main():
 p=argparse.ArgumentParser();p.add_argument('--preset',default='termux-tiny');p.add_argument('--steps',type=int,default=80);p.add_argument('--dataset',type=Path,default=DATASET);p.add_argument('--lr',type=float,default=3e-3);p.add_argument('--grad-accum',type=int,default=1);p.add_argument('--warmup',type=int,default=5);p.add_argument('--resume');p.add_argument('--device');p.add_argument('--run-name');p.add_argument('--tokenizer');a=p.parse_args()
 try:r=run_training(preset=a.preset,steps=a.steps,dataset=a.dataset,lr=a.lr,grad_accum=a.grad_accum,warmup=a.warmup,resume=a.resume,device=a.device,run_name=a.run_name,tokenizer_spec=a.tokenizer);print(json.dumps({'state':'SUCCESS','message':'ForgeLM training run completed.',**r}))
 except Exception as e:print(json.dumps({'state':'FAILURE','message':str(e)}));raise SystemExit(1)
if __name__=='__main__':main()
