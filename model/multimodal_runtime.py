#!/usr/bin/env python3
"""Unified native multimodal runtime for ForgeLM.

Combines any available promoted image/audio/video encoders with local text/context
tokens in one bounded ForgeLM prefill. No external model fallback exists here.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path
import torch
import torch.nn.functional as F

try:
    from PIL import Image
except Exception:
    Image=None

try:
    from forgelm import ForgeLM,ByteActionTokenizer,SPECIAL
    from tokenizer import load_tokenizer
    from vision import ForgeVisionEncoder
    from audio import ForgeAudioEncoder
    from video import ForgeVideoEncoder
    from train_audio import load_wav
    from train_video import extract_frames
    from multimodal import FusionBudget,FusionAssembler
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer,SPECIAL
    from model.tokenizer import load_tokenizer
    from model.vision import ForgeVisionEncoder
    from model.audio import ForgeAudioEncoder
    from model.video import ForgeVideoEncoder
    from model.train_audio import load_wav
    from model.train_video import extract_frames
    from model.multimodal import FusionBudget,FusionAssembler

ROOT=Path(__file__).resolve().parent
CKPT=ROOT/"checkpoints"
LM_CKPT=CKPT/"forgelm-seed.pt"
VISION_CKPT=CKPT/"forgevision.pt"
AUDIO_CKPT=CKPT/"forgeaudio.pt"
VIDEO_CKPT=CKPT/"forgevideo.pt"

def load_lm(device="cpu"):
    if not LM_CKPT.exists():raise RuntimeError("No promoted ForgeLM checkpoint exists.")
    lm=ForgeLM.load(LM_CKPT,device=device).eval()
    meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path")
    tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    return lm,tok

def image_tensor(path,size,device):
    if Image is None:raise RuntimeError("Pillow is required for local image decoding.")
    img=Image.open(path).convert("RGB").resize((size,size))
    x=torch.tensor(list(img.getdata()),dtype=torch.float32).view(size,size,3).permute(2,0,1)/255.0
    return x.unsqueeze(0).to(device)

def text_tokens(lm,tok,text,device,limit):
    ids=tok.encode(str(text or ""))[-int(limit):]
    if not ids:return None
    x=torch.tensor([ids],dtype=torch.long,device=device)
    return lm.emb(x)

def _compatible(model,lm):
    out=getattr(getattr(model,"config",None),"output_dim",None)
    return out==lm.config.d_model

@torch.no_grad()
def build_tokens(lm,tok,*,prompt="",context="",document="",image=None,audio=None,video=None,budget=None,device="cpu"):
    pieces={};evidence=[];available={}
    if image:
        if not VISION_CKPT.exists():raise RuntimeError("Image input supplied but no promoted ForgeVision checkpoint exists.")
        enc=ForgeVisionEncoder.load(VISION_CKPT,device=device).eval()
        if not _compatible(enc,lm):raise RuntimeError("ForgeVision hidden dimension is incompatible with ForgeLM.")
        pieces["image"]=enc(image_tensor(Path(image),enc.config.image_size,device));available["image"]="CONNECTED";evidence.append({"modality":"image","source":str(image)})
    if audio:
        if not AUDIO_CKPT.exists():raise RuntimeError("Audio input supplied but no promoted ForgeAudio checkpoint exists.")
        enc=ForgeAudioEncoder.load(AUDIO_CKPT,device=device).eval()
        if not _compatible(enc,lm):raise RuntimeError("ForgeAudio hidden dimension is incompatible with ForgeLM.")
        wav=load_wav(Path(audio),enc.config.sample_rate).unsqueeze(0).to(device)
        pieces["audio"]=enc(wav);available["audio"]="CONNECTED";evidence.append({"modality":"audio","source":str(audio)})
    if video:
        if not VIDEO_CKPT.exists():raise RuntimeError("Video input supplied but no promoted ForgeVideo checkpoint exists.")
        enc=ForgeVideoEncoder.load(VIDEO_CKPT,device=device).eval()
        if not _compatible(enc,lm):raise RuntimeError("ForgeVideo hidden dimension is incompatible with ForgeLM.")
        frames=extract_frames(Path(video),enc.config.frames,enc.config.frame_size).unsqueeze(0).to(device)
        pieces["video"]=enc(frames);available["video"]="CONNECTED";evidence.append({"modality":"video","source":str(video)})
    b=budget or FusionBudget(max_tokens=max(8,lm.config.max_seq_len-1))
    if document:
        pieces["document"]=text_tokens(lm,tok,document,device,b.document_tokens);evidence.append({"modality":"document","characters":len(document)})
    if context:
        pieces["context"]=text_tokens(lm,tok,context,device,b.context_tokens);evidence.append({"modality":"context","characters":len(context)})
    pieces["text"]=text_tokens(lm,tok,prompt or "Respond using the supplied evidence.",device,b.text_tokens)
    assembled=FusionAssembler(b).assemble(**pieces)
    return assembled,evidence,available

@torch.no_grad()
def generate(lm,tok,prefill,max_new_tokens=128,temperature=0.2,top_k=40,top_p=0.95,stream=False):
    x=prefill
    caches=[];hidden=x
    for block in lm.blocks:
        hidden,cache=block(hidden,cache=None,start_pos=0,use_cache=True);caches.append(cache)
    hidden=lm.norm(hidden);logits=F.linear(hidden,lm.emb.weight)
    nxt=lm._sample(logits[:,-1,:],temperature,top_k,top_p);generated=[int(nxt[0,0])];position=x.shape[1]
    if generated[-1]!=SPECIAL["<|end|>"] and stream:print(json.dumps({"type":"token","text":tok.decode(generated),"tokens":len(generated)}),flush=True)
    if generated[-1]==SPECIAL["<|end|>"]:return tok.decode(generated).strip()
    for _ in range(max(0,int(max_new_tokens)-1)):
        logits,_,caches=lm(nxt,cache=caches,start_pos=position,use_cache=True);position+=1
        nxt=lm._sample(logits[:,-1,:],temperature,top_k,top_p);token=int(nxt[0,0]);generated.append(token)
        if token!=SPECIAL["<|end|>"] and stream:print(json.dumps({"type":"token","text":tok.decode(generated),"tokens":len(generated)}),flush=True)
        if token==SPECIAL["<|end|>"]:break
    return tok.decode(generated).strip()

def status():
    base={"engine":"ForgeMultimodal+ForgeLM","externalModels":False,"networkRequired":False,"languageCheckpointExists":LM_CKPT.exists(),"checkpoints":{"vision":VISION_CKPT.exists(),"audio":AUDIO_CKPT.exists(),"video":VIDEO_CKPT.exists()}}
    if not LM_CKPT.exists():return {"state":"UNAVAILABLE",**base,"message":"A promoted ForgeLM checkpoint is required."}
    try:
        lm,_=load_lm("cpu");mods={}
        for name,path,loader in [("vision",VISION_CKPT,ForgeVisionEncoder),("audio",AUDIO_CKPT,ForgeAudioEncoder),("video",VIDEO_CKPT,ForgeVideoEncoder)]:
            if not path.exists():mods[name]="UNAVAILABLE";continue
            try:mods[name]="CONNECTED" if _compatible(loader.load(path,device="cpu"),lm) else "FAILURE"
            except Exception:mods[name]="FAILURE"
        return {"state":"CONNECTED","fusion":"PARAMETER_FREE_ASSEMBLER",**base,"modalities":mods,"languageDim":lm.config.d_model,"maxSequenceTokens":lm.config.max_seq_len,"message":"Unified local multimodal token assembly is available; each modality remains gated by its own promoted checkpoint health."}
    except Exception as e:return {"state":"FAILURE",**base,"message":str(e)}

def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest="cmd",required=True);sub.add_parser("status")
    c=sub.add_parser("chat");c.add_argument("--prompt",default="Respond using the supplied evidence.");c.add_argument("--context",default="");c.add_argument("--document",default="");c.add_argument("--image");c.add_argument("--audio");c.add_argument("--video");c.add_argument("--max-tokens",type=int,default=128);c.add_argument("--temperature",type=float,default=0.2);c.add_argument("--device",default="cpu");c.add_argument("--stream",action="store_true")
    a=p.parse_args()
    if a.cmd=="status":print(json.dumps(status()));return
    try:
        lm,tok=load_lm(a.device);assembled,evidence,available=build_tokens(lm,tok,prompt=a.prompt,context=a.context,document=a.document,image=a.image,audio=a.audio,video=a.video,budget=FusionBudget(max_tokens=max(8,lm.config.max_seq_len-1)),device=a.device)
        text=generate(lm,tok,assembled["tokens"],a.max_tokens,a.temperature,stream=a.stream)
        print(json.dumps({"state":"SUCCESS","engine":"ForgeMultimodal+ForgeLM","text":text,"fusion":assembled,"evidence":evidence,"modalities":available,"externalModels":False,"networkRequired":False}))
    except Exception as e:
        print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False,"networkRequired":False}));raise SystemExit(1)
if __name__=="__main__":main()
