from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any, Dict, Iterable, List

from .checkpoint import checkpoint_identity
from .device_profile import profile_device


def _unique(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    for value in values:
        item = str(value).strip().lower()
        if item and item not in out:
            out.append(item)
    return out


def select_recommendation(
    cases: List[Dict[str, Any]],
    *,
    available_memory_bytes: int | None,
    memory_fraction: float = 0.60,
) -> Dict[str, Any]:
    memory_fraction = float(memory_fraction)
    if not 0.10 <= memory_fraction <= 0.95:
        raise ValueError("memory_fraction must be between 0.10 and 0.95")

    successful = [
        case for case in cases
        if case.get("ok") is True and float(case.get("tokens_per_second") or 0.0) > 0.0
    ]
    if not successful:
        return {
            "ok": False,
            "reason": "no successful benchmark cases",
            "memory_budget_bytes": None,
        }

    budget = int(available_memory_bytes * memory_fraction) if available_memory_bytes else None
    if budget is None:
        eligible = list(successful)
        basis = "fastest successful measured case; memory availability was unavailable"
    else:
        eligible = [
            case for case in successful
            if int((case.get("process_memory") or {}).get("estimated_bytes") or 0) <= budget
        ]
        if eligible:
            basis = f"fastest successful case within {memory_fraction:.0%} of observed available memory"
        else:
            eligible = list(successful)
            basis = "no measured case fit the conservative memory budget; selected the lowest-memory successful case"
            eligible.sort(
                key=lambda case: (
                    int((case.get("process_memory") or {}).get("estimated_bytes") or 2**63),
                    -float(case.get("tokens_per_second") or 0.0),
                )
            )
            chosen = eligible[0]
            return {
                "ok": True,
                "basis": basis,
                "memory_budget_bytes": budget,
                "cache_strategy": chosen["cache_strategy"],
                "quantization": chosen["quantization"]["mode"],
                "tokens_per_second": chosen["tokens_per_second"],
                "process_memory_bytes": (chosen.get("process_memory") or {}).get("estimated_bytes"),
                "peak_kv_cache_bytes": (chosen.get("generation") or {}).get("peak_kv_cache_bytes"),
            }

    chosen = max(
        eligible,
        key=lambda case: (
            float(case.get("tokens_per_second") or 0.0),
            -int((case.get("process_memory") or {}).get("estimated_bytes") or 2**63),
        ),
    )
    return {
        "ok": True,
        "basis": basis,
        "memory_budget_bytes": budget,
        "cache_strategy": chosen["cache_strategy"],
        "quantization": chosen["quantization"]["mode"],
        "tokens_per_second": chosen["tokens_per_second"],
        "process_memory_bytes": (chosen.get("process_memory") or {}).get("estimated_bytes"),
        "peak_kv_cache_bytes": (chosen.get("generation") or {}).get("peak_kv_cache_bytes"),
    }


def _run_case(
    checkpoint: Path,
    *,
    prompt: str,
    max_new_tokens: int,
    device: str,
    quantization: str,
    cache_strategy: str,
    warmup_tokens: int,
    timeout_seconds: int,
) -> Dict[str, Any]:
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="forgelm-tune-case-") as td:
        report_path = Path(td) / "benchmark.json"
        cmd = [
            sys.executable,
            "-m",
            "model.forgelm.benchmark",
            "--checkpoint",
            str(checkpoint),
            "--prompt",
            prompt,
            "--max-new-tokens",
            str(max(1, int(max_new_tokens))),
            "--device",
            device,
            "--quantization",
            quantization,
            "--cache-strategy",
            cache_strategy,
            "--out",
            str(report_path),
        ]
        if warmup_tokens == 0:
            cmd.extend(["--warmup-tokens", "0"])
        try:
            proc = subprocess.run(
                cmd,
                cwd=root,
                capture_output=True,
                text=True,
                timeout=max(10, int(timeout_seconds)),
                check=False,
            )
        except subprocess.TimeoutExpired:
            return {
                "ok": False,
                "quantization": quantization,
                "cache_strategy": cache_strategy,
                "error": "benchmark timeout",
            }

        if proc.returncode != 0 or not report_path.is_file():
            detail = (proc.stderr or proc.stdout or "benchmark failed").strip()
            return {
                "ok": False,
                "quantization": quantization,
                "cache_strategy": cache_strategy,
                "error": detail[-1000:],
            }

        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["ok"] = True
        report["subprocess_isolated"] = True
        return report


def autotune_checkpoint(
    checkpoint: str | Path,
    *,
    prompt: str = "Explain WitForge in one sentence.",
    max_new_tokens: int = 8,
    device: str = "cpu",
    quantizations: Iterable[str] | None = None,
    cache_strategies: Iterable[str] = ("dynamic", "none"),
    warmup_tokens: int = 1,
    memory_fraction: float = 0.60,
    timeout_seconds: int = 120,
) -> Dict[str, Any]:
    checkpoint = Path(checkpoint)
    profile = profile_device()
    caches = _unique(cache_strategies)
    if not caches or any(x not in {"dynamic", "none"} for x in caches):
        raise ValueError("cache_strategies must contain only dynamic or none")

    if quantizations is None:
        quants = ["none", "dynamic-int8"] if device == "cpu" else ["none"]
    else:
        quants = _unique(quantizations)
    if not quants or any(x not in {"none", "dynamic-int8"} for x in quants):
        raise ValueError("quantizations must contain only none or dynamic-int8")
    if device != "cpu" and "dynamic-int8" in quants:
        raise ValueError("dynamic-int8 autotuning is CPU-only")

    cases: List[Dict[str, Any]] = []
    for quantization in quants:
        for cache_strategy in caches:
            cases.append(
                _run_case(
                    checkpoint,
                    prompt=prompt,
                    max_new_tokens=max_new_tokens,
                    device=device,
                    quantization=quantization,
                    cache_strategy=cache_strategy,
                    warmup_tokens=warmup_tokens,
                    timeout_seconds=timeout_seconds,
                )
            )

    recommendation = select_recommendation(
        cases,
        available_memory_bytes=(profile.get("memory") or {}).get("available_bytes"),
        memory_fraction=memory_fraction,
    )
    return {
        "schema": "witforge.forgelm.autotune-report.v1",
        "checkpoint": str(checkpoint),
        "checkpoint_manifest_sha256": checkpoint_identity(checkpoint),
        "device_profile": profile,
        "matrix": {
            "quantizations": quants,
            "cache_strategies": caches,
            "cases": cases,
        },
        "recommendation": recommendation,
        "truth": {
            "cases_are_subprocess_isolated_measurements": True,
            "recommendation_is_advisory": True,
            "serving_configuration_is_not_changed_automatically": True,
        },
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Measure ForgeLM local inference combinations and recommend a runtime profile")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--prompt", default="Explain WitForge in one sentence.")
    p.add_argument("--max-new-tokens", type=int, default=8)
    p.add_argument("--device", default="cpu")
    p.add_argument("--quantization", dest="quantizations", action="append", choices=["none", "dynamic-int8"])
    p.add_argument("--cache-strategy", dest="cache_strategies", action="append", choices=["dynamic", "none"])
    p.add_argument("--warmup-tokens", type=int, default=1)
    p.add_argument("--memory-fraction", type=float, default=0.60)
    p.add_argument("--timeout-seconds", type=int, default=120)
    p.add_argument("--out")
    args = p.parse_args()

    report = autotune_checkpoint(
        args.checkpoint,
        prompt=args.prompt,
        max_new_tokens=args.max_new_tokens,
        device=args.device,
        quantizations=args.quantizations,
        cache_strategies=args.cache_strategies or ("dynamic", "none"),
        warmup_tokens=args.warmup_tokens,
        memory_fraction=args.memory_fraction,
        timeout_seconds=args.timeout_seconds,
    )
    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload, encoding="utf-8")
    print(payload, end="")
    if not report["recommendation"].get("ok"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
