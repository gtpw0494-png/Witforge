"""ForgeAudio: native audio encoder/projector for ForgeLM.

This local model converts waveform audio into ForgeLM-space tokens using a
log-spectral frontend plus trainable convolution/transformer blocks. No network,
external speech model, or provider API is used.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any
import math
import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ForgeAudioConfig:
    sample_rate: int = 16000
    n_fft: int = 400
    hop_length: int = 160
    win_length: int = 400
    freq_bins: int = 201
    audio_dim: int = 128
    audio_layers: int = 2
    audio_heads: int = 4
    output_dim: int = 64
    max_frames: int = 1000
    dropout: float = 0.0


class AudioBlock(nn.Module):
    def __init__(self,c:ForgeAudioConfig):
        super().__init__()
        self.n1=nn.LayerNorm(c.audio_dim)
        self.attn=nn.MultiheadAttention(c.audio_dim,c.audio_heads,dropout=c.dropout,batch_first=True)
        self.n2=nn.LayerNorm(c.audio_dim)
        self.ff=nn.Sequential(nn.Linear(c.audio_dim,c.audio_dim*4),nn.GELU(),nn.Linear(c.audio_dim*4,c.audio_dim))
    def forward(self,x):
        h=self.n1(x);a,_=self.attn(h,h,h,need_weights=False);x=x+a
        return x+self.ff(self.n2(x))


class ForgeAudioEncoder(nn.Module):
    def __init__(self,c:ForgeAudioConfig):
        super().__init__()
        self.config=c
        self.front=nn.Sequential(
            nn.Conv1d(c.freq_bins,c.audio_dim,kernel_size=3,stride=2,padding=1,bias=False),
            nn.GELU(),
            nn.Conv1d(c.audio_dim,c.audio_dim,kernel_size=3,stride=2,padding=1,bias=False),
            nn.GELU(),
        )
        self.cls=nn.Parameter(torch.zeros(1,1,c.audio_dim))
        max_tokens=max(2,math.ceil(c.max_frames/4)+1)
        self.pos=nn.Parameter(torch.zeros(1,max_tokens,c.audio_dim))
        self.blocks=nn.ModuleList([AudioBlock(c) for _ in range(c.audio_layers)])
        self.norm=nn.LayerNorm(c.audio_dim)
        self.projector=nn.Sequential(nn.Linear(c.audio_dim,c.output_dim*2),nn.GELU(),nn.Linear(c.output_dim*2,c.output_dim))
        self._init()

    def _init(self):
        nn.init.normal_(self.cls,std=0.02);nn.init.normal_(self.pos,std=0.02)
        for m in self.modules():
            if isinstance(m,(nn.Linear,nn.Conv1d)):
                nn.init.normal_(m.weight,std=0.02)
                if getattr(m,"bias",None) is not None: nn.init.zeros_(m.bias)

    def spectrogram(self,waveform:torch.Tensor)->torch.Tensor:
        if waveform.ndim==1: waveform=waveform.unsqueeze(0)
        if waveform.ndim==3 and waveform.shape[1]==1: waveform=waveform[:,0,:]
        if waveform.ndim!=2: raise ValueError("waveform must have shape [T], [B,T], or [B,1,T]")
        waveform=waveform.to(dtype=torch.float32)
        if waveform.shape[-1] < self.config.n_fft:
            waveform=F.pad(waveform,(0,self.config.n_fft-waveform.shape[-1]))
        peak=waveform.abs().amax(dim=-1,keepdim=True).clamp_min(1.0)
        waveform=waveform/peak
        window=torch.hann_window(self.config.win_length,device=waveform.device,dtype=waveform.dtype)
        spec=torch.stft(waveform,n_fft=self.config.n_fft,hop_length=self.config.hop_length,win_length=self.config.win_length,window=window,return_complex=True)
        mag=spec.abs().clamp_min(1e-5).log1p()
        if mag.shape[1]!=self.config.freq_bins:
            mag=mag[:,:self.config.freq_bins,:]
        return mag[:,:,:self.config.max_frames]

    def forward(self,waveform:torch.Tensor,*,include_cls:bool=True)->torch.Tensor:
        x=self.front(self.spectrogram(waveform)).transpose(1,2)
        cls=self.cls.expand(x.shape[0],-1,-1);x=torch.cat([cls,x],dim=1)
        if x.shape[1]>self.pos.shape[1]: x=x[:,:self.pos.shape[1],:]
        x=x+self.pos[:,:x.shape[1],:]
        for b in self.blocks:x=b(x)
        x=self.projector(self.norm(x))
        return x if include_cls else x[:,1:,:]

    @torch.no_grad()
    def embed(self,waveform:torch.Tensor)->torch.Tensor:
        self.eval();tokens=self(waveform);return F.normalize(tokens.mean(dim=1),p=2,dim=-1)

    def save(self,path:str|Path,metadata:dict[str,Any]|None=None):
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        torch.save({"format":"ForgeAudio-1","config":asdict(self.config),"state_dict":self.state_dict(),"metadata":metadata or {}},path)

    @classmethod
    def load(cls,path:str|Path,device="cpu"):
        d=torch.load(path,map_location=device,weights_only=False)
        if d.get("format")!="ForgeAudio-1": raise ValueError("unsupported ForgeAudio checkpoint")
        m=cls(ForgeAudioConfig(**d["config"]));m.load_state_dict(d["state_dict"]);m.checkpoint_metadata=d.get("metadata",{})
        return m.to(device)


class ForgeAudioAdapter(nn.Module):
    def __init__(self,audio:ForgeAudioEncoder,language_dim:int):
        super().__init__();self.audio=audio;self.language_dim=int(language_dim)
        self.adapter=nn.Identity() if audio.config.output_dim==self.language_dim else nn.Linear(audio.config.output_dim,self.language_dim,bias=False)
    def forward(self,waveform:torch.Tensor)->torch.Tensor:return self.adapter(self.audio(waveform))


__all__=["ForgeAudioConfig","ForgeAudioEncoder","ForgeAudioAdapter"]
