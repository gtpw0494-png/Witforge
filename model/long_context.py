"""ForgeLM-native long-context memory.

This module extends usable context beyond the active transformer window without
pretending the base checkpoint has magically acquired a million-token attention
window. Text is token-chunked locally, embedded by ForgeLM itself, ranked with
cosine similarity, and assembled into a bounded evidence context for generation.
No network or external model is used.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any
import torch


@dataclass
class ContextChunk:
    index: int
    token_start: int
    token_end: int
    text: str
    score: float = 0.0


class ForgeLongContext:
    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer

    @property
    def active_window(self) -> int:
        return int(self.model.config.max_seq_len)

    def chunk(self, text: str, *, chunk_tokens: int | None = None, overlap: int | None = None) -> list[ContextChunk]:
        ids = self.tokenizer.encode(str(text or ""))
        if not ids:
            return []
        size = int(chunk_tokens or max(32, min(self.active_window // 2, 512)))
        size = max(8, min(size, self.active_window))
        ov = int(overlap if overlap is not None else max(0, size // 8))
        ov = max(0, min(ov, size - 1))
        step = max(1, size - ov)
        chunks = []
        for start in range(0, len(ids), step):
            piece = ids[start:start + size]
            if not piece:
                break
            chunks.append(ContextChunk(
                index=len(chunks),
                token_start=start,
                token_end=start + len(piece),
                text=self.tokenizer.decode(piece),
            ))
            if start + size >= len(ids):
                break
        return chunks

    @torch.no_grad()
    def _embed_ids(self, ids: list[int]) -> torch.Tensor:
        if not ids:
            ids = [0]
        device = next(self.model.parameters()).device
        x = torch.tensor([ids[-self.active_window:]], dtype=torch.long, device=device)
        return self.model.embed(x)[0].detach().cpu()

    @torch.no_grad()
    def search(self, query: str, text: str, *, top_k: int = 4, chunk_tokens: int | None = None, overlap: int | None = None) -> dict[str, Any]:
        chunks = self.chunk(text, chunk_tokens=chunk_tokens, overlap=overlap)
        if not chunks:
            return {"state":"BLOCKED","message":"long-context source is empty","chunks":[]}
        q = self._embed_ids(self.tokenizer.encode(str(query or "")))
        scored = []
        for ch in chunks:
            v = self._embed_ids(self.tokenizer.encode(ch.text))
            score = float(torch.dot(q, v))
            scored.append(ContextChunk(**{**ch.__dict__, "score": score}))
        scored.sort(key=lambda c: (-c.score, c.index))
        selected = scored[:max(1, min(int(top_k), len(scored)))]
        return {
            "state":"SUCCESS",
            "engine":"ForgeLM",
            "externalModels":False,
            "activeWindowTokens":self.active_window,
            "sourceTokens":len(self.tokenizer.encode(str(text or ""))),
            "chunkCount":len(chunks),
            "selected":[c.__dict__ for c in selected],
        }

    def assemble(self, query: str, text: str, *, top_k: int = 4, token_budget: int | None = None) -> dict[str, Any]:
        found = self.search(query, text, top_k=top_k)
        if found.get("state") != "SUCCESS":
            return found
        budget = int(token_budget or max(32, self.active_window - 64))
        budget = max(16, min(budget, self.active_window))
        used = 0
        parts = []
        evidence = []
        for item in found["selected"]:
            ids = self.tokenizer.encode(item["text"])
            remaining = budget - used
            if remaining <= 0:
                break
            kept = ids[:remaining]
            if not kept:
                continue
            txt = self.tokenizer.decode(kept)
            parts.append(f"[chunk {item['index']} tokens {item['token_start']}:{item['token_end']}]\n{txt}")
            evidence.append({
                "chunk":item["index"],
                "tokenStart":item["token_start"],
                "tokenEnd":item["token_end"],
                "score":item["score"],
                "includedTokens":len(kept),
            })
            used += len(kept)
        return {
            **found,
            "context":"\n\n".join(parts),
            "contextTokens":used,
            "evidence":evidence,
            "retrievalMode":"forgelm-native-dense-context-memory",
        }


__all__ = ["ForgeLongContext", "ContextChunk"]
