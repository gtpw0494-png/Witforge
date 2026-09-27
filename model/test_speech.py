import tempfile
from pathlib import Path
import torch
from forgelm import ForgeConfig,ForgeLM,ByteActionTokenizer
from speech import ForgeSpeech,ForgeSpeechConfig
from speech_runtime import synthesize

torch.manual_seed(7)
lm=ForgeLM(ForgeConfig(d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=64))
speech=ForgeSpeech(ForgeSpeechConfig(sample_rate=8000,text_dim=32,hidden_dim=32,seed_frames=4,upsample_stages=3,channels=32,max_samples=1024))
cond=lm.embed(torch.tensor([[97,98,99]],dtype=torch.long))
wav=speech(cond,target_samples=512)
assert wav.shape==(1,512)
assert torch.isfinite(wav).all()
loss=wav.abs().mean();loss.backward()
assert any(p.grad is not None for p in speech.parameters() if p.requires_grad)

tok=ByteActionTokenizer()
out=synthesize(lm,speech,tok,"hello")
assert out.ndim==1 and out.numel()==speech.config.max_samples
assert torch.isfinite(out).all()

with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"speech.pt";speech.save(p,metadata={"externalModels":False});loaded=ForgeSpeech.load(p)
    assert loaded(cond,target_samples=128).shape==(1,128)
    assert loaded.checkpoint_metadata["externalModels"] is False

print("ForgeSpeech native tests passed")
