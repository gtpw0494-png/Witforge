#!/usr/bin/env python3
"""Native ForgeVideo -> ForgeLM video-language runtime."""
from __future__ import annotations
import argparse,json
from pathlib import Path
import torch
import torch.nn.functional as F
try:
    from forgelm import ForgeLM,ByteActionTokenizer,SPECIAL
    from tokenizer import load_tokenizer
    from video import ForgeVideoEncoder
    from train_video import extract_frames
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer,SPECIAL
    from model.tokenizer import load_tokenizer
    from model.video import ForgeVideoEncoder
    from model.train_video import extract_frames

ROOT=Path(__file__).resolve().parent
LM_CKPT=ROOT/"checkpoints"/"forgelm-seed.pt"
VIDEO_CKPT=ROOT/"checkpoints"/"forgevideo.pt"

def load_runtime(device="cpu"):
    if not LM_CKPT.exists():raise RuntimeError("No promoted ForgeLM checkpoint exists.")
    if not VIDEO_CKPT.exists():raise RuntimeError("No promoted ForgeVideo checkpoint exists.")
    lm=ForgeLM.load(LM_CKPT,device=device).eval();video=ForgeVideoEncoder.load(VIDEO_CKPT,device=device).eval()
    if video.config.output_dim!=lm.config.d_model:raise RuntimeError(f"ForgeVideo output_dim {video.config.output_dim} does not match ForgeLM d_model {lm.config.d_model}.")
    meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path");tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    return lm,video,tok

@torch.no_grad()
def generate_multimodal(lm,video,tok,frames,prompt,max_new_tokens=96,temperature=0.2,top_k=40,top_p=0.95):
    device=next(lm.parameters()).device
    vtokens=video(frames.to(device))
    prompt_ids=tok.encode(str(prompt or "Describe the video.")) or [SPECIAL["<|act|>"]]
    max_prompt=max(1,lm.config.max_seq_len-vtokens.shape[1]);prompt_ids=prompt_ids[-max_prompt:]
    ids=torch.tensor([prompt_ids],dtype=torch.long,device=device);x=torch.cat([vtokens,lm.emb(ids)],dim=1)
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
    base={"engine":"ForgeVideo+ForgeLM","externalModels":False,"networkRequired":False,"languageCheckpointExists":LM_CKPT.exists(),"videoCheckpointExists":VIDEO_CKPT.exists()}
    if not LM_CKPT.exists() or not VIDEO_CKPT.exists():return {"state":"UNAVAILABLE",**base,"message":"Both promoted ForgeLM and ForgeVideo checkpoints are required."}
    try:
        lm,video,_=load_runtime("cpu");return {"state":"CONNECTED",**base,"videoOutputDim":video.config.output_dim,"languageDim":lm.config.d_model,"frames":video.config.frames,"frameSize":video.config.frame_size,"message":"Native video-language runtime loaded successfully."}
    except Exception as e:return {"state":"FAILURE",**base,"message":str(e)}

def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest="cmd",required=True);sub.add_parser("status");d=sub.add_parser("describe");d.add_argument("--video",required=True);d.add_argument("--prompt",default="Describe the video using only the temporal and visual evidence.");d.add_argument("--max-tokens",type=int,default=96);d.add_argument("--temperature",type=float,default=0.2);d.add_argument("--device",default="cpu");a=p.parse_args()
    if a.cmd=="status":print(json.dumps(status()));return
    try:
        lm,video,tok=load_runtime(a.device);frames=extract_frames(Path(a.video),video.config.frames,video.config.frame_size).unsqueeze(0).to(next(lm.parameters()).device);text=generate_multimodal(lm,video,tok,frames,a.prompt,a.max_tokens,a.temperature)
        print(json.dumps({"state":"SUCCESS","engine":"ForgeVideo+ForgeLM","text":text,"video":str(Path(a.video)),"externalModels":False,"networkRequired":False}))
    except Exception as e:print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False,"networkRequired":False}));raise SystemExit(1)
if __name__=="__main__":main()
