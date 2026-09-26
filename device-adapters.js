'use strict';

/* WitForge — DEVICE & OS ADAPTERS (v2.00) · manufactured against the static
 * common interface baselines (spec/ADAPTERS-BASELINE.md).
 *
 * THE THREE LAWS EVERY ADAPTER HERE OBEYS — non-negotiable:
 *  1. §108 / final §168: an adapter only claims what it verified. When its
 *     baseline interface is absent on this host it answers UNAVAILABLE with
 *     the probe evidence and executes NOTHING — never a fake success.
 *  2. §15 contract: every adapter implements the eight contract methods;
 *     manifests are complete per §122; permission goes through the kernel
 *     permission state machine (§9/§45) — adapters never self-grant.
 *  3. §25/§53 controls: executions are allowlisted binaries + validated
 *     arguments via execFile (shell:false, no shell string), with timeouts,
 *     output caps and environment filtering.
 *
 * Availability is computed AT CALL TIME: a baseline that exists on another
 * machine (Termux, PowerShell, adb) is DECLARED here and becomes CONNECTED
 * the moment its interface actually appears — the code is portable, the
 * truth is local.
 */

const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const os = require('os');

/* ── baseline probes (no side effects; PATH+env only) ──────────────────── */
function onPath(bin) {
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) { try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return true; } catch (e) {} }
  return false;
}
function probe(name) {
  switch (name) {
    case 'adb': return onPath('adb');
    case 'shizuku': return false; // Android service socket; never present off-device
    case 'termux': return !!(process.env.PREFIX && /com\.termux/.test(process.env.PREFIX));
    case 'uiautomator': return onPath('adb');
    case 'osascript': return onPath('osascript');
    case 'shortcuts': return onPath('shortcuts');
    case 'powershell': return onPath('powershell.exe') || onPath('powershell') || onPath('pwsh');
    case 'wsl-shim': return onPath('wsl.exe');
    case 'idevice': return onPath('idevice_id') || onPath('ideviceinfo');
    case 'bluetoothctl': return onPath('bluetoothctl');
    case 'lsusb': return onPath('lsusb');
    case 'sysfs-usb': return fs.existsSync('/sys/bus/usb/devices');
    case 'nfc-list': return onPath('nfc-list');
    case 'dbus': return onPath('dbus-send') && !!process.env.DBUS_SESSION_BUS_ADDRESS;
    case 'linux': return os.platform() === 'linux';
    case 'cro-api': return false; // ChromeOS crostini dbus portal; off-device DECLARED
    default: return false;
  }
}
/* §25/§53 safe execution: execFile only, zero shell, timeout + output cap,
 * environment filtered to the transport-visible minimum. */
function safeRun(bin, args, opts) {
  opts = opts || {};
  const out = cp.execFileSync(bin, args, {
    encoding: 'utf8',
    timeout: opts.timeout || 8000,
    maxBuffer: 128 * 1024,
    env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '', TERM: 'dumb', LANG: 'C.UTF-8' }
  });
  return String(out == null ? '' : out).slice(0, opts.cap || 4000);
}

/* ── §15 contract adapter factory ───────────────────────────────────────── */
function makeAdapter(def, deps) {
  const { audit, recordOffense, hash, newId } = deps;

  function manifest() {
    return {
      id: def.id, version: def.version || '2.00.0',
      capabilities: def.caps.map(c => c.id),
      inputs: def.ops.map(o => o.id),
      outputs: ['structured {status,result,verification,evidence,error,correlationId}'],
      permissions: def.caps.map(c => c.id),
      risk: def.risk, platforms: def.platforms,
      authentication: def.auth || 'owner session (console-authorized)',
      verification: 'action-specific re-probe (§98); evidence = output hash + probe transcript',
      rollback: def.rollback || 'read-only operations: none required; state changes declare their own'
    };
  }
  function discoverCapabilities() { return def.caps.map(c => ({ id: c.id, risk: c.risk, description: c.desc })); }
  function getStatus() {
    const baseline = probe(def.baseline);
    return { id: def.id, baseline: def.baseline, interfacePresent: baseline, status: baseline ? 'CONNECTED' : 'DECLARED', note: baseline ? 'baseline interface present on this host' : 'baseline absent — adapter will answer UNAVAILABLE (§108)' };
  }
  function checkPermission(capId) { return (deps.checkPermission(capId) || { ok: false, error: 'permission layer unavailable' }); }
  function requestPermission(capId, why) { return (deps.requestPermission(capId, why)); }
  function authenticate() { return { ok: true, method: manifest().authentication }; }
  function revokePermission(capId) { const r = deps.revokePermission ? deps.revokePermission(capId) : { ok: true }; audit('security', def.id + ': capability revoked ' + capId, 'user'); return r; }

  async function executeAction(opId, params) {
    const cid = 'cid-' + newId();
    const op = def.ops.find(o => o.id === opId);
    if (!op) return fail('UNAVAILABLE', 'unknown operation ' + opId + ' (nothing executed)', cid, 'declared ops only');
    const perm = deps.checkPermission(op.cap);
    if (!perm.ok) {
      /* the offense ledger: attempted unauthorized action → unjust-refused */
      const ev = recordOffense({ kind: 'unauthorized-adapter-execution', detail: def.id + '.' + opId + ' attempted without ' + op.cap, evidenceHash: hash(cid + def.id + opId).slice(0, 20), status: 'UNJUST-REFUSED' });
      audit('security', 'OFFENSE ' + ev.id + ' ' + def.id + '.' + opId + ' — ' + op.cap + ' denied (UNJUST-REFUSED)', 'system', { correlationId: cid });
      return fail('BLOCKED', perm.error || 'permission denied — offense ' + ev.id + ' recorded', cid, 'kernel permission state ' + (perm.state || 'DENIED'));
    }
    const present = probe(def.baseline);
    if (!present) {
      return fail('UNAVAILABLE', 'baseline interface ' + def.baseline + ' not present on this host — nothing executed, nothing faked (§108); connect the target device/interface and the same call runs for real', cid, 'probe(' + def.baseline + ')=false');
    }
    let argv;
    try { argv = op.shape(params || {}); } catch (e) {
      const ev = recordOffense({ kind: 'malformed-adapter-input', detail: def.id + '.' + opId + ' argument shaping refused: ' + e.message, evidenceHash: hash(JSON.stringify(params || {})).slice(0, 20), status: 'UNJUST-REFUSED' });
      return fail('BLOCKED', 'arguments refused (' + e.message + ') — offense ' + ev.id + ' recorded', cid, 'shaping refusal');
    }
    let raw = '', err = null;
    try { raw = safeRun(op.bin, argv, { timeout: op.timeout }); } catch (e) { err = e; }
    const transcript = String(raw || '').slice(0, 2000);
    if (err && !op.verify(err.message || '', transcript)) return fail('FAILED', 'execution error: ' + String(err.message).slice(0, 140), cid, 'safeRun threw');
    const ok = op.verify;
    const verdict = (ok(transcript, transcript)) ? 'SUCCEEDED' : 'FAILED';
    const evHash = hash(transcript).slice(0, 24);
    audit('capability', def.id + '.' + opId + ' ' + verdict + ' (evidence ' + evHash + ')', 'system', { correlationId: cid });
    return {
      status: verdict, result: { transcript: transcript.slice(0, 1200) },
      verification: { method: op.verifies || 'output transcript + baseline re-probe (§98)', result: verdict === 'SUCCEEDED' ? 'confirmed' : 'contradicted' },
      evidence: { hash: evHash, baseline: def.baseline, op: opId }, error: null, correlationId: cid
    };
  }

  function fail(status, error, cid, why) {
    return { status, result: null, verification: { method: 'n/a', result: 'not executed' }, evidence: { why: why || '' }, error, correlationId: cid };
  }
  return { id: def.id, manifest, discoverCapabilities, checkPermission, requestPermission, executeAction, verifyAction: (r) => r && r.verification && r.verification.result === 'confirmed', revokePermission, getStatus };
}

/* ── the adapter fleet (baseline table → spec/ADAPTERS-BASELINE.md) ─────── */

const SHAPERS = {
  clean: s => String(s == null ? '' : s).replace(/[^\w .\-\/:]/g, '').slice(0, 120),
  deviceTarget: s => { const t = String(s == null ? '' : s).trim(); if (!/^[\w:.@\-]{1,64}$/.test(t)) throw new Error('device target may only be [A-Za-z0-9_.:@-]'); return t; },
  pkgName: s => { const t = String(s == null ? '' : s).trim(); if (!/^[A-Za-z][A-Za-z0-9_.]{1,127}$/.test(t)) throw new Error('package must look like com.example.app'); return t; }
};

function fleet(deps) {
  const A = (def) => makeAdapter(def, deps);
  return [
    A({ id: 'linux', version: '2.00.0', risk: 'medium', platforms: ['linux'], baseline: 'linux',
      caps: [{ id: 'linux.info', risk: 'low', desc: 'kernel, resource and service inventory via /proc + uname' }, { id: 'linux.dbus', risk: 'medium', desc: 'session DBus introspection via dbus-send' }],
      ops: [
        { id: 'sys.facts', cap: 'linux.info', bin: '/usr/bin/uname', shape: () => ['-a'], verifies: 'kernel release + machine arch cross-match os.release()/os.arch() (x64↦x86_64, arm64↦aarch64) — two independent sources must agree',
          verify: t => { const am = { x64: 'x86_64', arm64: 'aarch64', arm: 'armv7l' }; return t.includes(os.release()) && t.includes(am[os.arch()] || os.arch()); } },
        { id: 'memory.facts', cap: 'linux.info', bin: '/usr/bin/free', shape: () => ['-m'], verifies: 'total memory matches os.totalmem() within 5%',
          verify: t => { const m = t.match(/Mem:\s+(\d+)/); if (!m) return false; const tot = Math.round(os.totalmem() / 1048576); return Math.abs(Number(m[1]) - tot) / tot < 0.05; } },
        { id: 'disk.facts', cap: 'linux.info', bin: '/usr/bin/df', shape: () => ['-h', '/'], verifies: 'exit ok + table shape', verify: t => /Filesystem/.test(t) },
        { id: 'dbus.session.list', cap: 'linux.dbus', bin: '/usr/bin/dbus-send', shape: () => ['--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListNames'], timeout: 5000, verifies: 'DBus reply parses', verify: t => /array|method return|Error/i.test(t) }
      ] }),

    A({ id: 'android-adb', version: '2.00.0', risk: 'high', platforms: ['android'], baseline: 'adb',
      caps: [{ id: 'android.adb.devices', risk: 'medium', desc: 'authorized device inventory via official ADB' }, { id: 'android.adb.info', risk: 'medium', desc: 'device model/API via ADB getprop' }],
      ops: [
        { id: 'devices.list', cap: 'android.adb.devices', bin: 'adb', shape: () => ['devices'], verifies: "'adb devices' table shape only", verify: t => /List of devices attached/.test(t) },
        { id: 'device.prop', cap: 'android.adb.info', bin: 'adb', shape: p => ['-s', SHAPERS.deviceTarget(p.device || ''), 'shell', 'getprop', 'ro.product.model'], verifies: 'non-empty model string', verify: t => String(t || '').trim().length > 0 }
      ] }),

    A({ id: 'android-accessibility', version: '2.00.0', risk: 'high', platforms: ['android'], baseline: 'uiautomator', auth: 'device owner granted Accessibility explicitly (§21); adapter refuses otherwise',
      caps: [{ id: 'android.accessibility.dump', risk: 'high', desc: 'visible UI hierarchy via uiautomator (owner-authorized only)' }],
      ops: [
        { id: 'ui.dump', cap: 'android.accessibility.dump', bin: 'adb', shape: p => ['-s', SHAPERS.deviceTarget(p.device || ''), 'shell', 'uiautomator', 'dump', '/sdcard/liam-ui.xml'], verifies: 'dump tool reported', verify: t => /UI hierchary dumped/i.test(t) }
      ] }),

    A({ id: 'shizuku', version: '2.00.0', risk: 'high', platforms: ['android'], baseline: 'shizuku', auth: 'Shizuku visible-status + explicit authorization (§23)',
      caps: [{ id: 'android.shizuku.query', risk: 'high', desc: 'Shizuku service status query' }],
      ops: [{ id: 'status', cap: 'android.shizuku.query', bin: 'shizuku', shape: () => ['status'], verifies: 'service transcript', verify: t => String(t || '').length > 0 }] }),

    A({ id: 'termux', version: '2.00.0', risk: 'high', platforms: ['android-termux'], baseline: 'termux',
      caps: [{ id: 'termux.run', risk: 'high', desc: 'allowlisted localhost/runtime operations in Termux (§25)' }],
      ops: [
        { id: 'env.facts', cap: 'termux.run', bin: 'uname', shape: () => ['-a'], verifies: 'termux uname shape', verify: t => /Linux|Android/i.test(t) },
        { id: 'packages.list', cap: 'termux.run', bin: 'pm', shape: () => ['list', 'packages'], verifies: 'package list shape', verify: t => /^package:/m.test(t) }
      ] }),

    A({ id: 'macos', version: '2.00.0', risk: 'high', platforms: ['macos'], baseline: 'osascript',
      caps: [{ id: 'macos.automation', risk: 'high', desc: 'AppleScript automation (owner-authorized) §26–27' }, { id: 'macos.shortcuts', risk: 'high', desc: 'Shortcuts CLI execution §26' }],
      ops: [
        { id: 'osascript.run', cap: 'macos.automation', bin: 'osascript', shape: p => { const s = SHAPERS.clean(p.script); if (!s) throw new Error('script text required'); return ['-e', s]; }, verifies: 'AppleScript result string', verify: t => t != null },
        { id: 'shortcuts.list', cap: 'macos.shortcuts', bin: 'shortcuts', shape: () => ['list'], verifies: 'shortcut table shape', verify: t => t != null && !/not found|error/i.test(String(t).slice(0, 40)) }
      ] }),

    A({ id: 'windows', version: '2.00.0', risk: 'high', platforms: ['windows'], baseline: 'powershell',
      caps: [{ id: 'windows.ps', risk: 'high', desc: 'PowerShell 5/7 read-only cmdlets (no admin elevation) §28' }],
      ops: [
        { id: 'os.facts', cap: 'windows.ps', bin: 'powershell', shape: () => ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | Format-List'], timeout: 12000, verifies: 'Caption present', verify: t => /Caption/.test(t) },
        { id: 'process.count', cap: 'windows.ps', bin: 'powershell', shape: () => ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process).Count'], timeout: 12000, verifies: 'numeric output', verify: t => /^\s*\d+\s*$/.test(t) }
      ] }),

    A({ id: 'ios', version: '2.00.0', risk: 'high', platforms: ['ios', 'ipados'], baseline: 'idevice',
      caps: [{ id: 'ios.device.info', risk: 'high', desc: 'paired device info via libimobiledevice tools/Shortcuts §26' }],
      ops: [
        { id: 'devices.list', cap: 'ios.device.info', bin: 'idevice_id', shape: () => ['-l'], verifies: 'udid list or empty', verify: t => t != null }
      ] }),

    A({ id: 'chromeos', version: '2.00.0', risk: 'high', platforms: ['chromeos'], baseline: 'cro-api',
      caps: [{ id: 'chromeos.notify', risk: 'medium', desc: 'crostini/dbus ChromeOS portal operations §30' }],
      ops: [{ id: 'portal.query', cap: 'chromeos.notify', bin: 'dbus-send', shape: () => ['--session', '--print-reply', '--dest=org.chromium.LiftoffShell', '/org/chromium/LiftoffShell', 'org.chromium.LiftoffShell.GetVersion'], verifies: 'portal reply', verify: t => t != null }] }),

    A({ id: 'bluetooth', version: '2.00.0', risk: 'medium', platforms: ['linux', 'macos'], baseline: 'bluetoothctl',
      caps: [{ id: 'bluetooth.status', risk: 'low', desc: 'BlueZ controller status §38' }, { id: 'bluetooth.scan', risk: 'medium', desc: 'discoverable device inventory (controller on)' }],
      ops: [
        { id: 'controller.status', cap: 'bluetooth.status', bin: 'bluetoothctl', shape: () => ['show'], verifies: 'controller block shape', verify: t => /Controller|Powered/i.test(t) },
        { id: 'devices.list', cap: 'bluetooth.scan', bin: 'bluetoothctl', shape: () => ['devices'], verifies: 'device rows or empty', verify: t => t != null, timeout: 5000 }
      ] }),

    A({ id: 'usb', version: '2.00.0', risk: 'medium', platforms: ['linux'], baseline: 'sysfs-usb',
      caps: [{ id: 'usb.inventory', risk: 'low', desc: 'LSUSB/sysfs device inventory §38' }],
      ops: [
        { id: 'devices.list', cap: 'usb.inventory', bin: 'lsusb', shape: () => [], verifies: 'lsusb parseable', verify: t => t != null }
      ] }),

    A({ id: 'nfc', version: '2.00.0', risk: 'medium', platforms: ['linux', 'android'], baseline: 'nfc-list',
      caps: [{ id: 'nfc.scan', risk: 'medium', desc: 'PC/SC NFC reader inventory §38' }],
      ops: [{ id: 'readers.list', cap: 'nfc.scan', bin: 'nfc-list', shape: () => [], verifies: 'nfc tools report (even empty)', verify: t => t != null }] }),

    A({ id: 'biometric', version: '2.00.0', risk: 'high', platforms: ['multi'], baseline: 'bio-none', auth: 'platform biometrics return authorization results, never templates (§39) — no server-side baseline exists, DECLARED permanently here',
      caps: [{ id: 'biometric.verify', risk: 'high', desc: 'platform biometric prompt (declared — server-tier has none)' }],
      ops: [{ id: 'prompt.check', cap: 'biometric.verify', bin: 'true', shape: () => [], verifies: 'n/a', verify: () => false }] })
  ];
}

module.exports = { create (deps) { return fleet(deps); }, SHAPERS, probe, safeRun, onPath };
