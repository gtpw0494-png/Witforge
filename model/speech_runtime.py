#!/usr/bin/env python3
"""Native ForgeLM -> ForgeSpeech text-to-waveform runtime."""
from __future__ import annotations
import argparse,json,wave
from pathlib import Path
import torch

try:
    from forgelm import ForgeLM,ByteActionTokenizer
    from tokenizer import load_tokenizer
    from speech import ForgeSpeech
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer
    from model.tokenizer import load_tokenizer
    from model.speech import ForgeSpeech

ROOT=Path(__file__).resolve().parent
LM_CKPT=ROOT/"checkpoints"/"forgelm-seed.pt"
SPEECH_CKPT=ROOT/"checkpoints"/"forgespeech.pt"

def load_runtime(device="cpu"):
    if not LM_CKPT.exists():raise RuntimeError("No promoted ForgeLM checkpoint exists.")
    if not SPEECH_CKPT.exists():raise RuntimeError("No promoted ForgeSpeech checkpoint exists.")
    lm=ForgeLM.load(LM_CKPT,device=device).eval();speech=ForgeSpeech.load(SPEECH_CKPT,device=device).eval()
    if speech.config.text_dim!=lm.config.d_model:raise RuntimeError(f"ForgeSpeech text_dim {speech.config.text_dim} does not match ForgeLM d_model {lm.config.d_model}.")
    meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path");tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    return lm,speech,tok

@torch.no_grad()
def synthesize(lm,speech,tok,text):
    device=next(lm.parameters()).device
    ids=tok.encode(str(text))[:lm.config.max_seq_len] or [0]
    cond=lm.embed(torch.tensor([ids],dtype=torch.long,device=device))
    return speech(cond,target_samples=speech.config.max_samples)[0].clamp(-1,1).cpu()

def write_wav(path,waveform,sample_rate):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    pcm=(waveform.clamp(-1,1)*32767.0).to(torch.int16).numpy().tobytes()
    with wave.open(str(path),"wb") as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(int(sample_rate));w.writeframes(pcm)
    return path

def status():
    base={"engine":"ForgeLM+ForgeSpeech","externalModels":False,"networkRequired":False,"languageCheckpointExists":LM_CKPT.exists(),"speechCheckpointExists":SPEECH_CKPT.exists()}
    if not LM_CKPT.exists() or not SPEECH_CKPT.exists():return {"state":"UNAVAILABLE",**base,"message":"Both promoted ForgeLM and ForgeSpeech checkpoints are required."}
    try:
        lm,speech,_=load_runtime("cpu");return {"state":"CONNECTED",**base,"languageDim":lm.config.d_model,"speechTextDim":speech.config.text_dim,"sampleRate":speech.config.sample_rate,"maxSamples":speech.config.max_samples,"message":"Native speech generation runtime loaded successfully."}
    except Exception as e:return {"state":"FAILURE",**base,"message":str(e)}

def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest="cmd",required=True);sub.add_parser("status");s=sub.add_parser("synthesize");s.add_argument("--text",required=True);s.add_argument("--output",required=True);s.add_argument("--device",default="cpu");a=p.parse_args()
    if a.cmd=="status":print(json.dumps(status()));return
    try:
        lm,speech,tok=load_runtime(a.device);wav=synthesize(lm,speech,tok,a.text);out=write_wav(a.output,wav,speech.config.sample_rate)
        print(json.dumps({"state":"SUCCESS","engine":"ForgeLM+ForgeSpeech","output":str(out),"samples":int(wav.numel()),"sampleRate":speech.config.sample_rate,"externalModels":False,"networkRequired":False}))
    except Exception as e:print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False,"networkRequired":False}));raise SystemExit(1)
if __name__=="__main__":main()
