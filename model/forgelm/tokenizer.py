from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
from typing import Iterable, List, Sequence, Tuple

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
BYTE_VOCAB_END = BYTE_OFFSET + 256
MIN_VOCAB_SIZE = BYTE_VOCAB_END


class _BaseTokenizer:
    schema = ""

    def __init__(self, model_vocab_size: int):
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

    def _split(self, text: str) -> List[str]:
        return [p for p in self._special_re.split(str(text)) if p]


class ByteTokenizer(_BaseTokenizer):
    """Deterministic UTF-8 byte tokenizer used for bootstrap/smoke training."""

    schema = "witforge.forgelm.byte-tokenizer.v1"

    def encode(self, text: str, *, add_bos: bool = False, add_eos: bool = False) -> List[int]:
        ids: List[int] = []
        if add_bos:
            ids.append(self.bos_token_id)
        for part in self._split(text):
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
            if BYTE_OFFSET <= token < BYTE_VOCAB_END:
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
            "schema": self.schema,
            "model_vocab_size": self.model_vocab_size,
            "byte_offset": BYTE_OFFSET,
            "special_tokens": self.special_tokens,
        }
        Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "ByteTokenizer":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        tok = cls(int(data["model_vocab_size"]))
        _validate_layout(data)
        return tok


class BPETokenizer(_BaseTokenizer):
    """Byte-level BPE with immutable ForgeLM special-token and byte IDs.

    Merged symbols begin at id 288, so ids 0..16 and 32..287 never move.
    The trainer is intentionally dependency-free and deterministic; it is
    suitable for project/local corpora. Very large tokenizer training jobs
    should use a compatible optimized trainer and import the same merge list.
    """

    schema = "witforge.forgelm.bpe-tokenizer.v1"

    def __init__(self, model_vocab_size: int = 32768, merges: Sequence[Sequence[int]] | None = None):
        super().__init__(model_vocab_size)
        self.merges: List[Tuple[int, int, int]] = []
        self.merge_rank = {}
        self.id_to_bytes = {BYTE_OFFSET + b: bytes([b]) for b in range(256)}
        for rank, raw in enumerate(merges or []):
            if len(raw) != 3:
                raise ValueError("each merge must be [left_id,right_id,new_id]")
            left, right, new_id = (int(raw[0]), int(raw[1]), int(raw[2]))
            if new_id < BYTE_VOCAB_END or new_id >= self.model_vocab_size:
                raise ValueError("BPE merge id outside model vocabulary")
            if (left, right) in self.merge_rank or new_id in self.id_to_bytes:
                raise ValueError("duplicate BPE merge")
            if left not in self.id_to_bytes or right not in self.id_to_bytes:
                raise ValueError("BPE merge references an unknown earlier token")
            self.merges.append((left, right, new_id))
            self.merge_rank[(left, right)] = (rank, new_id)
            self.id_to_bytes[new_id] = self.id_to_bytes[left] + self.id_to_bytes[right]

    @property
    def active_token_count(self) -> int:
        return len(SPECIAL_TOKENS) + 256 + len(self.merges)

    def _encode_bytes(self, data: bytes) -> List[int]:
        tokens = [BYTE_OFFSET + b for b in data]
        while len(tokens) >= 2:
            best = None
            for i in range(len(tokens) - 1):
                entry = self.merge_rank.get((tokens[i], tokens[i + 1]))
                if entry is not None and (best is None or entry[0] < best[0]):
                    best = (entry[0], i, entry[1], tokens[i], tokens[i + 1])
            if best is None:
                break
            _, _, new_id, left, right = best
            merged: List[int] = []
            i = 0
            while i < len(tokens):
                if i + 1 < len(tokens) and tokens[i] == left and tokens[i + 1] == right:
                    merged.append(new_id)
                    i += 2
                else:
                    merged.append(tokens[i])
                    i += 1
            tokens = merged
        return tokens

    def encode(self, text: str, *, add_bos: bool = False, add_eos: bool = False) -> List[int]:
        ids: List[int] = []
        if add_bos:
            ids.append(self.bos_token_id)
        for part in self._split(text):
            if part in self.special_tokens:
                ids.append(self.special_tokens[part])
            else:
                ids.extend(self._encode_bytes(part.encode("utf-8")))
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
            value = self.id_to_bytes.get(token)
            if value is not None:
                buf.extend(value)
                continue
            flush()
            special = self.id_to_special.get(token)
            if special and not skip_special_tokens:
                out.append(special)
        flush()
        return "".join(out)

    def save(self, path: str | Path) -> None:
        payload = {
            "schema": self.schema,
            "model_vocab_size": self.model_vocab_size,
            "byte_offset": BYTE_OFFSET,
            "special_tokens": self.special_tokens,
            "merges": [list(x) for x in self.merges],
            "active_token_count": self.active_token_count,
        }
        Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "BPETokenizer":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        _validate_layout(data)
        return cls(int(data["model_vocab_size"]), data.get("merges") or [])

    @classmethod
    def train(
        cls,
        documents: Iterable[str],
        *,
        model_vocab_size: int = 32768,
        target_vocab_size: int = 4096,
        min_frequency: int = 2,
        max_training_bytes: int = 8_000_000,
    ) -> "BPETokenizer":
        if target_vocab_size > model_vocab_size:
            raise ValueError("target_vocab_size cannot exceed model_vocab_size")
        target_vocab_size = max(BYTE_VOCAB_END, int(target_vocab_size))
        sequences: List[List[int]] = []
        used_bytes = 0
        splitter = cls(model_vocab_size)._split
        for doc in documents:
            for part in splitter(str(doc)):
                if part in SPECIAL_TOKENS:
                    continue
                raw = part.encode("utf-8")
                if not raw:
                    continue
                remaining = max_training_bytes - used_bytes
                if remaining <= 0:
                    break
                raw = raw[:remaining]
                used_bytes += len(raw)
                sequences.append([BYTE_OFFSET + b for b in raw])
            if used_bytes >= max_training_bytes:
                break
        if not sequences:
            raise ValueError("no tokenizer training bytes")

        merges: List[Tuple[int, int, int]] = []
        next_id = BYTE_VOCAB_END
        while next_id < target_vocab_size:
            counts = Counter()
            for seq in sequences:
                counts.update(zip(seq, seq[1:]))
            if not counts:
                break
            pair, freq = min(
                counts.items(),
                key=lambda item: (-item[1], item[0][0], item[0][1]),
            )
            if freq < int(min_frequency):
                break
            left, right = pair
            new_id = next_id
            next_id += 1
            merges.append((left, right, new_id))
            for si, seq in enumerate(sequences):
                merged: List[int] = []
                i = 0
                while i < len(seq):
                    if i + 1 < len(seq) and seq[i] == left and seq[i + 1] == right:
                        merged.append(new_id)
                        i += 2
                    else:
                        merged.append(seq[i])
                        i += 1
                sequences[si] = merged
        return cls(model_vocab_size, merges)


def _validate_layout(data: dict) -> None:
    if data.get("special_tokens") != SPECIAL_TOKENS or int(data.get("byte_offset", -1)) != BYTE_OFFSET:
        raise ValueError("tokenizer special-token layout is incompatible with this ForgeLM build")


def load_tokenizer(path: str | Path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    schema = data.get("schema")
    if schema == ByteTokenizer.schema:
        return ByteTokenizer.load(path)
    if schema == BPETokenizer.schema:
        return BPETokenizer.load(path)
    raise ValueError(f"unknown ForgeLM tokenizer schema: {schema}")


def _load_corpus(paths: Sequence[str]) -> List[str]:
    docs: List[str] = []
    for raw in paths:
        p = Path(raw)
        if p.suffix.lower() == ".jsonl":
            for line in p.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                text = row.get("text")
                if isinstance(text, str) and text:
                    docs.append(text)
        else:
            text = p.read_text(encoding="utf-8")
            if text:
                docs.append(text)
    if not docs:
        raise ValueError("no tokenizer training documents")
    return docs


def main() -> None:
    p = argparse.ArgumentParser(description="ForgeLM tokenizer tools")
    sub = p.add_subparsers(dest="command", required=True)
    train = sub.add_parser("train-bpe")
    train.add_argument("--corpus", nargs="+", required=True)
    train.add_argument("--output", required=True)
    train.add_argument("--model-vocab-size", type=int, default=32768)
    train.add_argument("--target-vocab-size", type=int, default=4096)
    train.add_argument("--min-frequency", type=int, default=2)
    train.add_argument("--max-training-bytes", type=int, default=8_000_000)
    args = p.parse_args()
    tok = BPETokenizer.train(
        _load_corpus(args.corpus),
        model_vocab_size=args.model_vocab_size,
        target_vocab_size=args.target_vocab_size,
        min_frequency=args.min_frequency,
        max_training_bytes=args.max_training_bytes,
    )
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    tok.save(args.output)
    print(json.dumps({
        "ok": True,
        "output": args.output,
        "model_vocab_size": tok.model_vocab_size,
        "active_token_count": tok.active_token_count,
        "merges": len(tok.merges),
    }, indent=2))


if __name__ == "__main__":
    main()
