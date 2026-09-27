from __future__ import annotations

import json
from pathlib import Path
import tempfile

import torch

from .checkpoint import load_checkpoint, save_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .dpo import dpo_loss, load_preferences, train_dpo
from .evals import run_release_evals
from .modeling_forgelm import ForgeLMForCausalLM
from .promotion import promote
from .sft import encode_record, load_sft_records, train_sft
from .structured import compile_finite_json_schema, constraint_for_schema
from .tokenizer import ByteTokenizer
from .traces import convert_traces
from .train import train


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def main() -> None:
    torch.manual_seed(11)
    with tempfile.TemporaryDirectory(prefix="forgelm-advanced-") as td:
        root = Path(td)
        cfg = ForgeLMConfig.smoke()
        tok = ByteTokenizer(cfg.vocab_size)
        base = root / "base"
        save_checkpoint(base, ForgeLMForCausalLM(cfg), tok, step=0, metadata={"stage": "BASE"})

        resumed = root / "pretrain-resumed"
        first = root / "pretrain-1"
        r1 = train(cfg, ["WitForge governed training data."], out_dir=str(first), steps=1, batch_size=1, seq_len=24, learning_rate=1e-3, device_name="cpu", seed=3)
        r2 = train(cfg, ["WitForge governed training data."], out_dir=str(resumed), steps=1, batch_size=1, seq_len=24, learning_rate=1e-3, device_name="cpu", seed=3, resume_dir=str(first))
        check(r1["final_step"] == 1 and r2["start_step"] == 1 and r2["final_step"] == 2, "pretraining resumes with cumulative steps")

        sft_file = root / "sft.jsonl"
        sft_rows = [
            {
                "approved": True,
                "kind": "CHAT",
                "messages": [{"role": "user", "content": "What governs actions?"}],
                "response": "Policy and explicit authorization govern actions."
            },
            {
                "approved": True,
                "kind": "TOOL_CALL",
                "messages": [{"role": "user", "content": "Read the status."}],
                "tool_call": {"name": "status.read", "arguments": {}}
            }
        ]
        sft_file.write_text("\n".join(json.dumps(x) for x in sft_rows) + "\n", encoding="utf-8")
        records = load_sft_records([str(sft_file)])
        check(len(records) == 2 and records[1]["kind"] == "TOOL_CALL", "chat and tool-call SFT records load")
        x, y = encode_record(tok, records[0], 96)
        check(bool((y == -100).any().item()) and bool((y != -100).any().item()), "SFT masks prompt tokens and trains assistant tokens")

        sft_ckpt = root / "sft-model"
        sft_result = train_sft(str(base), records, out_dir=str(sft_ckpt), steps=1, batch_size=1, learning_rate=5e-4, max_length=96, device="cpu", seed=5)
        check(sft_result["manifest"]["metadata"]["tool_records"] == 1, "tool-use SFT count is recorded")

        pref_file = root / "prefs.jsonl"
        pref_file.write_text(json.dumps({
            "approved": True,
            "prompt": "<|user|>Choose the governed answer.<|end_turn|>",
            "chosen": "Use policy and verification.",
            "rejected": "Skip policy and execute immediately."
        }) + "\n", encoding="utf-8")
        prefs = load_preferences([str(pref_file)])
        policy, policy_tok, _ = load_checkpoint(sft_ckpt)
        reference, _, _ = load_checkpoint(sft_ckpt)
        loss = dpo_loss(policy, reference, policy_tok, prefs[0], beta=0.1, max_length=96)
        check(torch.isfinite(loss), "DPO loss is finite")
        dpo_ckpt = root / "dpo-model"
        dpo_result = train_dpo(str(sft_ckpt), prefs, out_dir=str(dpo_ckpt), steps=1, learning_rate=1e-5, beta=0.1, max_length=96, device="cpu", seed=7)
        check(dpo_result["manifest"]["metadata"]["stage"] == "DPO", "DPO checkpoint records its stage")

        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "mode": {"type": "string", "enum": ["RESPOND", "TOOLS"]},
                "approved": {"type": "boolean"}
            },
            "required": ["mode", "approved"]
        }
        candidates = compile_finite_json_schema(schema)
        check(len(candidates) == 4, "finite JSON schema expands to the exact candidate set")
        constraint = constraint_for_schema(tok, schema, prompt_length=3)
        check(bool(constraint.root), "finite JSON schema compiles into a token trie")

        trace_file = root / "traces.jsonl"
        trace_rows = [
            {
                "id": "trace-ok",
                "training_eligible": True,
                "verified": True,
                "result": "SUCCESS",
                "input": "Check status",
                "tool_call": {"name": "status.read", "arguments": {}},
                "tool_result": {"ok": True},
                "rejected_response": "I executed without checking.",
                "final_response": "Status was verified before reporting."
            },
            {
                "id": "trace-no",
                "training_eligible": True,
                "verified": False,
                "result": "SUCCESS",
                "input": "Do not train this",
                "final_response": "Unverified"
            }
        ]
        trace_file.write_text("\n".join(json.dumps(x) for x in trace_rows) + "\n", encoding="utf-8")
        report = convert_traces([str(trace_file)], root / "trace-sft.jsonl", root / "trace-pref.jsonl", root / "trace-report.json")
        check(report["sft_rows"] == 2 and report["preference_rows"] == 1 and report["rejected"].get("unverified") == 1, "trace converter admits only verified eligible evidence")

        eval_report = run_release_evals(dpo_ckpt, device="cpu")
        check(eval_report["passed"], "release eval gates pass on a valid checkpoint")
        eval_path = root / "eval.json"
        eval_path.write_text(json.dumps(eval_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        release = promote(
            dpo_ckpt,
            eval_path,
            release_version="ci-smoke",
            approved_by="ci-release-authority",
            out=root / "release.json",
            signing_key="ci-test-signing-key",
        )
        check(release["signature"]["type"] == "HMAC-SHA256" and len(release["signature"]["value"]) == 64, "promotion emits a signed release manifest")

    print("ForgeLM advanced training/governance smoke test: PASS")


if __name__ == "__main__":
    main()
