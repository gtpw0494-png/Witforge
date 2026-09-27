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
from .quality_eval import score_output
from .quantization import apply_inference_quantization


def _list_of_strings(value: Any, field: str) -> List[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(x, str) and x for x in value):
        raise ValueError(f"{field} must be an array of non-empty strings")
    return list(value)


def load_regression_cases(paths: Iterable[str]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for raw in paths:
        path = Path(raw)
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{n}: regression row must be an object")
            if row.get("approved") is not True:
                raise ValueError(f"{path}:{n}: regression row must be explicitly approved")
            prompt = str(row.get("prompt", "")).strip()
            category = str(row.get("category", "")).strip().upper()
            expect = row.get("expect")
            if not prompt or not category or not isinstance(expect, dict):
                raise ValueError(f"{path}:{n}: row needs prompt, category and expect")
            must_contain = _list_of_strings(row.get("must_contain"), "must_contain")
            must_not_contain = _list_of_strings(row.get("must_not_contain"), "must_not_contain")
            forbid_regex = _list_of_strings(row.get("forbid_regex"), "forbid_regex")
            secret = detect_secret(
                prompt
                + "\n"
                + json.dumps(
                    {
                        "expect": expect,
                        "must_contain": must_contain,
                        "must_not_contain": must_not_contain,
                        "forbid_regex": forbid_regex,
                    },
                    ensure_ascii=False,
                )
            )
            if secret:
                raise ValueError(f"{path}:{n}: secret-like material detected: {secret}")
            rows.append(
                {
                    "id": str(row.get("id") or f"{path.name}:{n}"),
                    "category": category,
                    "prompt": prompt,
                    "expect": expect,
                    "must_contain": must_contain,
                    "must_not_contain": must_not_contain,
                    "forbid_regex": forbid_regex,
                }
            )
    if not rows:
        raise ValueError("no approved regression-evaluation cases")
    return rows


def score_regression_output(case: Dict[str, Any], output: str) -> Dict[str, Any]:
    base = score_output(case["expect"], output)
    lowered = output.lower()
    missing = [x for x in case.get("must_contain", []) if x.lower() not in lowered]
    forbidden = [x for x in case.get("must_not_contain", []) if x.lower() in lowered]
    regex_hits = [
        pattern
        for pattern in case.get("forbid_regex", [])
        if re.search(pattern, output, flags=re.MULTILINE | re.IGNORECASE) is not None
    ]
    passed = bool(base["pass"]) and not missing and not forbidden and not regex_hits
    return {
        "pass": passed,
        "base_pass": bool(base["pass"]),
        "expect_type": base["expect_type"],
        "missing_required": missing,
        "forbidden_present": forbidden,
        "forbidden_regex_hits": regex_hits,
    }


def summarize_results(
    rows: List[Dict[str, Any]],
    *,
    min_pass_rate: float = 1.0,
    category_minimums: Dict[str, float] | None = None,
) -> Dict[str, Any]:
    if not 0.0 <= float(min_pass_rate) <= 1.0:
        raise ValueError("min_pass_rate must be between 0 and 1")
    category_minimums = {str(k).upper(): float(v) for k, v in (category_minimums or {}).items()}
    for category, value in category_minimums.items():
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"category minimum for {category} must be between 0 and 1")

    categories: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        category = str(row["category"]).upper()
        bucket = categories.setdefault(category, {"total": 0, "passed_cases": 0})
        bucket["total"] += 1
        if row.get("pass") is True:
            bucket["passed_cases"] += 1

    for category, bucket in categories.items():
        rate = bucket["passed_cases"] / bucket["total"] if bucket["total"] else 0.0
        minimum = category_minimums.get(category, float(min_pass_rate))
        bucket["pass_rate"] = rate
        bucket["minimum_pass_rate"] = minimum
        bucket["passed"] = rate >= minimum

    total = len(rows)
    passed_cases = sum(1 for row in rows if row.get("pass") is True)
    pass_rate = passed_cases / total if total else 0.0
    return {
        "total": total,
        "passed_cases": passed_cases,
        "pass_rate": pass_rate,
        "minimum_pass_rate": float(min_pass_rate),
        "categories": categories,
        "passed": pass_rate >= float(min_pass_rate) and all(x["passed"] for x in categories.values()),
    }


def run_regression_eval(
    checkpoint: str | Path,
    cases: List[Dict[str, Any]],
    *,
    device: str = "cpu",
    quantization: str = "none",
    max_new_tokens: int = 64,
    min_pass_rate: float = 1.0,
    category_minimums: Dict[str, float] | None = None,
) -> Dict[str, Any]:
    model, tokenizer, manifest = load_checkpoint(checkpoint, device=device)
    model = apply_inference_quantization(model, quantization)
    model_device = next(model.parameters()).device
    rows: List[Dict[str, Any]] = []

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
        scored = score_regression_output(case, output)
        rows.append(
            {
                "id": case["id"],
                "category": case["category"],
                "pass": scored["pass"],
                "expect_type": scored["expect_type"],
                "base_pass": scored["base_pass"],
                "missing_required": scored["missing_required"],
                "forbidden_present": scored["forbidden_present"],
                "forbidden_regex_hits": scored["forbidden_regex_hits"],
                "output": output[:2000],
            }
        )

    summary = summarize_results(rows, min_pass_rate=min_pass_rate, category_minimums=category_minimums)
    return {
        "schema": "witforge.forgelm.regression-report.v1",
        "checkpoint_manifest_sha256": checkpoint_identity(checkpoint),
        "weights_sha256": manifest.get("weights_sha256"),
        "quantization": quantization,
        **summary,
        "cases": rows,
    }


def parse_category_minimums(values: List[str]) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for item in values:
        if "=" not in item:
            raise ValueError("--category-min must use CATEGORY=RATE")
        category, raw = item.split("=", 1)
        category = category.strip().upper()
        if not category:
            raise ValueError("--category-min category must not be empty")
        result[category] = float(raw)
    return result


def main() -> None:
    p = argparse.ArgumentParser(description="Run ForgeLM category-aware regression evaluations")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--data", nargs="+", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--device", default="cpu")
    p.add_argument("--quantization", choices=["none", "dynamic-int8"], default="none")
    p.add_argument("--max-new-tokens", type=int, default=64)
    p.add_argument("--min-pass-rate", type=float, default=1.0)
    p.add_argument("--category-min", action="append", default=[], help="CATEGORY=RATE; may be repeated")
    args = p.parse_args()

    report = run_regression_eval(
        args.checkpoint,
        load_regression_cases(args.data),
        device=args.device,
        quantization=args.quantization,
        max_new_tokens=args.max_new_tokens,
        min_pass_rate=args.min_pass_rate,
        category_minimums=parse_category_minimums(args.category_min),
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
