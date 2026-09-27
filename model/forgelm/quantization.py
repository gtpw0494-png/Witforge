from __future__ import annotations

import io
from typing import Any, Dict

import torch
from torch import nn


SUPPORTED_QUANTIZATION = {"none", "dynamic-int8"}


def normalize_quantization(mode: str | None) -> str:
    mode = str(mode or "none").lower()
    if mode not in SUPPORTED_QUANTIZATION:
        raise ValueError("quantization must be one of: " + ", ".join(sorted(SUPPORTED_QUANTIZATION)))
    return mode


def apply_inference_quantization(model, mode: str = "none"):
    mode = normalize_quantization(mode)
    if mode == "none":
        model.eval()
        return model
    device = next(model.parameters()).device
    if device.type != "cpu":
        raise ValueError("dynamic-int8 quantization is CPU-only; load the model on cpu first")
    if not hasattr(torch, "ao") or not hasattr(torch.ao, "quantization"):
        raise RuntimeError("this PyTorch build does not expose torch.ao.quantization")
    quantized = torch.ao.quantization.quantize_dynamic(
        model,
        {nn.Linear},
        dtype=torch.qint8,
        inplace=False,
    )
    quantized.eval()
    return quantized


def quantization_report(model, mode: str) -> Dict[str, Any]:
    mode = normalize_quantization(mode)
    quantized_linears = 0
    if mode == "dynamic-int8":
        for module in model.modules():
            module_name = module.__class__.__module__.lower()
            class_name = module.__class__.__name__.lower()
            if "quantized" in module_name and "linear" in class_name:
                quantized_linears += 1
    buf = io.BytesIO()
    torch.save(model.state_dict(), buf)
    return {
        "mode": mode,
        "quantized_linear_layers": quantized_linears,
        "state_dict_bytes": len(buf.getvalue()),
    }
