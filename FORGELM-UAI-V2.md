# ForgeLM/UAI v2 integration in WitForge

This release integrates the ForgeLM/UAI v2 engineering architecture into the existing WitForge runtime without weakening its current security or zero-dependency Node deployment model.

## Invariant

`MODEL INTELLIGENCE != SYSTEM AUTHORITY != EXECUTION != VERIFICATION != EVIDENCE`.

ForgeLM may propose answers, plans, tool calls and memory candidates. WitForge remains authoritative for identity, permissions, policy, approvals, capability scope, execution, verification, evidence and audit.

## Added runtime modules

- `forge-contracts.js` — normative enums, ForgeLM Nano/Micro profiles and availability truth.
- `forge-context.js` — deterministic context compilation, trust classes, authority metadata, token budgeting, deduplication, quarantine semantics and context hashing.
- `forge-memory.js` — governed memory proposal/approval/search/expiry over the existing authoritative state store.
- `forge-runtime.js` — provider availability normalization and requirement-based model routing.
- `forgelm-test.js` — release-gate tests for authority, context budgets, memory governance and provider truth.

## Compatibility

WitForge continues to use the existing crash-safe state store. Forge memory records are additive and remain compatible with legacy `state.memory` records. No second database authority is introduced.

The Node runtime remains dependency-free. PyTorch/llama.cpp/vLLM support belongs to the optional model-runtime tranche rather than the core server dependency graph.

## Context trust

Control/instruction classes:
- UAI_ROOT
- PLATFORM
- DEVELOPER
- USER_INSTRUCTION

Information-only classes:
- USER_DATA
- MEMORY
- RETRIEVAL
- TOOL_RESULT
- MODEL_OUTPUT

The information-only classes cannot grant authority.

## Native ForgeLM runtime

Implemented through WitForge 2.13.0 development:

- `model/forgelm/configuration_forgelm.py` — validated Nano and smoke configurations.
- `model/forgelm/modeling_forgelm.py` — decoder-only Transformer with GQA, RoPE, RMSNorm and SwiGLU.
- `model/forgelm/generation.py` — autoregressive generation with dynamic/no-cache execution, seeded sampling, stop sequences, temperature, top-k, top-p, repetition penalty, KV-cache telemetry and an allowed-token constraint hook.
- `model/forgelm/tokenizer.py` — deterministic UTF-8 byte bootstrap tokenizer plus trainable byte-level BPE with immutable reserved action/memory/evidence token IDs.
- `model/forgelm/checkpoint.py` — save/load plus SHA-256 manifest verification and exact parameter counts.
- `model/forgelm/train.py` — local causal-language-model trainer for text and JSONL conversational corpora.
- `model/forgelm/chat.py` — local interactive or one-shot chat against a saved checkpoint.
- `model/forgelm/smoke_test.py` — real forward/backward optimizer step, KV-cache test, checkpoint round-trip and generation test.
- `config/forgelm-nano.json` — the 25,172,352-parameter ForgeLM-Nano architecture target.
- `requirements/forgelm.txt` — optional PyTorch runtime requirement.
- `model/forgelm/dataset.py` — provenance/consent/license/privacy/secret/verified-trace/dedup/holdout gates with a SHA-256 dataset report.
- `model/forgelm/server.py` — loopback-only ForgeNative HTTP service exposing `/health`, `/v1/models`, `/v1/chat/completions` and `/v1/responses`, including true SSE streaming.
- ForgeNative inference is concurrency-bounded (default one decode at a time) with configurable queue timeout, retryable busy state, stream-slot cleanup, and measured active/queued/completed/failed/rejected counters in `/health`.
- `model/forgelm/pipeline_smoke_test.py` — governed dataset and BPE round-trip tests.
- `model/forgelm/server_smoke_test.py` — real ephemeral localhost server round trip in CI.
- `llm.js` — explicit `forge-native` provider on `127.0.0.1:11435`, strict loopback path allowlist, Chat Completions and Responses adapters, SSE aggregation, stop/seed/cache-strategy propagation, and live health probing.
- `config/training-sources.example.json` — source-manifest contract for approved training material.
- `model/forgelm/sft.py` — assistant-only supervised fine-tuning with governed chat and tool-call records.
- `model/forgelm/dpo.py` — Direct Preference Optimization against a verified reference checkpoint.
- `model/forgelm/structured.py` — token-trie constrained decoding for finite strict JSON Schemas; unsupported open schemas fail explicitly.
- `model/forgelm/traces.py` — verified, training-eligible action/correction trace conversion into SFT and preference datasets.
- `model/forgelm/evals.py` — checkpoint/runtime/tokenizer/structured-output release gates bound to checkpoint identity.
- `model/forgelm/promotion.py` — external release approval and HMAC-SHA256 manifest signing; the model cannot self-promote.
- `model/forgelm/advanced_smoke_test.py` — resume → SFT/tool-SFT → DPO → schema → trace → eval → promotion CI path.
- ForgeNative accepts finite strict `response_format` schemas and remains loopback-only for actual inference.
- `model/forgelm/training_utils.py` — shared device/precision policy, CUDA bf16/fp16 autocast, fp16 scaling and gradient accumulation; CPU/Termux `auto` resolves to fp32.
- Pretraining, SFT and DPO support `--grad-accum` plus `--precision auto|fp32|bf16|fp16` and record the effective batch/precision in checkpoint metadata.
- `model/forgelm/quantization.py` — optional CPU dynamic-int8 Linear quantization with truthful runtime reporting; it is not presented as a new checkpoint format.
- `model/forgelm/benchmark.py` — measured local prompt/generation latency, throughput, checkpoint bytes and process-memory report.
- `model/forgelm/quality_eval.py` — checkpoint-bound quality evaluation over approved exact/contains/regex/finite-schema cases.
- Production promotion requires checkpoint-bound runtime, quality and regression evidence; release-manifest v3 signs all gates, while runtime-only promotion remains explicitly dev-only.
- `model/forgelm/promotion.py` verifies signed release manifests against checkpoint/config/tokenizer/weight identities.
- ForgeNative can run with `--require-promoted --release-manifest ...` so serving may be restricted to a verified promoted release.
- `model/forgelm/bundle.py` creates and verifies portable promoted checkpoint bundles without claiming unsupported GGUF/vLLM compatibility.
- Checkpoint v2 supports hashed PyTorch weight shards; monolithic v1/v2 checkpoints remain load-compatible.
- Pretraining, SFT and DPO accept optional shard limits and can resume directly from sharded checkpoints.
- ForgeLM generation reports measured dynamic KV-cache bytes and stop reasons; benchmark v2 records cache telemetry.
- `model/forgelm/inference_export.py` derives a verified inference-only checkpoint, strips optimizer state, preserves source lineage, and explicitly requires fresh evaluation/promotion.
- `model/forgelm/device_profile.py` observes local CPU/RAM/Torch/Android/Termux capability and emits conservative labeled heuristics; performance claims still require benchmarks.
- `model/forgelm/autotune.py` runs subprocess-isolated local benchmark matrices across cache and quantization modes, records measured throughput/RSS/KV-cache evidence, and emits an advisory recommendation without silently changing serving configuration.
- ForgeNative supports deterministic seeded inference, buffered stop sequences that are suppressed from streamed output, and request-selectable `dynamic`, `static`, or `none` cache strategies.
- `dynamic` remains the default growing-cache path; `static` preallocates full-context K/V tensors and appends in place; `none` recomputes the full prefix each step and truthfully reports zero KV-cache bytes.
- `model/forgelm/regression_eval.py` provides checkpoint-bound category-aware regression gates for prompt injection, tool truth, hallucination and conversational regressions.

The Node control plane remains dependency-free. Python/PyTorch is an optional model runtime and does not gain permissions, credentials, execution authority or verification authority.

## Remaining model work

- scale BPE training and governed corpus tooling for large datasets;
- broaden strict structured decoding beyond finite schemas with a tested grammar backend;
- add distributed multi-device training beyond the now-implemented checkpoint weight sharding;
- expand real quality, tool-use, prompt-injection, hallucination and regression evaluation datasets;
- add verified GGUF conversion/runtime compatibility;
- add verified vLLM registration/serving compatibility;
- add quantized and offloaded KV-cache storage variants beyond the implemented dynamic, static and no-cache strategies; measured Android/Termux tuning now has an autotune evidence path and still needs wider real-device profiles.


### Termux measured runtime tuning

Use the profiler first, then the measured autotuner against a real checkpoint. The autotuner benchmarks supported cache/quantization combinations in isolated subprocesses and writes raw measurements plus an advisory recommendation.

```bash
npm run forgelm:device-profile -- --out state/forgelm-device-profile.json

npm run forgelm:autotune -- \
  --checkpoint state/models/forgelm \
  --device cpu \
  --max-new-tokens 8 \
  --memory-fraction 0.60 \
  --out state/forgelm-autotune.json
```

Inspect `recommendation.quantization` and `recommendation.cache_strategy` before starting ForgeNative. Serving defaults are never changed automatically by autotune.
