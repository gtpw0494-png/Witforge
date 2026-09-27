#!/usr/bin/env python3
"""Train ForgeSpeech from local text/WAV pairs using ForgeLM conditioning."""
from __future__ import annotations
import argparse,json,time,wave
from pathlib import Path
import torch
import torch.nn.functional as F

try:
    from forgelm import ForgeLM,ByteActionTokenizer
    from tokenizer import load_tokenizer
    from train_audio import load_wav
    from speech import ForgeSpeech,ForgeSpeechConfig
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer
    from model.tokenizer import load_tokenizer
    from model.train_audio import load_wav
    from model.speech import ForgeSpeech,ForgeSpeechConfig

ROOT=Path(__file__).resolve().parent
LM_CKPT=ROOT/"checkpoints"/"forgelm-seed.pt"
RUNS=ROOT/"runs"

def rows(path:Path):
    out=[];base=path.parent
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():continue
        r=json.loads(line);p=Path(r["audio"])
        if not p.is_absolute():p=base/p
        text=str(r.get("text") or r.get("transcript") or "").strip()
        if p.exists() and text:out.append((p,text))
    return out

@torch.no_grad()
def text_embed(lm,tok,text,device):
    ids=tok.encode(text)[:lm.config.max_seq_len] or [0]
    return lm.embed(torch.tensor([ids],dtype=torch.long,device=device))[0]

def spectral_loss(pred,target,n_fft=256,hop=64):
    window=torch.hann_window(n_fft,device=pred.device,dtype=pred.dtype)
    ps=torch.stft(pred,n_fft=n_fft,hop_length=hop,win_length=n_fft,window=window,return_complex=True).abs()
    ts=torch.stft(target,n_fft=n_fft,hop_length=hop,win_length=n_fft,window=window,return_complex=True).abs()
    return F.l1_loss(torch.log1p(ps),torch.log1p(ts))

def train(dataset,steps=100,lr=2e-4,sample_rate=16000,max_samples=32000,hidden_dim=128,device=None,run_name=None):
    if not LM_CKPT.exists():raise RuntimeError("A promoted ForgeLM checkpoint is required.")
    data=rows(Path(dataset))
    if not data:raise RuntimeError("No valid text/WAV rows found.")
    device=device or ("cuda" if torch.cuda.is_available() else "cpu")
    lm=ForgeLM.load(LM_CKPT,device=device).eval();meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path")
    tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    cfg=ForgeSpeechConfig(sample_rate=sample_rate,text_dim=lm.config.d_model,hidden_dim=hidden_dim,max_samples=max_samples)
    model=ForgeSpeech(cfg).to(device);opt=torch.optim.AdamW(model.parameters(),lr=lr);torch.manual_seed(7);losses=[];model.train()
    for step in range(int(steps)):
        p,text=data[step%len(data)];target=load_wav(p,sample_rate)[:max_samples]
        if target.numel()<max_samples:target=F.pad(target,(0,max_samples-target.numel()))
        target=target.unsqueeze(0).to(device);cond=text_embed(lm,tok,text,device).unsqueeze(0);pred=model(cond,target_samples=max_samples)
        wave_loss=F.l1_loss(pred,target);spec_loss=spectral_loss(pred,target);loss=wave_loss+0.5*spec_loss
        opt.zero_grad(set_to_none=True);loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1.0);opt.step();losses.append(float(loss.detach()))
    run_name=run_name or f"speech-{int(time.time())}";out=RUNS/run_name;out.mkdir(parents=True,exist_ok=True);ckpt=out/"forgespeech.pt"
    model.save(ckpt,metadata={"format":"forgespeech-training-run-v1","dataset":str(dataset),"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1],"languageCheckpoint":str(LM_CKPT),"languageDim":lm.config.d_model,"sampleRate":sample_rate,"externalModels":False})
    result={"state":"SUCCESS","checkpoint":str(ckpt),"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1],"rows":len(data),"externalModels":False,"promoted":False}
    (out/"speech-run.json").write_text(json.dumps(result,indent=2));return result

def main():
    p=argparse.ArgumentParser();p.add_argument("--dataset",type=Path,required=True);p.add_argument("--steps",type=int,default=100);p.add_argument("--lr",type=float,default=2e-4);p.add_argument("--sample-rate",type=int,default=16000);p.add_argument("--max-samples",type=int,default=32000);p.add_argument("--hidden-dim",type=int,default=128);p.add_argument("--device");p.add_argument("--run-name");a=p.parse_args()
    try:print(json.dumps(train(a.dataset,a.steps,a.lr,a.sample_rate,a.max_samples,a.hidden_dim,a.device,a.run_name)))
    except Exception as e:print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False}));raise SystemExit(1)
if __name__=="__main__":main()
