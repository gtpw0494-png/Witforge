import tempfile
from pathlib import Path
import torch
from forgelm import ByteActionTokenizer,ForgeConfig,ForgeLM,train_text
from capabilities import ForgeCapabilities

t=ByteActionTokenizer();s="hello <|act|> inspect <|end|>";assert t.decode(t.encode(s))==s
c=ForgeConfig(d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=48,num_experts=2,experts_per_token=1)
m=ForgeLM(c);x=torch.tensor([[1,2,3,4]],dtype=torch.long);logits,loss=m(x,x);assert logits.shape==(1,4,260) and loss is not None
emb=m.embed(x);assert emb.shape==(1,c.d_model);assert torch.allclose(emb.norm(dim=-1),torch.ones(1),atol=1e-5)
caps=ForgeCapabilities(m,t)
er=caps.embed_texts(["alpha","beta"]);assert er["state"]=="SUCCESS" and len(er["embeddings"])==2 and er["dimensions"]==c.d_model
rr=caps.rerank("alpha",["alpha","different"]);assert rr["state"]=="SUCCESS" and len(rr["results"])==2
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/"m.pt";r=train_text("one chat learns. <|act|> research <|obs|> verified <|end|>"*4,p,steps=8,config=c);assert p.exists();m2=ForgeLM.load(p);assert sum(p.numel() for p in m2.parameters())==r["parameters"]
print("ForgeLM neural tests passed")
