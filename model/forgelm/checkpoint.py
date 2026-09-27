from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import torch

from .configuration_forgelm import ForgeLMConfig
from .modeling_forgelm import ForgeLMForCausalLM
from .tokenizer import load_tokenizer


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def checkpoint_identity(directory: str | Path) -> str:
    target = Path(directory)
    manifest = target / "manifest.json"
    if not manifest.is_file():
        raise FileNotFoundError(manifest)
    return sha256_file(manifest)


def save_checkpoint(
    directory: str | Path,
    model: ForgeLMForCausalLM,
    tokenizer,
    *,
    step: int = 0,
    optimizer: Optional[torch.optim.Optimizer] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    config_path = target / "config.json"
    tokenizer_path = target / "tokenizer.json"
    weights_path = target / "model.pt"
    model.config.save_json(config_path)
    tokenizer.save(tokenizer_path)
    torch.save(model.state_dict(), weights_path)
    optimizer_path = None
    if optimizer is not None:
        optimizer_path = target / "optimizer.pt"
        torch.save(optimizer.state_dict(), optimizer_path)

    manifest = {
        "schema": "witforge.forgelm.checkpoint.v1",
        "model_type": model.config.model_type,
        "step": int(step),
        "parameter_count": int(model.num_parameters()),
        "config_sha256": sha256_file(config_path),
        "tokenizer_sha256": sha256_file(tokenizer_path),
        "tokenizer_schema": getattr(tokenizer, "schema", "unknown"),
        "weights_sha256": sha256_file(weights_path),
        "optimizer_sha256": sha256_file(optimizer_path) if optimizer_path else None,
        "metadata": metadata or {},
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def verify_checkpoint(directory: str | Path) -> Dict[str, Any]:
    target = Path(directory)
    manifest_path = target / "manifest.json"
    if not manifest_path.is_file():
        return {"ok": False, "checks": {"manifest": False}, "manifest": None}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    checks = {
        "config": (target / "config.json").is_file() and sha256_file(target / "config.json") == manifest.get("config_sha256"),
        "tokenizer": (target / "tokenizer.json").is_file() and sha256_file(target / "tokenizer.json") == manifest.get("tokenizer_sha256"),
        "weights": (target / "model.pt").is_file() and sha256_file(target / "model.pt") == manifest.get("weights_sha256"),
    }
    if manifest.get("optimizer_sha256"):
        checks["optimizer"] = (target / "optimizer.pt").is_file() and sha256_file(target / "optimizer.pt") == manifest["optimizer_sha256"]
    return {"ok": all(checks.values()), "checks": checks, "manifest": manifest}


def load_checkpoint(directory: str | Path, *, device: str | torch.device = "cpu") -> Tuple[ForgeLMForCausalLM, Any, Dict[str, Any]]:
    target = Path(directory)
    verification = verify_checkpoint(target)
    if not verification["ok"]:
        raise ValueError(f"checkpoint hash verification failed: {verification['checks']}")
    config = ForgeLMConfig.load_json(target / "config.json")
    tokenizer = load_tokenizer(target / "tokenizer.json")
    if tokenizer.vocab_size != config.vocab_size:
        raise ValueError("tokenizer/model vocabulary mismatch")
    model = ForgeLMForCausalLM(config)
    state = torch.load(target / "model.pt", map_location=device, weights_only=True)
    model.load_state_dict(state)
    model.to(device)
    model.eval()
    return model, tokenizer, verification["manifest"]


def load_training_checkpoint(
    directory: str | Path,
    *,
    device: str | torch.device = "cpu",
) -> Tuple[ForgeLMForCausalLM, Any, Dict[str, Any], Optional[Dict[str, Any]]]:
    target = Path(directory)
    model, tokenizer, manifest = load_checkpoint(target, device=device)
    optimizer_state = None
    if manifest.get("optimizer_sha256"):
        optimizer_state = torch.load(target / "optimizer.pt", map_location=device, weights_only=True)
    return model, tokenizer, manifest, optimizer_state
