from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
from typing import Iterable, List

import torch

from .checkpoint import save_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .modeling_forgelm import ForgeLMForCausalLM
from .tokenizer import ByteTokenizer, load_tokenizer


def load_documents(paths: Iterable[str]) -> List[str]:
    docs: List[str] = []
    for raw_path in paths:
        path = Path(raw_path)
        if not path.exists():
            raise FileNotFoundError(path)
        if path.suffix.lower() == ".jsonl":
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if isinstance(row.get("text"), str):
                    docs.append(row["text"])
                elif isinstance(row.get("messages"), list):
                    parts = []
                    for m in row["messages"]:
                        role = str(m.get("role", "user"))
                        content = str(m.get("content", ""))
                        tag = "<|assistant|>" if role == "assistant" else "<|user|>"
                        parts.append(tag + "\n" + content + "\n<|end_turn|>")
                    docs.append("\n".join(parts))
                else:
                    raise ValueError(f"{path}: JSONL row needs text or messages")
        else:
            text = path.read_text(encoding="utf-8")
            if text.strip():
                docs.append(text)
    if not docs:
        raise ValueError("no training documents loaded")
    return docs


def build_token_stream(tokenizer: ByteTokenizer, docs: Iterable[str]) -> torch.Tensor:
    ids: List[int] = []
    for doc in docs:
        ids.extend(tokenizer.encode(doc, add_bos=True, add_eos=True))
    return torch.tensor(ids, dtype=torch.long)


def sample_batch(stream: torch.Tensor, batch_size: int, seq_len: int, device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
    if stream.numel() < seq_len + 1:
        repeats = ((seq_len + 1) // max(1, stream.numel())) + 1
        stream = stream.repeat(repeats)
    high = stream.numel() - seq_len
    starts = torch.randint(0, high, (batch_size,))
    xs, ys = [], []
    for start in starts.tolist():
        chunk = stream[start : start + seq_len + 1]
        xs.append(chunk[:-1])
        ys.append(chunk[1:])
    return torch.stack(xs).to(device), torch.stack(ys).to(device)


def resolve_device(name: str) -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def train(
    config: ForgeLMConfig,
    docs: List[str],
    *,
    out_dir: str,
    steps: int,
    batch_size: int,
    seq_len: int,
    learning_rate: float,
    device_name: str,
    seed: int,
) -> dict:
    random.seed(seed)
    torch.manual_seed(seed)
    device = resolve_device(device_name)
    tokenizer = load_tokenizer(tokenizer_path) if tokenizer_path else ByteTokenizer(config.vocab_size)\n    if tokenizer.vocab_size != config.vocab_size:\n        raise ValueError(\"tokenizer/model vocabulary mismatch\")
    stream = build_token_stream(tokenizer, docs)
    seq_len = min(int(seq_len), config.max_position_embeddings)
    model = ForgeLMForCausalLM(config).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, betas=(0.9, 0.95), weight_decay=0.1)
    losses = []
    model.train()
    for step in range(1, int(steps) + 1):
        x, y = sample_batch(stream, int(batch_size), seq_len, device)
        optimizer.zero_grad(set_to_none=True)
        output = model(x, targets=y)
        if output.loss is None or not torch.isfinite(output.loss):
            raise RuntimeError("non-finite training loss")
        output.loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        losses.append(float(output.loss.detach().cpu()))
        print(json.dumps({"step": step, "loss": losses[-1], "device": str(device)}), flush=True)
    manifest = save_checkpoint(
        out_dir,
        model,
        tokenizer,
        step=int(steps),
        optimizer=optimizer,
        metadata={
            "trainer": "forgelm-native-v1",
            "seed": seed,
            "documents": len(docs),
            "tokens": int(stream.numel()),
            "final_loss": losses[-1] if losses else None,
            "device": str(device),
        },
    )
    return {"manifest": manifest, "losses": losses, "device": str(device)}


def main() -> None:
    p = argparse.ArgumentParser(description="Train ForgeLM locally")
    p.add_argument("--config", default="config/forgelm-nano.json")
    p.add_argument("--corpus", nargs="+", required=True)
    p.add_argument("--out", default="state/models/forgelm-nano")
    p.add_argument("--steps", type=int, default=100)
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--seq-len", type=int, default=128)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--device", default="auto")
    p.add_argument("--seed", type=int, default=1337)
    args = p.parse_args()
    config = ForgeLMConfig.load_json(args.config)
    result = train(
        config,
        load_documents(args.corpus),
        out_dir=args.out,
        steps=args.steps,
        batch_size=args.batch_size,
        seq_len=args.seq_len,
        learning_rate=args.lr,
        device_name=args.device,
        seed=args.seed,
    )
    print(json.dumps({"ok": True, "checkpoint": args.out, "parameter_count": result["manifest"]["parameter_count"]}, indent=2))


if __name__ == "__main__":
    main()
