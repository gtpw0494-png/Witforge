import math,torch
from forgelm import ForgeConfig,ForgeLM

torch.manual_seed(9)
c=ForgeConfig(vocab_size=300,d_model=48,n_layers=2,n_heads=4,n_kv_heads=2,d_ff=96,max_seq_len=32,num_experts=4,experts_per_token=2,router_aux_loss_coef=.01,future_loss_coef=.2,future_horizon=2)
m=ForgeLM(c);x=torch.randint(0,c.vocab_size,(2,12));y=torch.randint(0,c.vocab_size,(2,12));logits,loss=m(x,y)
assert logits.shape==(2,12,c.vocab_size);assert math.isfinite(float(loss.detach()));assert 'routerBalance' in m.last_loss_components;assert 'futureToken' in m.last_loss_components
loss.backward();assert m.future_head.weight.grad is not None
print('v0.19.0 advanced objective tests passed',m.last_loss_components)
