from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
from typing import Any, Dict, Iterable, List, Tuple

import torch

from .checkpoint import checkpoint_identity, load_training_checkpoint, save_checkpoint
from .dataset import detect_secret
from .training_utils import (
    autocast_context,
    backward_loss,
    make_grad_scaler,
    normalize_accumulation_steps,
    optimizer_step,
    resolve_device,
    resolve_precision,
)


ROLE_TAGS = {
    "system": "<|platform|>",
    "developer": "<|developer|>",
    "user": "<|user|>",
    "assistant": "<|assistant|>",
    "tool": "<|tool_result|>",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def render_messages(messages: Iterable[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("SFT messages must be objects")
        role = str(message.get("role", "user")).lower()
        content = str(message.get("content", "")).strip()
        if not content:
            continue
        parts.append(f"{ROLE_TAGS.get(role, '<|user|>')}\n{content}\n<|end_turn|>")
    return "\n".join(parts)


def normalize_record(row: Dict[str, Any]) -> Tuple[str, str, str]:
    if row.get("approved") is not True:
        raise ValueError("SFT row is not explicitly approved")
    messages = row.get("messages")
    if isinstance(messages, list):
        prompt = render_messages(messages)
    else:
        prompt = str(row.get("prompt", "")).strip()
        if prompt:
            prompt = f"<|user|>\n{prompt}\n<|end_turn|>"
    if not prompt:
        raise ValueError("SFT row has no prompt/messages")

    kind = str(row.get("kind", "CHAT")).upper()
    if isinstance(row.get("tool_call"), dict):
        kind = "TOOL_CALL"
        target = "<|tool_call|>\n<|json|>" + canonical_json(row["tool_call"]) + "<|end_json|>\n<|end_turn|>"
    else:
        response = str(row.get("response", row.get("assistant", ""))).strip()
        if not response:
            raise ValueError("SFT row has no response/tool_call")
        target = "<|assistant|>\n" + response + "\n<|end_turn|>"

    secret = detect_secret(prompt + "\n" + target)
    if secret:
        raise ValueError(f"SFT row contains secret-like material: {secret}")
    return prompt + "\n", target, kind


def load_sft_records(paths: Iterable[str]) -> List[Dict[str, str]]:
    records: List[Dict[str, str]] = []
    for raw in paths:
        path = Path(raw)
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{n}: row must be an object")
            prompt, target, kind = normalize_record(row)
            records.append({"prompt": prompt, "target": target, "kind": kind})
    if not records:
        raise ValueError("no approved SFT records")
    return records


def encode_record(tokenizer, record: Dict[str, str], max_length: int) -> Tuple[torch.Tensor, torch.Tensor]:
    prompt_ids = tokenizer.encode(record["prompt"], add_bos=True)
    target_ids = tokenizer.encode(record["target"], add_eos=True)
    ids = (prompt_ids + target_ids)[: max(2, int(max_length))]
    if len(ids) < 2:
        raise ValueError("SFT example is too short after tokenization")
    x = torch.tensor(ids[:-1], dtype=torch.long)
    y = torch.tensor(ids[1:], dtype=torch.long)
    prompt_prediction_count = max(0, min(len(prompt_ids) - 1, y.numel()))
    if prompt_prediction_count:
        y[:prompt_prediction_count] = -100
    if bool((y != -100).sum().item()) is False:
        raise ValueError("SFT target was truncated away; increase max_length")
    return x, y


def make_batch(tokenizer, records: List[Dict[str, str]], indices: List[int], max_length: int, device: torch.device):
    encoded = [encode_record(tokenizer, records[i], max_length) for i in indices]
    width = max(x.numel() for x, _ in encoded)
    xs = torch.full((len(encoded), width), tokenizer.pad_token_id, dtype=torch.long)
    ys = torch.full((len(encoded), width), -100, dtype=torch.long)
    for i, (x, y) in enumerate(encoded):
        xs[i, :x.numel()] = x
        ys[i, :y.numel()] = y
    return xs.to(device), ys.to(device)


def train_sft(
    checkpoint: str,
    records: List[Dict[str, str]],
    *,
    out_dir: str,
    steps: int = 100,
    batch_size: int = 2,
    learning_rate: float = 1e-4,
    max_length: int | None = None,
    device: str = "cpu",
    seed: int = 1337,
    precision: str = "auto",
    gradient_accumulation_steps: int = 1,
) -> Dict[str, Any]:
    random.seed(seed)
    torch.manual_seed(seed)
    runtime = resolve_precision(resolve_device(device), precision)
    accumulation = normalize_accumulation_steps(gradient_accumulation_steps)
    model, tokenizer, manifest, optimizer_state = load_training_checkpoint(checkpoint, device=runtime.device)
    max_length = min(int(max_length or model.config.max_position_embeddings), model.config.max_position_embeddings)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, betas=(0.9, 0.95), weight_decay=0.1)
    if optimizer_state is not None and str(manifest.get("metadata", {}).get("stage", "")).upper() == "SFT":
        optimizer.load_state_dict(optimizer_state)
        for group in optimizer.param_groups:
            group["lr"] = learning_rate
    scaler = make_grad_scaler(runtime)

    start_step = int(manifest.get("step", 0))
    losses: List[float] = []
    model.train()
    for local_step in range(1, int(steps) + 1):
        optimizer.zero_grad(set_to_none=True)
        micro_losses: List[float] = []
        for _ in range(accumulation):
            indices = [random.randrange(len(records)) for _ in range(max(1, int(batch_size)))]
            x, y = make_batch(tokenizer, records, indices, max_length, runtime.device)
            with autocast_context(runtime):
                out = model(x, targets=y)
                if out.loss is None or not torch.isfinite(out.loss):
                    raise RuntimeError("non-finite SFT loss")
                scaled_loss = out.loss / accumulation
            micro_losses.append(float(out.loss.detach().float().cpu()))
            backward_loss(scaled_loss, scaler)
        optimizer_step(optimizer, model, scaler, max_grad_norm=1.0)
        step_loss = sum(micro_losses) / len(micro_losses)
        losses.append(step_loss)
        print(json.dumps({
            "step": start_step + local_step,
            "loss": step_loss,
            "stage": "SFT",
            "precision": runtime.precision,
            "grad_accum": accumulation,
        }), flush=True)

    final_step = start_step + int(steps)
    next_manifest = save_checkpoint(
        out_dir,
        model,
        tokenizer,
        step=final_step,
        optimizer=optimizer,
        metadata={
            "trainer": "forgelm-sft-v2",
            "stage": "SFT",
            "records": len(records),
            "chat_records": sum(r["kind"] != "TOOL_CALL" for r in records),
            "tool_records": sum(r["kind"] == "TOOL_CALL" for r in records),
            "final_loss": losses[-1] if losses else None,
            "precision": runtime.precision,
            "precision_runtime": runtime.metadata(),
            "gradient_accumulation_steps": accumulation,
            "micro_batch_size": int(batch_size),
            "effective_batch_size": int(batch_size) * accumulation,
            "parent_checkpoint": checkpoint,
            "parent_manifest_sha256": checkpoint_identity(checkpoint),
        },
    )
    return {"manifest": next_manifest, "losses": losses, "precision": runtime.precision}


def main() -> None:
    p = argparse.ArgumentParser(description="ForgeLM supervised/tool SFT")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--data", nargs="+", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--steps", type=int, default=100)
    p.add_argument("--batch-size", type=int, default=2, help="micro-batch size")
    p.add_argument("--grad-accum", type=int, default=1)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--max-length", type=int)
    p.add_argument("--device", default="cpu")
    p.add_argument("--precision", choices=["auto", "fp32", "bf16", "fp16"], default="auto")
    p.add_argument("--seed", type=int, default=1337)
    args = p.parse_args()
    result = train_sft(
        args.checkpoint,
        load_sft_records(args.data),
        out_dir=args.out,
        steps=args.steps,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        max_length=args.max_length,
        device=args.device,
        seed=args.seed,
        precision=args.precision,
        gradient_accumulation_steps=args.grad_accum,
    )
    print(json.dumps({
        "ok": True,
        "checkpoint": args.out,
        "step": result["manifest"]["step"],
        "precision": result["precision"],
    }, indent=2))


if __name__ == "__main__":
    main()
