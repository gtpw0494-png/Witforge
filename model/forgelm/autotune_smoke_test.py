from __future__ import annotations

from pathlib import Path
import tempfile

import torch

from .autotune import autotune_checkpoint, select_recommendation
from .checkpoint import checkpoint_identity, save_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .modeling_forgelm import ForgeLMForCausalLM
from .tokenizer import ByteTokenizer


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def main() -> None:
    synthetic = [
        {
            "ok": True,
            "cache_strategy": "dynamic",
            "quantization": {"mode": "none"},
            "tokens_per_second": 20.0,
            "process_memory": {"estimated_bytes": 800},
            "generation": {"peak_kv_cache_bytes": 120},
        },
        {
            "ok": True,
            "cache_strategy": "none",
            "quantization": {"mode": "none"},
            "tokens_per_second": 12.0,
            "process_memory": {"estimated_bytes": 400},
            "generation": {"peak_kv_cache_bytes": 0},
        },
    ]
    fastest = select_recommendation(synthetic, available_memory_bytes=2000, memory_fraction=0.6)
    check(fastest["ok"] and fastest["cache_strategy"] == "dynamic", "autotune selects fastest measured case inside memory budget")
    constrained = select_recommendation(synthetic, available_memory_bytes=1000, memory_fraction=0.6)
    check(constrained["ok"] and constrained["cache_strategy"] == "none", "autotune respects conservative memory budget")
    empty = select_recommendation([], available_memory_bytes=1000)
    check(empty["ok"] is False, "autotune refuses to invent a recommendation without measurements")

    torch.manual_seed(41)
    with tempfile.TemporaryDirectory(prefix="forgelm-autotune-") as td:
        root = Path(td)
        checkpoint = root / "model"
        cfg = ForgeLMConfig.smoke()
        tok = ByteTokenizer(cfg.vocab_size)
        save_checkpoint(checkpoint, ForgeLMForCausalLM(cfg), tok, step=0, metadata={"stage": "AUTOTUNE_SMOKE"})

        report = autotune_checkpoint(
            checkpoint,
            prompt="autotune smoke",
            max_new_tokens=1,
            device="cpu",
            quantizations=["none"],
            cache_strategies=["dynamic", "none"],
            warmup_tokens=0,
            memory_fraction=0.9,
            timeout_seconds=60,
        )
        check(report["schema"] == "witforge.forgelm.autotune-report.v1", "autotune emits a versioned report")
        check(report["checkpoint_manifest_sha256"] == checkpoint_identity(checkpoint), "autotune report binds to checkpoint identity")
        cases = report["matrix"]["cases"]
        check(len(cases) == 2 and all(case.get("ok") for case in cases), "autotune executes both cache strategies in isolated subprocesses")
        check(all(case.get("subprocess_isolated") is True for case in cases), "autotune labels subprocess isolation truthfully")
        by_cache = {case["cache_strategy"]: case for case in cases}
        check(by_cache["dynamic"]["generation"]["peak_kv_cache_bytes"] > 0, "dynamic autotune case measures KV-cache memory")
        check(by_cache["none"]["generation"]["peak_kv_cache_bytes"] == 0, "no-cache autotune case measures zero KV-cache bytes")
        check(report["recommendation"]["ok"] is True, "autotune produces an advisory recommendation from measured cases")
        check(report["truth"]["serving_configuration_is_not_changed_automatically"] is True, "autotune never silently changes serving configuration")

    print("ForgeLM measured autotune smoke test: PASS")


if __name__ == "__main__":
    main()
