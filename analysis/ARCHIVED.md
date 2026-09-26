# analysis/ — archived one-off tooling

Everything in this folder except **`gap-scan.js`** (a live instrument used by
the release gate: 89 requirement probes) is **historical, one-off build
tooling** — `parse-spec.js` extracted the master specification, and
`patch1.js` … `patch9.js` were single-purpose source rewrites used during the
v1.60-era kernel construction. They are kept **for provenance**: the commit
history and these scripts together explain how normative spec text became
`kernel.js` / `capabilities.js` / `spec-coverage.js`.

They are not part of the product, not executed by any runtime path, and must
never be "re-run" against the current source — their targets are frozen
snapshots of 2026-09-18. If you are looking for the live entry points, they
are `server.js`, `platform.js`, `app.js`, and the six test suites.
