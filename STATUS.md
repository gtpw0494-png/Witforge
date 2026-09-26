# LIAM Status

## Current release v2.03.0

- **Package:** WitForge / LIAM Control Centre v2.03.0.
- **Specification registry:** 177 requirements: 116 LIVE, 15 PARTIAL,
  21 EXTERNAL, 4 LOCKED and 21 POLICY.
- **Requirement probes:** `node analysis/gap-scan.js` reports 91/91 present.
- **Release suites:** specification 93, adversarial 78, platform 311, Arena 33,
  engagement 117 and smoke 58: 690 checks total, 0 failures.
- **Gate:** `npm run build`, `npm run lint`, `npm test` and
  `npm run selftest` are the governing release commands.
- **Maintenance rebuild:** root-state tests are portable across root and
  non-root hosts; the smoke harness supports Node 24's getter-only navigator;
  gap scanning no longer mutates Arena state and matches the current 5 paid
  personal + 2 business + Free plan structure.
- **Three Laws Covenant:** owner wording preserved in `THREE-LAWS.md`, durable
  owner doctrine, Documentation and requirement §177. Operational boundaries
  preserve non-harm, consent, security, truthfulness and human dignity.
- **Economy:** simulation-only by default. Real-money operations remain
  compliance-locked and require independent legal and regulatory readiness.

The entries below are retained as historical release detail. Where a historical
count or state conflicts with this current-release block, this block controls.

- **App:** LIAM Control Centre **v1.83.0** — local-first, truth-stated (vault.js extraction: secrets broker + key chain injected-module, round-trip proven standalone; +httpguard/oauth-server/js; OAuth stage machine; v1.79.x durability + restore-proofing)
- **v1.80 surface:** /api/oauth returns `stage` (+`authorised`,`connected`,`verifiedTs`) computed server-side — UI and tests read the same truth; AUTHORISED · NOT CONNECTED replaces "unverified" on every OAuth surface (card pill, connector pill, callback landing); Authorise is the primary labelled action at the grant stage; proof only ever comes from a real round trip with recorded evidence
- **v1.79 surface:** persistence hardened — atomic tmp+rename saves, last-good .bak snapshots, corrupt-primary recovery (proved by test: GARBAGE primary boots from snapshot); credential vault key separated into `data/platform.json.vault-key` (chmod 0600; platform.json alone decrypts nothing; audited one-shot re-key of legacy ciphertext — live store migrated, all 4 credentials verified); asset pins + prose slips truth-swept; `analysis/` marked ARCHIVED
- **v1.79.1+.2 surface:** audit retention (600, by design) now stays verifiable through rotation via chain anchors (605-probe + tamper test); `recovery.js` / `npm run recover` — read-only store grader (primary/.bak/effective · anchor-aware chain · vault perms as octal data + per-credential DECRYPTS|FAIL, never a secret); not-created stores say NOT CREATED YET, not ACTION REQUIRED; arena durability now test-proven
- **v1.78 surface:** chat → rule router first, then the connected AI brain — system-prompt **command atlas** keeps every SUGGEST to a REAL audited command; a SUGGEST becomes a 📋 proposal run with "do pr<N>" (permissions/approvals still apply, never self-executes); failing providers (rate limits, outages) report `ai-error` with the true cause, only genuinely keyless installs say "no provider" with free connect paths; bare "summarize <url>" reaches the brain. Verified live: NL queries answered + REAL commands proposed; gemini 429 bursts reported truthfully
- **v1.77 surface:** Official sign-in (Credentials → SOCIAL) — register your developer app (per-platform portal guide + exact callback URL), press Sign in, authenticate on the platform's own page; password never touches WitForge; code→token exchange server-side, PKCE on X, single-use 10-minute states, app secrets AES-256-GCM at rest; SETUP REQUIRED until each app exists — never faked
- **v1.76 surface:** Credentials workspace (CONTROL) — Connect/Verify/Revoke for groq · gemini · openrouter · deepseek · mistral · github · stripe · x · facebook · reddit · instagram · linkedin · tiktok, each card with its official developer-portal steps + link; tokens write-only (AES-256-GCM, never returned by APIs); X truthfully marked pay-per-use (no free tier in 2026)
- **Connector states:** github VERIFIED (doomed689) · stripe VERIFIED (AU acct) when keys are present; weather/FX/wiki/DNS/HN/countries AVAILABLE key-free; proton NO PUBLIC API (truthful); social: x/facebook/reddit postable + instagram/linkedin/tiktok verify-only (official APIs, your developer credentials via the Credentials page, approval-gated posting); AI providers FREE KEY / LOCAL until connected
- **v1.75 surface:** the Charter (`LEGAL-GLOBAL-TRUST-CHARTER.md`, legal id `charter`) — decentralized, worldwide, bound by no single jurisdiction; self-bound by the Prime Covenant to be correct, honest, trustworthy; user rights, enforcement instruments, additive amendment (§94)
- **v1.74 surface:** Plans — Free (A$0) baseline + 5 paid personal tiers from A$9/mo (plus · pro · elite · ultra · apex A$299) and 2 business tiers from A$30/mo (business · business-plus A$99); enterprise retired; prices stay reference labels, billing compliance-locked
- **Local:** `npm run dev` (or `node server.js`) → http://localhost:8787 (`PORT` overrides)
- **Hosted preview:** https://doomed689.github.io/WitForge/ (static; offline banner when no backend)
- **AI brain:** six LLM providers — groq · gemini · openrouter · deepseek · mistral (free-tier keys via `connect <id> with token <key>`) and ollama (local, no key); `ask <anything>` answers labelled `provider · model`; `ask all` ensembles every connected provider at once; `ask consensus` synthesizes one balanced verdict; unmatched chat falls back to the brain; missing keys are truth-stated with the free-key path; Ollama is loopback-11434-only; uninstalled local models fall back to an installed one, named
- **Connector states:** github VERIFIED (doomed689); weather/FX/wiki/DNS/HN/countries AVAILABLE key-free; stripe UNAVAILABLE until key; proton NO PUBLIC API (truthful); social: x/facebook/reddit postable + instagram/linkedin/tiktok verify-only (official APIs, your developer credentials, approval-gated posting); AI providers FREE KEY / LOCAL until connected
- **Specification coverage:** 176 requirements registered (168 master sections + 8 platform) — **115 LIVE · 16 PARTIAL · 21 EXTERNAL · 4 LOCKED · 20 POLICY**, evidence pointers in the `Spec` workspace (`/api/spec/compliance`)
- **Requirement probes:** `node analysis/gap-scan.js` → **89/89 present**
- **Tests:** spec 93 · adversarial 78 · platform 166 · arena 28 · engagement 117 · smoke 57 — **539 checks, 0 failures**
- **Release gate:** `npm run build` · `npm run lint` · `npm test` · `npm run selftest` — all green on Node v20.20.2
- **v1.73 surface:** advertising agent — `ad campaign "<name>" on <platforms>: <brief>` (AI drafts variants) · `ad schedule <id>` (rate-capped queue) · `ad dispatch <id>` (ONE campaign approval, ≤1 post/platform/dispatch, owner-connected channels only; unsolicited bulk is out of scope by design — Spam Act 2003 / platform terms / AUP)
- **v1.72 surface:** `briefing` (one-glance status with ids) · `ask about <url>` (SSRF-guarded fetch + AI summary, labelled) · fallback-chat SUGGEST becomes a proposal (never an execution)
- **v1.71 surface:** `propose <q>` → the AI proposes a command, `do <id>` runs it through the audited router (single-use, never confirmation-bearing) · `local models` / `local pull` / `local remove` — chat-managed Ollama models · probes 89/89
- **v1.69 surface:** plans 5 personal (free/plus/pro/elite/ultra) + 3 business (business/business-plus/enterprise) · LD packages (5 bundles, notional A$, SIMULATION) in Chat + Marketplace · social connectors on official APIs, approval-gated posting · `update check` / `update apply` self-update from the audited repo, approval-gated, backed up, sha256-audited, never self-restarting
- **v1.66 human gates:** tools that meet a captcha/2FA/consent gate pause as `WAITING_FOR_HUMAN`; owner resolves with `resolve <step> with <answer>`; single-use, masked, never a permission. Registry #169 LIVE. The chat HTTP route awaits the async router (replies were `{}` before the fix).
- **v1.65 chat surface:** every piece costs LD · LD market at a disclosed 5% spread (`SIMULATION`) · events · lotto with commit→reveal proof · sign-in gifts and daily/weekly tasks · owner protection (TOTP, sessions, alerts, drills) and the guardian 10-duty/14-threat matrix
- **Economy:** simulation only (`LD_ECONOMY_MODE=simulation`, `LD_AUD_VALUE=0.01`, `REAL_MONEY_WAGERING_ENABLED=false`, `ARENA_WAGER_ENABLED=false`) — real money COMPLIANCE-LOCKED (`ROADMAP-REAL-MONEY.md`)
- **Docs:** installation/upgrade/rollback validation in `INSTALL.md`; upgrade history in `README.md`

> Written via the LIAM `github write` chat command (approval-gated, audited).
