# WitForge Compliance Map — what is built vs what is not (§12 boundary)

The rule of this file: **what is listed as built was verified running in the current build; what is not is not.** Declaration is never availability (§144).

Legend: ✅ verified live in this build · 🔶 partial/foundation exists · ⛔ not built (honest declaration)

## Remaining productization work — status at v2.06.0

| §10 item | Status | Where / notes |
|---|---|---|
| Visual Action Center (discovery, inspection, preview, authorization, approval, execution, verification, evidence, cancellation, recovery) | ✅ console surface | `actions` / `action <id>` / `cancel action <id>` / `retry action <id>`, backed by durable envelopes (action-fabric.js). Browser-graphical Action Center UI tab: 🔶 console-complete, GUI tab open. |
| Durable action-envelope persistence + cross-process lifecycle | ✅ v1.99 | `S.envelopes` persisted atomically with platform state; boot `resumeOnBoot()` re-marks stranded EXECUTING/VERIFYING as UNKNOWN (crash-truth §165), retry-legal (UNKNOWN → RECOVERING). |
| Real adapters for full breadth of device/OS/service/enterprise capabilities | 🔶 manufactured fleet | 13 adapters manufactured against spec/ADAPTERS-BASELINE.md (linux · android-adb · accessibility · shizuku · termux · macos · windows · ios · chromeos · bluetooth · usb · nfc · biometric), §15 contract + §122 manifests + §25 controls; linux ops VERIFIED LIVE on this host (cross-source §98); everything else reports DECLARED/UNAVAILABLE until its baseline appears — never faked. |
| Production-grade owner identity/authn, credential brokerage | 🔶 | Vault (AES-256-GCM, machine-bound device key, rotation forensics) ✅; owner login/session ✅; passkeys/WebAuthn + MFA: ⛔. |
| Full Android/Apple/Windows/Linux/ChromeOS execution adapters | 🔶 | Manufactured + baseline-specified (spec/ADAPTERS-BASELINE.md); CONNECTED only where the host exposes the official interface (linux ✅ here; others DECLARED until their hardware appears). |
| Project/agent/autonomy/task persistence + long-running orchestration | 🔶 | Projects, delegations, autonomous policies, scheduler durable tasks ✅; multi-week orchestration with cross-checkpoint resume beyond envelope recovery: 🔶. |
| Self-improvement application, sandboxing, post-change verification | 🔶 | Forge Lab / self-update from the audited repo with backup + gates ✅; post-change behavioral verification against the suite: 🔶 (gates run the suite, semantic diff analysis open). |
| Economy/asset/marketplace/arena (§68–93) | ✅ simulated, labeled | Double-entry ledger, arena wagers, forge/market, lotto, rarity — all run locally and are labeled SIMULATION; real-money rail exists behind REAL-MONEY LOCK (§92) with Stripe evidence-settlement; it requires explicit real-mode enablement and stays off by default. |
| Legal/privacy/terms | ✅ | Versioned legal documents + compliance command (`compliance`, `migrateLegal`); documents are informational, not legal advice (§140). |
| Availability truth in the capability registry | ✅ v1.99 | `capabilities live` separates interface-LIVE vs CONNECTED vs DECLARED per §144. |

## Larger specification areas — honest completeness ledger

✅ **Live and verified:** conversation-to-action router, kernel capability/permission state machine (§9–§10), emergency hierarchy (§55–56), approval matrix (§52), proposal system with execute-command gate (§7/§13 console form), tool manifests + structured results (§122–123), harness/mock adapters (§124 in suites), release gate incl. adversarial suite (§125), health/self-test with PASS/FAIL/WARNING/NOT TESTED vocabulary (§126), semantic versioning + release info (§129), account inventory/lifecycle commands (§134–139), tamper-evident audited hash chain w/ rotation (§96–97), observability spans/correlation-IDs (§119), refunds/recovery of ledger ops, the OVERSEER 13 layers + council of 7 (§43/§48/§50 defensive self-verification), action envelopes + Action Center (§7/§42/§99–101/§151/§153).

🔶 **Foundations present:** browser-automation (playbooks + guarded fetch only, no interactive driver), voice/multimodal input (Puter provider, no STT/TTS UI), organisations (create/subscribe commands; role-based policy matrices open), subscriptions (commands; billing cycles open), GitHub/GitLab-style integrations (GitHub connected; others declared).

⛔ **Not built as operational bridges without an external baseline (declared, never fake-exposed):** The v2.00 fleet manufactures Android/iOS/macOS/Windows/ChromeOS, Accessibility, ADB, Shizuku, Termux, Bluetooth, USB, NFC and biometric adapter contracts, but each remains DECLARED or UNAVAILABLE until its official interface is detected and authorized. Passkey/WebAuthn owner auth, a production OpenTelemetry collector path, public marketplace real-money settlement (§84/§92), and network-fabric peer sync beyond the OAuth receiver remain open productization work. The device-to-device command envelope and replay controls are implemented locally (§41); real cross-device transport still requires paired endpoints.

## Growth rule (§9)

New components enter via adapters + manifests, MUST land with suite coverage, MUST NOT weaken any invariant the gate protects (authority, truthfulness, audit-chain, economy isolation, real-money lock), and MUST be listed here within the same release that ships them.
