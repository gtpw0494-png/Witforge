#!/usr/bin/env python3
"""Evaluate ForgeVideo candidates against local video-text evidence."""
from __future__ import annotations
import argparse,json
from pathlib import Path
import torch
import torch.nn.functional as F
try:
    from forgelm import ForgeLM,ByteActionTokenizer
    from tokenizer import load_tokenizer
    from video import ForgeVideoEncoder
    from train_video import extract_frames,rows
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer
    from model.tokenizer import load_tokenizer
    from model.video import ForgeVideoEncoder
    from model.train_video import extract_frames,rows

ROOT=Path(__file__).resolve().parents[1];LM=ROOT/"checkpoints"/"forgelm-seed.pt"

@torch.no_grad()
def score(model,lm,tok,data,device,max_rows=32):
    vals=[]
    for p,text in data[:max_rows]:
        frames=extract_frames(p,model.config.frames,model.config.frame_size).unsqueeze(0).to(device);v=model.embed(frames)
        ids=tok.encode(text)[:lm.config.max_seq_len] or [0];t=lm.embed(torch.tensor([ids],dtype=torch.long,device=device))
        vals.append(float(F.cosine_similarity(v,t,dim=-1).item()))
    return sum(vals)/len(vals) if vals else None

def evaluate(candidate,dataset,baseline=None,min_cosine=0.05,max_relative_regression=0.02,device="cpu"):
    if not LM.exists():return {"state":"UNAVAILABLE","passed":False,"message":"Promoted ForgeLM checkpoint is missing."}
    cand=ForgeVideoEncoder.load(candidate,device=device).eval();lm=ForgeLM.load(LM,device=device).eval()
    if cand.config.output_dim!=lm.config.d_model:return {"state":"FAILURE","passed":False,"message":"ForgeVideo output dimension does not match ForgeLM hidden dimension."}
    meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path");tok=load_tokenizer(spec) if spec else ByteActionTokenizer();data=rows(Path(dataset))
    if not data:return {"state":"FAILURE","passed":False,"message":"Evaluation dataset has no valid video-text rows."}
    cand_score=score(cand,lm,tok,data,device);base_score=None
    if baseline and Path(baseline).exists():
        base=ForgeVideoEncoder.load(baseline,device=device).eval()
        if base.config.output_dim==lm.config.d_model:base_score=score(base,lm,tok,data,device)
    threshold_pass=cand_score is not None and cand_score>=float(min_cosine);relative_regression=None;regression_pass=True
    if base_score is not None:
        denom=max(abs(base_score),1e-6);relative_regression=(base_score-cand_score)/denom;regression_pass=relative_regression<=float(max_relative_regression)
    passed=bool(threshold_pass and regression_pass)
    return {"state":"SUCCESS" if passed else "FAILURE","passed":passed,"candidateMeanCosine":cand_score,"baselineMeanCosine":base_score,"relativeRegression":relative_regression,"minCosine":float(min_cosine),"maxRelativeRegression":float(max_relative_regression),"rows":min(len(data),32),"externalModels":False}

def main():
    p=argparse.ArgumentParser();p.add_argument("--candidate",required=True);p.add_argument("--dataset",required=True);p.add_argument("--baseline");p.add_argument("--min-cosine",type=float,default=0.05);p.add_argument("--max-relative-regression",type=float,default=0.02);p.add_argument("--device",default="cpu");a=p.parse_args()
    try:print(json.dumps(evaluate(a.candidate,a.dataset,a.baseline,a.min_cosine,a.max_relative_regression,a.device)))
    except Exception as e:print(json.dumps({"state":"FAILURE","passed":False,"message":str(e),"externalModels":False}));raise SystemExit(1)
if __name__=="__main__":main()
