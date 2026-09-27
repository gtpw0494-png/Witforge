#!/usr/bin/env python3
"""Evaluate ForgeSpeech candidates against held-out local text/WAV pairs."""
from __future__ import annotations
import argparse,json
from pathlib import Path
import torch
import torch.nn.functional as F
try:
    from forgelm import ForgeLM,ByteActionTokenizer
    from tokenizer import load_tokenizer
    from speech import ForgeSpeech
    from train_audio import load_wav
    from train_speech import rows,spectral_loss
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer
    from model.tokenizer import load_tokenizer
    from model.speech import ForgeSpeech
    from model.train_audio import load_wav
    from model.train_speech import rows,spectral_loss

ROOT=Path(__file__).resolve().parents[1];LM=ROOT/"checkpoints"/"forgelm-seed.pt"

@torch.no_grad()
def score(model,lm,tok,data,device,max_rows=32):
    vals=[]
    for p,text in data[:max_rows]:
        target=load_wav(p,model.config.sample_rate)[:model.config.max_samples]
        if target.numel()<model.config.max_samples:target=F.pad(target,(0,model.config.max_samples-target.numel()))
        target=target.unsqueeze(0).to(device);ids=tok.encode(text)[:lm.config.max_seq_len] or [0];cond=lm.embed(torch.tensor([ids],dtype=torch.long,device=device))
        pred=model(cond,target_samples=model.config.max_samples);loss=F.l1_loss(pred,target)+0.5*spectral_loss(pred,target)
        vals.append(float(loss))
    return sum(vals)/len(vals) if vals else None

def evaluate(candidate,dataset,baseline=None,max_loss=2.0,max_relative_regression=0.02,device="cpu"):
    if not LM.exists():return {"state":"UNAVAILABLE","passed":False,"message":"Promoted ForgeLM checkpoint is missing."}
    cand=ForgeSpeech.load(candidate,device=device).eval();lm=ForgeLM.load(LM,device=device).eval()
    if cand.config.text_dim!=lm.config.d_model:return {"state":"FAILURE","passed":False,"message":"ForgeSpeech text dimension does not match ForgeLM hidden dimension."}
    meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path");tok=load_tokenizer(spec) if spec else ByteActionTokenizer();data=rows(Path(dataset))
    if not data:return {"state":"FAILURE","passed":False,"message":"Evaluation dataset has no valid text/WAV rows."}
    cand_loss=score(cand,lm,tok,data,device);base_loss=None
    if baseline and Path(baseline).exists():
        base=ForgeSpeech.load(baseline,device=device).eval()
        if base.config.text_dim==lm.config.d_model:base_loss=score(base,lm,tok,data,device)
    threshold_pass=cand_loss is not None and cand_loss<=float(max_loss);relative_regression=None;regression_pass=True
    if base_loss is not None:
        denom=max(abs(base_loss),1e-6);relative_regression=(cand_loss-base_loss)/denom;regression_pass=relative_regression<=float(max_relative_regression)
    passed=bool(threshold_pass and regression_pass)
    return {"state":"SUCCESS" if passed else "FAILURE","passed":passed,"candidateLoss":cand_loss,"baselineLoss":base_loss,"relativeRegression":relative_regression,"maxLoss":float(max_loss),"maxRelativeRegression":float(max_relative_regression),"rows":min(len(data),32),"externalModels":False}

def main():
    p=argparse.ArgumentParser();p.add_argument("--candidate",required=True);p.add_argument("--dataset",required=True);p.add_argument("--baseline");p.add_argument("--max-loss",type=float,default=2.0);p.add_argument("--max-relative-regression",type=float,default=0.02);p.add_argument("--device",default="cpu");a=p.parse_args()
    try:print(json.dumps(evaluate(a.candidate,a.dataset,a.baseline,a.max_loss,a.max_relative_regression,a.device)))
    except Exception as e:print(json.dumps({"state":"FAILURE","passed":False,"message":str(e),"externalModels":False}));raise SystemExit(1)
if __name__=="__main__":main()
