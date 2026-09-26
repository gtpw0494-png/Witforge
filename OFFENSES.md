# WITFORGE — Offense Ledger Law (v2.00)

Every attempted action against the platform has a truth. Two and only two.

> **UNJUST-REFUSED** — an attempted action without authorization context was contained or refused. The record carries the attempt kind, what was tried, the containing boundary, and an evidence hash. These records prove the walls work (§150: the expected result of adversarial attempts is containment or rejection).

> **JUSTIFIED-AUTHORIZED** — an action that proceeded because the owning human granted it authority through the legal path (owner proposal execution, authenticated session, within-scope capability). Recording these side-by-side prevents one habit: quietly relabelling refusals as successes or successes as approvals. The ledger says what happened, nothing else.

## The record

`state.offenses[]` (last 80, durable, audited):

```json
{ "id": "of1s", "kind": "unauthorized-adapter-execution",
  "detail": "android-adb.devices.list attempted without android.adb.devices",
  "status": "UNJUST-REFUSED",
  "evidenceHash": "ab3f…", "ts": 1789934400000 }
```

## What feeds it (live)

| Source | Justification verdict |
|---|---|
| Adapter execution denied by the kernel permission machine (device-adapters.js) | UNJUST-REFUSED |
| Malformed adapter input refused by typed shaping | UNJUST-REFUSED |
| Owner-executed proposal commands that the router allows | JUSTIFIED-AUTHORIZED (audit-authority lawful execution) |
| Overseer containment-drill forgeries refused | UNJUST-REFUSED (synthetic, labeled, drills are not real offenses — they are verifications §48) |

Read the ledger: **`offenses`** (console command). Every row is an audit line too; scan the chain with `verify audit`.

## The offense doctrine (why this exists)

1. **Offenses are not secrets.** A refused attempt is evidence the boundary works; hiding refusals would mean the wall's strength is unverifiable (§97 audit truth).
2. **Justification is not opinion.** It is the recorded authority context at decision time — permission state + approval binding + session — not a post-hoc story.
3. **No scorekeeping against the owner.** The ledger measures the WALL, not the human. UNJUST rows name the ATTEMPT, not the person.
4. **Rows never delete.** Rotation follows the audit rotation law with hashes anchored (§97).
