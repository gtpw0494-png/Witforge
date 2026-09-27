import torch
from forgelm import ForgeConfig,ForgeLM,ByteActionTokenizer
from multimodal import FusionBudget,FusionAssembler,ForgeFusionConfig,ForgeFusion
from vision import ForgeVisionConfig,ForgeVisionEncoder
from audio import ForgeAudioConfig,ForgeAudioEncoder
from video import ForgeVideoConfig,ForgeVideoEncoder
from multimodal_runtime import generate

torch.manual_seed(7)
lm=ForgeLM(ForgeConfig(d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=96,cache_window=96))
tok=ByteActionTokenizer()

vision=ForgeVisionEncoder(ForgeVisionConfig(image_size=32,patch_size=8,vision_dim=24,vision_layers=1,vision_heads=4,output_dim=32))
audio=ForgeAudioEncoder(ForgeAudioConfig(sample_rate=16000,n_fft=64,hop_length=16,win_length=64,freq_bins=33,audio_dim=24,audio_layers=1,audio_heads=4,output_dim=32,max_frames=128))
video=ForgeVideoEncoder(ForgeVideoConfig(frames=4,frame_size=32,frame_patch=8,vision_dim=24,vision_layers=1,vision_heads=4,temporal_dim=32,temporal_layers=1,temporal_heads=4,output_dim=32))

image_tokens=vision(torch.rand(1,3,32,32))
audio_tokens=audio(torch.rand(1,1600)*2-1)
video_tokens=video(torch.rand(1,4,3,32,32))
text_ids=torch.tensor([[97,98,99,100]],dtype=torch.long)
text_tokens=lm.emb(text_ids)
context_tokens=lm.emb(torch.tensor([[101,102,103]],dtype=torch.long))

assembled=FusionAssembler(FusionBudget(max_tokens=64,image_tokens=8,audio_tokens=8,video_tokens=4,text_tokens=8,context_tokens=8)).assemble(
    image=image_tokens,audio=audio_tokens,video=video_tokens,context=context_tokens,text=text_tokens
)
assert assembled["tokens"].shape[0]==1
assert assembled["tokens"].shape[-1]==32
assert assembled["totalTokens"]<=64
assert {x["modality"] for x in assembled["modalities"]}=={"image","audio","video","context","text"}

text=generate(lm,tok,assembled["tokens"],max_new_tokens=4,temperature=0)
assert isinstance(text,str)

fusion=ForgeFusion(ForgeFusionConfig(hidden_dim=32,layers=1,heads=4,max_tokens=64))
fused=fusion(assembled["tokens"])
assert fused.shape==assembled["tokens"].shape
loss=fused.mean();loss.backward()
assert any(p.grad is not None for p in fusion.parameters() if p.requires_grad)

print("ForgeMultimodal fusion tests passed")
