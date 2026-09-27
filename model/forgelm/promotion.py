from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import time
from typing import Any, Dict

from .checkpoint import checkpoint_identity, verify_checkpoint


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _canonical(value: Dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _load_gate_report(
    path: str | Path,
    checkpoint_identity_sha: str,
    *,
    schema: str,
    label: str,
) -> Dict[str, Any]:
    report_path = Path(path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("schema") != schema or report.get("passed") is not True:
        raise ValueError(f"a passing ForgeLM {label} report is required")
    if report.get("checkpoint_manifest_sha256") != checkpoint_identity_sha:
        raise ValueError(f"{label} report does not belong to this checkpoint")
    return {"path": report_path, "report": report}


def _load_quality_report(path: str | Path, checkpoint_identity_sha: str) -> Dict[str, Any]:
    return _load_gate_report(
        path,
        checkpoint_identity_sha,
        schema="witforge.forgelm.quality-report.v1",
        label="quality",
    )


def _load_regression_report(path: str | Path, checkpoint_identity_sha: str) -> Dict[str, Any]:
    return _load_gate_report(
        path,
        checkpoint_identity_sha,
        schema="witforge.forgelm.regression-report.v1",
        label="regression",
    )


def promote(
    checkpoint: str | Path,
    eval_report: str | Path,
    *,
    release_version: str,
    approved_by: str,
    out: str | Path,
    quality_report: str | Path | None = None,
    regression_report: str | Path | None = None,
    signing_key: str | None = None,
    allow_unsigned_dev: bool = False,
    allow_runtime_only_dev: bool = False,
) -> Dict[str, Any]:
    approved_by = str(approved_by).strip()
    if not approved_by or approved_by.lower() in {"forgelm", "model", "self", "ai"}:
        raise ValueError("promotion requires an external human/release authority identifier")

    verified = verify_checkpoint(checkpoint)
    if not verified.get("ok"):
        raise ValueError("checkpoint verification failed")

    report_path = Path(eval_report)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("schema") != "witforge.forgelm.eval-report.v1" or report.get("passed") is not True:
        raise ValueError("a passing ForgeLM runtime eval report is required")

    identity = checkpoint_identity(checkpoint)
    if report.get("checkpoint_manifest_sha256") != identity:
        raise ValueError("runtime eval report does not belong to this checkpoint")

    quality = _load_quality_report(quality_report, identity) if quality_report is not None else None
    regression = _load_regression_report(regression_report, identity) if regression_report is not None else None

    if not allow_runtime_only_dev:
        if quality is None:
            raise ValueError("production promotion requires a passing quality report")
        if regression is None:
            raise ValueError("production promotion requires a passing regression report")
    elif quality is None and regression is not None:
        raise ValueError("regression-only dev promotion is invalid without quality evidence")

    manifest = verified["manifest"]
    body = {
        "schema": "witforge.forgelm.release-manifest.v3",
        "release_version": str(release_version),
        "approved_by": approved_by,
        "approved_at_unix": int(time.time()),
        "checkpoint_manifest_sha256": identity,
        "config_sha256": manifest.get("config_sha256"),
        "tokenizer_sha256": manifest.get("tokenizer_sha256"),
        "weights_sha256": manifest.get("weights_sha256"),
        "parameter_count": manifest.get("parameter_count"),
        "step": manifest.get("step"),
        "eval_report_sha256": sha256_file(report_path),
        "eval_schema": report.get("schema"),
        "quality_gate": "QUALITY_VERIFIED" if quality else "DEV_RUNTIME_ONLY",
        "quality_report_sha256": sha256_file(quality["path"]) if quality else None,
        "quality_schema": quality["report"].get("schema") if quality else None,
        "quality_pass_rate": quality["report"].get("pass_rate") if quality else None,
        "regression_gate": "REGRESSION_VERIFIED" if regression else "DEV_NOT_EVALUATED",
        "regression_report_sha256": sha256_file(regression["path"]) if regression else None,
        "regression_schema": regression["report"].get("schema") if regression else None,
        "regression_pass_rate": regression["report"].get("pass_rate") if regression else None,
        "regression_categories": regression["report"].get("categories") if regression else None,
    }

    key = signing_key or os.environ.get("WITFORGE_RELEASE_HMAC_KEY")
    if not key and not allow_unsigned_dev:
        raise ValueError("WITFORGE_RELEASE_HMAC_KEY is required for promotion; unsigned output is dev-only")

    signature = hmac.new(key.encode("utf-8"), _canonical(body), hashlib.sha256).hexdigest() if key else None
    release = dict(body)
    release["signature"] = {
        "type": "HMAC-SHA256" if signature else "UNSIGNED-DEV",
        "value": signature,
    }

    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(release, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return release


def verify_release_manifest(
    release_manifest: str | Path,
    checkpoint: str | Path,
    *,
    signing_key: str | None = None,
    allow_unsigned_dev: bool = False,
    allow_legacy_v2_dev: bool = False,
) -> Dict[str, Any]:
    path = Path(release_manifest)
    release = json.loads(path.read_text(encoding="utf-8"))
    signature = release.get("signature") if isinstance(release.get("signature"), dict) else {}
    body = {k: v for k, v in release.items() if k != "signature"}
    verified = verify_checkpoint(checkpoint)

    schema = release.get("schema")
    is_v3 = schema == "witforge.forgelm.release-manifest.v3"
    is_legacy_v2 = schema == "witforge.forgelm.release-manifest.v2"
    schema_ok = is_v3 or (allow_legacy_v2_dev and is_legacy_v2)

    quality_ok = release.get("quality_gate") == "QUALITY_VERIFIED"
    regression_ok = release.get("regression_gate") == "REGRESSION_VERIFIED" if is_v3 else bool(allow_legacy_v2_dev)
    if allow_unsigned_dev:
        quality_ok = quality_ok or release.get("quality_gate") == "DEV_RUNTIME_ONLY"
        regression_ok = regression_ok or (is_v3 and release.get("regression_gate") == "DEV_NOT_EVALUATED")

    checks = {
        "schema": schema_ok,
        "checkpoint": bool(verified.get("ok")),
        "checkpoint_identity": False,
        "weights": False,
        "config": False,
        "tokenizer": False,
        "quality_gate": quality_ok,
        "regression_gate": regression_ok,
        "signature": False,
    }

    if verified.get("ok"):
        manifest = verified["manifest"]
        checks["checkpoint_identity"] = release.get("checkpoint_manifest_sha256") == checkpoint_identity(checkpoint)
        checks["weights"] = release.get("weights_sha256") == manifest.get("weights_sha256")
        checks["config"] = release.get("config_sha256") == manifest.get("config_sha256")
        checks["tokenizer"] = release.get("tokenizer_sha256") == manifest.get("tokenizer_sha256")

    sig_type = signature.get("type")
    if sig_type == "HMAC-SHA256":
        key = signing_key or os.environ.get("WITFORGE_RELEASE_HMAC_KEY")
        if key:
            expected = hmac.new(key.encode("utf-8"), _canonical(body), hashlib.sha256).hexdigest()
            checks["signature"] = hmac.compare_digest(expected, str(signature.get("value") or ""))
    elif sig_type == "UNSIGNED-DEV" and allow_unsigned_dev:
        checks["signature"] = True

    return {"ok": all(checks.values()), "checks": checks, "release": release}


def main() -> None:
    p = argparse.ArgumentParser(description="Promote a verified/evaluated ForgeLM checkpoint")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--eval-report", required=True)
    p.add_argument("--quality-report")
    p.add_argument("--regression-report")
    p.add_argument("--release-version", required=True)
    p.add_argument("--approved-by", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--allow-unsigned-dev", action="store_true")
    p.add_argument("--allow-runtime-only-dev", action="store_true")
    args = p.parse_args()
    print(json.dumps(promote(
        args.checkpoint,
        args.eval_report,
        release_version=args.release_version,
        approved_by=args.approved_by,
        out=args.out,
        quality_report=args.quality_report,
        regression_report=args.regression_report,
        allow_unsigned_dev=args.allow_unsigned_dev,
        allow_runtime_only_dev=args.allow_runtime_only_dev,
    ), indent=2))


if __name__ == "__main__":
    main()
