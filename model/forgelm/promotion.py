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


def promote(
    checkpoint: str | Path,
    eval_report: str | Path,
    *,
    release_version: str,
    approved_by: str,
    out: str | Path,
    signing_key: str | None = None,
    allow_unsigned_dev: bool = False,
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
        raise ValueError("a passing ForgeLM eval report is required")
    identity = checkpoint_identity(checkpoint)
    if report.get("checkpoint_manifest_sha256") != identity:
        raise ValueError("eval report does not belong to this checkpoint")

    manifest = verified["manifest"]
    body = {
        "schema": "witforge.forgelm.release-manifest.v1",
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


def main() -> None:
    p = argparse.ArgumentParser(description="Promote a verified/evaluated ForgeLM checkpoint")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--eval-report", required=True)
    p.add_argument("--release-version", required=True)
    p.add_argument("--approved-by", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--allow-unsigned-dev", action="store_true")
    args = p.parse_args()
    print(json.dumps(promote(
        args.checkpoint,
        args.eval_report,
        release_version=args.release_version,
        approved_by=args.approved_by,
        out=args.out,
        allow_unsigned_dev=args.allow_unsigned_dev,
    ), indent=2))


if __name__ == "__main__":
    main()
