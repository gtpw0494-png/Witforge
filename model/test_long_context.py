import torch
from forgelm import ForgeConfig, ForgeLM, ByteActionTokenizer
from capabilities import ForgeCapabilities
from long_context import ForgeLongContext

tok=ByteActionTokenizer()
cfg=ForgeConfig(d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=48,rope_scale=4.0,cache_window=32)
model=ForgeLM(cfg)

# RoPE scaling must support absolute positions beyond the nominal training window.
ids=torch.tensor([[1,2,3,4]],dtype=torch.long)
logits,loss=model(ids,ids,start_pos=192)
assert logits.shape==(1,4,260)
assert loss is not None
assert model.blocks[0].attn.rope_scale==4.0

# Native context memory must process a source larger than the active attention window.
engine=ForgeLongContext(model,tok)
source=("alpha local evidence. "*40)+("beta independent ForgeLM context memory. "*40)+("gamma final evidence. "*40)
chunks=engine.chunk(source,chunk_tokens=24,overlap=4)
assert len(chunks)>4
assert len(tok.encode(source))>cfg.max_seq_len

found=engine.search("ForgeLM independent context",source,top_k=3,chunk_tokens=24,overlap=4)
assert found["state"]=="SUCCESS"
assert found["externalModels"] is False
assert found["sourceTokens"]>found["activeWindowTokens"]
assert len(found["selected"])==3

assembled=engine.assemble("ForgeLM independent context",source,top_k=3,token_budget=32)
assert assembled["state"]=="SUCCESS"
assert assembled["retrievalMode"]=="forgelm-native-dense-context-memory"
assert assembled["contextTokens"]<=32
assert assembled["evidence"]

caps=ForgeCapabilities(model,tok)
native=caps.long_context("independent context",source,top_k=2,token_budget=24)
assert native["state"]=="SUCCESS"
assert native["networkRequired"] is False
assert native["externalModels"] is False
assert native["sourceTokens"]>native["activeWindowTokens"]

print("ForgeLM v0.57 native long-context tests passed")
