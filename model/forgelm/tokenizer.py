from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Iterable, List

SPECIAL_TOKENS = {
    "<|pad|>": 0,
    "<|bos|>": 1,
    "<|eos|>": 2,
    "<|platform|>": 3,
    "<|developer|>": 4,
    "<|user|>": 5,
    "<|assistant|>": 6,
    "<|tool_call|>": 7,
    "<|tool_result|>": 8,
    "<|memory|>": 9,
    "<|evidence|>": 10,
    "<|action|>": 11,
    "<|approval|>": 12,
    "<|verification|>": 13,
    "<|json|>": 14,
    "<|end_json|>": 15,
    "<|end_turn|>": 16,
}
BYTE_OFFSET = 32
MIN_VOCAB_SIZE = BYTE_OFFSET + 256


class ByteTokenizer:
    """Deterministic UTF-8 byte tokenizer used to bootstrap ForgeLM training.

    The full ForgeLM target is byte-level BPE. This tokenizer intentionally has
    no external dependency and keeps reserved token IDs stable while the BPE
    trainer is developed. Unused vocabulary rows remain available for future
    BPE merges without changing the reserved IDs.
    """

    def __init__(self, model_vocab_size: int = 32768):
        if int(model_vocab_size) < MIN_VOCAB_SIZE:
            raise ValueError(f"model_vocab_size must be >= {MIN_VOCAB_SIZE}")
        self.model_vocab_size = int(model_vocab_size)
        self.special_tokens = dict(SPECIAL_TOKENS)
        self.id_to_special = {v: k for k, v in self.special_tokens.items()}
        pattern = "|".join(re.escape(k) for k in sorted(self.special_tokens, key=len, reverse=True))
        self._special_re = re.compile(f"({pattern})")

    @property
    def vocab_size(self) -> int:
        return self.model_vocab_size

    @property
    def pad_token_id(self) -> int:
        return self.special_tokens["<|pad|>"]

    @property
    def bos_token_id(self) -> int:
        return self.special_tokens["<|bos|>"]

    @property
    def eos_token_id(self) -> int:
        return self.special_tokens["<|eos|>"]

    def encode(self, text: str, *, add_bos: bool = False, add_eos: bool = False) -> List[int]:
        ids: List[int] = []
        if add_bos:
            ids.append(self.bos_token_id)
        for part in self._special_re.split(str(text)):
            if not part:
                continue
            if part in self.special_tokens:
                ids.append(self.special_tokens[part])
            else:
                ids.extend(BYTE_OFFSET + b for b in part.encode("utf-8"))
        if add_eos:
            ids.append(self.eos_token_id)
        return ids

    def decode(self, ids: Iterable[int], *, skip_special_tokens: bool = True) -> str:
        out: List[str] = []
        buf = bytearray()

        def flush() -> None:
            if buf:
                out.append(buf.decode("utf-8", errors="replace"))
                buf.clear()

        for raw in ids:
            token = int(raw)
            if BYTE_OFFSET <= token < BYTE_OFFSET + 256:
                buf.append(token - BYTE_OFFSET)
                continue
            flush()
            special = self.id_to_special.get(token)
            if special and not skip_special_tokens:
                out.append(special)
        flush()
        return "".join(out)

    def save(self, path: str | Path) -> None:
        payload = {
            "schema": "witforge.forgelm.byte-tokenizer.v1",
            "model_vocab_size": self.model_vocab_size,
            "byte_offset": BYTE_OFFSET,
            "special_tokens": self.special_tokens,
        }
        Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "ByteTokenizer":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        tok = cls(int(data["model_vocab_size"]))
        if data.get("special_tokens") != SPECIAL_TOKENS or int(data.get("byte_offset", -1)) != BYTE_OFFSET:
            raise ValueError("tokenizer special-token layout is incompatible with this ForgeLM build")
        return tok
