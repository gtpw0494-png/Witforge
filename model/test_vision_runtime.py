import torch
from forgelm import ForgeConfig, ForgeLM, ByteActionTokenizer
from vision import ForgeVisionConfig, ForgeVisionEncoder
from vision_runtime import generate_multimodal

torch.manual_seed(7)
lm=ForgeLM(ForgeConfig(d_model=32,n_layers=1,n_heads=4,n_kv_heads=2,d_ff=64,max_seq_len=64,cache_window=64))
vision=ForgeVisionEncoder(ForgeVisionConfig(image_size=32,patch_size=8,vision_dim=24,vision_layers=1,vision_heads=4,output_dim=32))
tok=ByteActionTokenizer()
image=torch.rand(1,3,32,32)

text=generate_multimodal(lm,vision,tok,image,"Describe the image.",max_new_tokens=4,temperature=0)
assert isinstance(text,str)

visual=vision(image)
assert visual.shape[-1]==lm.config.d_model
assert visual.shape[1]+1<=lm.config.max_seq_len

print("ForgeVision multimodal runtime tests passed")
