#!/usr/bin/env python3
"""Train ForgeVideo from local video/text pairs.

JSONL rows:
  {"video":"clip.mp4","text":"a person opens a door"}

Frames are extracted locally with ffmpeg when available. No external AI model is used.
"""
from __future__ import annotations
import argparse,json,subprocess,tempfile
from pathlib import Path
import torch
import torch.nn.functional as F

try:
    from PIL import Image
except Exception:
    Image=None

try:
    from forgelm import ForgeLM,ByteActionTokenizer
    from tokenizer import load_tokenizer
    from video import ForgeVideoConfig,ForgeVideoEncoder
except ModuleNotFoundError:
    from model.forgelm import ForgeLM,ByteActionTokenizer
    from model.tokenizer import load_tokenizer
    from model.video import ForgeVideoConfig,ForgeVideoEncoder

ROOT=Path(__file__).resolve().parent
LM_CKPT=ROOT/"checkpoints"/"forgelm-seed.pt"
RUNS=ROOT/"runs"

def rows(path):
    base=path.parent;out=[]
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():continue
        r=json.loads(line);p=Path(r["video"])
        if not p.is_absolute():p=base/p
        text=str(r.get("text") or r.get("caption") or "").strip()
        if p.exists() and text:out.append((p,text))
    return out

def extract_frames(video:Path,count:int,size:int):
    if Image is None:raise RuntimeError("Pillow is required for ForgeVideo frame decoding.")
    with tempfile.TemporaryDirectory() as d:
        pattern=str(Path(d)/"%04d.png")
        cmd=["ffmpeg","-v","error","-i",str(video),"-vf",f"fps={count}/10,scale={size}:{size}:force_original_aspect_ratio=decrease,pad={size}:{size}:(ow-iw)/2:(oh-ih)/2","-frames:v",str(count),pattern]
        try:subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        except FileNotFoundError:raise RuntimeError("ffmpeg is required for local video frame extraction.")
        except subprocess.CalledProcessError as e:raise RuntimeError((e.stderr or b"ffmpeg failed").decode("utf-8","ignore")[:1000])
        files=sorted(Path(d).glob("*.png"))
        if not files:raise RuntimeError("No video frames could be extracted.")
        frames=[]
        for p in files[:count]:
            img=Image.open(p).convert("RGB").resize((size,size))
            frames.append(torch.tensor(list(img.getdata()),dtype=torch.float32).view(size,size,3).permute(2,0,1)/255.0)
        while len(frames)<count:frames.append(frames[-1].clone())
        return torch.stack(frames)

@torch.no_grad()
def text_embed(lm,tok,text,device):
    ids=tok.encode(text)[:lm.config.max_seq_len] or [0]
    return lm.embed(torch.tensor([ids],dtype=torch.long,device=device))[0]

def train(dataset,steps=100,lr=1e-3,frames=8,frame_size=112,temporal_dim=128,layers=2,heads=4,device=None,run_name=None):
    if not LM_CKPT.exists():raise RuntimeError("A promoted ForgeLM checkpoint is required.")
    data=rows(Path(dataset))
    if not data:raise RuntimeError("No valid video-text rows found.")
    device=device or ("cuda" if torch.cuda.is_available() else "cpu")
    lm=ForgeLM.load(LM_CKPT,device=device).eval();meta=getattr(lm,"checkpoint_metadata",{}) or {};spec=(meta.get("tokenizer") or {}).get("path");tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    cfg=ForgeVideoConfig(frames=frames,frame_size=frame_size,temporal_dim=temporal_dim,temporal_layers=layers,temporal_heads=heads,output_dim=lm.config.d_model)
    model=ForgeVideoEncoder(cfg).to(device);opt=torch.optim.AdamW(model.parameters(),lr=lr);losses=[];torch.manual_seed(7)
    for step in range(int(steps)):
        p,text=data[step%len(data)];x=extract_frames(p,frames,frame_size).unsqueeze(0).to(device);target=text_embed(lm,tok,text,device).unsqueeze(0)
        pred=F.normalize(model(x).mean(dim=1),p=2,dim=-1);target=F.normalize(target,p=2,dim=-1);loss=1-F.cosine_similarity(pred,target,dim=-1).mean()
        opt.zero_grad(set_to_none=True);loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1.0);opt.step();losses.append(float(loss.detach()))
    run_name=run_name or "video-candidate";out=RUNS/run_name;out.mkdir(parents=True,exist_ok=True);ckpt=out/"forgevideo.pt"
    model.save(ckpt,metadata={"dataset":str(dataset),"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1],"languageDim":lm.config.d_model,"externalModels":False})
    result={"state":"SUCCESS","checkpoint":str(ckpt),"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1],"rows":len(data),"externalModels":False,"promoted":False}
    (out/"video-run.json").write_text(json.dumps(result,indent=2));return result

def main():
    p=argparse.ArgumentParser();p.add_argument("--dataset",type=Path,required=True);p.add_argument("--steps",type=int,default=100);p.add_argument("--lr",type=float,default=1e-3);p.add_argument("--frames",type=int,default=8);p.add_argument("--frame-size",type=int,default=112);p.add_argument("--temporal-dim",type=int,default=128);p.add_argument("--layers",type=int,default=2);p.add_argument("--heads",type=int,default=4);p.add_argument("--device");p.add_argument("--run-name");a=p.parse_args()
    try:print(json.dumps(train(a.dataset,a.steps,a.lr,a.frames,a.frame_size,a.temporal_dim,a.layers,a.heads,a.device,a.run_name)))
    except Exception as e:print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False}));raise SystemExit(1)
if __name__=="__main__":main()
