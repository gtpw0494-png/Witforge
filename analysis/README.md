# analysis/ — how the specification work in this repository was done

These files are the working instruments behind the v1.64 specification-completeness
tranche. They are kept in the tree so every claim in `README.md`, `STATUS.md` and
`WITFORGE-SPEC-GAP-ANALYSIS.md` can be re-derived rather than trusted.

| File | Purpose | Runnable? |
|---|---|---|
| `WITFORGE-SPEC-GAP-ANALYSIS.md` | The report: method, before/after coverage, what was implemented, what remains EXTERNAL/LOCKED/PARTIAL, and the full registry table (170 requirements) with evidence pointers — regenerated, never hand-edited | read-only (regenerate with `python3 analysis/report.py`) |
| `gap-scan.js` | Requirement-level probes against the live modules. `node analysis/gap-scan.js` (summary) or `--json` | **yes — run any time** |
| `report.py` | Regenerates `WITFORGE-SPEC-GAP-ANALYSIS.md` from `spec-coverage.js` + `gap-scan.js` so the document cannot drift from the code | yes (`python3 analysis/report.py`) |
| `parse-spec.js`, `spec-sections.json` | Parses the uploaded master specification (`Witforge.txt`) into its 166 numbered sections (27 and 90 are absent from the source text) | yes |
| `patch1.js` – `patch3.js` | One-shot migration scripts that applied the v1.64 platform surface (`runTool` pipeline, permission kernel wiring, service surface, exports) | **NO — already applied; re-running would duplicate content** |
| `patch4.js` | One-shot script that added the conversational control intents (permissions/risk/policy/stops/devices/accounts/orgs/plans/assets/playbooks/tasks/arena wager) | **NO — already applied** |
| `patch5.js` | One-shot script that added the v1.64 API surface to `server.js` | **NO — already applied** |
| `patch6.js` | One-shot script that added the Devices/Evidence workspaces and the enriched Security/Permissions/Status/Profile/Spec views to `app.js` | **NO — already applied** |
| `patch7-specview.py` | One-shot script that enriched the Spec view with the v1.64 probe set and per-section evidence | **NO — already applied** |

## Verification commands

```sh
node analysis/gap-scan.js          # 89/89 probed requirements present
npm test                           # 539 checks across six suites, 0 failures
npm run build && npm run lint      # source validation + project lint rules
npm run selftest                   # §126 self-test (PASS/FAIL/WARNING/NOT_TESTED)
python3 analysis/report.py         # regenerate the report
```

## Truthfulness rules used by the instruments

* A requirement counts as **present** only when a code path demonstrably exists —
  never because a document mentions it.
* `EXTERNAL` and `LOCKED` sections are *not* defects to be resolved by writing more
  code; they resolve only when a real provider, credential, device or legal
  authority exists.
* Probe and registry notes name the evidence (module, endpoint, command or test)
  so any reader can re-check a single claim without repeating the whole analysis.

## Provenance notes (v1.66)

* `report.py` was listed in the v1.64 table but its file never reached the
  repository; it was rebuilt in v1.66 against the live instruments and now
  regenerates the whole gap-analysis document (registry export, gap-scan run,
  test counts) so the numbers above cannot drift.
* `patch7-specview.py` enriched the Spec workspace and was applied before the
  upload, but the script itself was never recovered. Its effects are visible
  in `app.js` (Spec view) and `spec-coverage.js`; do not re-apply anything
  claiming to be it without reading those files first.
* The registry now carries 170 requirements: the 168 master-specification
  sections (27 and 90 absent from the source text) plus platform additions
  #169 (human gates, LIVE) and #170 (real-money LD economy, LOCKED).
