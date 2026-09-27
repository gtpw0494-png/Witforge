from __future__ import annotations

from pathlib import Path
import tempfile

import torch

from .checkpoint import checkpoint_identity, load_checkpoint, save_checkpoint, verify_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .device_profile import profile_device
from .inference_export import export_inference_checkpoint
from .modeling_forgelm import ForgeLMForCausalLM
from .tokenizer import ByteTokenizer


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def main() -> None:
    torch.manual_seed(31)
    with tempfile.TemporaryDirectory(prefix="forgelm-mobile-") as td:
        root = Path(td)
        source = root / "training"
        exported = root / "inference"
        cfg = ForgeLMConfig.smoke()
        tok = ByteTokenizer(cfg.vocab_size)
        model = ForgeLMForCausalLM(cfg)
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        save_checkpoint(
            source,
            model,
            tok,
            step=9,
            optimizer=optimizer,
            metadata={"stage": "SFT"},
            max_shard_bytes=4096,
        )
        source_identity = checkpoint_identity(source)

        report = export_inference_checkpoint(source, exported, max_shard_bytes=4096)
        check(report["verified"], "inference export verifies")
        check(report["source_manifest_sha256"] == source_identity, "inference export preserves source lineage")
        check(report["source_had_optimizer"] is True, "export reports stripped optimizer lineage")
        check(report["requires_new_evaluation_and_promotion"] is True, "inference export cannot inherit promotion")
        exported_verification = verify_checkpoint(exported)
        check(exported_verification["ok"], "inference-only checkpoint verifies")
        check(exported_verification["manifest"]["optimizer_sha256"] is None, "inference export strips optimizer hash")
        check(not (exported / "optimizer.pt").exists(), "inference export contains no optimizer state")
        check(exported_verification["manifest"]["weights_format"] == "pytorch_state_dict_sharded", "mobile export supports sharded weights")

        source_model, _, _ = load_checkpoint(source)
        export_model, _, _ = load_checkpoint(exported)
        prompt = torch.tensor([[tok.bos_token_id, 65, 66, 67]], dtype=torch.long)
        with torch.inference_mode():
            a = source_model(prompt).logits
            b = export_model(prompt).logits
        check(torch.equal(a, b), "inference export preserves exact model logits")

        profile = profile_device()
        check(profile["schema"] == "witforge.forgelm.device-profile.v1", "device profiler emits versioned schema")
        check(profile["cpu"]["logical_cores"] >= 1, "device profiler measures CPU availability")
        check(profile["truth"]["recommendations_are_heuristics"] is True, "device profiler labels recommendations as heuristics")
        training = profile["recommendations"]["training"]
        check(training["micro_batch_size"] == 1 and training["sequence_length"] >= 128, "device profiler emits conservative training defaults")

    print("ForgeLM inference export/device profile smoke test: PASS")


if __name__ == "__main__":
    main()
