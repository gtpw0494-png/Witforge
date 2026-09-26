# WitForge — Installation & Operations Validation

**Applies to:** WitForge `2.07.0` (SQLite/WAL durable-storage build).
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
* **Verified on:** Node `v24.19.0` (the version used for every check in this release).
* Node ≥22.5 uses the built-in SQLite/WAL engine. Node 18/20 remains supported
  through the atomic JSON compatibility engine; no transpiler, package or native
  addon is required.

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
| `PORT` | `8787` | Port the local server binds on `127.0.0.1` by default |
| `WITFORGE_ALLOW_LAN` | `false` | Set to `true` only for intentional LAN exposure; startup also requires `LIAM_API_TOKEN` |
| `WITFORGE_ALLOWED_HOSTS` | *(empty)* | Optional comma-separated additional Host/Origin names for explicitly enabled LAN or reverse-proxy operation; loopback names are always allowed |
| `LIAM_API_TOKEN` | *(unset)* | Required bearer token for private APIs in LAN mode; not needed for loopback-only use |
| `WITFORGE_SESSION_TTL_MS` | `43200000` | Absolute Owner-session lifetime (12 hours; bounded from 15 minutes to 30 days) |
| `WITFORGE_SESSION_IDLE_MS` | `7200000` | Idle Owner-session lifetime (2 hours; bounded from 5 minutes to the absolute lifetime) |
| `WITFORGE_OWNER_EMAIL` | *(unset)* | Private local first-Owner binding. Set this before startup; only a matching email can create the first account. The state stores a one-way hash and masked form, not the plaintext address |
| `WITFORGE_STORAGE` | `auto` | `auto`, `sqlite`, or `json`. Auto uses built-in SQLite where available and otherwise reports/uses the JSON compatibility engine |
| `WITFORGE_SQLITE_PATH` | `<repo>/data/platform.db` | SQLite platform-store path. Set `WITFORGE_STORAGE=sqlite` as well when `PLATFORM_DATA` is explicitly set |
| `PLATFORM_DATA` | `<repo>/data/platform.json` | Legacy import source and stable vault-key base. Explicitly setting it keeps `auto` in JSON compatibility mode for isolated/custom deployments |
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

There is no external database service or package. On Node ≥22.5, the platform
uses Node's built-in SQLite engine with WAL, `synchronous=FULL`, transactional
monotonic revisions and SHA-256-verified primary/last-good state envelopes.
Older supported Node runtimes use the atomic JSON + `.bak` engine.

```bash
# explicit initialization (creates/imports and verifies the selected store)
mkdir -p data
node -e "const P=require('./platform.js'); P.save(); console.log(P.storageInfo())"
npm run recover
```

* On modern Node, first run creates `data/platform.db`; an existing
  `data/platform.json` is imported once only if the database has no state row.
  The JSON source and `platform.json.vault-key` are retained.
* If `platform.db` already exists, starting on a runtime without `node:sqlite`
  fails closed; it never reopens the now-stale legacy JSON source.
* `data/arena.json`, `data/userfiles/`, and `data/quarantine/` remain local and
  are created as needed.
* Schema evolution is **additive and automatic**: the migration ledger is
  idempotent, `load()` back-fills new collections and `migrateLegal()` appends
  missing legal documents. Existing records are never dropped.
* Collections (`DB_COLLECTIONS`, §109): users, sessions, projects, tasks, permissions, capabilityTokens, accounts, devices, agents, memory, knowledge, assets, ledger, transactions, securityEvents, audit, integrations, evidenceVault, orgs, subscriptions, approvals.

## 7. First-run setup

```bash
export WITFORGE_OWNER_EMAIL='your-address@example.com'
npm start
# open http://localhost:8787
```

1. Open **Profile** locally and create the Owner account using the configured email and a strong password. The first matching account becomes Owner server-side; creation is loopback-only and a second Owner cannot be created.
2. Login requires the bound email plus the password. This is a local identifier binding, not a claim that mailbox ownership was externally verified.
3. Optionally connect a real service, e.g. `connect github with token ghp_…`, then `verify github` (a real API call proves it — configuration alone never counts as connected).
4. Nothing else is required. The platform is usable offline; external capabilities report UNAVAILABLE until they genuinely exist.

## 8. Startup

```bash
npm start        # = node server.js   (production/local use)
npm run dev      # = node server.js   (same process; the surface is served live, no watch loop)
node server.js   # equivalent
PORT=9000 node server.js
```

The server binds loopback-only by default and logs:

```
LIAM control centre listening on http://127.0.0.1:8787
```

## 9. Health check

```bash
curl -s localhost:8787/api/health
# {"status":"ok","product":"LIAM","version":"2.07.0","mode":"local","storage":{"engine":"sqlite","journalMode":"wal"},"time":"…"}

npm run health           # same check with an exit code (0 = healthy)
npm run selftest         # §126 internal self-test, PASS/FAIL/WARNING/NOT_TESTED
npm run recover          # read-only database/envelope/audit/vault grading
curl -s localhost:8787/api/selftest   # full structured report
```

Additional verification endpoints: `/api/version` (§129 release metadata),
`/api/spec/compliance` (168-section registry), `/api/observability` (§119),
`/api/evidence` (§118).

## 10. Test commands

```bash
npm test                     # all seven suites, in order
npm run test:spec            # §125 release areas (authentication … failure continuation)
npm run test:storage         # JSON compatibility + SQLite migration/restart/recovery
npm run test:adversarial     # §150 the 13 mandated attack classes + audit tampering
npm run test:platform        # platform core: ledger, SSRF, sandbox, allow-list, approvals
npm run test:arena           # deterministic battle engine, loot, rarity rules
npm run test:smoke           # boots the real server; renders every UI view
npm run build                # source validation pass (no bundler)
npm run lint                 # project lint rules (no dependencies)
```

Expected results on this tree (Node v24.19.0):

| Suite | Checks | Failures |
|---|---|---|
| `spec-test.js` | 99 | 0 |
| `storage-test.js` | 19 | 0 |
| `adversarial-test.js` | 78 | 0 |
| `platform-test.js` | 311 | 0 |
| `arena-test.js` | 33 | 0 |
| `engagement-test.js` | 117 | 0 |
| `smoke-test.js` | 71 | 0 |
| **total** | **728** | **0** |

Tests are isolated: they create their own temporary data directories and never touch a live `data/` store.

## 11. Shutdown

```bash
Ctrl-C            # SIGINT — state was transactionally committed on every mutation
kill <pid>        # SIGTERM — SQLite recovers committed WAL entries on restart
```

There are no background workers: the reminders/schedules ticker is an in-process
`setInterval` inside the server and stops with it. All authoritative state is
already on disk in `data/` before shutdown.

## 12. Upgrade procedure

```bash
# 1. stop the server, grade the store, then back up the complete data directory
npm run recover
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

# 3. preserve the current data directory, then restore the captured store
mv data data-before-rollback-$(date +%Y%m%d-%H%M)
tar xzf witforge-backup-<stamp>.tgz

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
git clone https://github.com/gtpw0494-png/Witforge && cd Witforge
npm install     # no-op
npm run build && npm test
npm run dev     # serves on 127.0.0.1:8787 — open http://127.0.0.1:8787 in the device browser
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
* Platform state is a local transactional envelope, not a normalized relational
  schema or multi-node database. Arena remains an atomic JSON store.
* Owner sessions persist as hashes with absolute/idle expiry; distributed
  session coordination and passkeys/WebAuthn are not implemented.
* Automated UI coverage is the DOM-stub smoke suite, not a real browser engine.

---

*This document is part of the release record. If a command here does not behave as
described on your platform, the document is wrong and should be corrected — not
worked around.*
