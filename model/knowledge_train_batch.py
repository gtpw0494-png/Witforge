#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from knowledge_store import KnowledgeStore

ROOT = Path(__file__).resolve().parent

def build_training_batch(limit: int = 100) -> dict[str, Any]:
    store = KnowledgeStore(ROOT / "knowledge_store.jsonl")
    items = store.filter_training_eligible()[:limit]
    return {
        "state": "SUCCESS",
        "count": len(items),
        "batch": items,
        "training_eligible": len(items),
    }

if __name__ == "__main__":
    print(json.dumps(build_training_batch(), indent=2, sort_keys=True))
