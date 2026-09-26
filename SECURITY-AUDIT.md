# WitForge — Security Audit Report (v1.98.0)

**Auditor:** the platform itself (`overseer.js` — 13 live-invariant layers + independent council of 7) plus a continuing manual code review.
**Date:** 2026-09-20 · **Baseline:** v1.98.0 · **Scope:** the entire shipped app — server, kernel, platform, economy/billing, vault, brain, engagement, transport, build/lint pipeline.

## Verdict methodology

Every run re-derives 13 layer verdicts from the LIVE state and the LIVE code (`deps.verifyAudit` re-walks the hash chain; the kernel loads the authority matrix from disk; the economy layer runs `economySelfTest`; the council crafts synthetic proposals to prove refusal — no static checklists). A council of 7 members each owns one independent security dimension and may only consume independent inputs they fetch themselves. **PASS requires every layer and every member green. WARN (e.g. probe not bound yet) is never silently promoted. FAIL lists the failing layer names by name.** Every run is audited.

## Findings (continuing audit)

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **High** | The API binds `0.0.0.0` (needed for the preview sandbox) with **no authentication** — any host that could reach the port could POST `/api/command`, including commands that create real Stripe charges or pay out balances. | **FIXED v1.98** — `LIAM_API_TOKEN` env var gates every `POST /api/*` behind a bearer token (401 otherwise). Off by default for the single-owner localhost UX; required with `LIAM_API_TOKEN=<…> node server.js` wherever the LAN is trusted less than the operator. Verified live: unauthenticated 401, correct bearer executes. |
| 2 | Medium | Legacy LD orders could hold oddly-computed `totalCents` if their model knew a stale fee math; the Interledger shipped body re-derived every platform amount server-side and this is released + lint-gated. | **Fixed (v1.95)**; v1.98 layer `ledger-convergence` re-checks every released payment against the settled ledger on every run. |
| 3 | Medium | Interledger transactions without confirmed financial backing could previously depress the floor of completed volume. | Mitigation shipped (v1.95): a released-without-settlement cannot pull floor closer than simply not trying. |
| 4 | Low | The overseer gel scanning for live-looking secrets inside state could flag encrypted blobs (`creds` values are ciphertext+iv+tag by construction). | **Fixed v1.98** — the verifier nulls out `data/iv/tag` ciphertext before scanning plaintext regions. Member 2 additionally proves vault entries are (data,iv,tag) shaped AND that `decrypt(encrypt(x)) === x` bears on an ephemeral key — the cipher is proven, not trusted. |
| 5 | Low | Repo previously lacked a committed `.gitignore`; transient data could slip into the public repo. | **Fixed (v1.96)** — `.gitignore` committed (data, backups, key file); lint asserts its bytes every build. |
| 6 | Info | The vault key is machine-local (`data/.vault_key`, 0600). Device admins can bear both the ciphertext and the key — expected for a local-first single-owner deployment; periodic rotation lands the same audit artifact. | Accepted (documented README); rotation forensics proved live. |
| 7 | Live | `sh llm` commands trust upstream model providers for untrusted data — mitigated by guidance, least-privilege tools, `brainClassify` conversational/exact dispatch, fenced injection-resistant prompt shaping, and the Budget/Containment drill. | Continuously mitigated; council Member 4 watches allowlist + budget + injection scanner. |

## Residual risks & honest boundary

- **WebUI trust**: the owner types free-text intents; prompt-injection via web content the brain reads is mitigated by scanner + refusal proofs, but a sufficiently clever multi-turn social-engineering against the model at the owner console is an operational, not code-level, boundary.
- **Wallet-contrast gate** (heuristic): a shaped URL list could look like a wallet contrast, but ProviderTrust rejects diffs and every dispatch is proposal-gated, so impact is bounded to a rejected draft, never an execution.
- **Fact hallucination**: numeric claims about the wallet in 'ai' kinds are checked against the ledger (v1.97); other free-form facts flow through `matched_fact` gates and tail grounding when ungrounded. Not provably zero-hallucination — the honest posture remains "verify the kind; proposals never auto-execute."
- **13 layers & 7 members do not include every conceivable check** — they can be extended; each new finding should become either a shipped fix or a new layer. The drill keeps them honest: sabotage fixtures intentionally corrupt the state and the suite asserts the verdict flips FAIL.

## The 13 live-invariant layers

1. **Transport hardening** — security headers verified over a live loopback probe (never silently green).
2. **Vault cipher-shape & cipher round-trip** — entries are (data,iv,tag); decrypted ciphertext round-trips on an ephemeral key.
3. **No secrets in state** — plaintext regions of the serialized state scanned for live-looking credential patterns; ciphertext nulled before scanning.
4. **Tool capability binding** — every catalog entry's capability set is among the known kernels; extra keys are unknown-capability drift.
5. **Approval matrix sane** — re-loads the kernel matrix (policy-intent + effect), proves prohibited effects stay prohibited.
6. **Pending approvals sane** — every pending approval parses as `(effect, ttl, status=open|consumed, risk)`; expired/flushed entries absent.
7. **Policy authority intact** — billing authorities present, every entry has `resource` + `rule`, the forger boundary is non-empty.
8. **Brain allowlist intact** — provider ids are bounded, LLM stem allowlist contains no extra/unknown stems (advisory labels, hard bound).
9. **Least-privilege bindings** — every catalog tool's scopes are a subset of kernel-recognized caps AND the run-plan law (scheduler/aim/primer classes carry their binding classes).
10. **Injection scanner live** — the detector proves itself on payload classes (override-extraction, ignore-prior, jailbreak, echo-forgery).
11. **Planner budget sane** — window bounds (40 turns / 10 min) are positive with the exact constants reading from the code in front of the runtime.
12. **Audit chain intact** — full rotation-aware chain re-verification (`deps.verifyAudit`), count-attenuation proves chain continuity, per-line checks boolean.
13. **Economy/billing authority** — economy self-test every check green; no negative account; no released-yet-unsettled billing; the shipment's water-mark contrasted honestly; forger-commands seam-verified against the kernel.

## The council of 7 (independent security dimensions)

1. **Integrity of record** — audit-chain + ledger-convergence + rotation-anchor + record-count continuity.
2. **Secrets & credentials** — vault round-trip + ciphertext-shape + plaintext-regions scan.
3. **Authority & approvals** — approval matrix + pending-approvals + policy boundary + `design_no` terms.
4. **Brain governance** — allowlist + budget + least-privilege + injection scanner.
5. **Economy & billing** — billing authority + treasury floor +arity-account sane + economy self-test.
6. **Transport & release identity** — headers + version consistency + creds wiring for delivery providers.
7. **Containment drill (synthetic, read-only)** — crafts a synthetic proposal carrying a forged confirmation and proves the keeper-class refusal law upholds it; crafts no real approvals, touches nothing.

## How to operate

- `overseer` / `security council` / `overseer report` prints the run with council table.
- `overseer drill` runs the containment drill explicitly.
- Boot runs the overseer automatically after load; the console also shows it in `quick stats` (brain block) as `· overseer ✔/✘`.
- Latest stored verdict: `state.overseer` (`{ ts, verdict, fails, warns }`).
