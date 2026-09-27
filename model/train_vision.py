#!/usr/bin/env python3
"""Train ForgeVision against ForgeLM's native text embedding space.

Input JSONL rows:
  {"image":"relative/or/absolute/path.png","text":"caption"}

Pillow is used only as an image decoder. No external AI/model service is used.
"""
from __future__ import annotations
import argparse, json, random, time
from pathlib import Path
import torch
import torch.nn.functional as F

try:
    from PIL import Image
except Exception:
    Image = None

try:
    from forgelm import ForgeLM, ByteActionTokenizer
    from tokenizer import load_tokenizer
    from vision import ForgeVisionConfig, ForgeVisionEncoder, ForgeMultimodalAdapter
except ModuleNotFoundError:
    from model.forgelm import ForgeLM, ByteActionTokenizer
    from model.tokenizer import load_tokenizer
    from model.vision import ForgeVisionConfig, ForgeVisionEncoder, ForgeMultimodalAdapter

ROOT=Path(__file__).resolve().parent
LM_CKPT=ROOT/"checkpoints"/"forgelm-seed.pt"
VISION_RUNS=ROOT/"runs"

def load_rows(path: Path):
    rows=[]
    base=path.parent
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip(): continue
        row=json.loads(line)
        image=Path(row["image"])
        if not image.is_absolute(): image=base/image
        text=str(row.get("text") or row.get("caption") or "").strip()
        if image.exists() and text: rows.append((image,text))
    return rows

def load_rgb(path: Path, size: int):
    if Image is None:
        raise RuntimeError("Pillow is required to decode training images: python3 -m pip install pillow")
    img=Image.open(path).convert("RGB").resize((size,size))
    data=torch.tensor(list(img.getdata()),dtype=torch.float32).view(size,size,3).permute(2,0,1)/255.0
    return data

@torch.no_grad()
def text_embedding(model,tok,text,device):
    ids=tok.encode(text)[:model.config.max_seq_len] or [0]
    x=torch.tensor([ids],dtype=torch.long,device=device)
    return model.embed(x)[0]

def train(dataset: Path, *, steps=100, lr=1e-3, image_size=224, patch_size=16, vision_dim=128, layers=2, heads=4, device=None, run_name=None):
    if not LM_CKPT.exists():
        raise RuntimeError("A promoted ForgeLM checkpoint is required before native vision-language alignment training.")
    rows=load_rows(dataset)
    if not rows:
        raise RuntimeError("No valid image-caption training rows found.")
    device=device or ("cuda" if torch.cuda.is_available() else "cpu")
    lm=ForgeLM.load(LM_CKPT,device=device).eval()
    meta=getattr(lm,"checkpoint_metadata",{}) or {}
    spec=(meta.get("tokenizer") or {}).get("path")
    tok=load_tokenizer(spec) if spec else ByteActionTokenizer()
    vc=ForgeVisionConfig(image_size=image_size,patch_size=patch_size,vision_dim=vision_dim,vision_layers=layers,vision_heads=heads,output_dim=lm.config.d_model)
    vision=ForgeVisionEncoder(vc).to(device)
    adapter=ForgeMultimodalAdapter(vision,lm.config.d_model).to(device)
    opt=torch.optim.AdamW(adapter.parameters(),lr=lr)
    random.seed(7); torch.manual_seed(7)
    losses=[]
    adapter.train()
    for step in range(int(steps)):
        image_path,text=rows[step%len(rows)]
        image=load_rgb(image_path,image_size).unsqueeze(0).to(device)
        target=text_embedding(lm,tok,text,device).unsqueeze(0)
        pred=F.normalize(adapter(image).mean(dim=1),p=2,dim=-1)
        target=F.normalize(target,p=2,dim=-1)
        cosine=1-F.cosine_similarity(pred,target,dim=-1).mean()
        # Keep projected token magnitudes bounded as training begins.
        reg=0.001*adapter(image).pow(2).mean()
        loss=cosine+reg
        opt.zero_grad(set_to_none=True);loss.backward();torch.nn.utils.clip_grad_norm_(adapter.parameters(),1.0);opt.step()
        losses.append(float(loss.detach()))
    run_name=run_name or f"vision-{int(time.time())}"
    out_dir=VISION_RUNS/run_name;out_dir.mkdir(parents=True,exist_ok=True)
    ckpt=out_dir/"forgevision.pt"
    vision.save(ckpt,metadata={
        "format":"forgevision-training-run-v1",
        "dataset":str(dataset),
        "steps":int(steps),
        "startLoss":losses[0],
        "endLoss":losses[-1],
        "languageCheckpoint":str(LM_CKPT),
        "languageDim":lm.config.d_model,
        "externalModels":False,
    })
    result={"state":"SUCCESS","checkpoint":str(ckpt),"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1],"rows":len(rows),"externalModels":False,"promoted":False}
    (out_dir/"vision-run.json").write_text(json.dumps(result,indent=2))
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dataset",type=Path,required=True)
    p.add_argument("--steps",type=int,default=100)
    p.add_argument("--lr",type=float,default=1e-3)
    p.add_argument("--image-size",type=int,default=224)
    p.add_argument("--patch-size",type=int,default=16)
    p.add_argument("--vision-dim",type=int,default=128)
    p.add_argument("--layers",type=int,default=2)
    p.add_argument("--heads",type=int,default=4)
    p.add_argument("--device")
    p.add_argument("--run-name")
    a=p.parse_args()
    try:
        print(json.dumps(train(a.dataset,steps=a.steps,lr=a.lr,image_size=a.image_size,patch_size=a.patch_size,vision_dim=a.vision_dim,layers=a.layers,heads=a.heads,device=a.device,run_name=a.run_name)))
    except Exception as e:
        print(json.dumps({"state":"FAILURE","message":str(e),"externalModels":False}))
        raise SystemExit(1)

if __name__=="__main__":
    main()
