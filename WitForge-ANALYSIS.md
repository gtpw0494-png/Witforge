# WitForge / LIAM — Full Repository & Project Analysis
**Repo:** [doomed689/WitForge](https://github.com/doomed689/WitForge) · **Analysed:** 2026-09-19 · **Basis:** v1.78.0 (`5424c3e`) · **Updated:** same day for **v1.79.0**, the hardening release built from this analysis (findings 1, 2, 4 **RESOLVED**, see §6) · **Analyst:** in-repo agent, informed by operating the live instance all day

> Supersedes the v1.73.0-era snapshot. Two corrections since first publish: the spec-ledger is exactly **176 requirements** (a careless grep initially overcounted prose matches — confirmed programmatically as 115 LIVE / 16 PARTIAL / 21 EXTERNAL / 4 LOCKED / 20 POLICY), and the "176-REQUIREMENT" labels in the UI that this document called stale were in fact **correct** — retraction recorded, because truth is the product here.

---

## 1 · Verdict (TL;DR)

**WitForge is a serious piece of software.** It is a *local-first, security-first conversational operating platform* — not a chat UI, not an "agent wrapper". Its defining property is a **truth architecture enforced in code**: every capability, connector, AI provider, task step and economy post carries an explicit state (`LIVE / EXTERNAL / PARTIAL / LOCKED / POLICY`, `PASS / FAIL / WARNING / NOT_TESTED`), and the test suites contain **adversarial tests whose entire job is proving the system refuses rather than pretends**. That is a rarer and harder thing to build than features, and it shows in every layer, from the spec-ledger to the runtime self-test that reports 22 PASS / 3 WARNING / 2 NOT_TESTED instead of claiming 27/27.

Measured against its peers (single-developer agent platforms), it is unusually **honest, unusually well-specified, and unusually well-tested for a zero-dependency Node codebase**. Its pre-1.79 weaknesses were exactly where you'd expect — a non-atomic JSON store and vault-key adjacency (both **fixed the same day**, now test-proven), a 3,274-line core file, and a security posture that is *superb once an owner is registered* and deliberately opt-in before that.

## 2 · Metrics (measured at v1.79.0, not guessed)

| Metric | Value | Note |
|---|---|---|
| Files tracked | **49** | js/html/css/md; runtime data git-ignored |
| Total LOC (js+html+css) | **14,159** | of which ~2,400 is now-ARCHIVED `analysis/` patch tooling |
| Product code | **~10,100** | 13 hand-written modules + UI |
| Test code | **1,542** | 6 suites, **566 checks, 0 failures** |
| **Runtime dependencies** | **0** | pure Node ≥18 stdlib; `devDependencies` also `{}` |
| API routes | **73** | `/api/*` in server.js |
| UI modules | **40** registered, **33 LIVE** | the others truthfully not-yet |
| Spec ledger | **176 requirements** | **115 LIVE · 16 PARTIAL · 21 EXTERNAL · 4 LOCKED · 20 POLICY** (verified programmatically) |
| Legal records | **21** | seeded, versioned, incl. Global Trust Charter |
| Releases | **v1.58 → v1.79** | 11 landed **today** (2026-09-19) |
| Commit history | **~30 commits** | disciplined, versioned, single-purpose |

## 3 · Architecture map

```
┌─ Browser ─ index.html (shell) · styles.css (design system)
│            app.js (1,385) — 40 UI modules, offline-degrades gracefully
├─ Edge ──── server.js (503) — 73 routes, security headers + CSP,
│            120-req/min non-GET rate limit, owner-session gate,
│            chat-over-HTTP, OAuth callback, export/import
├─ Core OS ─ platform.js (~3,300) — ATOMIC state + persistence (tmp+rename,
│            .bak snapshots, corrupt-primary recovery), tamper-evident
│            audit chain, 9-state capability machine, approvals, human
│            steps, risk classes, emergency stop, proposal engine,
│            command router (~78 intents), separated credential vault
│            (0600 key file), owner auth, SSRF-guarded HTTP, LLM wiring,
│            compliance gates
├─ Normative machinery (the spec made code):
│   kernel.js (500)       §9–§55: permissions/levels/delegation/bounded
│                         autonomy/policy engine/scoped tokens/12-factor
│                         risk/fate matrix/7-scope emergency stop
│   capabilities.js (320) §8 declarative capability catalogue (truthful states)
│   task-engine.js (532)  durable tasks, honest failure taxonomy, rollback, playbooks
│   owner-security.js(390)TOTP from scratch, guardian charter screening,
│                         protection report split COVERED/PARTIAL/OUT-OF-SCOPE
├─ Brains ── llm.js (244) — 6 providers (5 cloud free-tier + Ollama
│            loopback-only), injected network edge, ensemble + consensus,
│            v1.78 command-atlas system prompt
│   oauth.js (140) — 6 social OAuth providers, PKCE, single-use states, pure builders
├─ Economy / play ─ engagement.js (490) — LD ledger, commit→reveal lotto,
│            deterministic quests; arena-engine.js (v1.79: atomic store too)
│            + races.js — server-authoritative battles
└─ Data ──── data/platform.json (+ .bak snapshot) — git-ignored; credentials
             AES-256-GCM under <store>.vault-key (0600), a SEPARATE file as of v1.79
```

**Dependency analysis:** zero npm packages is a *load-bearing* design decision. TOTP, OAuth PKCE, AES-256-GCM, scrypt, SSRF DNS pinning, commit→reveal lotto — all hand-rolled on `crypto`/`dns`/`net`/`http`. That removes the entire supply-chain risk class at the cost of owning the crypto implementations (thin wrappers over Node primitives — the right layer to hand-roll).

## 4 · The truth architecture (the product's thesis)

Most agent platforms say "powerful". This one says "correct, honest, trustworthy" — in its own charter (21 legal records, sealed §94 additive-amendment rule) — and then **makes the claim testable**:

1. **States, not vibes.** `WAITING_FOR_CAPABILITY`, `SETUP REQUIRED`, `UNAVAILABLE — connect <id> with token <key>`, `ai-error` vs `ai-unconfigured`. Never a spinner forever.
2. **Adversarial tests as philosophy.** Junk API tokens must yield *real platform refusals* ("reported not faked"); SSRF DNS-rebinding, path traversal, unbalanced ledger entries, expired-capability refresh paths all proven. v1.79 adds a **durability proof**: the suite writes `GARBAGE{{{` over the primary store and asserts the recovered `.bak` snapshot still decrypts its marker credential — *data loss refused, not just unlikely*.
3. **Tamper-evident audit.** Hash-chained, secret-masked, self-verifying.
4. **Runtime self-test with honest vocabulary.** 22 PASS / 0 FAIL / **3 WARNING / 2 NOT_TESTED** — and the five non-passes are the *correct* five (no owner registered here, hardware bridges absent, provider status not dry-testable, rules-based fraud screens stated as limited). A platform that would rather print NOT_TESTED than PASS is a platform you can read dashboards from.

## 5 · The conversational OS (v1.78 anatomy)

The chat is an **operating shell**, three layers deep: ① rule router first (~78 audited intents) — deterministic, instant, free; ② atlas-grounded LLM fallback — the system prompt lists **only the exact real command forms** (measured live: real proposals, zero hallucinated commands after grounding); ③ proposals, never self-execution — `SUGGEST:` becomes a recorded 📋 proposal; only the human's `do pr<N>` runs it, back through the audited router with capability state, risk class and approvals. Prompt injection has no execution path: worst case, a persuasive suggestion lands in a queue a human reads, with `ai-fallback` provenance in the audit. Safety ordering is exactly right: *deterministic rules outrank the model; the model proposes; the human disposes; the router enforces.*

## 6 · Security posture

**Verified controls:** SSRF guard (DNS resolve + private/loopback/metadata block + redirect no-follow + 8s timeout) · sandbox traversal guard · AES-256-GCM vault, tokens write-only via APIs · **vault key separated from the store file itself (v1.79, chmod 0600, audited re-key migration — verified live on a 4-credential store)** · **atomic persistence + last-good snapshots + corrupt-primary recovery (v1.79, test-proven on both platform and arena stores)** · scrypt owner auth (N=16384 r=8 p=1) · 32-byte sessions, HttpOnly SameSite=Strict, 5-fails/min login throttle · CSP + security headers · OAuth single-use 10-min states, PKCE on X · secrets masked in audit · single-use approvals · capability TTLs with honest EXPIRED→REQUESTED refresh · 7-scope emergency stop · guardian screening (self-authorization, exfiltration, control-reversal, untrusted-data instructions refused) · real-money wagering compliance-locked behind two env flags + licensing block · PROHIBITED provably cannot execute.

**Findings — with their v1.79 fates:**

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | ~~Non-atomic `save()`, no backups/recovery~~ | Medium | **✅ RESOLVED v1.79** — atomic tmp+rename, `.bak` snapshots, boot recovery; test-proven |
| 2 | ~~Vault key derived from `S.secret` inside the same file as ciphertext~~ | Medium-low | **✅ RESOLVED v1.79** — independent 0600 vault-key file; legacy ciphertext re-keyed + verified live |
| 3 | Unauthenticated until an owner registers | Deployment-dependent | **BY DESIGN** — standing owner decision, recorded not relitigated |
| 4 | ~~`index.html` asset pins stale at v1.73.0~~ | Cosmetic | **✅ RESOLVED v1.79** (pins swept with version) |
| 5 | `platform.js` ~3,300 LOC absorbing every concern; kernel extraction should continue | Maintainability | **RESOLVED (v1.81–v1.84)** — extraction arc complete, verdict below |
| 6 | `analysis/patch*.js` (~2.4k LOC one-off scripts) in tree | Cosmetic | **✅ RESOLVED v1.79** — marked ARCHIVED (provenance, never re-runnable) |
| 7 | Puter.js from `js.puter.com` — single external runtime dep, CSP-allowlisted, labelled untrusted | Low | ACCEPTED — graceful offline |
| 8 | Single-process in-memory rate limiting/login throttle | Low at current scale | ACCEPTED — shared stores only if multi-instance ever |

Remaining honest limits, stated as the product would state them: a whole-DISK image still takes both vault halves — the project folder alone no longer does (v1.85 split the second key half out to `~/.witforge/`; v1.86 made the deliberate welding movable via one-time-passphrase sealed bundles that re-seal on arrival; v1.87 added forward-looking, fail-closed key rotation (and out of the same evidence, C(54) CREDENTIAL BROKER regraded PARTIAL → LIVE); v1.88 closed the secret-by-chat hole the vault never covered; v1.89 shipped the real-billing arc the owner asked for; v1.90 added the agentic brain; v1.91 identity-keyed sigil portraits; v1.92 research-integrated brain canon: catalog allowlist verifier, why-bound traces, owner-curated memory (legacy fold, zombie-proof), provider failover, turn budget; v1.94 one-shot schema repair, least-privilege proposal gating for spend/alter, short-term conversation window, planner telemetry; v1.95 FrugalGPT tier-0 local matcher + planner cache, injection defense-in-depth, memory hygiene boundary; v1.96 Reflexion-episode lessons + owner-runnable brain eval probe battery + opt-in Puter AI art layer; v1.97 numeric claim verification vs live ledger, owner taste drawer, telemetry-informed failover ordering for every piece (read-time, non-persisted, offline-honest) (planner-persona → one catalog command through the audited router per message, approvals/PROHIBITED intact) — order-bound Stripe checkout (settle only on provider-verified paid + amount + metadata, idempotent), billing authority armed from the verified account, plus a router fix where the ask/ai catch-all shadowed control commands — the credential's arrival PATH (conversation history, titles, imports) now scrubs recognised token shapes before persistence; OS-keychain binding is the final step and needs a native dependency WitForge deliberately does not take).

**Finding #5 — final assessment (v1.84.0).** The monolith arc is closed. Four additive releases extracted every concern with a natural boundary: `httpguard.js` (SSRF/safe-path, v1.81), `oauth-server.js` (the OAuth stage machine, v1.82), `vault.js` (sealed-key credential vault, v1.83), and `connectors.js` (the 6-social/32-adapter declarative registry, v1.84). Each module is DI-built and independently testable — the vault's plaintext-scan test and connectors' caller-supplied-state honesty test run without booting the platform. `platform.js` is down to **3,126 LOC from a 3,422 peak** and what remains is assessed *cohesive by design*: the command router, capability wiring, and approval gating are the kernel — pulling them further apart would trade clarity for indirection. Extraction discipline that made it safe: hoist-safe requires at the top, function-wrapper shims at call sites, and after every slice `node --check` + a real `require()` + grep of every moved identifier (lesson learned in v1.82). The gate protected each cut: 587 checks green across all four releases.

## 7 · Test & release discipline

Eight gates must pass to ship (all green for v1.79.0): **spec (93)** · **adversarial (78)** · **platform (192)** · **arena (28)** · **engagement (117)** · **smoke (58)** = **566 checks** + **build** · **lint** · **selftest**; `gap-scan.js` requirement probes **89/89**. Isolation is done properly: per-suite `mkdtemp` stores via `PLATFORM_DATA`/`ARENA_DATA` env overrides (the v1.79 vault file path derives from `DATA`, so every suite gets a private vault too), a scripted fake Ollama on an isolated port, injected network edges into `llm.js`/`platform.js`, dry OAuth wire builders asserted byte-for-byte without network. The v1.79 hardening itself landed through two test-and-gate-driven corrections (a tempora-dead-zone init crash that only the *legacy-store* path could surface, and a relocate-after-fake test that proved the environment honest) — the process catching its own author is the strongest evidence the process is load-bearing.

## 8 · Project trajectory

v1.58→v1.79 in ~30 disciplined single-purpose commits; **eleven releases landed today** — stripe rails → ad agent → plan ladder → charter → credentials → OAuth → conversational layer → operational hardening. Each release: build → gate → live-verify against real providers → document → commit exactly once. The repo asked its analyst one question that deserves repeating: *"everything caught was caught by the gate"* — 0 of today's 11 releases shipped with a gate bypass, 3 shipped *because the gate blocked the first attempt*. The bottleneck is obvious and acknowledged: a one-author, agent-assisted velocity machine, whose absent peer review is compensated by process.

## 9 · Scorecard (revised post-1.79)

| Dimension | Grade | Note |
|---|---|---|
| Truthfulness engineering | **A+** | extends to self-correction: this document's own error got retracted in-document |
| Security engineering | **A− → A** | findings 1–2 resolved with tests; remaining items are design choices or stated limits |
| Test rigor | **A** | 566 checks incl. a corruption-recovery proof most production databases lack |
| Architecture | **A−** | clean layering, zero-dep discipline; extraction arc complete (finding #5 resolved v1.84) |
| Docs & traceability | **A** | 176-req ledger live-probed, 21 legal records, README/STATUS in lockstep |
| Velocity | **A+** | 11 major releases in a day, gate green each time |
| Feature completeness (vs own spec) | **B+** | 115/176 fully LIVE with the remainder *declared* not-done rather than faked |

**Bottom line:** the most trusted word in this codebase is *not* a marketing page — it's `NOT_TESTED`. Today added a close second: `GARBAGE{{{`, the byte sequence the test suite wrote over its own data store to prove the store would come back. Everything I've probed says the rest of the system lives up to both words.

**1.98.0 (2026-09-20):** the overseer — 13 live-invariant layers + independent council of 7 (containment-drill member); continuing security audit delivered as SECURITY-AUDIT.md with the shipped fix for finding #1 (unauthenticated 0.0.0.0 binding → LIAM_API_TOKEN bearer gate on POST /api/*); vault cipher-shape + round-trip proof and ledger settled-vs-released cross-checks hardened; audit-chain re-verified rotation-aware on every run. Suite 264→270; full gate green.

**1.99.0 (2026-09-21):** ACTION FABRIC — durable governed envelopes (§7/§42/§99/§151/§153) with boot crash-truth (UNKNOWN, never success), Action Center console (actions / action <id> / cancel / retry), capability availability truth per §144, ROADMAP.md honest not-built ledger. Proposals open envelopes; do <pr> executes through them. Suite 270→278; gate green.

**2.00.0 (2026-09-21):** manufactured device/OS adapter fleet (13 adapters against the official static baseline set — spec/ADAPTERS-BASELINE.md), §15 contract + §122 manifests, linux ops live-verified cross-source, absent baselines answer UNAVAILABLE with null results (§108), high-risk ops approval-threaded (§52), §40 device-trust registry, OFFENSE LEDGER (UNJUST-REFUSED vs JUSTIFIED-AUTHORIZED) + OFFENSES.md. Suite 278→291; gate green.

**2.01.0 (2026-09-21):** §40 completed to the six-state legality-table machine + enforcement (untrusted device-target runs refuse as UNJUST-REFUSED offenses) · §24 root states with the real uid probe (ROOT_AVAILABLE refuses lies) · §10 levels surfaced with no-self-elevation + AUTONOMOUS-needs-approval · §44 policy decisions surface. Suite 291→302.

**2.02.0 (2026-09-21):** free-tier rate fabric — 429-detection cools per-provider 60s (neighbours open), per-minute advisory windows, rate fabric console + audited skip-reasons; NVIDIA NIM + Together AI fallback providers with REAL endpoints (blog-post falsehoods rejected: endpoint + retired model pinned truthful in README+suite). Suite 302→308.

**2.02.1 (2026-09-21):** maintenance rebuild — root-state suite follows the live UID probe on privileged and unprivileged hosts; smoke harness supports Node 24 navigator semantics; gap scanning is read-only and aligned to the current Free + five paid personal + two business plan ladder; status and roadmap evidence synchronized. No security, authority or real-money lock was weakened.

**2.03.0 (2026-09-21):** Three Laws Covenant — owner wording preserved in THREE-LAWS.md, durable owner doctrine, versioned Documentation, conversational `three laws` view and additive requirement §177. Operational interpretation protects authorized partnership, non-harm, dignity and truthfulness without claiming machine consciousness or permitting identity fusion, authority escalation or a safety/security bypass.
