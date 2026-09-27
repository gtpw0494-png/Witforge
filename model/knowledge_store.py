#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
STORE_PATH = ROOT / "knowledge_store.jsonl"

class KnowledgeStore:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else STORE_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")

    def append(self, fact: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps(fact, sort_keys=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        return {"state": "SUCCESS", "written": True, "path": str(self.path)}

    def read(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        rows = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
        return rows

    def filter_training_eligible(self) -> list[dict[str, Any]]:
        return [item for item in self.read() if bool(item.get("training_eligible"))]

    def status(self) -> dict[str, Any]:
        rows = self.read()
        return {
            "state": "SUCCESS",
            "path": str(self.path),
            "count": len(rows),
            "training_eligible": len(self.filter_training_eligible()),
        }

if __name__ == "__main__":
    s = KnowledgeStore()
    print(json.dumps(s.status(), indent=2, sort_keys=True))
