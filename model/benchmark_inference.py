#!/usr/bin/env python3
import json,time,torch
from forgelm import ForgeConfig,ForgeLM,ByteActionTokenizer

torch.manual_seed(3);cfg=ForgeConfig(d_model=48,n_layers=2,n_heads=4,n_kv_heads=2,d_ff=128,max_seq_len=128,cache_window=96);m=ForgeLM(cfg).eval();tok=ByteActionTokenizer();ids=torch.tensor([tok.encode("cached inference verification")],dtype=torch.long)
def run(cache):
 torch.manual_seed(11);t=time.perf_counter();out=m.generate(ids,max_new_tokens=24,temperature=0,use_cache=cache);return out,time.perf_counter()-t
uncached,t1=run(False);cached,t2=run(True)
assert torch.equal(uncached,cached),"greedy cached generation must match uncached generation"
print(json.dumps({"state":"SUCCESS","tokens":int(cached.shape[1]-ids.shape[1]),"cachedSeconds":t2,"uncachedSeconds":t1,"sameGreedyOutput":True}))
