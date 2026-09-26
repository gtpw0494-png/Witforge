# WitForge — Installation & Operations Validation

**Applies to:** WitForge `1.73.0` (engagement + owner-protection build).
**Scope:** this document is the §128 installation-validation record. Every command
below was executed against this tree before it was written. Commands that were not
run are marked as such — nothing here is claimed on faith.

---

## 1. Prerequisites

| Requirement | Detail |
|---|---|
| Operating system | Linux, macOS, Windows, **Termux/Android** (§127 first-class dev target) |
| Runtime | Node.js — see §2 |
| Package manager | none required (zero runtime dependencies) |
| Disk | ~5 MB source + the `data/` store (grows with audit/arena/evidence records) |
| Network | **optional**. The platform is local-first; it runs fully offline. Outbound calls exist only through the SSRF-guarded connector tools |
| Ports | one TCP port, default `8787` (`PORT` overrides) |
| Browser | any current browser for the control surface (served by the local server) |

## 2. Supported Node version

* `package.json` declares `"engines": { "node": ">=18.0.0" }`.
* **Verified on:** Node `v20.20.2` (the version used for every check in this document).
* No transpiler, bundler or native addon is used, so any maintained Node ≥18 LTS is expected to work.

```bash
node --version        # must print v18.x or newer
```

## 3. Dependency installation

There are **no runtime dependencies** (`dependencies: {}`, `devDependencies: {}`).
The platform uses Node built-ins only (`http`, `crypto`, `fs`, `path`, `child_process`).

```bash
npm install           # succeeds and installs nothing — that is the intended result
```

> Truthfulness note (§127): `npm install` is **not** claimed to "set up" anything.
> It is a no-op by design. The supply-chain surface is deliberately zero.

## 4. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port the local server binds on `0.0.0.0` |
| `PLATFORM_DATA` | `<repo>/data/platform.json` | Authoritative platform store (state, audit, permissions, devices, accounts, assets) |
| `ARENA_DATA` | `<repo>/data/arena.json` | Arena/avatar/asset store |
| `GITHUB_TOKEN` | *(unset)* | Optional. Without it the GitHub connector reports **UNAVAILABLE** — honestly, not simulated |
| `TERMUX` / `TERMUX_VERSION` | *(unset)* | Detected on Android; enables the Termux capability page |
| `LD_ECONOMY_MODE` | `simulation` | **Must remain `simulation`.** `real` additionally requires verified Stripe authority *and* explicit Owner confirmation, and never activates in this build without them |
| `LD_AUD_VALUE` | `0.01` | Simulation reference rate: 1 LD = A$0.01 (100 LD = A$1.00). Display/reference only |
| `REAL_MONEY_WAGERING_ENABLED` | `false` | **Must remain `false`.** Gates real-money wagering; COMPLIANCE-LOCKED until licensing, age/identity verification and jurisdictional review are satisfied |
| `ARENA_WAGER_ENABLED` | `false` | **Must remain `false`.** Gates *real-money* arena settlement. Simulated LD wagers (the §85 mechanism) stay available and are always labelled SIMULATION |

Inspect the effective configuration at any time:

```bash
curl -s localhost:8787/api/state | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).release))"
```

or in Chat: `economy`.

## 5. Secure configuration

| Control | Implementation |
|---|---|
| Owner account | First-run creation is single-shot; password stored as a salted **scrypt** (N=16384, r=8, p=1) hash — the OWASP-accepted fallback where Argon2id is unavailable in the zero-dependency runtime |
| Sessions | Server-side session table; cookie is **HttpOnly; SameSite=Strict**. No token is ever written to `localStorage` |
| Login throttling | Failed logins are counted, throttled and audited |
| Credentials at rest | **AES-256-GCM** with a per-store key; keys are never returned by any API or log line |
| Secrets in logs | `maskSecrets()` scrubs `sk_*`, `ghp_*`, `token=`, `password=` patterns before audit writes |
| SSRF | Every outbound fetch passes a guard: loopback, RFC1918, link-local/metadata (169.254.169.254), IPv6 loopback and non-HTTP protocols are blocked |
| Filesystem | All file ops are resolved inside the sandbox (`data/userfiles`); traversal, absolute paths and sensitive system paths (`/etc`, `/proc`, SSH/GPG keys, wallets) are classified and refused |
| Command execution | Allow-list executor only (`date`, `uptime`, `df`, … ); no shell interpolation; injection payloads are refused |
| Permission kernel | 9 permission states, 5 levels, 12 scope dimensions, signed expiring capability tokens, 5 risk classes with a 12-factor scorer |
| Approvals | HIGH/CRITICAL actions require an approval record or an explicit scoped autonomous policy; PROHIBITED never executes |
| Emergency stop | 7 stop scopes (task/agent/integration/device/autonomous/network/account) that suspend execution without disabling audit or recovery |
| Boundaries | Human-required steps (CAPTCHA, identity, phone) are refused, never bypassed |

## 6. Database initialization

There is no external database engine; the store is a JSON document per module.

```bash
# explicit initialization (creates the directory and an empty, valid store)
mkdir -p data
node -e "const P=require('./platform.js'); P.save(); console.log('platform store created')"
```

* First run creates `data/platform.json`, `data/arena.json`, `data/userfiles/`, `data/quarantine/` as needed.
* Schema evolution is **additive and automatic**: `load()` back-fills new collections and `migrateLegal()` appends new legal documents on every start. Existing records are never rewritten or dropped.
* Collections (`DB_COLLECTIONS`, §109): users, sessions, projects, tasks, permissions, capabilityTokens, accounts, devices, agents, memory, knowledge, assets, ledger, transactions, securityEvents, audit, integrations, evidenceVault, orgs, subscriptions, approvals.

## 7. First-run setup

```bash
npm start
# open http://localhost:8787
```

1. Open **Profile** (or use Chat) and create the Owner account:
   `create owner account <NAME> password <PASSWORD>` — the first account becomes Owner server-side; a second Owner cannot be created.
2. Optionally connect a real service, e.g. `connect github with token ghp_…`, then `verify github` (a real API call proves it — configuration alone never counts as connected).
3. Nothing else is required. The platform is usable offline; external capabilities report UNAVAILABLE until they genuinely exist.

## 8. Startup

```bash
npm start        # = node server.js   (production/local use)
npm run dev      # = node server.js   (same process; the surface is served live, no watch loop)
node server.js   # equivalent
PORT=9000 node server.js
```

The server binds `0.0.0.0:$PORT` and logs:

```
LIAM control centre listening on http://0.0.0.0:8787
```

## 9. Health check

```bash
curl -s localhost:8787/api/health
# {"status":"ok","product":"LIAM","version":"1.65.0","mode":"local","time":"…"}

npm run health           # same check with an exit code (0 = healthy)
npm run selftest         # §126 internal self-test, PASS/FAIL/WARNING/NOT_TESTED
curl -s localhost:8787/api/selftest   # full structured report
```

Additional verification endpoints: `/api/version` (§129 release metadata),
`/api/spec/compliance` (168-section registry), `/api/observability` (§119),
`/api/evidence` (§118).

## 10. Test commands

```bash
npm test                     # all five suites, in order
npm run test:spec            # §125 release areas (authentication … failure continuation)
npm run test:adversarial     # §150 the 13 mandated attack classes + audit tampering
npm run test:platform        # platform core: ledger, SSRF, sandbox, allow-list, approvals
npm run test:arena           # deterministic battle engine, loot, rarity rules
npm run test:smoke           # boots the real server; renders every UI view
npm run build                # source validation pass (no bundler)
npm run lint                 # project lint rules (no dependencies)
```

Expected results on this tree (Node v20.20.2):

| Suite | Checks | Failures |
|---|---|---|
| `spec-test.js` | 93 | 0 |
| `adversarial-test.js` | 78 | 0 |
| `platform-test.js` | 166 | 0 |
| `arena-test.js` | 28 | 0 |
| `smoke-test.js` | 57 | 0 |
| **total** | **539** | **0** |

Tests are isolated: they create their own temporary data directories and never touch a live `data/` store.

## 11. Shutdown

```bash
Ctrl-C            # SIGINT — exits immediately, no flush needed (state is written on every mutation)
kill <pid>        # SIGTERM — same behaviour
```

There are no background workers: the reminders/schedules ticker is an in-process
`setInterval` inside the server and stops with it. All authoritative state is
already on disk in `data/` before shutdown.

## 12. Upgrade procedure

```bash
# 1. back up first — this is the rollback point
tar czf witforge-backup-$(date +%Y%m%d-%H%M).tgz data/ *.js *.json *.md

# 2. fetch the new source
git pull --ff-only

# 3. dependencies (expected: nothing installed)
npm install

# 4. validate before running
npm run build && npm run lint && npm test

# 5. restart and verify
npm start
curl -s localhost:8787/api/health
curl -s localhost:8787/api/selftest | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).result;console.log(r.counts);process.exit(r.counts.FAIL?1:0)})"
```

Upgrades are additive by contract: no collection, endpoint, tool or capability is
removed; new state fields are back-filled on load; new legal documents are appended.

## 13. Rollback procedure

```bash
# 1. stop the server
kill <pid>

# 2. restore the previous source revision
git checkout <previous-tag-or-commit>

# 3. restore the data store captured before the upgrade
rm -rf data && tar xzf witforge-backup-<stamp>.tgz

# 4. verify the restored build before serving traffic
npm run build && npm test

# 5. confirm integrity of the restored history
curl -s localhost:8787/api/health
node -e "const P=require('./platform.js');console.log(P.verifyAudit(), P.state.audit.length+' audit records')"
```

`verifyAudit()` recomputes the hash chain; if it reports `{ ok: false, brokenAt }`,
the restored store does not match its own history — restore the previous backup
rather than serving a store whose history cannot be proven.

> A newer store opened by an older build is safe (unknown fields are ignored), but
> the older build cannot expose features it does not contain. Restore both the
> source revision **and** the matching data backup for a true rollback.

## 14. Termux / Android notes (§127)

```bash
pkg update && pkg install nodejs git
git clone https://github.com/doomed689/WitForge && cd WitForge
npm install     # no-op
npm run build && npm test
npm run dev     # serves on 0.0.0.0:8787 — open http://127.0.0.1:8787 in the device browser
```

The `termux` capability page reports what is genuinely available on the device;
device bridges (ADB, Shizuku, Accessibility) remain **UNAVAILABLE** until a real one
is connected and trusted through the §40 pairing flow.

## 15. Known limitations (§129)

* External integrations (mail, calendar, messaging, payments, device bridges, model
  providers) are **UNAVAILABLE** until real credentials, permissions and providers
  exist. They are never simulated and never counted as connected.
* Real-money LD economy paths are **COMPLIANCE-LOCKED** (`LD_ECONOMY_MODE=simulation`,
  `REAL_MONEY_WAGERING_ENABLED=false`, `ARENA_WAGER_ENABLED=false`).
* The store is a local JSON document: single-writer by design, no multi-node replication.
* Sessions are in-process; restarting the server invalidates them.
* Automated UI coverage is the DOM-stub smoke suite, not a real browser engine.

---

*This document is part of the release record. If a command here does not behave as
described on your platform, the document is wrong and should be corrected — not
worked around.*
