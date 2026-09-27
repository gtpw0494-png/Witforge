from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Callable, Dict, Iterable, Optional, Sequence, Tuple

import torch

from .modeling_forgelm import ForgeLMForCausalLM

AllowedTokenFn = Callable[[torch.Tensor], Iterable[int]]
KVCache = Tuple[torch.Tensor, torch.Tensor]


@dataclass(frozen=True)
class GenerationStats:
    prompt_tokens: int
    generated_tokens: int
    peak_kv_cache_bytes: int
    final_kv_cache_bytes: int
    cache_layers: int
    max_context_tokens: int
    stop_reason: str

    def to_dict(self) -> Dict[str, int | str]:
        return asdict(self)


@dataclass(frozen=True)
class GenerationResult:
    output_ids: torch.Tensor
    stats: GenerationStats


def kv_cache_nbytes(past_key_values: Optional[Sequence[KVCache]]) -> int:
    if not past_key_values:
        return 0
    total = 0
    for key, value in past_key_values:
        total += int(key.numel()) * int(key.element_size())
        total += int(value.numel()) * int(value.element_size())
    return total


def _apply_repetition_penalty(logits: torch.Tensor, tokens: torch.Tensor, penalty: float) -> torch.Tensor:
    if penalty == 1.0:
        return logits
    out = logits.clone()
    for token_id in torch.unique(tokens):
        value = out[..., token_id]
        out[..., token_id] = torch.where(value < 0, value * penalty, value / penalty)
    return out


def sample_next_token(
    logits: torch.Tensor,
    *,
    temperature: float = 0.8,
    top_k: int = 50,
    top_p: float = 0.95,
    repetition_tokens: Optional[torch.Tensor] = None,
    repetition_penalty: float = 1.0,
    allowed_token_ids: Optional[Iterable[int]] = None,
    generator: Optional[torch.Generator] = None,
) -> torch.Tensor:
    scores = logits.float()
    if repetition_tokens is not None:
        scores = _apply_repetition_penalty(scores, repetition_tokens, repetition_penalty)

    if allowed_token_ids is not None:
        allowed = sorted({int(x) for x in allowed_token_ids if 0 <= int(x) < scores.shape[-1]})
        if not allowed:
            raise ValueError("allowed_token_ids produced an empty set")
        masked = torch.full_like(scores, float("-inf"))
        idx = torch.tensor(allowed, device=scores.device)
        masked.index_copy_(-1, idx, scores.index_select(-1, idx))
        scores = masked

    if temperature <= 0:
        return torch.argmax(scores, dim=-1, keepdim=True)
    scores = scores / temperature

    if top_k > 0 and top_k < scores.shape[-1]:
        threshold = torch.topk(scores, top_k, dim=-1).values[..., -1, None]
        scores = scores.masked_fill(scores < threshold, float("-inf"))

    if 0 < top_p < 1.0:
        sorted_scores, sorted_idx = torch.sort(scores, descending=True, dim=-1)
        probs = torch.softmax(sorted_scores, dim=-1)
        cumulative = probs.cumsum(dim=-1)
        remove = cumulative > top_p
        remove[..., 1:] = remove[..., :-1].clone()
        remove[..., 0] = False
        sorted_scores = sorted_scores.masked_fill(remove, float("-inf"))
        scores = torch.full_like(scores, float("-inf")).scatter(-1, sorted_idx, sorted_scores)

    probs = torch.softmax(scores, dim=-1)
    return torch.multinomial(probs, num_samples=1, generator=generator)


@torch.inference_mode()
def generate_with_stats(
    model: ForgeLMForCausalLM,
    input_ids: torch.Tensor,
    *,
    max_new_tokens: int = 64,
    eos_token_id: Optional[int] = None,
    temperature: float = 0.8,
    top_k: int = 50,
    top_p: float = 0.95,
    repetition_penalty: float = 1.0,
    seed: Optional[int] = None,
    allowed_token_fn: Optional[AllowedTokenFn] = None,
) -> GenerationResult:
    if input_ids.ndim != 2 or input_ids.shape[0] != 1:
        raise ValueError("bootstrap generator currently supports batch size 1")
    if input_ids.shape[1] == 0:
        raise ValueError("generation prompt must not be empty")
    max_new_tokens = max(0, int(max_new_tokens))
    max_context = int(model.config.max_position_embeddings)
    if input_ids.shape[1] > max_context:
        raise ValueError("generation prompt exceeds model context window")

    model.eval()
    out_ids = input_ids.clone()
    if max_new_tokens == 0 or input_ids.shape[1] >= max_context:
        return GenerationResult(
            output_ids=out_ids,
            stats=GenerationStats(
                prompt_tokens=int(input_ids.shape[1]),
                generated_tokens=0,
                peak_kv_cache_bytes=0,
                final_kv_cache_bytes=0,
                cache_layers=int(model.config.num_hidden_layers),
                max_context_tokens=max_context,
                stop_reason="context" if input_ids.shape[1] >= max_context else "max_tokens",
            ),
        )

    generator = None
    if seed is not None:
        generator = torch.Generator(device=input_ids.device)
        generator.manual_seed(seed)

    output = model(out_ids, use_cache=True)
    past = output.past_key_values
    next_logits = output.logits[:, -1, :]
    peak_cache = kv_cache_nbytes(past)
    final_cache = peak_cache
    generated_tokens = 0
    stop_reason = "max_tokens"

    for _ in range(max_new_tokens):
        allowed = allowed_token_fn(out_ids) if allowed_token_fn is not None else None
        next_token = sample_next_token(
            next_logits,
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
            repetition_tokens=out_ids,
            repetition_penalty=repetition_penalty,
            allowed_token_ids=allowed,
            generator=generator,
        )
        out_ids = torch.cat((out_ids, next_token), dim=1)
        generated_tokens += 1

        if eos_token_id is not None and int(next_token.item()) == int(eos_token_id):
            stop_reason = "eos"
            break
        if out_ids.shape[1] >= max_context:
            stop_reason = "context"
            break

        output = model(next_token, past_key_values=past, use_cache=True)
        past = output.past_key_values
        next_logits = output.logits[:, -1, :]
        final_cache = kv_cache_nbytes(past)
        peak_cache = max(peak_cache, final_cache)

    return GenerationResult(
        output_ids=out_ids,
        stats=GenerationStats(
            prompt_tokens=int(input_ids.shape[1]),
            generated_tokens=generated_tokens,
            peak_kv_cache_bytes=peak_cache,
            final_kv_cache_bytes=final_cache,
            cache_layers=len(past) if past is not None else 0,
            max_context_tokens=max_context,
            stop_reason=stop_reason,
        ),
    )


@torch.inference_mode()
def generate(
    model: ForgeLMForCausalLM,
    input_ids: torch.Tensor,
    *,
    max_new_tokens: int = 64,
    eos_token_id: Optional[int] = None,
    temperature: float = 0.8,
    top_k: int = 50,
    top_p: float = 0.95,
    repetition_penalty: float = 1.0,
    seed: Optional[int] = None,
    allowed_token_fn: Optional[AllowedTokenFn] = None,
) -> torch.Tensor:
    return generate_with_stats(
        model,
        input_ids,
        max_new_tokens=max_new_tokens,
        eos_token_id=eos_token_id,
        temperature=temperature,
        top_k=top_k,
        top_p=top_p,
        repetition_penalty=repetition_penalty,
        seed=seed,
        allowed_token_fn=allowed_token_fn,
    ).output_ids
