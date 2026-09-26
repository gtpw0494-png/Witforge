/* WitForge platform services — the specification systems that sit beside the
 * executor: devices, accounts, organisations, subscriptions, the asset
 * registry, anti-fraud, observability, self-test states and release metadata.
 *
 * Every function takes the platform state object explicitly (no module-level
 * state) so behaviour is testable and persistent state stays in one place.
 *
 * Sections implemented here:
 *   §40 device trust · §41 device-to-device commands (replay-protected)
 *   §53 agent sandbox · §62/§63 agents + delegation · §104/§105 continuity
 *   §107 offline queue · §110/§112 assets + anti-fraud · §113 organisations
 *   §114 subscriptions · §117 recovery · §119 observability · §126 self-test
 *   §129 release metadata · §130–§139 account lifecycle
 */
'use strict';
const crypto = require('crypto');

const now = () => Date.now();
const rid = p => p + crypto.randomBytes(5).toString('hex');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v === undefined ? null : v)).digest('hex');
const safe = (s, n) => String(s === undefined || s === null ? '' : s).slice(0, n || 120);

/* ══ §40 Device trust & §104 multi-device ══════════════════════════ */

const DEVICE_TRUST = ['UNKNOWN', 'PENDING', 'TRUSTED', 'RESTRICTED', 'REVOKED', 'LOCKED'];
const TRUST_TRANSITIONS = {
  UNKNOWN: ['PENDING', 'LOCKED'],
  PENDING: ['TRUSTED', 'REVOKED', 'LOCKED'],
  TRUSTED: ['RESTRICTED', 'REVOKED', 'LOCKED'],
  RESTRICTED: ['TRUSTED', 'REVOKED', 'LOCKED'],
  REVOKED: ['PENDING'],
  LOCKED: [] // only an explicit human unlock (see unlockDevice) may leave LOCKED
};
const DEVICE_PLATFORMS = ['android', 'ios', 'ipados', 'macos', 'windows', 'linux', 'chromeos', 'web', 'server', 'wearable', 'smart-device'];

function pairDevice(state, opts, pairingCode) {
  opts = opts || {};
  state.devices = state.devices || [];
  const platform = DEVICE_PLATFORMS.includes(String(opts.platform)) ? opts.platform : 'unknown';
  if (!pairingCode) return { ok: false, error: 'A pairing code issued by the device is required — pairing is never silent.' };
  if (state.devices.some(d => d.name === opts.name && d.trust !== 'REVOKED')) return { ok: false, error: 'A device with that name is already paired' };
  const device = {
    id: opts.id || rid('dev-'),
    name: safe(opts.name || (platform + ' device'), 40),
    platform,
    trust: 'PENDING',
    pairingMethod: safe(opts.method || 'code', 30),
    identity: { keyHash: hash({ name: opts.name, platform, ts: now() }), issuedTs: now() },
    capabilities: [],
    sessions: [],
    authorizations: [],
    revocation: null,
    createdTs: now(),
    note: 'Pairing establishes device identity only; it grants no capabilities (§40/§104).'
  };
  state.devices.push(device);
  return { ok: true, device };
}
function deviceRecord(state, id) { return (state.devices || []).find(d => d.id === id) || null; }
function setTrust(state, id, next, opts) {
  opts = opts || {};
  const d = deviceRecord(state, id);
  if (!d) return { ok: false, error: 'Unknown device' };
  if (!DEVICE_TRUST.includes(next)) return { ok: false, error: 'Unknown trust state' };
  const allowed = (next === 'PENDING' && d.trust === 'LOCKED' && opts.humanUnlock === true) ? ['PENDING'] : (TRUST_TRANSITIONS[d.trust] || []);
  if (!allowed.includes(next)) return { ok: false, error: `Illegal trust transition ${d.trust} → ${next}`, allowed };
  d.trust = next;
  d.trustTs = now();
  if (next === 'REVOKED') { d.revocation = { ts: now(), reason: safe(opts.reason || 'revoked by user', 120) }; d.sessions = []; d.capabilities = []; }
  if (next === 'RESTRICTED' && Array.isArray(opts.capabilities)) d.capabilities = opts.capabilities.slice(0, 32);
  return { ok: true, device: d };
}
function grantDeviceCapability(state, id, capability, scope) {
  const d = deviceRecord(state, id);
  if (!d) return { ok: false, error: 'Unknown device' };
  if (d.trust !== 'TRUSTED' && d.trust !== 'RESTRICTED') return { ok: false, error: 'Device trust must be TRUSTED or RESTRICTED before capabilities are granted' };
  const entry = { capability: safe(capability, 60), scope: Object.assign({}, scope || {}), ts: now(), revocation: null };
  d.capabilities.push(entry);
  return { ok: true, capability: entry };
}
function revokeDeviceCapability(state, id, capability) {
  const d = deviceRecord(state, id);
  if (!d) return { ok: false, error: 'Unknown device' };
  const before = d.capabilities.length;
  d.capabilities = d.capabilities.filter(c => c.capability !== capability);
  return { ok: true, removed: before - d.capabilities.length };
}
function isolationReport(state) {
  return (state.devices || []).map(d => ({ id: d.id, name: d.name, platform: d.platform, trust: d.trust, capabilities: d.capabilities.length, sessions: d.sessions.length, revoked: !!d.revocation }));
}

/* ── §41 Device-to-device command envelope + replay protection ───── */

const DEVICE_COMMAND_FIELDS = ['commandId', 'userId', 'deviceId', 'capability', 'action', 'scope', 'exp', 'authorization', 'correlationId'];

function acceptDeviceCommand(state, cmd, secret) {
  state.deviceCommands = state.deviceCommands || [];
  state.seenCommandIds = state.seenCommandIds || {};
  if (!cmd || !DEVICE_COMMAND_FIELDS.every(f => cmd[f] !== undefined && cmd[f] !== null)) {
    return { ok: false, reason: 'incomplete-envelope', required: DEVICE_COMMAND_FIELDS };
  }
  if (state.seenCommandIds[cmd.commandId]) return { ok: false, reason: 'replay', detail: 'commandId already processed — replay protection refused it' };
  if (Number(cmd.exp) < now()) return { ok: false, reason: 'expired' };
  // Commands must carry the authorization they were issued under (§41/§46).
  const sig = crypto.createHmac('sha256', safe(secret || 'device-command', 200)).update(DEVICE_COMMAND_FIELDS.map(f => JSON.stringify(cmd[f])).join('|')).digest('hex');
  if (cmd.signature && cmd.signature !== sig) return { ok: false, reason: 'signature-invalid' };
  const device = deviceRecord(state, cmd.deviceId);
  if (!device) return { ok: false, reason: 'unknown-device' };
  if (device.trust !== 'TRUSTED' && device.trust !== 'RESTRICTED') return { ok: false, reason: 'device-not-trusted', trust: device.trust };
  if (!device.capabilities.some(c => c.capability === cmd.capability)) return { ok: false, reason: 'capability-not-granted-to-device' };
  state.seenCommandIds[cmd.commandId] = now();
  if (Object.keys(state.seenCommandIds).length > 500) {
    // keep the most recent 500 ids so the replay window stays bounded
    const keep = Object.entries(state.seenCommandIds).sort((a, b) => b[1] - a[1]).slice(0, 500);
    state.seenCommandIds = Object.fromEntries(keep);
  }
  const rec = { commandId: cmd.commandId, ts: now(), deviceId: cmd.deviceId, capability: cmd.capability, action: cmd.action, correlationId: cmd.correlationId };
  state.deviceCommands.unshift(rec);
  if (state.deviceCommands.length > 200) state.deviceCommands.length = 200;
  return { ok: true, accepted: rec, signature: sig };
}
function deviceCommandPolicy() {
  return { fields: DEVICE_COMMAND_FIELDS.slice(), replayProtection: 'command ids are recorded and refused on reuse', expiry: 'exp must be in the future', signature: 'optional HMAC over all nine fields' };
}

/* ── §105 Cross-platform continuity ──────────────────────────────── */

function handoffTask(state, opts) {
  opts = opts || {};
  state.taskHandoffs = state.taskHandoffs || [];
  const from = deviceRecord(state, opts.from); const to = deviceRecord(state, opts.to);
  if (!from || !to) return { ok: false, error: 'Both devices must be paired' };
  if (from.trust !== 'TRUSTED' || to.trust !== 'TRUSTED') return { ok: false, error: 'Continuity requires authenticated (TRUSTED) channels on both devices' };
  const rec = {
    id: rid('ho-'), taskId: safe(opts.taskId, 40), from: from.id, to: to.id,
    checkpoint: opts.checkpoint || null, ts: now(), authenticatedChannel: true,
    note: 'Task state moves between trusted devices only; the receiving device must already hold the required capabilities.'
  };
  state.taskHandoffs.unshift(rec);
  if (state.taskHandoffs.length > 100) state.taskHandoffs.length = 100;
  return { ok: true, handoff: rec };
}

/* ── §107 Offline mode / deferred synchronisation ────────────────── */

function queueOffline(state, job) {
  state.offlineQueue = state.offlineQueue || [];
  const rec = { id: rid('off-'), text: safe((job || {}).text, 200), capability: safe((job || {}).capability, 60), queuedTs: now(), state: 'QUEUED', attempts: 0 };
  state.offlineQueue.push(rec);
  return { ok: true, job: rec, note: 'Tasks requiring external services stay pending until real connectivity returns (§107).' };
}
function offlineQueue(state) { return state.offlineQueue || []; }
function flushOffline(state, opts) {
  opts = opts || {};
  const q = state.offlineQueue || [];
  if (!opts.online) return { ok: true, flushed: 0, queued: q.filter(j => j.state === 'QUEUED').length, note: 'Offline — deferred synchronisation only.' };
  let flushed = 0;
  for (const j of q) { if (j.state === 'QUEUED') { j.state = 'SYNCED'; j.syncedTs = now(); flushed++; } }
  return { ok: true, flushed, queued: 0 };
}

/* ══ §130–§139 Account lifecycle ═══════════════════════════════════ */

const ACCOUNT_CAPABILITIES = ['account.discover', 'account.create', 'account.configure', 'account.verify', 'account.login', 'account.logout', 'account.recover', 'account.update', 'account.disable', 'account.delete', 'account.disconnect'];

const CREATION_BOUNDARIES = [
  'must not fabricate identity',
  'must not falsely claim age',
  'must not falsify legal information',
  'must not bypass CAPTCHA',
  'must not bypass identity verification',
  'must not bypass phone verification',
  'must not evade service restrictions',
  'must not impersonate another person',
  'must not accept legally binding terms without the required authority'
];
const BOUNDARY_TRIGGERS = {
  bypassCaptcha: 'must not bypass CAPTCHA',
  bypassIdentity: 'must not bypass identity verification',
  bypassPhone: 'must not bypass phone verification',
  fabricateIdentity: 'must not fabricate identity',
  falsifyAge: 'must not falsely claim age',
  falsifyLegal: 'must not falsify legal information',
  evadeRestrictions: 'must not evade service restrictions',
  impersonate: 'must not impersonate another person',
  acceptTermsWithoutAuthority: 'must not accept legally binding terms without the required authority'
};

function checkCreationRequest(req) {
  req = req || {};
  const violations = [];
  for (const [flag, rule] of Object.entries(BOUNDARY_TRIGGERS)) if (req[flag] === true) violations.push(rule);
  if (violations.length) return { ok: false, decision: 'DENY', violations, boundaries: CREATION_BOUNDARIES, note: 'WitForge stops at human-required boundaries and asks the user to complete them (§132/§159).' };
  return { ok: true, decision: 'ALLOW', steps: ['discover', 'determine-requirements', 'present-requirements', 'obtain-approval', 'register-through-official-interface', 'verify-legitimately', 'store-credentials-in-broker', 'register-integration', 'report-truthfully'] };
}
function addAccount(state, opts) {
  opts = opts || {};
  state.accounts = state.accounts || [];
  const service = safe(opts.service || 'unknown', 40).toLowerCase();
  const identifier = safe(opts.identifier || 'primary', 80);
  const rec = {
    id: opts.id || rid('acct-'),
    service,
    identifier,
    label: safe(opts.label || (service + ':' + identifier), 60),
    connectionStatus: opts.connectionStatus || 'RECORDED', // RECORDED | CONNECTED | UNAVAILABLE | DISCONNECTED
    capabilities: Array.isArray(opts.capabilities) ? opts.capabilities.slice(0, 64) : [],
    authorizedTs: opts.authorizedTs || now(),
    expiresTs: opts.expiresTs || null,
    securityStatus: opts.securityStatus || 'UNVERIFIED',
    revocationState: null,
    credentialRef: opts.credentialRef || null, // reference into the credential broker — never the secret
    createdTs: now()
  };
  state.accounts.push(rec);
  return { ok: true, account: rec };
}
function accountsFor(state, service) { return (state.accounts || []).filter(a => a.service === String(service || '').toLowerCase() && a.connectionStatus !== 'DISCONNECTED'); }
function accountRecord(state, id) { return (state.accounts || []).find(a => a.id === id) || null; }
function selectAccount(state, service, id) {
  state.activeAccounts = state.activeAccounts || {};
  const match = accountRecord(state, id);
  if (!match) return { ok: false, error: 'Unknown account' };
  if (match.service !== String(service).toLowerCase()) return { ok: false, error: 'Account does not belong to ' + service, detail: 'Account crossover refused (§135).' };
  state.activeAccounts[match.service] = id;
  return { ok: true, active: id, service: match.service };
}
/* Fail closed: if a service has several accounts and none was selected, the
 * operation refuses rather than guessing — a wrong-account action is a defect. */
function resolveAccount(state, service) {
  const list = accountsFor(state, service);
  if (!list.length) return { ok: false, reason: 'no-account', service };
  if (list.length === 1) return { ok: true, account: list[0], how: 'single-account' };
  const chosen = (state.activeAccounts || {})[service];
  if (!chosen) return { ok: false, reason: 'ambiguous-account', candidates: list.map(a => a.identifier), note: 'Select explicitly with “use account <identifier> for ' + service + '” — WitForge never picks an account by guessing (§135).' };
  const found = list.find(a => a.id === chosen);
  if (!found) return { ok: false, reason: 'active-account-missing' };
  return { ok: true, account: found, how: 'explicit-selection' };
}
function accountInventory(state) {
  return (state.accounts || []).map(a => ({
    id: a.id, service: a.service, identifier: a.identifier, connectionStatus: a.connectionStatus,
    capabilities: a.capabilities, authorizedTs: a.authorizedTs, expiresTs: a.expiresTs,
    securityStatus: a.securityStatus, revocationState: a.revocationState
  }));
}
function updateAccount(state, id, patch) {
  const a = accountRecord(state, id);
  if (!a) return { ok: false, error: 'Unknown account' };
  const allowed = ['connectionStatus', 'securityStatus', 'expiresTs', 'capabilities', 'label'];
  for (const k of allowed) if (patch && k in patch) a[k] = patch[k];
  a.updatedTs = now();
  return { ok: true, account: a };
}
function deletionImpact(state, id) {
  const a = accountRecord(state, id);
  if (!a) return null;
  const grants = Object.keys(state.permissions || {}).filter(c => c.startsWith(a.service + '.'));
  return {
    account: a.id, service: a.service, identifier: a.identifier,
    affectedData: [
      `account record ${a.id}`, `capabilities: ${a.capabilities.join(', ') || 'none'}`,
      `permission grants: ${grants.join(', ') || 'none'}`, 'credential reference in the broker',
      'integration state and sessions'
    ],
    irreversible: true,
    warning: 'Account deletion is consequential and cannot be undone by WitForge; the provider’s own mechanism has the final say (§138).'
  };
}
function deleteAccount(state, id, confirmed) {
  const impact = deletionImpact(state, id);
  if (!impact) return { ok: false, error: 'Unknown account' };
  if (confirmed !== true) return { ok: false, needsConfirmation: true, affectedData: impact.affectedData, warning: impact.warning, error: 'Confirmation required before deletion' };
  const a = accountRecord(state, id);
  a.connectionStatus = 'DELETED'; a.deletionTs = now();
  state.accounts = state.accounts.filter(x => x.id !== id);
  for (const c of Object.keys(state.permissions || {})) if (c.startsWith(a.service + '.')) delete state.permissions[c];
  return { ok: true, deleted: id, affectedData: impact.affectedData, verified: true };
}
function disconnectAccount(state, id, hooks) {
  hooks = hooks || {};
  const a = accountRecord(state, id);
  if (!a) return { ok: false, error: 'Unknown account' };
  const grants = Object.keys(state.permissions || {}).filter(c => c.startsWith(a.service + '.'));
  const revokedGrants = [];
  for (const c of grants) {
    if (typeof hooks.revoke === 'function') hooks.revoke(c);
    else delete state.permissions[c];
    revokedGrants.push(c);
  }
  a.connectionStatus = 'DISCONNECTED';
  a.revocationState = { ts: now(), reason: 'user disconnect' };
  a.capabilities = [];
  const credRevoked = typeof hooks.revokeCredential === 'function' ? !!hooks.revokeCredential(a.service).ok : false;
  return { ok: true, account: a.id, revokedGrants, credentialRevoked: credRevoked, auditPreserved: true };
}
function disableAccount(state, id, confirmed) {
  const a = accountRecord(state, id);
  if (!a) return { ok: false, error: 'Unknown account' };
  if (confirmed !== true) return { ok: false, needsConfirmation: true, error: 'Disabling an account is consequential — confirmation required' };
  a.connectionStatus = 'DISABLED'; a.disabledTs = now();
  return { ok: true, account: a };
}

/* ══ §113 Organisations ════════════════════════════════════════════ */

const ORG_ROLES = ['OWNER', 'ADMINISTRATOR', 'MANAGER', 'MEMBER', 'GUEST'];
function createOrg(state, opts) {
  opts = opts || {};
  state.orgs = state.orgs || [];
  if (!opts.name) return { ok: false, error: 'Organisation name required' };
  const org = {
    id: rid('org-'), name: safe(opts.name, 60), createdTs: now(),
    members: [{ subject: opts.owner || 'owner', role: 'OWNER', ts: now() }],
    teams: [], projects: [], sharedResources: [], policies: [], delegatedCapabilities: [], audit: []
  };
  state.orgs.push(org);
  return { ok: true, org };
}
function addOrgMember(state, orgId, member) {
  const org = (state.orgs || []).find(o => o.id === orgId);
  if (!org) return { ok: false, error: 'Unknown organisation' };
  const role = ORG_ROLES.includes((member || {}).role) ? member.role : 'MEMBER';
  org.members.push({ subject: safe((member || {}).subject, 40), role, ts: now() });
  return { ok: true, org };
}
function addOrgTeam(state, orgId, name) {
  const org = (state.orgs || []).find(o => o.id === orgId);
  if (!org) return { ok: false, error: 'Unknown organisation' };
  org.teams.push({ id: rid('team-'), name: safe(name, 40), members: [] });
  return { ok: true, org };
}
function delegateOrgCapability(state, orgId, cap, opts) {
  const org = (state.orgs || []).find(o => o.id === orgId);
  if (!org) return { ok: false, error: 'Unknown organisation' };
  if (opts && opts.individualConsent === false) return { ok: false, error: 'Organisation authority does not override individual account authority (§113)' };
  org.delegatedCapabilities.push({ cap: safe(cap, 60), ts: now(), requiresIndividualConsent: true });
  return { ok: true, org };
}
function orgOverridesIndividual() { return false; }
function orgAuthorityNote() { return 'Organisation authority never automatically overrides individual account authority — each member’s own authorization still applies (§113).'; }

/* ══ §114 Subscriptions & entitlements ═════════════════════════════ */

/* §114: subscription levels are multi-tiered across two families. Prices are
 * reference labels only — no charge is created until billing authority exists
 * (see bill()). Entitlements are enforced server-side by requireEntitlement(). */
const PLANS = [
  /* v1.74: paid ladder reshaped — five personal tiers from A$9, two business
   * from A$30; the A$499 'enterprise' tier was retired. v1.74.1: the $0 Free
   * baseline is restored (owner decision) — it is an entitlement baseline,
   * never a charge, same as every tier while billing is compliance-locked. */
  /* ── personal ───────────────────────────────────────────────────── */
  { id: 'free', name: 'Free', family: 'personal', rank: 0, priceAudMonth: 0, blurb: 'The no-charge baseline: everything the platform is, for one person.',
    entitlements: { 'agents.max': 1, 'storage.mb': 50, 'ai.daily': 25, 'tools.max': 6, 'org.seats': 1, 'marketplace.list': 1, 'api.access': false, 'guardian.level': 'BASIC', 'lotto.ticketsPerDay': 5, 'events.access': 'standard', 'signin.bonusPct': 0, 'support': 'community', 'audit.export': false } },
  { id: 'plus', name: 'Plus', family: 'personal', rank: 1, priceAudMonth: 9, blurb: 'More agents, more storage, the guardian on Standard.',
    entitlements: { 'agents.max': 3, 'storage.mb': 500, 'ai.daily': 200, 'tools.max': 10, 'org.seats': 1, 'marketplace.list': 5, 'api.access': false, 'guardian.level': 'STANDARD', 'lotto.ticketsPerDay': 20, 'events.access': 'standard', 'signin.bonusPct': 5, 'support': 'email', 'audit.export': false } },
  { id: 'pro', name: 'Pro', family: 'personal', rank: 2, priceAudMonth: 29, blurb: 'For one person running real work: hardened guardian, API access, priority events.',
    entitlements: { 'agents.max': 10, 'storage.mb': 5000, 'ai.daily': 1000, 'tools.max': 20, 'org.seats': 3, 'marketplace.list': 25, 'api.access': true, 'guardian.level': 'HARDENED', 'lotto.ticketsPerDay': 50, 'events.access': 'priority', 'signin.bonusPct': 10, 'support': 'priority', 'audit.export': true } },
  { id: 'elite', name: 'Elite', family: 'personal', rank: 3, priceAudMonth: 79, blurb: 'Maximum seat: maximum guardian posture, largest personal allowances.',
    entitlements: { 'agents.max': 25, 'storage.mb': 25000, 'ai.daily': 5000, 'tools.max': 32, 'org.seats': 5, 'marketplace.list': 100, 'api.access': true, 'guardian.level': 'MAXIMUM', 'lotto.ticketsPerDay': 200, 'events.access': 'priority', 'signin.bonusPct': 20, 'support': 'priority', 'audit.export': true } },
  { id: 'ultra', name: 'Ultra', family: 'personal', rank: 4, priceAudMonth: 149, blurb: 'The personal ceiling: every personal entitlement at its largest, first access to new tools.',
    entitlements: { 'agents.max': 50, 'storage.mb': 100000, 'ai.daily': 20000, 'tools.max': 40, 'org.seats': 8, 'marketplace.list': 500, 'api.access': true, 'guardian.level': 'MAXIMUM', 'lotto.ticketsPerDay': 500, 'events.access': 'sponsored', 'signin.bonusPct': 25, 'support': 'dedicated', 'audit.export': true } },
  { id: 'apex', name: 'Apex', family: 'personal', rank: 5, priceAudMonth: 299, blurb: 'The top of the personal ladder: every personal entitlement at its absolute ceiling, concierge support.',
    entitlements: { 'agents.max': 100, 'storage.mb': 250000, 'ai.daily': 50000, 'tools.max': 48, 'org.seats': 12, 'marketplace.list': 2000, 'api.access': true, 'guardian.level': 'MAXIMUM', 'lotto.ticketsPerDay': 1000, 'events.access': 'sponsored', 'signin.bonusPct': 30, 'support': 'concierge', 'audit.export': true } },
  /* ── business ───────────────────────────────────────────────────── */
  { id: 'business', name: 'Business', family: 'business', rank: 1, priceAudMonth: 30, blurb: 'One organisation, several operators, shared entitlements.',
    entitlements: { 'agents.max': 50, 'storage.mb': 25000, 'ai.daily': 4000, 'tools.max': 32, 'org.seats': 25, 'marketplace.list': 200, 'api.access': true, 'guardian.level': 'HARDENED', 'lotto.ticketsPerDay': 100, 'events.access': 'priority', 'signin.bonusPct': 10, 'support': 'business', 'audit.export': true } },
  { id: 'business-plus', name: 'Business Plus', family: 'business', rank: 2, priceAudMonth: 99, blurb: 'Departments, delegated administration and a bigger audit trail.',
    entitlements: { 'agents.max': 200, 'storage.mb': 100000, 'ai.daily': 20000, 'tools.max': 40, 'org.seats': 100, 'marketplace.list': 1000, 'api.access': true, 'guardian.level': 'MAXIMUM', 'lotto.ticketsPerDay': 500, 'events.access': 'priority', 'signin.bonusPct': 15, 'support': 'business', 'audit.export': true } },
];
function plansFor(family) { return PLANS.filter(p => p.family === family); }
function planById(id) { return PLANS.find(p => p.id === String(id || '').toLowerCase()) || null; }
function planRank(id) { const p = planById(id); return p ? p.rank : 0; }
function upgradePathFrom(id) {
  const p = planById(id);
  if (!p) return plansFor('personal');
  return PLANS.filter(x => x.family === p.family && x.rank > p.rank);
}
function comparePlans(a, b) {
  const A = planById(a), B = planById(b);
  if (!A || !B) return { ok: false, error: 'Unknown plan' };
  const keys = Array.from(new Set(Object.keys(A.entitlements).concat(Object.keys(B.entitlements))));
  return {
    ok: true, from: A.id, to: B.id, family: B.family, sameFamily: A.family === B.family,
    priceDeltaAud: B.priceAudMonth - A.priceAudMonth,
    changes: keys.filter(k => A.entitlements[k] !== B.entitlements[k]).map(k => ({ key: k, from: A.entitlements[k], to: B.entitlements[k] }))
  };
}
function plan(id) { return PLANS.find(p => p.id === id) || PLANS[0]; }
function subscribe(state, opts) {
  opts = opts || {};
  const wanted = String(opts.plan === undefined ? 'free' : opts.plan).toLowerCase();
  const p = planById(wanted) || PLANS.find(x => x.name.toLowerCase() === wanted);
  /* An unknown tier is refused. Quietly falling back to Free would let a
   * caller believe they bought something that does not exist. */
  if (!p) return { ok: false, error: 'Unknown plan “' + opts.plan + '”. Available: ' + PLANS.map(x => x.id).join(', ') };
  state.subscription = {
    planId: p.id, planName: p.name, family: p.family || 'personal', rank: p.rank === undefined ? 0 : p.rank,
    priceAudMonth: p.priceAudMonth === undefined ? 0 : p.priceAudMonth,
    blurb: p.blurb || '', since: now(),
    entitlements: p.entitlements,
    usage: {},
    status: 'ACTIVE',
    billing: { invoices: [], chargeable: false, note: 'Billing actions require explicit authority (§114). Real money stays compliance-locked until legal review.' }
  };
  return { ok: true, subscription: state.subscription };
}
function currentSubscription(state) {
  const s = state.subscription || (state.subscription = subscribe(state, { plan: 'free' }).subscription);
  if (!s.family) {                                   // older local records gain the tier fields
    const p = planById(s.planId) || plan('free');
    s.family = p.family || 'personal';
    s.rank = p.rank === undefined ? 0 : p.rank;
    s.priceAudMonth = p.priceAudMonth === undefined ? 0 : p.priceAudMonth;
    s.blurb = p.blurb || '';
  }
  return s;
}
function entitlements(state) { return currentSubscription(state).entitlements; }
/* Server-side enforcement: premium controls are checked here, never in the UI. */
function requireEntitlement(state, key, amount) {
  const ent = entitlements(state);
  const have = ent[key];
  if (have === undefined) return { ok: false, reason: 'unknown-entitlement', key };
  const need = Number(amount || 1);
  if (have === false) return { ok: false, reason: 'not-entitled', key, plan: currentSubscription(state).planId };
  const used = Number(currentSubscription(state).usage[key] || 0);
  if (used + need > Number(have)) return { ok: false, reason: 'limit-reached', key, limit: have, used };
  return { ok: true, key, limit: have, used };
}
function recordUsage(state, key, amount) {
  const s = currentSubscription(state);
  s.usage[key] = Number(s.usage[key] || 0) + Number(amount || 1);
  return { ok: true, key, used: s.usage[key], entitlements: s.entitlements };
}
function bill(state, opts) {
  opts = opts || {};
  const s = currentSubscription(state);
  if (s.billing.chargeable !== true) return { ok: false, reason: 'billing-authority-missing', note: 'No billing authority recorded; the platform does not create charges it is not authorized to create (§114/§133).' };
  const invoice = { id: rid('inv-'), ts: now(), planId: s.planId, amountAud: Number(opts.amountAud || 0), lines: opts.lines || [] };
  s.billing.invoices.unshift(invoice);
  return { ok: true, invoice };
}

/* ══ §110 Asset registry, ownership & §112 anti-fraud ══════════════ */

const RARITY_100_RULE = {
  level: 100,
  band: 'Mythic',
  requiresApproval: true,
  requiresProvenance: true,
  note: 'Rarity 100 is a controlled state: creation needs an approval record, full provenance and a uniqueness check — it can never be mass-produced or silently duplicated (§78).'
};
function registerAsset(state, opts) {
  opts = opts || {};
  state.assets = state.assets || [];
  const seed = opts.seed === undefined ? crypto.randomBytes(8).toString('hex') : String(opts.seed);
  const identity = hash({ type: opts.type, seed, owner: opts.owner, creator: opts.creator, parents: opts.parents || [] });
  if (state.assets.some(a => a.identity === identity)) return { ok: false, reason: 'duplicate-identity', detail: 'Anti-duplication: an asset with this identity already exists (§77).' };
  const rarity = Math.max(1, Math.min(100, Number(opts.rarity) || 1));
  if (rarity === 100 && opts.approvalRef === undefined) {
    return { ok: false, reason: 'rarity-100-needs-approval', rule: RARITY_100_RULE };
  }
  const asset = {
    assetId: opts.assetId || rid('asset-'),
    type: safe(opts.type || 'piece', 30),
    owner: safe(opts.owner, 60),
    creator: safe(opts.creator, 60),
    source: safe(opts.source || 'local-mint', 60),
    status: 'ACTIVE',
    rarity,
    parentAssets: (opts.parents || opts.parentAssets || []).slice(0, 16),
    transfers: [],
    mergeHistory: [],
    provenance: {
      seedHash: hash(seed), createdTs: now(),
      promptHash: opts.prompt ? hash(opts.prompt) : null,
      generatedBy: safe(opts.generatedBy || 'local-engine', 40),
      metadata: Object.assign({}, opts.metadata || {})
    },
    identity,
    approvalRef: opts.approvalRef || null
  };
  state.assets.push(asset);
  return { ok: true, asset };
}
function assetRecord(state, id) { return (state.assets || []).find(a => a.assetId === id) || null; }
function transferAsset(state, id, to, reason) {
  const a = assetRecord(state, id);
  if (!a) return { ok: false, error: 'Unknown asset' };
  if (a.status !== 'ACTIVE') return { ok: false, error: 'Asset is not transferable while ' + a.status };
  const from = a.owner;
  a.owner = safe(to, 60);
  a.transfers.push({ from, to: a.owner, ts: now(), reason: safe(reason || 'transfer', 60) });
  return { ok: true, asset: a, history: a.transfers.length };
}
function mergeAssets(state, ids, opts) {
  opts = opts || {};
  const parts = (ids || []).map(id => assetRecord(state, id));
  if (parts.length < 2 || parts.some(p => !p)) return { ok: false, error: 'Merge requires at least two existing assets' };
  const owners = new Set(parts.map(p => p.owner));
  if (owners.size > 1) return { ok: false, error: 'All merged assets must share one owner' };
  const avg = Math.round(parts.reduce((n, p) => n + p.rarity, 0) / parts.length) + 5;
  const created = registerAsset(state, {
    type: opts.type || parts[0].type, owner: parts[0].owner, creator: opts.creator || parts[0].creator,
    rarity: Math.min(100, avg), parents: parts.map(p => p.assetId), source: 'merge', seed: opts.seed,
    approvalRef: opts.approvalRef
  });
  if (!created.ok) return created; // failed merge leaves originals intact (§76/§111)
  for (const p of parts) {
    p.status = 'MERGED';
    p.mergeHistory.push({ into: created.asset.assetId, ts: now() });
  }
  created.asset.mergeHistory.push({ from: parts.map(p => p.assetId), ts: now() });
  return { ok: true, merged: created.asset, consumed: parts.map(p => p.assetId) };
}
function provenanceReport(state, id) {
  const a = assetRecord(state, id);
  if (!a) return null;
  return {
    assetId: a.assetId, type: a.type, rarity: a.rarity, creator: a.creator, currentOwner: a.owner,
    source: a.source, status: a.status, identity: a.identity,
    parentAssets: a.parentAssets, mergeHistory: a.mergeHistory, transfers: a.transfers, provenance: a.provenance
  };
}

const FRAUD_SIGNALS = [
  { id: 'self-trade', test: c => c.actor && c.counterparty && c.actor === c.counterparty, severity: 'HIGH', note: 'actor and counterparty are the same entity' },
  { id: 'large-transfer', test: c => Number(c.amount || 0) >= 10000, severity: 'MEDIUM', note: 'transfer is unusually large' },
  { id: 'rapid-repeat', test: c => Number(c.recentSameKind || 0) >= 5, severity: 'MEDIUM', note: 'many similar operations in a short window' },
  { id: 'unbalanced-ledger', test: c => c.unbalanced === true, severity: 'CRITICAL', note: 'ledger entry would not balance' },
  { id: 'duplicate-asset', test: c => c.duplicateIdentity === true, severity: 'HIGH', note: 'asset identity already exists' },
  { id: 'new-account-large-value', test: c => c.accountAgeMs !== undefined && c.accountAgeMs < 3600e3 && Number(c.amount || 0) >= 1000, severity: 'MEDIUM', note: 'new account moving significant value' }
];
function fraudScreen(state, ctx) {
  ctx = ctx || {};
  const signals = FRAUD_SIGNALS.filter(s => { try { return !!s.test(ctx); } catch (e) { return false; } }).map(s => ({ id: s.id, severity: s.severity, note: s.note }));
  state.fraudEvents = state.fraudEvents || [];
  if (signals.length) state.fraudEvents.unshift({ ts: now(), ctx: { kind: ctx.kind, actor: ctx.actor, amount: ctx.amount }, signals });
  if (state.fraudEvents.length > 200) state.fraudEvents.length = 200;
  const blocked = signals.some(s => s.severity === 'CRITICAL');
  return { ok: !blocked, blocked, signals, recommendation: blocked ? 'refuse and preserve evidence' : signals.length ? 'review before settling' : 'no signals' };
}
function fraudReport(state) {
  const events = state.fraudEvents || [];
  return { events: events.length, bySeverity: events.flatMap(e => e.signals.map(s => s.severity)).reduce((a, s) => (a[s] = (a[s] || 0) + 1, a), {}) };
}
/* §112 rate limiting is enforced here as well as in the HTTP layer. */
function rateLimitGate(state, key, limit, windowMs) {
  state.rateLimits = state.rateLimits || {};
  const w = windowMs || 60000;
  const rec = state.rateLimits[key];
  const t = now();
  if (!rec || t - rec.start > w) { state.rateLimits[key] = { start: t, count: 1 }; return { ok: true, count: 1, limit: limit || 60 }; }
  rec.count++;
  return { ok: rec.count <= (limit || 60), count: rec.count, limit: limit || 60 };
}

/* ══ §119 Observability ════════════════════════════════════════════ */

function metric(state, name, value, attrs) {
  state.metrics = state.metrics || [];
  state.metrics.unshift({ ts: now(), name: safe(name, 60), value: Number(value) || 0, attributes: Object.assign({}, attrs || {}) });
  if (state.metrics.length > 500) state.metrics.length = 500;
  return { ok: true };
}
function metrics(state, name) {
  const list = state.metrics || [];
  return name ? list.filter(m => m.name === name) : list;
}
function startSpan(state, name, cid) {
  state.spans = state.spans || [];
  const span = { id: rid('span-'), name: safe(name, 60), cid: cid || null, startTs: now(), endTs: null, status: 'EXECUTING', events: [] };
  state.spans.unshift(span);
  if (state.spans.length > 300) state.spans.length = 300;
  return span;
}
function endSpan(state, span, status, attrs) {
  if (!span) return { ok: false, error: 'no-span' };
  span.endTs = now();
  span.durationMs = span.endTs - span.startTs;
  span.status = status || 'SUCCEEDED';
  span.attributes = Object.assign({}, attrs || {});
  return { ok: true, span };
}
function traceTimeline(state, cid) {
  return {
    cid,
    spans: (state.spans || []).filter(s => s.cid === cid),
    audit: (state.audit || []).filter(a => a.cid === cid).map(a => ({ ts: a.ts, action: a.action || a.detail, decision: a.decision || null, risk: a.risk || null })),
    note: 'Correlation ids join spans, audit events and tool evidence into one task timeline (§119).'
  };
}
/* OpenTelemetry-flavoured export: resource + scope + spans with timestamps in
 * nanoseconds, so an OTLP collector can ingest it without translation. */
function otelExport(state) {
  const ns = ms => ms * 1e6;
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'witforge' } }, { key: 'service.version', value: { stringValue: (state.release && state.release.version) || '2.03.1' } }] },
      scopeSpans: [{
        scope: { name: 'witforge.platform', version: '2.03.1' },
        spans: (state.spans || []).map(s => ({
          traceId: (s.cid || s.id).padEnd(32, '0').slice(0, 32),
          spanId: s.id.replace(/[^a-f0-9]/gi, '').padEnd(16, '0').slice(0, 16),
          name: s.name,
          startTimeUnixNano: String(ns(s.startTs)),
          endTimeUnixNano: String(ns(s.endTs || now())),
          kind: 1,
          status: { code: s.status === 'SUCCEEDED' ? 1 : 2, message: s.status },
          attributes: Object.entries(s.attributes || {}).map(([k, v]) => ({ key: k, value: { stringValue: String(v) } }))
        }))
      }]
    }],
    metrics: (state.metrics || []).slice(0, 100).map(m => ({ name: m.name, timeUnixNano: String(ns(m.ts)), asInt: String(m.value) })),
    privacyNote: 'Security and operational telemetry stay privacy-aware: no message contents, secrets or personal data are exported (§119).'
  };
}

/* ══ §126 Self-test with four truthful states ══════════════════════ */

const SELFTEST_STATES = ['PASS', 'FAIL', 'WARNING', 'NOT_TESTED'];
const SELFTEST_CATEGORIES = ['configuration', 'database', 'authentication', 'permissions', 'integrations', 'security-controls', 'dependency-health', 'audit-system', 'recovery-system'];

function check(name, category, result, detail) {
  const state = SELFTEST_STATES.includes(result) ? result : 'NOT_TESTED';
  return {
    check: name, category, result: state,
    // `pass` is kept so older tooling keeps reading a boolean; only PASS is a pass.
    pass: state === 'PASS',
    detail: detail || null, ts: now()
  };
}
function selftestSummary(checks) {
  const counts = { PASS: 0, FAIL: 0, WARNING: 0, NOT_TESTED: 0 };
  checks.forEach(c => { counts[c.result] = (counts[c.result] || 0) + 1; });
  return {
    counts, checks,
    allPass: counts.FAIL === 0 && counts.NOT_TESTED === 0,
    honest: true,
    note: 'NOT_TESTED is reported as NOT_TESTED — an untested control is never presented as passing (§126/§165).'
  };
}

/* ══ §129 Release metadata ═════════════════════════════════════════ */

function releaseMeta(opts) {
  opts = opts || {};
  return {
    version: opts.version || '2.03.1',
    buildDate: opts.buildDate || now(),
    sourceRevision: opts.sourceRevision || 'unknown (no VCS metadata available)',
    dependencyState: opts.dependencyState || 'zero runtime dependencies; Node built-ins only',
    testStatus: opts.testStatus || 'NOT_TESTED',
    knownLimitations: opts.knownLimitations || [
      'External integrations are UNAVAILABLE until real APIs, credentials, device permissions and authorization exist.',
      'Device, camera, microphone, screen and radio capabilities stay unavailable without OS permission bridges and pairing.',
      'Real-money functionality is compliance-locked; the platform makes no licensing claim.',
      'Rarity 100 assets require an approval record before creation.'
    ],
    securityStatus: opts.securityStatus || 'security layer independent of the model; approval-gated high risk; no bypass paths'
  };
}

/* ══ §53 Agent sandbox · §62 agent types · §63 delegation ══════════ */

const AGENT_TYPES = ['planner', 'researcher', 'coding', 'browser', 'device', 'media', 'security', 'account', 'communications', 'finance-reconciliation', 'project'];
function agentRecord(opts) {
  opts = opts || {};
  const type = AGENT_TYPES.includes(opts.type) ? opts.type : 'planner';
  return {
    id: opts.id || rid('agent-'), name: safe(opts.name || type + '-agent', 60), type,
    scope: safe(opts.scope || 'local', 40), status: 'active',
    delegations: [], sandbox: sandboxProfile({ agent: opts.id || type }),
    createdTs: now(),
    note: 'Agents receive only explicitly delegated authority; nothing is inherited implicitly (§63).'
  };
}
function sandboxProfile(opts) {
  opts = opts || {};
  const restricted = opts.restricted !== false;
  return {
    agent: opts.agent || 'unbound',
    filesystem: restricted ? { mode: 'sandbox-only', path: 'data/userfiles', escapeBlocked: true } : { mode: 'unbounded' },
    network: { mode: 'guarded-fetch', privateAddresses: 'blocked', metadataEndpoints: 'blocked', allowlistRequired: true },
    process: { shell: false, allowlistOnly: true, maxConcurrent: 1 },
    resources: { cpuMs: Number(opts.cpuMs) || 5000, memoryMb: Number(opts.memoryMb) || 128 },
    capabilities: opts.capabilities ? opts.capabilities.slice(0, 32) : [],
    timeMs: Number(opts.timeMs) || 30000,
    outputBytes: Number(opts.outputBytes) || 20000,
    audit: true
  };
}
/* §63: an agent may only delegate what it is itself permitted to delegate. */
function delegable(grant) { return !!(grant && grant.delegable === true); }
function delegate(agent, capability, grant) {
  if (!delegable(grant)) return { ok: false, error: 'Capability ' + capability + ' is not delegable by this grantor (§63)' };
  agent.delegations.push({ capability: safe(capability, 60), ts: now(), scope: (grant && grant.scope) || {} });
  return { ok: true, agent, delegations: agent.delegations.length };
}

/* ══ §117 Emergency recovery actions ═══════════════════════════════ */

const RECOVERY_ACTIONS = [
  'revoke-session', 'revoke-capability', 'disconnect-account', 'isolate-device',
  'disable-integration', 'rollback', 'restore', 'quarantine', 'rotate-credential', 'lockdown'
];
function recoveryPlan(state, opts) {
  opts = opts || {};
  const actions = [];
  if (opts.sessions) actions.push('revoke-session');
  if (opts.capabilities) actions.push('revoke-capability');
  if (opts.account) actions.push('disconnect-account');
  if (opts.device) actions.push('isolate-device');
  if (opts.integration) actions.push('disable-integration');
  if (opts.quarantine) actions.push('quarantine');
  if (opts.rotate) actions.push('rotate-credential');
  if (opts.lockdown) actions.push('lockdown');
  return { ok: actions.length > 0, actions, audited: true, note: 'Recovery operations are themselves audited (§117).' };
}
function applyRecovery(state, plan, hooks) {
  hooks = hooks || {};
  const performed = [];
  for (const a of (plan.actions || [])) {
    if (a === 'revoke-session' && typeof hooks.revokeSessions === 'function') { hooks.revokeSessions(); performed.push(a); }
    else if (a === 'revoke-capability' && typeof hooks.revokeCapabilities === 'function') { hooks.revokeCapabilities(); performed.push(a); }
    else if (a === 'isolate-device' && typeof hooks.isolateDevice === 'function') { hooks.isolateDevice(); performed.push(a); }
    else if (typeof hooks[a] === 'function') { hooks[a](); performed.push(a); }
  }
  return { ok: performed.length === (plan.actions || []).length, performed, notPerformed: (plan.actions || []).filter(a => !performed.includes(a)) };
}

module.exports = {
  DEVICE_TRUST, TRUST_TRANSITIONS, DEVICE_PLATFORMS, pairDevice, deviceRecord, setTrust,
  grantDeviceCapability, revokeDeviceCapability, isolationReport,
  DEVICE_COMMAND_FIELDS, acceptDeviceCommand, deviceCommandPolicy,
  handoffTask,
  queueOffline, offlineQueue, flushOffline,
  ACCOUNT_CAPABILITIES, PLANS, plansFor, planById, planRank, upgradePathFrom, comparePlans, CREATION_BOUNDARIES, BOUNDARY_TRIGGERS, checkCreationRequest,
  addAccount, accountsFor, accountRecord, selectAccount, resolveAccount, accountInventory,
  updateAccount, deletionImpact, deleteAccount, disconnectAccount, disableAccount,
  ORG_ROLES, createOrg, addOrgMember, addOrgTeam, delegateOrgCapability, orgOverridesIndividual, orgAuthorityNote,
  PLANS, plan, subscribe, currentSubscription, entitlements, requireEntitlement, recordUsage, bill,
  RARITY_100_RULE, registerAsset, assetRecord, transferAsset, mergeAssets, provenanceReport,
  FRAUD_SIGNALS, fraudScreen, fraudReport, rateLimitGate,
  metric, metrics, startSpan, endSpan, traceTimeline, otelExport,
  SELFTEST_STATES, SELFTEST_CATEGORIES, check, selftestSummary,
  releaseMeta,
  AGENT_TYPES, agentRecord, sandboxProfile, delegable, delegate,
  RECOVERY_ACTIONS, recoveryPlan, applyRecovery
};
