/* WitForge capability model — §8, §15, §16, §17, §34–§39, §115, §122–§124.
 *
 * The specification defines capability identifiers, an adapter contract, tool
 * manifests, structured tool results and a mock-adapter requirement. This
 * module holds those declarative models so both the executor and the UI read
 * from one source of truth.
 *
 * Honesty rule (§108/§165): declaring a capability never means it works.
 * Every entry carries its truthful state and the legitimate interface it needs.
 */
'use strict';
const crypto = require('crypto');
const os = require('os');

/* ── §8 Capability identifiers ───────────────────────────────────── */

const C = (id, domain, risk, state, iface, desc) => ({ id, domain, risk, state, interface: iface, desc });
const CAPABILITY_CATALOGUE = [
  // communications (§34)
  C('email.read', 'communications', 'MEDIUM', 'EXTERNAL', 'provider API/OAuth', 'Read messages from an authorized mailbox'),
  C('email.search', 'communications', 'MEDIUM', 'EXTERNAL', 'provider API/OAuth', 'Search messages'),
  C('email.compose', 'communications', 'LOW', 'LIVE', 'local model + adapter', 'Compose a message locally (no send)'),
  C('email.draft', 'communications', 'LOW', 'LIVE', 'local store', 'Store a draft for review'),
  C('email.attach', 'communications', 'MEDIUM', 'EXTERNAL', 'provider API', 'Attach a file to a message'),
  C('email.reply', 'communications', 'HIGH', 'EXTERNAL', 'provider API/OAuth', 'Reply on an existing thread'),
  C('email.forward', 'communications', 'HIGH', 'EXTERNAL', 'provider API/OAuth', 'Forward a message'),
  C('email.send', 'communications', 'HIGH', 'EXTERNAL', 'provider API/OAuth', 'Send a message — separate authority from compose'),
  C('email.archive', 'communications', 'MEDIUM', 'EXTERNAL', 'provider API', 'Archive a message'),
  C('email.delete', 'communications', 'HIGH', 'EXTERNAL', 'provider API', 'Delete a message'),
  // calendar
  C('calendar.read', 'calendar', 'MEDIUM', 'EXTERNAL', 'provider API/OAuth', 'Read calendar events'),
  C('calendar.create', 'calendar', 'MEDIUM', 'EXTERNAL', 'provider API/OAuth', 'Create a calendar event'),
  // files (§35)
  C('files.read', 'files', 'LOW', 'LIVE', 'local sandbox', 'Read files inside the sandbox'),
  C('files.create', 'files', 'LOW', 'LIVE', 'local sandbox', 'Create a file'),
  C('files.write', 'files', 'MEDIUM', 'LIVE', 'local sandbox', 'Write or overwrite a file'),
  C('files.rename', 'files', 'MEDIUM', 'LIVE', 'local sandbox', 'Rename a file'),
  C('files.move', 'files', 'MEDIUM', 'LIVE', 'local sandbox', 'Move a file'),
  C('files.copy', 'files', 'LOW', 'LIVE', 'local sandbox', 'Copy a file'),
  C('files.delete', 'files', 'HIGH', 'LIVE', 'local sandbox', 'Delete a file'),
  C('files.share', 'files', 'HIGH', 'EXTERNAL', 'provider/OS share sheet', 'Share a file with another party'),
  C('files.export', 'files', 'LOW', 'LIVE', 'local sandbox', 'Export a file out of the sandbox as evidence'),
  C('files.import', 'files', 'MEDIUM', 'EXTERNAL', 'user upload', 'Import an external file (untrusted until scanned)'),
  // capture (§36)
  C('camera.view', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'See through the camera'),
  C('camera.photo', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Take a photo'),
  C('camera.video', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Record video'),
  C('microphone.record', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Record audio'),
  C('microphone.live', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Live audio stream'),
  C('screen.view', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'View the screen'),
  C('screen.capture', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Take a screenshot'),
  C('screen.record', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Record the screen'),
  C('screen.share', 'capture', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Share the screen'),
  // location (§37)
  C('location.approximate', 'location', 'MEDIUM', 'EXTERNAL', 'OS permission bridge', 'Approximate location'),
  C('location.precise', 'location', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Precise location'),
  C('location.background', 'location', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Background location updates'),
  // radios (§38)
  C('bluetooth.discover', 'radio', 'MEDIUM', 'EXTERNAL', 'OS permission bridge', 'Discover Bluetooth devices'),
  C('bluetooth.connect', 'radio', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Connect to a Bluetooth device'),
  C('usb.device', 'radio', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Interact with a USB device'),
  C('nfc.read', 'radio', 'HIGH', 'EXTERNAL', 'OS permission bridge', 'Read NFC tags'),
  // browser (§17)
  C('browser.navigate', 'browser', 'LOW', 'LIVE', 'guarded http', 'Navigate to a URL'),
  C('browser.inspect', 'browser', 'LOW', 'LIVE', 'guarded http', 'Inspect page content'),
  C('browser.interact', 'browser', 'HIGH', 'EXTERNAL', 'browser automation bridge', 'Click/type/scroll inside a live browser'),
  C('browser.download', 'browser', 'MEDIUM', 'EXTERNAL', 'browser automation bridge', 'Download a file'),
  C('browser.upload', 'browser', 'HIGH', 'EXTERNAL', 'browser automation bridge', 'Upload a file (approval required)'),
  // web (§16)
  C('web.search', 'web', 'LOW', 'EXTERNAL', 'search provider API', 'Search the open web'),
  C('web.retrieve', 'web', 'MEDIUM', 'LIVE', 'guarded http', 'Retrieve a URL with SSRF protection'),
  C('web.submit', 'web', 'HIGH', 'LIVE', 'guarded http (authorized POST)', 'Submit an authorized form/workflow'),
  // media (§115)
  C('media.image.create', 'media', 'LOW', 'EXTERNAL', 'media provider', 'Generate an image'),
  C('media.image.edit', 'media', 'LOW', 'EXTERNAL', 'media provider', 'Edit an image'),
  C('media.video.create', 'media', 'MEDIUM', 'EXTERNAL', 'media provider', 'Generate video'),
  C('media.video.edit', 'media', 'MEDIUM', 'EXTERNAL', 'media provider', 'Edit video'),
  C('media.audio.create', 'media', 'LOW', 'EXTERNAL', 'media provider', 'Generate audio'),
  C('media.audio.edit', 'media', 'LOW', 'EXTERNAL', 'media provider', 'Edit audio'),
  C('media.speech.recognize', 'media', 'MEDIUM', 'EXTERNAL', 'speech provider', 'Speech to text'),
  C('media.speech.synthesize', 'media', 'MEDIUM', 'EXTERNAL', 'speech provider', 'Text to speech'),
  C('youtube.upload', 'media-publish', 'HIGH', 'EXTERNAL', 'YouTube Data API v3 + OAuth', 'Upload a video'),
  C('youtube.publish', 'media-publish', 'HIGH', 'EXTERNAL', 'YouTube Data API v3 + OAuth', 'Change visibility to public — a separate authority from upload'),
  // devices / automation
  C('device.control', 'device', 'HIGH', 'EXTERNAL', 'ADB/Shizuku/companion bridge', 'Control a paired device'),
  C('android.accessibility', 'device', 'HIGH', 'EXTERNAL', 'Android Accessibility service', 'Read/act on the visible Android UI'),
  C('android.intents', 'device', 'MEDIUM', 'EXTERNAL', 'Android intent API', 'Launch Android intents'),
  C('adb.execute', 'device', 'HIGH', 'EXTERNAL', 'ADB', 'Run ADB shell commands on an authorized device'),
  C('shizuku.execute', 'device', 'HIGH', 'EXTERNAL', 'Shizuku', 'Execute through a user-authorized Shizuku session'),
  C('termux.execute', 'device', 'HIGH', 'EXTERNAL', 'Termux runtime', 'Run bounded commands inside Termux'),
  C('apple.shortcuts', 'device', 'MEDIUM', 'EXTERNAL', 'App Intents / Shortcuts', 'Run an Apple Shortcut'),
  C('macos.automation', 'device', 'HIGH', 'EXTERNAL', 'macOS automation APIs', 'Automate macOS apps'),
  C('windows.powershell', 'device', 'HIGH', 'EXTERNAL', 'Windows PowerShell/Win32', 'Run PowerShell on Windows'),
  C('linux.command', 'device', 'MEDIUM', 'LIVE', 'allowlisted executor', 'Run a bounded, allowlisted host operation'),
  // accounts (§130)
  C('account.discover', 'account', 'LOW', 'LIVE', 'local inventory', 'Discover whether a service supports account creation'),
  C('account.create', 'account', 'HIGH', 'EXTERNAL', 'service registration interface', 'Create an account through the official interface'),
  C('account.configure', 'account', 'MEDIUM', 'EXTERNAL', 'service settings API', 'Configure supported account settings'),
  C('account.verify', 'account', 'MEDIUM', 'EXTERNAL', 'provider verification flow', 'Complete a legitimate verification step'),
  C('account.login', 'account', 'HIGH', 'EXTERNAL', 'provider auth flow', 'Authenticate to a service'),
  C('account.logout', 'account', 'MEDIUM', 'LIVE', 'local session store', 'End an authorized session'),
  C('account.recover', 'account', 'HIGH', 'EXTERNAL', 'provider recovery flow', 'Recover access through the provider’s own mechanism'),
  C('account.update', 'account', 'MEDIUM', 'EXTERNAL', 'service profile API', 'Update account details'),
  C('account.disable', 'account', 'HIGH', 'EXTERNAL', 'service account API', 'Disable an account'),
  C('account.delete', 'account', 'CRITICAL', 'EXTERNAL', 'service account API', 'Delete an account (consequential, confirmation required)'),
  C('account.disconnect', 'account', 'MEDIUM', 'LIVE', 'local integration store', 'Disconnect an integration, revoke tokens and grants'),
  // security
  C('security.scan', 'security', 'MEDIUM', 'LIVE', 'local defensive scanner', 'Scan an authorized asset'),
  C('security.remediate', 'security', 'HIGH', 'LIVE', 'local defensive remediation', 'Apply a remediation inside authorized boundaries')
];
const CAPS_BY_DOMAIN = CAPABILITY_CATALOGUE.reduce((acc, c) => { (acc[c.domain] = acc[c.domain] || []).push(c.id); return acc; }, {});

function capabilityRecord(id) {
  return CAPABILITY_CATALOGUE.find(c => c.id === id) || { id, domain: 'unknown', risk: 'HIGH', state: 'UNKNOWN', interface: null, desc: 'Undocumented capability' };
}

/* Domain-specific requirement lists from the master spec. */
const COMMS_CAPABILITIES = ['email.read', 'email.search', 'email.compose', 'email.draft', 'email.send', 'email.reply', 'email.forward', 'email.delete', 'email.archive', 'email.attach'];
const MEDIA_CAPABILITIES = ['media.image.create', 'media.image.edit', 'media.video.create', 'media.video.edit', 'media.audio.create', 'media.audio.edit', 'media.speech.recognize', 'media.speech.synthesize'];
const BROWSER_ACTIONS = ['navigate', 'click', 'type', 'scroll', 'tab-management', 'file-upload', 'file-download', 'page-inspection', 'authenticated-workflow'];
const BROWSER_CREDENTIAL_RULE = { usesCredentialBroker: true, note: 'Credential handling goes through the Credential Broker; raw secrets are never handed to the model when avoidable (§17).' };
const BROWSER_CAPABILITIES_BY_ACTION = {
  navigate: 'browser.navigate', click: 'browser.interact', type: 'browser.interact', scroll: 'browser.interact',
  'tab-management': 'browser.interact', 'file-upload': 'browser.upload', 'file-download': 'browser.download',
  'page-inspection': 'browser.inspect', 'authenticated-workflow': 'browser.interact'
};
const RADIO_CAPABILITIES = ['bluetooth.discover', 'bluetooth.connect', 'usb.device', 'nfc.read'];
const SENSITIVE_CAPTURE = ['camera.view', 'camera.photo', 'camera.video', 'microphone.record', 'microphone.live', 'screen.view', 'screen.capture', 'screen.record', 'screen.share']
  .map(id => ({ id, explicit: true, note: 'Sensitive capability: explicit authorization required, never silently granted (§36).' }));

/* ── §15 Adapter contract ────────────────────────────────────────── */

const ADAPTER_CONTRACT = ['authenticate', 'discoverCapabilities', 'checkPermission', 'requestPermission', 'executeAction', 'verifyAction', 'revokePermission', 'getStatus'];
const ADAPTER_METHODS_OPTIONAL = ['authenticate', 'requestPermission', 'revokePermission']; // not every read-only adapter needs its own auth call

function contractCompliance(adapter) {
  const missing = ADAPTER_CONTRACT.filter(m => typeof (adapter || {})[m] !== 'function');
  return { compliant: missing.length === 0, missing, checked: ADAPTER_CONTRACT.length };
}

/* ── §122 Tool manifest / §123 Tool result ───────────────────────── */

const MANIFEST_FIELDS = ['id', 'version', 'capabilities', 'inputs', 'outputs', 'permissions', 'riskClass', 'platforms', 'authentication', 'verification', 'rollback'];

function toolManifest(def) {
  def = def || {};
  return {
    id: def.id || 'unknown.tool',
    version: def.version || '1.0.0',
    capabilities: def.capabilities || (def.cap ? [def.cap] : []),
    inputs: def.inputs || ['args'],
    outputs: def.outputs || ['result'],
    permissions: def.permissions || (def.capabilities || (def.cap ? [def.cap] : [])),
    riskClass: def.riskClass || String(def.risk || 'MEDIUM').toUpperCase(),
    platforms: def.platforms || ['any'],
    authentication: def.authentication || 'local',
    verification: def.verification || 'structured result + evidence hash',
    rollback: def.rollback || 'none declared'
  };
}

function toolResult(opts) {
  opts = opts || {};
  return {
    status: opts.state || 'UNKNOWN',
    state: opts.state || 'UNKNOWN',
    result: opts.result === undefined ? null : opts.result,
    verification: opts.verification || null,
    evidence: opts.evidence === undefined ? null : opts.evidence,
    error: opts.error === undefined ? null : opts.error,
    correlationId: opts.cid || opts.correlationId || null,
    risk: opts.risk || null,
    policy: opts.policy || null,
    approval: opts.approval || null
  };
}

/* ── §35 File paths: sensitive locations ─────────────────────────── */

const SENSITIVE_PATTERNS = [
  { re: /(^|\/)(\.env|\.env\.[a-z]+)$/i, kind: 'environment-secrets' },
  { re: /(^|\/)(secrets?|credentials?|keys?)(\/|$)/i, kind: 'secret-store' },
  { re: /\.(pem|key|p12|pfx|kdbx)$/i, kind: 'key-material' },
  { re: /(^|\/)(id_rsa|id_ed25519|\.netrc|\.git-credentials)$/i, kind: 'credentials-file' },
  { re: /(^|\/)(shadow|passwd|sudoers)$/i, kind: 'system-account-file' },
  { re: /(^|\/)\.git\/config$/i, kind: 'vcs-credentials' }
];
function classifyPath(p) {
  const s = String(p || '');
  const hit = SENSITIVE_PATTERNS.find(x => x.re.test(s));
  return hit
    ? { path: s, sensitive: true, kind: hit.kind, control: 'additional authorization + read-only default + audit' }
    : { path: s, sensitive: false, kind: 'ordinary', control: 'standard sandbox controls' };
}
const FILE_OPERATIONS = ['read', 'create', 'write', 'rename', 'move', 'copy', 'delete', 'share', 'export', 'import'];
const FILE_OP_CAPABILITY = {
  read: 'files.read', create: 'files.create', write: 'files.write', rename: 'files.rename', move: 'files.move',
  copy: 'files.copy', delete: 'files.delete', share: 'files.share', export: 'files.export', import: 'files.import'
};

/* ── §37 Location modes ──────────────────────────────────────────── */

const LOCATION_MODES = ['approximate', 'precise', 'foreground', 'background'];
function canUpgradeLocation(from, to, authorized) {
  const order = { approximate: 1, precise: 2 };
  const fromRank = order[from] || 1, toRank = order[to] || 1;
  if (toRank > fromRank && authorized !== true) return false; // §37: never silently upgraded
  return true;
}

/* ── §39 Credential stores + biometrics ──────────────────────────── */

const CREDENTIAL_STORES = [
  { id: 'apple-keychain', platform: 'apple', note: 'Apple Keychain' },
  { id: 'android-keystore', platform: 'android', note: 'Android Keystore' },
  { id: 'windows-credman', platform: 'windows', note: 'Windows Credential Manager' },
  { id: 'linux-secret', platform: 'linux', note: 'Linux secret stores (libsecret/kwallet)' },
  { id: 'browser-credential-api', platform: 'web', note: 'Browser credential APIs' },
  { id: 'enterprise-secret-manager', platform: 'server', note: 'Enterprise secret managers' },
  { id: 'host-encrypted-store', platform: 'any', note: 'Host AES-256-GCM store used by this build' }
];
function biometricResult(authorized, method) {
  return { ok: !!authorized, authorization: authorized ? 'AUTHORIZED' : 'REFUSED', method: method || 'platform-biometric', templateIncluded: false, note: 'Biometric operations return an authorization result; raw templates are never exposed (§39).' };
}

/* ── §67 Provider registry ───────────────────────────────────────── */

const PROVIDER_FIELDS = ['discovery', 'execution', 'credentials', 'quotas', 'capabilities', 'costs', 'safetyPolicy'];
function providerRecord(opts) {
  opts = opts || {};
  return {
    id: opts.id || 'provider',
    discovery: opts.discovery || { supported: false, note: 'Model discovery not reported by this provider' },
    execution: opts.execution || { supported: false },
    credentials: opts.credentials || { stored: false, location: 'server-side' },
    quotas: opts.quotas || { known: false, note: 'Quotas are never inferred as local facts (§67)' },
    capabilities: opts.capabilities || [],
    costs: opts.costs || { known: false },
    safetyPolicy: opts.safetyPolicy || 'provider-default',
    note: opts.note || 'A provider is never assumed to support a capability it has not declared.'
  };
}

/* ── §124 Mock / test adapters ───────────────────────────────────── */

/* A mock adapter is a first-class test instrument: it implements the full
 * adapter contract and injects deterministic failure modes so the security
 * boundary, retry, rollback and verification paths can be exercised.
 * It is labelled SIMULATION and can never masquerade as a real integration. */
function mockAdapter(id, behaviour) {
  const state = { connected: false, simulation: true, calls: [] };
  const b = behaviour || 'succeed';
  const self = {
    id, name: 'Mock adapter: ' + id, simulation: true, countsAsConnected: false, behaviour: b,
    authenticate(ok) { state.connected = ok !== false; return { ok: state.connected, simulation: true }; },
    discoverCapabilities() { return [{ id: 'mock.echo', risk: 'LOW', desc: 'Echoes arguments (simulation only)' }]; },
    checkPermission() { return { permission: 'mock.echo', simulation: true }; },
    requestPermission() { return { requested: true, simulation: true }; },
    executeAction() {
      state.calls.push(Date.now());
      if (b === 'auth-failure') return { ok: false, error: 'simulated authorization failure', failureClass: 'AUTHORIZATION_FAILURE' };
      if (b === 'transient-failure') return { ok: false, error: 'simulated transient failure', failureClass: 'RECOVERABLE', retryable: true };
      if (b === 'permanent-failure') return { ok: false, error: 'simulated permanent failure', failureClass: 'IRREVERSIBLE' };
      if (b === 'security-block') return { ok: false, error: 'simulated security block', failureClass: 'SECURITY_BLOCK', blocked: true };
      if (b === 'needs-human') return { ok: false, needsHuman: { kind: 'captcha', service: 'mock.portal', instructions: 'Enter the 4-character code shown by the mock portal', fields: ['code'] } };
      return { ok: true, simulated: true, echoed: true };
    },
    verifyAction() { return { verified: b !== 'verify-failure', simulated: true }; },
    revokePermission() { state.connected = false; return { ok: true, simulation: true }; },
    getStatus() { return { id, behaviour: b, calls: state.calls.length, simulation: true, countsAsConnected: false }; },
    _state: state
  };
  return self;
}
const MOCK_ADAPTERS = [
  mockAdapter('mock.safe', 'succeed'),
  mockAdapter('mock.transient', 'transient-failure'),
  mockAdapter('mock.denied', 'auth-failure'),
  mockAdapter('mock.hostile', 'security-block'),
  mockAdapter('mock.verifyfail', 'verify-failure'),
  mockAdapter('mock.hitl', 'needs-human')
];

/* ── Platform presence probes (§19, §26–§30) ─────────────────────── */

function platformProbes() {
  const p = os.platform();
  return {
    hostPlatform: p,
    probes: [
      { platform: 'linux', present: p === 'linux', bridge: 'allowlisted host executor' },
      { platform: 'android', present: !!process.env.ANDROID_ROOT || !!process.env.TERMUX_VERSION, bridge: 'ADB/Shizuku/Termux/companion' },
      { platform: 'macos', present: p === 'darwin', bridge: 'Shortcuts / macOS automation' },
      { platform: 'windows', present: p === 'win32', bridge: 'PowerShell / Win32 / UI Automation' },
      { platform: 'ios', present: false, bridge: 'App Intents / Shortcuts pairing' },
      { platform: 'ipados', present: false, bridge: 'App Intents / Shortcuts pairing' },
      { platform: 'chromeos', present: false, bridge: 'Chrome / Linux container' },
      { platform: 'web', present: true, bridge: 'this control surface' }
    ],
    note: 'A platform adapter is never reported available merely because the platform exists elsewhere — presence is probed on the host process (§108).'
  };
}

function structuredResultHash(result) {
  return crypto.createHash('sha256').update(JSON.stringify(result === undefined ? null : result)).digest('hex');
}

module.exports = {
  CAPABILITY_CATALOGUE, CAPS_BY_DOMAIN, capabilityRecord,
  COMMS_CAPABILITIES, MEDIA_CAPABILITIES, RADIO_CAPABILITIES, SENSITIVE_CAPTURE,
  BROWSER_ACTIONS, BROWSER_CREDENTIAL_RULE, BROWSER_CAPABILITIES_BY_ACTION,
  ADAPTER_CONTRACT, ADAPTER_METHODS_OPTIONAL, contractCompliance,
  MANIFEST_FIELDS, toolManifest, toolResult,
  SENSITIVE_PATTERNS, classifyPath, FILE_OPERATIONS, FILE_OP_CAPABILITY,
  LOCATION_MODES, canUpgradeLocation,
  CREDENTIAL_STORES, biometricResult,
  PROVIDER_FIELDS, providerRecord,
  mockAdapter, MOCK_ADAPTERS,
  platformProbes, structuredResultHash
};
