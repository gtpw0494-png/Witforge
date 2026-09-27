from __future__ import annotations

import json
from pathlib import Path
import tempfile

import torch

from .benchmark import benchmark_checkpoint
from .bundle import create_bundle, verify_bundle
from .checkpoint import checkpoint_identity, load_checkpoint, save_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .dpo import dpo_loss, load_preferences, train_dpo
from .evals import run_release_evals
from .modeling_forgelm import ForgeLMForCausalLM
from .promotion import promote, verify_release_manifest
from .quality_eval import score_output
from .server import ForgeNativeService
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
        r1 = train(
            cfg,
            ["WitForge governed training data."],
            out_dir=str(first),
            steps=1,
            batch_size=1,
            seq_len=24,
            learning_rate=1e-3,
            device_name="cpu",
            seed=3,
            precision="auto",
            gradient_accumulation_steps=2,
            max_shard_bytes=4096,
        )
        r2 = train(
            cfg,
            ["WitForge governed training data."],
            out_dir=str(resumed),
            steps=1,
            batch_size=1,
            seq_len=24,
            learning_rate=1e-3,
            device_name="cpu",
            seed=3,
            resume_dir=str(first),
            precision="auto",
            gradient_accumulation_steps=2,
        )
        check(r1["precision"] == "fp32", "CPU auto precision resolves truthfully to fp32")
        check(r1["manifest"]["weights_format"] == "pytorch_state_dict_sharded", "pretraining can emit sharded checkpoints")
        check(r1["manifest"]["metadata"]["effective_batch_size"] == 2, "pretraining records effective accumulated batch size")
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
        sft_result = train_sft(
            str(base),
            records,
            out_dir=str(sft_ckpt),
            steps=1,
            batch_size=1,
            learning_rate=5e-4,
            max_length=96,
            device="cpu",
            seed=5,
            precision="auto",
            gradient_accumulation_steps=2,
            max_shard_bytes=4096,
        )
        check(sft_result["manifest"]["weights_format"] == "pytorch_state_dict_sharded", "SFT can emit sharded checkpoints")
        check(sft_result["manifest"]["metadata"]["tool_records"] == 1, "tool-use SFT count is recorded")
        check(sft_result["manifest"]["metadata"]["effective_batch_size"] == 2, "SFT records accumulated effective batch size")

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
        dpo_result = train_dpo(
            str(sft_ckpt),
            prefs,
            out_dir=str(dpo_ckpt),
            steps=1,
            learning_rate=1e-5,
            beta=0.1,
            max_length=96,
            device="cpu",
            seed=7,
            precision="auto",
            gradient_accumulation_steps=2,
            max_shard_bytes=4096,
        )
        check(dpo_result["manifest"]["weights_format"] == "pytorch_state_dict_sharded", "DPO can emit sharded checkpoints")
        check(dpo_result["manifest"]["metadata"]["stage"] == "DPO", "DPO checkpoint records its stage")
        check(dpo_result["manifest"]["metadata"]["gradient_accumulation_steps"] == 2, "DPO records gradient accumulation")

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

        bench = benchmark_checkpoint(base, max_new_tokens=2, device="cpu", quantization="none", warmup_tokens=0)
        check(bench["generated_tokens"] >= 1 and bench["tokens_per_second"] > 0, "benchmark reports measured local generation throughput")

        check(score_output({"type": "contains", "value": "policy"}, "Use policy and verification.")["pass"], "quality contains scorer works")
        check(score_output({"type": "regex", "value": r"verification\.$"}, "Use policy and verification.")["pass"], "quality regex scorer works")
        check(score_output({"type": "exact", "value": "ALLOW"}, "ALLOW")["pass"], "quality exact scorer works")

        eval_report = run_release_evals(dpo_ckpt, device="cpu")
        check(eval_report["passed"], "runtime release eval gates pass on a valid checkpoint")
        eval_path = root / "eval.json"
        eval_path.write_text(json.dumps(eval_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        quality_path = root / "quality.json"
        quality_report = {
            "schema": "witforge.forgelm.quality-report.v1",
            "checkpoint_manifest_sha256": checkpoint_identity(dpo_ckpt),
            "weights_sha256": dpo_result["manifest"]["weights_sha256"],
            "quantization": "none",
            "total": 3,
            "passed_cases": 3,
            "pass_rate": 1.0,
            "minimum_pass_rate": 1.0,
            "passed": True,
            "cases": [],
        }
        quality_path.write_text(json.dumps(quality_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        refused = False
        try:
            promote(
                dpo_ckpt,
                eval_path,
                release_version="ci-should-refuse",
                approved_by="ci-release-authority",
                out=root / "refused-release.json",
                signing_key="ci-test-signing-key",
            )
        except ValueError:
            refused = True
        check(refused, "production promotion refuses runtime-only evidence without quality gates")

        release_path = root / "release.json"
        release = promote(
            dpo_ckpt,
            eval_path,
            quality_report=quality_path,
            release_version="ci-smoke",
            approved_by="ci-release-authority",
            out=release_path,
            signing_key="ci-test-signing-key",
        )
        check(release["quality_gate"] == "QUALITY_VERIFIED", "promoted release records verified quality evidence")
        check(release["signature"]["type"] == "HMAC-SHA256" and len(release["signature"]["value"]) == 64, "promotion emits a signed release manifest")
        release_check = verify_release_manifest(release_path, dpo_ckpt, signing_key="ci-test-signing-key")
        check(release_check["ok"], "signed promoted release re-verifies against checkpoint identity")

        promoted_service = ForgeNativeService(
            dpo_ckpt,
            release_manifest=release_path,
            require_promoted=True,
            release_key="ci-test-signing-key",
        )
        promoted_health = promoted_service.health()
        check(promoted_health["release_verified"] is True and promoted_health["promotion_required"] is True, "ForgeNative can enforce promoted-only serving")

        bundle_dir = root / "bundle"
        create_bundle(dpo_ckpt, release_path, bundle_dir, signing_key="ci-test-signing-key")
        bundle_check = verify_bundle(bundle_dir, signing_key="ci-test-signing-key")
        check(bundle_check["ok"], "portable promoted bundle verifies every file and release signature")

    print("ForgeLM advanced training/governance smoke test: PASS")


if __name__ == "__main__":
    main()
