import torch
from forgelm import ForgeConfig,ForgeLM,SPECIAL

torch.manual_seed(7)
model=ForgeLM(ForgeConfig(vocab_size=260,d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=32))
ids=torch.tensor([[65,66,67]],dtype=torch.long)
seen=[]
out=model.generate(ids,max_new_tokens=6,temperature=0,top_k=1,top_p=1.0,on_token=lambda token: seen.append(int(token)))
assert out.shape[1]>=ids.shape[1]+1
suffix=out[0,ids.shape[1]:].tolist()
expected=[int(x) for x in suffix if int(x)!=SPECIAL["<|end|>"]]
assert seen==expected[:len(seen)]
assert all(isinstance(x,int) for x in seen)

seen_no_cache=[]
out2=model.generate(ids,max_new_tokens=4,temperature=0,top_k=1,top_p=1.0,use_cache=False,on_token=lambda token: seen_no_cache.append(int(token)))
suffix2=out2[0,ids.shape[1]:].tolist()
expected2=[int(x) for x in suffix2 if int(x)!=SPECIAL["<|end|>"]]
assert seen_no_cache==expected2[:len(seen_no_cache)]

print("ForgeLM token streaming callback tests passed")
