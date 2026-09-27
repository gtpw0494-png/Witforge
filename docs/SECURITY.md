# UAI Security Architecture

## Authority invariant

AI proposes. Policy, capability scope, approval and independent security checks authorize.

## Owner identity and login

- Owner authentication is email/password plus a server-side session cookie; legacy bearer-owner tokens are not accepted.
- Passwords are never returned by the API and are not stored in browser storage.
- Password verifiers use scrypt with a random per-owner salt in the local governance database.
- First-run credentials may be supplied through `UAI_OWNER_EMAIL` and `UAI_OWNER_PASSWORD`; the server removes the password variable from its own environment after bootstrap.
- Existing installations require explicit local credential rotation; upgrades never silently overwrite owner credentials.
- Owner credential rotation revokes active owner sessions.
- Cookie-authenticated state changes require the paired CSRF token.

## Control boundaries

- External content has no instruction authority.
- Credentials stay outside model/plugin payloads unless a bounded adapter explicitly injects them.
- Capability registration is not connectivity.
- Plugin registration is not execution.
- Approval binds exact operation, arguments, actor, capability and tool version.
- Autonomy leases are scoped, expiring and revocable.
- Critical/physical/destructive actions require stronger authorization.

## Evidence integrity

v0.43 audit records form a SHA-256 hash chain. Existing legacy audit lines are not rewritten; the first v0.43 record anchors the exact legacy prefix digest. Subsequent tampering is detected by `AuditLog.verify()`.

The HTTP surface exposes `GET /api/audit/verify`.

## Plugin gateway controls

v0.44 routes HTTP plugin execution through a single governed gateway. Before execution it validates the declared operation and input schema, checks passed URL destinations against the manifest allowlist, verifies required runtime capability evidence, evaluates policy, checks exact approval binding when required, optionally consumes a bounded autonomy lease, claims transactional idempotency, and resolves only explicitly allowed secret names.

Sandbox children receive a minimal environment plus only scoped secret values. The host enforces timeout, cancellation and captured-output limits and validates the JSON output schema before returning it. Exact injected secret values are redacted from returned results/stdout/stderr.

Filesystem, network, CPU and memory **hard isolation** remain the responsibility of the configured external sandbox runtime. UAI passes the declared restrictions but does not claim that the Node process itself is a kernel firewall/container boundary.

## Replay protection

Plugin execution supports transactional idempotency:
- identical request/key -> stored result, no second execution;
- different request/same key -> DENIED;
- concurrent duplicate -> BLOCKED.

## Public repository boundary

Tracked files must not include:
- secrets or .env files;
- mutable state databases;
- local knowledge DBs;
- checkpoints/runs/tokenizers;
- vendor data/reference clones.

Authoritative CI scans this boundary.

## Known security work still ahead

- policy-as-data and declarative transition rules;
- full capability checks before every non-plugin external adapter invocation;
- verified hardened OS-level sandbox profiles for plugin filesystem/network/CPU/memory confinement;
- encrypted-at-rest secret storage and rotation beyond the scoped environment-variable broker;
- encrypted-at-rest options;
- systematic dependency/secret scanning;
- stronger identity/session layer for multi-user deployments.
