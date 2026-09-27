from __future__ import annotations

from pathlib import Path
import tempfile

import torch

from .checkpoint import checkpoint_weight_files, load_checkpoint, save_checkpoint, verify_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .modeling_forgelm import ForgeLMForCausalLM
from .tokenizer import ByteTokenizer


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def main() -> None:
    torch.manual_seed(23)
    with tempfile.TemporaryDirectory(prefix="forgelm-shards-") as td:
        root = Path(td)
        cfg = ForgeLMConfig.smoke()
        tok = ByteTokenizer(cfg.vocab_size)
        model = ForgeLMForCausalLM(cfg).eval()
        prompt = torch.tensor([[tok.bos_token_id, 65, 66, 67]], dtype=torch.long)
        with torch.inference_mode():
            baseline = model(prompt).logits

        manifest = save_checkpoint(
            root,
            model,
            tok,
            step=7,
            metadata={"stage": "SHARD_TEST"},
            max_shard_bytes=4096,
        )
        check(manifest["schema"] == "witforge.forgelm.checkpoint.v2", "sharded checkpoint uses v2 manifest")
        check(manifest["weights_format"] == "pytorch_state_dict_sharded", "checkpoint reports sharded weight format")
        files = checkpoint_weight_files(root, manifest)
        check(len(files) > 1, "tiny shard threshold produces multiple weight files")
        check(verify_checkpoint(root)["ok"], "all declared weight shards verify")

        loaded, loaded_tok, loaded_manifest = load_checkpoint(root)
        check(loaded_manifest["weights_sha256"] == manifest["weights_sha256"], "loaded manifest preserves aggregate weight identity")
        check(loaded_tok.encode("shard test") == tok.encode("shard test"), "tokenizer survives sharded checkpoint")
        with torch.inference_mode():
            restored = loaded(prompt).logits
        check(torch.equal(baseline, restored), "sharded checkpoint round-trip preserves exact logits")

        victim = files[0]
        original = victim.read_bytes()
        victim.write_bytes(original + b"tamper")
        check(not verify_checkpoint(root)["ok"], "tampering with any weight shard fails verification")
        victim.write_bytes(original)
        check(verify_checkpoint(root)["ok"], "restoring the shard restores checkpoint verification")

    print("ForgeLM checkpoint sharding smoke test: PASS")


if __name__ == "__main__":
    main()
