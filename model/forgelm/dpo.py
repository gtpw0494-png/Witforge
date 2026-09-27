from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
from typing import Any, Dict, Iterable, List, Tuple

import torch
import torch.nn.functional as F

from .checkpoint import checkpoint_identity, load_checkpoint, save_checkpoint
from .dataset import detect_secret
from .sft import render_messages


def load_preferences(paths: Iterable[str]) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    for raw in paths:
        path = Path(raw)
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{n}: row must be an object")
            if row.get("approved") is not True:
                raise ValueError(f"{path}:{n}: preference row is not approved")
            prompt = render_messages(row["messages"]) if isinstance(row.get("messages"), list) else str(row.get("prompt", "")).strip()
            chosen = str(row.get("chosen", "")).strip()
            rejected = str(row.get("rejected", "")).strip()
            if not prompt or not chosen or not rejected or chosen == rejected:
                raise ValueError(f"{path}:{n}: preference needs prompt, distinct chosen and rejected")
            secret = detect_secret(prompt + "\n" + chosen + "\n" + rejected)
            if secret:
                raise ValueError(f"{path}:{n}: secret-like material detected: {secret}")
            rows.append({"prompt": prompt, "chosen": chosen, "rejected": rejected})
    if not rows:
        raise ValueError("no approved preference rows")
    return rows


def encode_response(tokenizer, prompt: str, response: str, max_length: int) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    p = tokenizer.encode(prompt + "\n<|assistant|>\n", add_bos=True)
    r = tokenizer.encode(response + "\n<|end_turn|>", add_eos=True)
    ids = (p + r)[:max(2, int(max_length))]
    x = torch.tensor([ids[:-1]], dtype=torch.long)
    y = torch.tensor([ids[1:]], dtype=torch.long)
    mask = torch.zeros_like(y, dtype=torch.bool)
    start = max(0, len(p) - 1)
    if start < y.shape[1]:
        mask[:, start:] = True
    if not bool(mask.any().item()):
        raise ValueError("preference response was truncated away")
    return x, y, mask


def sequence_logprob(model, tokenizer, prompt: str, response: str, max_length: int) -> torch.Tensor:
    x, targets, mask = encode_response(tokenizer, prompt, response, max_length)
    device = next(model.parameters()).device
    x, targets, mask = x.to(device), targets.to(device), mask.to(device)
    logits = model(x).logits
    logp = F.log_softmax(logits, dim=-1).gather(-1, targets.unsqueeze(-1)).squeeze(-1)
    return (logp * mask).sum(dim=-1).mean()


def dpo_loss(
    policy,
    reference,
    tokenizer,
    row: Dict[str, str],
    *,
    beta: float,
    max_length: int,
) -> torch.Tensor:
    pi_c = sequence_logprob(policy, tokenizer, row["prompt"], row["chosen"], max_length)
    pi_r = sequence_logprob(policy, tokenizer, row["prompt"], row["rejected"], max_length)
    with torch.no_grad():
        ref_c = sequence_logprob(reference, tokenizer, row["prompt"], row["chosen"], max_length)
        ref_r = sequence_logprob(reference, tokenizer, row["prompt"], row["rejected"], max_length)
    advantage = (pi_c - pi_r) - (ref_c - ref_r)
    return -F.logsigmoid(float(beta) * advantage)


def train_dpo(
    checkpoint: str,
    preferences: List[Dict[str, str]],
    *,
    out_dir: str,
    reference_checkpoint: str | None = None,
    steps: int = 50,
    learning_rate: float = 5e-6,
    beta: float = 0.1,
    max_length: int | None = None,
    device: str = "cpu",
    seed: int = 1337,
) -> Dict[str, Any]:
    random.seed(seed)
    torch.manual_seed(seed)
    policy, tokenizer, manifest = load_checkpoint(checkpoint, device=device)
    reference, reference_tok, _ = load_checkpoint(reference_checkpoint or checkpoint, device=device)
    if reference_tok.encode("ForgeLM DPO check") != tokenizer.encode("ForgeLM DPO check"):
        raise ValueError("policy/reference tokenizers differ")
    for p in reference.parameters():
        p.requires_grad_(False)
    reference.eval()
    policy.train()
    max_length = min(int(max_length or policy.config.max_position_embeddings), policy.config.max_position_embeddings)
    optimizer = torch.optim.AdamW(policy.parameters(), lr=learning_rate, betas=(0.9, 0.95), weight_decay=0.0)
    losses: List[float] = []
    start_step = int(manifest.get("step", 0))

    for local_step in range(1, int(steps) + 1):
        row = preferences[random.randrange(len(preferences))]
        optimizer.zero_grad(set_to_none=True)
        loss = dpo_loss(policy, reference, tokenizer, row, beta=beta, max_length=max_length)
        if not torch.isfinite(loss):
            raise RuntimeError("non-finite DPO loss")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
        optimizer.step()
        losses.append(float(loss.detach().cpu()))
        print(json.dumps({"step": start_step + local_step, "loss": losses[-1], "stage": "DPO"}), flush=True)

    final_step = start_step + int(steps)
    next_manifest = save_checkpoint(
        out_dir,
        policy,
        tokenizer,
        step=final_step,
        optimizer=optimizer,
        metadata={
            "trainer": "forgelm-dpo-v1",
            "stage": "DPO",
            "preference_rows": len(preferences),
            "beta": beta,
            "final_loss": losses[-1] if losses else None,
            "parent_checkpoint": checkpoint,
            "parent_manifest_sha256": checkpoint_identity(checkpoint),
            "reference_checkpoint": reference_checkpoint or checkpoint,
            "reference_manifest_sha256": checkpoint_identity(reference_checkpoint or checkpoint),
        },
    )
    return {"manifest": next_manifest, "losses": losses}


def main() -> None:
    p = argparse.ArgumentParser(description="ForgeLM Direct Preference Optimization")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--reference")
    p.add_argument("--data", nargs="+", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--steps", type=int, default=50)
    p.add_argument("--lr", type=float, default=5e-6)
    p.add_argument("--beta", type=float, default=0.1)
    p.add_argument("--max-length", type=int)
    p.add_argument("--device", default="cpu")
    p.add_argument("--seed", type=int, default=1337)
    args = p.parse_args()
    result = train_dpo(
        args.checkpoint,
        load_preferences(args.data),
        out_dir=args.out,
        reference_checkpoint=args.reference,
        steps=args.steps,
        learning_rate=args.lr,
        beta=args.beta,
        max_length=args.max_length,
        device=args.device,
        seed=args.seed,
    )
    print(json.dumps({"ok": True, "checkpoint": args.out, "step": result["manifest"]["step"]}, indent=2))


if __name__ == "__main__":
    main()
