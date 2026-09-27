# Release history

## v0.73.0 — Termux Runtime and OneChat Recovery
- Added a Termux-safe child-process environment that removes libtermux-exec from Node syntax-validation children when necessary.
- Changed HTTP verification server launches to absolute server.js paths for Android/Termux compatibility.
- Replaced the browser syntax npm script with a Termux-safe wrapper.
- Added natural capability/help responses backed by live capability truth.
- Web capability questions now probe actual search reachability and expose DNS/provider errors rather than returning a generic collaboration failure.
- Natural bare-domain ingestion such as `ingest www.example.com` is normalized to HTTPS and routed through the governed WebCorpus boundary.
- Added an exact regression test covering Termux preload handling and the reported OneChat prompts.

## v0.72.0 — First-Install ForgeLM Bootstrap Recovery
- Fixed the fresh-install deadlock where ForgeLM candidate evaluation required an already-promoted live checkpoint.
- Added a dedicated first-checkpoint evaluation covering loadability, finite loss metadata, training-trend sanity and local generation.
- Added explicit hash-bound first-checkpoint promotion; later upgrades continue to use live-baseline regression comparison.
- Added `npm run model:bootstrap -- --approve --steps 80` as the local Termux bootstrap path.
- Added regression coverage for first-checkpoint evaluation and promotion.
- Web capability questions are no longer treated as live search queries merely to report whether web research is configured.

## v0.71.0 — Durable OneChat Session Recovery
- Added atomic local state snapshots and append-only JSONL event journals for live OneChat turn sessions.
- Added startup reconciliation so terminal sessions remain terminal, queued sessions safely resume, and previously running/cancel-requested sessions become INTERRUPTED.
- Added explicit owner-triggered resume for interrupted turns as a new linked session; interrupted history is never rewritten.
- Added browser recovery of the active session ID across page reloads and automatic SSE reconnection.
- Added explicit interrupted-generation UI and Resume interrupted turn control.
- Added replay recovery from persisted event journals even when the last state snapshot lagged token events.
- Added regression coverage for restart reconciliation, owner isolation, queued recovery, interrupted state and linked resume.

## v0.70.0 — True ForgeLM Token Streaming
- Added generation-time token callbacks directly inside ForgeLM's local sampling loop.
- Added cumulative decoded token events from the plain-text and multimodal Python runtimes.
- Added newline-delimited token-event parsing in the ForgeLM subprocess bridge.
- Forwarded token events and cancellation through the local ModelRouter and ConversationEngine.
- Added progressive assistant-text rendering in the existing OneChat live session.
- Stop generation terminates the same local ForgeLM process producing the stream.
- Added a dedicated neural token-callback test plus live-session token-event coverage.
- Fixed IUB persistence so undefined values cannot generate invalid canonical JSON.
- Capability truth now exposes local.forgelm.token_stream only when the promoted ForgeLM runtime is ready.

## v0.69.0 — Live OneChat Turn Sessions
- Added owner-bound live OneChat turn sessions with queued, running and terminal states.
- Added replayable SSE execution events for intent, attachments, collaborator allocation, tools, model phases, verification and persistence.
- Added Stop generation and cancellation state handling.
- Local ForgeLM subprocesses now receive AbortSignal and are terminated on cancellation.
- Non-interruptible collaborators are checked at phase boundaries and late results are discarded after cancellation.
- Added reconnect/resume from the last observed event sequence.
- Added live progress UI and Stop control in the existing OneChat composer.
- Added regression coverage for cancellation, ownership, event replay and late-result discard.
- Truth boundary: v0.69 claims live execution-event streaming. It does not claim token-level model streaming unless a connected runtime actually emits token chunks.

## v0.68.0 — OneChat Turn Controls
- Added per-turn Edit, Retry, Regenerate, Branch, Copy, Export and Evidence controls inside the existing OneChat stream.
- Edit/retry/regenerate are append-only: they create a branch before the selected turn and re-run the user message rather than rewriting prior history.
- Added single-turn JSON export and owner-bound turn lookup.
- Added sanitized structured evidence inspection without private chain-of-thought or server filesystem paths.
- Added automatic local conversation titles from the first user turn.
- Attachment evidence now uses registered media IDs instead of file: paths.
- Added regression coverage for branching, auto-title, owner isolation and path-safe turn exports.

## v0.67.0 — OneChat Conversation Management
- Added owner-bound local conversation listing, search, switching and new-chat creation inside the same OneChat surface.
- Added append-only rename/archive controls and sanitized JSON export.
- Added explicit conversation deletion for local chat/control records while retaining registered media artifacts.
- Added per-conversation turn, attachment and evidence counts.
- Added owner-bound history reads and conversation exports.
- Added governed request schemas and regression coverage for search, rename, archive, export and delete.
- Repaired the stale v0.49 model-routing UI assertion without weakening its routing/evidence checks.

## v0.66.0 — Persistent Attachment-Aware OneChat History
- Added sanitized OneChat history retrieval with persisted attachment metadata and no filesystem-path disclosure.
- Added governed media reopening by registered media ID with owner, approved-root and file-existence checks.
- Switched browser OneChat attachment payloads from server paths to media IDs.
- Added restored attachment cards with image thumbnails, inline audio/video controls and governed open links for other document types.
- Added browser JavaScript syntax validation to authoritative CI.
- Added regression coverage proving history omits paths and mismatched owners cannot resolve media content.
- Repaired the stale v0.49 UI payload assertion to validate semantics instead of a literal source substring.

## v0.65.0 — Single-Chat Attachment UI
- Added attachment selection, preview/status chips, removal and progress directly to the existing OneChat composer.
- Added governed chunked browser uploads that stay below the API request-size ceiling and support media up to 400 MB.
- Added bounded-memory SHA-256 hashing and atomic promotion into state/media-input before provenance registration.
- Added attachment-only OneChat turns and automatic attachment submission through /api/onechat.
- Kept the UI to one chat surface; no parallel multimodal chat page was introduced.
- Added a static UI contract regression test plus the existing multimodal attachment execution test.

## v0.64.0 — OneChat Native Multimodal Attachments
- Added first-class OneChat attachments for local image, audio, video, text/table/structured and PDF evidence.
- Added history-aware multimodal conversation routing so attachment turns and later text follow-ups share the same chat continuity.
- Added local media registration, content hashing, provenance evidence and parser-backed document extraction.
- Added governed /api/media/status, /list, /register and /extract endpoints.
- Added attachment request validation and approved-root path enforcement.
- Added authoritative OneChat attachment regression tests.
- Clarified that the media pipeline reports parser/probe availability separately from native model runtime availability.

## v0.63.0 — Unified ForgeMultimodal Fusion
- Added a parameter-free local fusion assembler that combines image, audio, video, document/context and text tokens into one bounded ForgeLM prefill.
- Added a unified native multimodal runtime and governed /api/multimodal/status + /api/multimodal/chat surface.
- Kept each modality independently health-gated; supplying an unavailable modality fails truthfully rather than falling back to an external model.
- Added token budgeting across modalities and local path validation before media reaches Python.
- Added an optional trainable ForgeFusion transformer architecture, kept separate from the production assembler until a separately trained/evaluated checkpoint exists.
- Added CPU fusion tests. No external AI model participates in the unified path.

## v0.62.0 — Native ForgeVideo Runtime
- Added ForgeVideo, reusing ForgeVision for local frame semantics and adding temporal transformer modeling across frame sequences.
- Added local ffmpeg-based frame extraction, video-text alignment training against ForgeLM embeddings, and held-out candidate evaluation.
- Added hash-bound owner-approved promotion, rollback snapshots, and runtime health checks.
- Added native video tokens + text prompt prefill through ForgeLM for local video understanding.
- Added governed path-bounded video inference and explicit request/authorization controls.
- Added CPU and lifecycle tests. No external AI/video model is required.

## v0.61.0 — Native ForgeSpeech Runtime
- Added ForgeSpeech, a ForgeLM-conditioned local waveform generator with transposed-convolution temporal decoding.
- Added local text/WAV training using waveform reconstruction plus log-spectral reconstruction loss.
- Added local held-out speech evaluation, hash-bound owner-approved promotion, rollback snapshots and runtime health.
- Added dependency-free PCM WAV synthesis output through Python's standard library.
- Added governed speech synthesis routes restricted to the UAI speech-output directory.
- Added CPU and lifecycle tests. No external TTS model or cloud speech API is required.

## v0.60.0 — Native ForgeAudio Runtime
- Added ForgeAudio, a trainable local log-spectral audio encoder with transformer blocks and a ForgeLM-space projector.
- Added dependency-free PCM WAV decoding and local audio-text alignment training against ForgeLM's own text embeddings.
- Added local candidate evaluation, hash-bound owner-approved promotion, rollback snapshots and runtime health checks.
- Added native audio-token + text-token ForgeLM transformer prefill for local audio understanding/transcription-style tasks.
- Added governed, path-bounded audio inference and explicit authorization/request schemas.
- Added CPU and lifecycle tests. No external speech/AI model is required.

## v0.59.0 — Governed ForgeVision Runtime
- Added local image-caption candidate evaluation with ForgeLM embedding compatibility and regression thresholds.
- Added hash-bound, owner-approved ForgeVision promotion with atomic live checkpoint replacement and rollback snapshots.
- Added native ForgeVision-to-ForgeLM multimodal prefill so promoted visual tokens condition the same local ForgeLM transformer/cache used for text generation.
- Added runtime health that reports CONNECTED only when both promoted checkpoints load and their dimensions match.
- Added governed, path-bounded local vision inference API plus explicit request schemas and high-risk promotion/rollback authorization.
- Added lifecycle and multimodal runtime CI tests. No external AI model is used for the native vision path.

## v0.58.0 — Native ForgeVision Foundation
- Added a trainable local visual patch encoder with transformer blocks and a projector into ForgeLM hidden-state space.
- Added a local image-caption alignment trainer that learns against ForgeLM's own text embeddings; no external AI teacher/model is required.
- Added normalized native image embeddings, save/load checkpoint format and multimodal adapter primitives.
- Added explicit capability truth: architecture and local training are implemented, while semantic image inference remains UNAVAILABLE until a trained/evaluated ForgeVision checkpoint is explicitly promoted.
- Added authoritative CPU tests for shape, projection, gradient flow, save/load and normalized embeddings.
- Repaired the v0.57 RoPE source syntax defect uncovered by authoritative CI.

## v0.57.0 — Independent ForgeLM Native Context
- Removed external provider models from the core model router by default. External model routing is now an explicit compatibility/research opt-in through `IUV_ENABLE_EXTERNAL_MODEL_ROUTING=true`.
- Added ForgeLM-native long-context memory that chunks sources locally, embeds them with the promoted ForgeLM checkpoint, cosine-ranks relevant chunks and assembles bounded evidence context without any external model.
- Added RoPE position scaling to the ForgeLM transformer and new Termux/desktop long-context research presets.
- Added self-sufficient `long-context` inference through the local ForgeLM service, JavaScript bridge and model router.
- Added CPU tests that distinguish source-scale retrieval memory from the transformer's active attention window.
- Vision/image/audio/video generation remain separate native-model work; v0.57 does not claim those capabilities are locally complete.

## v0.56.0 — Frontier Model Fabric and Native ForgeLM Retrieval
- Corrected the cloud provider fabric so configured models can be routed before their first successful call while CONNECTED still requires runtime evidence.
- Added explicit local-vs-cloud OneChat routing; local/offline remains the default and cloud use requires an explicit request or configuration.
- Corrected Puter backend integration to the documented OpenAI-compatible endpoint and PUTER_AUTH_TOKEN contract.
- Added provider-native vision payloads, image generation, JSON-schema structured output, tool contracts, embeddings and Cohere reranking.
- Aligned the model catalog with GPT-6 Astra, GPT-5.3 Codex, GPT-5 Nano, GPT Image 2.5, Claude 5/4.8, Gemini 3.x, Grok 4.x, Cohere, Inference specialty, MiniMax and open-ecosystem aliases without treating catalog presence as availability.
- Added native normalized ForgeLM hidden-state embeddings and local cosine reranking using the promoted checkpoint.
- Added dedicated v0.56 frontier-provider regression tests and authoritative CI gating.
- Local ForgeLM vision/image/audio/video generation and frontier-scale long-context quality remain incomplete until trained modality components, data, compute and benchmark evidence exist.

## v0.55.0 — Governed Knowledge Autonomy and Candidate-First ForgeLM
- Added bounded approved-domain research scheduling with persistent process-bound state.
- Added independent-source corroboration and separate training-rights gates.
- Migrated verified knowledge to the existing SQLite/WAL platform-state database with legacy JSON migration.
- Added optional Postgres/PostgREST-compatible cloud durability with local-first fallback and mandatory local reverification on recovery.
- Changed ForgeLM CLI, Model Lab, OneChat and autonomous knowledge training to candidate-first operation.
- Added held-out knowledge and general regression comparison before owner-bound promotion, plus checkpoint hashing and rollback.
- Added authenticated HTTP and cumulative regression coverage for the v0.55 knowledge/model lifecycle.
- Status remains IMPLEMENTED_UNVERIFIED_REPO until authoritative exact-state CI passes.

## v0.54.0 — User-Owned Intelligence Plane
- Added typed local memory with explicit consent, inspectable source/reason, retention, expiry, training opt-in, deletion controls and optional AES-256-GCM at-rest protection.
- Added queryable provenance nodes/edges, lineage tracing, dry-run purge planning and memory deletion propagation without overstating full cross-store erasure.
- Added policy workflow simulation and richer final-call policy metadata/integrity proofs.
- Added model artifact hashing/signature verification and persistent evaluation/leaderboard records that do not confuse registration with runtime availability.
- Added OneChat, authenticated HTTP, dashboard and Termux surfaces plus dedicated system/integration tests.
- Full multimodal ingestion, dense neural retrieval/reranking, full cross-store provenance purge, production kernel sandbox isolation, encrypted multi-device sync and federated personalization remain incomplete.


## v0.53.0 — Persistent Agent Control Plane
- Migrated shadow runs/candidates and light patches/worktrees into dedicated SQLite tables while preserving v0.52 records through compatibility migration.
- Added persistent bounded `agent_jobs` scheduling with concurrency/queue limits, priority, TTL expiry, lease recovery and explicit worker dispatch.
- Added owner-governed control-plane HTTP routes, emergency-stop inheritance, explicit request schemas, Termux CLI commands and a live operations dashboard.
- Added deterministic unit and HTTP regression suites for storage migration, lease recovery, scheduler limits, dispatch, dashboard aggregation, worktree isolation and emergency-stop blocking.
- Added multi-query governed public-web research and an optional Brave Search path without claiming exhaustive web coverage.
- Shadow/light completion still cannot self-promote, self-deploy or merge protected `main`.


## v0.30.0
GitHub-ready cumulative checkpoint: dependency-free tokenizer core, GitHub Actions CI, repository ignore policy, and migration guidance.

## v0.29.0
Dependency-free sparse semantic-vector index in SQLite with cosine-ranked retrieval from OneChat. This is lexical-semantic vector retrieval, not a neural embedding claim.

## v0.28.0
Style-aware OASST dialogue retrieval with local deterministic style profiles (casual, technical, humorous, enthusiastic, short, question).

## v0.27.0
WordNet relationship graph import and OneChat lexical relationship queries (antonym, hypernym, hyponym, similar-to and other published pointer types).

# Cumulative build batch v0.13.0–v0.20.0

- **v0.13.0 — Data Fabric:** deterministic dataset v2, verification filtering, provenance, deduplication, train/validation splits and hashes.
- **v0.14.0 — Cached Inference:** absolute-position KV cache, top-p support and cached/uncached greedy equivalence benchmark.
- **v0.15.0 — Source Research:** architecture matrix, local reference-repository snapshot tool, model presets and strengthened doctrine metadata.
- **v0.16.0 — Trainer v2:** preset training, validation, resume checkpoints, gradient accumulation, warmup/cosine schedule and run manifests.
- **v0.17.0 — Model Lab:** OneChat collaboration connects dataset preparation, training, benchmarking and source analysis.
- **v0.18.0 — Learned Tokenizer:** SentencePiece BPE with action tokens, checkpoint-bound tokenizer metadata and byte fallback.
- **v0.19.0 — Advanced Objectives:** optional MoE balance regularization and future-token auxiliary objective with loss breakdowns.
- **v0.20.0 — Integrated Release:** hardware profiling, SHA-256 release integrity, full pipeline checkpoint promotion, portability cleanup and final live OneChat verification.

## v0.21.0 — Response Quality Gate
- Added governed response composer for the single OneChat surface.
- Ordinary conversation no longer returns bare retrieval-status strings as the primary response.
- Raw ForgeLM seed output is preserved as evidence but cannot become the primary reply by default.
- Added a model-output quality gate and `FORGELM_ALLOW_RAW_RESPONSES=1` opt-in for experimentation.
- Added regression tests for coherent greetings and suppression of control-token/gibberish output.

## v0.22.0 — Governed Web Corpus
- Added Web Research Agent behind the same OneChat input.
- Added explicit web source registry for Common Crawl, FineWeb, Wikimedia, Stack Exchange dump, direct URLs and public Git repositories.
- Direct URL ingestion records URL, retrieval time, digest, robots result, declared/verified license state and training eligibility.
- Private/local network targets are blocked by default.
- Unknown/unverified licenses are stored for research but are not automatically promoted into model training data.

## v0.23.0 — Bulk Web Corpus Import
- Streaming Common Crawl WET/WARC text importer.
- Streaming Wikimedia/MediaWiki XML(.bz2) importer.
- Streaming Stack Exchange Posts.xml importer.
- FineWeb-style JSONL and optional Parquet importer.
- Optional Hugging Face FineWeb streaming sampler using `datasets`.
- Every imported record carries source class, source ID/URL, digest, license policy and training-eligibility state.

## v0.24.0 — Web → ForgeLM Training Bridge
- ForgeLM dataset builder now consumes locally imported web records only when `trainingEligible=true`.
- Web license/source fields survive into dataset records and manifests.
- `FORGELM_MAX_WEB_RECORDS` bounds local memory use (default 5000) for Termux-scale runs.
- Tokenizer/training corpus is rebuilt from governed dataset-v2 rather than bypassing the dataset policy.
- Web Research Agent results participate in the same OneChat response composer.

## v0.25.0 — Capability Recovery
- Preserves the v0.24 OneChat response path as the protected working checkpoint.
- Replaces six core provider-chat capability slots with six governed public-source research capabilities for ForgeLM development. Provider API adapters remain available as optional compatibility integrations but are no longer counted as core intelligence capabilities.
- Adds official-Termux `python-torch` bootstrap support for ForgeLM train/infer/trainer activation.
- Adds optional LangGraph.js orchestration adapter and installer.
- Adds real configuration/probe adapters for Stripe subscription reads, Oxford Dictionaries API comparison and OctoPrint fabrication control.
- Adds capability probing via OneChat, API and CLI script.
- Keeps external credentials/hardware truth-gated: no adapter becomes CONNECTED merely because code exists.

## v0.26.0 — Language Data + SQLite Storage
- Added a high-volume SQLite storage database alongside the existing IUB record store.
- Added FTS5-backed definition and dialogue search with a fallback when FTS5 is unavailable.
- Added Princeton WordNet 3.0 definition downloader/importer with source/license provenance.
- Added OpenAssistant OASST1 conversation downloader/importer as the default free conversational/banter corpus.
- Added Lexicon Agent and Dialogue Agent behind the single OneChat input.
- Added OneChat commands for local definitions, banter/dialogue retrieval and storage status.
- Added training export of eligible WordNet definitions and OASST prompt/reply pairs into ForgeLM dataset-v2.
- DailyDialog is registered as research-only/not-default because its published CC BY-NC-SA 4.0 terms are more restrictive.

## v0.31.0 — Durable Task Ledger
- Added restart-safe task records with explicit state-transition history, step outputs and checkpoints.
- Added OneChat task planning/running/status/listing routes.

## v0.32.0 — Action Envelopes
- Added persistent action envelopes binding identity, intent, plan, capability scope, authority, security decision, execution, verification, recovery and audit lineage.
- Every TaskEngine run now receives an action-envelope ID.

## v0.33.0 — Recovery and Continuation
- Added explicit task resume and cancellation.
- Failed steps preserve their retry checkpoint; resume replaces the current result for that step only after real re-execution.
- Completed tasks cannot be cancelled retroactively.

## v0.34.0 — Availability Evidence + GitHub Privacy Boundary
- Added persisted availability snapshots with evidence classes separating connected runtime, configuration-only, registered-source and unavailable states.
- Added `/api/availability`, `/api/actions`, durable task APIs and OneChat `availability report`.
- Hardened public-repository ignore policy so local user/runtime data, checkpoints, generated training data and secrets do not enter GitHub.

## v0.35.0 — Persistent Policy + Approvals
- Added independent `ALLOW/DENY/ASK/ESCALATE/BLOCK` policy evaluation.
- Added persistent approval requests with expiry and explicit approve/deny decisions.
- Added OneChat and HTTP surfaces for policy/approval inspection and decisions.

## v0.36.0 — Scoped Autonomy Leases
- Added persistent, revocable autonomy leases with exact operation scope, risk ceiling, expiry and maximum-action budget.
- Autonomy leases do not grant credentials or bypass downstream policy/approval/security checks.
- Added OneChat and HTTP surfaces for lease grant/list/revoke/authorization checks.

## v0.37.0 — Transactional Governance Store
- Moved durable task/action/approval/autonomy records to SQLite WAL with optimistic compare-and-swap versions.
- Added legal task transition validation and event history.
- Uses native `node:sqlite` when available, with a Python SQLite fallback for older runtimes.

## v0.38.0 — Exact Approval Binding + Transfer Contracts
- Approval records now bind action envelope/task, operation, arguments, capability, actor and tool version to a SHA-256 digest.
- Added versioned transfer-envelope schema with integrity verification, idempotency field and byte limits.

## v0.39.0 — Plugin and Model Registry Boundaries
- Added validated plugin manifest schema, provenance hash and optional Ed25519 signature verification.
- Third-party plugin execution requires an explicit external sandbox and per-invocation policy/approval gate.
- Added model/runtime registry and truthful runtime detection for ForgeLM, llama.cpp/GGUF, Ollama, Transformers and ONNX Runtime.
- Added a local llama.cpp probe/chat adapter; remote model runtime endpoints are blocked by default.

## v0.40.0 — Quarantined Web Ingestion
- External content explicitly has no instruction authority.
- Added URL canonicalization, prompt-injection/PII/secret signals, global content deduplication and quarantine state.
- Separated retrieval eligibility from training eligibility.
- Bulk imports require explicit `--training-approved` in addition to source/license eligibility.

## v0.41.0 — Data Lifecycle + Hybrid Retrieval
- Added source retention, soft deletion and hard purge controls with retrieval/training exclusion.
- Upgraded local retrieval to hybrid FTS5 + sparse-vector ranking.
- Added recall@k/MRR evaluation utility.

## v0.42.0 — Learning Registry + Adversarial CI
- Added machine-readable learning-method registry covering causal pretraining, SFT, LoRA/QLoRA, DPO, RAG, continual replay, distillation, multimodal and federated status boundaries.
- Added adaptation prerequisite/planning CLI and deterministic continual-learning replay snapshots.
- Added security/adversarial tests for prompt injection, approval replay, transfer tampering, plugin validation and state-transition abuse.
- Expanded CI with Python compilation, contract/registry validation and public-repository privacy checks.


## v0.43.0 — Control-Plane Modernization
- Migrated AgentRegistry, accounts, subscriptions, legacy control plugins and availability evidence from direct JSON files to the transactional SQLite governance store.
- Added legacy JSON import/rename compatibility so existing local state is preserved.
- Added a tamper-evident SHA-256 audit chain; the first v0.43 record anchors the exact legacy audit prefix.
- Added `GET /api/audit/verify` and status-level audit integrity reporting.
- Added transactional plugin idempotency/replay protection with exact request hashing and key-collision denial.
- Added `Idempotency-Key` HTTP support for plugin execution.
- Generalized authoritative CI and release-manifest refresh from the retired v0.34 branch to all `build/*` branches.
- Added architecture/data-flow/plugin/model/security/operations documentation matching the target UAI blueprint.
- Added dedicated behavioral verification for migration, audit tamper detection, bounded agent capabilities and plugin exactly-once behavior.
## v0.44.0 — Governed Plugin Gateway
- Added operation-scoped plugin manifests with per-operation risk, schemas, capability requirements, secrets, idempotency and resource budgets.
- Added a single PluginGateway that performs input validation, destination allowlist checks, runtime-capability evidence checks, policy evaluation, exact approval validation and bounded autonomy before execution.
- Added a scoped plugin secret broker; only manifest-approved secret names can be requested and exact secret values are redacted from plugin output.
- Added SandboxRunner with minimal environment, temporary HOME/TMPDIR, timeout, cancellation and bounded output capture.
- HTTP plugin execution now forwards `Idempotency-Key` into transactional replay protection and accepts explicit operation names.
- Added dedicated adversarial/behavioral verification for schema rejection, allowlist denial, replay/collision behavior, approval mutation rejection, secret redaction, missing capability evidence, output-schema failure, output limits, timeout, cancellation and autonomy exhaustion.
- Hard OS-level filesystem/network/CPU/memory isolation remains external-sandbox dependent and is retained as PARTIAL rather than overstated.

## v0.45.0 — Provenance Document Data Plane
- Added a local SQLite/WAL document plane with canonical source identity, revision history, content hashes, immutable content-addressed text objects and deterministic chunks.
- Added explicit retrieval eligibility, source training eligibility and separate training approval.
- Added FTS5 document-chunk retrieval with source/document/chunk/revision provenance.
- Added citation-bearing OneChat document retrieval and document HTTP APIs.
- Governed direct-web ingestion now also persists into the provenance document plane and reports PARTIAL if that persistence step fails.
- Added soft deletion and hard purge behavior that removes searchable chunks and cleans unreferenced objects.
- Added direct storage and live HTTP/OneChat verification suites.
- Multimodal evidence locations, dense retrieval/reranking and the full cross-artifact provenance graph remain PARTIAL/future rather than being claimed complete.

## v0.48.2 — Main Repair and Runtime Truth Reconciliation
- Repaired cumulative self-development validation after the native OneChat greeting changed.
- Migrated legacy plugin/document/API HTTP tests to current email/password Owner enrollment, server-side sessions and CSRF-protected state changes.
- Added dedicated native-conversation tests for bounded chat continuity, llama.cpp preference, ForgeLM fallback and truthful no-runtime behavior.
- Added dedicated capability-truth tests for CONNECTED, CONFIGURED, REGISTERED_SOURCE, DEGRADED, UNAVAILABLE, BLOCKED and EXPIRED.
- Bound feature-evidence metadata to the package version and reject duplicate feature IDs.
- Replaced CI's obsolete bearer-token localhost smoke path with first-run Owner enrollment plus cookie/CSRF OneChat execution.
- Reconciled the v0.46-v0.48 runtime features into the feature-evidence ledger.
- First-run independent ownership proof remains PARTIAL; no stronger enrollment guarantee is claimed.

## v0.49.0 — Evidence-Native Model Routing
- Added a health-aware local model router with privacy/offline/task/modality/context constraints and recorded fallback attempts.
- Routed native conversation through the router while preserving ForgeLM/llama.cpp truth and fallback behavior.
- Added integrity-hashed evidence envelopes to OneChat answers.
- Added cited chunk excerpts to document-backed answer evidence.
- Added `explain answer` for structured evidence summaries without exposing chain-of-thought.
- Added stable browser chat IDs so live UI turns share conversation context.
- Added a truthful PARTIAL state for conversation rehydration after process restart.
- Added email/password owner bootstrap for local first run, explicit credential rotation for upgrades, active-session revocation, and explicit retirement tests for legacy bearer-owner tokens.



## v0.51.0 — Durable Conversation Rehydration
- Rehydrates recent persisted OneChat user/assistant turns for the same `chatId` after a process restart.
- Applies the existing context-token budget and 40-turn cap during restoration and keeps unrelated chat IDs isolated.
- Makes restored history available before follow-up intent classification and before local model routing/generation.
- Adds an auditable rehydration event and dedicated regression coverage in `verification/conversation-memory-v051.test.mjs`.


## v0.52.0 — Bounded Shadow R&D, Light Source Maintenance and Governance Protection
- Added bounded shadow-agent research/R&D infrastructure with explicit worker/resource budgets, persistent lifecycle state, quarantined candidates and disagreement-aware expansion signals.
- Added research, literature, model-evaluation, dataset-quality, retrieval, safety-red-team, architecture, experiment and synthesis profiles plus additional specialized research roles.
- Added bounded light-agent source-maintenance infrastructure with detached worktree creation, patch evidence, test/security/shadow review and rollback cleanup.
- Added explicit protected-governance rule declarations, emergency stop, local policy records, capability boundaries, audit-integrity facade and truthful trusted-device registry.
- Added owner-authenticated HTTP surfaces for shadow runs, light patches, promotion eligibility, emergency stop and trusted devices.
- Added a machine-readable platform roadmap catalog covering requested models, runtimes, learning approaches, retrieval/memory layers, plugins, connectors, tool abilities and evaluation metrics.
- Added `verification/shadow-light-v052.test.mjs` and authoritative CI integration.
- No shadow candidate self-deploys or directly enters training, no light agent can directly merge protected `main`, and incomplete multimodal/dense/federated/formal-verification/enterprise features remain explicitly non-complete.

