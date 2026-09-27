import tempfile,wave
from pathlib import Path
import torch
import torch.nn.functional as F
from forgelm import ForgeConfig,ForgeLM,ByteActionTokenizer
from audio import ForgeAudioConfig,ForgeAudioEncoder,ForgeAudioAdapter
from audio_runtime import generate_multimodal

torch.manual_seed(7)
lm=ForgeLM(ForgeConfig(d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=96,cache_window=96))
audio=ForgeAudioEncoder(ForgeAudioConfig(sample_rate=16000,n_fft=64,hop_length=16,win_length=64,freq_bins=33,audio_dim=24,audio_layers=1,audio_heads=4,output_dim=32,max_frames=128))
adapter=ForgeAudioAdapter(audio,lm.config.d_model)
waveform=torch.rand(2,1600)*2-1
short=torch.rand(1,20)*2-1
assert audio(short).shape[-1]==32
tokens=adapter(waveform)
assert tokens.shape[0]==2 and tokens.shape[-1]==32
emb=audio.embed(waveform)
assert emb.shape==(2,32)
assert torch.allclose(emb.norm(dim=-1),torch.ones(2),atol=1e-5)

target=lm.embed(torch.tensor([[97,98,99]],dtype=torch.long)).detach().expand(2,-1)
pred=F.normalize(tokens.mean(dim=1),p=2,dim=-1)
loss=1-F.cosine_similarity(pred,target,dim=-1).mean();loss.backward()
assert any(p.grad is not None for p in audio.parameters() if p.requires_grad)

tok=ByteActionTokenizer()
text=generate_multimodal(lm,audio,tok,waveform[:1],"Describe the audio.",max_new_tokens=4,temperature=0)
assert isinstance(text,str)

with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"audio.pt";audio.save(p,metadata={"externalModels":False});loaded=ForgeAudioEncoder.load(p)
    assert loaded(waveform[:1]).shape[-1]==32
    assert loaded.checkpoint_metadata["externalModels"] is False

print("ForgeAudio native tests passed")
