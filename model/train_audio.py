#!/usr/bin/env python3
"""Train ForgeAudio against ForgeLM native text embeddings.

JSONL rows:
  {"audio":"relative/or/absolute.wav","text":"transcript or caption"}

Only PCM WAV is decoded in the dependency-free path.
"""
from __future__ import annotations
import argparse,json,time,wave
from pathlib import Path
import torch
import torch.nn.functional as F

try:
    from forgelm import ForgeLM,ByteActionTokenizer
    from tokenizer import load_tokenizer
    from audio import ForgeAudioConfig,ForgeAudioEncoder,ForgeAudioAdapter
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer
    from model.tokenizer import load_tokenizer
    from model.audio import ForgeAudioConfig,ForgeAudioEncoder,ForgeAudioAdapter

ROOT=Path(__file__).resolve().parent
LM_CKPT=ROOT/"checkpoints"/"forgelm-seed.pt"
RUNS=ROOT/"runs"

def load_wav(path:Path,target_rate:int):
    with wave.open(str(path),"rb") as w:
        channels=w.getnchannels();width=w.getsampwidth();rate=w.getframerate();frames=w.readframes(w.getnframes())
    if width not in (1,2,4): raise RuntimeError("Only 8/16/32-bit PCM WAV is supported.")
    dtype={1:torch.uint8,2:torch.int16,4:torch.int32}[width]
    x=torch.frombuffer(bytearray(frames),dtype=dtype)
    if width==1:x=(x.to(torch.float32)-128.0)/128.0
    else:x=x.to(torch.float32)/float(2**(8*width-1))
    if channels>1:x=x.view(-1,channels).mean(dim=1)
    if rate!=target_rate:
        n=max(1,round(x.numel()*target_rate/rate))
        x=F.interpolate(x.view(1,1,-1),size=n,mode="linear",align_corners=False).view(-1)
    return x

def rows(path):
    base=path.parent;out=[]
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():continue
        r=json.loads(line);p=Path(r["audio"])
        if not p.is_absolute():p=base/p
        text=str(r.get("text") or r.get("transcript") or r.get("caption") or "").strip()
        if p.exists() and text:out.append((p,text))
    return out

@torch.no_grad()
def text_embed(lm,tok,text,device):
    ids=tok.encode(text)[:lm.config.max_seq_len] or [0]
    return lm.embed(torch.tensor([ids],dtype=torch.long,device=device))[0]

def train(dataset,steps=100,lr=1e-3,sample_rate=16000,audio_dim=128,layers=2,heads=4,device=None,run_name=None):
    if not LM_CKPT.exists():raise RuntimeError("A promoted ForgeLM checkpoint is required.")
    data=rows(Path(dataset))
    if not data:raise RuntimeError("No valid audio-text training rows found.")
    device=device or ("cuda" if torch.cuda.is_available() else "cpu")
    lm=ForgeLM.load(LM_CKPT,device=device).eval();meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path")
    tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    ac=ForgeAudioConfig(sample_rate=sample_rate,audio_dim=audio_dim,audio_layers=layers,audio_heads=heads,output_dim=lm.config.d_model)
    audio=ForgeAudioEncoder(ac).to(device);adapter=ForgeAudioAdapter(audio,lm.config.d_model).to(device);opt=torch.optim.AdamW(adapter.parameters(),lr=lr)
    torch.manual_seed(7);losses=[];adapter.train()
    for step in range(int(steps)):
        p,text=data[step%len(data)];wav=load_wav(p,sample_rate).unsqueeze(0).to(device);target=text_embed(lm,tok,text,device).unsqueeze(0)
        tokens=adapter(wav);pred=F.normalize(tokens.mean(dim=1),p=2,dim=-1);target=F.normalize(target,p=2,dim=-1)
        loss=(1-F.cosine_similarity(pred,target,dim=-1).mean())+0.001*tokens.pow(2).mean()
        opt.zero_grad(set_to_none=True);loss.backward();torch.nn.utils.clip_grad_norm_(adapter.parameters(),1.0);opt.step();losses.append(float(loss.detach()))
    run_name=run_name or f"audio-{int(time.time())}";out=RUNS/run_name;out.mkdir(parents=True,exist_ok=True);ckpt=out/"forgeaudio.pt"
    audio.save(ckpt,metadata={"format":"forgeaudio-training-run-v1","dataset":str(dataset),"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1],"languageCheckpoint":str(LM_CKPT),"languageDim":lm.config.d_model,"externalModels":False})
    result={"state":"SUCCESS","checkpoint":str(ckpt),"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1],"rows":len(data),"externalModels":False,"promoted":False}
    (out/"audio-run.json").write_text(json.dumps(result,indent=2));return result

def main():
    p=argparse.ArgumentParser();p.add_argument("--dataset",type=Path,required=True);p.add_argument("--steps",type=int,default=100);p.add_argument("--lr",type=float,default=1e-3);p.add_argument("--sample-rate",type=int,default=16000);p.add_argument("--audio-dim",type=int,default=128);p.add_argument("--layers",type=int,default=2);p.add_argument("--heads",type=int,default=4);p.add_argument("--device");p.add_argument("--run-name");a=p.parse_args()
    try:print(json.dumps(train(a.dataset,a.steps,a.lr,a.sample_rate,a.audio_dim,a.layers,a.heads,a.device,a.run_name)))
    except Exception as e:print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False}));raise SystemExit(1)
if __name__=="__main__":main()
