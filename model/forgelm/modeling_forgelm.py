from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import torch
from torch import nn
import torch.nn.functional as F

from .configuration_forgelm import ForgeLMConfig

KVCache = Tuple[torch.Tensor, torch.Tensor]


@dataclass
class ForgeLMOutput:
    logits: torch.Tensor
    loss: Optional[torch.Tensor] = None
    past_key_values: Optional[List[KVCache]] = None


class RMSNorm(nn.Module):
    def __init__(self, hidden_size: int, eps: float):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(hidden_size))
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        variance = x.float().pow(2).mean(dim=-1, keepdim=True)
        x = x * torch.rsqrt(variance + self.eps).to(dtype=x.dtype)
        return self.weight * x


def rotate_half(x: torch.Tensor) -> torch.Tensor:
    half = x.shape[-1] // 2
    return torch.cat((-x[..., half:], x[..., :half]), dim=-1)


class RotaryEmbedding(nn.Module):
    def __init__(self, dim: int, theta: float):
        super().__init__()
        inv = 1.0 / (theta ** (torch.arange(0, dim, 2, dtype=torch.float32) / dim))
        self.register_buffer("inv_freq", inv, persistent=False)

    def forward(self, q: torch.Tensor, k: torch.Tensor, position_ids: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        freqs = torch.einsum("bt,d->btd", position_ids.float(), self.inv_freq.float())
        emb = torch.cat((freqs, freqs), dim=-1).to(dtype=q.dtype)
        cos = emb.cos().unsqueeze(1)
        sin = emb.sin().unsqueeze(1)
        return (q * cos) + (rotate_half(q) * sin), (k * cos) + (rotate_half(k) * sin)


class ForgeAttention(nn.Module):
    def __init__(self, config: ForgeLMConfig):
        super().__init__()
        self.num_heads = config.num_attention_heads
        self.num_kv_heads = config.num_key_value_heads
        self.head_dim = config.head_dim
        self.kv_repeat = self.num_heads // self.num_kv_heads
        self.dropout = config.dropout
        h = config.hidden_size
        self.q_proj = nn.Linear(h, self.num_heads * self.head_dim, bias=config.attention_bias)
        self.k_proj = nn.Linear(h, self.num_kv_heads * self.head_dim, bias=config.attention_bias)
        self.v_proj = nn.Linear(h, self.num_kv_heads * self.head_dim, bias=config.attention_bias)
        self.o_proj = nn.Linear(self.num_heads * self.head_dim, h, bias=config.attention_bias)
        self.rope = RotaryEmbedding(self.head_dim, config.rope_theta)

    def forward(
        self,
        x: torch.Tensor,
        position_ids: torch.Tensor,
        past_key_value: Optional[KVCache] = None,
        use_cache: bool = False,
    ) -> Tuple[torch.Tensor, Optional[KVCache]]:
        bsz, q_len, _ = x.shape
        q = self.q_proj(x).view(bsz, q_len, self.num_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(x).view(bsz, q_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(x).view(bsz, q_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        q, k = self.rope(q, k, position_ids)

        past_len = 0
        if past_key_value is not None:
            pk, pv = past_key_value
            past_len = pk.shape[-2]
            k = torch.cat((pk, k), dim=-2)
            v = torch.cat((pv, v), dim=-2)
        present = (k, v) if use_cache else None

        k_attn = k.repeat_interleave(self.kv_repeat, dim=1)
        v_attn = v.repeat_interleave(self.kv_repeat, dim=1)

        attn_mask = None
        is_causal = past_len == 0
        if past_len > 0:
            total_len = k_attn.shape[-2]
            q_positions = torch.arange(past_len, past_len + q_len, device=x.device)
            k_positions = torch.arange(total_len, device=x.device)
            attn_mask = (k_positions.unsqueeze(0) <= q_positions.unsqueeze(1)).unsqueeze(0).unsqueeze(0)

        y = F.scaled_dot_product_attention(
            q,
            k_attn,
            v_attn,
            attn_mask=attn_mask,
            dropout_p=self.dropout if self.training else 0.0,
            is_causal=is_causal,
        )
        y = y.transpose(1, 2).contiguous().view(bsz, q_len, self.num_heads * self.head_dim)
        return self.o_proj(y), present


class ForgeMLP(nn.Module):
    def __init__(self, config: ForgeLMConfig):
        super().__init__()
        h, i = config.hidden_size, config.intermediate_size
        self.gate_proj = nn.Linear(h, i, bias=config.mlp_bias)
        self.up_proj = nn.Linear(h, i, bias=config.mlp_bias)
        self.down_proj = nn.Linear(i, h, bias=config.mlp_bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))


class ForgeBlock(nn.Module):
    def __init__(self, config: ForgeLMConfig):
        super().__init__()
        self.input_norm = RMSNorm(config.hidden_size, config.rms_norm_eps)
        self.attn = ForgeAttention(config)
        self.post_attn_norm = RMSNorm(config.hidden_size, config.rms_norm_eps)
        self.mlp = ForgeMLP(config)

    def forward(
        self,
        x: torch.Tensor,
        position_ids: torch.Tensor,
        past_key_value: Optional[KVCache] = None,
        use_cache: bool = False,
    ) -> Tuple[torch.Tensor, Optional[KVCache]]:
        a, present = self.attn(self.input_norm(x), position_ids, past_key_value, use_cache)
        x = x + a
        x = x + self.mlp(self.post_attn_norm(x))
        return x, present


class ForgeLMForCausalLM(nn.Module):
    def __init__(self, config: ForgeLMConfig):
        super().__init__()
        config.validate()
        self.config = config
        self.embed_tokens = nn.Embedding(config.vocab_size, config.hidden_size)
        self.layers = nn.ModuleList([ForgeBlock(config) for _ in range(config.num_hidden_layers)])
        self.norm = RMSNorm(config.hidden_size, config.rms_norm_eps)
        self.lm_head = nn.Linear(config.hidden_size, config.vocab_size, bias=False)
        self.apply(self._init_weights)
        if config.tie_word_embeddings:
            self.lm_head.weight = self.embed_tokens.weight

    def _init_weights(self, module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=self.config.initializer_range)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=self.config.initializer_range)

    def num_parameters(self, trainable_only: bool = False) -> int:
        params: Sequence[torch.nn.Parameter] = self.parameters()
        return sum(p.numel() for p in params if (p.requires_grad or not trainable_only))

    def forward(
        self,
        input_ids: torch.Tensor,
        targets: Optional[torch.Tensor] = None,
        past_key_values: Optional[Sequence[KVCache]] = None,
        use_cache: bool = False,
    ) -> ForgeLMOutput:
        if input_ids.ndim != 2:
            raise ValueError("input_ids must have shape [batch, sequence]")
        if input_ids.shape[1] == 0:
            raise ValueError("sequence must not be empty")
        if input_ids.shape[1] > self.config.max_position_embeddings and past_key_values is None:
            raise ValueError("input sequence exceeds max_position_embeddings")

        past_len = 0
        if past_key_values:
            if len(past_key_values) != len(self.layers):
                raise ValueError("past_key_values layer count mismatch")
            past_len = past_key_values[0][0].shape[-2]
        total_len = past_len + input_ids.shape[1]
        if total_len > self.config.max_position_embeddings:
            raise ValueError("KV cache plus input exceeds max_position_embeddings")

        x = self.embed_tokens(input_ids)
        pos = torch.arange(past_len, total_len, device=input_ids.device).unsqueeze(0).expand(input_ids.shape[0], -1)
        presents: List[KVCache] = []
        for idx, layer in enumerate(self.layers):
            past = past_key_values[idx] if past_key_values is not None else None
            x, present = layer(x, pos, past, use_cache)
            if use_cache and present is not None:
                presents.append(present)
        logits = self.lm_head(self.norm(x))
        loss = None
        if targets is not None:
            if targets.shape != input_ids.shape:
                raise ValueError("targets must match input_ids shape")
            loss = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), targets.reshape(-1), ignore_index=-100)
        return ForgeLMOutput(logits=logits, loss=loss, past_key_values=presents if use_cache else None)
