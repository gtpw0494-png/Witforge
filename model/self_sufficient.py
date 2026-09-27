"""Self-sufficient ForgeLM service: local-only, no provider fallback."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
try:
 import torch
 from forgelm import ForgeLM, ByteActionTokenizer
 from tokenizer import load_tokenizer
 from capabilities import ForgeCapabilities
except Exception as e:
 print(json.dumps({"state":"UNAVAILABLE","component":"forgelm","message":str(e)})); raise SystemExit(0)

ROOT=Path(__file__).resolve().parent
CKPT=ROOT/'checkpoints'/'forgelm-seed.pt'

def load():
 if not CKPT.exists(): raise RuntimeError('No local ForgeLM checkpoint exists; train ForgeLM first.')
 model=ForgeLM.load(CKPT); meta=getattr(model,'checkpoint_metadata',{}) or {}; spec=(meta.get('tokenizer') or {}).get('path')
 tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
 return model,tok,ForgeCapabilities(model,tok)

def generate(model,tok,prompt,max_tokens=128,temperature=.2,stream=False):
 ids=torch.tensor([tok.encode(prompt)],dtype=torch.long)
 generated=[]
 def on_token(token):
  generated.append(int(token))
  if stream:
   print(json.dumps({"type":"token","text":tok.decode(generated),"tokens":len(generated)}),flush=True)
 out=model.generate(ids,max_new_tokens=max_tokens,temperature=temperature,top_k=40,top_p=.95,on_token=on_token if stream else None)
 return tok.decode(out[0].tolist()[len(ids[0]):]).strip()

def main():
 p=argparse.ArgumentParser(); p.add_argument('task',choices=['status','chat','code','reasoning','planning','json','tool','embeddings','rerank','long-context','vision','image']); p.add_argument('--prompt',default=''); p.add_argument('--context',default=''); p.add_argument('--max-tokens',type=int,default=128); p.add_argument('--stream',action='store_true')
 a=p.parse_args()
 if a.task=='status':
  print(json.dumps({"state":"SUCCESS","engine":"ForgeLM","selfSufficient":True,"checkpointExists":CKPT.exists(),"networkRequired":False,"tasks":["chat","code","reasoning","planning","json","tool","embeddings","rerank","long-context","vision","image"],"partial":["vision","image"]})); return
 model,tok,caps=load()
 if a.task=='planning': print(json.dumps(caps.plan(a.prompt))); return
 if a.task=='embeddings':
  try: values=json.loads(a.prompt)
  except Exception: values=a.prompt
  print(json.dumps(caps.embed_texts(values))); return
 if a.task=='rerank':
  try: docs=json.loads(a.context)
  except Exception: docs=[]
  print(json.dumps(caps.rerank(a.prompt,docs))); return
 if a.task=='long-context':
  retrieved=caps.long_context(a.prompt,a.context,top_k=4)
  if retrieved.get("state")!="SUCCESS":
   print(json.dumps(retrieved)); return
  bounded=retrieved.get("context","")
  text=generate(model,tok,caps.prompt("chat",a.prompt,bounded),a.max_tokens,stream=a.stream)
  print(json.dumps({"state":"SUCCESS","engine":"ForgeLM","task":"long-context","text":text,"retrieval":retrieved,"externalModels":False})); return
 if a.task in ('vision','image') and not a.prompt: print(json.dumps(caps.status())); return
 text=generate(model,tok,caps.prompt(a.task,a.prompt,a.context),a.max_tokens,stream=a.stream)
 result={"state":"SUCCESS","engine":"ForgeLM","task":a.task,"text":text,"externalModels":False}
 if a.task=='json': result["validation"]=caps.validate_json(text)
 print(json.dumps(result))
if __name__=='__main__': main()
