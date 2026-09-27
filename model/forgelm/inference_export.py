from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict

from .checkpoint import checkpoint_identity, load_checkpoint, save_checkpoint, verify_checkpoint
from .training_utils import shard_bytes_from_mb


def export_inference_checkpoint(
    source: str | Path,
    out: str | Path,
    *,
    device: str = "cpu",
    max_shard_bytes: int | None = None,
) -> Dict[str, Any]:
    source = Path(source)
    out = Path(out)
    if source.resolve() == out.resolve():
        raise ValueError("inference export must use a different output directory")

    source_verification = verify_checkpoint(source)
    if not source_verification.get("ok"):
        raise ValueError(f"source checkpoint verification failed: {source_verification.get('checks')}")
    model, tokenizer, source_manifest = load_checkpoint(source, device=device)
    source_identity = checkpoint_identity(source)

    exported_manifest = save_checkpoint(
        out,
        model,
        tokenizer,
        step=int(source_manifest.get("step", 0)),
        optimizer=None,
        metadata={
            "stage": "INFERENCE_EXPORT",
            "source_checkpoint_manifest_sha256": source_identity,
            "source_weights_sha256": source_manifest.get("weights_sha256"),
            "source_stage": source_manifest.get("metadata", {}).get("stage"),
            "optimizer_stripped": bool(source_manifest.get("optimizer_sha256")),
            "requires_new_evaluation_and_promotion": True,
        },
        max_shard_bytes=max_shard_bytes,
    )
    exported_verification = verify_checkpoint(out)
    if not exported_verification.get("ok"):
        raise RuntimeError(f"exported checkpoint verification failed: {exported_verification.get('checks')}")
    if exported_manifest.get("optimizer_sha256") is not None or (out / "optimizer.pt").exists():
        raise RuntimeError("inference export unexpectedly retained optimizer state")

    return {
        "schema": "witforge.forgelm.inference-export.v1",
        "source_checkpoint": str(source),
        "source_manifest_sha256": source_identity,
        "source_weights_sha256": source_manifest.get("weights_sha256"),
        "source_had_optimizer": bool(source_manifest.get("optimizer_sha256")),
        "export_checkpoint": str(out),
        "export_manifest_sha256": checkpoint_identity(out),
        "export_weights_sha256": exported_manifest.get("weights_sha256"),
        "weights_format": exported_manifest.get("weights_format"),
        "parameter_count": exported_manifest.get("parameter_count"),
        "requires_new_evaluation_and_promotion": True,
        "verified": True,
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Export a verified ForgeLM checkpoint for inference-only deployment")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--device", default="cpu")
    p.add_argument("--max-shard-mb", type=float)
    p.add_argument("--report")
    args = p.parse_args()
    result = export_inference_checkpoint(
        args.checkpoint,
        args.out,
        device=args.device,
        max_shard_bytes=shard_bytes_from_mb(args.max_shard_mb),
    )
    payload = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.report:
        report = Path(args.report)
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(payload, encoding="utf-8")
    print(payload, end="")


if __name__ == "__main__":
    main()
