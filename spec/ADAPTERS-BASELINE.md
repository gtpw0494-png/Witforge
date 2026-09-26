# WITFORGE — Device & OS Adapter Baseline Specification (v1.0)

Normative instruction source for `device-adapters.js`. This spec exists so that every adapter targets **one documented official interface set** (the "static common baseline") and reports its operational truth the same way.

## 1. Contract (binding — master spec §15)

Every adapter implements: `manifest` · `discoverCapabilities` · `checkPermission` · `requestPermission` · `executeAction` · `verifyAction` · `revokePermission` · `getStatus`. No adapter expands its own authority; all executions travel the kernel permission state machine (§9/§45).

## 2. Truth labels (binding — master spec §108/§144)

| Label | Meaning |
|---|---|
| **CONNECTED** | baseline interface is present on this host NOW (probe true); ops execute for real and are cross-source-verified (§98). |
| **DECLARED** | baseline absent (portable code, local truth): the adapter answers `UNAVAILABLE` with the probe's evidence and executes nothing — declaration is never availability. |
| **BLOCKED** | permission/security denial — recorded to the offense ledger (UNJUST-REFUSED). |

`getStatus().interfacePresent` is the ONLY path CONNECTED appears; it is re-probed at call time, never cached into UI.

## 3. The baseline table

| Adapter | Platforms | Official interface baseline | Presence probe | Manufactured ops (all read-only unless noted) | Risk | §98 verification |
|---|---|---|---|---|---|---|
| `linux` | Linux | POSIX `/proc`, `uname`, `free`, `df`, DBus (`dbus-send`) | `os.platform()==='linux'` | `sys.facts`, `memory.facts`, `disk.facts`, `dbus.session.list` | medium | **cross-source agreement**: transcript must independently contain `os.release()` and the mapped arch (`x64↦x86_64`); totals match `os.totalmem()` ±5% |
| `android-adb` | Android | Android Debug Bridge (`adb`) | `adb` on PATH | `devices.list`, `device.prop` | high | `devices` table shape; non-empty getprop transcript |
| `android-accessibility` | Android | `uiautomator` over authorized ADB (§21 owner-granted only) | `adb` on PATH | `ui.dump` | high | dump tool's own completion transcript |
| `shizuku` | Android | Shizuku service (visible status, §23) | never true off-device | `status` | high | service transcript |
| `termux` | Android/Termux | Termux env (`PREFIX=com.termux`) + `pm`, `uname` | env probe | `env.facts`, `packages.list` | high | Android/Termux output shape |
| `macos` | macOS | AppleScript (`osascript`), Shortcuts CLI (`shortcuts`) (§26–27) | PATH probes | `osascript.run`, `shortcuts.list` | high | result transcript; refusal strings rejected |
| `windows` | Windows | PowerShell 5/7 read-only CIM cmdlets (no elevation) (§28) | `powershell* | pwsh` on PATH | `os.facts`, `process.count` | high | `Win32_OperatingSystem` Caption; numeric shape |
| `ios` | iOS/iPadOS | libimobiledevice (`idevice_id`) / Shortcuts (§26) | `idevice_id` on PATH | `devices.list` | high | UDID list shape (empty is a truthful result) |
| `chromeos` | ChromeOS | crostini/dbus ChromeOS portal (§30) | **never true off-device** | `portal.query` | medium | portal reply transcript |
| `bluetooth` | Linux/macOS | BlueZ (`bluetoothctl`) (§38) | PATH probe | `controller.status`, `devices.list` | medium | controller block shape (`Powered` state visible) |
| `usb` | Linux | `lsusb` / sysfs `/sys/bus/usb/devices` (§38) | sysfs dir exists | `devices.list` | medium | parseable inventory (empty = truthful) |
| `nfc` | Linux/Android | PC/SC NFC tools (`nfc-list`) (§38) | PATH probe | `readers.list` | medium | tool report transcript |
| `biometric` | multi | **No server-side baseline exists** (§39: platform biometrics return authorization results, never templates) | permanently false here | none executable | high | n/a — permanently DECLARED on server tier |

## 3b. Trust gates (binding — §24/§40/§10/§44, v2.01)

- **§40 device trust is a six-state legal machine** — UNKNOWN · PENDING · TRUSTED · RESTRICTED · REVOKED · LOCKED with an explicit transition table (UNKNOWN→PENDING→TRUSTED → RESTRICTED → REVOKED, LOCKED→UNKNOWN only by confirmation). Every transition is audited; an illegal wish is refused with the legal-children list, never silently coerced. Device-target adapters (`android-adb`/`android-accessibility`/`ios`/`termux`/`shizuku`/`chromeos`) refuse with an UNJUST-REFUSED offense unless the `platform:<adapter>` trust marker is TRUSTED.
- **§24 root states** — NO_ROOT · ROOT_AVAILABLE · ROOT_AUTHORIZED · ROOT_DENIED · UNKNOWN. AVAILABLE/ AUTHORIZED require, respectively, the **real host uid probe** (=`0`) and explicit confirmation; available-root can never be claimed by any other uid (§108).
- **§10 permission levels** surface: `capability levels`; the kernel law `requestLevelChange` denies agent self-elevation (no-self-elevation) and demands an approval record even for the owner at AUTONOMOUS.
- **§44 policy decisions** surface: `policy decisions` lists ALLOW/DENY/ASK/ESCALATE/BLOCK as applied before every execution.

## 4. Execution controls (binding — §22/§25/§53)

- `execFile`-only, `shell:false`, allowlisted binaries per op — no shell-string ever.
- Argument shaping via typed shapers (`SHAPERS`): target ids `[A-Za-z0-9_.:@-]`, package names `com.example.app` form, free-text stripped to safe characters and ≤120 chars. A shaping refusal is an offense (UNJUST-REFUSED), never a best-effort execution.
- Timeouts ≤ 12 s; output capped at 4 KB (128 KB transport buffer); environment filtered to PATH/HOME/TERM/LANG.
- ADB access is high-privilege by rule (§22); Accessibility/ Shizuku/ ChromeOS/ iOS ops demand the §21/§23/§26 owner-visible grant before any use.
- HIGH-risk ops route through the proposal/approval envelope (§52) — `device run <adapter> <op>` for a high-risk op can only proceed after the owner executes the proposal; there is no approval→proposal loop (the executed proposal carries its approval binding).

## 5. Adding an adapter (the law)

1. Add its official interface baseline to the table above in the same commit.
2. Manufacture ops as *typed shapers + allowlisted binaries + §98 verification* — never free-form strings.
3. Its suite entries must assert: manifest complete · contract complete · absent-baseline → `UNAVAILABLE` with null result · shaping refusals recorded.
4. It joins `ROADMAP.md` as 🔶 or ✅ the same release — never earlier.
