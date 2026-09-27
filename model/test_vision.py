import tempfile
from pathlib import Path
import torch
import torch.nn.functional as F
from forgelm import ForgeConfig, ForgeLM
from vision import ForgeVisionConfig, ForgeVisionEncoder, ForgeMultimodalAdapter

torch.manual_seed(7)
lm=ForgeLM(ForgeConfig(d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=48))
vc=ForgeVisionConfig(image_size=32,patch_size=8,vision_dim=24,vision_layers=1,vision_heads=4,output_dim=32)
vision=ForgeVisionEncoder(vc)
adapter=ForgeMultimodalAdapter(vision,lm.config.d_model)

images=torch.rand(2,3,32,32)
tokens=adapter(images)
assert tokens.shape==(2,17,32)
emb=vision.embed(images)
assert emb.shape==(2,32)
assert torch.allclose(emb.norm(dim=-1),torch.ones(2),atol=1e-5)

text_ids=torch.tensor([[97,98,99]],dtype=torch.long)
target=lm.embed(text_ids).detach()
pred=F.normalize(tokens.mean(dim=1),p=2,dim=-1)
loss=1-F.cosine_similarity(pred,target.expand(2,-1),dim=-1).mean()
loss.backward()
assert any(p.grad is not None for p in vision.parameters() if p.requires_grad)

with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"vision.pt"
    vision.save(p,metadata={"test":True,"externalModels":False})
    loaded=ForgeVisionEncoder.load(p)
    out=loaded(images)
    assert out.shape==tokens.shape
    assert loaded.checkpoint_metadata["externalModels"] is False

print("ForgeVision native tests passed")
