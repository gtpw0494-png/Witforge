import tempfile
from pathlib import Path
import torch
from forgelm import ForgeConfig,ForgeLM,ByteActionTokenizer
from video import ForgeVideoConfig,ForgeVideoEncoder
from video_runtime import generate_multimodal

torch.manual_seed(7)
lm=ForgeLM(ForgeConfig(d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=96,cache_window=96))
video=ForgeVideoEncoder(ForgeVideoConfig(frames=4,frame_size=32,frame_patch=8,vision_dim=24,vision_layers=1,vision_heads=4,temporal_dim=32,temporal_layers=1,temporal_heads=4,output_dim=32))
frames=torch.rand(2,4,3,32,32)
tokens=video(frames)
assert tokens.shape==(2,4,32)
emb=video.embed(frames)
assert emb.shape==(2,32)
assert torch.allclose(emb.norm(dim=-1),torch.ones(2),atol=1e-5)

tok=ByteActionTokenizer()
text=generate_multimodal(lm,video,tok,frames[:1],"Describe the video.",max_new_tokens=4,temperature=0)
assert isinstance(text,str)

loss=tokens.mean();loss.backward()
assert any(p.grad is not None for p in video.parameters() if p.requires_grad)

with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"video.pt";video.save(p,metadata={"externalModels":False});loaded=ForgeVideoEncoder.load(p)
    assert loaded(frames[:1]).shape==(1,4,32)
    assert loaded.checkpoint_metadata["externalModels"] is False

print("ForgeVideo native tests passed")
