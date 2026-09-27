from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time
from typing import Any, Dict

from .promotion import verify_release_manifest


CHECKPOINT_FILES = ("config.json", "tokenizer.json", "model.pt", "manifest.json")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def create_bundle(
    checkpoint: str | Path,
    release_manifest: str | Path,
    out_dir: str | Path,
    *,
    signing_key: str | None = None,
    allow_unsigned_dev: bool = False,
) -> Dict[str, Any]:
    checkpoint = Path(checkpoint)
    release_manifest = Path(release_manifest)
    verification = verify_release_manifest(
        release_manifest,
        checkpoint,
        signing_key=signing_key,
        allow_unsigned_dev=allow_unsigned_dev,
    )
    if not verification["ok"]:
        raise ValueError(f"release manifest verification failed: {verification['checks']}")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in CHECKPOINT_FILES:
        src = checkpoint / name
        if not src.is_file():
            raise FileNotFoundError(src)
        dst = out_dir / name
        shutil.copy2(src, dst)
        copied.append(dst)
    release_dst = out_dir / "release-manifest.json"
    shutil.copy2(release_manifest, release_dst)
    copied.append(release_dst)

    manifest = {
        "schema": "witforge.forgelm.bundle.v1",
        "created_at_unix": int(time.time()),
        "release_version": verification["release"].get("release_version"),
        "checkpoint_manifest_sha256": verification["release"].get("checkpoint_manifest_sha256"),
        "files": {p.name: sha256_file(p) for p in copied},
    }
    bundle_path = out_dir / "bundle-manifest.json"
    bundle_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def verify_bundle(
    bundle_dir: str | Path,
    *,
    signing_key: str | None = None,
    allow_unsigned_dev: bool = False,
) -> Dict[str, Any]:
    bundle_dir = Path(bundle_dir)
    bundle = json.loads((bundle_dir / "bundle-manifest.json").read_text(encoding="utf-8"))
    checks = {}
    for name, expected in (bundle.get("files") or {}).items():
        path = bundle_dir / name
        checks["file:" + name] = path.is_file() and sha256_file(path) == expected
    release = verify_release_manifest(
        bundle_dir / "release-manifest.json",
        bundle_dir,
        signing_key=signing_key,
        allow_unsigned_dev=allow_unsigned_dev,
    )
    checks["release"] = release["ok"]
    return {"ok": all(checks.values()), "checks": checks, "bundle": bundle, "release": release["release"]}


def main() -> None:
    p = argparse.ArgumentParser(description="Create or verify a portable ForgeLM promoted bundle")
    sub = p.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create")
    create.add_argument("--checkpoint", required=True)
    create.add_argument("--release-manifest", required=True)
    create.add_argument("--out", required=True)
    create.add_argument("--allow-unsigned-dev", action="store_true")
    verify = sub.add_parser("verify")
    verify.add_argument("--bundle", required=True)
    verify.add_argument("--allow-unsigned-dev", action="store_true")
    args = p.parse_args()
    if args.command == "create":
        result = create_bundle(
            args.checkpoint,
            args.release_manifest,
            args.out,
            allow_unsigned_dev=args.allow_unsigned_dev,
        )
    else:
        result = verify_bundle(args.bundle, allow_unsigned_dev=args.allow_unsigned_dev)
        if not result["ok"]:
            print(json.dumps(result, indent=2))
            raise SystemExit(1)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
