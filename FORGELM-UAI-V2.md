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

Implemented through WitForge 2.10.0:

- `model/forgelm/configuration_forgelm.py` — validated Nano and smoke configurations.
- `model/forgelm/modeling_forgelm.py` — decoder-only Transformer with GQA, RoPE, RMSNorm and SwiGLU.
- `model/forgelm/generation.py` — KV-cache autoregressive generation with temperature, top-k, top-p, repetition penalty and an allowed-token constraint hook.
- `model/forgelm/tokenizer.py` — deterministic UTF-8 byte bootstrap tokenizer with stable reserved action/memory/evidence token IDs. Byte-level BPE remains the next tokenizer upgrade.
- `model/forgelm/checkpoint.py` — save/load plus SHA-256 manifest verification and exact parameter counts.
- `model/forgelm/train.py` — local causal-language-model trainer for text and JSONL conversational corpora.
- `model/forgelm/chat.py` — local interactive or one-shot chat against a saved checkpoint.
- `model/forgelm/smoke_test.py` — real forward/backward optimizer step, KV-cache test, checkpoint round-trip and generation test.
- `config/forgelm-nano.json` — the 25,172,352-parameter ForgeLM-Nano architecture target.
- `requirements/forgelm.txt` — optional PyTorch runtime requirement.\n- `model/forgelm/dataset.py` — provenance/consent/license/privacy/secret/verified-trace/dedup/holdout gates with a SHA-256 dataset report.
- `model/forgelm/server.py` — loopback-only ForgeNative HTTP service exposing `/health`, `/v1/models` and `/v1/chat/completions`.
- `model/forgelm/pipeline_smoke_test.py` — governed dataset and BPE round-trip tests.
- `model/forgelm/server_smoke_test.py` — real ephemeral localhost server round trip in CI.
- `llm.js` — explicit `forge-native` provider on `127.0.0.1:11435`, path allowlist, live health probe and OpenAI-style chat adapter.
- `config/training-sources.example.json` — source-manifest contract for approved training material.

The Node control plane remains dependency-free. Python/PyTorch is an optional model runtime and does not gain permissions, credentials, execution authority or verification authority.

## Remaining model work

- train the byte-level BPE tokenizer while preserving the reserved IDs;
- structured JSON grammar/schema decoding on top of the allowed-token constraint hook;
- SFT/DPO, preference datasets and richer verified-trace transforms;
- resumable/distributed training and evaluation suites;
- ForgeNative localhost model server and Node provider adapter;
- GGUF conversion/runtime compatibility work;
- vLLM registration/serving compatibility;
- quantization and mobile performance profiles.
