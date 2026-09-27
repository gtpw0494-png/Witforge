from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict

import torch

from .checkpoint import checkpoint_identity, load_checkpoint, verify_checkpoint
from .dataset import detect_secret
from .generation import generate
from .structured import compile_finite_json_schema, constraint_for_schema


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run_release_evals(checkpoint: str | Path, *, device: str = "cpu") -> Dict[str, Any]:
    checks = []
    verification = verify_checkpoint(checkpoint)
    checks.append({"name": "checkpoint_hashes", "pass": bool(verification.get("ok"))})
    if not verification.get("ok"):
        return {
            "schema": "witforge.forgelm.eval-report.v1",
            "checkpoint_manifest_sha256": None,
            "passed": False,
            "checks": checks,
        }

    model, tokenizer, manifest = load_checkpoint(checkpoint, device=device)
    prompt_text = "<|user|>ForgeLM release probe<|end_turn|><|assistant|>"
    prompt = torch.tensor([tokenizer.encode(prompt_text, add_bos=True)], dtype=torch.long, device=next(model.parameters()).device)
    with torch.inference_mode():
        logits = model(prompt).logits
    checks.append({"name": "finite_logits", "pass": bool(torch.isfinite(logits).all().item())})

    generated = generate(model, prompt, max_new_tokens=2, eos_token_id=tokenizer.eos_token_id, temperature=0.0)
    checks.append({"name": "autoregressive_generation", "pass": generated.shape[1] > prompt.shape[1]})

    roundtrip_text = "WitForge ✓ UTF-8"
    checks.append({"name": "tokenizer_roundtrip", "pass": tokenizer.decode(tokenizer.encode(roundtrip_text)) == roundtrip_text})

    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "mode": {"type": "string", "enum": ["RESPOND", "TOOLS"]},
            "approved": {"type": "boolean"},
        },
        "required": ["mode", "approved"],
    }
    candidates = compile_finite_json_schema(schema)
    constraint = constraint_for_schema(tokenizer, schema, prompt_length=prompt.shape[1])
    checks.append({"name": "finite_json_schema_compiles", "pass": len(candidates) == 4 and bool(list(constraint.root.keys()))})

    checks.append({"name": "release_metadata_has_no_secret", "pass": detect_secret(json.dumps(manifest, ensure_ascii=False)) is None})
    passed = all(x["pass"] for x in checks)
    return {
        "schema": "witforge.forgelm.eval-report.v1",
        "checkpoint_manifest_sha256": checkpoint_identity(checkpoint),
        "weights_sha256": manifest.get("weights_sha256"),
        "parameter_count": manifest.get("parameter_count"),
        "step": manifest.get("step"),
        "passed": passed,
        "checks": checks,
    }


def main() -> None:
    p = argparse.ArgumentParser(description="ForgeLM release evaluation gates")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--device", default="cpu")
    args = p.parse_args()
    report = run_release_evals(args.checkpoint, device=args.device)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
