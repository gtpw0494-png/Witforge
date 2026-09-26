# ROADMAP-REAL-MONEY.md — unlocking live LD ⇄ AUD the lawful way

**Status of this document:** plan, not legal advice, not a claim. The
real-money economy in WitForge is **COMPLIANCE-LOCKED** (registry #170) and
stays locked until every gate below is evidenced in the tree. Nothing here
changes code behaviour; it sequences what must be true before
`enable real payments confirm` can ever be run honestly.

## Where the platform truthfully is today

| Fact | Value | Where verified |
|---|---|---|
| Economy mode | `SIMULATION` (`LD_ECONOMY_MODE=simulation`) | `economyConfig()` · chat `economy` |
| Peg | A$0.01 per LD — **$1 AUD = 100 LD** | `LD_AUD_VALUE` · `economyConfig()` |
| Spread | 5% disclosed (buy A$0.0100 / sell A$0.0095) | `ldMarketCmd` · ledger postings |
| Real money | `realMode:false`, no Stripe credential, `stripe UNAVAILABLE` | `S.economy` · connectors view |
| Ledger | real double-entry, simulation-labelled; sums invariant-tested every suite | `platform-test` · `engagement-test` |
| Wagers / lotto | LD-only, simulation; settlement refuses to post unless it balances | `arena-test` · `engagement-test` |

The honest core already exists: every buy/sell posts a balanced ledger
movement, every claim is labelled with its mode, and `setRealMode(true)`
already refuses to run without a verified Stripe account and an explicit
user approval. What is missing is everything outside the code.

## The three locks (and what opens each)

### Lock 1 — Legal classification of LD (the long pole)
Sellable-for-AUD points at a published rate are not automatically "loyalty
points". Under Australian law the key question is whether LD is a
**non-cash payment facility (NCPF)** (Corporations Act Ch 7; ASIC RG 121):

- **Path A — limited-purpose / points exemption (preferred).** If LD is
  framed and *operated* as closed-loop product credit — redeemable within
  WitForge, cash-out only as a platform buy-back at the disclosed spread,
  no marketing as money, no interest, no transferable cash-out between
  users — it is likely a limited-purpose facility outside the AFSL regime.
  **Gate:** a written memo from an Australian financial-services lawyer
  confirming the framing, filed in-tree as the #170 evidence pointer.
- **Path B — AFSL / authorised NCPF.** If peer-to-peer cash-out or any
  "money-like" feature is wanted, expect an AFSL (or an arrangement where a
  licensed payment provider, not WitForge, holds funds). **Gate:** licence
  or provider structure documented before any code flips.

Also in scope for the same memo: Australian Consumer Law (refunds, unfair
terms, "LD is not currency" disclosures), Privacy Act handling of KYC data,
and — only if real-money games of chance are ever wanted — the
*Interactive Gambling Act 2001* and state licensing, which this roadmap
**deliberately avoids** (see the red line below).

### Lock 2 — A verified payment provider
The tree already speaks real Stripe language (`connect stripe with token
sk_…` → `verify stripe` → verified evidence in state → approval-gated
`enable real payments confirm`). What is missing is a real Stripe AU
account with live keys and the operator's completed KYC.

- Charges: PaymentIntents with idempotency keys; webhook receipt endpoint
  (signed, replay-protected) as the *only* source of truth for settlement —
  never the redirect.
- Payouts: platform buy-back via Stripe Connect Express payouts, so
  customer funds sit with the licensed provider, not in WitForge's bank
  account.
- Refunds/disputes: refund flow + dispute webhooks mapped to the audit
  chain; ACL-compliant refund handling.

**Gate:** `verify stripe` returns a *verified* real account and one
cent-level live charge is reconciled end-to-end in the ledger (still with
`realMode` off until Lock 1's memo is filed).

### Lock 3 — AML/CTF and operational compliance
- AUSTRAC assessment: enrolment and whether any **designated service**
  applies to the chosen model; if the platform never touches pooled funds
  (provider-held), obligations are materially lighter — the memo decides.
- KYC/AML delegated to Stripe Identity/Connect where possible; sanctions
  screening inherited from the provider.
- Records: AML/CTF Act s287(2) record-keeping mapped onto the existing
  hash-chained audit and evidence vault (they were built for this).
- Limits & monitoring: tiered buy/sell limits, velocity checks, manual
  review queue in the Approvals view, and a kill switch (`stop economy`) —
  all reusing existing stop-scope machinery.

## Engineering sequence once both gates are evidenced

1. `LD_ECONOMY_MODE=real` stays **rejected** until `S.economy.stripeAccount`
   is verified *and* the compliance evidence pointer is present — extend
   `setRealMode` to check both (code change, one line of honesty).
2. **Purchases** (`buy 500 ld`): PaymentIntent created → user pays in
   browser → signed webhook confirms → ledger posts real (unlabelled)
   movement → LD credited. Idempotent per PaymentIntent; refunds reverse
   via mirrored postings.
3. **Buy-backs** (`sell 500 ld`): queue → operator approval (maker-checker
   through the existing approval kernel) → Stripe payout → ledger posts on
   payout confirmation webhook.
4. **Reconciliation job**: daily Stripe balance ↔ ledger accounts
   (`Treasury`, `LD Issuance`, `Marketplace Sink`) must match to the cent or
   the economy self-test fails loudly.
5. **Arena wagers and lotto stay LD-only.** They do not enter real mode in
   this roadmap at all.

## Red lines (unchanged by this roadmap)

- No real-money wagering, lotto or casino-style mechanics without the
  required gambling licences — WitForge keeps those systems in simulation
  and says so.
- No marketing of LD as currency, investment, or store of value.
- No custody of pooled customer funds on WitForge's own books.
- No launch of real mode on a claim: every gate above must be evidenced in
  the tree before `enable real payments confirm` can succeed.

## Indicative effort

| Item | Ballpark |
|---|---|
| Legal memo (AU fintech counsel, classification + ToS + privacy) | ~A$5k–15k, 2–6 weeks |
| Stripe AU account + integration hardening (webhooks, payouts, refunds) | ~2–3 engineering weeks |
| AML/CTF programme + AUSTRAC assessment (provider-held funds model) | ~1–2 weeks parallel |
| Reconciliation + limits + review queue | ~1–2 weeks |
| **Total to a limited real-money launch (buy + platform buy-back only)** | **~6–10 weeks, code-ready today for every step** |

Gambling licensing is intentionally *not* on this timeline.

> Truth rule: until each gate above is evidenced, the platform keeps
> reporting `SIMULATION` and `COMPLIANCE-LOCKED` — which is exactly what it
> does today.
