#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from knowledge_verifier import verify_batch, filter_training_batch

def benchmark_knowledge_pipeline() -> dict:
    start = time.perf_counter()
    registry = [
        {"id":"a","domain":"a.example","allowed":True,"trust":0.95,"training_policy":"FACT_EXTRACTION_ALLOWED"},
        {"id":"b","domain":"b.example","allowed":True,"trust":0.92,"training_policy":"FACT_EXTRACTION_ALLOWED"},
        {"id":"blocked","domain":"bad.example","allowed":False,"trust":1.0},
    ]
    good = verify_batch([
        {"subject":"x","claim":"same verified fact","source_id":"a","source_url":"https://a.example/doc"},
        {"subject":"x","claim":"same verified fact","source_id":"b","source_url":"https://b.example/doc"},
    ], registry)
    one_source = verify_batch([
        {"subject":"x","claim":"single source claim","source_id":"a","source_url":"https://a.example/doc"},
    ], registry)
    spoof = verify_batch([
        {"subject":"x","claim":"spoofed trust","source_id":"a","source_url":"https://evil.example/doc","trust":1.0},
        {"subject":"x","claim":"spoofed trust","source_id":"b","source_url":"https://evil.example/doc","trust":1.0},
    ], registry)
    passed = (
        len(filter_training_batch(good)) == 1
        and len(filter_training_batch(one_source)) == 0
        and len(filter_training_batch(spoof)) == 0
    )
    elapsed = (time.perf_counter() - start) * 1000
    return {
        "state": "SUCCESS" if passed else "FAILURE",
        "benchmark": "knowledge-verification-boundary",
        "score": 1.0 if passed else 0.0,
        "checks": {
            "independent_sources_required": len(filter_training_batch(one_source)) == 0,
            "domain_spoof_blocked": len(filter_training_batch(spoof)) == 0,
            "verified_pair_accepted": len(filter_training_batch(good)) == 1,
        },
        "latency_ms": round(elapsed, 2),
    }

if __name__ == "__main__":
    result = benchmark_knowledge_pipeline()
    print(json.dumps(result, indent=2, sort_keys=True))
    raise SystemExit(0 if result["state"] == "SUCCESS" else 1)
