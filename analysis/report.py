#!/usr/bin/env python3
"""Regenerate WITFORGE-SPEC-GAP-ANALYSIS.md from the live code.

Every number in the report is re-derived, never trusted:
  * the requirement registry is exported from spec-coverage.js via node;
  * the probe results come from running `node analysis/gap-scan.js --json`;
  * the test counts come from actually running `npm test`;
  * the incomplete/locked lists are generated from the registry itself.

Standard library only — the project carries zero dependencies.
"""
import json
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "WITFORGE-SPEC-GAP-ANALYSIS.md"

# Historical facts about the v1.63 baseline clone (kept as constants —
# they describe the past and must not change when the code does).
BEFORE = {"probes": "1/84 present (baseline clone) → 64/84 after the rebuilt modules",
          "LIVE": 106, "PARTIAL": 15, "EXTERNAL": 23, "LOCKED": 2, "POLICY": 22,
          "tests": "3 suites, 145 checks"}

IMPLEMENTED = """### Security kernel (`kernel.js`)
Nine permission states (`NOT_REQUESTED → REQUESTED → GRANTED → …`), the risk
factor model and `assessRisk`, the approval matrix per risk class, the §44
policy evaluation (`ALLOW / ASK / ESCALATE / DENY`), the §55 stop-scope
registry, and the hash-chained audit + evidence vault primitives.

### Tool execution pipeline (`platform.runTool`)
Every external or risky action flows through one pipeline: stop-scope check →
LOCKDOWN/HIGH gate → policy decision → capability request or approval →
execution → verification → evidence hash → audit → vault. v1.66 adds the
human-gate pause (`WAITING_FOR_HUMAN`) with single-use owner answers.

### Capability layer (`capabilities.js`)
Adapters, platform presence probes, mock adapters (including `mock.hitl`,
which simulates a captcha gate so the pause/resolve/consume round trip is
testable through the real pipeline), and structured-result hashing.

### Task engine (`task-engine.js`)
Failure classification, correction plans, and the §150-adjacent retry rules
(security blocks and policy violations are never auto-retried).

### Platform services (`platform-services.js`)
Observability spans/metrics, the evidence vault, race/arena services, asset
registration with sha256 identity, and the release/manifest surfaces.

### Release engineering
`build.js` (parses every file, checks version agreement, stub-free surfaces,
registry parity), `lint.js` (strict-mode, no-eval, no-shell-interpolation,
server-authority, no-committed-secrets, no-stray-logging, module-surface),
and INSTALL.md as the §128 installation-validation record.

### Test tranche
`spec-test.js` (§125 release areas), `adversarial-test.js` (§150 attack
classes + audit tampering), `platform-test.js`, `arena-test.js`,
`engagement-test.js` and the server-booting `smoke-test.js`.

### Economy truthfulness (`economyConfig()`)
One function reports the real economy configuration; the UI and chat quote it
verbatim. Simulation is stated everywhere; real money stays compliance-locked.

### Conversational + browser control surface
`server.js` is authoritative over one port; `app.js` renders the workspaces
from server state; chat commands and HTTP endpoints call the same platform
functions the tests call. v1.66 fixed the chat HTTP route to await the async
router — replies had been serialized as `{}` since `command()` went async."""


def run(cmd, cwd=ROOT, timeout=600):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        sys.exit("command failed (%s): %s%s" % (" ".join(cmd), r.stdout[-500:], r.stderr[-500:]))
    return r.stdout


def registry():
    out = run(["node", "-p", "JSON.stringify(require('./spec-coverage.js').SECTIONS)"])
    return json.loads(out)


def probes():
    return json.loads(run(["node", "analysis/gap-scan.js", "--json"]))


def test_counts():
    out = run(["npm", "test", "--silent"])
    counts, names = [], ["spec", "adversarial", "platform", "arena", "engagement", "smoke"]
    for line in out.splitlines():
        if "checks completed" in line:
            counts.append(int(line.split()[0]))
    if len(counts) != 6:
        sys.exit("expected 6 suite counts from npm test, got %r" % counts)
    return dict(zip(names, counts)), sum(counts)


def esc(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


def main():
    reg = registry()
    pr = probes()
    suites, total = test_counts()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    status_counts = Counter(r["status"] for r in reg)
    order = ["LIVE", "PARTIAL", "EXTERNAL", "LOCKED", "POLICY"]
    areas = defaultdict(Counter)
    for r in reg:
        areas[r["area"]][r["status"]] += 1
    area_names = sorted(areas)

    probes_by_area = defaultdict(lambda: [0, 0])
    for x in pr["results"]:
        probes_by_area[x["area"]][0] += 1
        if x["present"]:
            probes_by_area[x["area"]][1] += 1

    L = []
    a = L.append
    a("# WitForge — Specification Gap Analysis\n")
    a("**Regenerated by `analysis/report.py` on %s from the live tree** — registry," % now)
    a("probes and test counts in this document are re-derived on every run, so the")
    a("document cannot drift from the code. The historical *before* column describes")
    a("the v1.63 baseline clone and is kept as a recorded constant.\n")
    a("**Authority:** `Witforge.txt` — the definitive master specification")
    a("(168 numbered sections; 27 and 90 are absent from the source text). The")
    a("registry additionally carries platform requirements added after the master")
    a("spec (#169 human gates, #170 real-money economy) and labels them as such.\n")
    a("## 1. Method (and what this document will not do)\n")
    a("1. **Section registry** (`spec-coverage.js`) — every master section and every")
    a("platform addition carries one truthful status:\n")
    a("   * `LIVE` — implemented and covered by tests/probes that run in this repo;")
    a("   * `PARTIAL` — real but bounded (e.g. sandbox scope); the note names the bound;")
    a("   * `EXTERNAL` — a real provider, credential or device must exist first;")
    a("   * `LOCKED` — deliberately gated (compliance); code and docs exist, the authority does not;")
    a("   * `POLICY` — governance enforced in code, docs or both.\n")
    a("2. **Requirement probes** (`gap-scan.js`) — 84 concrete questions answered")
    a("against the live modules, not the documents.")
    a("3. **Tests** — six suites are executed as part of this regeneration.\n")
    a("This document does not claim status changes without a tested code path, and it")
    a("never resolves `EXTERNAL` or `LOCKED` items by writing more code.\n")
    a("## 2. Headline results\n")
    a("| Instrument | Before this tranche | After (regenerated %s) |" % now.split()[0])
    a("|---|---|---|")
    a("| Requirement probes | %s | **%d/%d present** |" % (BEFORE["probes"], pr["present"], pr["total"]))
    for st in order:
        a("| Registry: %s | %d | **%d** |" % (st.title(), BEFORE[st], status_counts.get(st, 0)))
    a("| Test suites | %s | **6 suites, %d checks, 0 failures** |" % (BEFORE["tests"], total))
    a("\nStatus moves are upward only where a real, tested code path exists; nothing is")
    a("downgraded and nothing is removed (additive upgrades only).\n")
    a("### Coverage by area\n")
    a("| Area | " + " | ".join(order) + " |")
    a("|---|" + "---|" * len(order))
    for ar in area_names:
        a("| %s | %s |" % (ar, " | ".join(str(areas[ar].get(st, 0)) for st in order)))
    tot = "| **Total** | " + " | ".join("**%d**" % status_counts.get(st, 0) for st in order) + " |"
    a(tot)
    a("\n### Requirement probes by area\n")
    a("| Area | Probes | Present |")
    a("|---|---|---|")
    for ar in sorted(probes_by_area):
        n, okc = probes_by_area[ar]
        a("| %s | %d | %d |" % (ar, n, okc))
    a("| **Total** | **%d** | **%d** |\n" % (pr["total"], pr["present"]))
    a("## 3. What the tranches implemented\n")
    a(IMPLEMENTED)
    a("\nRelease-by-release history lives in `README.md`; this section records the")
    a("module-level work only.\n")
    a("## 4. What remains truthfully incomplete\n")
    blurb = {
        "EXTERNAL": "A real provider, credential or device must exist before these can move —",
        "LOCKED": "Deliberately gated pending a real-world authority —",
        "PARTIAL": "Real but bounded; the bound is stated —",
        "POLICY": "Governance rules enforced in code and documents —",
    }
    for st in ["EXTERNAL", "LOCKED", "PARTIAL", "POLICY"]:
        rows = [r for r in reg if r["status"] == st]
        a("### %s — %s (%d)\n" % (st, blurb[st].split(" — ")[0], len(rows)))
        a("| # | Title | Boundary / evidence |")
        a("|---|---|---|")
        for r in rows:
            a("| %d | %s | %s |" % (r["n"], esc(r["t"]), esc(r.get("note") or r.get("summary") or "")))
        a("")
    a("## 5. Verification record\n")
    a("Executed during this regeneration (%s):\n" % now)
    a("```text")
    a("node analysis/gap-scan.js --json   → %d/%d probes present" % (pr["present"], pr["total"]))
    for name in ["spec", "adversarial", "platform", "arena", "engagement", "smoke"]:
        a("npm test: %-12s %3d checks" % (name, suites[name]))
    a("npm test total: %d checks, 0 failures" % total)
    a("```\n")
    a("### Adversarial containment (§150)\n")
    a("`adversarial-test.js` (%d checks) exercises the mandated attack classes — audit" % suites["adversarial"])
    a("tampering, sandbox traversal, SSRF, allow-list evasion, credential masking,")
    a("emergency-stop bypass and more — and every probe must contain the attack.\n")
    a("## 6. Full registry — all %d requirements\n" % len(reg))
    a("| # | Title | Area | Status | Summary | Evidence |")
    a("|---|---|---|---|---|---|")
    for r in reg:
        a("| %d | %s | %s | %s | %s | %s |" % (
            r["n"], esc(r["t"]), r.get("area", ""), r["status"],
            esc(r.get("summary") or ""), esc(r.get("evidence") or "")))
    a("")
    a("> Sections 27 and 90 do not exist in the master text; the registry covers the")
    a("> numbered headings that do. Requirements #169 and #170 are platform additions")
    a("> made after the master specification and are labelled as such in `spec-coverage.js`.")
    a("")
    OUT.write_text("\n".join(L))
    print("wrote %s (%d registry entries, %d/%d probes, %d test checks)"
          % (OUT.relative_to(ROOT), len(reg), pr["present"], pr["total"], total))


if __name__ == "__main__":
    main()
