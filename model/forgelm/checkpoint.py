from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

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


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def checkpoint_identity(directory: str | Path) -> str:
    target = Path(directory)
    manifest = target / "manifest.json"
    if not manifest.is_file():
        raise FileNotFoundError(manifest)
    return sha256_file(manifest)


def _safe_checkpoint_name(name: str) -> str:
    value = str(name)
    if not value or Path(value).name != value or "/" in value or "\\" in value:
        raise ValueError(f"unsafe checkpoint filename: {value!r}")
    return value


def _tensor_nbytes(tensor: torch.Tensor) -> int:
    return int(tensor.numel()) * int(tensor.element_size())


def _split_state_dict(state: Dict[str, torch.Tensor], max_shard_bytes: int) -> List[Dict[str, torch.Tensor]]:
    if max_shard_bytes <= 0:
        raise ValueError("max_shard_bytes must be positive")
    shards: List[Dict[str, torch.Tensor]] = []
    current: Dict[str, torch.Tensor] = {}
    current_bytes = 0
    for name, tensor in state.items():
        size = _tensor_nbytes(tensor)
        if current and current_bytes + size > max_shard_bytes:
            shards.append(current)
            current = {}
            current_bytes = 0
        current[name] = tensor
        current_bytes += size
    if current:
        shards.append(current)
    return shards


def _remove_previous_weights(target: Path) -> None:
    candidates = [target / "model.pt", *target.glob("model-*-of-*.pt")]
    for path in candidates:
        if path.is_file():
            path.unlink()


def _weight_digest(weight_files: Iterable[Dict[str, Any]]) -> str:
    normalized = [
        {"name": str(item["name"]), "sha256": str(item["sha256"]), "bytes": int(item["bytes"])}
        for item in weight_files
    ]
    return _canonical_sha256(normalized)


def checkpoint_weight_files(directory: str | Path, manifest: Optional[Dict[str, Any]] = None) -> List[Path]:
    target = Path(directory)
    manifest = manifest or json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    declared = manifest.get("weight_files")
    if isinstance(declared, list) and declared:
        return [target / _safe_checkpoint_name(str(item.get("name", ""))) for item in declared]
    return [target / "model.pt"]


def save_checkpoint(
    directory: str | Path,
    model: ForgeLMForCausalLM,
    tokenizer,
    *,
    step: int = 0,
    optimizer: Optional[torch.optim.Optimizer] = None,
    metadata: Optional[Dict[str, Any]] = None,
    max_shard_bytes: Optional[int] = None,
) -> Dict[str, Any]:
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    config_path = target / "config.json"
    tokenizer_path = target / "tokenizer.json"
    model.config.save_json(config_path)
    tokenizer.save(tokenizer_path)

    _remove_previous_weights(target)
    state = model.state_dict()
    weight_files: List[Dict[str, Any]] = []
    if max_shard_bytes is not None:
        shard_limit = int(max_shard_bytes)
        if shard_limit <= 0:
            raise ValueError("max_shard_bytes must be positive when supplied")
        shards = _split_state_dict(state, shard_limit)
    else:
        shards = [state]

    if len(shards) == 1:
        path = target / "model.pt"
        torch.save(shards[0], path)
        weight_files.append({"name": path.name, "sha256": sha256_file(path), "bytes": path.stat().st_size})
        weights_format = "pytorch_state_dict"
        weights_sha256 = weight_files[0]["sha256"]
    else:
        total = len(shards)
        for index, shard in enumerate(shards, 1):
            path = target / f"model-{index:05d}-of-{total:05d}.pt"
            torch.save(shard, path)
            weight_files.append({"name": path.name, "sha256": sha256_file(path), "bytes": path.stat().st_size})
        weights_format = "pytorch_state_dict_sharded"
        weights_sha256 = _weight_digest(weight_files)

    optimizer_path = None
    if optimizer is not None:
        optimizer_path = target / "optimizer.pt"
        torch.save(optimizer.state_dict(), optimizer_path)
    elif (target / "optimizer.pt").is_file():
        (target / "optimizer.pt").unlink()

    manifest = {
        "schema": "witforge.forgelm.checkpoint.v2",
        "model_type": model.config.model_type,
        "step": int(step),
        "parameter_count": int(model.num_parameters()),
        "config_sha256": sha256_file(config_path),
        "tokenizer_sha256": sha256_file(tokenizer_path),
        "tokenizer_schema": getattr(tokenizer, "schema", "unknown"),
        "weights_format": weights_format,
        "weights_sha256": weights_sha256,
        "weight_files": weight_files,
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
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return {"ok": False, "checks": {"manifest": False}, "manifest": None}

    checks: Dict[str, bool] = {
        "schema": manifest.get("schema") in {"witforge.forgelm.checkpoint.v1", "witforge.forgelm.checkpoint.v2"},
        "config": (target / "config.json").is_file() and sha256_file(target / "config.json") == manifest.get("config_sha256"),
        "tokenizer": (target / "tokenizer.json").is_file() and sha256_file(target / "tokenizer.json") == manifest.get("tokenizer_sha256"),
    }

    declared = manifest.get("weight_files")
    if isinstance(declared, list) and declared:
        normalized = []
        try:
            for item in declared:
                name = _safe_checkpoint_name(str(item.get("name", "")))
                path = target / name
                expected = str(item.get("sha256", ""))
                size = int(item.get("bytes", -1))
                ok = path.is_file() and path.stat().st_size == size and sha256_file(path) == expected
                checks["weight:" + name] = ok
                normalized.append({"name": name, "sha256": expected, "bytes": size})
            if len(normalized) == 1 and manifest.get("weights_format") != "pytorch_state_dict_sharded":
                checks["weights_digest"] = normalized[0]["sha256"] == manifest.get("weights_sha256")
            else:
                checks["weights_digest"] = _weight_digest(normalized) == manifest.get("weights_sha256")
        except Exception:
            checks["weights_manifest"] = False
    else:
        weights = target / "model.pt"
        checks["weights"] = weights.is_file() and sha256_file(weights) == manifest.get("weights_sha256")

    if manifest.get("optimizer_sha256"):
        optimizer = target / "optimizer.pt"
        checks["optimizer"] = optimizer.is_file() and sha256_file(optimizer) == manifest["optimizer_sha256"]
    return {"ok": all(checks.values()), "checks": checks, "manifest": manifest}


def _load_state_dict(target: Path, manifest: Dict[str, Any], device: str | torch.device) -> Dict[str, torch.Tensor]:
    merged: Dict[str, torch.Tensor] = {}
    for path in checkpoint_weight_files(target, manifest):
        shard = torch.load(path, map_location=device, weights_only=True)
        if not isinstance(shard, dict):
            raise ValueError(f"checkpoint weight file is not a state dict: {path.name}")
        overlap = set(merged).intersection(shard)
        if overlap:
            raise ValueError(f"duplicate keys across checkpoint shards: {sorted(overlap)[:3]}")
        merged.update(shard)
    return merged


def load_checkpoint(directory: str | Path, *, device: str | torch.device = "cpu") -> Tuple[ForgeLMForCausalLM, Any, Dict[str, Any]]:
    target = Path(directory)
    verification = verify_checkpoint(target)
    if not verification["ok"]:
        raise ValueError(f"checkpoint hash verification failed: {verification['checks']}")
    manifest = verification["manifest"]
    config = ForgeLMConfig.load_json(target / "config.json")
    tokenizer = load_tokenizer(target / "tokenizer.json")
    if tokenizer.vocab_size != config.vocab_size:
        raise ValueError("tokenizer/model vocabulary mismatch")
    model = ForgeLMForCausalLM(config)
    state = _load_state_dict(target, manifest, device)
    model.load_state_dict(state, strict=True)
    model.to(device)
    model.eval()
    return model, tokenizer, manifest


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
