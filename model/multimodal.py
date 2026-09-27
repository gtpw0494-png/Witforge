"""ForgeMultimodal fusion primitives.

Two layers are intentionally separate:
1. FusionAssembler: deterministic, parameter-free token budgeting/concatenation that
   can be used immediately with promoted modality encoders.
2. ForgeFusion: optional trainable cross-modal transformer. Its mere presence never
   implies a promoted fusion checkpoint exists or improves semantic quality.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any
import torch
import torch.nn as nn


MODALITY_IDS={"text":0,"context":1,"image":2,"audio":3,"video":4,"document":5}


@dataclass
class FusionBudget:
    max_tokens:int=256
    text_tokens:int=96
    context_tokens:int=64
    image_tokens:int=32
    audio_tokens:int=32
    video_tokens:int=32
    document_tokens:int=48


class FusionAssembler:
    def __init__(self,budget:FusionBudget|None=None):
        self.budget=budget or FusionBudget()

    def _limit(self,name,tokens):
        if tokens is None:return None
        if tokens.ndim==2:tokens=tokens.unsqueeze(0)
        if tokens.ndim!=3:raise ValueError(f"{name} tokens must have shape [B,T,D] or [T,D]")
        cap=int(getattr(self.budget,f"{name}_tokens",self.budget.max_tokens))
        if tokens.shape[1]<=cap:return tokens
        idx=torch.linspace(0,tokens.shape[1]-1,cap,device=tokens.device).round().long()
        return tokens[:,idx,:]

    def assemble(self,**modalities):
        ordered=[]
        metadata=[]
        batch=None;dim=None
        for name in ("image","audio","video","document","context","text"):
            t=self._limit(name,modalities.get(name))
            if t is None:continue
            if batch is None:batch,dim=t.shape[0],t.shape[2]
            if t.shape[0]!=batch or t.shape[2]!=dim:raise ValueError("all modality tokens must share batch size and hidden dimension")
            ordered.append(t)
            metadata.append({"modality":name,"tokens":int(t.shape[1])})
        if not ordered:raise ValueError("at least one modality token sequence is required")
        fused=torch.cat(ordered,dim=1)
        if fused.shape[1]>self.budget.max_tokens:
            # Preserve broad temporal/source coverage across the complete sequence.
            idx=torch.linspace(0,fused.shape[1]-1,self.budget.max_tokens,device=fused.device).round().long()
            fused=fused[:,idx,:]
        return {"tokens":fused,"modalities":metadata,"totalTokens":int(fused.shape[1]),"hiddenDim":int(fused.shape[2]),"parameterFree":True}


@dataclass
class ForgeFusionConfig:
    hidden_dim:int=64
    layers:int=2
    heads:int=4
    max_tokens:int=256
    dropout:float=0.0


class FusionBlock(nn.Module):
    def __init__(self,c:ForgeFusionConfig):
        super().__init__()
        self.n1=nn.LayerNorm(c.hidden_dim)
        self.attn=nn.MultiheadAttention(c.hidden_dim,c.heads,dropout=c.dropout,batch_first=True)
        self.n2=nn.LayerNorm(c.hidden_dim)
        self.ff=nn.Sequential(nn.Linear(c.hidden_dim,c.hidden_dim*4),nn.GELU(),nn.Linear(c.hidden_dim*4,c.hidden_dim))
    def forward(self,x):
        h=self.n1(x);a,_=self.attn(h,h,h,need_weights=False);x=x+a
        return x+self.ff(self.n2(x))


class ForgeFusion(nn.Module):
    def __init__(self,c:ForgeFusionConfig):
        super().__init__();self.config=c
        self.type_emb=nn.Embedding(len(MODALITY_IDS),c.hidden_dim)
        self.pos=nn.Parameter(torch.zeros(1,c.max_tokens,c.hidden_dim))
        self.blocks=nn.ModuleList([FusionBlock(c) for _ in range(c.layers)])
        self.norm=nn.LayerNorm(c.hidden_dim)
        nn.init.normal_(self.type_emb.weight,std=0.02);nn.init.normal_(self.pos,std=0.02)

    def forward(self,tokens:torch.Tensor,modality_ids:torch.Tensor|None=None):
        if tokens.ndim!=3:raise ValueError("tokens must have shape [B,T,D]")
        if tokens.shape[-1]!=self.config.hidden_dim:raise ValueError("token hidden dimension does not match fusion config")
        if tokens.shape[1]>self.config.max_tokens:tokens=tokens[:,:self.config.max_tokens,:]
        B,T,_=tokens.shape
        if modality_ids is None:modality_ids=torch.zeros((B,T),dtype=torch.long,device=tokens.device)
        if modality_ids.ndim==1:modality_ids=modality_ids.unsqueeze(0).expand(B,-1)
        x=tokens+self.type_emb(modality_ids[:,:T])+self.pos[:,:T,:]
        for b in self.blocks:x=b(x)
        return self.norm(x)

    def save(self,path:str|Path,metadata:dict[str,Any]|None=None):
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        torch.save({"format":"ForgeFusion-1","config":asdict(self.config),"state_dict":self.state_dict(),"metadata":metadata or {}},path)

    @classmethod
    def load(cls,path:str|Path,device="cpu"):
        d=torch.load(path,map_location=device,weights_only=False)
        if d.get("format")!="ForgeFusion-1":raise ValueError("unsupported ForgeFusion checkpoint")
        m=cls(ForgeFusionConfig(**d["config"]));m.load_state_dict(d["state_dict"]);m.checkpoint_metadata=d.get("metadata",{})
        return m.to(device)


__all__=["FusionBudget","FusionAssembler","ForgeFusionConfig","ForgeFusion","MODALITY_IDS"]
