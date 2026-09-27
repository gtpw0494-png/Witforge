from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Callable, Dict, Iterable, Iterator, Optional, Sequence, Tuple

import torch

from .modeling_forgelm import ForgeLMForCausalLM, StaticKVCache

AllowedTokenFn = Callable[[torch.Tensor], Iterable[int]]
KVCache = Tuple[torch.Tensor, torch.Tensor] | StaticKVCache


@dataclass(frozen=True)
class GenerationStats:
    prompt_tokens: int
    generated_tokens: int
    sampled_tokens: int
    peak_kv_cache_bytes: int
    final_kv_cache_bytes: int
    cache_layers: int
    max_context_tokens: int
    stop_reason: str
    cache_strategy: str
    matched_stop_index: Optional[int] = None

    def to_dict(self) -> Dict[str, int | str | None]:
        return asdict(self)


@dataclass(frozen=True)
class GenerationResult:
    output_ids: torch.Tensor
    stats: GenerationStats


@dataclass(frozen=True)
class GenerationStreamEvent:
    token_id: Optional[int]
    generated_tokens: int
    done: bool
    output_ids: Optional[torch.Tensor] = None
    stats: Optional[GenerationStats] = None


def kv_cache_nbytes(past_key_values: Optional[Sequence[KVCache]]) -> int:
    if not past_key_values:
        return 0
    total = 0
    for cache in past_key_values:
        if isinstance(cache, StaticKVCache):
            key, value = cache.key, cache.value
        else:
            key, value = cache
        total += int(key.numel()) * int(key.element_size())
        total += int(value.numel()) * int(value.element_size())
    return total


def _normalise_stop_sequences(
    stop_token_sequences: Optional[Sequence[Sequence[int]]],
    vocab_size: int,
) -> Tuple[Tuple[int, ...], ...]:
    if not stop_token_sequences:
        return ()
    stops = []
    seen = set()
    for raw in stop_token_sequences:
        seq = tuple(int(x) for x in raw)
        if not seq:
            raise ValueError("stop token sequences must not be empty")
        if any(x < 0 or x >= vocab_size for x in seq):
            raise ValueError("stop token sequence contains an out-of-range token")
        if seq not in seen:
            stops.append(seq)
            seen.add(seq)
    return tuple(stops)


def _longest_stop_prefix_suffix(pending: Sequence[int], stops: Sequence[Tuple[int, ...]]) -> int:
    best = 0
    max_len = min(len(pending), max((len(x) for x in stops), default=0))
    for size in range(1, max_len + 1):
        suffix = tuple(pending[-size:])
        if any(len(stop) >= size and stop[:size] == suffix for stop in stops):
            best = size
    return best


def _matched_stop_index(pending: Sequence[int], stops: Sequence[Tuple[int, ...]]) -> Optional[int]:
    for index, stop in enumerate(stops):
        if len(pending) >= len(stop) and tuple(pending[-len(stop):]) == stop:
            return index
    return None


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


def iter_generate(
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
    stop_token_sequences: Optional[Sequence[Sequence[int]]] = None,
    cache_strategy: str = "dynamic",
) -> Iterator[GenerationStreamEvent]:
    with torch.inference_mode():
        if input_ids.ndim != 2 or input_ids.shape[0] != 1:
            raise ValueError("bootstrap generator currently supports batch size 1")
        if input_ids.shape[1] == 0:
            raise ValueError("generation prompt must not be empty")
        max_new_tokens = max(0, int(max_new_tokens))
        max_context = int(model.config.max_position_embeddings)
        if input_ids.shape[1] > max_context:
            raise ValueError("generation prompt exceeds model context window")
        strategy = str(cache_strategy or "dynamic").lower()
        if strategy not in {"dynamic", "static", "none"}:
            raise ValueError("cache_strategy must be one of: dynamic, static, none")
        stops = _normalise_stop_sequences(stop_token_sequences, int(model.config.vocab_size))

        model.eval()
        context_ids = input_ids.clone()
        visible_tokens: list[int] = []
        pending: list[int] = []
        if max_new_tokens == 0 or input_ids.shape[1] >= max_context:
            stats = GenerationStats(
                prompt_tokens=int(input_ids.shape[1]),
                generated_tokens=0,
                sampled_tokens=0,
                peak_kv_cache_bytes=0,
                final_kv_cache_bytes=0,
                cache_layers=int(model.config.num_hidden_layers) if strategy in {"dynamic", "static"} else 0,
                max_context_tokens=max_context,
                stop_reason="context" if input_ids.shape[1] >= max_context else "max_tokens",
                cache_strategy=strategy,
            )
            yield GenerationStreamEvent(None, 0, True, output_ids=input_ids.clone(), stats=stats)
            return

        generator = None
        if seed is not None:
            generator = torch.Generator(device=input_ids.device)
            generator.manual_seed(seed)

        use_dynamic_cache = strategy == "dynamic"
        use_static_cache = strategy == "static"
        if use_static_cache:
            cache_dtype = model.embed_tokens.weight.dtype
            static_cache = [
                StaticKVCache.allocate(
                    batch_size=input_ids.shape[0],
                    num_key_value_heads=model.config.num_key_value_heads,
                    max_length=max_context,
                    head_dim=model.config.head_dim,
                    device=input_ids.device,
                    dtype=cache_dtype,
                )
                for _ in range(model.config.num_hidden_layers)
            ]
            output = model(context_ids, past_key_values=static_cache, use_cache=True)
            past = output.past_key_values
        else:
            output = model(context_ids, use_cache=use_dynamic_cache)
            past = output.past_key_values if use_dynamic_cache else None
        next_logits = output.logits[:, -1, :]
        peak_cache = kv_cache_nbytes(past) if past else 0
        final_cache = peak_cache
        sampled_tokens = 0
        stop_reason = "max_tokens"
        matched_stop_index = None

        def emit(tokens: Sequence[int]) -> Iterator[GenerationStreamEvent]:
            for token in tokens:
                visible_tokens.append(int(token))
                yield GenerationStreamEvent(int(token), len(visible_tokens), False)

        for _ in range(max_new_tokens):
            allowed = allowed_token_fn(context_ids) if allowed_token_fn is not None else None
            next_token = sample_next_token(
                next_logits,
                temperature=temperature,
                top_k=top_k,
                top_p=top_p,
                repetition_tokens=context_ids,
                repetition_penalty=repetition_penalty,
                allowed_token_ids=allowed,
                generator=generator,
            )
            context_ids = torch.cat((context_ids, next_token), dim=1)
            sampled_tokens += 1
            token_id = int(next_token.item())
            pending.append(token_id)

            matched = _matched_stop_index(pending, stops)
            if matched is not None:
                stop = stops[matched]
                prefix = pending[:-len(stop)]
                for event in emit(prefix):
                    yield event
                pending.clear()
                stop_reason = "stop_sequence"
                matched_stop_index = matched
                break

            keep = _longest_stop_prefix_suffix(pending, stops) if stops else 0
            flush_count = len(pending) - keep
            if flush_count > 0:
                flushed = pending[:flush_count]
                del pending[:flush_count]
                for event in emit(flushed):
                    yield event

            if eos_token_id is not None and token_id == int(eos_token_id):
                for event in emit(pending):
                    yield event
                pending.clear()
                stop_reason = "eos"
                break
            if context_ids.shape[1] >= max_context:
                for event in emit(pending):
                    yield event
                pending.clear()
                stop_reason = "context"
                break

            if use_dynamic_cache or use_static_cache:
                output = model(next_token, past_key_values=past, use_cache=True)
                past = output.past_key_values
                final_cache = kv_cache_nbytes(past)
                peak_cache = max(peak_cache, final_cache)
            else:
                output = model(context_ids, use_cache=False)
                past = None
                final_cache = 0
            next_logits = output.logits[:, -1, :]
        else:
            for event in emit(pending):
                yield event
            pending.clear()

        if visible_tokens:
            visible = torch.tensor([visible_tokens], dtype=input_ids.dtype, device=input_ids.device)
            output_ids = torch.cat((input_ids, visible), dim=1)
        else:
            output_ids = input_ids.clone()

        stats = GenerationStats(
            prompt_tokens=int(input_ids.shape[1]),
            generated_tokens=len(visible_tokens),
            sampled_tokens=sampled_tokens,
            peak_kv_cache_bytes=peak_cache,
            final_kv_cache_bytes=final_cache,
            cache_layers=len(past) if past is not None else 0,
            max_context_tokens=max_context,
            stop_reason=stop_reason,
            cache_strategy=strategy,
            matched_stop_index=matched_stop_index,
        )
        yield GenerationStreamEvent(None, len(visible_tokens), True, output_ids=output_ids, stats=stats)


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
    stop_token_sequences: Optional[Sequence[Sequence[int]]] = None,
    cache_strategy: str = "dynamic",
) -> GenerationResult:
    final_event: Optional[GenerationStreamEvent] = None
    for event in iter_generate(
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
        stop_token_sequences=stop_token_sequences,
        cache_strategy=cache_strategy,
    ):
        if event.done:
            final_event = event
    if final_event is None or final_event.output_ids is None or final_event.stats is None:
        raise RuntimeError("generation ended without a final event")
    return GenerationResult(output_ids=final_event.output_ids, stats=final_event.stats)


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
    stop_token_sequences: Optional[Sequence[Sequence[int]]] = None,
    cache_strategy: str = "dynamic",
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
        stop_token_sequences=stop_token_sequences,
        cache_strategy=cache_strategy,
    ).output_ids
