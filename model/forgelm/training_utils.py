from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
from typing import Any, Dict

import torch


@dataclass(frozen=True)
class PrecisionRuntime:
    device: torch.device
    precision: str
    dtype: torch.dtype | None

    def metadata(self) -> Dict[str, Any]:
        return {
            "device": str(self.device),
            "precision": self.precision,
            "autocast": self.dtype is not None,
            "dtype": str(self.dtype).replace("torch.", "") if self.dtype is not None else "float32",
        }


def resolve_device(name: str) -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def resolve_precision(device: torch.device, requested: str = "auto") -> PrecisionRuntime:
    requested = str(requested or "auto").lower()
    if requested not in {"auto", "fp32", "bf16", "fp16"}:
        raise ValueError("precision must be one of auto, fp32, bf16, fp16")

    if requested == "auto":
        if device.type == "cuda":
            if hasattr(torch.cuda, "is_bf16_supported") and torch.cuda.is_bf16_supported():
                requested = "bf16"
            else:
                requested = "fp16"
        else:
            requested = "fp32"

    if requested == "fp32":
        return PrecisionRuntime(device=device, precision="fp32", dtype=None)
    if requested == "bf16":
        if device.type != "cuda" or not hasattr(torch.cuda, "is_bf16_supported") or not torch.cuda.is_bf16_supported():
            raise ValueError("bf16 training is enabled only on CUDA devices that report bf16 support")
        return PrecisionRuntime(device=device, precision="bf16", dtype=torch.bfloat16)
    if requested == "fp16":
        if device.type != "cuda":
            raise ValueError("fp16 training is enabled only on CUDA; CPU/Termux must use fp32")
        return PrecisionRuntime(device=device, precision="fp16", dtype=torch.float16)
    raise AssertionError("unreachable precision state")


def autocast_context(runtime: PrecisionRuntime):
    if runtime.dtype is None:
        return nullcontext()
    return torch.autocast(device_type=runtime.device.type, dtype=runtime.dtype)


def make_grad_scaler(runtime: PrecisionRuntime):
    if runtime.precision != "fp16" or runtime.device.type != "cuda":
        return None
    try:
        return torch.amp.GradScaler("cuda", enabled=True)
    except Exception:
        return torch.cuda.amp.GradScaler(enabled=True)


def backward_loss(loss: torch.Tensor, scaler) -> None:
    if scaler is None:
        loss.backward()
    else:
        scaler.scale(loss).backward()


def optimizer_step(optimizer, model, scaler, *, max_grad_norm: float = 1.0) -> None:
    if scaler is not None:
        scaler.unscale_(optimizer)
    torch.nn.utils.clip_grad_norm_(model.parameters(), float(max_grad_norm))
    if scaler is None:
        optimizer.step()
    else:
        scaler.step(optimizer)
        scaler.update()


def normalize_accumulation_steps(value: int) -> int:
    value = int(value)
    if value < 1:
        raise ValueError("gradient accumulation steps must be >= 1")
    return value
