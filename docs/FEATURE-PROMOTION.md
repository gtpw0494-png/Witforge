# Feature promotion and truth gate

UAI does not equate source presence with verified functionality.

## Maturity states

- `DECLARED`: architecture or requirement only.
- `IMPLEMENTED_UNVERIFIED_REPO`: implementation exists and may have local evidence, but the synchronized repository has not yet passed its authoritative CI gate.
- `EXPERIMENTAL`: executable implementation exists but is intentionally outside production guarantees.
- `PARTIAL`: some required behavior is implemented and tested; known required behavior remains absent.
- `VERIFIED`: implementation paths exist in the repository, executable tests cover the feature, and repository CI passes against the exact commit proposed for promotion.
- `UNAVAILABLE`: no truthful executable implementation exists in the current environment/build.
- `BLOCKED`: implementation or execution is prevented by policy, dependency, hardware, legal/licensing, or another explicit boundary.

## Promotion rule

A feature may be described as fully implemented on `main` only when its registry state is `VERIFIED`.

Code on a development branch is insufficient evidence by itself.

Every `VERIFIED` feature must have:
1. one or more concrete implementation paths;
2. one or more executable test references;
3. passing CI on the exact repository commit;
4. no failed privacy/integrity/security gate that invalidates the claim.

If implementation changes materially, the feature must leave `VERIFIED` until the new implementation passes the gate again.

## Main branch rule

`main` remains the last known-good cumulative checkpoint. A pull request may remain open or draft indefinitely without changing `main`. Merge readiness is a consequence of evidence, not development completeness claims.

## Release metadata consistency

Promotion candidates must keep these three values aligned:

- `package.json.version`
- `governance/feature-evidence.json.generated_for`
- `release-manifest.json.version`

The feature-evidence validator rejects package/evidence version drift. Authoritative CI independently rebuilds the release manifest and rejects byte-level manifest drift. A manifest refresh is metadata maintenance only and does not substitute for implementation or behavioral verification.

