#!/usr/bin/env python3
"""Native ForgeAudio -> ForgeLM multimodal inference runtime."""
from __future__ import annotations
import argparse,json
from pathlib import Path
import torch
import torch.nn.functional as F
try:
    from forgelm import ForgeLM,ByteActionTokenizer,SPECIAL
    from tokenizer import load_tokenizer
    from audio import ForgeAudioEncoder
    from train_audio import load_wav
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer,SPECIAL
    from model.tokenizer import load_tokenizer
    from model.audio import ForgeAudioEncoder
    from model.train_audio import load_wav

ROOT=Path(__file__).resolve().parent
LM_CKPT=ROOT/"checkpoints"/"forgelm-seed.pt"
AUDIO_CKPT=ROOT/"checkpoints"/"forgeaudio.pt"

def load_runtime(device="cpu"):
    if not LM_CKPT.exists():raise RuntimeError("No promoted ForgeLM checkpoint exists.")
    if not AUDIO_CKPT.exists():raise RuntimeError("No promoted ForgeAudio checkpoint exists.")
    lm=ForgeLM.load(LM_CKPT,device=device).eval();audio=ForgeAudioEncoder.load(AUDIO_CKPT,device=device).eval()
    if audio.config.output_dim!=lm.config.d_model:raise RuntimeError(f"ForgeAudio output_dim {audio.config.output_dim} does not match ForgeLM d_model {lm.config.d_model}.")
    meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path");tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    return lm,audio,tok

@torch.no_grad()
def generate_multimodal(lm,audio,tok,waveform,prompt,max_new_tokens=96,temperature=0.2,top_k=40,top_p=0.95):
    device=next(lm.parameters()).device
    atokens=audio(waveform.to(device))
    prompt_ids=tok.encode(str(prompt or "Describe the audio.")) or [SPECIAL["<|act|>"]]
    max_prompt=max(1,lm.config.max_seq_len-atokens.shape[1]);prompt_ids=prompt_ids[-max_prompt:]
    ids=torch.tensor([prompt_ids],dtype=torch.long,device=device);x=torch.cat([atokens,lm.emb(ids)],dim=1)
    if x.shape[1]>lm.config.max_seq_len:x=x[:,-lm.config.max_seq_len:,:]
    caches=[];hidden=x
    for block in lm.blocks:
        hidden,cache=block(hidden,cache=None,start_pos=0,use_cache=True);caches.append(cache)
    hidden=lm.norm(hidden);logits=F.linear(hidden,lm.emb.weight);nxt=lm._sample(logits[:,-1,:],temperature,top_k,top_p);generated=[int(nxt[0,0])];position=x.shape[1]
    if generated[-1]==SPECIAL["<|end|>"]:return tok.decode(generated)
    for _ in range(max(0,int(max_new_tokens)-1)):
        logits,_,caches=lm(nxt,cache=caches,start_pos=position,use_cache=True);position+=1;nxt=lm._sample(logits[:,-1,:],temperature,top_k,top_p);token=int(nxt[0,0]);generated.append(token)
        if token==SPECIAL["<|end|>"]:break
    return tok.decode(generated).strip()

def status():
    base={"engine":"ForgeAudio+ForgeLM","externalModels":False,"networkRequired":False,"languageCheckpointExists":LM_CKPT.exists(),"audioCheckpointExists":AUDIO_CKPT.exists()}
    if not LM_CKPT.exists() or not AUDIO_CKPT.exists():return {"state":"UNAVAILABLE",**base,"message":"Both promoted ForgeLM and ForgeAudio checkpoints are required."}
    try:
        lm,audio,_=load_runtime("cpu");return {"state":"CONNECTED",**base,"audioOutputDim":audio.config.output_dim,"languageDim":lm.config.d_model,"sampleRate":audio.config.sample_rate,"message":"Native audio-language runtime loaded successfully."}
    except Exception as e:return {"state":"FAILURE",**base,"message":str(e)}

def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest="cmd",required=True);sub.add_parser("status");d=sub.add_parser("describe");d.add_argument("--audio",required=True);d.add_argument("--prompt",default="Describe or transcribe the audio using only the acoustic evidence.");d.add_argument("--max-tokens",type=int,default=96);d.add_argument("--temperature",type=float,default=0.2);d.add_argument("--device",default="cpu");a=p.parse_args()
    if a.cmd=="status":print(json.dumps(status()));return
    try:
        lm,audio,tok=load_runtime(a.device);wav=load_wav(Path(a.audio),audio.config.sample_rate).unsqueeze(0).to(next(lm.parameters()).device);text=generate_multimodal(lm,audio,tok,wav,a.prompt,a.max_tokens,a.temperature)
        print(json.dumps({"state":"SUCCESS","engine":"ForgeAudio+ForgeLM","text":text,"audio":str(Path(a.audio)),"externalModels":False,"networkRequired":False}))
    except Exception as e:print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False,"networkRequired":False}));raise SystemExit(1)
if __name__=="__main__":main()
