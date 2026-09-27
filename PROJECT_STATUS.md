# IntraultUniversalion requirement ledger

This ledger prevents additive releases from silently dropping earlier requirements.
`IMPLEMENTED` means executable in this repository and covered by tests/status checks.
`PARTIAL` means a real foundation exists but the full requested breadth is not yet complete.
`UNAVAILABLE` means the required external data/hardware/authority is not present.
`RESEARCH-ONLY` means public material may be studied but no proprietary source is claimed.

| Requirement | State | Evidence / boundary |
|---|---|---|
| Single user-facing chat input | IMPLEMENTED | `public/index.html`, `src/onechat.js` |
| Collaborating hidden/specialist agents | IMPLEMENTED | agent registry + per-turn allocations |
| Research + Development + Knowledge + Verification agents | IMPLEMENTED | built-ins with bounded capabilities |
| Agent derivation/self-replication as logical agents | IMPLEMENTED | parent-bounded `AgentRegistry.spawn`; not physical replication |
| Local persistent knowledge + binary transport | IMPLEMENTED | KnowledgeStore + IUB1 transport |
| Capability truth states | IMPLEMENTED | capability registry and per-operation states |
| Three Laws immutable project doctrine | IMPLEMENTED | `src/doctrine.js`; internal project precedence preserved |
| Natural-language development proposals | IMPLEMENTED | Development Agent / OneChat |
| Governed source mutation, snapshot, rollback | IMPLEMENTED | workspace + self-development sandbox |
| Local neural language-model implementation | IMPLEMENTED | ForgeLM PyTorch causal transformer |
| Train/save/load/generate locally | IMPLEMENTED | ForgeLM CLI/tests/checkpoint |
| Verified traces -> training data | IMPLEMENTED | Learning Fabric + dataset v2 pipeline |
| Open model/source study | PARTIAL | governed source registry; approved references can be fetched/studied |
| Copy all source from ChatGPT/Claude/Gemini/Bixby/etc. | RESEARCH-ONLY | proprietary internals are not claimed or fabricated; use public/open sources only |
| Oxford-standard definitive comparison | UNAVAILABLE | requires a legitimately licensed/imported Oxford source |
| Arbitrary physical matter creation/repair | UNAVAILABLE | requires real connected fabrication/robotics hardware and evidence |
| Full production-scale LLM training | PARTIAL | architecture/trainer exists; scale depends on data + compute |
| GPU acceleration | PARTIAL | optional profiles; actual availability is hardware/toolchain dependent |
| Accounts/subscriptions/billing | PARTIAL | local metadata implemented; live billing requires a real billing adapter |

## v0.13-v0.20 additions

- `IMPLEMENTED` — deterministic provenance-bearing dataset v2 with splits/deduplication/hashes.
- `IMPLEMENTED` — ForgeLM KV-cache incremental inference with cached/uncached equivalence test.
- `IMPLEMENTED` — source architecture matrix and local reference-repository snapshot manifests.
- `IMPLEMENTED` — preset trainer v2 with validation, resume state, gradient accumulation and run metadata.
- `IMPLEMENTED` — OneChat Model Lab routing for dataset preparation, training, benchmarking and source analysis.
- `IMPLEMENTED` — learned SentencePiece tokenizer with action/observation/end symbols and byte fallback.
- `IMPLEMENTED / EXPERIMENTAL` — MoE load-balance regularizer and future-token auxiliary loss; disabled in default preset.
- `IMPLEMENTED` — release-integrity SHA-256 manifest and local hardware profiler.

### v0.21.0 response path
- OneChat HTTP/UI response path: IMPLEMENTED + VERIFIED
- Governed coherent fallback response composer: IMPLEMENTED + VERIFIED
- Raw seed-model output quality gate: IMPLEMENTED + VERIFIED
- Production-quality natural-language generation from ForgeLM itself: PARTIAL (requires substantially more training/data/model scale)

### v0.22 additions
- Governed broad web-source registry: IMPLEMENTED
- Direct public URL ingestion with robots/provenance: IMPLEMENTED
- License-aware training eligibility: IMPLEMENTED
- "All web information" mirrored locally: NOT CLAIMED — web-scale data is too large and source rights vary; connectors/importers are used instead.

### v0.23 additions
- Common Crawl WET local import: IMPLEMENTED
- Wikimedia XML dump local import: IMPLEMENTED
- Stack Exchange Posts.xml local import: IMPLEMENTED
- FineWeb JSONL local import: IMPLEMENTED
- FineWeb remote streaming: IMPLEMENTED when optional `datasets` dependency + network are available
- Parquet import: IMPLEMENTED when optional `pyarrow` is available

### v0.24 additions
- License-gated web → ForgeLM dataset bridge: IMPLEMENTED
- Source/license preservation into training examples: IMPLEMENTED
- Termux web-record memory cap: IMPLEMENTED
- Web-scale distributed/sharded pretraining over trillions of tokens: PARTIAL / requires appropriate storage and compute

### v0.25 capability recovery
- `IMPLEMENTED` — protected v0.24 chat-working checkpoint lineage.
- `IMPLEMENTED` — core capability count remains exactly 42, but the six legacy provider-chat slots are replaced in the core count by governed source/research capabilities aligned with the ForgeLM goal.
- `IMPLEMENTED` — OpenAI gpt-oss, xAI Grok-1, DeepSeek-V3, Google Gemma, Hugging Face Transformers and Anthropic public-research capability entries.
- `IMPLEMENTED` — Termux neural bootstrap using the official `python-torch` package path when available from the user's configured Termux repositories.
- `IMPLEMENTED` — optional LangGraph.js adapter and Termux installer path.
- `IMPLEMENTED` — Stripe live subscription-read adapter; remains `UNAVAILABLE/CONFIGURED` until a legitimate secret key is supplied and a live probe succeeds.
- `IMPLEMENTED` — Oxford Dictionaries API comparison adapter; remains `UNAVAILABLE/CONFIGURED` until legitimate Oxford credentials are supplied and a live probe succeeds.
- `IMPLEMENTED` — approval-gated OctoPrint fabrication adapter; remains unavailable/configured until real hardware, endpoint/key, explicit enable flag and successful printer probe exist.
- Baseline truth target without neural/LangGraph/external credentials: `35/42 CONNECTED`.
- Local neural + LangGraph target after successful bootstrap: `39/42 CONNECTED`.
- Oxford + Stripe can raise the verified live total to `41/42` with legitimate credentials.
- `42/42` is only truthful with a real verified fabrication controller/printer.

## v0.26.0 additions
| Requirement | State | Evidence |
|---|---|---|
| Local high-volume storage database | IMPLEMENTED | SQLite `data/intraultuniversalion.sqlite3`, WAL, indexed tables, FTS5 when available |
| Free definition database | IMPLEMENTED | Princeton WordNet 3.0 importer and governed source registry |
| Free conversational/banter database | IMPLEMENTED | OpenAssistant OASST1 importer, Apache-2.0 source metadata |
| OneChat definition retrieval | IMPLEMENTED | Lexicon Agent allocation and SQLite definition search |
| OneChat banter/dialogue retrieval | IMPLEMENTED | Dialogue Agent allocation and SQLite full-text search |
| Language DB -> ForgeLM training bridge | IMPLEMENTED | `storage/export_training.py` plus `model/data_pipeline.py` language database loader |
| Entire external corpora bundled in release ZIP | NOT BUNDLED | Downloaded on the user's device to preserve source provenance and avoid inflating the source release |


## v0.27-v0.30 additions
- IMPLEMENTED: WordNet lexical relationship graph and OneChat relationship queries.
- IMPLEMENTED: deterministic dialogue style profiling and style-aware retrieval.
- IMPLEMENTED: dependency-free sparse semantic-vector index in SQLite.
- IMPLEMENTED: ByteActionTokenizer moved to a Torch-free core module.
- IMPLEMENTED: GitHub-ready `.gitignore`, CI workflow, contribution and migration guidance.
- PARTIAL: neural semantic embeddings remain optional/future because current Termux neural dependencies are unresolved.

## v0.31-v0.34 additions
- IMPLEMENTED — durable task persistence with lifecycle history and restart-safe step checkpoints.
- IMPLEMENTED — action envelope persistence carrying identity, intent, capability scope, authority/security metadata, execution, verification, recovery and audit lineage.
- IMPLEMENTED — explicit task resume and cancellation through OneChat and HTTP APIs.
- IMPLEMENTED — evidence-classed availability snapshots persisted separately from capability declarations.
- IMPLEMENTED — public GitHub privacy boundary for mutable state, local knowledge, generated training data, checkpoints, tokenizer artifacts and secrets.
- PARTIAL — truly long-running/background execution remains bounded by the foreground localhost process; persistence enables continuation after restart but does not claim autonomous background execution when the process is stopped.

## v0.35-v0.36 additions
- IMPLEMENTED — independent policy decision engine with ALLOW/DENY/ASK/ESCALATE/BLOCK outcomes.
- IMPLEMENTED — persistent approval requests and decisions with expiry semantics.
- IMPLEMENTED — scoped, expiring, revocable autonomy leases with risk ceilings and action budgets.
- IMPLEMENTED — OneChat/API surfaces for policy, approvals and autonomy governance.
- PARTIAL — approval binding into every individual external adapter is not yet universal; existing high-impact adapters still keep their own explicit gates.

## v0.37-v0.42 additions
- `IMPLEMENTED` — SQLite WAL governance store with optimistic versioning and legal task-transition matrix.
- `IMPLEMENTED` — exact-operation approval binding and replay/mutation rejection.
- `IMPLEMENTED` — JSON Schema 2020-12 plugin/transfer contracts plus SHA-256 integrity envelopes.
- `IMPLEMENTED` — plugin registration/signature verification boundary; third-party execution remains `UNAVAILABLE` unless an external sandbox is explicitly configured and exact invocation approval succeeds.
- `IMPLEMENTED` — model/runtime registry with truthful local runtime detection; registry presence is not runtime availability.
- `IMPLEMENTED` — local llama.cpp status/chat adapter when a trusted server is actually reachable.
- `IMPLEMENTED` — external-content quarantine, prompt-injection/PII/secret signals, canonical URLs and cross-run content deduplication.
- `IMPLEMENTED` — separate retrieval eligibility and explicit training approval for web material.
- `IMPLEMENTED` — retention metadata, soft deletion and hard source purge for SQLite language data.
- `IMPLEMENTED` — hybrid FTS5 + sparse semantic retrieval and recall@k/MRR evaluation utility.
- `IMPLEMENTED` — LoRA/QLoRA/DPO dependency/status planning and continual-learning replay snapshot foundations.
- `PARTIAL` — LoRA/QLoRA/DPO execution requires compatible external base models/dependencies and is not claimed connected when absent.
- `UNAVAILABLE` — multimodal/federated training remain unavailable until modality pipelines, secure aggregation/privacy accounting and evaluation are implemented.


## v0.43.0 additions
- IMPLEMENTED + VERIFIED — transactional SQLite migration for agents, accounts, subscriptions, control-center plugin metadata and availability snapshots, preserving legacy JSON through one-time import/rename.
- IMPLEMENTED + VERIFIED — tamper-evident SHA-256 audit chain with legacy-prefix anchoring and explicit verification API.
- IMPLEMENTED + VERIFIED — plugin idempotency/replay protection using the governance store; identical request/key replays without re-execution and changed request/key collisions are denied.
- IMPLEMENTED — generic `build/*` CI and manifest automation, removing v0.34 branch hard-coding.
- IMPLEMENTED — repository architecture contracts for control/execution/evidence/data planes.
- PARTIAL — full blueprint module decomposition remains incremental; the current flat `src/` layout is retained until behavior-preserving refactors are independently verified.
## v0.44.0 additions
- IMPLEMENTED + VERIFIED — operation-scoped plugin gateway with inline JSON-schema input/output validation.
- IMPLEMENTED + VERIFIED — per-operation policy, exact approval binding, bounded autonomy checks and transactional idempotency.
- IMPLEMENTED + VERIFIED — capability-evidence checks for explicitly required runtime capabilities.
- IMPLEMENTED + VERIFIED — scoped secret injection using allowlisted secret names and exact-value output redaction.
- IMPLEMENTED + VERIFIED — input URL destination allowlists, timeout, request cancellation and maximum output-byte enforcement.
- IMPLEMENTED — v2 plugin manifest fields for operations, secrets, runtime requirements and resource budgets while preserving v1 compatibility.
- PARTIAL — filesystem/network/CPU/memory hard isolation is delegated to the explicitly configured external sandbox. The Node host passes declared restrictions and uses a minimal environment but does not claim kernel/container isolation by itself.

## v0.45.0 additions
- IMPLEMENTED + VERIFIED — provenance-aware document store with canonical URIs, content hashes, immutable content-addressed text objects, revisions and deterministic chunks.
- IMPLEMENTED + VERIFIED — separate retrieval eligibility, source training eligibility and explicit training approval.
- IMPLEMENTED + VERIFIED — document FTS retrieval with source/document/chunk/revision/provenance evidence exposed through HTTP and OneChat.
- IMPLEMENTED + VERIFIED — web ingestion bridge into the provenance document plane while retaining legacy web-corpus compatibility.
- IMPLEMENTED + VERIFIED — document soft deletion and hard purge with retrieval-index removal and unreferenced object cleanup.
- PARTIAL — multimodal page/frame/timestamp/bounding-box lineage, dense embeddings/reranking, derived-artifact purge and full provenance graph are not yet claimed.

## v0.46-v0.48.2 additions
- IMPLEMENTED + VERIFIED — local self-governance kernel with request/correlation identity, per-route authorization metadata, policy evaluation and exact approval binding.
- IMPLEMENTED + VERIFIED — first-run email/password Owner enrollment, scrypt credential verification, server-side session records, HttpOnly session cookie, CSRF validation and logout/revocation.
- IMPLEMENTED + VERIFIED — authenticated browser/API state-change flow and route-level request schemas/rate limits.
- IMPLEMENTED + VERIFIED — native bounded-context conversation engine using connected llama.cpp first and ForgeLM fallback, with truthful UNAVAILABLE when no promoted runtime exists.
- IMPLEMENTED + VERIFIED — explicit capability truth states CONNECTED/CONFIGURED/REGISTERED_SOURCE/DEGRADED/UNAVAILABLE/BLOCKED/EXPIRED.
- FIXED — cumulative self-development sandbox regression now checks greeting behavior semantically rather than requiring an obsolete literal sentence.
- FIXED — plugin/document HTTP tests and CI localhost smoke use the current Owner session + CSRF flow rather than retired bearer-token assumptions.
- PARTIAL — first-run enrollment does not yet require an independent bootstrap file, trusted-device key, or equivalent ownership proof before the first local Owner is claimed.
- UNMERGED — v0.48.1 evidence-envelope/model-router foundations remain outside this repair checkpoint until they gain integrated system tests.

## v0.49.0 additions
- IMPLEMENTED + VERIFIED — health-aware local model router with runtime probes, execution constraints, deterministic ranking and fallback traces.
- IMPLEMENTED + VERIFIED — native conversation routed through the model router with output-quality acceptance before fallback.
- IMPLEMENTED + VERIFIED — integrity-hashed OneChat evidence envelope with claim support states, cited chunks, model route and tool-call summaries.
- IMPLEMENTED + VERIFIED — user-facing `explain answer` evidence summary without private chain-of-thought.
- IMPLEMENTED + VERIFIED — stable per-tab browser chat ID for live context continuity.
- IMPLEMENTED + VERIFIED — persisted chat-turn records are rehydrated into bounded per-chat model context after process restart when the same chatId is reused; unrelated chats remain isolated.
- IMPLEMENTED + VERIFIED — owner credential bootstrap/rotation from local environment or explicit local CLI; legacy bearer-owner authentication is disabled and active sessions are revoked on credential rotation.



## v0.51.0 additions
- IMPLEMENTED + VERIFIED — restart-safe conversation rehydration from persisted `chat-turn` records into the existing bounded native conversation context.
- IMPLEMENTED + VERIFIED — restored history participates in follow-up intent detection before routing and in the subsequent local model prompt.
- VERIFIED — chat isolation, 40-turn cap, context-token compaction and no-cross-chat restoration are covered by `verification/conversation-memory-v051.test.mjs`.
- BOUNDARY — this is local persisted conversation continuity, not hidden chain-of-thought persistence and not a claim of proprietary-model parity.

## v0.52.0 additions
- IMPLEMENTED + VERIFIED — bounded virtual shadow-agent R&D with resource ceilings, persistent lifecycle records, research-agent registry, disagreement detection, quarantined candidate storage and independent promotion gates.
- IMPLEMENTED + VERIFIED — bounded light-agent source-maintenance system with isolated detached worktrees, patch lifecycle records, mandatory changed-file/reason/test/risk/dependency/rollback/evidence fields, test/security/shadow review and cleanup/rollback.
- IMPLEMENTED + VERIFIED — protected local governance extensions covering policy storage, protected-rule classification, emergency stop, capability boundary, audit verification and trusted-device enrollment/revocation records.
- IMPLEMENTED — runtime roadmap catalog for model categories/runtimes, learning methods, retrieval layers, memory classes, plugin/connector/tool categories, benchmark tracks and observability metrics.
- BOUNDARY — a shadow candidate remains `productionEligible=false` and `trainingEligible=false` after research acceptance; a separate governed downstream process must act on it.
- BOUNDARY — light-agent promotion only makes a tested patch promotion-eligible; light agents cannot commit or merge directly to protected `main`.
- BOUNDARY — trusted-device registration currently records a public-key fingerprint but does **not** claim independent hardware/bootstrap ownership proof.
- PARTIAL / UNAVAILABLE AS COMPLETE — full multimodal ingestion; image understanding; layout-aware OCR; audio transcription; video understanding; dense embedding/reranking; complete cross-artifact provenance graph; production OS/kernel plugin isolation; federated and multimodal learning; distillation; large-scale model training; general-purpose LLM parity; automatic ensemble orchestration; large-scale autonomous research/source-maintenance populations; encrypted multi-device sync; enterprise identity federation; full IDE integration; full dependency graph; large-scale benchmark leaderboard; energy-aware scheduling; formal governance-kernel verification; complete self-hosted model marketplace/offline catalog; independent trusted-device/bootstrap proof.
- NOT SUPPORTED — unbounded/infinite live agent generation and automated source-code promotion without separate local-owner authority.

## v0.53.0 additions
- IMPLEMENTED + VERIFIED — dedicated `shadow_runs`, `shadow_candidates`, `light_patches`, `light_worktrees` and `agent_jobs` SQLite tables with v0.52 compatibility migration.
- IMPLEMENTED + VERIFIED — persistent bounded worker scheduling with queue/concurrency ceilings, priority, TTL expiry, lease ownership and stale-lease recovery.
- IMPLEMENTED + VERIFIED — authenticated scheduler status/jobs/dispatch/maintenance APIs and single-chat operations dashboard covering tasks, capabilities, models, plugins, approvals, shadow/light state, evidence and audit integrity.
- IMPLEMENTED — Termux control-plane status/jobs/dispatch/maintenance CLI.
- PARTIAL — multi-query public-web research plus optional Brave Search API adapter; provider/network/index coverage remains conditional and exhaustive internet coverage is not claimed.
- BOUNDARY — scheduler completion grants no promotion authority. Shadow candidates remain quarantined/governed and light patches remain outside protected-`main` merge authority until a separate owner-authorized promotion path acts.
- STILL PARTIAL / UNAVAILABLE AS COMPLETE — multimodal ingestion/understanding/training, dense embeddings/reranking, complete provenance graph, production kernel sandboxing, federated learning, distillation at scale, model parity, automatic ensembles, encrypted multi-device sync, enterprise federation, full IDE integration, formal governance verification, complete marketplace/catalog, and independent bootstrap ownership proof.

## v0.54.0 additions
- IMPLEMENTED + VERIFIED — explicit-consent user-owned memory namespaces with source/reason/confidence/retention/expiry/deletion/training metadata and training disabled by default.
- IMPLEMENTED + VERIFIED — optional AES-256-GCM memory encryption via a local owner-supplied key; without a key the runtime reports PLAINTEXT_LOCAL rather than claiming encryption.
- IMPLEMENTED + VERIFIED — provenance node/edge graph, bounded lineage tracing, dry-run purge plans and linked-memory purge propagation.
- IMPLEMENTED + VERIFIED — non-executing policy simulation with data/access/approval/external-transfer/risk reporting and safer-plan output.
- IMPLEMENTED + VERIFIED — richer final-call policy metadata, arguments hashes and optional local Ed25519 decision signatures.
- IMPLEMENTED + VERIFIED — model artifact SHA-256/optional Ed25519 verification and persistent artifact records separated from runtime/production eligibility.
- IMPLEMENTED + VERIFIED — evidence-backed evaluation records, verified-only leaderboards, benchmark runner and promotion evidence score.
- PARTIAL — provenance purge propagation currently covers graph state and linked UAI memory records; legacy documents, embeddings, datasets and model artifacts still require explicit store-specific deletion integration.
- STILL PARTIAL / UNAVAILABLE AS COMPLETE — dense neural embeddings/reranking, multimodal OCR/audio/video pipelines, full source-code symbol/dependency graph, production kernel sandbox isolation, encrypted multi-device sync, federated personalization, distillation at scale, formal governance verification, complete marketplace/catalog and independent hardware bootstrap ownership proof.

## v0.55.0 additions
- IMPLEMENTED, CI PENDING — verified knowledge now uses the existing SQLite/WAL platform-state plane with legacy JSON migration.
- IMPLEMENTED, CI PENDING — approved-domain research worker and persistent bounded scheduler; external content remains untrusted data.
- IMPLEMENTED, CI PENDING — independent-source corroboration plus separate training-rights policy; caller trust cannot grant eligibility.
- IMPLEMENTED, CI PENDING — optional cloud durability with local-first fallback and local reverification on recovery.
- IMPLEMENTED, CI PENDING — ForgeLM CLI, Model Lab, OneChat and knowledge learning are candidate-first rather than auto-promoting.
- IMPLEMENTED, CI PENDING — held-out knowledge/general-regression evaluation, checkpoint hashes, owner-bound promotion and rollback.
- BOUNDARY — research schedules run only while localhost UAI is running.
- BOUNDARY — research/retrieval approval does not imply training eligibility.
- PARTIAL — claim corroboration currently uses normalized exact-claim matching rather than full semantic entailment.
- STILL PARTIAL — dense neural retrieval, multimodal pipelines, kernel-grade sandboxing, encrypted multi-device sync, federated learning, large-scale distillation/training, automatic ensembles and frontier-model parity.

