#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "model"))

from storage.db import (
    add_definition,
    add_dialogue,
    add_lexical_relation,
    connect,
    define,
    init_schema,
    upsert_source,
)
from storage.semantic import build as semantic_build, schema as semantic_schema, search as semantic_search
import adaptation
from data_pipeline import load_web_corpus


def run_json(args, *, env=None):
    p = subprocess.run(
        [sys.executable, *map(str, args)],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    lines = [x for x in p.stdout.splitlines() if x.strip()]
    assert lines, f"no JSON output from {args}"
    return json.loads(lines[-1])


with tempfile.TemporaryDirectory(prefix="uai-verify-") as td:
    tmp = Path(td)

    # Lifecycle deletion is behavioral: visible -> soft-deleted/hidden -> hard-purged.
    lifecycle_db = tmp / "lifecycle.sqlite3"
    c, _ = connect(lifecycle_db)
    init_schema(c)
    upsert_source(c, {
        "id": "fixture-source",
        "name": "Fixture Source",
        "source_type": "test",
        "license": "CC0-1.0",
        "training_eligible": True,
    })
    assert add_definition(c, {
        "term": "resilience",
        "pos": "noun",
        "definition": "the capacity to recover from difficulty",
        "synset": "resilience.n.01",
        "source_id": "fixture-source",
    })
    assert add_definition(c, {
        "term": "capacity",
        "pos": "noun",
        "definition": "an ability or power",
        "synset": "capacity.n.01",
        "source_id": "fixture-source",
    })
    assert add_lexical_relation(c, {
        "source_synset": "resilience.n.01",
        "target_synset": "capacity.n.01",
        "relation": "hypernym",
        "source_id": "fixture-source",
    })
    assert add_dialogue(c, {
        "message_id": "m1",
        "conversation_id": "c1",
        "role": "assistant",
        "language": "en",
        "text": "Resilience can be strengthened through recovery and learning.",
        "source_id": "fixture-source",
    })
    c.commit()
    assert define(c, "resilience")["state"] == "SUCCESS"
    c.close()

    env = {**os.environ, "IUV_DB_PATH": str(lifecycle_db)}
    soft = run_json(["storage/lifecycle.py", "delete-source", "--source-id", "fixture-source"], env=env)
    assert soft["state"] == "SUCCESS" and soft["mode"] == "SOFT_DELETE"
    c, _ = connect(lifecycle_db)
    init_schema(c)
    assert define(c, "resilience")["state"] == "UNAVAILABLE"
    c.close()

    hard = run_json(["storage/lifecycle.py", "purge-source", "--source-id", "fixture-source"], env=env)
    assert hard["state"] == "SUCCESS" and hard["mode"] == "HARD_PURGE"
    assert hard["purged"]["definitions"] == 2
    assert hard["purged"]["relations"] == 1
    assert hard["purged"]["dialogue"] == 1

    # Hybrid retrieval is exercised against real SQLite rows and scored by the eval utility.
    retrieval_db = tmp / "retrieval.sqlite3"
    c, _ = connect(retrieval_db)
    init_schema(c)
    semantic_schema(c)
    upsert_source(c, {
        "id": "retrieval-fixture",
        "name": "Retrieval Fixture",
        "source_type": "test",
        "license": "CC0-1.0",
        "training_eligible": True,
    })
    for term, definition in [
        ("intelligence", "the ability to learn reason and solve problems"),
        ("database", "an organized collection of structured information"),
        ("orchestra", "a large ensemble of musicians"),
    ]:
        assert add_definition(c, {
            "term": term,
            "pos": "noun",
            "definition": definition,
            "source_id": "retrieval-fixture",
        })
    c.commit()
    counts = semantic_build(c)
    assert counts["definition"] == 3
    matches = semantic_search(c, "machine intelligence learning reasoning", "definition", 3)
    assert matches and matches[0]["title"].lower() == "intelligence"
    assert matches[0]["score"] > 0
    c.close()

    cases = tmp / "retrieval-cases.jsonl"
    cases.write_text(json.dumps({
        "query": "intelligence learning reasoning",
        "kind": "definition",
        "expected": ["intelligence"],
    }) + "\n", encoding="utf-8")
    metrics = run_json([
        "storage/retrieval_eval.py",
        "--db", retrieval_db,
        "--cases", cases,
        "--k", "3",
    ])
    assert metrics["state"] == "SUCCESS"
    assert metrics["recallAtK"] == 1.0
    assert metrics["mrr"] > 0.0
    assert metrics["algorithm"] == "hybrid-fts5+sparse-hash"

    # Retrieval eligibility never implies training permission.
    web_records = tmp / "web-corpus.jsonl"
    web_records.write_text("\n".join([
        json.dumps({"text": "approved web material", "sourceClass": "fixture", "trainingEligible": True, "trainingApproved": True, "license": "CC0-1.0"}),
        json.dumps({"text": "retrieval only material", "sourceClass": "fixture", "trainingEligible": True, "trainingApproved": False, "license": "CC0-1.0"}),
        json.dumps({"text": "unlicensed material", "sourceClass": "fixture", "trainingEligible": False, "trainingApproved": True, "license": "UNKNOWN"}),
    ]) + "\n", encoding="utf-8")
    loaded_web = list(load_web_corpus(web_records, max_records=10))
    assert len(loaded_web) == 1
    assert loaded_web[0].response == "approved web material"

    # Adaptation registry must preserve availability truth instead of pretending training ran.
    st = adaptation.status()
    assert st["state"] == "SUCCESS"
    assert "dependencies" in st and "methods" in st
    assert adaptation.plan("does-not-exist", "m", "d")["state"] == "BLOCKED"
    assert adaptation.plan("multimodal", "m", "d")["state"] == "UNAVAILABLE"
    replay_plan = adaptation.plan("continual-replay", "m", "d")
    assert replay_plan["state"] == "CONFIGURED"
    assert "plan only" in replay_plan["message"].lower()
    lora_plan = adaptation.plan("lora", "m", "d")
    assert lora_plan["state"] in {"CONFIGURED", "UNAVAILABLE"}

    # Continual-learning replay snapshots are deterministic and regression gates are executable.
    dataset = tmp / "approved.jsonl"
    dataset.write_text("\n".join(json.dumps({"id": i, "text": f"approved-{i}"}) for i in range(6)) + "\n", encoding="utf-8")
    replay1, replay2 = tmp / "replay1.jsonl", tmp / "replay2.jsonl"
    snap1 = run_json(["model/continual.py", "snapshot", "--dataset", dataset, "--output", replay1, "--limit", "3", "--seed", "17"])
    snap2 = run_json(["model/continual.py", "snapshot", "--dataset", dataset, "--output", replay2, "--limit", "3", "--seed", "17"])
    assert snap1["state"] == snap2["state"] == "SUCCESS"
    assert snap1["records"] == snap2["records"] == 3
    assert snap1["sha256"] == snap2["sha256"]
    assert replay1.read_text(encoding="utf-8") == replay2.read_text(encoding="utf-8")

    baseline = tmp / "baseline.json"
    candidate_ok = tmp / "candidate-ok.json"
    candidate_bad = tmp / "candidate-bad.json"
    baseline.write_text(json.dumps({"accuracy": 0.90, "groundedness": 0.80}), encoding="utf-8")
    candidate_ok.write_text(json.dumps({"accuracy": 0.88, "groundedness": 0.79}), encoding="utf-8")
    candidate_bad.write_text(json.dumps({"accuracy": 0.70, "groundedness": 0.79}), encoding="utf-8")
    ok = run_json(["model/continual.py", "compare", "--baseline", baseline, "--candidate", candidate_ok, "--max-regression", "0.05"])
    bad = run_json(["model/continual.py", "compare", "--baseline", baseline, "--candidate", candidate_bad, "--max-regression", "0.05"])
    assert ok["state"] == "SUCCESS" and not ok["violations"]
    assert bad["state"] == "FAILURE" and "accuracy" in bad["violations"]

print("Data lifecycle, hybrid retrieval, adaptation truth and continual-learning tests passed")
