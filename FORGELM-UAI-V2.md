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

## Next model tranche

The native ForgeLM package will implement:
- decoder-only Transformer
- GQA
- RoPE
- RMSNorm
- SwiGLU
- KV/prefix cache
- constrained JSON decoding
- Nano then Micro profiles
- optional GGUF export for llama.cpp
- optional vLLM server adapter

It will remain downstream of the same WitForge governance boundary.
