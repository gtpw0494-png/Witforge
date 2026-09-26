# WitForge v1.65 — what was added, and what it honestly is

Every item below is **beyond** the 168-section master specification
(`grep` over `/home/user/uploads/Witforge.txt`: no lotto, events, sign-in gift,
daily/weekly task or subscription-tier requirement exists there; LD appears only
in §85–§88). These are additive features under the standing rules: simulation LD
only, real money compliance-locked, nothing described as working unless a test
exercises it, version + README + STATUS bumped.

| # | The ask | How it exists | Reachable by | Proven by |
|---|---|---|---|---|
| a | All controls and actions in simple-language chat | `platform.command()` routes ~30 v1.65 intents; `CAPABILITY_HELP` prints the catalogue; `/api/command` answers an unmatched intent with guidance and never a guess | `help`, `preview <command>`, and every command named below | engagement-test §8 (13 checks); smoke 53 |
| b | Every avatar piece costs LD | `engagement.PIECE_COST` (Common 25 → Mythic 2000), `PET_COST` 40, `MERGE_COST` 30 → 2400; `chargeLD()` debits the paying wallet into `Forge Sink`; a drop is a gameplay reward and stays free | `forge …`, `summon pet for <name>`, `merge pieces <name> <ids>`, `provision loadout <name>`, `piece prices` | engagement-test §1 (9 checks) |
| c | LD is bought **and sold** in the app | `engagement.LD_MARKET` buy A$0.01 / sell A$0.0095 (5% disclosed spread), min 100, max 100 000, step 10; both sides post real double-entry movements and record mode `SIMULATION`; the real-money path returns COMPLIANCE-LOCKED | `ld market`, `buy 500 ld`, `sell 500 ld`, `/api/ldmarket` | engagement-test §2 (11 checks) |
| d | Creating pieces costs LD | forge / provision / pet / merge all charge the canonical table and refuse with the price *and* the wallet balance when the wallet cannot pay | same as (b) | engagement-test §1 |
| e | Events, lotto, sign-in gifts, daily + weekly tasks | `engagement.js`: 7 seeded events with entry-fee pools and the 1% Treasury rule; lotto 6/49 at 5 LD with `sha256(seed)` published at open and revealed at the draw; 7-day sign-in cycle 10/20/35/50/75/110/200 LD; 4 daily + 4 weekly tasks drawn deterministically per day/week | `events`, `join event <id>`, `event progress <id>`, `close event <id> winner <name>`, `open lotto round`, `buy 3 lotto tickets`, `draw lotto confirm`, `verify lotto`, `sign in`, `daily tasks`, `weekly tasks`, `claim task <id>` | engagement-test §3 (18), §4 (16), §5 (11) |
| f | Multi-tiered subscriptions, personal **and** business | `platform-services.PLANS` = 4 personal (Free/Plus/Pro/Elite) + 4 business (Business/Business Plus/Enterprise/Enterprise Max), each with rank, price label, plain-language blurb and entitlements including `guardian.level` and `lotto.ticketsPerDay`; `comparePlans()` lists what actually changes; an unknown tier is refused instead of quietly becoming Free | `plans`, `upgrade to pro`, `change plan business-plus`, `/api/plans` | engagement-test §6 (13 checks) |
| g | Personal security for the owner, and agents that protect and serve the owner | `owner-security.js`: TOTP per RFC 6238 (verified against the published vector), recovery codes, session inventory + revocation, alerts, re-authentication for sensitive changes, 4 levels BASIC→MAXIMUM with prerequisites, drills; 10 published guardian duties screened on every agent action with recorded decisions | `protect me`, `enable second factor`, `verify second factor <code>`, `sessions`, `revoke all sessions`, `harden my account maximum`, `security drill`, `guardian`, `threats`, `guardian check <action>`, `/api/security/owner`, `/api/guardian` | engagement-test §7 (19 checks) |

## What the owner protection does **not** claim

The 14-threat matrix ships as data (`owner-security.THREATS`), not as marketing:
**8 COVERED · 4 PARTIAL · 2 OUT-OF-SCOPE**. The two it will not pretend to stop
are named in the product's own words:

- `os-compromise` — a compromised operating system or hardware can read and
  change anything this process can, including the audit file. Protection here
  needs an OS/device layer the platform does not control.
- `physical-coercion` — if the owner is coerced into handing over credentials,
  no software control survives that. The platform's answer is honest: recovery
  codes, revocation, alerts and an audit trail that shows what happened after.

`NOT_PROMISED` also states that real money is **compliance-locked rather than
merely switched off** — the gate needs verified payment authority, licensing,
age/identity checks and jurisdictional review before anything charges or pays.

## Money movement rules kept intact

- Every LD reward is paid from a funded pool (`Rewards Pool`, `Events Pool`,
  `Lotto Pool`, `Community Pool`, `Jackpot Rollover`); pool funding is an
  audited issuance from `LD Issuance`, so nothing is minted silently.
- Lotto settlement refuses to post unless `paid + community + treasury +
  rollover = sales`, and the Treasury cut is taken from that round's sales only —
  never from a carry-in.
- An unclaimed jackpot or unclaimed tier prize rolls into the next round; LD
  never disappears and is never kept by the house.
- `LD_ECONOMY_MODE=simulation`, `REAL_MONEY_WAGERING_ENABLED=false`,
  `ARENA_WAGER_ENABLED=false`, `LD_AUD_VALUE=0.01` — unchanged by this release.

## Verification on this tree

```
npm run build   → passed (version identifiers agree; 168 sections registered; no stubs)
npm run lint    → clean, 20 files (11 server modules, 9 client/test files)
npm test        → spec 93 · adversarial 78 · platform 89 · arena 28 · engagement 117 · smoke 53
                  = 458 checks, 0 failures
gap-scan        → 84/84 probed requirements present
selftest        → PASS 22 · FAIL 0 · WARNING 3 · NOT_TESTED 2
```
