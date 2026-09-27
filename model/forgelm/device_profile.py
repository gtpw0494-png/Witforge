from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import sys
from typing import Any, Dict

import torch


GIB = 1024 ** 3


def _linux_memory() -> Dict[str, int | None]:
    path = Path("/proc/meminfo")
    if not path.is_file():
        return {"total_bytes": None, "available_bytes": None}
    values: Dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if ":" not in line:
            continue
        key, raw = line.split(":", 1)
        parts = raw.strip().split()
        if not parts:
            continue
        try:
            amount = int(parts[0])
        except ValueError:
            continue
        multiplier = 1024 if len(parts) > 1 and parts[1].lower() == "kb" else 1
        values[key] = amount * multiplier
    return {
        "total_bytes": values.get("MemTotal"),
        "available_bytes": values.get("MemAvailable"),
    }


def _fallback_memory() -> Dict[str, int | None]:
    try:
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        pages = int(os.sysconf("SC_PHYS_PAGES"))
        available_pages = int(os.sysconf("SC_AVPHYS_PAGES"))
        return {
            "total_bytes": page_size * pages,
            "available_bytes": page_size * available_pages,
        }
    except (ValueError, OSError, AttributeError):
        return {"total_bytes": None, "available_bytes": None}


def _memory() -> Dict[str, int | None]:
    linux = _linux_memory()
    return linux if linux["total_bytes"] else _fallback_memory()


def _cuda() -> Dict[str, Any]:
    available = bool(torch.cuda.is_available())
    result: Dict[str, Any] = {"available": available, "bf16_supported": False}
    if not available:
        return result
    result["device_count"] = int(torch.cuda.device_count())
    result["bf16_supported"] = bool(
        hasattr(torch.cuda, "is_bf16_supported") and torch.cuda.is_bf16_supported()
    )
    try:
        props = torch.cuda.get_device_properties(0)
        result["device_name"] = str(props.name)
        result["total_memory_bytes"] = int(props.total_memory)
    except Exception:
        pass
    return result


def _recommendations(total_memory: int | None, cpu_count: int, cuda: Dict[str, Any], is_termux: bool) -> Dict[str, Any]:
    gib = (total_memory or 0) / GIB
    if total_memory is None or gib <= 4:
        seq_len, grad_accum, shard_mb = 128, 8, 64
    elif gib <= 8:
        seq_len, grad_accum, shard_mb = 256, 4, 128
    elif gib <= 16:
        seq_len, grad_accum, shard_mb = 512, 2, 256
    else:
        seq_len, grad_accum, shard_mb = 1024, 1, 512

    if cuda.get("available"):
        precision = "bf16" if cuda.get("bf16_supported") else "fp16"
        quantization = "none"
    else:
        precision = "fp32"
        quantization = "dynamic-int8"

    return {
        "basis": "conservative memory heuristic; benchmark locally before increasing limits",
        "training": {
            "device": "cuda" if cuda.get("available") else "cpu",
            "precision": precision,
            "micro_batch_size": 1,
            "gradient_accumulation_steps": grad_accum,
            "sequence_length": seq_len,
            "max_shard_mb": shard_mb,
        },
        "inference": {
            "device": "cuda" if cuda.get("available") else "cpu",
            "quantization": quantization,
            "max_output_tokens_initial": min(128, max(32, seq_len // 2)),
        },
        "torch_threads_initial": max(1, min(cpu_count, 4 if is_termux else 8)),
    }


def profile_device() -> Dict[str, Any]:
    memory = _memory()
    cpu_count = int(os.cpu_count() or 1)
    is_termux = bool(os.environ.get("TERMUX_VERSION") or "com.termux" in os.environ.get("PREFIX", ""))
    is_android = bool(os.environ.get("ANDROID_ROOT") or os.environ.get("ANDROID_DATA"))
    cuda = _cuda()
    mps = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())

    accelerators = []
    if cuda.get("available"):
        accelerators.append("cuda")
    if mps:
        accelerators.append("mps")
    if not accelerators:
        accelerators.append("cpu")

    return {
        "schema": "witforge.forgelm.device-profile.v1",
        "platform": {
            "system": platform.system(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "is_android": is_android,
            "is_termux": is_termux,
        },
        "cpu": {
            "logical_cores": cpu_count,
            "torch_threads": int(torch.get_num_threads()),
        },
        "memory": memory,
        "torch": {
            "version": str(torch.__version__),
            "accelerators": accelerators,
            "cuda": cuda,
            "mps_available": mps,
        },
        "recommendations": _recommendations(memory.get("total_bytes"), cpu_count, cuda, is_termux),
        "truth": {
            "measured_fields_are_local_observations": True,
            "recommendations_are_heuristics": True,
            "benchmark_required_for_performance_claims": True,
        },
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Measure ForgeLM local device/Termux runtime profile")
    p.add_argument("--out")
    args = p.parse_args()
    result = profile_device()
    payload = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload, encoding="utf-8")
    print(payload, end="")


if __name__ == "__main__":
    main()
