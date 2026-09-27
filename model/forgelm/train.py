from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
from typing import Iterable, List

import torch

from .checkpoint import checkpoint_identity, load_training_checkpoint, save_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .dataset import verify_governed_dataset
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
                        role = str(m.get("role", "user")).lower()
                        content = str(m.get("content", ""))
                        tag = {
                            "system": "<|platform|>",
                            "developer": "<|developer|>",
                            "assistant": "<|assistant|>",
                            "tool": "<|tool_result|>",
                        }.get(role, "<|user|>")
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


def build_token_stream(tokenizer, docs: Iterable[str]) -> torch.Tensor:
    ids: List[int] = []
    for doc in docs:
        ids.extend(tokenizer.encode(doc, add_bos=True, add_eos=True))
    if not ids:
        raise ValueError("tokenizer produced an empty training stream")
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


def _same_config(a: ForgeLMConfig, b: ForgeLMConfig) -> bool:
    return a.to_dict() == b.to_dict()


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
    tokenizer_path: str | None = None,
    resume_dir: str | None = None,
) -> dict:
    random.seed(seed)
    torch.manual_seed(seed)
    device = resolve_device(device_name)
    start_step = 0
    parent_identity = None
    optimizer_state = None

    if resume_dir:
        model, tokenizer, previous_manifest, optimizer_state = load_training_checkpoint(resume_dir, device=device)
        if not _same_config(model.config, config):
            raise ValueError("resume checkpoint config does not match requested config")
        if tokenizer_path:
            explicit = load_tokenizer(tokenizer_path)
            if explicit.encode("ForgeLM resume check") != tokenizer.encode("ForgeLM resume check"):
                raise ValueError("explicit tokenizer does not match resume checkpoint tokenizer")
        start_step = int(previous_manifest.get("step", 0))
        parent_identity = checkpoint_identity(resume_dir)
    else:
        tokenizer = load_tokenizer(tokenizer_path) if tokenizer_path else ByteTokenizer(config.vocab_size)
        if tokenizer.vocab_size != config.vocab_size:
            raise ValueError("tokenizer/model vocabulary mismatch")
        model = ForgeLMForCausalLM(config).to(device)

    stream = build_token_stream(tokenizer, docs)
    seq_len = min(max(1, int(seq_len)), config.max_position_embeddings)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, betas=(0.9, 0.95), weight_decay=0.1)
    if optimizer_state is not None:
        optimizer.load_state_dict(optimizer_state)
        for group in optimizer.param_groups:
            group["lr"] = learning_rate

    losses = []
    model.train()
    for local_step in range(1, int(steps) + 1):
        global_step = start_step + local_step
        x, y = sample_batch(stream, int(batch_size), seq_len, device)
        optimizer.zero_grad(set_to_none=True)
        output = model(x, targets=y)
        if output.loss is None or not torch.isfinite(output.loss):
            raise RuntimeError("non-finite training loss")
        output.loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        losses.append(float(output.loss.detach().cpu()))
        print(json.dumps({"step": global_step, "loss": losses[-1], "device": str(device), "stage": "pretrain"}), flush=True)

    final_step = start_step + int(steps)
    manifest = save_checkpoint(
        out_dir,
        model,
        tokenizer,
        step=final_step,
        optimizer=optimizer,
        metadata={
            "trainer": "forgelm-pretrain-v2",
            "stage": "PRETRAIN",
            "seed": seed,
            "documents": len(docs),
            "tokens": int(stream.numel()),
            "final_loss": losses[-1] if losses else None,
            "device": str(device),
            "tokenizer_schema": getattr(tokenizer, "schema", "unknown"),
            "resumed_from": resume_dir,
            "parent_manifest_sha256": parent_identity,
        },
    )
    return {"manifest": manifest, "losses": losses, "device": str(device), "start_step": start_step, "final_step": final_step}


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
    p.add_argument("--tokenizer", help="ForgeLM tokenizer.json (byte or trained BPE)")
    p.add_argument("--dataset-report", help="Governed dataset report; requires exactly one corpus and verifies its SHA-256 before training")
    p.add_argument("--resume", help="Verified ForgeLM checkpoint to resume, including optimizer state when present")
    args = p.parse_args()

    if args.dataset_report:
        if len(args.corpus) != 1:
            raise ValueError("--dataset-report requires exactly one --corpus")
        verification = verify_governed_dataset(args.corpus[0], args.dataset_report)
        if not verification["ok"]:
            raise ValueError("governed dataset report hash verification failed")

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
        tokenizer_path=args.tokenizer,
        resume_dir=args.resume,
    )
    print(json.dumps({
        "ok": True,
        "checkpoint": args.out,
        "parameter_count": result["manifest"]["parameter_count"],
        "start_step": result["start_step"],
        "final_step": result["final_step"],
    }, indent=2))


if __name__ == "__main__":
    main()
