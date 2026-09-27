from __future__ import annotations

import json
from pathlib import Path
import tempfile

from .dataset import build_dataset, verify_governed_dataset
from .tokenizer import BPETokenizer, SPECIAL_TOKENS, load_tokenizer


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="forgelm-pipeline-") as td:
        root = Path(td)
        source = root / "source.jsonl"
        rows = [
            {"text": "WitForge keeps authority outside the model."},
            {"text": "WitForge keeps authority outside the model."},
            {"text": "Verified tool result becomes evidence.", "kind": "ACTION_TRACE", "verified": True},
            {"text": "Unverified execution claim.", "kind": "ACTION_TRACE", "verified": False},
            {"text": "password=ThisShouldNeverEnterTraining123"},
        ]
        source.write_text("\n".join(json.dumps(x) for x in rows) + "\n", encoding="utf-8")
        manifest = root / "sources.json"
        manifest.write_text(json.dumps({
            "schema": "witforge.forgelm.dataset-sources.v1",
            "sources": [{
                "source_id": "owned-smoke",
                "path": "source.jsonl",
                "source_type": "OWNED",
                "privacy": "INTERNAL",
                "approved": True,
                "kind": "TEXT",
            }],
        }), encoding="utf-8")
        dataset = root / "approved.jsonl"
        report = root / "approved.report.json"
        result = build_dataset(manifest, dataset, report)
        check(result["approved_samples"] == 2, "governance keeps only unique safe/verified samples")
        check(result["rejections"].get("duplicate") == 1, "duplicate is rejected")
        check(result["rejections"].get("unverified-action-trace") == 1, "unverified action trace is rejected")
        check(any(k.startswith("secret:") for k in result["rejections"]), "secret-bearing sample is rejected")
        check(verify_governed_dataset(dataset, report)["ok"], "dataset hash report verifies")

        docs = [json.loads(line)["text"] for line in dataset.read_text(encoding="utf-8").splitlines()]
        tok = BPETokenizer.train(docs, model_vocab_size=512, target_vocab_size=340, min_frequency=2)
        check(tok.merges, "BPE trainer learns at least one merge")
        check(tok.special_tokens == SPECIAL_TOKENS, "reserved token IDs remain immutable")
        sample = "<|user|>WitForge authority<|end_turn|>"
        ids = tok.encode(sample)
        check(tok.decode(ids, skip_special_tokens=False) == sample, "BPE tokenizer round-trips UTF-8 and special tokens")
        path = root / "tokenizer.json"
        tok.save(path)
        loaded = load_tokenizer(path)
        check(loaded.encode(sample) == ids, "BPE tokenizer save/load is stable")
    print("ForgeLM governed dataset + BPE smoke test: PASS")


if __name__ == "__main__":
    main()
