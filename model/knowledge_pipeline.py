#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SOURCES_PATH = ROOT / "knowledge_sources.json"

@dataclass
class FactCandidate:
    subject: str
    claim: str
    source_id: str
    source_url: str
    source_domain: str
    source_valid: bool
    source_trust: float
    kind: str = "fact"
    timestamp: str | None = None
    metadata: dict[str, Any] | None = None

    def fact_id(self) -> str:
        raw = f"{self.subject}|{self.claim}|{self.source_id}|{self.source_url}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def to_dict(self) -> dict[str, Any]:
        return {
            "subject": self.subject,
            "claim": self.claim,
            "source_id": self.source_id,
            "source_url": self.source_url,
            "source_domain": self.source_domain,
            "source_valid": self.source_valid,
            "source_trust": self.source_trust,
            "kind": self.kind,
            "timestamp": self.timestamp,
            "metadata": dict(self.metadata or {}),
            "fact_id": self.fact_id(),
            "training_eligible": False,
        }

def load_sources() -> list[dict[str, Any]]:
    return json.loads(SOURCES_PATH.read_text(encoding="utf-8")).get("sources", [])

def allowed_sources() -> list[dict[str, Any]]:
    return [s for s in load_sources() if bool(s.get("allowed"))]

def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())

def _source_for(source_id: str) -> dict[str, Any] | None:
    for source in allowed_sources():
        if str(source.get("id")) == str(source_id):
            return source
    return None

def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""

def build_fact(subject: str, claim: str, source_id: str, source_url: str, *, kind: str = "fact", metadata: dict[str, Any] | None = None, timestamp: str | None = None) -> FactCandidate:
    source = _source_for(source_id)
    host = _host(source_url)
    domain = str(source.get("domain") or "").lower() if source else ""
    valid = bool(source and host and (host == domain or host.endswith("." + domain)))
    return FactCandidate(
        subject=normalize_text(subject),
        claim=normalize_text(claim),
        source_id=str(source_id),
        source_url=str(source_url),
        source_domain=host,
        source_valid=valid,
        source_trust=float(source.get("trust", 0.0)) if valid else 0.0,
        kind=kind,
        timestamp=timestamp,
        metadata=metadata or {},
    )

def normalize_candidates(items: Iterable[dict[str, Any]]) -> list[FactCandidate]:
    out: list[FactCandidate] = []
    for item in items:
        if not item.get("claim") or not item.get("subject"):
            continue
        out.append(build_fact(
            subject=item.get("subject"),
            claim=item.get("claim"),
            source_id=item.get("source_id") or "unknown",
            source_url=item.get("source_url") or "",
            kind=item.get("kind", "fact"),
            metadata=item.get("metadata"),
            timestamp=item.get("timestamp") or item.get("observed_at"),
        ))
    return out

def ingest_batch(items: Iterable[dict[str, Any]]) -> dict[str, Any]:
    candidates = [x.to_dict() for x in normalize_candidates(items)]
    return {
        "state": "SUCCESS",
        "count": len(candidates),
        "candidates": candidates,
        "valid_sources": sum(1 for x in candidates if x["source_valid"]),
        "training_eligible": 0,
        "policy": "ingestion never grants training eligibility; verification must corroborate independently",
        "approved_sources": [s["id"] for s in allowed_sources()],
    }

if __name__ == "__main__":
    print(json.dumps(ingest_batch([]), indent=2, sort_keys=True))
