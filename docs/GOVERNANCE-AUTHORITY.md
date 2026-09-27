# Policy, approval and autonomy — v0.35–v0.36

## Policy decisions
The local policy engine reports one of `ALLOW`, `DENY`, `ASK`, `ESCALATE`, or `BLOCK` separately from runtime result states.

Default behavior is conservative:
- low-risk bounded local operations may be `ALLOW`;
- source mutation and physical-world execution are `ASK`;
- high risk is `ASK`;
- critical risk is `ESCALATE`;
- downstream adapters retain their own permission and verification checks.

## Approval records
Approval requests are persistent records with an ID, linked task/action IDs, operation, risk, reason, request time, expiry and explicit decision. Expired or already-decided approvals cannot be silently reused.

## Autonomy leases
Autonomy is controlled delegation, not unrestricted execution. A lease binds:
- subject and agent
- exact operation scope
- risk ceiling
- maximum action count
- expiration
- revocation state

A lease does not grant credentials, bypass policy, bypass adapter approval requirements, rewrite security rules, or prove a capability is connected.

## OneChat examples
- `policy high source mutation`
- `show approvals`
- `approve approval-<id>`
- `deny approval-<id>`
- `grant autonomy scope explore,research max 10 60 minutes`
- `show autonomy`
- `revoke autonomy lease-<id>`
