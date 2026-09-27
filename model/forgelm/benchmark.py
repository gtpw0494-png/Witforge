from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import resource
import time
from typing import Any, Dict

import torch

from .checkpoint import load_checkpoint
from .generation import generate
from .quantization import apply_inference_quantization, quantization_report


def _checkpoint_bytes(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def _rss() -> Dict[str, Any]:
    raw = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    system = platform.system().lower()
    bytes_value = raw if system == "darwin" else raw * 1024
    return {"ru_maxrss_raw": raw, "estimated_bytes": bytes_value, "platform": system}


def benchmark_checkpoint(
    checkpoint: str | Path,
    *,
    prompt: str = "Explain WitForge in one sentence.",
    max_new_tokens: int = 16,
    device: str = "cpu",
    quantization: str = "none",
    warmup_tokens: int = 1,
) -> Dict[str, Any]:
    checkpoint = Path(checkpoint)
    model, tokenizer, manifest = load_checkpoint(checkpoint, device=device)
    model = apply_inference_quantization(model, quantization)
    model_device = next(model.parameters()).device
    prompt_text = "<|user|>\n" + prompt.strip() + "\n<|end_turn|>\n<|assistant|>\n"
    prompt_ids = tokenizer.encode(prompt_text, add_bos=True)
    input_ids = torch.tensor([prompt_ids], dtype=torch.long, device=model_device)

    if warmup_tokens > 0:
        generate(
            model,
            input_ids,
            max_new_tokens=min(int(warmup_tokens), max(1, int(max_new_tokens))),
            eos_token_id=tokenizer.eos_token_id,
            temperature=0.0,
        )

    started = time.perf_counter()
    out = generate(
        model,
        input_ids,
        max_new_tokens=max(1, int(max_new_tokens)),
        eos_token_id=tokenizer.eos_token_id,
        temperature=0.0,
    )
    elapsed = max(time.perf_counter() - started, 1e-9)
    generated_tokens = int(out.shape[1] - input_ids.shape[1])
    report = {
        "schema": "witforge.forgelm.benchmark.v1",
        "checkpoint": str(checkpoint),
        "parameter_count": manifest.get("parameter_count"),
        "device": str(model_device),
        "quantization": quantization_report(model, quantization),
        "prompt_tokens": len(prompt_ids),
        "generated_tokens": generated_tokens,
        "elapsed_seconds": elapsed,
        "tokens_per_second": generated_tokens / elapsed,
        "checkpoint_bytes": _checkpoint_bytes(checkpoint),
        "process_memory": _rss(),
    }
    return report


def main() -> None:
    p = argparse.ArgumentParser(description="Benchmark ForgeLM local inference")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--prompt", default="Explain WitForge in one sentence.")
    p.add_argument("--max-new-tokens", type=int, default=16)
    p.add_argument("--device", default="cpu")
    p.add_argument("--quantization", choices=["none", "dynamic-int8"], default="none")
    p.add_argument("--out")
    args = p.parse_args()
    report = benchmark_checkpoint(
        args.checkpoint,
        prompt=args.prompt,
        max_new_tokens=args.max_new_tokens,
        device=args.device,
        quantization=args.quantization,
    )
    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload, encoding="utf-8")
    print(payload, end="")


if __name__ == "__main__":
    main()
