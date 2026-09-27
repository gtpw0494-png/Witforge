# AI learning, model, plugin and data architecture — v0.42

This document records which modern techniques are implemented, runtime-conditional, research-only or unavailable. Source presence never implies runtime availability.

## Learning paths

- **ForgeLM causal pretraining:** implemented at small/local scale with the project PyTorch decoder, trainer presets, checkpoints and validation.
- **Supervised fine-tuning:** foundation implemented through instruction/response dataset-v2 and verified traces.
- **LoRA / QLoRA:** runtime-conditional. UAI checks for `transformers`, `peft` and `torch`; it does not claim adapter training when those dependencies or an eligible base model are absent. Reference: Hugging Face PEFT LoRA/QLoRA documentation.
- **DPO:** runtime-conditional. Preference optimization is not promoted until a supervised baseline, preference-pair provenance and holdout regression checks exist. Reference: Hugging Face TRL DPO Trainer.
- **RAG:** implemented local foundation using SQLite FTS5 + dependency-free sparse vectors + metadata/provenance fields.
- **Continual learning:** replay snapshot and regression-holdout foundations are implemented. Raw/unreviewed chat history is not silently used for training.
- **Distillation:** research-only until teacher/student licensing and evaluation are explicit.
- **Multimodal/federated training:** unavailable/planned; not reported as connected.

The machine-readable registry is `research/learning_methods.json`.

## Model lifecycle

`research/model_registry.json` separates:

1. model identity/version;
2. file/runtime format;
3. tokenizer compatibility;
4. source/license metadata;
5. quantization metadata;
6. runtime installation;
7. successful runtime probe/inference.

Current registry entries cover ForgeLM, GGUF/llama.cpp, Ollama, Transformers and ONNX Runtime. `src/model-registry.js` reports actual runtime presence separately. `src/model-runtime-adapter.js` can probe a trusted local llama.cpp server and use `/v1/chat/completions`; remote model-runtime URLs are blocked by default.

## Plugin boundary

`schemas/plugin-manifest.schema.json` defines a versioned manifest containing identity/version, entrypoint, capabilities, filesystem/network/process permissions, risk, timeout, provenance hash, reversibility and optional Ed25519 signature.

Unsigned/unverified third-party plugins may be registered for inspection but are not executable. `src/plugin-executor.js` requires an explicitly configured external sandbox command and exact-operation approval before execution. This intentionally avoids claiming that a child process alone is a strong security sandbox.

## Web and document ingestion

External content is untrusted data and has `instructionAuthority: NONE`.

Direct web ingestion now performs:

`URL canonicalization → public-target check → robots check → size/MIME limits → text extraction → prompt-injection/secret/PII scan → dedupe hash → quarantine/promotion → retrieval storage → optional training promotion`

Retrieval eligibility and training eligibility are separate. A web record enters ForgeLM training only when:

- the source/license policy marks it eligible;
- an explicit training approval flag is present;
- the security scan does not block training.

Bulk imports similarly require `--training-approved`; source profile eligibility alone is insufficient.

## Storage and deletion

Language/retrieval data remains in SQLite with WAL and FTS5 where available. Governance state uses a separate SQLite WAL database with optimistic version checks and event history. On supported Node versions this uses `node:sqlite`; older runtimes fall back to the Python SQLite bridge.

`storage/lifecycle.py` supports retention metadata, soft deletion and hard source purge. Definition/dialogue retrieval and training export exclude deleted or expired sources.

## Technology transfer contracts

`schemas/event-envelope.schema.json` defines the Node/Python/tool transfer envelope:

- schema version;
- event type;
- producer/consumer;
- correlation/task IDs;
- content type + payload;
- provenance;
- security labels;
- retention policy;
- SHA-256 integrity hash;
- optional idempotency key.

`src/contracts.js` creates and verifies these envelopes with byte-size bounds.

## Verification

CI and local tests cover legal/illegal task transitions, optimistic concurrency conflicts, approval-binding replay attempts, transfer-envelope tampering, prompt-injection detection, plugin-manifest validation/signature state, model registry truth, and privacy-boundary rules.
