"""ForgeSpeech: native ForgeLM-conditioned waveform generator.

This is an independently implemented local TTS foundation. It maps ForgeLM text
embeddings to waveform samples through a trainable temporal decoder. It does not
use an external TTS model, speaker-cloning service, or cloud API.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any
import torch
import torch.nn as nn


@dataclass
class ForgeSpeechConfig:
    sample_rate:int=16000
    text_dim:int=64
    hidden_dim:int=128
    seed_frames:int=32
    upsample_stages:int=5
    channels:int=128
    max_samples:int=32000


class Residual1D(nn.Module):
    def __init__(self,c):
        super().__init__();self.net=nn.Sequential(nn.Conv1d(c,c,3,padding=1),nn.GELU(),nn.Conv1d(c,c,3,padding=1))
    def forward(self,x):return x+self.net(x)


class ForgeSpeech(nn.Module):
    def __init__(self,c:ForgeSpeechConfig):
        super().__init__();self.config=c
        self.condition=nn.Sequential(nn.Linear(c.text_dim,c.hidden_dim),nn.GELU(),nn.Linear(c.hidden_dim,c.channels*c.seed_frames))
        blocks=[]
        ch=c.channels
        for _ in range(c.upsample_stages):
            nxt=max(16,ch//2)
            blocks.extend([nn.ConvTranspose1d(ch,nxt,kernel_size=8,stride=4,padding=2),nn.GELU(),Residual1D(nxt)])
            ch=nxt
        self.decoder=nn.Sequential(*blocks)
        self.out=nn.Sequential(nn.Conv1d(ch,1,7,padding=3),nn.Tanh())
        self._init()

    def _init(self):
        for m in self.modules():
            if isinstance(m,(nn.Linear,nn.Conv1d,nn.ConvTranspose1d)):
                nn.init.normal_(m.weight,std=0.02)
                if getattr(m,"bias",None) is not None:nn.init.zeros_(m.bias)

    def forward(self,text_embedding:torch.Tensor,target_samples:int|None=None)->torch.Tensor:
        if text_embedding.ndim==1:text_embedding=text_embedding.unsqueeze(0)
        x=self.condition(text_embedding).view(text_embedding.shape[0],self.config.channels,self.config.seed_frames)
        x=self.decoder(x);wav=self.out(x)[:,0,:]
        limit=min(int(target_samples or wav.shape[-1]),self.config.max_samples)
        if wav.shape[-1]<limit:
            wav=torch.nn.functional.pad(wav,(0,limit-wav.shape[-1]))
        return wav[:,:limit]

    def save(self,path:str|Path,metadata:dict[str,Any]|None=None):
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        torch.save({"format":"ForgeSpeech-1","config":asdict(self.config),"state_dict":self.state_dict(),"metadata":metadata or {}},path)

    @classmethod
    def load(cls,path:str|Path,device="cpu"):
        d=torch.load(path,map_location=device,weights_only=False)
        if d.get("format")!="ForgeSpeech-1":raise ValueError("unsupported ForgeSpeech checkpoint")
        m=cls(ForgeSpeechConfig(**d["config"]));m.load_state_dict(d["state_dict"]);m.checkpoint_metadata=d.get("metadata",{})
        return m.to(device)


__all__=["ForgeSpeechConfig","ForgeSpeech"]
