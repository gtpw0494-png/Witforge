"""ForgeVideo: native temporal video encoder for ForgeLM.

Reuses ForgeVision to encode individual RGB frames, then models temporal relations
with local transformer blocks and projects sequence tokens into ForgeLM space.
No external video model or provider API is used.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any
import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    from vision import ForgeVisionConfig, ForgeVisionEncoder
except ModuleNotFoundError:
    from model.vision import ForgeVisionConfig, ForgeVisionEncoder


@dataclass
class ForgeVideoConfig:
    frames:int=8
    frame_size:int=112
    frame_patch:int=16
    vision_dim:int=96
    vision_layers:int=1
    vision_heads:int=4
    temporal_dim:int=128
    temporal_layers:int=2
    temporal_heads:int=4
    output_dim:int=64
    dropout:float=0.0


class TemporalBlock(nn.Module):
    def __init__(self,c:ForgeVideoConfig):
        super().__init__()
        self.n1=nn.LayerNorm(c.temporal_dim)
        self.attn=nn.MultiheadAttention(c.temporal_dim,c.temporal_heads,dropout=c.dropout,batch_first=True)
        self.n2=nn.LayerNorm(c.temporal_dim)
        self.ff=nn.Sequential(nn.Linear(c.temporal_dim,c.temporal_dim*4),nn.GELU(),nn.Linear(c.temporal_dim*4,c.temporal_dim))
    def forward(self,x):
        h=self.n1(x);a,_=self.attn(h,h,h,need_weights=False);x=x+a
        return x+self.ff(self.n2(x))


class ForgeVideoEncoder(nn.Module):
    def __init__(self,c:ForgeVideoConfig):
        super().__init__();self.config=c
        vc=ForgeVisionConfig(image_size=c.frame_size,patch_size=c.frame_patch,vision_dim=c.vision_dim,vision_layers=c.vision_layers,vision_heads=c.vision_heads,output_dim=c.temporal_dim,dropout=c.dropout)
        self.frame_encoder=ForgeVisionEncoder(vc)
        self.pos=nn.Parameter(torch.zeros(1,c.frames,c.temporal_dim))
        self.blocks=nn.ModuleList([TemporalBlock(c) for _ in range(c.temporal_layers)])
        self.norm=nn.LayerNorm(c.temporal_dim)
        self.projector=nn.Sequential(nn.Linear(c.temporal_dim,c.output_dim*2),nn.GELU(),nn.Linear(c.output_dim*2,c.output_dim))
        nn.init.normal_(self.pos,std=0.02)

    def _normalize_frames(self,frames:torch.Tensor)->torch.Tensor:
        if frames.ndim==4: frames=frames.unsqueeze(0)
        if frames.ndim!=5 or frames.shape[2]!=3: raise ValueError("frames must have shape [B,F,3,H,W] or [F,3,H,W]")
        if frames.shape[1]>self.config.frames:
            idx=torch.linspace(0,frames.shape[1]-1,self.config.frames,device=frames.device).round().long()
            frames=frames[:,idx]
        elif frames.shape[1]<self.config.frames:
            pad=self.config.frames-frames.shape[1]
            last=frames[:,-1:].expand(-1,pad,-1,-1,-1)
            frames=torch.cat([frames,last],dim=1)
        return frames

    def forward(self,frames:torch.Tensor)->torch.Tensor:
        frames=self._normalize_frames(frames)
        B,F,C,H,W=frames.shape
        flat=frames.reshape(B*F,C,H,W)
        ftok=self.frame_encoder(flat)
        pooled=ftok.mean(dim=1).view(B,F,-1)
        x=pooled+self.pos[:,:F,:]
        for b in self.blocks:x=b(x)
        return self.projector(self.norm(x))

    @torch.no_grad()
    def embed(self,frames:torch.Tensor)->torch.Tensor:
        self.eval();tokens=self(frames);return F.normalize(tokens.mean(dim=1),p=2,dim=-1)

    def save(self,path:str|Path,metadata:dict[str,Any]|None=None):
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        torch.save({"format":"ForgeVideo-1","config":asdict(self.config),"state_dict":self.state_dict(),"metadata":metadata or {}},path)

    @classmethod
    def load(cls,path:str|Path,device="cpu"):
        d=torch.load(path,map_location=device,weights_only=False)
        if d.get("format")!="ForgeVideo-1":raise ValueError("unsupported ForgeVideo checkpoint")
        m=cls(ForgeVideoConfig(**d["config"]));m.load_state_dict(d["state_dict"]);m.checkpoint_metadata=d.get("metadata",{})
        return m.to(device)


__all__=["ForgeVideoConfig","ForgeVideoEncoder"]
