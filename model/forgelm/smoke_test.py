from __future__ import annotations

import math
from pathlib import Path
import tempfile

import torch

from .checkpoint import load_checkpoint, save_checkpoint, verify_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .generation import generate
from .modeling_forgelm import ForgeLMForCausalLM
from .tokenizer import ByteTokenizer


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    torch.manual_seed(7)
    cfg = ForgeLMConfig.smoke()
    tok = ByteTokenizer(cfg.vocab_size)
    model = ForgeLMForCausalLM(cfg)
    check(model.num_parameters() > 100_000, "smoke model has real trainable parameters")

    text = "<|user|>hello ForgeLM<|end_turn|><|assistant|>hello owner<|end_turn|>"
    ids = tok.encode(text, add_bos=True, add_eos=True)
    seq = torch.tensor([ids * 3], dtype=torch.long)
    seq = seq[:, : min(seq.shape[1], 64)]
    x, y = seq[:, :-1], seq[:, 1:]

    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    before = model.embed_tokens.weight.detach().clone()
    out = model(x, targets=y, use_cache=True)
    check(out.loss is not None and math.isfinite(float(out.loss)), "forward produces finite causal loss")
    check(out.past_key_values is not None and len(out.past_key_values) == cfg.num_hidden_layers, "KV cache emitted for every layer")
    check(out.past_key_values[0][0].shape[-2] == x.shape[1], "KV cache length matches prompt")
    optimizer.zero_grad(set_to_none=True)
    out.loss.backward()
    optimizer.step()
    check(not torch.equal(before, model.embed_tokens.weight.detach()), "optimizer step changes weights")

    with tempfile.TemporaryDirectory(prefix="forgelm-smoke-") as td:
        manifest = save_checkpoint(td, model, tok, step=1, optimizer=optimizer, metadata={"kind": "ci-smoke"})
        check(manifest["parameter_count"] == model.num_parameters(), "manifest records exact parameter count")
        check(verify_checkpoint(td)["ok"], "checkpoint SHA-256 manifest verifies")
        loaded, loaded_tok, loaded_manifest = load_checkpoint(td)
        check(loaded_manifest["weights_sha256"] == manifest["weights_sha256"], "load preserves manifest identity")
        check(loaded_tok.encode("abc") == tok.encode("abc"), "tokenizer save/load is stable")
        model.eval(); loaded.eval()
        with torch.inference_mode():
            a = model(x).logits
            b = loaded(x).logits
        check(torch.allclose(a, b, atol=0, rtol=0), "checkpoint reload reproduces logits exactly")

        prompt = torch.tensor([tok.encode("<|user|>hi<|assistant|>", add_bos=True)], dtype=torch.long)
        generated = generate(loaded, prompt, max_new_tokens=4, eos_token_id=tok.eos_token_id, temperature=0.0)
        check(generated.shape[1] >= prompt.shape[1] + 1, "local autoregressive generation produces tokens")
        check(generated.shape[1] <= prompt.shape[1] + 4, "generation respects max_new_tokens")

    nano = ForgeLMConfig.nano()
    check(nano.hidden_size == 384 and nano.num_hidden_layers == 8 and nano.num_attention_heads == 6 and nano.num_key_value_heads == 2, "Nano profile matches WitForge contract")
    print("ForgeLM native PyTorch smoke test: PASS")


if __name__ == "__main__":
    main()
