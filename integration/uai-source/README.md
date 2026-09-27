# IntraultUniversalion v0.73.0

UAI is an **independent AI operating environment**: a local-first, evidence-governed platform for conversation, research, retrieval, models, tools, plugins, durable tasks and owner-authorized action. It is not defined as a claim of universal superiority over other assistants; comparisons must be task-specific and evidence-backed.

## v0.73 Termux runtime and OneChat recovery

Termux/Android is now treated as a first-class execution environment. Child Node syntax validation removes the Termux execution preload when required, HTTP verification launches use absolute server paths, and the browser syntax test runs through a dedicated compatibility wrapper.

OneChat also has stronger local fallbacks. Natural capability questions return live capability truth, web-search capability questions perform an actual reachability probe and surface DNS/provider failures, and natural domain ingestion no longer requires hidden command grammar such as `ingest url https://...`.

## v0.72 first-install ForgeLM bootstrap

A fresh UAI installation no longer needs an existing promoted ForgeLM checkpoint before it can promote its first local model. The bootstrap path trains a candidate, runs a separate first-checkpoint evaluation, binds promotion to the evaluated candidate hash, and requires explicit approval before writing `model/checkpoints/forgelm-seed.pt`.

Run `npm run model:bootstrap -- --approve --steps 80` from the repository root on Termux. This makes the local runtime available; the tiny bootstrap checkpoint is a functional starting model, not a claim of frontier conversational quality.

## v0.71 durable OneChat session recovery

Live OneChat generations now persist an atomic session snapshot plus append-only local event journal. After a Termux or server restart, UAI reconciles the stored state instead of leaving stale turns marked RUNNING. A session that had not begun execution yet may safely continue from QUEUED. A session that was already RUNNING or awaiting cancellation is marked INTERRUPTED and is never reported as completed.

Interrupted work is not automatically replayed because doing so could repeat a side effect. The authenticated owner can explicitly resume it, which creates a new linked live session from the saved request. Browser session storage also remembers the active session ID and reconnects to surviving sessions after a page reload.

## v0.70 true ForgeLM token streaming

ForgeLM now emits text updates from the actual local sampling loop while inference is running. Plain-text and unified multimodal generation serialize cumulative decoded output as token events; the local subprocess bridge parses those events, the ModelRouter preserves them, OneChat journals them, and the browser progressively updates the active answer over its existing SSE session.

This is distinct from v0.69 execution-event streaming. v0.70's ForgeLM token stream originates inside token sampling itself. Stop generation uses the same AbortSignal and terminates the local process producing those tokens. Other model runtimes are not labeled token-streaming unless they independently emit equivalent runtime events.

## v0.69 live OneChat turn sessions

OneChat can now execute a turn through an owner-bound session with replayable server-sent events. Intent, governed attachment preparation, collaborator allocation, tool states, model phases, verification and persistence appear in the active message while work is occurring. The browser can reconnect using its last observed event sequence.

Stop generation requests cancellation through the session's AbortController. Local ForgeLM subprocesses are terminated; other collaborators are checked at safe phase boundaries and any result that arrives after cancellation is discarded instead of being persisted as a completed answer.

This release truthfully provides execution-event streaming. Token-level model streaming remains a separate capability and is only reported when a connected runtime actually emits token chunks.

## v0.68 OneChat turn controls

Each persisted OneChat turn now exposes append-only controls for Edit, Retry, Regenerate and Branch. These actions preserve the original timeline by creating a new local conversation branch rather than mutating historical turns. Copy and single-turn JSON export are available, while Evidence opens only the sanitized structured evidence envelope: claims, support references, tool states and model metadata—not private chain-of-thought.

First-turn text now seeds a concise local conversation title automatically. Attachment support references use governed media IDs rather than filesystem paths.

## v0.67 OneChat conversation management

The existing OneChat page now includes an in-place conversation drawer for local conversation search, switching, new-chat creation, rename, archive/unarchive, sanitized JSON export and explicit deletion. Conversation summaries include turn, attachment and evidence counts. History and export operations are owner-bound, while deletion removes chat/control records without silently deleting registered media evidence.

## v0.66 persistent attachment-aware history

OneChat now restores prior local turns with sanitized attachment cards. Browser-visible records carry registered media IDs, labels, hashes, modality and size—not server filesystem paths. Reopening an attachment goes through an authenticated media-ID endpoint that revalidates ownership, the approved local storage boundary and file existence before streaming the registered artifact.

Images can render as restored thumbnails, audio/video can reopen through native browser controls, and other registered document types use governed open links. Conversation continuity and attachment provenance therefore survive reloads while raw local storage paths remain server-side.

## v0.65 single-chat attachment UI

OneChat's existing composer now handles local attachments directly. Browser-selected files are uploaded in bounded chunks into UAI-controlled storage, content-hashed, registered with provenance, previewed with progress/status chips, and then submitted through the same OneChat conversation contract. Attachment-only turns are supported, and the design keeps the user-facing product to one chat surface.

## v0.64 OneChat multimodal attachments

The single OneChat surface can now carry governed local attachments into ForgeMultimodal while preserving conversation history. Image, audio and video artifacts remain model-gated by their promoted native checkpoints; text-like and PDF attachments are locally extracted when a verified parser is available. Attachment content hashes and provenance are stored with the chat turn and evidence envelope.

## v0.63 unified ForgeMultimodal fusion

ForgeMultimodal brings UAI's native modalities into one ForgeLM context. Healthy promoted ForgeVision, ForgeAudio and ForgeVideo encoders can contribute tokens alongside local document/context embeddings and the live text prompt. A deterministic token budget then assembles a single bounded prefill for ForgeLM.

The production fusion path is intentionally parameter-free, so it does not require a new untrained fusion checkpoint to function. A separate trainable ForgeFusion transformer is present for future cross-modal training, but its existence is not treated as evidence of improved semantic fusion.

If a request supplies a modality whose promoted checkpoint is unavailable or incompatible, the request fails explicitly. It never silently routes to GPT, Gemini, Claude, Grok, or another external model.

## v0.62 native ForgeVideo

ForgeVideo extends the independent multimodal stack from still images to temporal visual sequences. Frames are extracted locally, encoded through ForgeVision, modeled across time by a native temporal transformer, projected into ForgeLM hidden space, and jointly processed with text prompts through ForgeLM.

Training and evaluation use local video-text data. Promotion is evaluation-gated, hash-bound, explicitly owner-approved, and rollback-capable. Runtime capability truth remains separate from checkpoint presence: native video understanding is CONNECTED only when promoted ForgeVideo and ForgeLM checkpoints actually load and are dimension-compatible.

## v0.61 native ForgeSpeech

ForgeSpeech adds an independent local text-to-waveform generation path. ForgeLM creates the text conditioning vector, ForgeSpeech decodes it into PCM waveform samples, and the runtime writes a local WAV file without calling a cloud or external TTS model.

Training uses local text/WAV pairs with waveform and spectral reconstruction losses. Promotion remains candidate-first, evaluation-gated, hash-bound, explicitly owner-approved, and rollback-capable. A source file or candidate checkpoint alone is never reported as a connected speech generator.

## v0.60 native ForgeAudio

ForgeAudio adds independent local audio intelligence to the ForgeLM stack. PCM WAV is decoded locally, transformed into log-spectral features, encoded into audio tokens, projected into ForgeLM hidden space, and jointly prefilled with text tokens through ForgeLM's transformer.

Training and evaluation use local audio-text pairs and ForgeLM's own embedding space. Promotion is candidate-first, hash-bound, owner-approved and rollback-capable. Semantic audio inference is CONNECTED only after both ForgeAudio and ForgeLM promoted checkpoints pass local runtime health.

## v0.59 governed native vision runtime

ForgeVision now follows the same evidence-first lifecycle as ForgeLM: train a candidate, evaluate it against local image-caption evidence, bind the result to the candidate hash, obtain explicit owner approval, promote atomically, and retain rollback evidence.

A promoted ForgeVision checkpoint can feed projected visual tokens directly into ForgeLM's native transformer prefill. Runtime capability truth remains separate from checkpoint presence: semantic vision is CONNECTED only when both promoted ForgeLM and ForgeVision checkpoints load successfully and their dimensions match.

The HTTP inference surface is restricted to approved local image roots. External model adapters are not used by this path.

## v0.58 native ForgeVision

ForgeVision is the first native multimodal front-end for the independent ForgeLM stack. It converts RGB images into local visual tokens and projects those tokens into ForgeLM's hidden-state dimension.

The training path is self-contained: image-caption pairs are decoded locally, ForgeLM supplies the text embedding target, and ForgeVision learns the alignment directly. No GPT, Claude, Gemini, Grok, or other external AI model is required.

Capability truth remains strict: source code and a trainable architecture do not equal useful semantic vision. Until a trained and evaluated ForgeVision checkpoint is explicitly promoted, semantic image inference remains unavailable.

## v0.57 independent ForgeLM context

Core intelligence remains local-first. The ordinary model router now contains only local runtimes unless external-model compatibility is explicitly enabled.

ForgeLM v0.57 adds two independent context mechanisms:
- **RoPE-scaled attention** for checkpoints trained/configured with larger active windows.
- **Native dense context memory** for source material larger than the active window. ForgeLM tokenizes the source, embeds chunks with its own hidden states, ranks them locally and injects only the relevant evidence into the bounded generation context.

These are intentionally reported separately: retrieval from a 100K-token source is not represented as 100K-token full-attention inference. External GPT/Claude/Gemini/Grok adapters remain optional interoperability/research components and are not required for core ForgeLM chat, reasoning, coding, structured output, embeddings, reranking or long-context retrieval.

## v0.56 frontier model fabric

- OneChat now has explicit model-routing controls while preserving local/offline execution as the default.
- The model router can select truthful CONFIGURED cloud candidates and records CONNECTED only after successful runtime evidence.
- Provider adapters now cover text/code/reasoning, provider-native vision, image generation, tool/structured-output contracts, embeddings and reranking where the selected provider advertises them.
- Puter server-side access uses `PUTER_AUTH_TOKEN` with its documented OpenAI-compatible endpoint, enabling the same governed fabric to address supported GPT, Claude, Gemini, Grok, Cohere, MiniMax and open-ecosystem model IDs.
- ForgeLM itself now exposes normalized neural embeddings and local cosine reranking from the promoted checkpoint.
- Registry entries remain metadata only. Proprietary model weights/internal source are not copied, and local ForgeLM is not represented as frontier-equivalent without matching trained weights and benchmark evidence.
- Local ForgeLM vision/image/audio/video generation, million-token context, production-scale distributed training and frontier-scale evaluation remain explicit gaps.


## v0.54 user-owned intelligence plane

- Added explicit-consent memory namespaces for session, task, user, project, agent, source, model-training and audit memory.
- Durable memory records retain owner, source, confidence, consent, retention, expiry, deletion state, visibility and training permission; training is disabled by default and conversations are not silently promoted into training.
- Optional local AES-256-GCM memory encryption is available through `IUV_MEMORY_KEY`; when no key is configured the API truthfully reports `PLAINTEXT_LOCAL`.
- Added a typed provenance graph with source/derived nodes, lineage edges, trace queries and dry-run purge planning. v0.54 can propagate purge into linked memory records; deletion across every legacy document/index/model store remains explicitly partial.
- Added non-executing policy simulation that reports tools/steps, data touched, external destinations, approvals, violations and a safer-plan summary before execution.
- Policy decisions now include version, actor/resource context, arguments hash, data classification, destination, risk factors and a local integrity proof. Optional Ed25519 signing is supported when a local policy signing key is configured.
- Added model artifact SHA-256 verification, optional Ed25519 signature verification and artifact records that remain separate from runtime availability/production eligibility.
- Added evidence-backed evaluation records, verified-only leaderboards, benchmark-runner foundations and promotion evidence scoring.
- OneChat gained explicit memory/provenance/policy-simulation commands, while the operations dashboard now exposes memory, provenance, evaluations, artifacts and simulations.

## v0.53 persistent agent control plane

- Added dedicated SQLite control-plane tables for shadow runs/candidates, light patches/worktrees, and persistent agent jobs, with migration of existing v0.52 generic governance records.
- Added a bounded lease-based worker scheduler with queue ceilings, concurrency ceilings, job priority, expiry, crash/lease recovery, and explicit dispatch rather than unbounded process generation.
- Shadow and light submissions now create durable scheduled jobs. Manual/API execution settles those jobs, and explicit worker dispatch can execute one queued unit under the same lifecycle.
- Added authenticated control-plane status, jobs, dispatch, maintenance, and operations-dashboard APIs. State-changing scheduling remains session/CSRF governed and is blocked by the emergency stop.
- Added a single-chat operations dashboard for tasks, capabilities, models, plugins, approvals, shadow runs, light patches, scheduler jobs, feature evidence, and audit integrity.
- Added Termux control-plane commands and v0.53 unit/HTTP regression suites.
- Expanded governed public-web research with multi-query discovery and an optional Brave Search API adapter; exhaustive internet coverage is not claimed.
- Promotion authority remains separate: scheduler completion cannot deploy a shadow candidate, merge a light patch to protected `main`, or promote training data.

## v0.52 bounded research + source-improvement control plane

- Added bounded virtual shadow-agent R&D with explicit resource budgets, persistent run states, quarantined candidates, disagreement detection and independent promotion gates.
- Added bounded light-agent source maintenance with detached Git worktrees, patch evidence records, test/security/shadow-review gates and rollback cleanup.
- Light agents do not receive direct protected-`main` merge authority. Shadow agents cannot deploy themselves or move candidates directly into training.
- Expanded the local governance kernel with protected-rule declarations, emergency stop, policy storage, capability-boundary primitives, audit verification and truthful trusted-device registration.
- Added a machine-readable platform roadmap for model/runtime, learning, retrieval, memory, plugin, connector, tool and benchmark categories. Registration never implies runtime availability.
- Full multimodal ingestion, dense embeddings/reranking, formal governance verification, OS/kernel plugin isolation, federated learning, large-scale training, encrypted multi-device sync, full IDE integration and independent hardware-backed ownership proof remain explicitly incomplete.

## v0.51 durable conversation rehydration

- Persisted OneChat `chat-turn` records are now rehydrated into the native conversation engine after a process restart when the same `chatId` is reused.
- Rehydration is local-only, chat-scoped and bounded by the existing context-token and 40-turn limits; unrelated chats are not mixed.
- Follow-up intent detection sees the restored history before routing, so `continue`, pronoun/reference follow-ups and model prompts regain prior context after restart.
- Rehydration emits auditable success/PARTIAL metadata and does not fabricate memory when no persisted turn exists.
- Governed multi-source research and evidence-native routing from v0.50 remain additive and unchanged.

## v0.49 evidence-native model routing

### Owner email/password bootstrap and rotation

- Legacy bearer-owner authentication is retired; protected API routes authenticate through the local owner session.
- First-run credentials can be provisioned from local environment variables without committing plaintext credentials.
- Existing installations can explicitly rotate the owner email/password from the local shell; active sessions are revoked after rotation.
- The browser uses normal email/password login, server-side session cookies and CSRF for state-changing requests.
- Plaintext owner passwords are not stored in Git, browser storage or API responses.


- Native conversation now routes through a health-aware local model router rather than hard-coding a single runtime path.
- The router filters by privacy, offline mode, task, modality and context constraints, ranks connected candidates and records fallback attempts.
- Unusable model output can trigger fallback to the next eligible runtime instead of blocking the turn.
- Every OneChat reply now carries an integrity-hashed evidence envelope with claim support state, model route, tool summary and source/chunk citations when available.
- `explain answer` returns structured evidence for the previous answer in the same chat without exposing private chain-of-thought.
- The browser now keeps a stable per-tab `chatId`, making live conversational continuity real instead of generating a new chat ID for each message.
- Full conversation-context rehydration after process restart remains PARTIAL.

## v0.48.2 repaired conversation/security checkpoint

- First-run local Owner enrollment uses email/password credentials, scrypt-derived password hashes, server-side sessions, HttpOnly session cookies and CSRF validation for cookie-authenticated state changes.
- The HTTP authorization layer applies route schemas, local identity, per-route rate limits, policy decisions, exact approval binding, request/correlation IDs and audited actor identity.
- Native OneChat conversation routing keeps bounded per-chat context, prefers a connected local llama.cpp runtime and falls back to a verified ForgeLM runtime.
- Capability truth now has explicit CONNECTED, CONFIGURED, REGISTERED_SOURCE, DEGRADED, UNAVAILABLE, BLOCKED and EXPIRED states.
- Regression tests now verify behavior rather than obsolete literal greeting text, and all live HTTP system tests authenticate through the current Owner session flow.
- First-run enrollment is localhost-oriented and closes after successful enrollment, but independent trusted-device/bootstrap ownership proof remains PARTIAL and is not overstated.

## v0.45 provenance document data plane

- Content-addressed local document objects with canonical URIs, document revisions and deterministic chunks.
- Explicit retrieval eligibility, source training eligibility and separate training approval.
- FTS5 document retrieval with source/document/chunk/revision provenance.
- Citation-bearing OneChat evidence responses for document search.
- Governed web ingestion now also persists into the document plane and reports PARTIAL if provenance persistence fails.
- Soft deletion and hard purge remove searchable chunks and clean unreferenced content objects.
- Multimodal location metadata, dense reranking and the full cross-artifact provenance graph remain PARTIAL/future.

## v0.44 governed plugin gateway

- Operation-scoped plugin manifests with input/output schemas, risk, capabilities, secrets, idempotency and resource budgets.
- HTTP plugin execution now flows through a single governed gateway.
- Exact policy/approval binding is evaluated per operation.
- Optional autonomy leases are consumed only for policy-allowed operations and are not consumed by idempotent replays.
- Plugin inputs are checked against declared network-destination allowlists.
- Only explicitly declared secrets are injected; returned secret values are redacted from results/log output.
- Sandbox execution uses a minimal environment, isolated temporary HOME/TMPDIR, timeout/cancellation and output-byte limits.
- Runtime capability requirements must have CONNECTED + executable evidence.
- OS/kernel-level filesystem, network, CPU and memory isolation remains dependent on the configured external sandbox and is not falsely claimed as host-enforced.

## v0.43 control-plane modernization

- Agent, account, subscription, control-plugin and availability registries now persist through transactional SQLite governance storage with legacy JSON migration.
- Audit records now use a tamper-evident SHA-256 chain that anchors pre-v0.43 legacy audit bytes without rewriting them.
- Plugin execution now supports transactional idempotency/replay protection.
- CI and release-manifest automation now apply generically to future `build/*` branches.
- Added architecture, data-flow, plugin SDK, model-support, security and operations contracts aligned with the UAI blueprint.
- SQLite WAL governance persistence with optimistic concurrency and legal task-state transitions.
- Exact-operation approval binding over action, arguments, capability, actor and tool version.
- Versioned Node/Python/tool transfer envelopes with integrity hashes and size limits.
- Signed plugin-manifest contract and external-sandbox execution boundary.
- Model/runtime registry for ForgeLM, GGUF/llama.cpp, Ollama, Transformers and ONNX without confusing registry presence with runtime availability.
- Web-content quarantine, prompt-injection/PII/secret signals, canonical URLs, global dedupe and explicit training promotion.
- Retrieval/training separation: web records require both eligibility and explicit training approval.
- Data retention, soft deletion and hard source purge hooks.
- Hybrid SQLite FTS5 + sparse semantic retrieval and retrieval-evaluation tooling.
- Runtime-conditional LoRA/QLoRA/DPO registry plus replay/regression foundations for continual learning.
- Expanded adversarial CI and public-repository privacy checks.

Existing OneChat, ForgeLM, WordNet/OASST storage, capability truth, source research, self-development, rollback, approvals and bounded autonomy remain additive.

Run `npm test`, `npm run test:security`, `npm run test:control-plane`, `npm run test:plugin-gateway`, `npm run test:plugin-http`, `npm run test:document-data`, `npm run test:document-http`, `npm run test:api-security`, and `npm run test:conversation-capability`, then `npm start`.

See `docs/ARCHITECTURE.md`, `docs/DATA-FLOW.md`, `docs/SECURITY.md`, `docs/PLUGIN-SDK.md`, `docs/MODEL-SUPPORT.md`, and `docs/OPERATIONS.md`.
