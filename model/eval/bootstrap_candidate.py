#!/usr/bin/env python3
"""Bootstrap evaluation for the first ForgeLM production checkpoint.

This is deliberately separate from regression comparison because a fresh install has
no baseline checkpoint. It verifies loadability, finite model parameters/loss
metadata, tokenizer compatibility, and deterministic local generation.
"""
from __future__ import annotations
import argparse,json,math
from pathlib import Path
import torch
try:
    from forgelm import ForgeLM,ByteActionTokenizer
    from tokenizer import load_tokenizer
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer
    from model.tokenizer import load_tokenizer

def main():
    p=argparse.ArgumentParser();p.add_argument("--candidate",required=True);a=p.parse_args()
    path=Path(a.candidate)
    try:
        m=ForgeLM.load(path,device="cpu").eval();meta=getattr(m,"checkpoint_metadata",{}) or {}
        tok_spec=(meta.get("tokenizer") or {}).get("path");tok=load_tokenizer(tok_spec) if tok_spec else ByteActionTokenizer()
        start=meta.get("startLoss");end=meta.get("endLoss");val=meta.get("validationLoss")
        losses=[x for x in [start,end,val] if x is not None]
        finite=all(math.isfinite(float(x)) for x in losses)
        improved=(start is None or end is None or float(end)<=float(start)*1.10)
        ids=tok.encode("Hello") or [0];x=torch.tensor([ids],dtype=torch.long)
        seen=[];out=m.generate(x,max_new_tokens=4,temperature=0,top_k=1,top_p=1.0,on_token=lambda t:seen.append(int(t)))
        generated=tok.decode(out[0].tolist()[len(ids):])
        params=sum(p.numel() for p in m.parameters())
        passed=bool(params>0 and finite and improved and out.shape[1]>len(ids))
        print(json.dumps({"state":"SUCCESS" if passed else "FAILURE","passed":passed,"candidate":str(path),"parameters":params,"startLoss":start,"endLoss":end,"validationLoss":val,"lossesFinite":finite,"trainingTrendAcceptable":improved,"generatedTokens":len(seen),"generatedText":generated,"externalModels":False}))
    except Exception as e:
        print(json.dumps({"state":"FAILURE","passed":False,"message":str(e),"externalModels":False}));raise SystemExit(1)
if __name__=="__main__":main()
