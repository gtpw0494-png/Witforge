#!/usr/bin/env python3
"""Native ForgeVision -> ForgeLM multimodal inference runtime.

A promoted ForgeVision checkpoint is mandatory. Visual tokens are projected into
ForgeLM hidden space, concatenated with prompt token embeddings, and prefilled
through the same ForgeLM transformer/cache used for text generation.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path
import torch
import torch.nn.functional as F

try:
    from PIL import Image
except Exception:
    Image=None

try:
    from forgelm import ForgeLM, ByteActionTokenizer, SPECIAL
    from tokenizer import load_tokenizer
    from vision import ForgeVisionEncoder
except ModuleNotFoundError:
    from model.forgelm import ForgeLM, ByteActionTokenizer, SPECIAL
    from model.tokenizer import load_tokenizer
    from model.vision import ForgeVisionEncoder

ROOT=Path(__file__).resolve().parent
LM_CKPT=ROOT/"checkpoints"/"forgelm-seed.pt"
VISION_CKPT=ROOT/"checkpoints"/"forgevision.pt"

def load_rgb(path,size,device):
    if Image is None: raise RuntimeError("Pillow is required for local image decoding.")
    img=Image.open(path).convert("RGB").resize((size,size))
    x=torch.tensor(list(img.getdata()),dtype=torch.float32).view(size,size,3).permute(2,0,1)/255.0
    return x.unsqueeze(0).to(device)

def load_runtime(device="cpu"):
    if not LM_CKPT.exists(): raise RuntimeError("No promoted ForgeLM checkpoint exists.")
    if not VISION_CKPT.exists(): raise RuntimeError("No promoted ForgeVision checkpoint exists.")
    lm=ForgeLM.load(LM_CKPT,device=device).eval()
    vision=ForgeVisionEncoder.load(VISION_CKPT,device=device).eval()
    if vision.config.output_dim!=lm.config.d_model:
        raise RuntimeError(f"ForgeVision output_dim {vision.config.output_dim} does not match ForgeLM d_model {lm.config.d_model}.")
    meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path")
    tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    return lm,vision,tok

@torch.no_grad()
def generate_multimodal(lm,vision,tok,image,prompt,max_new_tokens=96,temperature=0.2,top_k=40,top_p=0.95):
    device=next(lm.parameters()).device
    visual=vision(image.to(device))
    prompt_ids=tok.encode(str(prompt or "Describe the image.")) or [SPECIAL["<|act|>"]]
    # Keep prompt bounded while reserving space for visual prefix.
    max_prompt=max(1,lm.config.max_seq_len-visual.shape[1])
    prompt_ids=prompt_ids[-max_prompt:]
    ids=torch.tensor([prompt_ids],dtype=torch.long,device=device)
    x=torch.cat([visual,lm.emb(ids)],dim=1)
    if x.shape[1]>lm.config.max_seq_len:
        x=x[:,-lm.config.max_seq_len:,:]
    caches=[];hidden=x
    for block in lm.blocks:
        hidden,cache=block(hidden,cache=None,start_pos=0,use_cache=True);caches.append(cache)
    hidden=lm.norm(hidden);logits=F.linear(hidden,lm.emb.weight)
    nxt=lm._sample(logits[:,-1,:],temperature,top_k,top_p)
    generated=[int(nxt[0,0])]
    position=x.shape[1]
    if generated[-1]==SPECIAL["<|end|>"]: return tok.decode(generated)
    for _ in range(max(0,int(max_new_tokens)-1)):
        logits,_,caches=lm(nxt,cache=caches,start_pos=position,use_cache=True)
        position+=1
        nxt=lm._sample(logits[:,-1,:],temperature,top_k,top_p)
        token=int(nxt[0,0]);generated.append(token)
        if token==SPECIAL["<|end|>"]: break
    return tok.decode(generated).strip()

def status():
    base={"engine":"ForgeVision+ForgeLM","externalModels":False,"networkRequired":False,"languageCheckpointExists":LM_CKPT.exists(),"visionCheckpointExists":VISION_CKPT.exists()}
    if not LM_CKPT.exists() or not VISION_CKPT.exists():
        return {"state":"UNAVAILABLE",**base,"message":"Both promoted ForgeLM and ForgeVision checkpoints are required."}
    try:
        lm,vision,_=load_runtime("cpu")
        return {"state":"CONNECTED",**base,"visionOutputDim":vision.config.output_dim,"languageDim":lm.config.d_model,"imageSize":vision.config.image_size,"message":"Native multimodal runtime loaded successfully."}
    except Exception as e:
        return {"state":"FAILURE",**base,"message":str(e)}

def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest="cmd",required=True)
    sub.add_parser("status")
    d=sub.add_parser("describe");d.add_argument("--image",required=True);d.add_argument("--prompt",default="Describe the image using only what the visual evidence supports.");d.add_argument("--max-tokens",type=int,default=96);d.add_argument("--temperature",type=float,default=0.2);d.add_argument("--device",default="cpu")
    a=p.parse_args()
    if a.cmd=="status": print(json.dumps(status()));return
    try:
        lm,vision,tok=load_runtime(a.device)
        image=load_rgb(Path(a.image),vision.config.image_size,next(lm.parameters()).device)
        text=generate_multimodal(lm,vision,tok,image,a.prompt,a.max_tokens,a.temperature)
        print(json.dumps({"state":"SUCCESS","engine":"ForgeVision+ForgeLM","text":text,"image":str(Path(a.image)),"externalModels":False,"networkRequired":False}))
    except Exception as e:
        print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False,"networkRequired":False}))
        raise SystemExit(1)

if __name__=="__main__": main()
