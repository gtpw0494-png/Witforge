from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any, Dict, Iterable, List

import torch

from .checkpoint import checkpoint_identity, load_checkpoint
from .dataset import detect_secret
from .generation import generate
from .quantization import apply_inference_quantization
from .structured import UnsupportedSchema, compile_finite_json_schema


def score_output(expect: Dict[str, Any], output: str) -> Dict[str, Any]:
    kind = str(expect.get("type", "")).lower()
    if kind == "exact":
        passed = output.strip() == str(expect.get("value", "")).strip()
    elif kind == "contains":
        passed = str(expect.get("value", "")).lower() in output.lower()
    elif kind == "regex":
        passed = re.search(str(expect.get("value", "")), output, flags=re.MULTILINE) is not None
    elif kind == "finite_json_schema":
        schema = expect.get("schema")
        if not isinstance(schema, dict):
            raise ValueError("finite_json_schema expectation requires schema")
        try:
            candidates = compile_finite_json_schema(schema, max_candidates=1024)
        except UnsupportedSchema as exc:
            raise ValueError("quality eval schema is not finite: " + str(exc))
        try:
            parsed = json.loads(output)
            canonical = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
        except Exception:
            canonical = None
        passed = canonical in set(candidates)
    else:
        raise ValueError("expect.type must be exact, contains, regex, or finite_json_schema")
    return {"pass": bool(passed), "expect_type": kind}


def load_quality_cases(paths: Iterable[str]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for raw in paths:
        path = Path(raw)
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{n}: quality row must be an object")
            if row.get("approved") is not True:
                raise ValueError(f"{path}:{n}: quality row must be explicitly approved")
            prompt = str(row.get("prompt", "")).strip()
            expect = row.get("expect")
            if not prompt or not isinstance(expect, dict):
                raise ValueError(f"{path}:{n}: quality row needs prompt and expect")
            secret = detect_secret(prompt + "\n" + json.dumps(expect, ensure_ascii=False))
            if secret:
                raise ValueError(f"{path}:{n}: secret-like material detected: {secret}")
            rows.append({
                "id": str(row.get("id") or f"{path.name}:{n}"),
                "prompt": prompt,
                "expect": expect,
            })
    if not rows:
        raise ValueError("no approved quality-evaluation cases")
    return rows


def run_quality_eval(
    checkpoint: str | Path,
    cases: List[Dict[str, Any]],
    *,
    device: str = "cpu",
    quantization: str = "none",
    max_new_tokens: int = 64,
    min_pass_rate: float = 1.0,
) -> Dict[str, Any]:
    if not 0.0 <= float(min_pass_rate) <= 1.0:
        raise ValueError("min_pass_rate must be between 0 and 1")
    model, tokenizer, manifest = load_checkpoint(checkpoint, device=device)
    model = apply_inference_quantization(model, quantization)
    model_device = next(model.parameters()).device
    rows = []
    passed = 0
    for case in cases:
        prompt_text = "<|user|>\n" + case["prompt"] + "\n<|end_turn|>\n<|assistant|>\n"
        prompt_ids = tokenizer.encode(prompt_text, add_bos=True)
        input_ids = torch.tensor([prompt_ids], dtype=torch.long, device=model_device)
        out = generate(
            model,
            input_ids,
            max_new_tokens=max(1, int(max_new_tokens)),
            eos_token_id=tokenizer.eos_token_id,
            temperature=0.0,
        )
        output = tokenizer.decode(out[0, input_ids.shape[1]:].tolist(), skip_special_tokens=True).strip()
        scored = score_output(case["expect"], output)
        if scored["pass"]:
            passed += 1
        rows.append({
            "id": case["id"],
            "pass": scored["pass"],
            "expect_type": scored["expect_type"],
            "output": output[:2000],
        })
    total = len(rows)
    pass_rate = passed / total if total else 0.0
    return {
        "schema": "witforge.forgelm.quality-report.v1",
        "checkpoint_manifest_sha256": checkpoint_identity(checkpoint),
        "weights_sha256": manifest.get("weights_sha256"),
        "quantization": quantization,
        "total": total,
        "passed_cases": passed,
        "pass_rate": pass_rate,
        "minimum_pass_rate": float(min_pass_rate),
        "passed": pass_rate >= float(min_pass_rate),
        "cases": rows,
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Run ForgeLM checkpoint quality evaluations")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--data", nargs="+", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--device", default="cpu")
    p.add_argument("--quantization", choices=["none", "dynamic-int8"], default="none")
    p.add_argument("--max-new-tokens", type=int, default=64)
    p.add_argument("--min-pass-rate", type=float, default=1.0)
    args = p.parse_args()
    report = run_quality_eval(
        args.checkpoint,
        load_quality_cases(args.data),
        device=args.device,
        quantization=args.quantization,
        max_new_tokens=args.max_new_tokens,
        min_pass_rate=args.min_pass_rate,
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
