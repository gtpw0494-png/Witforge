from __future__ import annotations

from collections import Counter
import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Dict, Iterable, List
import unicodedata

SOURCE_TYPES = {"PUBLIC", "LICENSED", "OWNED", "USER_APPROVED", "SYNTHETIC"}
PRIVACY_CLASSES = {"PUBLIC", "INTERNAL", "PERSONAL", "SENSITIVE", "SECRET"}
TRACE_KINDS = {"ACTION_TRACE", "TOOL_TRACE"}

SECRET_PATTERNS = [
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("bearer-token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+\-/=]{16,}", re.I)),
    ("api-key", re.compile(r"\b(?:sk|pk|ghp|github_pat|nvapi)[-_][A-Za-z0-9_\-]{12,}\b", re.I)),
    ("password-assignment", re.compile(r"\b(?:password|passwd|pwd)\s*[:=]\s*[^\s]{8,}", re.I)),
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_text(text: str) -> str:
    return unicodedata.normalize("NFC", str(text)).replace("\r\n", "\n").replace("\r", "\n").strip()


def sample_hash(text: str) -> str:
    return sha256_bytes(normalize_text(text).encode("utf-8"))


def detect_secret(text: str) -> str | None:
    for name, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            return name
    return None


def messages_to_text(messages: list) -> str:
    parts: List[str] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role", "user")).lower()
        content = normalize_text(m.get("content", ""))
        if not content:
            continue
        tag = {
            "system": "<|platform|>",
            "developer": "<|developer|>",
            "assistant": "<|assistant|>",
            "tool": "<|tool_result|>",
        }.get(role, "<|user|>")
        parts.append(f"{tag}\n{content}\n<|end_turn|>")
    return "\n".join(parts)


def iter_source_rows(path: Path) -> Iterable[Dict[str, Any]]:
    if path.suffix.lower() == ".jsonl":
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{n}: JSONL row must be an object")
            yield row
    else:
        yield {"text": path.read_text(encoding="utf-8")}


def _source_allowed(src: Dict[str, Any]) -> tuple[bool, str | None]:
    st = str(src.get("source_type", "")).upper()
    if st not in SOURCE_TYPES:
        return False, "unknown-source-type"
    if src.get("approved") is not True:
        return False, "source-not-approved"
    privacy = str(src.get("privacy", "PUBLIC")).upper()
    if privacy not in PRIVACY_CLASSES:
        return False, "unknown-privacy-class"
    if privacy == "SECRET":
        return False, "secret-source-forbidden"
    if privacy in {"PERSONAL", "SENSITIVE"} and src.get("training_consent") is not True:
        return False, "sensitive-source-without-training-consent"
    license_name = str(src.get("license", "")).strip()
    if st in {"PUBLIC", "LICENSED"} and not license_name:
        return False, "license-required"
    if st == "USER_APPROVED" and src.get("training_consent") is not True:
        return False, "user-approved-source-needs-training-consent"
    return True, None


def build_dataset(manifest_path: str | Path, out_path: str | Path, report_path: str | Path | None = None, holdout_paths: Iterable[str] = ()) -> Dict[str, Any]:
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "witforge.forgelm.dataset-sources.v1":
        raise ValueError("unsupported dataset source manifest schema")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("manifest.sources must be a non-empty list")

    holdout_hashes = set()
    for raw in holdout_paths:
        p = Path(raw)
        for row in iter_source_rows(p):
            text = row.get("text")
            if not isinstance(text, str) and isinstance(row.get("messages"), list):
                text = messages_to_text(row["messages"])
            if isinstance(text, str) and normalize_text(text):
                holdout_hashes.add(sample_hash(text))

    accepted: List[Dict[str, Any]] = []
    seen = set()
    rejected = Counter()
    source_records = []
    base = manifest_path.parent

    for src_index, src in enumerate(sources):
        if not isinstance(src, dict):
            rejected["invalid-source-record"] += 1
            continue
        allowed, reason = _source_allowed(src)
        source_path = (base / str(src.get("path", ""))).resolve()
        if not allowed:
            rejected[reason or "source-rejected"] += 1
            continue
        if not source_path.is_file():
            rejected["source-file-missing"] += 1
            continue
        actual_sha = sha256_file(source_path)
        expected_sha = str(src.get("sha256", "")).strip().lower()
        if expected_sha and expected_sha != actual_sha:
            rejected["source-sha256-mismatch"] += 1
            continue
        source_id = str(src.get("source_id") or f"source-{src_index + 1}")
        source_records.append({"source_id": source_id, "path": str(src.get("path")), "sha256": actual_sha})

        for row_no, row in enumerate(iter_source_rows(source_path), 1):
            text = row.get("text")
            if not isinstance(text, str) and isinstance(row.get("messages"), list):
                text = messages_to_text(row["messages"])
            text = normalize_text(text or "")
            if not text:
                rejected["empty"] += 1
                continue
            secret = detect_secret(text)
            if secret:
                rejected[f"secret:{secret}"] += 1
                continue
            kind = str(row.get("kind", src.get("kind", "TEXT"))).upper()
            verified = row.get("verified", src.get("verified"))
            if kind in TRACE_KINDS and verified is not True:
                rejected["unverified-action-trace"] += 1
                continue
            digest = sample_hash(text)
            if digest in holdout_hashes:
                rejected["holdout-contamination"] += 1
                continue
            if digest in seen:
                rejected["duplicate"] += 1
                continue
            seen.add(digest)
            accepted.append({
                "text": text,
                "metadata": {
                    "sample_sha256": digest,
                    "source_id": source_id,
                    "source_type": str(src["source_type"]).upper(),
                    "license": src.get("license"),
                    "privacy": str(src.get("privacy", "PUBLIC")).upper(),
                    "kind": kind,
                    "verified": verified is True,
                    "source_file_sha256": actual_sha,
                    "source_row": row_no,
                },
            })

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for row in accepted:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    report = {
        "schema": "witforge.forgelm.dataset-report.v1",
        "source_manifest_sha256": sha256_file(manifest_path),
        "output_path": str(out_path),
        "output_sha256": sha256_file(out_path),
        "approved_samples": len(accepted),
        "rejected_samples": int(sum(rejected.values())),
        "rejections": dict(sorted(rejected.items())),
        "sources": source_records,
    }
    report_path = Path(report_path) if report_path else out_path.with_suffix(out_path.suffix + ".report.json")
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def verify_governed_dataset(dataset_path: str | Path, report_path: str | Path) -> Dict[str, Any]:
    dataset_path = Path(dataset_path)
    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    if report.get("schema") != "witforge.forgelm.dataset-report.v1":
        return {"ok": False, "error": "unsupported-report-schema"}
    actual = sha256_file(dataset_path)
    ok = actual == report.get("output_sha256") and int(report.get("approved_samples", 0)) > 0
    return {"ok": ok, "actual_sha256": actual, "report": report}


def main() -> None:
    p = argparse.ArgumentParser(description="ForgeLM governed dataset builder")
    sub = p.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--manifest", required=True)
    build.add_argument("--out", required=True)
    build.add_argument("--report")
    build.add_argument("--holdout", nargs="*", default=[])
    verify = sub.add_parser("verify")
    verify.add_argument("--dataset", required=True)
    verify.add_argument("--report", required=True)
    args = p.parse_args()
    if args.command == "build":
        print(json.dumps(build_dataset(args.manifest, args.out, args.report, args.holdout), indent=2))
    else:
        result = verify_governed_dataset(args.dataset, args.report)
        print(json.dumps(result, indent=2))
        if not result["ok"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
