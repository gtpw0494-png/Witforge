"""ForgeLM: original decoder-only causal transformer implementation.

The implementation combines common, published transformer techniques in an
independently maintained local model. Reference repositories are tracked in the
project source registry; vendor source is not silently vendored into this file.
"""
from __future__ import annotations
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional
import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    from tokenizer_core import SPECIAL,ByteActionTokenizer
except ModuleNotFoundError:
    from model.tokenizer_core import SPECIAL,ByteActionTokenizer

@dataclass
class ForgeConfig:
    vocab_size:int=260
    d_model:int=64
    n_layers:int=2
    n_heads:int=4
    n_kv_heads:int=2
    d_ff:int=192
    max_seq_len:int=192
    rope_theta:float=10000.0
    rope_scale:float=1.0
    dropout:float=0.0
    num_experts:int=0
    experts_per_token:int=2
    cache_window:int=0
    router_aux_loss_coef:float=0.0
    future_loss_coef:float=0.0
    future_horizon:int=2

class RMSNorm(nn.Module):
    def __init__(self,dim,eps=1e-6): super().__init__();self.weight=nn.Parameter(torch.ones(dim));self.eps=eps
    def forward(self,x): return self.weight*x*torch.rsqrt(x.pow(2).mean(-1,keepdim=True)+self.eps)

def rotary(x,positions,theta,scale=1.0):
    d=x.shape[-1];assert d%2==0;half=d//2
    inv=1.0/(theta ** (torch.arange(0,half,device=x.device,dtype=torch.float32)/half))
    scaled=positions.to(torch.float32)/max(float(scale),1.0)
    ang=scaled[:,None]*inv[None,:]
    cos,sin=ang.cos().to(x.dtype)[None,None,:,:],ang.sin().to(x.dtype)[None,None,:,:]
    a,b=x[...,:half],x[...,half:]
    return torch.cat([a*cos-b*sin,a*sin+b*cos],dim=-1)

class CausalAttention(nn.Module):
    def __init__(self,c:ForgeConfig):
        super().__init__();assert c.d_model%c.n_heads==0 and c.n_heads%c.n_kv_heads==0
        self.h=c.n_heads;self.kv=c.n_kv_heads;self.hd=c.d_model//c.n_heads;self.theta=c.rope_theta;self.rope_scale=max(float(c.rope_scale),1.0);self.cache_window=c.cache_window
        self.q=nn.Linear(c.d_model,self.h*self.hd,bias=False);self.k=nn.Linear(c.d_model,self.kv*self.hd,bias=False);self.v=nn.Linear(c.d_model,self.kv*self.hd,bias=False);self.o=nn.Linear(c.d_model,c.d_model,bias=False);self.drop=c.dropout
    def forward(self,x,cache=None,start_pos=0,use_cache=False):
        B,T,_=x.shape
        q=self.q(x).view(B,T,self.h,self.hd).transpose(1,2)
        k=self.k(x).view(B,T,self.kv,self.hd).transpose(1,2)
        v=self.v(x).view(B,T,self.kv,self.hd).transpose(1,2)
        positions=torch.arange(start_pos,start_pos+T,device=x.device);q=rotary(q,positions,self.theta,self.rope_scale);k=rotary(k,positions,self.theta,self.rope_scale)
        offset=start_pos
        if cache is not None:
            oldk,oldv=cache["k"],cache["v"];offset=int(cache.get("offset",max(0,start_pos-oldk.shape[2])))
            k_all=torch.cat([oldk,k],dim=2);v_all=torch.cat([oldv,v],dim=2)
        else:k_all,v_all=k,v
        # Explicit absolute-position causal mask works for prefill and incremental decode.
        key_positions=torch.arange(offset,offset+k_all.shape[2],device=x.device)
        mask=(key_positions[None,:] <= positions[:,None])[None,None,:,:]
        k_att,v_att=k_all,v_all
        if self.kv!=self.h:
            rep=self.h//self.kv;k_att=k_att.repeat_interleave(rep,dim=1);v_att=v_att.repeat_interleave(rep,dim=1)
        y=F.scaled_dot_product_attention(q,k_att,v_att,attn_mask=mask,is_causal=False,dropout_p=self.drop if self.training else 0.0)
        new_cache=None
        if use_cache:
            ck,cv,co=k_all,v_all,offset
            if self.cache_window and ck.shape[2] > self.cache_window:
                drop=ck.shape[2]-self.cache_window;ck=ck[:,:,drop:,:];cv=cv[:,:,drop:,:];co+=drop
            new_cache={"k":ck,"v":cv,"offset":co}
        return self.o(y.transpose(1,2).contiguous().view(B,T,-1)),new_cache

class SwiGLU(nn.Module):
    def __init__(self,c):super().__init__();self.g=nn.Linear(c.d_model,c.d_ff,bias=False);self.u=nn.Linear(c.d_model,c.d_ff,bias=False);self.d=nn.Linear(c.d_ff,c.d_model,bias=False)
    def forward(self,x):return self.d(F.silu(self.g(x))*self.u(x))

class MoE(nn.Module):
    def __init__(self,c):
        super().__init__();self.router=nn.Linear(c.d_model,c.num_experts,bias=False);self.experts=nn.ModuleList([SwiGLU(c) for _ in range(c.num_experts)]);self.k=min(c.experts_per_token,c.num_experts);self.num_experts=c.num_experts;self.last_aux_loss=None
    def forward(self,x):
        score=F.softmax(self.router(x),dim=-1);vals,idx=torch.topk(score,self.k,dim=-1);vals=vals/vals.sum(-1,keepdim=True)
        # Differentiable importance x observed top-k traffic. This is an optional
        # balancing regularizer; routing remains sparse and locally inspectable.
        importance=score.mean(dim=(0,1));traffic=F.one_hot(idx,num_classes=self.num_experts).to(score.dtype).mean(dim=(0,1,2));self.last_aux_loss=self.num_experts*torch.sum(importance*traffic)
        out=torch.zeros_like(x)
        for ei,expert in enumerate(self.experts):
            mask=(idx==ei)
            if not mask.any():continue
            eout=expert(x);w=(vals*mask.to(vals.dtype)).sum(-1,keepdim=True);out=out+eout*w
        return out

class Block(nn.Module):
    def __init__(self,c):super().__init__();self.n1=RMSNorm(c.d_model);self.attn=CausalAttention(c);self.n2=RMSNorm(c.d_model);self.ff=MoE(c) if c.num_experts>0 else SwiGLU(c)
    def forward(self,x,cache=None,start_pos=0,use_cache=False):
        attn,new_cache=self.attn(self.n1(x),cache=cache,start_pos=start_pos,use_cache=use_cache);x=x+attn;return x+self.ff(self.n2(x)),new_cache

class ForgeLM(nn.Module):
    def __init__(self,c:ForgeConfig):
        super().__init__();self.config=c;self.emb=nn.Embedding(c.vocab_size,c.d_model);self.blocks=nn.ModuleList([Block(c) for _ in range(c.n_layers)]);self.norm=RMSNorm(c.d_model);self.future_head=nn.Linear(c.d_model,c.vocab_size,bias=False) if c.future_loss_coef>0 else None;self.last_loss_components={};self.apply(self._init)
    def _init(self,m):
        if isinstance(m,nn.Linear):nn.init.normal_(m.weight,mean=0,std=0.02)
        if isinstance(m,nn.Embedding):nn.init.normal_(m.weight,mean=0,std=0.02)
    def forward(self,ids,targets=None,cache=None,start_pos=0,use_cache=False):
        x=self.emb(ids);new_caches=[]
        caches=cache or [None]*len(self.blocks)
        if len(caches)!=len(self.blocks):raise ValueError("cache layer count mismatch")
        for i,b in enumerate(self.blocks):
            x,nc=b(x,caches[i],start_pos=start_pos,use_cache=use_cache);new_caches.append(nc)
        hidden=self.norm(x);logits=F.linear(hidden,self.emb.weight);loss=None;parts={}
        if targets is not None:
            ce=F.cross_entropy(logits.reshape(-1,logits.shape[-1]),targets.reshape(-1),ignore_index=-100);loss=ce;parts["nextToken"]=float(ce.detach())
            aux=[b.ff.last_aux_loss for b in self.blocks if isinstance(b.ff,MoE) and b.ff.last_aux_loss is not None]
            if aux and self.config.router_aux_loss_coef>0:
                router=torch.stack(aux).mean();loss=loss+self.config.router_aux_loss_coef*router;parts["routerBalance"]=float(router.detach());parts["routerWeight"]=self.config.router_aux_loss_coef
            shift=max(1,int(self.config.future_horizon)-1)
            if self.future_head is not None and hidden.shape[1]>shift:
                flogits=self.future_head(hidden[:,:-shift,:]);ftarget=targets[:,shift:];future=F.cross_entropy(flogits.reshape(-1,flogits.shape[-1]),ftarget.reshape(-1),ignore_index=-100);loss=loss+self.config.future_loss_coef*future;parts["futureToken"]=float(future.detach());parts["futureWeight"]=self.config.future_loss_coef;parts["futureHorizon"]=int(self.config.future_horizon)
            parts["total"]=float(loss.detach());self.last_loss_components=parts
        return (logits,loss,new_caches) if use_cache else (logits,loss)
    def hidden_states(self,ids):
        x=self.emb(ids)
        for b in self.blocks:
            x,_=b(x,cache=None,start_pos=0,use_cache=False)
        return self.norm(x)
    @torch.no_grad()
    def embed(self,ids,normalize=True):
        self.eval()
        ids=ids.to(next(self.parameters()).device)
        if ids.shape[1]==0: raise ValueError("embedding input must contain at least one token")
        hidden=self.hidden_states(ids[:,-self.config.max_seq_len:])
        pooled=hidden.mean(dim=1)
        return F.normalize(pooled,p=2,dim=-1) if normalize else pooled
    def _sample(self,logit,temperature=.8,top_k=40,top_p=1.0):
        if temperature is None or float(temperature)<=0:return torch.argmax(logit,dim=-1,keepdim=True)
        logit=logit/max(float(temperature),1e-5)
        if top_k:
            v,_=torch.topk(logit,min(int(top_k),logit.shape[-1]));logit=logit.masked_fill(logit<v[:,-1,None],-float("inf"))
        if top_p and float(top_p)<1.0:
            sorted_logits,sorted_idx=torch.sort(logit,descending=True);probs=F.softmax(sorted_logits,dim=-1);cum=torch.cumsum(probs,dim=-1)
            remove=cum>float(top_p);remove[...,1:]=remove[...,:-1].clone();remove[...,0]=False
            sorted_logits=sorted_logits.masked_fill(remove,-float("inf"));filtered=torch.full_like(logit,-float("inf")).scatter(-1,sorted_idx,sorted_logits);logit=filtered
        return torch.multinomial(F.softmax(logit,dim=-1),1)
    @torch.no_grad()
    def generate(self,ids,max_new_tokens=80,temperature=.8,top_k=40,top_p=1.0,use_cache=True,on_token=None):
        self.eval();ids=ids.to(next(self.parameters()).device)
        if ids.shape[1]==0:raise ValueError("prompt must contain at least one token")
        if not use_cache:
            for _ in range(max_new_tokens):
                x=ids[:,-self.config.max_seq_len:];logits,_=self(x);nxt=self._sample(logits[:,-1,:],temperature,top_k,top_p);ids=torch.cat([ids,nxt],1);token=int(nxt[0,0])
                if token!=SPECIAL["<|end|>"] and on_token is not None:on_token(token)
                if token==SPECIAL["<|end|>"]:break
            return ids
        prompt=ids[:,-self.config.max_seq_len:];start=max(0,ids.shape[1]-prompt.shape[1]);logits,_,cache=self(prompt,start_pos=start,use_cache=True)
        nxt=self._sample(logits[:,-1,:],temperature,top_k,top_p);ids=torch.cat([ids,nxt],1);position=start+prompt.shape[1];token=int(nxt[0,0])
        if token!=SPECIAL["<|end|>"] and on_token is not None:on_token(token)
        if token==SPECIAL["<|end|>"]:return ids
        for _ in range(max(0,max_new_tokens-1)):
            logits,_,cache=self(nxt,cache=cache,start_pos=position,use_cache=True);position+=1;nxt=self._sample(logits[:,-1,:],temperature,top_k,top_p);ids=torch.cat([ids,nxt],1);token=int(nxt[0,0])
            if token!=SPECIAL["<|end|>"] and on_token is not None:on_token(token)
            if token==SPECIAL["<|end|>"]:break
        return ids
    def save(self,path,metadata=None):
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);torch.save({"format":"ForgeLM-2","config":asdict(self.config),"state_dict":self.state_dict(),"metadata":metadata or {}},path)
    @classmethod
    def load(cls,path,device="cpu"):
        d=torch.load(path,map_location=device,weights_only=False);m=cls(ForgeConfig(**d["config"]));m.load_state_dict(d["state_dict"]);m.checkpoint_metadata=d.get("metadata",{});return m.to(device)

def make_training_tensor(text,tok,max_seq):
    ids=tok.encode(text)
    if len(ids)<2:ids += [SPECIAL["<|end|>"]]
    seq=[]
    for i in range(0,max(1,len(ids)-1),max_seq):
        chunk=ids[i:i+max_seq+1]
        if len(chunk)>1:seq.append(chunk)
    return seq

def train_text(text,checkpoint,steps=80,config:Optional[ForgeConfig]=None,lr=3e-3,device="cpu"):
    torch.manual_seed(7);tok=ByteActionTokenizer();c=config or ForgeConfig();m=ForgeLM(c).to(device);m.train();opt=torch.optim.AdamW(m.parameters(),lr=lr);seqs=make_training_tensor(text,tok,c.max_seq_len);losses=[]
    for step in range(int(steps)):
        chunk=seqs[step%len(seqs)];x=torch.tensor([chunk[:-1]],dtype=torch.long,device=device);y=torch.tensor([chunk[1:]],dtype=torch.long,device=device)
        _,loss=m(x,y);opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1.0);opt.step();losses.append(float(loss.detach()))
    m.save(checkpoint,metadata={"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1]})
    return {"steps":int(steps),"startLoss":losses[0],"endLoss":losses[-1],"checkpoint":str(checkpoint),"parameters":sum(p.numel() for p in m.parameters())}
