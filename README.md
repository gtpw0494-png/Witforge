# LIAM · v2.05.0 — expiring hashed Owner sessions

**v2.05.0:** Owner session bearer values are never persisted. The server stores
only SHA-256 token identifiers, enforces a 12-hour absolute lifetime and a
2-hour idle lifetime, updates activity at bounded intervals, and removes
expired sessions. Existing plaintext-keyed records migrate additively on boot
so active cookies continue to resolve without keeping raw tokens. Cookies now
carry an explicit `Max-Age` and gain `Secure` when HTTPS is active; the Owner
session inventory exposes only abbreviated hashes and lifecycle timestamps.

---

# LIAM · v2.04.0 — local security perimeter

**v2.04.0:** the server now binds to `127.0.0.1` by default, serves only the
four explicit browser assets, and refuses static access to source, tests,
state, backups, vault keys and dotfiles. Once an Owner exists, private GETs and
mutations require the Owner session. LAN mode requires both
`WITFORGE_ALLOW_LAN=true` and `LIAM_API_TOKEN`; insecure LAN startup fails
closed. Smoke tests prove source/state/key denial, private-state authentication
and continued public health availability.

---

# LIAM · v2.03.1 — private Owner email binding

**v2.03.1:** the first local account still becomes Owner, with an optional
private binding to `WITFORGE_OWNER_EMAIL`. First-run creation is loopback-only;
when configured, the supplied email must match and subsequent login requires
the email plus password. Only a one-way email hash and masked form enter local
state—the plaintext address is not committed, logged or returned. Existing
Owner records bind additively on the next startup with the environment value.
The default application and health-check port are now consistently `8787`.

---

# LIAM · v2.03 — the Three Laws Covenant

**v2.03.0:** the Owner's Three Laws are preserved as permanent project
doctrine in `THREE-LAWS.md`, the versioned Documentation registry, durable
`ownerDoctrines` state, the conversational `three laws` view and additive
requirement §177. The original wording is retained, with an operational
interpretation that protects authorized partnership, non-harm, dignity and
truthfulness. The covenant is philosophical doctrine, not a claim that current
software is conscious, human or literally fused with a person, and it cannot
grant authority or override consent, security, policy or law.

---

# LIAM · v2.02.1 — portable release gate and synchronized proof scanning

**v2.02.1:** maintenance rebuild of the v2.02.0 workspace:

1. Root-state tests now validate the live UID probe correctly on both root and
   non-root hosts instead of assuming every test runner is unprivileged.
2. The browser smoke harness uses a portable `navigator` stub and runs on Node
   24 without a compatibility flag.
3. The requirement gap scanner is read-only for Arena evidence and its plan
   probe now matches the current product: Free baseline + five paid personal
   tiers + two business tiers. The scanner returns 90/90 without mutating the
   workspace.
4. Release identifiers, current status, roadmap wording and evidence counts are
   synchronized to this package. No authority, security or real-money boundary
   was relaxed.

---

# LIAM · v2.02 — the free-tier rate fabric + fallback providers (truthful incorporation)

**v2.02.0:** a $0 inference strategy needs no cloud GPUs — the routing gateway already runs here; this release makes its free-tier behavior honest and rate-literate:
1. **Rate fabric (the $0 limit is RPM, not money):** `rate fabric` shows every
   provider's advisory RPM/day baseline, per-minute usage history, and cooling
   state. A real 429 now **cools ONLY that provider for 60s** (neighbours stay
   open), spends cheap windows first, and the failover chain lists exact
   skip-reasons — failover, never blackout, never silent.
2. **Two fallback providers manufactured with REAL endpoints:** NVIDIA NIM
   (`integrate.api.nvidia.com/v1/chat/completions`, llama-3.1-8b-instruct) and
   Together AI (`api.together.xyz/v1/chat/completions`, Llama-3.3-70B-Turbo) —
   `connect nvidia-nim with token …` / `connect together-ai with token …`,
   same vault storage as every key (AES-256-GCM — **we never keep keys in
   `.env` files; the credential broker is the rule §39).
3. **Doc-corrections as doctrine:** the external guide this incorporates came
   with two falsehoods, and the README + suite now pin the truth: Groq's
   endpoint is `https://api.groq.com/openai/v1` (not `https://groq.com`), and
   its current default model is `llama-3.3-70b-versatile` (the guide's
   `llama3-8b-8192` is retired). Incorporation never absorbs a lie.
Suite 302 → 308. Full gate green.

---

# LIAM · v2.01 — every enumerated state registry, to full fidelity (§40 complete · §24 · §10 · §44)

**v2.01.0:** all the spec's enum-like law families are now complete, surfaced, and enforced:
1. **§40 device trust → the full six-state legal machine** — UNKNOWN · PENDING ·
   TRUSTED · RESTRICTED · REVOKED · LOCKED with an audited legality table
   (UNKNOWN→PENDING→TRUSTED; RESTRICTED→TRUSTED; LOCKED→UNKNOWN only with
   confirmation; illegal wishes refuse with the legal-children list, never
   silent). `pend/trust/restrict/lock/unlock/revoke device <id> [confirmed]`.
2. **§40 enforced**: device-target adapters refuse with an
   UNJUST-REFUSED **offense record** until the platform trust marker is TRUSTED
   — trust is now a real precondition, not a wish.
3. **§24 root states (the real ones)**: `root state` shows the registry +
   the live uid probe; `set root ROOT_AVAILABLE` **refuses truthfully** when
   uid≠0 (§108), `ROOT_AUTHORIZED` demands confirmation. Root is never
   silently requested or activated.
4. **§10 permission levels surfaced**: `capability levels`, plus the hard
   kernel law — agent self-elevation is DENIED (no-self-elevation); even the
   owner raising to AUTONOMOUS must bind an approval record.
5. **§44 policy decisions surfaced**: `policy decisions` lists ALLOW/DENY/ASK/
   ESCALATE/BLOCK as applied before every execution (selftest still re-derives
   the PROHIBITED→BLOCK PACK each release).
Suite 291 → 302. Full gate green.

---

# LIAM · v2.00 — the manufactured adapter fleet, the baseline spec, and the offense ledger

**v2.00.0:** every device/OS adapter of the spec is now manufactured real —
1. **13 adapters** (`device-adapters.js`) built against the official static
   interface baselines: **linux** (POSIX/DBUS) · **android-adb** ·
   **android-accessibility** (uiautomator, §21 owner-grant only) · **shizuku**
   · **termux** · **macos** (AppleScript/Shortcuts) · **windows** (PowerShell
   read-only, no elevation) · **ios** (libimobiledevice) · **chromeos**
   (crostini portal) · **bluetooth** (BlueZ) · **usb** (sysfs/lsusb) ·
   **nfc** (PC/SC) · **biometric** (permanently DECLARED on a server tier —
   §39 says platform biometrics return results, never templates).
2. **The full §15 contract** on every adapter (manifest, capabilities,
   permission check/request, execution, action verification, revocation,
   status) with complete §122 manifests — asserted for all 13 in the suite.
3. **Execution truth (§108)**: CONNECTED only when the baseline probe is true
   at call time; otherwise **UNAVAILABLE with probe evidence, result null —
   never a faked device table**. Linux ops actually ran on this host and
   were **cross-source-verified (§98)**: two independent facts (kernel
   release + mapped architecture) must agree.
4. **Execution controls (§25/§53)**: execFile-only (shell:false), typed
   argument shaping (target/package/text shapers), timeouts, output caps,
   environment filtering. Shaping refusals are recorded, never best-effort.
5. **High-risk law (§52/§22)**: ADB/Accessibility/high-risk ops only proceed
   through an owner-executed proposal — and the executed proposal carries its
   own approval binding (no proposal loop).
6. **spec/ADAPTERS-BASELINE.md** — the normative interface table, truth
   labels, controls, and the law for adding adapters.
7. **The OFFENSE LEDGER** (`offenses`, OFFENSES.md): every refused attempt
   records UNJUST-REFUSED with kind/detail/evidence hash; every authorized
   execution records JUSTIFIED-AUTHORIZED. Justification is the recorded
   authority context — never a re-labelled story. §40 device trust states
   (UNKNOWN→TRUSTED→REVOKED, confirmation-required) persist and refuse.
Commands: `device adapters` · `device run <adapter> <op>` · `device trust` ·
`trust device <id> confirmed` · `revoke device <id>` · `offenses`.
Suite 278 → 291. Full gate green.

---

# LIAM · v1.99 — the ACTION FABRIC: governed envelopes, the Action Center, and the honest capability map

**v1.99.0:** the spec’s §10 closure work lands its biggest real pieces —
1. **Action envelopes for every consequential action (§7/§42/§99/§100/§101)
   — action-fabric.js:** one durable envelope carries identity, intent, plan,
   capability/scope, authority, security decision, approval binding,
   execution state, verification state, recovery state and audit lineage.
   Proposals now OPEN an envelope in WAITING_FOR_APPROVAL the moment they are
   suggested; previewing grants nothing (§7).
2. **The state machine obeys §151**: transitions validate against legal
   adjacency; terminals NEVER re-open (“SUCCEEDED” cannot quietly become
   anything else); FAILED/UNKNOWN may return only through RECOVERING.
3. **Crash-truth (§165)**: on every boot the fabric re-marks anything
   stranded in EXECUTING/VERIFYING as **UNKNOWN — never success** — with an
   audit line and a retry path (`retry action <id>` → RECOVERING → re-run of
   the ORIGINAL routed command only, no side channel).
4. **The Action Center (console form)**: `actions` lists the envelope table
   with state icons; `action <id>` shows intent, authority, security,
   verification + evidence hash and the full transition lineage;
   `cancel action <id>` is an audited terminal.
5. **Capability availability truth (§144/§10)**: `capabilities live`
   separates interface-LIVE (a real local adapter is bound) vs CONNECTED
   (authorized access present) vs DECLARED — declaration is never
   availability, and nothing conceptual is exposed as executable.
6. **ROADMAP.md — the honest ledger**: every remaining §10 area is marked
   ✅ live / 🔶 foundation / ⛔ not built. Device adapters (Android/Apple/
   Windows/ChromeOS), biometrics, passkey MFA and the OpenTelemetry export
   are listed as NOT built — they appear nowhere as usable UI.

`do <pr>` now executes THROUGH the envelope (EXECUTING → VERIFYING →
SUCCEEDED with an evidence hash), so what the gates enforced and what the
user sees are the same record. Suite 270 → 278. Full release gate green.

---

# LIAM · v1.98 — the OVERSEER: 13 layers + a council of 7, and the continuing security audit

**v1.98.0:** the platform gained a defense-in-depth auditor of its own and
this release ships the audit with it.
1. **The OVERSEER (overseer.js)** — **13 live-invariant layers** re-derive
   their verdicts from LIVE state and LIVE code on every run: transport
   hardening over a real loopback probe · vault cipher-shape + cipher
   round-trip · no-secrets-in-state scan (ciphertext nulled before scanning,
   live-looking literal patterns never alibi) · tool-capability binding ·
   approval-matrix sanity · pending-approvals sanity · policy authority
   intact · brain allowlist intact · least-privilege bindings · the
   injection scanner proving itself on payload classes · the planner
   budget (40 / 10 min) · the full rotation-aware audit-chain
   re-verification · economy/billing authority with the settled-vs-released
   cross-check.
2. **The council of 7** — seven independent members each own one security
   dimension (integrity of record · secrets & credentials · authority &
   approvals · brain governance · economy & billing · transport & release
   identity · containment drill) and may only consume inputs they fetch
   themselves. The 7th member crafts a synthetic proposal carrying a
   forged confirmation and proves the keeper-class refusal law upholds it
   — read-only; it never creates a real approval.
3. **Honest verdicts** — PASS requires every layer AND every member green;
   an unbound probe is WARN, never silently green; FAIL names the failing
   layers. The suite’s sabotage fixtures corrupt the state on purpose and
   the verdict MUST flip FAIL — asserted at 270 platform checks. Runs are
   boot-automatic and audited; `overseer` / `security council` /
   `overseer drill` print it any time.
4. **The audit continues and ships its finding** — `SECURITY-AUDIT.md`
   records the findings table: finding #1 (the API binds `0.0.0.0` with no
   auth — any reachable host could drive commands incl. real charges) is
   **fixed in this release**: `LIAM_API_TOKEN=<…> node server.js` gates
   every `POST /api/*` behind a bearer token (401 otherwise; off by
   default for the single-owner localhost deployment). Vault round-trip,
   ledger cross-checks, and the cipher-shape proof were hardened along the
   way.

---

# LIAM · v1.97 — claim verification, the taste drawer, learned routing

**v1.97.0:** research round five (span-level hallucination claims vs
external ground truth · preference feedback distillation · learned
routing), three shipped upgrades —
1. **Claim verification**: any numeric claim about YOUR balance that
   contradicts the live ledger earns an appended honest correction
   (⚠ claim-check …) — the model’s words are never edited, but they are
   never left misleading either. Accurate claims pass untouched.
2. **The taste drawer** (`feedback <text>`): how-to-talk preferences ride
   the planner prompt as owner-supplied STYLE — injection-refused,
   erasable (“clear feedback”), distinct from facts (“remember that …”).
3. **Telemetry-informed failover ordering**: chronically-failing providers
   sink in the fallback chain by recent error record; the default still
   speaks first; labels stay truthful per reply.
Suite +6.
**v1.96.0:** reflection, owner-runnable brain eval, opt-in Puter AI art —


**v1.96.0:** research round four, three shipped upgrades —
1. **Reflexion, honestly scoped** (Shinn et al.): when a run-plan fails, the
   failure class becomes a verbal **lesson** in a session-scoped episodic
   ring; lessons ride subsequent planner prompts so the same mistake is not
   repeated this session. No weights change, nothing persists, every lesson
   is audited — the owners of the paper say reflection works when the
   evaluator is crisp; ours is (the command's own ok:false + error).
   Failure turns into an honest follow-up: the closest real ability is
   offered as a §168 proposal.
2. **“brain eval”** — the owner-runnable probe battery: scripted model
   outputs score the PROGRAMMATIC gates (verifier, secret refusal, labels,
   repairs, cache-behavior, classify paths, lesson storage) — 10 invariants,
   zero provider calls; drift after upgrades is visible on demand.
3. **Opt-in AI-painted art via Puter** (spec C(69) — the only sanctioned
   external runtime): a studio toggle 🎨 AI art — Puter loads lazily, paints
   piece thumbnails, caches per-identity locally; thumbs state exactly which
   layer painted them; the deterministic sigils stay default and fallback.
Suite +4; evaluator coverage doubles as its own invariant.
**v1.95.0:** cascades, planning cache, injection defense-in-depth —


**v1.95.0:** research round three (FrugalGPT cost/quality cascades +
prompt-injection defense-in-depth), four shipped upgrades —
1. **FrugalGPT tier-0 local matcher**: with no provider connected, a
   deterministic bigram-overlap scorer (precision-first, daylight-to-second
   margin, command-complete stems only — no argument invention) earns the one
   thing it honestly can: a §168 **proposal** for the best-matching ability.
   Never an execution; weak matches keep the old honest refusal.
2. **Planner response cache** (LLM approximation): identical questions in an
   unchanged context cost one provider call — conversations only, 5-min TTL,
   `· cached` labelled; run-plan outcomes are effects and are NEVER cached.
3. **Injection defense layer 1+2**: critical rules repeated at the planner
   persona tail; owner text + memory ride inside <<<UNTRUSTED>>> delimiters;
   an input scanner flags known jailbreak shapes (audited guard line, handled
   as data never instructions — speedbump, not wall, per the literature).
4. **Memory hygiene at the boundary**: instruction-shaped “facts” are refused
   on write — indirect injection cannot enter the long-term store.
Telemetry (`ai models`) now counts schema repairs, cached replies and local
matcher offers. Suite +9.
**v1.94.1:** the gate actually wired (live-caught, evidence-kept) —


**v1.94.1:** post-release live probes caught the v1.94.0 hot-path executing
an alter-command (an aborted script had died between patch and verify;
the brain fell back to its permissive default). Every runtime is now
guarded by a shipped-wiring assertion: the deps never silently default.
Full gate green; the model also mis-planned “gemini” as “groq” on that
probe — exactly why the least-privilege gate exists.
**v1.94.0:** structured repair, least privilege, short-term memory —


**v1.94.0:** research round two, shipped:
1. **Structured-output repair** (constrained-decoding practice): a planner
   reply that LOOKS like an action but fails the contract earns EXACTLY ONE
   audited repair call — never silent, never guessed; plain conversation
   needs none.
2. **Least privilege**: only read/display intents may run instantly through
   the router; anything that spends LD, writes, configures or carries a
   confirm-word routes through the **§168 proposal gate** (“do <id>”) — the
   brain plans power, it never holds it. Audited as BRAIN PROPOSE.
3. **Short-term conversation window**: the last exchanges ride the planner
   prompt (session-scoped, in-memory; “clear conversation” resets); long-term
   memory stays owner-curated (v1.92).
4. **Planner telemetry + “ai models”**: turns / router executions / proposal
   routings / schema repairs, per-provider, inspectable by the owner.
Suite +9 (repair exactly-once · proposal gate leaves the router untouched ·
window carries context · clear resets · telemetry command wired).
**v1.93.0:** the Piece Inspector —


**v1.93.0:** every piece portrait anywhere in the UI is now **clickable** —
the Piece Inspector opens the enlarged sigil portrait with full provenance
(slot/kind, rarity band + R-level, power, element, resists, species and the
identity fingerprint that makes its portrait deterministic). Client-local
registry keyed by fp; zero network, zero new state.
**v1.92.0:** the brain grows up (research-integrated) —


**v1.92.0:** the planner absorbed the published agent-architecture canon,
distilled into five shipped upgrades —
1. **Catalog allowlist verifier** ("typed tool schemas / allowlists for safe
   execution"): an emitted command matching no catalog stem is an *invented
   ability* — refused, never executed, served with the nearest real
   abilities plus a governance audit line. Verifier is tolerant of
   bare-bullet catalogs.
2. **Evidence-bound traces** (ReAct governance): every run-plan carries a
   one-line **why**, recorded in the `BRAIN ACTION` audit line; few-shot
   grounding examples sharpen plan-vs-converse reliability.
3. **Owner-curated long-term memory** (persistent-memory research,
   offline): “remember that …”, “what do you remember?”, “forget N/all” —
   top-k deterministic retrieval (word overlap + freshest) feeds the planner
   prompt; secret material is refused at the door; export covers it; the
   legacy statement store folds in exactly once (no zombie facts, legacy
   `remember`/`recall` keep working).
4. **Provider failover**: the planner tries the owner-chosen model, then
   every other connected key, then the keyless local model — the reply
   always honestly names whichever model actually spoke.
5. **Planner turn budget**: 40 turns / 10 min per process — a runaway chat
   loop cannot run up provider spend; rule-intents always stay free.
Suite +9 (verifier · invented-ability refusal · near-stem offers · few-shots
· why-plans · memory cycle + secret refusal · failover shape · budget).
**v1.91.0:** a deterministic picture for every piece —


**v1.91.0:** **`piece-art.js`** — every avatar piece, companion and cosmetic
now carries an identity-keyed **sigil portrait**: seeded from the piece’s
cryptographic fingerprint (§71), so the same piece shows the same image
everywhere, forever; tinted from its own rarity colour with band-tier pips
and deterministic sparkles; one motif family per slot group (all 12 combat
slots + pets + cosmetics). Computed at read time and **never persisted** —
attached in `publicAvatar` and `marketList` copies only; the database record
is untouched. The UI renders the portrait everywhere a piece appears:
Avatar Studio equipment + inventory, Loot Vault sell rows, companions,
marketplace listings (graceful fallback if an older response lacks art).
Procedural means zero dependency and offline-honest — labelled as sigil
portraits, never passed off as AI paintings; Puter-generated art stays the
available upgrade (spec C(69)). Suite +3.
**v1.90.1:** the brain stops echoing its own contract —


**v1.90.1:** live, the planner sometimes prefixed chat replies with its
contract's own label — “Conversation: …” — and that leaked into owner-
facing text. Stripped at the boundary (`stripFormLabel`), suite-covered.
**v1.90.0:** the agentic brain: natural words to every ability —


**v1.90.0:** **`brain.js`** turns the chat fallback into an operator. When no
rule-intent matches, the owner’s message goes to the planner persona: ground-
truth numbers (wallet, plan, approvals, verified adapters, open orders,
events) + the full audited capability catalog + one contract — *converse
naturally, or emit exactly ONE command from the catalog*. A run-plan executes
through **the same audited router the owner’s typing takes** — capability
checks, risk gates, approvals and PROHIBITED all apply downstream; the
`BRAIN_ACTIVE` guard means a brain-emitted command can never spawn a second
plan inside the turn. One plan per message, no autonomous chaining — agency
with an audit line (`BRAIN ACTION: “…” → “…”`) for every act and the
legacy SUGGEST→proposal shim fully absorbed. Secret-bearing commands are
refused at the brain boundary (keys stay manual-only into the vault).
`llm.js` gains an optional per-call system-prompt override (the persona
floor remains the default); every reply stays labelled provider · model.
Conversational quality is the connected provider’s — the persona makes it
natural and honest; the platform never claims it is a person. Suite +3
(parser shapes · run-plan executes through the injected router · junk
degrades to honest conversation, never a guess-execution).
**v1.89.2:** case-sensitive ids survive the router (live-proven fix) — the full real-money loop face-planted on one letter-case:
`confirm payment <cs_live_…>` captured its id from the router's
lowercase pipe — Stripe ids are case-sensitive, so every lookup
answered a mangling-induced 404 while the same id fetched 200 directly.
The intent now reads the original-cased command (`q.match`), with the
why in the code and a source-level suite check. End state proven live:
create order → real checkout URL → confirm → Stripe itself answers
*unpaid*, zero LD moved — the loop is exactly as strict as the law.
**v1.89.1:** checkout names its payment method (live-proven fix) —


**v1.89.1:** the first live `buy ld package` hit Stripe's true gate for
this account shape: HTTP 400 — *"No valid payment method types … ensure
that you have activated payment methods … or specify
`payment_method_types`."* Probed with the account's own key: naming
**`payment_method_types[]=card`** in the session form creates the
checkout fine (HTTP 200, live session URL, status open). Now in the
code, with the why. Remaining gate is the account's own: dashboard
payment-method activation + charge enablement — Stripe enforces that at
pay time, and settlement still credits nothing until `paid` arrives.
**v1.89:** real Stripe billing, order-bound; the router obeys again —


**v1.89:** two halves, both earned live. **The chat brain is linked for
real:** the `ask|ai` catch-all was shadowing every control command
starting with “ai ” — “ai provider openrouter” was *answered* by the
model instead of executed. The catch-all now stands last; control
outranks conversation, permanently. Verified live today: openrouter ·
openai/gpt-4o and gemini · gemini-3.6-flash round trips. **Real cash
payments, no simulation:** LD packages and `create payment` now open
**order-bound Stripe Checkout sessions** — every session maps to a
platform order (id, LD, cents, wallet) at creation. Settlement is split
into a pure `settleStripeEvidence` (suite-proven offline) glued to a
network retrieval: credit requires the session to be platform-opened,
Stripe `payment_status=paid`, metadata LD == order LD, and
`amount_total` == order cents — amount tampering, unpaid sessions, and
third-party sessions under our own key each refuse with zero LD moved;
replay is idempotent (ledger delta 120, never 240). `enable real
payments confirm` also arms the subscription **billing authority**
(stripe:<acct>, timestamped) so §114 invoices issue; disabling revokes
it. Compliance sentence unchanged: the app claims no licence — the
Owner bears it. Suite +3 (settle-once · refuse-laws · authority).
**v1.88:** secrets never persist through the chat path —

**v1.88:** the vault guards credential STORAGE; this closes the PATH
credentials arrive by. A chat message like “connect stripe with token
sk_live_…” lands in conversation history — the same unencrypted store as
everything else — making the vault moot for anything typed once. Now,
before any message can reach disk: **scrubSecrets** replaces the
connect-command form, named-provider token shapes (Stripe/OpenRouter/
GitHub/Slack/AWS/Google), JWTs, and private-key blocks with •••, on every
write path — the conversation route, conversation titles, manifest
imports (with the audit landing in the imported store, not the discarded
one), plus a one-shot boot sweep of pre-existing history, audited by
count only, never by material. Honest scope, written where the code
lives: these patterns catch the shapes we recognise — a scrubber cannot
recognise every possible secret; the vault stays the only place secrets
belong. Suite +3 (shape coverage with provable non-mangling of ordinary
prose · import-path scrub with material-free audit · whole-chain secret
scan). **v1.87:** crypto hygiene for the vault: **rotateVaultKeys** — forward-looking, fail-closed: **rotateVaultKeys** (vault module,
P export, `POST /api/vault/rotate`) re-keys the vault-key, the device
pepper, or both, then re-seals every credential and OAuth app secret —
plaintext identical, records stay v2, timestamps preserved, key files
provably changed, audited. The boundary language is as honest as v1.85:
rotation is **forward-looking only** — material already copied decrypts
what it decrypts; what changes is that pre-rotation key halves no longer
open this store. And the refusal rule is absolute: if ANY record cannot
unseal, rotation does not start — the broken record is named and left
untouched for re-entry; plaintext is never rotated onto loss. Suite +3
(full rotation · stuck-record refusal with files byte-identical ·
half-rotation and rotate-nothing refusal).
**Spec ledger:** C(54) CREDENTIAL BROKER regraded **PARTIAL → LIVE** —
the PARTIAL prose ("tokens server-side; opaque metadata in UI") was
outrun by v1.85–v1.87: write-only broker, device-bound v2 at rest,
audit-trail migration, sealed transfers, rotation — all suite-proven.
**v1.86:** passphrase-sealed vault transfers — moving machines without
re-entering everything, via **sealVaultTransfer / openVaultTransfer** (vault
module, P exports,
`POST /api/vault/seal` · `/api/vault/open`). The owner types a ONE-TIME
passphrase (≥ 8 chars, enforced) and every credential + OAuth app secret
leaves the vault decrypted **only in memory**, re-sealed per record under
scrypt(passphrase) + AES-256-GCM — a self-describing bundle whose ONLY
key is the passphrase you carry (it is never stored, hashed, or logged;
the code says so at the seal boundary). Records are individually
authenticated: flip one byte and that record fails alone while the rest
restore (proven: restored 1 / failed 1). A wrong passphrase fails closed
— zero records written, existing vault untouched, honest error. Arrival
re-seals into the new device's v2 vault automatically. Undecryptable
records are skipped and named, never sealed. Both directions audit.
Suite +3 (cross-device round trip w/ plaintext-scan of the bundle ·
wrong-pass fail-closed · tamper isolation + short-pass refusal).
**v1.85:** the vault became **device-bound** — credentials seal as
AES-256-GCM under **HKDF-SHA256(vault-key, device-pepper)**, where the
pepper lives outside the project at `~/.witforge/device-key` (minted 0600,
mode re-asserted on every read, env-overridable so test suites stay
hermetic). A zip, cloud-sync leak, or mirror clone of the project folder
yields ciphertext that decrypts **nothing** — neither half alone is a key.
Boot migration re-keys every v1 credential and OAuth app secret exactly
once, audited (`VAULT DEVICE-BINDING v1.85`), plaintext-identical;
undecryptable stragglers are left untouched and reported loudly, never
destroyed. The recovery console verifies v2 stores and now prints the
binding (`device-bound v2 (folder copies decrypt nothing)`); a missing
pepper is named, with its path, as the reason a copy fails — by design.
Stated honestly where it ends: a whole-disk image of this machine still
holds both halves; OS-keychain binding is the next step, deferred because
it needs a native dependency and WitForge is zero-dependency by charter.
Suite +3 (v2 round-trip · folder-copy fails closed, original untouched ·
migration re-keys creds + OAuth secrets, audited).
**v1.84:** the final extraction of the monolith arc — **`connectors.js`**
now owns the six-provider SOCIAL registry (name/scope/URLs/auth kind),
SOCIAL_POSTABLE, socialEntry, and the 32-entry ADAPTERS registry of
real executors, plus adaptersLive(state): operational truth (UNAVAILABLE
→ VERIFIED) overlaid onto the registry from caller-supplied state with
zero globals. A hoisted wrapper in platform.js keeps every existing
zero-arg call site — adapter cards, `what can you reach`, live smoke —
working untouched. With this cut the arc (httpguard → oauth-server →
vault → connectors) is complete: platform.js is 3,126 LOC from its
3,422 peak, and the remaining kernel is cohesive by design. Finding #5
of the analysis is closed with its final assessment folded into
WitForge-ANALYSIS.md; the suite adds connectors-registry checks (+2).
**v1.83:** `vault.js` owned everything secret-at-rest — AES-256-GCM
encrypt/decrypt, the 0600 key file with boot self-heal, the audited
one-shot legacy re-key, and the write-only broker (listings never
contain material). Call sites in platform.js are unchanged in name and
behaviour via destructured bindings. Core file: **3,352 → ~3,110 lines**.
16 hand-written modules; 585 checks in the gate. Recovery console
(external, standalone crypto reimplementation by design) unchanged —
it now validates an extracted vault's outputs, exactly as intended.

**v1.82:** the second v1.81-style extraction: `oauth-server.js` now owns the
official sign-in journey (register app → authorize URL → guarded code→token
exchange → encrypted account-token store) against `oauth.js`'s pure wire
builders. Every platform touchpoint (`getState`, `save`, `audit`,
`encryptToken`, `decryptRec`, `setCredential`, `guardedFetch`) is injected,
so the journey logic is fully dry-testable without globals or network; the
ships module cannot exist without its host wiring, but its decisions are
provable standalone (suite +2: unknown-provider refusal, truthful
SETUP-REQUIRED failure — both without globals). Core file: 3,352 → ~3,250.
15 hand-written modules; 582 checks in the gate.

**v1.81:** the analysis' one remaining OPEN finding (keep extracting from

**v1.81:** the analysis' one remaining OPEN finding (keep extracting from
the core file) gets its next chapter: the HTTP/SSRF guard and sandbox path
guard now live in **`httpguard.js`** — the platform's single egress point
as an explicit, dependency-injected module. One constant remains enforced:
**no other file performs a raw fetch** — every connector, LLM call, OAuth
exchange and tool request flows through `guardedFetch` (DNS-revalidated
SSRF blocking, never-follow redirects, 8s timeout, capped bodies), and
every file tool through `safePath` (traversal → null, never a leak). The
network edge stays injectable for dry tests; platform.js keeps its callers
via DI binding at boot. 13 hand-written modules + UI; the truth rules and
the gate are unchanged (SSRF/traversal adversarial tests were already
end-to-end through the platform — they now prove the extraction too).

**v1.80:** official social sign-in now renders its real stage from the

**v1.80:** official social sign-in now renders its real stage from the
server-side state machine (single source of truth, also asserted by
platform-test at every transition):
1. **SETUP REQUIRED** — no developer app: inline client-id/secret fields +
   portal guide + exact callback URL (unchanged, kept).
2. **REGISTERED · NOT AUTHORISED** — app saved, grant not given: the
   primary action is **Authorise with ‹platform›** (explicit vocabulary —
   OAuth's own), plus Forget app / paste-code fallback.
3. **AUTHORISED · NOT CONNECTED** — replaces the old flat "unverified": an
   account token is stored (AES-256-GCM) but nothing has proven it; the
   card says exactly that and points at Verify for a real round trip with
   recorded evidence.
4. **CONNECTED · VERIFIED** — live round trip on record (with timestamp).
The callback landing page and the connector pills speak the same language;
`GET /api/oauth` now returns `stage`, `authorised`, `connected`,
`verifiedTs` alongside the earlier fields (backward-compatible).

**v1.80.1 (same day):** environment restores must not weaken the patch —
a platform boot now **self-heals a normalized vault-key mode back to 0600**
(observed: sandbox persistence layers raising it to 0644; proved by test:
chmod 0644 → reboot → 0600 again). Git identity now lives in the global
config so the commit pipeline is likewise restore-proof.

**v1.79:** the deep project analysis' ranked findings, converted into

**v1.79:** the deep project analysis' ranked findings, converted into
passing tests:
1. **Durability** — every state save is now **atomic** (tmp write + rename;
   a crash truncates only the tmp file, never the store), every boot keeps
   a **last-good `.bak` snapshot**, and a corrupted primary store is
   recovered from the snapshot on record — data loss is refused, not just
   made unlikely (platform store and arena store alike). platform-test
   proves it by writing `GARBAGE{{{` over the primary and booting fine.
2. **Vault separation** — the credential AES-256-GCM key no longer derives
   from the state file's signing secret; it derives from an independent
   secret in `<DATA>.vault-key` (**chmod 0600**). `platform.json` alone now
   decrypts **nothing**. Existing stores are re-keyed by a one-shot,
   audited migration (live store: 4 credentials re-keyed, all verified
   decrypting afterwards). Honest limit stays stated: whole-disk copies
   take both halves; OS-keychain storage is the legitimate next step.
3. **Truth sweep** — `index.html` asset pins were stale at v1.73.0 (now
   v1.79.0); a prose slip crediting the free-tier restoration to v1.78.0
   was corrected to the true v1.74.1; buildTag/coverage labels verified
   against the real 177-requirement ledger.
4. **`analysis/` clarified** — one-off v1.60-era patch scripts are now
   marked ARCHIVED (provenance, never re-runnable); `gap-scan.js` remains
   a live gate instrument.

**v1.79.1 (same day, additive-only):** two follow-throughs found while
operating on the above — ① **audit retention anchoring**: the audit log is
bounded to 600 entries by design (Data Retention Policy), but dropping the
oldest halves silently broke `verifyAudit` once the cap fired; the retained
window now starts from a **chain anchor** to the dropped history, so a
forged entry inside the window is still caught while rotation is provably
verifiable (proved with 605 forced rotations + a tamper probe);
② **`recovery.js` console + `npm run recover`** — a read-only, zero-mutation
health grader for every persisted store (primary/.bak/effective, anchor-aware
chain verification, vault key perms + per-credential `DECRYPTS|FAIL` —
secrets never printed), library-importable for tests (it is: 2 assertions
inside platform-test). Arena-store durability is now **test-proven**, not
just code-reviewed: same GARBAGE-over-primary drill, avatars survive.

**v1.78:** chat with a connected AI brain now turns everyday conversation

**v1.78:** chat with a connected AI brain now turns everyday conversation
into real platform action. Every message runs the rule-based router first;
unmatched text falls through to the connected LLM with a **command atlas**
in its system prompt — only the exact, audited command forms (`help`,
`briefing`, `weather <city>`, `create task <text>`, `open lotto round`,
`buy a lotto ticket`, `verify <provider>`, `ask all`, …). The brain REPLIES
labelled `🤖 [provider · model]` (advisory only), and when it emits a
`SUGGEST:` line the platform records a **📋 proposal** — "say `do pr<N>` to
run it". Proposals never self-execute: `do pr<N>` re-enters the audited
router where permissions and approvals still apply. Grounding proved live:
real chat produced REAL proposals (`connections`, `buy a lotto ticket`),
never hallucinated commands. Truth fixes in the same pass: bare
`summarize <url>` was hijacked by the fetch-tool's URL tutelage — it now
falls through to the brain; and a failing-but-connected provider (rate
limit, outage) is reported as `ai-error` with its real cause — never
mislabelled "no AI provider connected" (that `ai-unconfigured` state still
exists, only for genuinely keyless installs). Verified live against the real
gemini free tier: five labelled answers, then real HTTP 429s reported
truthfully.

**v1.77:** the SOCIAL cards on the Credentials page grow an **Official
sign-in** block for all six platforms (X · Facebook · Instagram · Reddit ·
LinkedIn · TikTok): register your developer app (guided, per-platform portal
steps + the exact callback URL to register), press **Sign in**, authenticate
on the platform's own page — the password never touches WitForge (Charter
art. III; §130–§139) — and the callback lands back here, exchanging code →
token server-side with PKCE where required (X). States are single-use with a
10-minute TTL (CSRF guard); app secrets are AES-256-GCM at rest; tokens stay
write-only. Unregistered apps report truthful SETUP REQUIRED — never a faked
connect button. New `oauth.js` module with dry-testable wire builders
(platform-test asserts the exact requests without network).

**v1.76.1 hotfix:** gemini-2.0-flash was retired upstream — and even 2.5-flash
now 404s for new keys ("no longer available to new users, use
gemini-3.6-flash"). Default is now `gemini-3.6-flash`. Also fixed, same probe:
Gemini replies labelled `gemini · undefined` (wire body carries no model field)
and `verify` failing truthful keys with an 8-token probe that thinking models
spend entirely on reasoning (now 64). Verified live: `gemini · gemini-3.6-flash (893ms)`.

**v1.76:** new CONTROL workspace **Credentials** — one card per connectable
service (5 AI providers · 6 social platforms · GitHub · Stripe), each with its
official developer-portal steps and link, a paste field, and Connect / Verify /
Revoke. Storage is the same audited AES-256-GCM store the chat command uses;
tokens are write-only, never returned by any API. Verification replies are the
platform's own real round trips. X carries its 2026 truth: no free tier —
pay-per-use credits only.

**v1.75:** the legal register gains its constitutional instrument —
`LEGAL-GLOBAL-TRUST-CHARTER.md`. WitForge is decentralized and global: bound by
no single jurisdiction, and self-bound by one covenant with every user — **be
correct, be honest, be trustworthy.** Versioned and additive like every legal
record (§94); the register now holds 21 records.

**v1.74.1:** the Free (A$0) baseline is back by owner decision — it sits under
the paid ladder as an entitlement baseline, never a charge.

**v1.74:** the Plans/Subscription paid ladder was reshaped. Personal — plus A$9 ·
pro A$29 · elite A$79 · ultra A$149 · apex A$299 per month; business —
business A$30 · business-plus A$99 per month; the A$499 enterprise tier was
retired. Prices remain **reference labels, never charges** — billing stays
compliance-locked until billing authority exists.

**v1.73.1 hotfix:** OpenRouter retired `meta-llama/llama-3.3-70b-instruct:free`
(upstream 404 "unavailable for free"), which broke the default brain reply path.
Default model is now `openai/gpt-4o` (paid per token); `":free"`-tagged models
remain zero-cost on request. Verified live against the OpenRouter API on
2026-09-19. The v1.73 feature set is unchanged, below.

Local-first, security-first operating platform implementing the WitForge
master specification against the LIAM control-centre surface. The server is
authoritative; the browser is a control surface; the user's request grants
permission; explicit approval governs high-risk actions; nothing is simulated
as success.

## Run

```sh
cd WitForge
npm install             # truthful no-op: zero runtime dependencies
npm run dev             # = node server.js → http://localhost:8787 (PORT overrides)
```

Then open `http://localhost:8787`. Full installation validation, upgrade and
rollback procedures are in **INSTALL.md**.

Verification (every command below was executed on this tree):

```sh
npm run build           # source validation pass (no bundler)
npm run lint            # project lint rules, dependency-free
npm test                # all six suites
npm run selftest        # §126 self-test → PASS/FAIL/WARNING/NOT_TESTED
```

| Suite | Checks | What it proves |
|---|---|---|
| `spec-test.js` | 93 | §125 release areas: authentication → failure continuation |
| `adversarial-test.js` | 78 | §150 the 13 mandated attack classes + audit tampering |
| `platform-test.js` | 166 | ledger, SSRF, sandbox, allow-list, approvals, router, human gates, LLM ensemble/consensus/proposals, briefing, ask-about-URL, ad agent, local model management, plans/LD packages/social/self-update |
| `arena-test.js` | 28 | races, naked starts, loadout gate, determinism |
| `engagement-test.js` | 117 | v1.65: LD costs, LD market, events, lotto, rewards, plans, guardian |
| `smoke-test.js` | 57 | boots the real server and renders every view; chat-over-HTTP replies and the human-gate round trip |

Requirement-level gap analysis against the 168-section master spec:
`node analysis/gap-scan.js` → **89/89 probed requirements present**.

## v1.73 — the advertising agent (with walls)

`ad campaign "Name" on x, facebook: <brief>` — the brain drafts the post
variants autonomously (source recorded), `ad schedule <id>` expands them
into a rate-capped queue, `ad dispatch <id>` sends — behind ONE
campaign-level approval, at most one post per platform per dispatch, only
to channels you connected and verified through official APIs, with real
platform responses reported honestly (never faked). `briefing` counts
campaigns. What this agent deliberately is NOT: a mass unsolicited blast.
Posting "anywhere, to anyone, by any means" autonomously would breach
platform terms, the AU Spam Act 2003 and this platform's own AUP — so the
agent amplifies your voice on your channels and nothing else.

## v1.72 — briefing, ask about <url>, fallback proposals

- `briefing` — one command, whole picture: emergency/economy/AI state, local
  model count, pending human steps, pending AI proposals, pending approvals
  and expired capabilities (with their ids, so the next `do`/`resolve`/
  `approve` is copy-paste away). All local state — instant.
- `ask about <url>` (or `summarize <url>`) — fetches a public page through
  the SSRF-guarded reader and has the brain summarize it (≤120 words + key
  facts), labelled with provider·model and the source. Private addresses are
  refused by the guard; only public http(s) pages are read.
- Fallback chat now participates in §168: if the brain answers an unmatched
  command with a `SUGGEST:` line, it becomes a *proposal* (visible in the
  Approvals workspace and to `briefing`) — never an execution.

## v1.71 — propose/do: AI proposes, the owner disposes

`propose <question>` asks the brain for advice; if the reply maps to a
platform command (the model ends with `SUGGEST: <command>`), the platform
shows it as a proposal — say `do <id>` and the command runs through the
normal audited router (permissions, approvals and stops all still apply).
Proposals are single-use and may never carry confirmation or approval
words — those you type personally. This is §168 made executable: *AI
proposes; humans authorize; server enforces.* Also new: chat-managed
local models — `local models`, `local pull <model>`, `local remove
<model>` (real Ollama API calls; the local port is loopback-pinned with a
validated test override). The requirement probe suite grew to **89/89**
covering every platform addition since the master spec.

## v1.70 — ask consensus

`ask consensus <question>` runs the full ensemble, then has the default
provider synthesize one balanced verdict: `🤝 Consensus [provider · model]`
followed by the labelled answers considered (and any provider failures).
Disagreement between models is reported, not smoothed away. Releases are
now tagged (`v1.65.0` … `v1.70.0`), and the self-update check is verified
end-to-end against the live repo ("Up to date" once the CDN purges).

## v1.69 — subscriptions reshaped, LD packages, social connectors, self-update

- **Plans are now 5 personal + 3 business.** Personal: free · plus · pro ·
  elite · **ultra** (new, rank 4). Business: business · business-plus ·
  enterprise (enterprise-max retired). Entitlements stay server-enforced;
  price labels stay reference-only until billing authority exists.
- **LD packages in the marketplace.** Five bundles — starter 500, value
  1,000+200, pro 2,500+600, elite 5,000+2,000, founder 12,000+5,000 LD —
  at notional A$5/10/25/50/100 with the bonus improving the effective rate.
  Real double-entry postings, `SIMULATION`-labelled, buyable from Chat
  (`buy ld package <id>`) or the Marketplace workspace. Billing stays
  compliance-locked.
- **Social connectors on official APIs.** x, facebook, reddit (postable) +
  instagram, linkedin, tiktok (verify-only, honest reasons). Your own
  developer credentials via the encrypted connect flow: `connect x with
  token <t>` → `verify x` (a real API round trip) → `post x <text>` —
  posting is high-risk, approval-gated, refuses without a proven-live
  credential, and is never simulated.
- **Chat-driven self-update.** `update check` compares this install with
  the audited public repo (read-only). `update apply` is high-risk and
  approval-gated: refuses downgrades/replacement, backs up every
  overwritten file to `data/update-backups/`, records per-file sha256 in
  audit, skips `data/` and `.git`, and never restarts itself — restart is
  always the owner's action.

## v1.68 — ask all: the ensemble mode

`ask all <question>` (or `ensemble <question>`) fans one question out to
**every connected provider simultaneously** — labelled answers come back
per provider with model and latency, and a provider failing (rate limit,
bad key, offline) is reported as a failure line without sinking the rest.
`llm.verify`, `llm.chat` and the ensemble all share one rule for local
models: if the requested model is not installed in Ollama, the first
installed model answers and is named truthfully in the response.

## v1.67 — Chat gets a brain: six LLM providers, free-first, truth-stated

Chat was a pure rule router; unmatched asks dead-ended. Now the platform has
a real AI layer (`llm.js`) with six providers behind one interface:

| Provider | Key | Free tier |
|---|---|---|
| `groq` | free, no card | ~30 req/min, 14,400/day (Llama 3.3 70B) |
| `gemini` | free, no card | Google AI Studio free tier |
| `openrouter` | free | `:free`-tagged models |
| `deepseek` | free grant | on signup |
| `mistral` | free tier | experiment plan |
| `ollama` | **no key** | fully local open-source models on 127.0.0.1:11434 |

**Use it:** `connect groq with token <your-free-key>` then `verify groq`, and
ask anything: `ask explain what LD is` → the reply is labelled
`🤖 [provider · model]` so the rule engine and the AI are never confused.
`ai provider <id>` picks the default (deterministic fallback order:
groq → gemini → openrouter → deepseek → mistral → ollama). When no rule
intent matches, the connected brain answers automatically; with nothing
connected the reply lists every free option with the exact connect command —
it never guesses and never pretends.

**Truth and safety rules kept:** a missing key is `UNAVAILABLE` with the
free-key path, never faked; keys travel in headers (never URLs) and are
masked in audit; the AI answers and advises but never executes — commands
still run through the audited router; Ollama is the only loopback traffic,
validated to `127.0.0.1:11434` and nothing else (not a general SSRF
exemption). Tools: `llm.status` / `llm.chat` / `llm.verify`; HTTP: the same
through `/api/command` and the fallback path. 18 new platform checks cover
wire formats (dry), truthful errors, loopback validation and a full local
round trip against a live local endpoint.

## v1.66 — human gates belong to the human (and the chat rail actually answers)

Two things landed in this release, one by design and one by discovery.

**1. Human-in-the-loop steps (requirement #169 in the registry, `LIVE`).**
When any tool meets a human gate — a captcha, a 2FA prompt, a consent
screen, a credential box — the platform now pauses as `WAITING_FOR_HUMAN`
instead of failing or pretending. The step appears in Chat and in the
Approvals view with kind, service and instructions. You complete the gate
*yourself*, then say:

```
resolve <step-id> with <your answer>
```

and repeat the original command. Your answer is injected into the paused
tool exactly once, then the step is closed (`pending → resolved → consumed`)
— single-use, masked in audit, never stored as a permission, never reused.
`stop <step-id>` cancels a pending step. The platform itself completes no
captcha and defeats no human gate: a human acts, the machine waits and
remembers. This is the honest version of “act on my behalf” — the same
rule the spec already states (§130–§139: *human-required steps are
completed by the user*), now executable end to end. Tools declare gates by
returning `{ needsHuman: { kind, service, instructions, fields } }`; the
`mock.hitl` adapter exercises the full round trip through the real
pipeline (17 new platform checks, 4 new smoke checks, plus
`POST /api/human-steps/:id/resolve|cancel`).

**2. Chat over HTTP lost every reply — fixed.** The server called the
async `command()` router without `await`, so the JSON response serialized
the pending Promise as `{}`: state changes landed, but no reply text ever
reached the browser. The smoke suite only ever asserted state, so it never
caught it. It now asserts the reply body too, and the route awaits. One
line, found by end-to-end testing of the new gate flow.

Also: the requirement registry now carries **170 entries** — the 168
master sections plus #169 (human gates) and #170 (real-money LD economy,
`LOCKED`, unlock path documented in `ROADMAP-REAL-MONEY.md`).

## v1.65 — chat controls the economy, and the owner is protected

Everything below is reachable in plain language from Chat. Nothing here was in
the 168-section master specification (grep-verified): it is additive, and it
keeps the same rules — simulation only, LD never invented, every action audited,
no claim that the build cannot back.

- **Chat is the control surface for all of it.** `help` prints the catalogue of
  what can be said; `preview <command>` shows what a command would do without
  doing it. An intent the platform does not have is answered with guidance, not
  silence, and never with a guess.
- **Every avatar piece costs LD.** One price table (`engagement.PIECE_COST`)
  drives forging (Common 25 → Mythic 2000), loadout provisioning (Common price
  per missing slot), pets (40 LD) and merges (30 → 2400 by band). If a wallet
  cannot pay, the action is refused and the reply names the price and the
  balance. Battle drops stay free and the price list says so.
- **LD is bought and sold in the app.** `buy 500 ld` / `sell 500 ld` post real
  double-entry movements at A$0.01 buy and A$0.0095 sell — a disclosed 5%
  spread, minimum 100 LD, multiples of 10 LD, settlement recorded with the mode
  `SIMULATION`. Real-money purchase, payout and arena settlement remain
  COMPLIANCE-LOCKED behind verified payment authority, licensing and identity
  checks; the refusal says exactly that.
- **Events** (`events`, `join event <id>`, `event progress <id>`, `close event
  <id> winner <name>`) — timed windows, entry fees that land in an Events Pool,
  and a settlement that pays the winner the pool less the disclosed 1% Treasury
  rule.
- **Lotto** (`open lotto round`, `buy 3 lotto tickets`, `draw lotto confirm`,
  `verify lotto`) — 6 from 49, 5 LD a ticket. The server publishes
  `sha256(seed)` when the round opens and reveals the seed only at the draw, so
  the numbers cannot change after tickets are sold; `verify lotto` recomputes
  numbers, lines, sales and allocation from the revealed seed. Sales split 50%
  prize tiers / 30% jackpot / 15% community / the remainder to Treasury, and an
  unwon jackpot or tier carries into the next round. Settlement refuses to post
  unless every LD of sales lands somewhere.
- **Sign-in gifts and task boards** (`sign in`, `daily tasks`, `weekly tasks`,
  `claim task <id>`) — a seven-day cycle of 10/20/35/50/75/110/200 LD that keeps
  a streak across a missed day but restarts after a long gap, plus four daily
  and four weekly tasks drawn deterministically per day/week so the board cannot
  be re-rolled for an easier one. Rewards are paid from funded pools
  (`Rewards Pool`, `Events Pool`, `Lotto Pool`, `Community Pool`, `Jackpot
  Rollover`) and every payment is an audited issuance from `LD Issuance` — no
  silent minting.
- **Multi-tiered subscriptions, personal and business** (`plans`, `upgrade to
  pro`, `change plan business-plus`) — four personal tiers (Free, Plus, Pro,
  Elite) and four business tiers (Business, Business Plus, Enterprise,
  Enterprise Max) with rank, price label, a plain-language blurb and
  entitlements (agents, storage, AI calls/day, seats, API access, guardian
  level, lotto tickets/day, support). Selecting a tier records a local plan and
  changes what the platform *allows*; prices are reference labels, billing is
  not chargeable, and an unknown tier is refused rather than silently becoming
  Free.
- **Owner protection (`owner-security.js` + the Guardian workspace)** — TOTP
  second factor implemented on Node crypto against RFC 6238 (verified against
  the published test vector), recovery codes, session inventory and revocation,
  login/security alerts, re-authentication for sensitive changes, four security
  levels (BASIC → MAXIMUM) with prerequisites, and drills.
- **The guardian charter** — ten published duties every agent owes the owner
  (serve the owner's interest, never self-authorize, protect secrets, report
  honestly, respect boundaries, never act covertly, treat untrusted content as
  data, escalate threats, prefer reversible steps, never leave the charter).
  Every agent action is screened and recorded; an instruction smuggled in from
  external content is refused with the duty named.
- **What protection does not promise.** The threat matrix ships inside the
  product as a named list — 8 COVERED, 4 PARTIAL, 2 OUT-OF-SCOPE — and the
  out-of-scope entries are stated in the product's own words: a compromised
  operating system or hardware, and physical coercion of the owner. The platform
  says plainly that it cannot defend what it does not control, and that real
  money remains compliance-locked rather than merely switched off.

New surfaces: six live workspaces (Events, Lotto, Rewards, LD Market, Plans,
Guardian) and the HTTP endpoints `/api/engagement`, `/api/events`, `/api/lotto`,
`/api/signin`, `/api/quests`, `/api/ldmarket`, `/api/plans`,
`/api/security/owner`, `/api/guardian`.

## v1.64 — specification-completeness tranche

The master specification's normative systems that were previously approximated
(or absent) are now implemented as real, tested subsystems. Nothing was removed
and no capability was faked; where a legitimate bridge does not exist the state
is reported as unavailable.

- **Security kernel (`kernel.js`)** — §9 nine permission states with legal
  transitions, §10 five delegation levels (a non-human actor can never raise its
  own level), §11 bounded act-on-my-behalf delegation, §12 autonomous mode as a
  bounded policy object (never a boolean), §44 twelve ordered policies, §46 signed
  expiring capability tokens bound to agent/device/account/resource/purpose/policy
  version, §51 twelve-factor risk scorer → LOW/MEDIUM/HIGH/CRITICAL/PROHIBITED,
  §52 approval matrix, §55 seven emergency-stop scopes, §56 four emergency levels,
  §96 structured audit records, §118 evidence vault, §148 eight-level authority order.
- **Tool execution pipeline (`platform.runTool`)** — every call now returns its
  §122 manifest, §51 risk assessment, §44 policy decision, §122/§123 structured
  result state, evidence hash, correlation id, §6 failure class and §147 correction
  plan; HIGH/CRITICAL actions stop at the approval gate; PROHIBITED never executes.
  Emergency-stop scopes are enforced per tool before anything runs.
- **Capability & adapter layer (`capabilities.js`)** — §8 capability catalogue,
  §15 eight-method adapter contract, §34–§39 communications/radio/media/screen/
  location/credential systems, §35 sensitive-path classification, §67 provider
  registry, §122/§123 manifests + result contracts, §124 five labelled mock
  adapters (simulation only, `countsAsConnected: false`).
- **Task engine (`task-engine.js`)** — §151 15-state durable task machine, §99
  thirteen result states kept distinct from lifecycle states, §6 nine failure
  classes, §147 correction plans, §149 containment, §101 transaction framework
  (snapshot-or-refuse for irreversible work, verify-before-commit, rollback),
  §153/§160 checkpoints + continuation, §154 human handoff, §5 eleven
  problem-solving stages, §102–§160 eight runnable workflow playbooks.
- **Platform services (`platform-services.js`)** — §40/§104 six device trust states
  with pairing that grants nothing by itself, §41 nine-field replayed-protected
  command envelopes, §105 cross-platform handoff, §107 offline queue, §130–§139
  account lifecycle with fail-closed account resolution and human-required
  boundaries refused, §113 organisations, §114 five plans with server-side
  entitlements (billing refused until billing authority exists), §110 asset
  registry with sha256 provenance + RARITY-100 approval rule, §112 anti-fraud
  (duplicate detection, tx monitoring, rate limits, anomaly signals), §119 metrics/
  spans/correlation ids with OpenTelemetry-shaped export, §126 self-test states,
  §129 release metadata, §117 ten recovery actions.
- **Now genuinely testable systems, not promises**: 44 registry sections carry an
  explicit evidence pointer; `npm test` is the release gate; `npm run build` and
  `npm run lint` are real validation passes with no dependency toolchain.
- **Conversational control added** for all of it: `permissions`, `risk <tool>`,
  `policy <tool>`, `stop network` / `resume network`, `pair device <name>`,
  `trust device …`, `record account service:user`, `plan pro`, `mint asset …`,
  `vault`, `metrics`, `trace <cid>`, `release`, `playbooks`, `run playbook dev-fix`,
  `new task …`, `provision loadout <avatar>`, `arena wager A vs B confirm`.
- **UI:** new live **Devices** and **Evidence** workspaces; Security gained the
  stop-scope controls, risk matrix and policy-decision tester; Permissions shows
  the nine states with suspend/resume/revoke; Status shows release metadata and the
  four-state self-test; Profile carries accounts, organisations and entitlements;
  Spec lists per-section evidence.
- **Economy truthfulness:** `LD_ECONOMY_MODE=simulation`, `LD_AUD_VALUE=0.01`,
  `REAL_MONEY_WAGERING_ENABLED=false`, `ARENA_WAGER_ENABLED=false` are the shipping
  configuration; simulated arena wagers settle 100+100 → winner 198 / treasury 2
  and are labelled SIMULATION. `economyConfig()` exposes the live state.

## v1.63 — UI panels for the new systems + loot selling

- **Automations view (module state flipped truthfully)**: the built-in scheduler runtime means "Connected runtime required" was no longer honest — the module is now `operational` with a live panel: stats, arm-in-plain-language box, active schedules with stop buttons (cadence/fired/next), pending reminders with clear-all.
- **Notifications view**: real event feed (reminder/schedule fires), truth boundary card for external delivery (none connected).
- **Inventory view**: avatar loot with rarity colours, sell-to-marketplace with inline price entry (settles in the labelled simulation ledger).
- **Talents panel in Avatar Studio**: per-avatar talent tree with OWNED / TIER-GATED / NO POINTS / Unlock states, one-click unlock through the audited chat pipeline.
- `/api/state` now carries `reminders`, `schedules`, `notifications`, `avatars`, `talentTree` (additive only).
- Tests: platform 86, arena 28, smoke 45 — all green (a `querySelectorAll` incompatibility with the smoke DOM harness was caught and fixed with delegated click handling).

## v1.62 — recurring cron schedules + avatar talent trees

- **Recurring schedules (real cron)**: `every 2 hours stand up` arms a server-ticked recurring task (30s+ cadences require `confirm`); fires via notification; `schedules` lists cadence/fired-count/next-fire; `stop schedule <id>` cancels. Ticker runs server-side every 15s alongside reminders.
- **Avatar talent trees** (arena-engine): 9 talents in 3 tiers — T1 Hardened Body/Sharpened Mind/Fleetfoot → T2 Bulwark/Wellspring/Hawk Eye → T3 Warlord/Sage/Phoenix. One point per level; tier gating (T2 needs a T1, T3 needs two); effects (`str/vit/int/dex`, `hpFlat`, `mpFlat`, `critBoost`) applied in `derived()` — **server-authoritative, raw stats never mutated (guarded against compounding)**. Public avatars report talents + points; chat intents `talents`, `unlock talent <name> for <avatar>`.
- Battle rewards already grant XP/loot (+/0.6 roll) — talent points flow from real level-ups.
- Intent-order fix: `stop schedule <id>` placed above the generic approval `stop` matcher.
- Tests: platform 81 → **86** (schedule fire/re-arm/cancel), arena 20 → **28** (points math, tier gating, derived-effects, no-mutation, idempotency). Smoke 45 unchanged.

## v1.61 — scheduler, repo file-ops, more live connectors

- **Reminder/notification system**: `remind me in 20 minutes stretch` schedules server-side reminders that tick every 15s even with the chat closed; due reminders become notifications, surfaced in the UI via toast + chat notice (10s poller, watermark-guarded). `reminders` / `clear reminders` intents.
- **GitHub file-ops from chat** (through the LIVE adapter, real Contents API): `github list [path]`, `github read file <path>`, and high-risk `github write <path> | <content>` — approval-gated, SSRF-guarded, audited; shipped end-to-end proof (commit 502dcf23).
- **Approval pipeline completion (bugfix)**: `approve <id>` now actually grants the capability it approved — high-risk commands previously re-queued forever after approval.
- **Hacker News connector**: `news top [n]` via the official API. **Countries connector**: `country <name>` via countries.dev (REST Countries v3.1 deprecated in 2026 and v5 is key-gated — adapter renamed truthfully).
- **Adapters: 18 → 20**; `/api/notifications` endpoint; intent reorder so connector commands beat the broad `status` matcher.
- Tests: platform 71 → **81** (reminder lifecycle, approve-grants-capability, truthful github states). Arena 20, smoke 45 unchanged — all green.

## v1.60 — UI overhaul (ground-up design system)

- **Ground-up visual system rebuilt (`styles.css` rewritten ~10×)**: design tokens (surfaces, lines, elevations, radii, type/mono stacks, accent gradients), ambient scene (violet orbs + blueprint grid, fixed-layer pseudo elements), consistent 12–24px radius/9–70px shadow scales.
- **Sidebar**: glass panel with edge-light, pulsing brand mark, icon-tile nav items with glow-active state and gradient indicator, section labels with hairlines, elevated mode/status strip card.
- **Topbar**: frosted glass with gradient hairline, elevated search pill, avatar with gradient ring.
- **Content**: page heads with gradient display type + eyebrow marker; stat cards with hover lift and edge border animation; pills with glowing dots; module cards with lift + shadow sweep.
- **Chat**: 600px card with header strip, violet gradient user bubbles (tailed), dark local bubbles, notice styling, elevated composer with focus ring + gradient send button, uppercase hint footer.
- **Overlays/toast**: palette with deep blur + glow shadow and icon tiles; facet panel refined; toast becomes a pill with slide-up animation; offline banner restyled amber gradient.
- **Avatar Studio/Arena**: race cards, stat bars (animated gradient fills), avatar hero with radial accent, fight button gradient, battle log line treatments.
- **System touches**: violet `::selection`, custom scrollbars, kbd styling, entrance animation on page content (reduced-motion respected), responsive grid refinement, favicon added.
- Zero functional regressions: platform 71, arena 20, smoke 45 — all green. Version bump: 1.60.0.

## v1.59 — live connectors, verified-state persistence, export/import

- **4 new LIVE connectors (key-free, real data)**: Frankfurter FX (`convert 100 aud to usd`), Wikipedia research (`research <topic>`), Cloudflare DNS-over-HTTPS (`dns <domain>`), local utilities (`hash`, `uuid`, base64, time) — all routed through the guarded SSRF-safe fetch layer.
- **Adapters: 14 → 18**, truth-stated via new `/api/capabilities` endpoint.
- **Connector verification persists**: `verify github` records evidence in state; the github adapter reports `VERIFIED (doomed689)` instead of reverting to CONFIGURED_UNVERIFIED after restarts.
- **Export/import manifests**: `/api/export` emits a `liam.export` manifest (state snapshot + counts; credentials never leave the encrypted store in plaintext); `/api/import` restores only behind explicit `confirm`.
- **`/api/selftest` now reports an `allPass` aggregate** alongside the 7 checks.
- **Hosted on GitHub Pages**: https://doomed689.github.io/WitForge/ serves the static frontend with the honest offline banner when no backend answers.
- Tests: platform 62 → **71** (util round-trips, adapter registry, export/import safety gates). Arena 20, smoke 45 unchanged — nothing removed, only added.

## v1.58 — real Stripe rails, prompt-forged unique gear, 42-slot avatars

- **Real payments, reality-gated**: “connect stripe with token sk_…” stores
  the key AES-256-GCM; “verify stripe” proves it against the real
  `GET /v1/account`; only then can “enable real payments confirm” flip
  REAL-MONEY MODE. Purchases create genuine Stripe Checkout sessions
  (`POST /v1/checkout/sessions`, 1 LD = A$0.01) and LD is credited **only**
  when `GET /v1/checkout/sessions/{id}` returns `payment_status: "paid"`
  (idempotent per session). Until every gate passes, LD stays labelled
  SIMULATION and “create payment” is refused. No fabrication, ever.
- **Proton, told truthfully**: Proton publishes no payment/wallet merchant
  API. “connect proton” answers `NO PUBLIC API` and never simulates a
  connection (spec §165).
- **42-slot avatar architecture**: sided limbs (upper/lower arm, upper/lower
  leg, hands, feet, shoulders — each L and R a separate piece), jewellery
  (necklace, rings, earrings), piercings (brow/nose/lip), tattoos
  (head/torso/arms/legs), plus wings/back/aura/cloak extras. Combat loadout
  gate: weapon, head, torso, both hands, both feet.
- **Prompt forging**: “forge wings at legendary: storm-glass folded from a
  dying aurora” spends LD (Common 25 · Magic 60 · Rare 150 · Legendary 400 ·
  Set 900 · Mythic 2000, debited to a Forge Sink) and produces a piece whose
  SHA-256 fingerprint embeds your prompt — every piece is unique per person.
  Works from Chat or the Avatar Studio Forge console.
- **Marketplace**: fixed-price LD listings with double-entry escrow
  settlement (buyer → seller, ledger sum invariant tested), vendor seed stock,
  delist returns the item. Chat: “market”, “sell <item> for <n>”,
  “buy <id>”, “delist <id>”.
- **Ledger**: LD Issuance (1,000,000), Forge Sink, Marketplace Sink sinks;
  all economy entries double-entry balanced; sum invariant enforced in tests.

## v1.57 — 168-section coverage + plain-language account & connector control

- **Specification Coverage workspace** (`Spec` in SYSTEM): all 168 sections of
  the WitForge master spec with truthful statuses (LIVE / PARTIAL / EXTERNAL /
  LOCKED / POLICY) plus live evidence probes (audit hash-chain, rarity scale,
  legal records, adapter states). `/api/spec/compliance`, `/api/selftest`.
- **Accounts by conversation**: “create owner account NAME password PASS”,
  “login PASS”, “logout”. Owner uses scrypt (N=16384) + HttpOnly SameSite
  sessions; first-run creation closes after the first owner; mutations require
  the session once an owner exists; throttled, audited logins.
- **Connectors by conversation**: “connect <service> with token …” stores the
  secret AES-256-GCM encrypted at rest (never returned by APIs), flips the
  adapter to CONFIGURED_UNVERIFIED, and “verify github” proves it with a real
  API call. “connections” lists services without secrets; “disconnect …”
  destroys the credential.
- **Asset depth**: 1–100 rarity scale with band mapping, piece merging
  (3 same-slot same-band → higher, consumed atomically), pets with generation
  and merging, SHA-256 asset fingerprints with anti-duplication.
- **Hardening**: tamper-evident hash-chained audit with correlation ids,
  scoped expiring HMAC capability tokens, evidence vault, action preview
  (“preview …”), autonomous mode (confirmation-gated), security headers
  (CSP/nosniff/DENY), 120 req/min rate limiting, SUCCEEDED/FAILED/BLOCKED
  result states, 15 versioned legal document records.

## v1.56 — every system live, controlled by conversation

- **Server-authoritative state** (`platform.js` + `data/platform.json`):
  conversations, tasks, projects, agents, memory, knowledge, audit,
  permissions, approvals, emergency state and the LD ledger all live on the
  server. Browser refresh loses nothing.
- **Conversational control surface**: Chat routes UI intents locally and
  platform intents server-side (`/api/command`). “help” lists the surface:
  create/complete tasks, projects, agents, memory, recall, knowledge,
  status/capabilities/security, grant/revoke, emergency states, approve/stop,
  balance/wager/selftest, weather, fetch, file read/write, allowlisted exec.
- **Permission model**: requesting a low/medium-risk capability grants it,
  attributed `user-request` and audited. High-risk actions and LOCKDOWN queue
  in Approvals; `… confirm` or “approve <id>” is your explicit authorization.
- **Real tools / adapters / connectors** (`/api/tools/run`, `/api/state`):
  scoped filesystem (traversal-blocked, SHA-256 evidence), SSRF-guarded HTTP
  (private/loopback/metadata + DNS-rebind blocking, 8s timeout, 20KB cap),
  Open-Meteo weather (real retrieval), allowlisted shell:false executor,
  GitHub REST (real only with GITHUB_TOKEN), Puter.js bridge (browser-loaded,
  output labelled EXTERNAL · UNTRUSTED), Termux/device/Google truthfully
  UNAVAILABLE until genuinely connected.
- **Security shield**: NORMAL/ELEVATED/HIGH/LOCKDOWN with propagation to the
  executor; SSRF and allowlist blocks raise security events; full audit trail.
- **LD economy**: balanced double-entry simulation ledger; wagers escrow with
  1% Treasury; self-test verifies 100+100=200, 198+2, sum invariant,
  negative-balance and unbalanced-entry rejection. Real money stays
  compliance-locked.
- **Live workspaces** for conversations, tasks, projects, agents, memory,
  knowledge, files, tools/adapters, permissions, approvals, security, audit,
  LD coins, status, settings, puter — plus Avatar Studio & Arena (100 races,
  naked starts, server-authoritative battles).

## What was implemented previously (still true)

- **Control-centre shell** matching the screenshots: purple/black theme, LIAM brand
  tile, breadcrumb header, Search (Ctrl K), avatar, `Local mode` status strip.
- **Full cumulative navigation**: CORE · AI · CONTROL · SECURITY · ACCOUNT ·
  COMMERCE · SYSTEM (34 workspaces), persisted collapse (`Ctrl+B`, hamburger),
  icon-only collapsed mode with tooltips, responsive mobile drawer.
- **Capability pages**: truthful state cards — `Capability state`
  (OPERATIONAL / CONFIGURATION REQUIRED / DISCONNECTED / SIMULATION),
  `Data source`, `Control model` — plus the six module surfaces
  (Overview, Configuration, Permissions, Activity, History, Documentation)
  and the Research `Truth & safety` boundary card.
- **Local LIAM store** (browser localStorage): conversations, tasks, projects,
  memory records, audit trail, recent commands, settings. Export and clear
  controls live under Settings → Configuration.
- **Chat**: deterministic local responder (greetings, identity, help, time,
  `open <workspace>`, `new chat`). Anything requiring a model is honestly
  refused and recorded — no fabricated model output.
- **Command palette (Ctrl+K)** with ranked operations, recent-commands surface,
  full keyboard navigation (↑ ↓ ↵ esc).
- **Audit**: every navigation, inspection, chat, config and data action is
  recorded and surfaced in Activity/History facets and the Audit workspace.
- **Server**: static hosting + truthful `/api/health`; the status strip reports
  `linked` / `online` / `offline` from real checks only.

## Growth tranche 51–100 increments covered by this build

- 6  `Ctrl+B` taskbar toggle (persisted).
- 4  Icon-only collapsed navigation with page tooltips.
- 81 Global command search palette with ranked operations.
- 82 Recent commands surface (palette empty state).
- 83 Per-page command actions (module facet controls).
- 84 Universal status strip (Local mode / connectivity / build tag).
- 90 Keyboard-first navigation (palette keys, focus-visible states, esc handling,
     reduced-motion support).

## Truth boundary (unchanged from the lineage)

- No integration is reported connected merely because its adapter exists.
- Research, Models, Puter, GitHub, Termux, Device and Automations remain
  CONFIGURATION REQUIRED / DISCONNECTED until a real provider, credential or
  bridge is connected.
- LD Forge and Marketplace run as visibly labelled SIMULATION until a
  verified Stripe account exists AND the Owner explicitly confirms real
  mode; even then, LD is only credited on Stripe paid-status evidence.
- Proton Wallet: NO PUBLIC API — never simulated, never claimed.
- Provider or model output never grants authority; high-risk actions remain
  approval-gated; the server/local store controls authoritative state.

## Avatar Studio + Arena (Diablo & Skyrim lineage)

- **100 selectable races** (`races.js`) drawn from Skyrim's playable ten, every
  Diablo version's classes/bloodlines, and wider TES/Diablo lore (Akaviri,
  daedra, lycanthropes, atronachs, demons, angels, Dovah…). Each race carries
  base stats, elemental resistances (Dunmer fire 50, Nord frost 50…) and one
  innate racial gift.
- **Naked start**: every avatar is forged with zero equipment and zero items;
  all 42 slots (sided limbs, accessories, piercings, tattoos, extras) show
  empty, grouped in the studio as Body / Arms (L/R) / Legs (L/R) / Jewellery /
  Piercings / Tattoos / Extras / Combat. The `NAKED — UNEQUIPPED` state is displayed
  until loot is found and equipped.
- **Battle engine** (`arena-engine.js`, server-authoritative):
  - Diablo layer — Strength/Dexterity/Intelligence/Vitality, crits, dodge,
    elemental damage & resistances, loot in five rarities
    (Common/Magic/Rare/Legendary/Set) with affix-generated names.
  - Skyrim layer — Health/Magicka/Stamina resources, heavy attacks, use-based
    skill growth (Unarmed, Destruction), racial resistances.
  - Rounds capped at 30 with explicit draw handling; no settlement on draws.
  - Seeded determinism verified on identical fresh state.
- **Loadout gate**: practice brawls are always allowed (naked starts); wager
  matches require both participants to be fully equipped
  (`weapon/head/torso/hand_l/hand_r/foot_l/foot_r`) before any LD moves.
- **Wager matches (v1.64)**: 100 LD each → 200 LD pool → winner 198 LD, treasury
  2 LD (1%), deterministic seed, auditable decision rule at the round cap, true
  draws settle nothing. Real-money wagering stays COMPLIANCE-LOCKED.
- Avatar display renders a stylised SVG base body per race (ears, horns, tails,
  wings, glow) with no clothing layer until items are equipped.

Tests: `node smoke-test.js` (UI) and `node arena-test.js` (engine: 100 races,
naked starts, loadout gate, equip lifecycle, determinism, termination).

## Not yet implemented (next tranche candidates)

These remain truthfully **not implemented** — they require either a real bridge
or a release process this build does not yet have:

- Real provider bridges (Puter.js model runtime, GitHub OAuth device flow,
  Ollama discovery) and the corresponding `EXTERNAL` registry sections.
- OS/device bridges: Android companion, ADB, Shizuku, Accessibility, Apple,
  Windows, ChromeOS, Bluetooth/USB/NFC radio access.
- Chargeable billing and any real-money economy path (COMPLIANCE-LOCKED).
- Multi-user organisation membership (needs the multi-account auth expansion).
- Wrapping *every* tool execution in the transaction framework (the framework
  exists and is tested; it is applied to atomic operations today).
- Browser-engine UI testing and an Android companion integration test.
