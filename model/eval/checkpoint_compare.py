#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,sys
from pathlib import Path
import torch

MODEL_ROOT=Path(__file__).resolve().parents[1]
if str(MODEL_ROOT) not in sys.path:
    sys.path.insert(0,str(MODEL_ROOT))

from forgelm import ForgeLM, ByteActionTokenizer
from tokenizer import load_tokenizer
from trainer import rows, token_chunks, evaluate

DEFAULT_REGRESSION=Path(__file__).resolve().parent/"regression_corpus.jsonl"

def tokenizer_for(model):
    meta=getattr(model,"checkpoint_metadata",{}) or {}
    spec=(meta.get("tokenizer") or {}).get("path")
    return load_tokenizer(spec) if spec else ByteActionTokenizer()

def evaluate_texts(model,path:Path):
    tok=tokenizer_for(model)
    texts=rows(path)
    chunks=token_chunks(texts,tok,model.cfg.max_seq_len)
    loss=evaluate(model,chunks,torch.device("cpu"))
    return {"loss":loss,"samples":len(chunks)}

def evaluate_knowledge(model,dataset:Path):
    source=dataset/"validation.jsonl"
    if not source.exists() or not rows(source):
        return {"loss":None,"samples":0,"source":str(source)}
    result=evaluate_texts(model,source)
    return {**result,"source":str(source)}

def relative_regression(baseline,candidate):
    return (candidate-baseline)/max(abs(baseline),1e-12)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--baseline",type=Path,required=True)
    p.add_argument("--candidate",type=Path,required=True)
    p.add_argument("--dataset",type=Path,required=True)
    p.add_argument("--regression-corpus",type=Path,default=DEFAULT_REGRESSION)
    p.add_argument("--max-relative-regression",type=float,default=0.02)
    a=p.parse_args()
    if not a.baseline.exists() or not a.candidate.exists():
        print(json.dumps({"state":"UNAVAILABLE","message":"Baseline or candidate checkpoint missing."}));raise SystemExit(2)
    if not a.regression_corpus.exists():
        print(json.dumps({"state":"UNAVAILABLE","message":"Regression corpus missing."}));raise SystemExit(2)

    baseline=ForgeLM.load(a.baseline)
    candidate=ForgeLM.load(a.candidate)
    b_knowledge=evaluate_knowledge(baseline,a.dataset)
    c_knowledge=evaluate_knowledge(candidate,a.dataset)
    b_regression=evaluate_texts(baseline,a.regression_corpus)
    c_regression=evaluate_texts(candidate,a.regression_corpus)

    if any(x["loss"] is None for x in [b_knowledge,c_knowledge,b_regression,c_regression]):
        print(json.dumps({"state":"UNAVAILABLE","message":"Held-out evaluation data is unavailable.","knowledge":{"baseline":b_knowledge,"candidate":c_knowledge},"regression":{"baseline":b_regression,"candidate":c_regression}}));raise SystemExit(2)

    knowledge_rel=relative_regression(b_knowledge["loss"],c_knowledge["loss"])
    regression_rel=relative_regression(b_regression["loss"],c_regression["loss"])
    passed=knowledge_rel<=a.max_relative_regression and regression_rel<=a.max_relative_regression
    out={
        "state":"SUCCESS" if passed else "FAILURE",
        "passed":passed,
        "max_relative_regression":a.max_relative_regression,
        "knowledge":{"baseline":b_knowledge,"candidate":c_knowledge,"relative_regression":knowledge_rel},
        "general_regression":{"baseline":b_regression,"candidate":c_regression,"relative_regression":regression_rel},
        "parameters":{"baseline":sum(p.numel() for p in baseline.parameters()),"candidate":sum(p.numel() for p in candidate.parameters())},
    }
    print(json.dumps(out));raise SystemExit(0 if passed else 1)

if __name__=="__main__":
    main()
