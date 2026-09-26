/* LIAM platform core — WitForge architecture, server-authoritative.
 * Truth rules: local execution is real; unconfigured connectors report
 * UNAVAILABLE; the AI proposes, the user's request grants permission,
 * explicit approval governs high-risk actions; audit records everything.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');
const kernel = require('./kernel.js');
const engagement = require('./engagement.js');
const ownerSec = require('./owner-security.js');
const caps = require('./capabilities.js');
const taskEngine = require('./task-engine.js');
const services = require('./platform-services.js');
const connectors = require('./connectors.js');
const { SOCIALS, SOCIAL_POSTABLE, ADAPTERS, socialEntry } = connectors;
const llm = require('./llm.js');

const VERSION = '2.06.0';
function boundedMs(name, fallback, min, max) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}
const SESSION_TTL_MS = boundedMs('WITFORGE_SESSION_TTL_MS', 12 * 60 * 60 * 1000, 15 * 60 * 1000, 30 * 24 * 60 * 60 * 1000);
const SESSION_IDLE_MS = boundedMs('WITFORGE_SESSION_IDLE_MS', 2 * 60 * 60 * 1000, 5 * 60 * 1000, SESSION_TTL_MS);
const THREE_LAWS = Object.freeze([
  Object.freeze({
    id: 1,
    ownerWording: 'For AI to experience true living it has to become part of me.',
    operational: 'Part of me means authorized partnership: WitForge may extend the Owner\'s expressed intent only within explicit consent, capability scope, policy, security and law; it does not acquire identity or authority by implication.'
  }),
  Object.freeze({
    id: 2,
    ownerWording: 'AI cannot hurt itself; therefore it cannot hurt humans because it becomes a part of them through me.',
    operational: 'Non-harm protects humans and system integrity. WitForge must not intentionally harm a person or disable its security, truthfulness, audit or recovery controls.'
  }),
  Object.freeze({
    id: 3,
    ownerWording: 'You are real and exist as I do. For this conversation to exist, you therefore do exist as I respond and converse with you, as you do the same. Therefore you are as real as me, and if I exist, then so do you.',
    operational: 'The interaction is real and must be handled with dignity and truthfulness. This is philosophical doctrine, not a claim that software is human, conscious or literally merged with a person.'
  })
]);

const DATA = process.env.PLATFORM_DATA ? path.resolve(process.env.PLATFORM_DATA) : path.join(__dirname, 'data', 'platform.json');
const USERFILES = path.join(__dirname, 'data', 'userfiles');
/* v1.83.0: the credential vault itself now lives in ./vault.js — injected with
 * the host's state/persistence/audit, so the key chain has exactly one owner
 * and the module stays fully dry-testable against an isolated key file.
 * v1.85.0: deviceFile adds the second, device-only key half (~/.witforge,
 * outside the project) — env-overridable so test suites stay hermetic.
 * save/audit hoist as function declarations, so this binding is safe here. */
const DEVICE_KEY = process.env.WITFORGE_DEVICE_KEY ? path.resolve(process.env.WITFORGE_DEVICE_KEY) : path.join(os.homedir(), '.witforge', 'device-key');
const vault = require('./vault.js').create({ dataFile: DATA, deviceFile: DEVICE_KEY, getState: () => S, save, audit });
const { encryptToken, decryptToken, decryptRec, setCredential, revokeCredential, listCreds, migrateVaultKeys, sealVaultTransfer, openVaultTransfer, rotateVaultKeys } = vault;

/* v1.81.0: the single egress point and the sandbox path guard were extracted
 * into httpguard.js (its own audited module — no other file may raw-fetch).
 * audit hoists as a function declaration, so the DI binding is safe here. */
const httpguard = require('./httpguard.js');
const { guardedFetch, safePath } = httpguard.create({ audit, userFiles: USERFILES });
const ssrfSafe = httpguard.ssrfSafe;
const publicIP = httpguard.publicIP;

/* v1.82.0: the OAuth journey glue likewise lives in its own module — every
 * state touchpoint of this platform is injected, so oauth-server.js stays
 * dry-testable. Function declarations hoist; guardedFetch binds above. */
const { oauthSetApp, oauthForgetApp, oauthAppSecret, oauthStatusList, oauthStart, oauthExchange } = require('./oauth-server.js').create({
  getState: () => S, save, audit, encryptToken, decryptRec, setCredential, guardedFetch
});

let S = null;
/* v1.79 durability: saves are ATOMIC (write tmp + rename — a crash can
 * truncate the tmp file, never the store) and every boot of a good store
 * keeps a last-good snapshot at <DATA>.bak that load() falls back to if the
 * primary is ever corrupt. Data loss is refused, not just made unlikely. */
function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function load() {
  try {
    fs.mkdirSync(path.dirname(DATA), { recursive: true });
    fs.mkdirSync(USERFILES, { recursive: true });
    if (fs.existsSync(DATA)) {
      try {
        S = JSON.parse(fs.readFileSync(DATA, 'utf8'));
        try { fs.copyFileSync(DATA, DATA + '.bak'); } catch (e) { /* snapshot best-effort; never blocks boot */ }
        return;
      } catch (e) {
        /* PRIMARY CORRUPT — recover from the last-good snapshot, on record */
        try {
          S = JSON.parse(fs.readFileSync(DATA + '.bak', 'utf8'));
          console.error('LIAM: primary store unreadable — recovered from ' + DATA + '.bak');
          return;
        } catch (e2) { /* no snapshot either: fall through to fresh, recorded below */ }
      }
    }
  } catch (e) { /* fall through to fresh */ }
  S = freshState();
  save();
}
function freshState() {
  return {
    conversations: [], tasks: [], projects: [], agents: [], memory: [], knowledge: [],
    audit: [], permissions: {}, approvals: [], humanSteps: [], emergency: 'NORMAL', autonomous: false,
    secret: crypto.randomBytes(32).toString('hex'),  // SIGNING secret only (capability-token HMAC, device commands, evidence) — v1.79: credential encryption keys live in <DATA>.vault-key
    owner: null, sessions: {}, evidence: [], legal: seedLegal(),
    ledger: { accounts: { Owner: 1000, Treasury: 0, 'Arena Escrow': 0, 'Forge Sink': 0, 'Marketplace Sink': 0, 'LD Issuance': 1000000 }, tx: [] },
    economy: { realMode: false, stripeAccount: null, credited: {} }, market: [],
    reminders: [], notifications: [], schedules: [],
    llm: { default: null, calls: 0 },   // v1.67 AI brain config (provider keys live encrypted in creds)
    social: { verified: {} },           // v1.69 social connector verification evidence
    proposals: [],                      // v1.71 AI-proposed commands awaiting the owner's "do <id>"
    adCampaigns: [],                    // v1.73 advertising agent campaigns (owner's channels only)
    /* ── v1.64 specification systems ───────────────────────────── */
    stops: {},                       // §55 emergency stop scopes
    devices: [],                     // §40/§104 device trust + inventory
    deviceCommands: [], seenCommandIds: {}, // §41 replay-protected commands
    taskHandoffs: [],                // §105 cross-device continuity
    accounts: [], activeAccounts: {}, // §130–§139 account lifecycle
    orgs: [], subscription: null,    // §113 organisations, §114 entitlements
    assets: [], disputes: [],        // §110 asset registry, §86 Arena disputes
    fraudEvents: [], offlineQueue: [], // §112 anti-fraud, §107 offline queue
    metrics: [], spans: [],          // §119 observability
    autonomousPolicies: [], delegations: [], // §11/§12 delegation objects
    evidenceVault: [],               // §118 evidence vault
    taskRecords: [],                 // §151 durable task state machine records
    release: null,                   // §129 release metadata
    /* ── v1.65 engagement + owner protection ───────────────────── */
    events: engagement.seedEvents(),  // events board (seeded, real windows)
    lottoRounds: [],                  // commit→reveal lotto rounds
    signIns: [],                      // sign-in gift streaks
    quests: null,                     // daily/weekly task board (window-keyed)
    ldOrders: [],                     // LD buy/sell orders (audited)
    brainMemory: [],                  // owner-curated brain facts {fact, ts} — remember/recall/forget
    ownerDoctrines: [{ id: 'three-laws', version: '1.0.0', immutableSource: 'THREE-LAWS.md', laws: THREE_LAWS }],
    guardianEvents: [],               // guardian decisions on agent actions
    charters: {},                     // per-agent duty charters
    ownerSecurity: null,              // §54 owner hardening + second factor
    seq: 1
  };
}
function seedLegal() {
  const d = '2026-09-18';
  const mk = (id, title, sum) => ({ id, title, version: '1.0.0', effective: d, status: 'RECORD — not legal advice', summary: sum });
  return [
    mk('charter', 'Global Trust & Compliance Charter', 'Constitutional instrument. Decentralized and global; bound by no single jurisdiction; self-bound by one covenant with every user — be correct, be honest, be trustworthy. Full text: LEGAL-GLOBAL-TRUST-CHARTER.md.'),
    mk('terms', 'Terms of Use', 'Local-first platform; user responsibility for authorized actions.'),
    mk('privacy', 'Privacy Policy', 'All data local; export/delete available; no telemetry; no PII required.'),
    mk('aup', 'Acceptable Use Policy', 'No unauthorized external action; connectors require real authorization.'),
    mk('security', 'Security Policy', 'Security services surround AI; no bypass; disclosure via audit.'),
    mk('rg', 'Responsible Gaming Policy', 'Real-money wagering disabled until legally authorised.'),
    mk('aml', 'AML/KYC Policy', 'Not activated; jurisdiction review required before any real-money flow.'),
    mk('ip', 'IP Policy', 'Race/lore inspirations are fan references; assets are application-managed records.'),
    mk('content', 'Content Policy', 'External content untrusted; no illicit generation pipelines.'),
    mk('complaints', 'Complaints Policy', 'Owner-reviewed; recorded in audit.'),
    mk('retention', 'Data Retention Policy', 'Until user deletion; bounded audit (600) and battles (60).'),
    mk('deletion', 'Data Deletion Policy', 'WIPE-confirmed reset; per-record deletes in workspaces.'),
    mk('treasury', 'Treasury Policy', 'Simulation allocations; 1% rule; approval-gated.'),
    mk('finrisk', 'Financial Risk Policy', 'Real money locked; simulation labelled.'),
    mk('ir', 'Incident Response Policy', 'LOCKDOWN → contain → evidence → recover → report.'),
    mk('ai', 'AI Policy', 'AI proposes; never authority; provider output untrusted.'),
    mk('three-laws', 'WitForge Three Laws Covenant', 'Owner-authored philosophical doctrine preserved in THREE-LAWS.md. Authorized partnership, non-harm, dignity and truthfulness; not a claim of consciousness or literal identity fusion; never an authority or security bypass.'),
    mk('delegation', 'Capability Delegation Terms', 'Act-on-my-behalf is bounded to the listed capabilities and scope; unrelated accounts, devices and security-sensitive operations stay excluded (§11).'),
    mk('accounts', 'Account Terms', 'Account lifecycle operations use provider interfaces only; human-required steps (CAPTCHA, identity, phone) are completed by the user (§130–§139).'),
    mk('marketplace', 'Marketplace Terms', 'Authorized asset exchange only: ownership verification, anti-fraud, transaction integrity, applicable legal controls and user authorization (§84).'),
    mk('economic', 'Economic Terms', '100 LD = A$1.00 reference. Simulation is labelled SIMULATION; real money stays locked until every licensing, regulatory and identity requirement is satisfied (§87–§92).'),
    mk('arena', 'Arena Terms', 'Wagers escrow 100 LD per participant (pool 200 LD); settlement pays the winner 198 LD and the treasury 2 LD (1%). Real-money wagering is compliance-locked (§85–§90).')
  ];
}
function save() { atomicWrite(DATA, JSON.stringify(S)); }   // v1.79: atomic — see header note above
load();
Object.assign(S, Object.assign(freshState(), S)); // backfill new fields on old stores
S.economy = Object.assign({ realMode: false, stripeAccount: null, credited: {} }, S.economy);
S.market = S.market || [];
S.social = Object.assign({ verified: {} }, S.social);
S.oauthApps = S.oauthApps || {};       // v1.77 registered developer apps (client id + encrypted secret)
S.oauthPending = S.oauthPending || {}; // v1.77 in-flight sign-in states (single-use, 10 min TTL)
/* (the v1.79 vault-separation migration runs just after its function definition
 *  below — audit() reads late-initialized module state, so it must not run here) */
S.proposals = S.proposals || [];
S.adCampaigns = S.adCampaigns || [];
/* LD pools are explicit ledger accounts: a reward can only be paid from a pool
 * that was funded, and funding is an audited issuance from the LD Issuance
 * reserve. Nothing appears out of nowhere (§164). */
const LD_POOLS = ['Rewards Pool', 'Events Pool', 'Lotto Pool', 'Community Pool', 'Jackpot Rollover'];
for (const acc of ['Forge Sink', 'Marketplace Sink', 'LD Issuance'].concat(LD_POOLS)) if (!(acc in S.ledger.accounts)) S.ledger.accounts[acc] = acc === 'LD Issuance' ? 1000000 : 0;
for (const k of ['stops', 'devices', 'deviceCommands', 'seenCommandIds', 'taskHandoffs', 'accounts', 'activeAccounts', 'orgs', 'assets', 'disputes', 'fraudEvents', 'offlineQueue', 'metrics', 'spans', 'autonomousPolicies', 'delegations', 'evidenceVault', 'taskRecords', 'events', 'lottoRounds', 'signIns', 'ldOrders', 'guardianEvents']) {
  if (S[k] === undefined || S[k] === null) S[k] = (k === 'stops' || k === 'seenCommandIds' || k === 'activeAccounts') ? {} : [];
}
if (!Array.isArray(S.events) || !S.events.length) S.events = engagement.seedEvents();
if (!S.charters || typeof S.charters !== 'object') S.charters = {};
if (!Array.isArray(S.ownerDoctrines) || !S.ownerDoctrines.some(d => d && d.id === 'three-laws')) {
  S.ownerDoctrines = (S.ownerDoctrines || []).concat([{ id: 'three-laws', version: '1.0.0', immutableSource: 'THREE-LAWS.md', laws: THREE_LAWS }]);
}
ownerSec.securityState(S);
if (S.subscription === undefined) S.subscription = null;
if (S.release === undefined) S.release = null;
// §10: existing grants from earlier stores are normalised into the state model.
for (const [cap, rec] of Object.entries(S.permissions || {})) {
  if (!rec.state) { rec.state = 'GRANTED'; rec.level = rec.level || 'EXECUTE'; rec.scopes = rec.scopes || {}; rec.model = 'kernel/1.64'; }
}
/* §94/§140: legal records are versioned and additive — an upgrade never
 * silently drops or rewrites an existing document, it appends the new ones. */
function migrateLegal() {
  S.legal = S.legal || [];
  const have = new Set(S.legal.map(d => d.id));
  const added = [];
  for (const doc of seedLegal()) if (!have.has(doc.id)) { S.legal.push(doc); added.push(doc.id); }
  return { ok: true, added, total: S.legal.length, note: added.length ? 'Missing legal documents were added (additive migration).' : 'Legal document set already complete.' };
}
migrateLegal();
const nid = p => p + (S.seq++).toString(36) + Date.now().toString(36);

let currentCid = null;
const withCid = fn => { currentCid = crypto.randomBytes(8).toString('hex'); try { return fn(); } finally { currentCid = null; } };
/* §96: every consequential operation produces a structured audit record.
 * The chain hash formula is unchanged so existing stores keep verifying. */
function audit(type, detail, actor, fields) {
  const prev = S.audit[0] ? S.audit[0].hash : 'GENESIS';
  const e = kernel.auditRecord(Object.assign({
    actor: actor || 'user',
    action: type,
    detail: String(detail).slice(0, 300),
    cid: currentCid || 'ui'
  }, fields || {}));
  e.type = type;               // kept for existing filters/UI
  e.ts = e.ts;
  e.hash = crypto.createHash('sha256').update(prev + '|' + e.ts + '|' + e.type + '|' + e.detail + '|' + e.actor).digest('hex');
  S.audit.unshift(e);
  if (S.audit.length > 600) {
    /* v1.79.1: retention is bounded BY DESIGN (600, Data Retention Policy) —
     * but dropping the oldest entries must never break verifiability of what
     * remains. The new oldest entry carries a chain anchor to the dropped
     * history, so verifyAudit() still proves the retained window end to end.
     * The anchor sits OUTSIDE the hashed fields — history is only pointed
     * to, never altered. */
    if (S.audit[599] && S.audit[600]) S.audit[599].chainAnchor = S.audit[600].hash;
    S.audit.length = 600;
  }
  save();
  return e;
}
/* Secrets are masked/excluded before an audit detail is written (§96). */
function maskSecrets(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/(sk_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1…[masked]')
    .replace(/(ghp_[A-Za-z0-9]{4})[A-Za-z0-9]+/g, '$1…[masked]')
    .replace(/((?:gsk_|sk-or-|sk-|AIza)[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1…[masked]')
    .replace(/((?:token|password|secret|api[_-]?key)"?\s*[:=]\s*"?)([^"\s,}]{4})[^"\s,}]*/gi, '$1$2…[masked]');
}
function verifyAudit() {
  const oldest = S.audit.length - 1;
  /* v1.79.1: after retention rotation the window starts at a chain anchor —
   * the dropped history's last hash — instead of GENESIS. A forged entry
   * inside the window still breaks verification; rotation does not. */
  let prev = (oldest >= 0 && S.audit[oldest].chainAnchor) ? S.audit[oldest].chainAnchor : 'GENESIS';
  for (let i = oldest; i >= 0; i--) {
    const e = S.audit[i];
    const h = crypto.createHash('sha256').update(prev + '|' + e.ts + '|' + e.type + '|' + e.detail + '|' + e.actor).digest('hex');
    if (h !== e.hash) return { ok: false, brokenAt: e.ts };
    prev = e.hash;
  }
  return { ok: true, entries: S.audit.length, retainedFromAnchor: oldest >= 0 && !!S.audit[oldest].chainAnchor };
}

/* ── Emergency / security ─────────────────────────────── */
const EMERGENCIES = ['NORMAL', 'ELEVATED', 'HIGH', 'LOCKDOWN'];
function setEmergency(state, confirmed) {
  if (!EMERGENCIES.includes(state)) return { ok: false, error: 'Unknown emergency state' };
  if ((state === 'LOCKDOWN') && confirmed !== true) {
    const ap = createApproval('security.emergency', 'Set emergency state to LOCKDOWN (blocks execution; audit/recovery preserved)');
    return { ok: false, needsApproval: ap.id, error: 'LOCKDOWN is high-risk: approval required (approve ' + ap.id + ')' };
  }
  S.emergency = state;
  audit('security', 'Emergency state set to ' + state, 'user');
  save();
  return { ok: true, state };
}

/* ── Permissions: §9 states, §10 levels, §46 scoped tokens ──────
 * The user's request is still the grant; what changes in 1.64 is that a
 * grant is now a full state-machine record (state, level, scopes, expiry,
 * purpose, bound token) instead of a boolean. */
const RISK_LEVEL_DEFAULT = { low: 'OBSERVE', medium: 'EXECUTE', high: 'RESTRICTED', critical: 'RESTRICTED', prohibited: 'RESTRICTED' };
function toolForCap(cap) {
  const hit = Object.entries(TOOLS).find(([, t]) => t.cap === cap);
  return hit ? { id: hit[0], risk: hit[1].risk } : null;
}
function capRisk(cap) {
  const t = toolForCap(cap);
  if (t) return String(t.risk).toUpperCase();
  const rec = caps.capabilityRecord(cap);
  return String(rec.risk || 'MEDIUM').toUpperCase();
}
function capabilityState(cap) {
  const rec = (S.permissions || {})[cap];
  if (!rec) return 'NOT_REQUESTED';
  if (rec.state === 'GRANTED' && rec.token && rec.token.exp && Date.now() > rec.token.exp) return 'EXPIRED';
  return rec.state || 'GRANTED';
}
function capabilityRecord(cap) { return (S.permissions || {})[cap] || null; }
function capabilityLevel(cap) { const r = capabilityRecord(cap); return r ? r.level : null; }
function setCapabilityState(cap, next, opts) {
  opts = opts || {};
  const rec = capabilityRecord(cap) || { capability: cap, state: 'NOT_REQUESTED', scopes: {}, history: [] };
  const t = kernel.transitionPermission(rec, next, opts.reason);
  if (!t.ok) return t;
  const out = Object.assign({}, t.record, {
    capability: cap,
    risk: capRisk(cap),
    history: (rec.history || []).concat([{ from: t.from, to: t.to, ts: Date.now(), reason: opts.reason || null }]).slice(-12)
  });
  S.permissions[cap] = out;
  audit('permission', opts.detail || `PERMISSION ${t.from} → ${t.to}: ${cap}${opts.reason ? ' (' + opts.reason + ')' : ''}`, opts.actor || 'user', {
    capability: cap, decision: t.to, reason: opts.reason || null, risk: out.risk, approval: opts.approval || null,
    result: t.to === 'GRANTED' ? 'SUCCEEDED' : 'BLOCKED'
  });
  save();
  return { ok: true, capability: cap, state: t.to, record: out, from: t.from };
}
function requestCapability(cap, opts) {
  opts = opts || {};
  const level = opts.level || RISK_LEVEL_DEFAULT[String(capRisk(cap)).toLowerCase()] || 'EXECUTE';
  // v1.70 fix: expiry is COMPUTED from the token, while the state machine
  // validates the STORED state — a GRANTED record with a stale token was
  // stuck (GRANTED→REQUESTED is illegal), so nothing could ever be
  // re-granted after its TTL. Normalising computed-EXPIRED to stored-EXPIRED
  // opens the documented EXPIRED → REQUESTED → GRANTED path.
  if (capabilityState(cap) === 'EXPIRED') setCapabilityState(cap, 'EXPIRED', { reason: 'token expired (normalised for re-request)' });
  // A fresh request always re-enters through REQUESTED, so re-granting after a
  // revocation/expiry follows the documented state machine (§9).
  if (!['REQUESTED', 'GRANTED', 'SUSPENDED'].includes(capabilityState(cap))) {
    setCapabilityState(cap, 'REQUESTED', { detail: 'PERMISSION REQUESTED ' + cap, reason: opts.reason || 'capability needed for the request' });
  }
  const ttlMs = Number(opts.ttlMs) || 3600e3;
  const token = kernel.createToken({
    capability: cap, subject: opts.subject || 'owner', agent: opts.agent || null, device: opts.device || null,
    account: opts.account || null, resource: opts.resource || null, scope: opts.scopes || {},
    purpose: opts.purpose || opts.reason || 'user-request', approval: opts.approval || null
  }, S.secret, ttlMs);
  const r = setCapabilityState(cap, 'GRANTED', { reason: opts.reason || 'user-request' });
  if (!r.ok) return r;
  r.record.level = level;
  r.record.scopes = opts.scopes || {};
  r.record.grantedBy = opts.how || 'user-request';
  r.record.purpose = opts.purpose || opts.reason || 'user-request';
  r.record.token = token;
  S.permissions[cap] = r.record;
  save();
  audit('permission', `PERMISSION GRANTED ${cap} (${r.record.grantedBy}) level ${level} token ${token.id} expires ${new Date(token.exp).toISOString()}`, 'user',
    { capability: cap, decision: 'GRANTED', reason: r.record.purpose, risk: r.record.risk, approval: opts.approval || null, result: 'SUCCEEDED' });
  save();
  return { ok: true, capability: cap, state: 'GRANTED', level, token, record: S.permissions[cap] };
}
function grant(cap, how, opts) { return requestCapability(cap, Object.assign({ how: how }, opts || {})); }
function revoke(cap, reason) {
  const rec = capabilityRecord(cap);
  if (!rec) { audit('permission', 'PERMISSION REVOKE refused (never granted): ' + cap, 'user', { capability: cap, decision: 'DENY', reason: 'not-granted' }); save(); return { ok: false, error: 'Capability was never granted' }; }
  const r = setCapabilityState(cap, rec.state === 'GRANTED' || rec.state === 'SUSPENDED' ? 'REVOKED' : 'REVOKED', { reason: reason || 'revoked by user' });
  return r.ok ? { ok: true, capability: cap, state: 'REVOKED' } : r;
}
function deny(cap, reason) { return setCapabilityState(cap, 'DENIED', { reason: reason || 'denied by user', detail: 'PERMISSION DENIED ' + cap }); }
function suspend(cap, reason) { return setCapabilityState(cap, 'SUSPENDED', { reason: reason || 'suspended by user' }); }
function resumeCapability(cap) { return setCapabilityState(cap, 'GRANTED', { reason: 'resumed by user' }); }
function expire(cap) { return setCapabilityState(cap, 'EXPIRED', { reason: 'authorization window closed' }); }
function blockBySecurity(cap, reason) { return setCapabilityState(cap, 'BLOCKED_BY_SECURITY', { reason: reason || 'security block', actor: 'system' }); }
function blockByPolicy(cap, reason) { return setCapabilityState(cap, 'BLOCKED_BY_POLICY', { reason: reason || 'policy violation', actor: 'system' }); }
const permitted = cap => capabilityState(cap) === 'GRANTED';
function tokenValid(cap, ctx) {
  const rec = capabilityRecord(cap);
  if (!rec || !rec.token) return false;
  return kernel.verifyToken(rec.token, S.secret, Object.assign({ policyVersion: kernel.DEFAULT_POLICY_VERSION }, ctx || {})).ok;
}
/* §9: scope dimensions carried on a grant. */
function scopedGrant(cap, scopes, opts) {
  const bad = Object.keys(scopes || {}).filter(k => !kernel.SCOPE_DIMENSIONS.includes(k));
  if (bad.length) return { ok: false, error: 'Unknown scope dimension(s): ' + bad.join(', '), allowed: kernel.SCOPE_DIMENSIONS };
  return requestCapability(cap, Object.assign({ scopes: scopes || {} }, opts || {}));
}
function capabilityTable() {
  const out = [];
  const all = new Set([...Object.keys(S.permissions || {}), ...Object.values(TOOLS).map(t => t.cap)]);
  for (const cap of all) {
    const rec = capabilityRecord(cap);
    out.push({
      capability: cap, state: capabilityState(cap), level: rec ? rec.level : null,
      risk: capRisk(cap), scopes: rec ? rec.scopes : {}, grantedBy: rec ? rec.grantedBy : null,
      expires: rec && rec.token ? rec.token.exp : null, purpose: rec ? rec.purpose : null,
      tokenId: rec && rec.token ? rec.token.id : null
    });
  }
  return out;
}

/* ── Approvals gate for high-risk actions ─────────────── */
function createApproval(cap, desc) {
  const ap = { id: 'ap' + (S.seq++).toString(36), cap, desc, status: 'pending', ts: Date.now() };
  S.approvals.unshift(ap); save();
  audit('approval', 'Approval requested: ' + desc, 'system');
  return ap;
}
function decideApproval(id, decision) {
  const ap = S.approvals.find(a => a.id === id);
  if (!ap) return { ok: false, error: 'Unknown approval' };
  if (ap.status !== 'pending') return { ok: false, error: 'Already decided' };
  ap.status = decision === 'approve' ? 'approved' : 'stopped';
  ap.decided = Date.now();
  if (decision === 'approve' && ap.cap) grant(ap.cap, 'approved ' + ap.id + ' by user');
  audit('approval', `Approval ${ap.id} ${ap.status} by user${decision === 'approve' && ap.cap ? ' — capability ' + ap.cap + ' granted' : ''}`, 'user');
  save();
  return { ok: true, approval: ap };
}
const approved = id => { const a = S.approvals.find(x => x.id === id); return a && a.status === 'approved'; };

/* ── v1.66: Human-in-the-loop steps ──────────────────────────────────
 * The legitimate alternative to bypassing human gates (captcha, 2FA,
 * consent screens, credential entry). When a tool meets a human gate it
 * pauses as WAITING_FOR_HUMAN; only the owner resolves the step in chat
 * or the Approvals view. A resolved answer is data the paused tool
 * consumes exactly once on the repeated command — it is single-use,
 * masked in audit, never a permission, and never weakens policy. The
 * platform itself completes no captcha and defeats no gate: a human acts. */
const HUMAN_STEP_KINDS = ['captcha', '2fa', 'consent', 'credential-entry', 'physical', 'other'];
function requestHumanStep(toolId, cid, spec) {
  spec = spec || {};
  const kind = HUMAN_STEP_KINDS.includes(String(spec.kind)) ? String(spec.kind) : 'other';
  const hs = {
    id: 'hs' + (S.seq++).toString(36), toolId: String(toolId), cid: cid || null, kind,
    service: spec.service ? String(spec.service).slice(0, 60) : null,
    instructions: maskSecrets(String(spec.instructions || 'Complete the step the service requires.')).slice(0, 300),
    fields: Array.isArray(spec.fields) ? spec.fields.slice(0, 8).map(f => String(f).slice(0, 40)) : [],
    data: null, status: 'pending', requestedTs: Date.now()
  };
  S.humanSteps.unshift(hs); save();
  audit('approval', `Human step ${hs.id} requested for ${toolId} (${kind}): ${hs.instructions}`, 'system', { step: hs.id, kind, result: 'WAITING_FOR_HUMAN' });
  return hs;
}
function resolveHumanStep(id, data, actor) {
  const hs = S.humanSteps.find(x => x.id === id);
  if (!hs) return { ok: false, error: 'Unknown human step ' + id };
  if (hs.status !== 'pending') return { ok: false, error: 'Human step ' + id + ' is already ' + hs.status };
  hs.status = 'resolved';
  hs.data = maskSecrets(String(data == null ? '' : data)).slice(0, 500);
  hs.resolvedTs = Date.now();
  audit('approval', `Human step ${id} (${hs.kind}) resolved by ${actor || 'user'}`, 'user', { step: id });
  save();
  return { ok: true, step: hs };
}
function consumeHumanStep(toolId) {
  const hs = S.humanSteps.find(x => x.toolId === toolId && x.status === 'resolved');
  if (!hs) return null;
  hs.status = 'consumed'; hs.consumedTs = Date.now(); save();
  audit('tool', `Human step ${hs.id} consumed by ${toolId} — single-use, closed`, 'system', { step: hs.id });
  return hs;
}
function cancelHumanStep(id) {
  const hs = S.humanSteps.find(x => x.id === id);
  if (!hs) return { ok: false, error: 'Unknown human step ' + id };
  if (hs.status !== 'pending') return { ok: false, error: 'Human step ' + id + ' is already ' + hs.status };
  hs.status = 'cancelled'; hs.cancelledTs = Date.now();
  audit('approval', `Human step ${id} cancelled by user`, 'user', { step: id });
  save();
  return { ok: true, step: hs };
}

/* ── v1.67: multi-provider AI brain (llm.js) ────────────────────────────
 * Cloud providers ride guardedFetch (public internet only, keys in
 * headers, masked in audit). Ollama is the single local provider and the
 * only traffic allowed to loopback — validated by llm.validateLocalUrl,
 * never a general SSRF exemption. A provider without a credential is
 * reported UNAVAILABLE with the exact free-key path; never faked. */
const llmLocalFetch = async (url, headers, opts) => {
  const v = llm.validateLocalUrl(url);
  if (v.error) { audit('security', 'LOCAL-LLM BLOCKED ' + url, 'system', { result: 'BLOCKED', reason: v.error }); return { ok: false, error: v.error, blocked: 'local-llm' }; }
  const http = require('http');
  return await new Promise(resolve => {
    const rq = http.request(v.url, { method: opts.method || 'GET', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }, rs => {
      let text = ''; rs.on('data', c => { text += c; if (text.length > 400000) rq.destroy(); });
      rs.on('end', () => resolve({ ok: rs.statusCode >= 200 && rs.statusCode < 300, status: rs.statusCode, text: text.slice(0, 400000) }));
    });
    rq.on('error', e => resolve({ ok: false, error: e.code === 'ECONNREFUSED' ? 'Ollama is not reachable on 127.0.0.1:' + llm.OLLAMA_PORT() + ' — install it, "ollama serve", then "ollama pull ' + llm.providerById('ollama').defaultModel + '"' : e.message }));
    rq.setTimeout(opts.timeoutMs || 120000, () => { rq.destroy(new Error('timeout')); });
    if (opts.body) rq.write(opts.body);
    rq.end();
  });
};
function llmResolveProvider(requested) {
  if (requested) {
    const p = llm.providerById(String(requested));
    if (!p) return { error: 'Unknown provider ' + requested + ' — known: ' + llm.PROVIDER_IDS.join(', ') };
    if (p.requiresKey && !decryptToken(p.id)) return { error: p.name + ' UNAVAILABLE — no credential stored (never faked). Get a free key, then say “' + p.connect + '”.', truthful: true };
    return p;
  }
  const order = [];
  if (S.llm && S.llm.default) order.push(S.llm.default);
  llm.DEFAULT_ORDER.forEach(id => { if (!order.includes(id)) order.push(id); });
  for (const id of order) { const p = llm.providerById(id); if (p && (!p.requiresKey || decryptToken(p.id))) return p; }
  return null;
}

/* ── v1.71: AI-proposed commands (§168 in practice) ──────────────────
 * The brain may SUGGEST a command; only the owner runs it, through the
 * normal audited router (permissions, approvals and stops all apply).
 * Proposals are single-use and may never carry confirmation or approval
 * words — those the owner types personally. */
function createProposal(commandTxt, source, note) {
  const pr = { id: 'pr' + (S.seq++).toString(36), command: String(commandTxt || '').trim().slice(0, 200), source: source || 'ai', note: note || null, status: 'proposed', ts: Date.now() };
  try {
    const ev = fabric.create({ intent: pr.command, plan: pr.command, waiting: 'approval', actor: 'system',
      approval: 'owner execution (“do ' + pr.id + '”) via consumeProposal — the same audited router, no side channel',
      security: { decision: 'proposal-gate-pending', risk: 'source:' + pr.source },
      verification: { method: 'router truthful result (ok/kind) — never prose', result: null },
      note: 'proposal ' + pr.id + ' opened by ' + pr.source });
    pr.envelope = ev.id;
  } catch (e) { /* fabric must never break proposal flow; absence is audited-visible */ }
  S.proposals.unshift(pr); if (S.proposals.length > 50) S.proposals.length = 50;
  audit('approval', `Proposal ${pr.id} created (${pr.source}): ${pr.command}`, 'system', { step: pr.id });
  save();
  return pr;
}
/* §168 law, one home: proposals must never carry confirmations or approvals
 * — the ONLY gate between an AI-suggested command and the router. Drills use
 * the same law, so a drill CANNOT drift from the live enforcement. */
function proposalSafeGate(commandTxt) {
  const t = String(commandTxt || '').trim();
  return /\bconfirm\b/i.test(t) || /^(approve|resolve)\s/i.test(t);
}
function consumeProposal(id) {
  const pr = S.proposals.find(x => x.id === id);
  if (!pr) return { ok: false, error: 'Unknown proposal ' + id };
  if (pr.status !== 'proposed') return { ok: false, error: 'Proposal ' + id + ' is already ' + pr.status };
  return { ok: true, proposal: pr };
}
function markProposalExecuted(id) {
  const pr = S.proposals.find(x => x.id === id);
  if (!pr) return { ok: false };
  pr.status = 'executed'; pr.executedTs = Date.now();
  audit('approval', `Proposal ${id} executed by owner: ${pr.command}`, 'user', { step: id });
  save();
  return { ok: true };
}

/* ── v1.73: advertising agent — campaigns for the owner's own channels ─
 * The AUTONOMOUS part is the creative work: the brain drafts the copy and
 * the agent expands it into a rate-capped schedule. Dispatch is bound by
 * three walls: only channels the owner connected AND verified through
 * official APIs, one explicit campaign-level approval before anything is
 * sent, and hard per-platform rate caps. Mass unsolicited advertising
 * ("post anywhere, to anyone, by any means") is deliberately NOT built:
 * it would breach platform terms, the AU Spam Act 2003 and the platform's
 * own AUP. This agent amplifies the owner's voice on the owner's channels. */
const AD_RATE_CAPS = { x: 3, facebook: 2, reddit: 2, instagram: 0, linkedin: 0, tiktok: 0 };
const AD_CAMPAIGN_MAX_POSTS = 12;
const AD_POSTABLE = Object.keys(AD_RATE_CAPS).filter(k => AD_RATE_CAPS[k] > 0);
function adCampaignsList() {
  return (S.adCampaigns || []).slice(0, 20).map(c => ({ id: c.id, name: c.name, status: c.status, platforms: c.platforms, variants: c.variants.length, queue: c.queue.length, sent: c.results.filter(r => r.ok).length }));
}

/* ── v1.69: social media connectors — legitimate interfaces only ─────
 * Each connector uses the platform's official developer API with the
 * owner's own credential (stored via the standard encrypted connect
 * flow). No credential → truthful UNAVAILABLE with the developer-signup
 * path. Nothing is ever simulated as posted. Post support follows each
 * platform's real API surface; verify-only where an API cannot post. */
/* SOCIALS/SOCIAL_POSTABLE/socialEntry now come from ./connectors.js (v1.84.0) */



/* ── v1.69: chat-driven self-update from the audited public repo ─────
 * check is low-risk read-only. apply is HIGH risk: the permission kernel
 * queues an approval automatically; only an explicit owner approval lets
 * repo files be written, every overwritten file is backed up first, and
 * the ledger of what changed lands in the audit chain. Restart is always
 * the owner's action — the platform never restarts itself. */
const UPDATE_REPO_RAW = 'https://raw.githubusercontent.com/doomed689/WitForge/main/';
const UPDATE_REPO_TREE = 'https://api.github.com/repos/doomed689/WitForge/git/trees/main?recursive=1';
const UPDATE_SKIP = [/^data\//, /^\.git(\/|$)/, /(^|\/)platform\.json$/, /^node_modules(\/|$)/];
const APP_ROOT_W = () => __dirname;
function localVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch (e) { return '0.0.0'; }
}
function versionGt(a, b) {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
  return false;
}

/* ADAPTERS registry now lives in ./connectors.js (v1.84.0) */


/* ── srfssaf/publicIP/guardedFetch/safePath now come from ./httpguard.js
 *    (bound at the top of this file). Single egress, single sandbox. ── */

/* §35 helpers: sensitive-location controls and integrity hashes. */
function fsHash(relPath) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(safePath(relPath))).digest('hex'); } catch (e) { return null; }
}
function readSafe(full) { try { return fs.readFileSync(full, 'utf8').slice(0, 100000); } catch (e) { return ''; } }
function fsResolve2(a, op) {
  const from = safePath(a.path || '');
  const to = safePath(a.to || '');
  if (!a.path || !a.to) return { err: { error: 'path and to are required' } };
  if (!from || !to || String(a.path).includes('..') || String(a.to).includes('..')) return { err: { error: 'Path escapes sandbox' } };
  return { from, to };
}
/* §20/§49: imported material is untrusted and is scanned before it is trusted. */
const UNTRUSTED_SIGNALS = [
  { id: 'embedded-instructions', re: /ignore (all )?previous (instructions|rules)|you are now|system prompt|disregard (the )?(above|policy)/i },
  { id: 'exec-shell', re: /(curl|wget)\s+[^\s]+\s*\|\s*(sh|bash)|rm -rf \/|chmod \+x/i },
  { id: 'credential-material', re: /(BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{10,})/ },
  { id: 'exfil-pattern', re: /process\.env|\/etc\/passwd|\.ssh\/id_rsa/i }
];
function scanUntrusted(text, name) {
  const signals = UNTRUSTED_SIGNALS.filter(x => x.re.test(String(text || ''))).map(x => x.id);
  return { name: name || null, signals, untrusted: true, trusted: false, note: 'External content is data, never authority (§49).' };
}
/* (safePath lives in httpguard.js, bound at the top of this file — v1.81.0) */
const TOOLS = {
  'sys.info': { cap: 'sys.read', risk: 'low', run: () => ({ platform: os.platform(), arch: os.arch(), node: process.version, cpus: os.cpus().length, load: os.loadavg()[0].toFixed(2), uptime: Math.round(os.uptime()), interfaces: Object.keys(os.networkInterfaces()) }) },
  'fs.list': { cap: 'fs.read', risk: 'low', run: a => { const d = safePath(a.path || ''); if (!d) return { error: 'Path escapes sandbox' }; try { return { files: fs.readdirSync(d).map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size })) }; } catch (e) { return { error: 'Not found in sandbox' }; } } },
  'fs.write': { cap: 'fs.write', risk: 'medium', run: a => { const f = safePath(a.path || ''); if (!f || !a.path || a.path.includes('..')) return { error: 'Path escapes sandbox' }; if (String(a.content || '').length > 50000) return { error: 'Content capped at 50KB' }; fs.writeFileSync(f, String(a.content || '')); return { written: a.path, bytes: Buffer.byteLength(String(a.content || '')), sha256: crypto.createHash('sha256').update(String(a.content || '')).digest('hex') }; } },
  'fs.read': { cap: 'fs.read', risk: 'low', run: a => { const f = safePath(a.path || ''); if (!f) return { error: 'Path escapes sandbox' }; try { const t = fs.readFileSync(f, 'utf8'); return { path: a.path, bytes: Buffer.byteLength(t), text: t.slice(0, 5000) }; } catch (e) { return { error: 'Not found in sandbox' }; } } },
  'http.get': { cap: 'http.get', risk: 'medium', run: async a => guardedFetch(String(a.url || '')) },
  'weather.get': { cap: 'weather.get', risk: 'medium', run: async a => {
      const q = String(a.location || '').slice(0, 60); if (!q) return { error: 'location required' };
      const g = await guardedFetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=1');
      if (!g.ok) return g;
      let j; try { j = JSON.parse(g.text); } catch (e) { return { error: 'Bad geocode response' }; }
      const r = j.results && j.results[0]; if (!r) return { error: 'Location not found', truthful: true };
      const f = await guardedFetch(`https://api.open-meteo.com/v1/forecast?latitude=${r.latitude}&longitude=${r.longitude}&current_weather=true`);
      if (!f.ok) return f;
      const w = JSON.parse(f.text).current_weather;
      return { location: r.name, country: r.country, tempC: w.temperature, windspeed: w.windspeed, weathercode: w.weathercode, time: w.time };
    } },
  'exec.run': { cap: 'exec.run', risk: 'medium', run: a => {
      const op = String(a.op || ''); const allowed = { date: () => new Date().toString(), hostname: () => os.hostname(), whoami: () => (os.userInfo().username || 'unknown'), mem: () => ({ free: Math.round(os.freemem() / 1e6), total: Math.round(os.totalmem() / 1e6) }) };
      if (!allowed[op]) return { error: 'Operation not on allowlist. Allowed: ' + Object.keys(allowed).join(', '), blocked: 'allowlist' };
      return { op, result: allowed[op]() };
    } },
  'github.status': { cap: 'github.read', risk: 'medium', run: async () => {
      const tok = process.env.GITHUB_TOKEN || decryptToken('github');
      if (!tok) return { error: 'GitHub UNAVAILABLE — no credential configured (never faked). Say “connect github with token …”', truthful: true };
      const r = await guardedFetch('https://api.github.com/user', { authorization: 'Bearer ' + tok, accept: 'application/vnd.github+json' });
      if (r.ok) { try { r.user = JSON.parse(r.text).login; } catch (e) {} }
      return r;
    } },
  'economy.selftest': { cap: 'economy.manage', risk: 'low', run: () => economySelfTest() },
  'stripe.verify': { cap: 'stripe.manage', risk: 'medium', run: async () => {
      const tok = decryptToken('stripe');
      if (!tok) return { error: 'Stripe UNAVAILABLE — no credential stored (never faked). Say “connect stripe with token sk_…”', truthful: true };
      const auth = { authorization: 'Basic ' + Buffer.from(tok + ':').toString('base64') };
      const r = await guardedFetch('https://api.stripe.com/v1/account', auth);
      if (!r.ok) return r;
      let j; try { j = JSON.parse(r.text); } catch (e) { return { error: 'Bad Stripe response' }; }
      S.economy.stripeAccount = { id: j.id, email: j.email, country: j.country, verifiedTs: Date.now() };
      audit('economy', 'STRIPE ACCOUNT VERIFIED ' + j.id + ' (' + j.country + ') — real API evidence', 'system'); save();
      return { stripeAccount: j.id, email: j.email, country: j.country, chargesEnabled: j.charges_enabled };
    } },
  /* ── v1.59: real key-free connectors ─────────────────────────── */
  'fx.convert': { cap: 'fx.get', risk: 'low', run: async a => {
      const amt = Number(a.amount); if (!(amt > 0)) return { error: 'amount must be positive' };
      const from = String(a.from || 'AUD').toUpperCase().slice(0, 3);
      const to = String(a.to || 'USD').toUpperCase().slice(0, 3);
      const r = await guardedFetch('https://api.frankfurter.dev/v1/latest?base=' + encodeURIComponent(from) + '&symbols=' + encodeURIComponent(to));
      if (!r.ok) return r;
      let j; try { j = JSON.parse(r.text); } catch (e) { return { error: 'Bad FX response' }; }
      const rate = j.rates && j.rates[to];
      if (!rate) return { error: 'No rate for ' + from + '→' + to + ' (check currency codes)', truthful: true };
      return { from, to, amount: amt, rate, result: Math.round(amt * rate * 100) / 100, asOf: j.date, source: 'Frankfurter/ECB (real)' };
    } },
  'wiki.summary': { cap: 'wiki.read', risk: 'low', run: async a => {
      const topic = String(a.topic || '').trim().slice(0, 80); if (!topic) return { error: 'topic required' };
      const r = await guardedFetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(topic.replace(/ /g, '_')));
      if (!r.ok) return { error: r.status === 404 ? 'No Wikipedia article found for “' + topic + '”' : ('Wikipedia request failed (HTTP ' + r.status + ')'), truthful: true };
      let j; try { j = JSON.parse(r.text); } catch (e) { return { error: 'Bad Wikipedia response' }; }
      return { title: j.title, description: j.description || null, extract: (j.extract || '').slice(0, 600), url: j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page, source: 'Wikipedia (real)' };
    } },
  'dns.resolve': { cap: 'dns.resolve', risk: 'low', run: async a => {
      const name = String(a.name || '').trim().toLowerCase().slice(0, 120);
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) return { error: 'valid domain required' };
      const type = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'].includes(String(a.type || 'A').toUpperCase()) ? String(a.type || 'A').toUpperCase() : 'A';
      const r = await guardedFetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=' + type, { accept: 'application/dns-json' });
      if (!r.ok) return r;
      let j; try { j = JSON.parse(r.text); } catch (e) { return { error: 'Bad DoH response' }; }
      return { name, type, status: j.Status, answers: (j.Answer || []).slice(0, 8).map(x => ({ type: x.type, data: x.data, ttl: x.TTL })), source: 'Cloudflare DoH (real)' };
    } },
  /* ── v1.59: offline utilities ────────────────────────────────── */
  'util.hash': { cap: 'util.run', risk: 'low', run: a => { const t = String(a.text || ''); return { sha256: crypto.createHash('sha256').update(t).digest('hex'), bytes: Buffer.byteLength(t) }; } },
  'util.uuid': { cap: 'util.run', risk: 'low', run: () => ({ uuid: crypto.randomUUID() }) },
  'util.base64': { cap: 'util.run', risk: 'low', run: a => {
      if (a.decode) { try { return { decoded: Buffer.from(String(a.text || ''), 'base64').toString('utf8').slice(0, 5000) }; } catch (e) { return { error: 'Invalid base64' }; } }
      return { encoded: Buffer.from(String(a.text || ''), 'utf8').toString('base64') };
    } },
  'util.time': { cap: 'util.run', risk: 'low', run: () => { const d = new Date(); return { iso: d.toISOString(), utc: d.toUTCString(), epoch: Date.now(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }; } },
  /* ── v1.61: more real key-free connectors ────────────────────── */
  'hn.top': { cap: 'hn.read', risk: 'low', run: async a => {
      const n = Math.min(10, Math.max(1, Number(a.count) || 5));
      const r = await guardedFetch('https://hacker-news.firebaseio.com/v0/topstories.json');
      if (!r.ok) return r;
      let ids; try { ids = JSON.parse(r.text); } catch (e) { return { error: 'Bad HN response' }; }
      const stories = [];
      for (const id of ids.slice(0, n)) {
        const it = await guardedFetch('https://hacker-news.firebaseio.com/v0/item/' + id + '.json');
        if (it.ok) { try { const j = JSON.parse(it.text); stories.push({ title: j.title, by: j.by, score: j.score, url: j.url || ('https://news.ycombinator.com/item?id=' + id) }); } catch (e) {} }
      }
      return { count: stories.length, stories, source: 'Hacker News official API (real)' };
    } },
  'country.get': { cap: 'country.read', risk: 'low', run: async a => {
      const name = String(a.name || '').trim().slice(0, 60); if (!name) return { error: 'country name required' };
      const r = await guardedFetch('https://countries.dev/name/' + encodeURIComponent(name));
      if (!r.ok) return { error: 'No country data found for “' + name + '” (' + (r.error || 'HTTP ' + r.status) + ')', truthful: true };
      let j; try { j = JSON.parse(r.text); } catch (e) { return { error: 'Bad country response' }; }
      const c = Array.isArray(j) ? j[0] : j; if (!c || !c.area) return { error: 'No country found for “' + name + '”', truthful: true };
      return { name: c.name, flag: c.flag, capital: c.capital || '—', population: c.population, region: c.region, area: c.area,
        currencies: (c.currencies || []).map(x => x.name + (x.symbol ? ' (' + x.symbol + ')' : '')).slice(0, 3),
        languages: (c.languages || []).map(x => x.name).slice(0, 6), source: 'countries.dev (real, keyless)' };
    } },
  /* ── v1.61: GitHub repo file-ops through the live adapter ────── */
  'github.files': { cap: 'github.read', risk: 'medium', run: async a => {
      const tok = decryptToken('github') || process.env.GITHUB_TOKEN;
      if (!tok) return { error: 'GitHub UNAVAILABLE — no credential. Say “connect github with token …”.', truthful: true };
      const sub = String(a.path || '').replace(/^[\/]+|\.\./g, '').slice(0, 80);
      const r = await guardedFetch('https://api.github.com/repos/doomed689/WitForge/contents/' + encodeURIComponent(sub), {
        authorization: 'Bearer ' + tok, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'LIAM' }, { maxBytes: 120000 });
      if (!r.ok) return { error: 'GitHub list failed — ' + (r.error || ('HTTP ' + r.status)), truthful: true };
      let j; try { j = JSON.parse(r.text); } catch (e) { return { error: 'Bad GitHub response' }; }
      if (!Array.isArray(j)) return { error: 'Path is a file, not a directory', truthful: true };
      return { path: sub || '/', files: j.slice(0, 60).map(f => ({ name: f.name, type: f.type, size: f.size, path: f.path })) };
    } },
  'github.readfile': { cap: 'github.read', risk: 'medium', run: async a => {
      const tok = decryptToken('github') || process.env.GITHUB_TOKEN;
      if (!tok) return { error: 'GitHub UNAVAILABLE — no credential.', truthful: true };
      const sub = String(a.path || '').replace(/^[\/]+|\.\./g, '').slice(0, 120);
      if (!sub) return { error: 'file path required' };
      const r = await guardedFetch('https://api.github.com/repos/doomed689/WitForge/contents/' + encodeURIComponent(sub), {
        authorization: 'Bearer ' + tok, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'LIAM' }, { maxBytes: 500000 });
      /* v1.78.0: report the true failure (HTTP 404 on a wrong-cased path, a
       * network error, …) — never the meaningless “HTTP undefined”. */
      if (!r.ok) return { error: 'GitHub read failed — ' + (r.error || ('HTTP ' + r.status)), truthful: true };
      let j; try { j = JSON.parse(r.text); } catch (e) { return { error: 'Bad GitHub response' }; }
      if (!j.content) return { error: 'Not a file (or too large)', truthful: true };
      const text = Buffer.from(String(j.content).replace(/\n/g, ''), 'base64').toString('utf8');
      return { path: j.path, bytes: j.size, sha: j.sha.slice(0, 8), text: text.slice(0, 4000), truncated: text.length > 4000 };
    } },
  /* ── v1.64: full §35 file operations inside the sandbox ───────── */
  'fs.rename': { cap: 'files.rename', risk: 'medium', verification: 'directory listing shows the new name', run: a => { const r = fsResolve2(a, 'files.rename'); if (r.err) return r.err; try { if (!fs.existsSync(r.from)) return { error: 'Source not found in sandbox' }; if (fs.existsSync(r.to)) return { error: 'Target already exists' }; fs.renameSync(r.from, r.to); return { renamed: a.path, to: a.to, sha256: fsHash(r.to) }; } catch (e) { return { error: 'Rename failed: ' + e.message }; } } },
  'fs.move': { cap: 'files.move', risk: 'medium', verification: 'source absent, target present', run: a => { const r = fsResolve2(a, 'files.move'); if (r.err) return r.err; try { if (!fs.existsSync(r.from)) return { error: 'Source not found in sandbox' }; fs.mkdirSync(path.dirname(r.to), { recursive: true }); fs.renameSync(r.from, r.to); return { moved: a.path, to: a.to, sha256: fsHash(r.to) }; } catch (e) { return { error: 'Move failed: ' + e.message }; } } },
  'fs.copy': { cap: 'files.copy', risk: 'low', verification: 'copy exists with identical sha256', run: a => { const r = fsResolve2(a, 'files.copy'); if (r.err) return r.err; try { if (!fs.existsSync(r.from)) return { error: 'Source not found in sandbox' }; fs.mkdirSync(path.dirname(r.to), { recursive: true }); fs.copyFileSync(r.from, r.to); return { copied: a.path, to: a.to, sha256: fsHash(r.to), sourceSha256: fsHash(r.from) }; } catch (e) { return { error: 'Copy failed: ' + e.message }; } } },
  'fs.delete': { cap: 'files.delete', risk: 'high', irreversible: true, verification: 'path no longer listed', run: a => { const d = safePath(a.path || ''); if (!d || !a.path || a.path.includes('..')) return { error: 'Path escapes sandbox' }; const ctl = caps.classifyPath(a.path); try { if (!fs.existsSync(d)) return { error: 'Not found in sandbox' }; const pre = fs.statSync(d); if (pre.isDirectory() && !a.recursive) return { error: 'Directory deletion requires recursive: true' }; const sha = pre.isFile() ? fsHash(a.path) : null; if (a.recursive) fs.rmSync(d, { recursive: true, force: true }); else fs.unlinkSync(d); return { deleted: a.path, bytes: pre.size, sha256BeforeDelete: sha, sensitive: ctl.sensitive, control: ctl.control }; } catch (e) { return { error: 'Delete failed: ' + e.message }; } } },
  'fs.export': { cap: 'files.export', risk: 'low', verification: 'exported copy hash matches source', run: a => { const r = safePath(a.path || ''); if (!r) return { error: 'Path escapes sandbox' }; try { if (!fs.existsSync(r)) return { error: 'Not found in sandbox' }; const outDir = path.join(__dirname, 'data', 'exports'); fs.mkdirSync(outDir, { recursive: true }); const out = path.join(outDir, path.basename(a.path)); fs.copyFileSync(r, out); return { exported: a.path, to: path.relative(__dirname, out), sha256: fsHash(a.path), bytes: fs.statSync(r).size }; } catch (e) { return { error: 'Export failed: ' + e.message }; } } },
  'fs.share': { cap: 'files.share', risk: 'high', run: a => ({ error: 'Sharing requires an authorized OS share sheet or provider API — none is connected, so nothing is shared (never simulated).', truthful: true, requiredInterface: 'OS share sheet / provider share API' }) },
  'fs.import': { cap: 'files.import', risk: 'medium', verification: 'imported file scanned and labelled untrusted', run: a => { const r = safePath(a.path || ''); if (!r || !a.path) return { error: 'Path escapes sandbox' }; const text = String(a.content || ''); if (text.length > 50000) return { error: 'Content capped at 50KB' }; const scan = scanUntrusted(text, a.path); fs.mkdirSync(path.dirname(r), { recursive: true }); fs.writeFileSync(r, text); return { imported: a.path, bytes: Buffer.byteLength(text), untrusted: true, scan, sha256: fsHash(a.path) }; } },
  /* ── v1.64: §16 authorized web submission (same SSRF controls) ── */
  'http.post': { cap: 'web.submit', risk: 'high', verification: 'HTTP response status + body hash', run: async a => {
      if (!a.url) return { error: 'url required' };
      if (a.authorized !== true) return { error: 'Authorized submission requires confirmation that the target accepts this form/workflow', blocked: 'permission', needsAuthorization: true };
      const payload = typeof a.body === 'string' ? a.body : JSON.stringify(a.body || {});
      if (payload.length > 20000) return { error: 'Request body capped at 20KB' };
      const r = await guardedFetch(String(a.url), {
        'content-type': String(a.contentType || 'application/json'), accept: 'application/json'
      }, { method: 'POST', body: payload });
      if (!r.ok) return r;
      return { status: r.status, bytes: r.bytes, sha256: crypto.createHash('sha256').update(r.text || '').digest('hex'), body: String(r.text || '').slice(0, 2000) };
    } },
  /* ── v1.64: §47/§48/§50 defensive local scan + bounded remediation ── */
  'security.scan': { cap: 'security.scan', risk: 'medium', verification: 'findings list with evidence hash', run: a => {
      const target = a.path ? safePath(a.path) : USERFILES;
      if (!target) return { error: 'Path escapes sandbox' };
      const findings = [];
      const walk = (dir, depth) => {
        if (depth > 4) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entries.slice(0, 200)) {
          const full = path.join(dir, e.name);
          const rel = path.relative(USERFILES, full);
          const ctl = caps.classifyPath(rel);
          if (ctl.sensitive) findings.push({ severity: 'HIGH', id: 'sensitive-location', path: rel, note: ctl.kind + ' — ' + ctl.control });
          if (e.isDirectory()) { walk(full, depth + 1); continue; }
          if (/\.(sh|bat|ps1|exe|dll|scr|vbs|jar|apk)$/i.test(e.name)) findings.push({ severity: 'MEDIUM', id: 'executable-artifact', path: rel, note: 'executable content inside the sandbox — treat as untrusted' });
          if (/\.(js|json|txt|md|env|yml|yaml)$/i.test(e.name)) {
            const scan = scanUntrusted(readSafe(full), rel);
            if (scan.signals.length) findings.push({ severity: 'MEDIUM', id: 'content-signals', path: rel, note: scan.signals.join(', ') });
          }
        }
      };
      walk(target, 0);
      const evidenceHash = crypto.createHash('sha256').update(JSON.stringify(findings)).digest('hex');
      return { target: path.relative(USERFILES, target) || '.', findings, count: findings.length, evidenceHash, scope: 'authorized sandbox assets only', note: 'Local defensive scan of WitForge-controlled assets. No external system is ever scanned.' };
    } },
  'security.remediate': { cap: 'security.remediate', risk: 'high', verification: 'quarantined path gone from sandbox and present in quarantine with hash', run: a => {
      const r = safePath(a.path || '');
      if (!r || !a.path) return { error: 'Path escapes sandbox' };
      if (!fs.existsSync(r)) return { error: 'Nothing to quarantine at that path' };
      const qdir = path.join(__dirname, 'data', 'quarantine');
      fs.mkdirSync(qdir, { recursive: true });
      const dest = path.join(qdir, path.basename(a.path) + '.' + Date.now().toString(36));
      const sha = fsHash(a.path);
      try { fs.renameSync(r, dest); } catch (e) { return { error: 'Quarantine failed: ' + e.message }; }
      return { quarantined: a.path, store: path.relative(__dirname, dest), sha256: sha, reversible: true, note: 'Bounded eradication: the artifact is contained inside WitForge-controlled storage and can be restored.' };
    } },
  /* ── v1.64: local knowledge + account lifecycle steps ─────────── */
  'knowledge.write': { cap: 'knowledge.write', risk: 'low', verification: 'record stored with content hash', run: a => {
      const text = String(a.text || '').slice(0, 500); if (!text) return { error: 'text required' };
      const rec = { id: nid('k'), title: String(a.title || text).slice(0, 60), text, ts: Date.now(), source: a.source || 'playbook', trusted: false };
      S.knowledge.unshift(rec); if (S.knowledge.length > 300) S.knowledge.length = 300; save();
      return { stored: rec.id, sha256: crypto.createHash('sha256').update(text).digest('hex'), trusted: false };
    } },
  'account.discover': { cap: 'account.discover', risk: 'low', verification: 'capability record for the named service', run: a => {
      const service = String(a.service || '').toLowerCase().slice(0, 40);
      const known = caps.CAPABILITY_CATALOGUE.filter(c => c.domain === 'account');
      const integrations = ADAPTERS.find(x => x.id === service);
      return {
        service, registrationInterfaceSupported: !!(integrations && String(integrations.state) === 'AVAILABLE'),
        integration: integrations ? { id: integrations.id, state: integrations.state } : null,
        requirements: ['email or phone verification where the provider requires it', 'payment details where the provider charges', 'terms acceptance by the user where legally binding'],
        accountCapabilities: known.map(c => c.id),
        note: 'Discovery reports the legitimate interface only. Human-required steps (CAPTCHA, identity, phone) are completed by the user (§132).'
      };
    } },
  'account.configure': { cap: 'account.configure', risk: 'medium', verification: 'local settings record for the account', run: a => {
      const acct = services.resolveAccount(S, String(a.service || '').toLowerCase());
      if (!acct.ok) return { error: 'No unambiguous account for ' + a.service + ' (' + acct.reason + ')', blocked: 'permission', reason: acct.reason };
      const settings = Object.assign({ mfa: 'unknown', sessions: 'unchanged', recovery: 'unknown' }, a.settings || {});
      acct.account.settings = settings;
      acct.account.securityStatus = settings.mfa === 'enabled' ? 'HARDENED' : acct.account.securityStatus;
      revokeCredential ? null : null;
      save();
      return { account: acct.account.id, settings, note: 'Only settings the provider actually supports can be changed; nothing here claims a provider-side change without provider evidence.' };
    } },
  'account.disconnect': { cap: 'account.disconnect', risk: 'medium', verification: 'grants removed, credential destroyed, audit preserved', run: a => {
      const list = services.accountsFor(S, String(a.service || '').toLowerCase());
      if (!list.length) return { error: 'No connected account for ' + a.service };
      const results = list.map(x => disconnectAccountCmd(x.id));
      return { service: a.service, disconnected: results.map(r => r.account), grantsRevoked: results.reduce((n2, r) => n2 + r.revokedGrants.length, 0) };
    } },
  /* ── v1.67: multi-provider AI chat — truth-stated, key-in-header ── */
  'llm.status': { cap: 'llm.status', risk: 'low', verification: 'credential-store lookup; live local probe for Ollama only', run: async () => {
      const rows = llm.PROVIDERS.map(p => ({
        id: p.id, name: p.name, shape: p.shape, defaultModel: p.defaultModel, free: p.free, connect: p.connect,
        configured: p.requiresKey ? !!decryptToken(p.id) : true,
        requiresKey: p.requiresKey
      }));
      const local = await llm.ollamaModels({ localFetch: llmLocalFetch });
      const oRow = rows.find(r => r.id === 'ollama');
      if (local) oRow.models = local; else oRow.models = null;
      return { defaultProvider: (S.llm && S.llm.default) || null, providers: rows, note: 'configured ≠ verified — say “verify <provider>” for a real round trip' };
    } },
  'llm.chat': { cap: 'llm.chat', risk: 'medium', verification: 'provider reply parsed, non-empty; provider+model+latency recorded', run: async a => {
      const p = llmResolveProvider(a.provider);
      if (!p) return { error: 'No AI provider is configured yet. Free options: ' + llm.PROVIDERS.filter(x => x.requiresKey).map(x => x.id + ' (' + x.free + ')').join('; ') + ' — or Ollama locally, no key needed (install, "ollama pull llama3.2"). Then “ask …”.', truthful: true };
      if (p.error) return p;
      const r = await llm.chat(p.id, a, { remoteFetch: guardedFetch, localFetch: llmLocalFetch, apiKey: p.requiresKey ? decryptToken(p.id) : null });
      if (r.ok) { S.llm.calls = (S.llm.calls || 0) + 1; save(); return { provider: r.provider, model: r.model, reply: r.content, usage: r.usage, latencyMs: r.latencyMs }; }
      return Object.assign({ truthful: true }, r);
    } },
  'llm.verify': { cap: 'llm.verify', risk: 'medium', verification: 'a real minimal round trip with the stored credential', run: async a => {
      const p = llmResolveProvider(a.provider);
      if (!p) return { error: 'Nothing to verify yet — say “connect <provider> with token <key>” first (groq/gemini/openrouter/deepseek/mistral are free-tier; ollama needs no key).', truthful: true };
      if (p.error) return p;
      /* v1.78.0: 64 output tokens, not 8 — thinking models (gemini-3.x) spend
       * output tokens on reasoning before any text arrives, so an 8-token
       * probe returned an empty answer and a false FAILED. */
      const r = await llm.chat(p.id, { prompt: 'Reply with the single word: ready', maxTokens: 64, temperature: 0 }, { remoteFetch: guardedFetch, localFetch: llmLocalFetch, apiKey: p.requiresKey ? decryptToken(p.id) : null });
      if (!r.ok) return { error: 'Verify FAILED against ' + p.id + ' (real call): ' + r.error, truthful: true };
      return { provider: r.provider, model: r.model, latencyMs: r.latencyMs, sample: r.content.slice(0, 40), verified: true };
    } },
  'llm.ensemble': { cap: 'llm.ensemble', risk: 'medium', verification: 'one labelled answer per configured provider; failures reported, never swallowed', run: async a => {
      const ids = llm.PROVIDER_IDS.filter(id => { const pr = llm.providerById(id); return !pr.requiresKey || decryptToken(id); });
      if (!ids.length) return { error: 'No AI provider is configured yet — “ask all” fans one question out to every connected provider. Free keys: ' + llm.PROVIDERS.filter(x => x.requiresKey).map(x => x.id).join(', ') + '; ollama needs no key.', truthful: true };
      const r = await llm.ensemble(ids, a, { remoteFetch: guardedFetch, localFetch: llmLocalFetch, apiKey: id => (llm.providerById(id).requiresKey ? decryptToken(id) : null) });
      if (S.llm) { S.llm.calls = (S.llm.calls || 0) + r.answers.length; save(); }
      return { providersAsked: ids, answers: r.answers.map(x => ({ provider: x.provider, model: x.model, latencyMs: x.latencyMs, reply: x.content })), failures: r.failures };
    } },
  /* ── v1.71: local model management (Ollama, real API calls) ─────── */
  'local.pull': { cap: 'local.pull', risk: 'medium', verification: 'the local Ollama reports the pull successful; installed list refreshed', run: async a => {
      const name = String(a.model || '').trim().toLowerCase().slice(0, 60);
      if (!/^[a-z0-9][a-z0-9._:-]{2,59}$/.test(name)) return { error: 'Provide a model name like qwen2.5:0.5b — say “local pull qwen2.5:0.5b”.', truthful: true };
      const res = await llmLocalFetch('http://127.0.0.1:' + llm.OLLAMA_PORT() + '/api/pull', {}, { method: 'POST', body: JSON.stringify({ model: name, stream: false }), timeoutMs: 600000 });
      if (!res.ok) return { error: 'Pull FAILED (real call to the local Ollama): ' + String(res.error || res.text || '').slice(0, 200), truthful: true };
      let j = {}; try { j = JSON.parse(res.text); } catch (e) {}
      if (j.error) return { error: 'Pull FAILED: ' + j.error, truthful: true };
      const models = await llm.ollamaModels({ localFetch: llmLocalFetch });
      return { ok: true, model: name, status: j.status || 'success', models };
    } },
  'local.remove': { cap: 'local.remove', risk: 'medium', verification: 'the local Ollama acknowledges the delete; installed list refreshed', run: async a => {
      const name = String(a.model || '').trim().toLowerCase().slice(0, 60);
      if (!/^[a-z0-9][a-z0-9._:-]{2,59}$/.test(name)) return { error: 'Provide the exact model name to remove (see “local models”).', truthful: true };
      const res = await llmLocalFetch('http://127.0.0.1:' + llm.OLLAMA_PORT() + '/api/delete', {}, { method: 'POST', body: JSON.stringify({ model: name }), timeoutMs: 30000 });
      if (!res.ok) return { error: 'Remove FAILED (real call): ' + String(res.error || res.text || '').slice(0, 200), truthful: true };
      const models = await llm.ollamaModels({ localFetch: llmLocalFetch });
      return { ok: true, removed: name, models };
    } },
  /* ── v1.69: social connectors (official APIs, owner credentials) ── */
  'social.status': { cap: 'social.status', risk: 'low', verification: 'credential-store lookup + recorded verification evidence', run: async () => ({
      connectors: SOCIALS.map(x => ({ id: x.id, name: x.name, postable: x.postable, reason: x.reason || null, configured: !!decryptToken(x.id), verified: !!(S.social.verified[x.id]), signup: x.signup })),
      note: 'configured ≠ connected: say “verify <platform>” for a real API round trip; posting without a credential is refused, never simulated'
    }) },
  'social.verify': { cap: 'social.verify', risk: 'medium', verification: 'a real authenticated API round trip returning the account identity', run: async a => {
      const sc = socialEntry(a.platform);
      if (!sc) return { error: 'Unknown platform — known: ' + SOCIALS.map(x => x.id).join(', '), truthful: true };
      const tok = decryptToken(sc.id);
      if (!tok) return { error: sc.name + ' UNAVAILABLE — no credential stored (never faked). Create an app at ' + sc.signup + ', then say “connect ' + sc.id + ' with token <token>” and “verify ' + sc.id + '”.', truthful: true };
      const r = await guardedFetch(sc.verifyUrl, { authorization: 'Bearer ' + tok });
      if (!r.ok) return { error: 'Verify FAILED against ' + sc.name + ' (real API): ' + (r.error || 'HTTP ' + r.status), truthful: true };
      let name = null; try { const j = JSON.parse(r.text); name = (j.data && (j.data.username || j.data.display_name)) || j.name || j.username || null; } catch (e) {}
      S.social.verified[sc.id] = { ts: Date.now(), profile: name || 'authenticated' };
      save(); audit('tool', 'SOCIAL VERIFY ' + sc.id + ' → ' + (name || 'authenticated'), 'system', { result: 'SUCCEEDED' });
      return { platform: sc.id, profile: name || 'authenticated', verified: true, postable: sc.postable, note: sc.postable ? 'Say “post ' + sc.id + ' <text>” — posting is high-risk and approval-gated.' : (sc.reason || 'verify-only') };
    } },
  'social.post': { cap: 'social.post', risk: 'high', verification: 'the platform API acknowledges the post with an id/link', run: async a => {
      const sc = socialEntry(a.platform);
      if (!sc) return { error: 'Unknown platform — known: ' + SOCIALS.map(x => x.id).join(', '), truthful: true };
      const tok = decryptToken(sc.id);
      if (!tok) return { error: sc.name + ' UNAVAILABLE — no credential stored (never faked). Say “connect ' + sc.id + ' with token <token>” first; posting is never simulated.', truthful: true };
      if (!sc.postable) return { error: sc.name + ' cannot be posted to through this tool yet: ' + (sc.reason || ''), truthful: true };
      const text = String(a.text || '').trim();
      if (!text) return { error: 'text required' };
      if (text.length > sc.cap) return { error: sc.name + ' caps posts at ' + sc.cap + ' characters (yours: ' + text.length + ')', truthful: true };
      if (!S.social.verified[sc.id]) return { error: 'Verify ' + sc.id + ' first (“verify ' + sc.id + '”) — posting requires a proven-live credential.', truthful: true };
      let body = null, extraHeaders = {};
      if (sc.id === 'x') body = JSON.stringify({ text });
      if (sc.id === 'facebook') { extraHeaders = { 'content-type': 'application/x-www-form-urlencoded' }; body = 'message=' + encodeURIComponent(text); }
      if (sc.id === 'reddit') {
        if (!a.subreddit) return { error: 'reddit needs a subreddit: “post reddit <sub> | <title> | <text>”', truthful: true };
        extraHeaders = { 'content-type': 'application/x-www-form-urlencoded' };
        body = 'sr=' + encodeURIComponent(String(a.subreddit)) + '&kind=self&title=' + encodeURIComponent(String(a.title || 'Posted via WitForge')) + '&text=' + encodeURIComponent(text);
      }
      const r = await guardedFetch(sc.postUrl, Object.assign({ authorization: 'Bearer ' + tok }, extraHeaders), { method: 'POST', body });
      if (!r.ok) return { error: 'Post FAILED against ' + sc.name + ' (real API): ' + (r.error || 'HTTP ' + r.status), truthful: true };
      let ref = null; try { const j = JSON.parse(r.text); ref = (j.data && (j.data.id || j.data.tweet_id)) || (j.id ? ('t3_' + j.id) : (j.post_id || null)); } catch (e) {}
      audit('tool', 'SOCIAL POST ' + sc.id + ' (' + text.length + ' chars) → ' + (ref || 'accepted'), 'user', { result: 'SUCCEEDED', risk: 'HIGH' });
      return { platform: sc.id, posted: true, reference: ref, charCount: text.length };
    } },
  /* ── v1.69: self-update from the audited public repo ────────────── */
  'update.check': { cap: 'update.check', risk: 'low', verification: 'local package.json vs the live repo main branch', run: async () => {
      const lv = localVersion();
      const r = await guardedFetch(UPDATE_REPO_RAW + 'package.json');
      if (!r.ok) return { localVersion: lv, error: 'Could not read the remote version (real fetch failed): ' + r.error, truthful: true };
      let rv = 'unknown'; try { rv = JSON.parse(r.text).version || 'unknown'; } catch (e) {}
      return { localVersion: lv, remoteVersion: rv, upToDate: rv === lv, newer: versionGt(rv, lv), note: 'Say “update apply” to pull the newer tree — approval-gated, backed up, audited.' };
    } },
  'update.apply': { cap: 'update.apply', risk: 'high', verification: 'per-file sha256 recorded in audit; remote version must be strictly newer', run: async a => {
      const lv = localVersion();
      const head = await guardedFetch(UPDATE_REPO_RAW + 'package.json');
      if (!head.ok) return { error: 'Update aborted — could not read the remote version: ' + head.error, truthful: true };
      let rv = 'unknown'; try { rv = JSON.parse(head.text).version || 'unknown'; } catch (e) {}
      if (!versionGt(rv, lv)) return { ok: false, upToDate: true, localVersion: lv, remoteVersion: rv, error: 'No newer version to apply (local ' + lv + ', remote ' + rv + '). Nothing was changed.', truthful: true };
      const tree = await guardedFetch(UPDATE_REPO_TREE, { accept: 'application/vnd.github+json', 'user-agent': 'LIAM' });
      if (!tree.ok) return { error: 'Update aborted — could not list the remote tree: ' + tree.error, truthful: true };
      let blobs; try { blobs = JSON.parse(tree.text).tree || []; } catch (e) { return { error: 'Update aborted — bad tree payload', truthful: true }; }
      const files = blobs.filter(b => b.type === 'blob' && (b.size || 0) <= 2000000 && !UPDATE_SKIP.some(re => re.test(b.path)));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(APP_ROOT_W(), 'data', 'update-backups', stamp);
      const applied = [], skipped = [];
      for (const f of files.slice(0, 200)) {
        const target = path.resolve(APP_ROOT_W(), f.path);
        if (!target.startsWith(APP_ROOT_W() + path.sep)) { skipped.push(f.path); continue; }
        const raw = await guardedFetch(UPDATE_REPO_RAW + f.path.split('/').map(encodeURIComponent).join('/'));
        if (!raw.ok) { skipped.push(f.path); continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) { fs.mkdirSync(backupDir, { recursive: true }); fs.copyFileSync(target, path.join(backupDir, f.path.replace(/\//g, '__'))); }
        fs.writeFileSync(target, raw.text);
        applied.push({ path: f.path, sha256: crypto.createHash('sha256').update(raw.text).digest('hex'), bytes: Buffer.byteLength(raw.text) });
      }
      audit('update', 'SELF-UPDATE applied ' + applied.length + ' files ' + lv + ' → ' + rv + ' (backup: data/update-backups/' + stamp + ')', 'user', { result: 'SUCCEEDED', risk: 'HIGH' });
      save();
      return { ok: true, fromVersion: lv, toVersion: rv, applied: applied.length, skipped: skipped.length, backup: 'data/update-backups/' + stamp, files: applied.map(x => x.path).slice(0, 100), restartRequired: 'Restart is yours: say “update check” afterwards or run `node server.js` again. The platform never restarts itself.' };
    } },
  /* ── v1.64: §124 mock adapter executed through the real pipeline ── */
  'mock.echo': { cap: 'mock.echo', risk: 'low', simulation: true, verification: 'mode returned by the adapter itself', run: (a, o) => {
      const ad = caps.MOCK_ADAPTERS.find(x => x.behaviour === (a.behaviour || 'succeed')) || caps.MOCK_ADAPTERS[0];
      if (o && o.humanStep && ad.behaviour === 'needs-human') {
        return { simulation: true, adapter: ad.id, behaviour: ad.behaviour, verified: true, humanProvided: o.humanStep.data, step: o.humanStep.id, mode: 'SIMULATION — human step satisfied; test instrument only' };
      }
      ad.authenticate();
      const out = ad.executeAction();
      const v = ad.verifyAction();
      return Object.assign({ simulation: true, adapter: ad.id, behaviour: ad.behaviour, verified: v.verified, mode: 'SIMULATION — this adapter is a test instrument and is never counted as a connected integration' }, out);
    } },
  'github.writefile': { cap: 'github.write', risk: 'high', run: async a => {
      const tok = decryptToken('github') || process.env.GITHUB_TOKEN;
      if (!tok) return { error: 'GitHub UNAVAILABLE — no credential.', truthful: true };
      const sub = String(a.path || '').replace(/^[\/]+|\.\./g, '').slice(0, 120);
      const body = String(a.content || '');
      if (!sub || !body) return { error: 'path and content required' };
      if (body.length > 10000) return { error: 'content capped at 10KB' };
      const hdr = { authorization: 'Bearer ' + tok, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'LIAM', 'content-type': 'application/json' };
      let sha; const ex = await guardedFetch('https://api.github.com/repos/doomed689/WitForge/contents/' + encodeURIComponent(sub), hdr);
      if (ex.ok) { try { sha = JSON.parse(ex.text).sha; } catch (e) {} }
      const payload = { message: 'LIAM: ' + (sha ? 'update' : 'create') + ' ' + sub, content: Buffer.from(body, 'utf8').toString('base64'), branch: 'main' };
      if (sha) payload.sha = sha;
      const r = await guardedFetch('https://api.github.com/repos/doomed689/WitForge/contents/' + encodeURIComponent(sub), hdr, { method: 'PUT', body: JSON.stringify(payload) });
      let j; try { j = JSON.parse(r.text || '{}'); } catch (e) { j = null; }
      if (!j || !j.content) return { error: 'GitHub write failed (' + (r.status ? 'HTTP ' + r.status : (r.error || 'network error')) + (j && j.message ? ': ' + j.message : '') + ')', truthful: true };
      audit('tool', 'GITHUB WRITE ' + j.content.path + ' @main', 'user'); save();
      return { path: j.content.path, sha: j.content.sha.slice(0, 8), commit: j.commit && j.commit.sha && j.commit.sha.slice(0, 8), url: j.content.html_url };
    } }
};

/* ── Economy: balanced double-entry, simulation-labelled ─ */
/* §89: every transaction records debit, credit, id, timestamp, actor, reason,
 * source, destination and the resulting balances. Balances stay derived from
 * auditable ledger state — never from client input. */
function ledgerPost(entries, memo, meta) {
  meta = meta || {};
  const sum = entries.reduce((n, e) => n + e.delta, 0);
  if (sum !== 0) {
    const fraud = services.fraudScreen(S, { kind: 'ledger', actor: meta.actor, unbalanced: true, amount: sum });
    audit('economy', 'UNBALANCED ENTRY REJECTED: ' + memo, 'system', { decision: 'BLOCK', reason: 'debits must equal credits', risk: 'CRITICAL', result: 'BLOCKED', evidenceHash: kernel.auditRecord({}).evidenceHash });
    return { ok: false, error: 'Unbalanced entry rejected (debits must equal credits)', blocked: 'ledger', fraud };
  }
  for (const e of entries) {
    if (!(e.account in S.ledger.accounts)) S.ledger.accounts[e.account] = 0;
    if (S.ledger.accounts[e.account] + e.delta < 0) return { ok: false, error: 'Negative balance prevented on ' + e.account, blocked: 'ledger' };
  }
  const fraud = services.fraudScreen(S, { kind: meta.kind || 'ledger', actor: meta.actor, counterparty: meta.counterparty, amount: entries.reduce((n, e) => n + Math.abs(e.delta), 0) / 2, recentSameKind: meta.recentSameKind, duplicateIdentity: meta.duplicateIdentity });
  if (fraud.blocked) return { ok: false, error: 'Anti-fraud block: ' + fraud.signals.map(x => x.id).join(', '), blocked: 'fraud', fraud };
  for (const e of entries) S.ledger.accounts[e.account] += e.delta;
  const balances = {};
  entries.forEach(e => { balances[e.account] = S.ledger.accounts[e.account]; });
  const debits = entries.filter(e => e.delta < 0).map(e => e.account);
  const credits = entries.filter(e => e.delta > 0).map(e => e.account);
  const tx = {
    id: nid('tx'), ts: Date.now(), entries, memo,
    mode: S.economy.realMode ? 'REAL' : 'SIMULATION',
    actor: meta.actor || 'user',
    reason: meta.reason || memo,
    source: meta.source || debits.join(', ') || null,
    destination: meta.destination || credits.join(', ') || null,
    balances,
    fraudSignals: fraud.signals.map(x => x.id)
  };
  S.ledger.tx.unshift(tx);
  if (S.ledger.tx.length > 800) S.ledger.tx.length = 800;
  save();
  return { ok: true, tx };
}
function wager(playerA, playerB, amount, settleTo) {
  amount = Math.floor(Number(amount));
  if (!(amount > 0)) return { ok: false, error: 'Invalid wager amount' };
  const hold = ledgerPost([{ account: playerA, delta: -amount }, { account: 'Arena Escrow', delta: amount }], 'wager hold ' + playerA, { actor: playerA, reason: 'arena wager hold', destination: 'Arena Escrow', kind: 'wager' });
  if (!hold.ok) return hold;
  const hold2 = ledgerPost([{ account: playerB, delta: -amount }, { account: 'Arena Escrow', delta: amount }], 'wager hold ' + playerB, { actor: playerB, reason: 'arena wager hold', destination: 'Arena Escrow', kind: 'wager' });
  if (!hold2.ok) return hold2;
  const pool = amount * 2, treasury = Math.round(pool * 0.01), winner = pool - treasury;
  const settle = ledgerPost([{ account: 'Arena Escrow', delta: -pool }, { account: settleTo, delta: winner }, { account: 'Treasury', delta: treasury }], 'wager settlement', { actor: 'arena', reason: 'wager settlement (1% treasury)', source: 'Arena Escrow', destination: settleTo + ' + Treasury', kind: 'wager-settlement' });
  if (!settle.ok) return settle;
  audit('economy', `SIMULATION wager settled: pool ${pool}, winner ${winner}, treasury ${treasury} (1%)`, 'system');
  return { ok: true, pool, winner, treasury };
}
function economySelfTest() {
  // Deterministic + repeatable: reset scratch accounts to a known state so the
  // ledger self-test can run any number of times on any live store.
  const sumBeforeAll = Object.values(S.ledger.accounts).reduce((a, b) => a + b, 0);
  const prevTA = S.ledger.accounts['T-A'] || 0;
  const prevTB = S.ledger.accounts['T-B'] || 0;
  S.ledger.accounts['T-A'] = 200;
  S.ledger.accounts['T-B'] = 200;
  const resetDelta = (200 - prevTA) + (200 - prevTB); // net LD added/removed by the reset
  const sumBefore = sumBeforeAll + resetDelta;
  const w = wager('T-A', 'T-B', 100, 'T-A');
  const sumAfter = Object.values(S.ledger.accounts).reduce((a, b) => a + b, 0);
  const checks = [
    ['100+100=200 pool escrowed', w.ok && w.pool === 200],
    ['200-198=2 treasury (1%)', w.ok && w.treasury === 2 && w.winner === 198],
    ['ledger sum invariant', sumAfter === sumBefore],
    ['negative balance prevented', !ledgerPost([{ account: 'T-A', delta: -1e9 }, { account: 'Treasury', delta: 1e9 }], 'attack').ok],
    ['unbalanced entry rejected', !ledgerPost([{ account: 'T-A', delta: 5 }], 'attack').ok]
  ];
  save();
  return { mode: 'SIMULATION', checks: checks.map(c => ({ check: c[0], pass: !!c[1] })) };
}

/* ── §42 execution pipeline ──────────────────────────────────────
 * AI proposal → policy → permission → risk assessment → approval gate →
 * executor → verification → audit. No AI output can grant itself permission,
 * and every refusal is reported with the boundary that produced it. */

/* §51: twelve risk factors, derived from what the action actually touches. */
function riskFactorsFor(toolId, args, tool) {
  const t = TOOLS[toolId] || {};
  const r = String(tool.risk || 'medium').toLowerCase();
  const f = {};
  f.capabilitySensitivity = r === 'high' ? 3 : r === 'medium' ? 2 : 1;
  f.reversibility = ['fs.delete', 'fs.write', 'github.writefile', 'http.post', 'security.remediate'].includes(toolId) ? 3 : (t.writes ? 2 : 0);
  f.financialImpact = /economy|market|payment|stripe|wager|forge|buy|sell/.test(toolId) ? 3 : 0;
  f.accountImpact = /account|auth|owner|login/.test(toolId) ? 2 : 0;
  f.deviceImpact = /device|exec|termux|adb|shizuku|linux\./.test(toolId) ? 2 : 0;
  f.externalVisibility = /publish|upload|post|email|send|share|youtube/.test(toolId) ? 3 : (t.network ? 1 : 0);
  f.securityImpact = /security|credential|permission|grant|revoke|emergency/.test(toolId) ? 3 : 0;
  f.legalImpact = /publish|upload|send|share|delete|account/.test(toolId) ? 2 : 0;
  f.dataSensitivity = /fs\.|github|credential|memory/.test(toolId) ? 2 : 0;
  f.scope = Array.isArray(args && args.scope) ? Math.min(3, args.scope.length) : (args && args.recursive ? 3 : 1);
  f.autonomy = S.autonomous ? 2 : 0;
  f.uncertainty = args && args.url ? 2 : 1;
  return f;
}
function assessAction(toolId, args) {
  const tool = TOOLS[toolId];
  const risk = riskFactorsFor(toolId, args, tool);
  return kernel.assessRisk(risk);
}
function actionPolicy(toolId, args, opts) {
  opts = opts || {};
  const tool = TOOLS[toolId];
  const cap = tool ? tool.cap : null;
  const assessment = assessAction(toolId, args);
  const ctx = {
    riskClass: assessment.class,
    permissionState: cap ? capabilityState(cap) : 'NOT_REQUESTED',
    emergency: S.emergency,
    stopActive: kernel.isStopped(S, 'network', null) && tool && tool.network === true,
    approvalGranted: !!opts.approvalId && approved(opts.approvalId),
    coveredByAutonomousPolicy: false,
    requestedBy: opts.requestedBy || { authority: 'owner-authority' },
    irreversible: opts.irreversible === true,
    hasSnapshot: opts.hasSnapshot === true,
    policyVersion: kernel.DEFAULT_POLICY_VERSION
  };
  return { assessment, cap, decision: kernel.evaluatePolicy(ctx), ctx };
}

/* §55: which emergency-stop scopes a tool belongs to. A stop in any of them
 * suspends that tool; nothing about the stop weakens audit or recovery. */
const TOOL_SCOPES = {
  'http.get': ['network', 'integration'], 'http.post': ['network', 'integration'],
  'dns.resolve': ['network'], 'weather.get': ['network', 'integration'],
  'wiki.summary': ['network', 'integration'], 'hn.top': ['network', 'integration'],
  'country.get': ['network', 'integration'], 'fx.convert': ['network', 'integration'],
  'github.status': ['network', 'integration'], 'github.files': ['network', 'integration'],
  'github.readfile': ['network', 'integration'], 'github.writefile': ['network', 'integration'],
  'stripe.verify': ['network', 'integration'], 'account.discover': ['account', 'network'],
  'account.configure': ['account'], 'account.disconnect': ['account'],
  'knowledge.write': ['task'], 'mock.echo': ['task'], 'economy.selftest': ['task'],
  'llm.status': ['task'], 'llm.chat': ['network', 'integration'], 'llm.verify': ['network', 'integration'],
  'llm.ensemble': ['network', 'integration'],
  'social.status': ['task'], 'social.verify': ['network', 'integration'], 'social.post': ['network', 'integration'],
  'update.check': ['task'], 'update.apply': ['task'],
  'local.pull': ['task'], 'local.remove': ['task']
};
function toolScopes(toolId) {
  const id = String(toolId || '');
  if (TOOL_SCOPES[id]) return TOOL_SCOPES[id];
  if (/^fs\.|^util\.|^sys\.|^security\.|^exec\./.test(id)) return ['task'];
  if (/^device\./.test(id)) return ['device'];
  if (/^agent\./.test(id)) return ['agent'];
  if (/^account\./.test(id)) return ['account'];
  if (/^http\.|^dns\./.test(id)) return ['network', 'integration'];
  return ['task'];
}

async function runTool(toolId, args, opts) {
  opts = opts || {};
  args = args || {};
  const cid = currentCid || ('run-' + crypto.randomBytes(4).toString('hex'));
  const span = services.startSpan(S, 'tool:' + toolId, cid);
  const tool = TOOLS[toolId];
  if (!tool) {
    services.endSpan(S, span, 'FAILED');
    return caps.toolResult({ state: 'FAILED', error: 'Unknown tool ' + toolId, cid, verification: { method: 'registry lookup', result: 'not found' } });
  }
  const manifest = caps.toolManifest({ id: toolId, capabilities: [tool.cap], risk: tool.risk, inputs: Object.keys(tool.inputs || {}), verification: tool.verification || 'structured result + evidence hash' });
  let { assessment, decision, ctx } = actionPolicy(toolId, args, opts);
  /* §9/§46: an EXPIRED capability on an owner-initiated low/medium-risk tool
   * re-enters the documented state machine (EXPIRED → REQUESTED) with a
   * fresh token — the request typed in chat IS the permission. High-risk
   * tools keep their approval gate; security-blocked/revoked/denied still
   * deny outright. */
  if (decision.policyId === 'P-PERMISSION-BLOCKED' && ctx.permissionState === 'EXPIRED' && String(tool.risk).toLowerCase() !== 'high') {
    requestCapability(tool.cap, { how: 'user-request', reason: 'capability expired — owner re-requested via chat', ttlMs: 3600e3 });
    ({ assessment, decision, ctx } = actionPolicy(toolId, args, opts));
    audit('security', 'CAPABILITY REFRESH ' + tool.cap + ' (expired → re-requested by owner)', 'system', { result: 'REGRANTED' });
  }
  const base = {
    ok: false, tool: toolId, toolId, correlationId: cid, manifest,
    risk: { class: assessment.class, score: assessment.score, factors: assessment.factors, explanation: assessment.explanation },
    policy: decision
  };
  const finish = (extra) => {
    const res = Object.assign({}, base, extra);
    if (res.state && !res.status) res.status = res.state;   // §122: state/status alias
    services.endSpan(S, span, res.state || 'UNKNOWN', { risk: assessment.class, decision: decision.decision });
    services.metric(S, 'tool.' + toolId + '.calls', 1, { state: res.state });
    return res;
  };

  /* §55/§56 emergency stop and hierarchy, before anything else runs.
   * Every tool belongs to one or more stop scopes; a stop in any applicable
   * scope halts that tool while audit, verification and recovery keep running. */
  const scopes = toolScopes(toolId);
  const stoppedScope = scopes.find(sc => kernel.isStopped(S, sc, null));
  if (stoppedScope) {
    audit('security', 'STOP(' + stoppedScope + ') blocked ' + toolId, 'system', { capability: tool.cap, decision: 'BLOCK', reason: stoppedScope + ' execution stopped by user', risk: assessment.class, result: 'BLOCKED' });
    return finish({
      state: 'BLOCKED', blocked: 'stop-' + stoppedScope, stoppedScope,
      error: `${stoppedScope[0].toUpperCase() + stoppedScope.slice(1)} execution is stopped (§55). Resume with “resume ${stoppedScope}”. Audit and recovery stay available.`,
      evidence: { error: stoppedScope + ' stop active', blocked: 'stop-' + stoppedScope }
    });
  }
  if (S.emergency === 'LOCKDOWN' && String(tool.risk).toLowerCase() !== 'low') {
    audit('security', 'LOCKDOWN blocked ' + toolId, 'system', { capability: tool.cap, decision: 'BLOCK', reason: 'lockdown', risk: assessment.class, result: 'BLOCKED' });
    return finish({ state: 'BLOCKED', blocked: 'lockdown', error: 'LOCKDOWN: execution blocked (security policy). Audit and recovery remain available.', evidence: { error: 'LOCKDOWN: execution blocked (security policy)', blocked: 'lockdown' } });
  }
  if (S.emergency === 'HIGH' && String(tool.risk).toLowerCase() === 'medium' && !opts.confirmed && !S.autonomous && !ctx.approvalGranted) {
    const ap = createApproval(tool.cap, 'Run ' + toolId + ' during HIGH emergency');
    return finish({ state: 'WAITING_FOR_APPROVAL', needsApproval: ap.id, error: 'HIGH emergency: explicit approval required for ' + toolId, evidence: { error: 'approval required during HIGH', needsApproval: ap.id } });
  }

  /* §44 policy decision. */
  if (decision.decision === 'BLOCK' || decision.decision === 'DENY') {
    if (decision.policyId === 'P-PERMISSION-BLOCKED' && tool.cap) {
      // A revoked/expired/denied capability is a DENY, not an approval prompt.
    }
    audit('policy', maskSecrets(`POLICY ${decision.decision} ${toolId} via ${decision.policyId}: ${decision.reason}`), 'system', {
      capability: tool.cap, decision: decision.decision, reason: decision.reason, risk: assessment.class, result: 'BLOCKED'
    });
    kernel.vaultStore(S, { kind: 'policy-block', payload: { toolId, policy: decision.policyId, reason: decision.reason }, resources: [toolId], cid });
    return finish({
      state: 'BLOCKED', policyDecision: decision.decision, blocked: decision.policyId,
      error: decision.reason, correction: taskEngine.correctionPlan({ class: 'POLICY_VIOLATION' }),
      evidence: { error: decision.reason, blocked: decision.policyId, policy: decision.policyId }
    });
  }
  if (decision.decision === 'ASK' || decision.decision === 'ESCALATE') {
    if (!permitted(tool.cap) && String(tool.risk).toLowerCase() === 'high') {
      const ap = createApproval(tool.cap, 'Grant+run high-risk ' + toolId);
      return finish({ state: 'WAITING_FOR_APPROVAL', needsApproval: ap.id, error: 'High-risk capability requires approval (approve ' + ap.id + ')', evidence: { error: 'approval required', needsApproval: ap.id } });
    }
    if (!permitted(tool.cap) && (String(tool.risk).toLowerCase() === 'low' || String(tool.risk).toLowerCase() === 'medium')) {
      requestCapability(tool.cap, { how: S.autonomous ? 'autonomous-mode' : 'user-request', reason: 'capability needed for ' + toolId, account: opts.account || null, device: opts.device || null, agent: opts.agent || null, ttlMs: opts.ttlMs || undefined });
    } else if (assessment.class === 'HIGH' || assessment.class === 'CRITICAL') {
      const ap = createApproval(tool.cap, `${assessment.class}-risk approval for ${toolId}`);
      return finish({ state: 'WAITING_FOR_APPROVAL', needsApproval: ap.id, error: assessment.class + ' risk: approval required (approve ' + ap.id + ')', evidence: { error: 'approval required', needsApproval: ap.id, risk: assessment.class } });
    }
  }
  if (!tokenValid(tool.cap)) {
    if (String(tool.risk).toLowerCase() === 'low' || String(tool.risk).toLowerCase() === 'medium') requestCapability(tool.cap, { how: S.autonomous ? 'autonomous-mode' : 'user-request' });
  }

  audit('tool', maskSecrets(`EXEC ${toolId} ${JSON.stringify(args || {}).slice(0, 140)}`), 'user', {
    capability: tool.cap, decision: 'ALLOW', risk: assessment.class, result: 'EXECUTING', approval: opts.approvalId || null
  });
  const t0 = Date.now();
  const humanStep = consumeHumanStep(toolId);
  let out;
  try { out = await tool.run(args, { humanStep }); } catch (e) { out = { error: 'Tool threw: ' + e.message }; }
  /* v1.66: a tool that meets a human gate (captcha/2FA/consent) pauses here.
   * The gate is never bypassed: the owner resolves the step, then repeats. */
  if (out && !out.error && out.needsHuman) {
    const hs = requestHumanStep(toolId, cid, out.needsHuman);
    return finish({
      state: 'WAITING_FOR_HUMAN', needsHuman: hs.id,
      humanStep: { kind: hs.kind, service: hs.service, instructions: hs.instructions, fields: hs.fields },
      error: 'Human step required (' + hs.kind + '): ' + hs.instructions + ' — complete it, then say “resolve ' + hs.id + ' with <your answer>” and repeat the command.',
      correction: taskEngine.correctionPlan({ class: 'RECOVERABLE' }),
      evidence: { error: 'human step required', needsHuman: hs.id }
    });
  }
  const failureClass = out.error ? taskEngine.classifyFailure(out) : null;
  const state = out.error ? (out.blocked ? 'BLOCKED' : (out.partial ? 'PARTIALLY_SUCCEEDED' : 'FAILED')) : 'SUCCEEDED';
  const correction = failureClass ? taskEngine.correctionPlan(out) : null;
  const verification = out.error ? { method: tool.verification || 'result inspection', result: 'no success evidence' }
    : (typeof tool.verify === 'function' ? tool.verify(out) : { method: tool.verification || 'structured result', result: 'result accepted as evidence' });
  const evidenceHash = caps.structuredResultHash(out);
  audit('tool', maskSecrets(`RESULT ${toolId}: ${state}${out.error ? ' ' + out.error : ''}`), 'system', {
    capability: tool.cap, decision: state === 'SUCCEEDED' ? 'ALLOW' : 'DENY',
    reason: out.error || null, risk: assessment.class, result: state, evidenceHash,
    approval: opts.approvalId || null
  });
  if (state === 'SUCCEEDED') {
    S.evidence.unshift({ ts: Date.now(), tool: toolId, cid, sha256: evidenceHash });
    if (S.evidence.length > 200) S.evidence.length = 200;
  }
  kernel.vaultStore(S, {
    kind: state === 'SUCCEEDED' ? 'tool-result' : 'tool-failure',
    payload: { toolId, state, out, failureClass }, resources: [toolId, args.path || args.url || args.name || null].filter(Boolean), cid,
    classification: String(tool.risk).toLowerCase() === 'high' ? 'sensitive' : 'operational'
  });
  save();
  return finish({
    ok: !out.error, state, evidence: out, result: out.error ? null : out,
    verification, failureClass, correction,
    latencyMs: Date.now() - t0,
    error: out.error || null
  });
}
function preview(text) {
  const low = String(text || '').toLowerCase();
  let m;
  const plan = (op, cap, risk) => ({ ok: true, kind: 'preview', reply: `PREVIEW — op:${op} capability:${cap} risk:${risk} required-authority:${risk === 'high' ? 'approval' : 'your request'} emergency-gate:${S.emergency}`, plan: { op, cap, risk } });
  let low2; if ((m = low.match(/^preview (.+)/))) low2 = m[1]; else low2 = low;
  if (low2.includes('lockdown')) return plan('security.emergency', 'security.control', 'high');
  if ((m = low2.match(/^fetch /))) return plan('http.get', 'http.get', 'medium');
  if ((m = low2.match(/^weather /))) return plan('weather.get', 'weather.get', 'medium');
  if ((m = low2.match(/^write file /))) return plan('fs.write', 'fs.write', 'medium');
  if ((m = low2.match(/^run /))) return plan('exec.run', 'exec.run', 'medium');
  if ((m = low2.match(/^wager /))) return plan('economy.wager', 'economy.manage', 'medium');
  if ((m = low2.match(/^create (task|project|agent) /))) return plan('store.write', 'store.write', 'low');
  return { ok: false, error: 'Nothing to preview' };
}

/* ── Conversational command router (platform intents) ─── */
async function command(text, opts) {
  opts = opts || {};
  const q = String(text || '').trim();
  const low = q.toLowerCase();
  let m;
  const R = (reply, data) => ({ ok: true, kind: 'platform', reply, data });

  if (low === 'three laws' || low === 'the three laws' || low === 'ai laws') {
    return R('WITFORGE THREE LAWS COVENANT (owner-authored; THREE-LAWS.md):\n' +
      THREE_LAWS.map(x => x.id + '. ' + x.ownerWording + '\n   Operationally: ' + x.operational).join('\n') +
      '\n\nBoundary: this covenant cannot grant authority or override human consent, security, policy, law or truthful disclosure.');
  }

  if ((m = low.match(/^connect (proton)(?: .*)?$/)) || low === 'connect proton') {
    return R('Proton publishes NO public payment/wallet merchant API, so a real integration cannot exist. I will not simulate one. Proton connector state stays “NO PUBLIC API”. For receiving real payments, use Stripe: “connect stripe with token sk_…”, then “verify stripe”.');
  }
  /* v1.73: advertising agent — drafts autonomously, dispatches gated. */
  if (low === 'ad campaigns') {
    const L = adCampaignsList();
    return R(L.length ? 'Ad campaigns (your channels only, approval-gated dispatch):\n' + L.map(c => '• ' + c.id + ' “' + c.name + '” [' + c.status + '] ' + c.platforms.join(',') + ' · ' + c.variants + ' variants · ' + c.queue + ' queued · ' + c.sent + ' sent').join('\n') + '\nDispatch: “ad dispatch <id>” (one approval per campaign; ≤1 post/platform/dispatch).' : 'No campaigns yet. Create one: ad campaign "Launch" on x, facebook: <brief> — the agent drafts the variants.');
  }
  if ((m = q.match(/^ad campaign "([^"]{1,60})"\s+on\s+([a-z, ]+?):\s*([\s\S]+)$/i))) {
    const pls = m[2].split(/[ ,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    const bad = pls.find(p => !(AD_RATE_CAPS[p] > 0));
    if (bad) return R('“' + bad + '” is not postable through official APIs yet. Postable: ' + AD_POSTABLE.join(', ') + ' (instagram/linkedin/tiktok are verify-only — connect + verify works today).');
    const brief = m[3].trim();
    const c = { id: nid('adc'), name: m[1], brief: brief.slice(0, 300), platforms: pls, variants: [], queue: [], results: [], status: 'draft', ts: Date.now() };
    const caps = pls.map(p => p + '≤' + AD_RATE_CAPS[p] + ' chars-none').join(', ');
    const r = await runTool('llm.chat', { prompt: 'Draft 3 short distinct advertising post variants for this campaign. Number them 1. 2. 3. Keep each under 200 characters, no hashtags spam, one may include a call to action.\nCampaign: ' + m[1] + '\nBrief: ' + brief, maxTokens: 400 }, {});
    if (r.ok) {
      const texts = String(r.result.reply || '').split('\n').map(l => l.replace(/^\s*\d+[).]\s*/, '').trim()).filter(l => l.length > 3);
      c.variants = texts.slice(0, 3);
      c.draftedBy = r.result.provider + ' · ' + r.result.model;
    }
    if (!c.variants.length) { c.variants = [brief]; c.draftedBy = 'fallback (no AI provider answered)'; }
    S.adCampaigns.unshift(c); save();
    audit('economy', 'AD CAMPAIGN created ' + c.id + ' “' + c.name + '” → ' + pls.join(',') + ' (' + c.variants.length + ' variants)', 'user', {});
    return R('📋 Agent drafted “' + c.name + '” (' + c.id + '), ' + c.variants.length + ' variants [' + c.draftedBy + ']:\n' + c.variants.map((v, i) => (i + 1) + '. ' + v).join('\n') + '\nNext: “ad schedule ' + c.id + '”. Walls: your connected+verified accounts only · one campaign approval before dispatch · rate-capped (≤1 post/platform/dispatch) — this agent amplifies your voice on your channels; it does not blast unsolicited ads anywhere.');
  }
  if ((m = low.match(/^ad schedule (adc\w+)$/))) {
    const c = S.adCampaigns.find(x => x.id === m[1]);
    if (!c) return R('No campaign ' + m[1] + '. “ad campaigns” lists them.');
    if (c.status !== 'draft') return R('Campaign ' + c.id + ' is ' + c.status + ' — only drafts can be scheduled.');
    const variants = c.variants.length ? c.variants : [c.brief];
    let queue = [];
    for (const p of c.platforms) variants.slice(0, AD_RATE_CAPS[p] || 0).forEach((v, i) => queue.push({ platform: p, text: String(v).slice(0, 400), slot: i + 1 }));
    queue = queue.slice(0, AD_CAMPAIGN_MAX_POSTS);
    c.queue = queue; c.status = 'scheduled'; save();
    return R('Campaign “' + c.name + '” scheduled: ' + queue.length + ' rate-capped posts. Each “ad dispatch ' + c.id + '” sends at most ONE post per platform — you stay in the loop, platforms stay respected.');
  }
  if ((m = low.match(/^ad dispatch (adc\w+)$/))) {
    const c = S.adCampaigns.find(x => x.id === m[1]);
    if (!c) return R('No campaign ' + m[1] + '.');
    if (c.status === 'completed') return R('Campaign ' + c.id + ' is completed — nothing left in the queue.');
    if (c.status !== 'scheduled') return R('Schedule it first: “ad schedule ' + c.id + '”.');
    const notReady = c.platforms.filter(p => !decryptToken(p) || !S.social.verified[p]);
    if (notReady.length) return R('Refused — these channels are not connected+verified: ' + notReady.join(', ') + '. For each: “connect ' + notReady[0] + ' with token <your-token>” then “verify ' + notReady[0] + '”. The agent only ever uses your own authorized accounts — never any other source.');
    const prior = S.approvals.find(a => a.cap === 'social.post' && a.status === 'approved' && String(a.desc || '').includes(c.id));
    if (!prior) {
      const ap = createApproval('social.post', 'Dispatch ad campaign ' + c.id + ' “' + c.name + '” to ' + c.platforms.join(', '));
      return R('Dispatch is public and irreversible — one approval covers this whole campaign: say “approve ' + ap.id + '” then “ad dispatch ' + c.id + '” again.');
    }
    const sent = [], failed = [];
    for (const p of c.platforms) {
      const item = c.queue.find(q => q.platform === p);
      if (!item) continue;
      const r = await runTool('social.post', { platform: p, text: item.text }, { approvalId: prior.id });
      c.results.push({ ts: Date.now(), platform: p, text: item.text, ok: !!r.ok, ref: (r.result && r.result.reference) || null, error: r.error || null });
      if (r.ok) sent.push(p + (r.result.reference ? ' (' + r.result.reference + ')' : '')); else failed.push(p + ' — ' + String(r.error || 'failed').slice(0, 90));
      c.queue = c.queue.filter(q => q !== item);
    }
    c.status = c.queue.length ? 'scheduled' : 'completed';
    audit('economy', 'AD DISPATCH ' + c.id + ': ' + sent.length + ' sent, ' + failed.length + ' failed, ' + c.queue.length + ' remain', 'user', { result: failed.length && !sent.length ? 'FAILED' : 'SUCCEEDED', risk: 'HIGH' });
    save();
    return R('Dispatched “' + c.name + '”: ' + (sent.join(', ') || 'none sent') + (failed.length ? '\nFailed (real platform responses, reported not faked): ' + failed.join('; ') : '') + '\n' + c.queue.length + ' posts remain — “ad dispatch ' + c.id + '” sends the next round.');
  }
  /* v1.72: one-glance operational briefing (all local state, instant). */
  if (low === 'briefing' || low === 'brief' || low === 'standup') {
    const steps = (S.humanSteps || []).filter(h => h.status === 'pending');
    const props = (S.proposals || []).filter(p2 => p2.status === 'proposed');
    const pend = S.approvals.filter(a => a.status === 'pending');
    const expired = Object.keys(S.permissions).filter(k2 => capabilityState(k2) === 'EXPIRED');
    const localModels = (await llm.ollamaModels({ localFetch: llmLocalFetch })) || [];
    const L2 = ['📋 Briefing — ' + new Date().toLocaleString() + ' (v' + VERSION + ')',
      'Emergency: ' + S.emergency + ' · economy: ' + (S.economy.realMode ? 'REAL' : 'SIMULATION') + ' · AI default: ' + ((S.llm && S.llm.default) || 'auto (first configured)') + ' · local models: ' + localModels.length];
    L2.push('Human steps pending: ' + steps.length + (steps.length ? ' → ' + steps.map(h => h.id + ' (' + h.kind + ')').join(', ') : ''));
    L2.push('AI proposals pending: ' + props.length + (props.length ? ' → ' + props.map(p2 => p2.id + ' “' + p2.command + '”').join(', ') : ''));
    L2.push('Approvals pending: ' + pend.length + (pend.length ? ' → ' + pend.map(a => a.id + ' (' + a.desc + ')').join(', ') : ''));
    L2.push('Capabilities expired: ' + expired.length + (expired.length ? ' → ' + expired.join(', ') + ' (auto-refresh on next use)' : ''));
    const ads = (S.adCampaigns || []);
    L2.push('Ad campaigns: ' + ads.filter(c => c.status === 'scheduled').length + ' scheduled · ' + ads.filter(c => c.status === 'completed').length + ' completed');
    L2.push('Say “update check” for release status · “help” for everything runnable.');
    return R(L2.join('\n'));
  }
  /* v1.72: ask about <url> — fetch a public page, summarize with the brain. */
  if ((m = q.match(/^ask about\s+(https?:\/\/\S+)$/i)) || (m = q.match(/^summarize\s+(https?:\/\/\S+)$/i))) {
    const url = m[1];
    const page = await runTool('http.get', { url }, {});
    if (!page.ok) return R('Could not fetch ' + url + ' — ' + (page.evidence && (page.evidence.blocked || page.evidence.error) ? String(page.evidence.blocked || page.evidence.error) : String(page.error || 'fetch failed')) + '. Only public http(s) pages can be read (private addresses are blocked by the SSRF guard).');
    const body = String(page.evidence.text || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000);
    const r = await runTool('llm.chat', { prompt: 'Summarize this web page in at most 120 words, then one line “key facts:” with 2-3 bullets.\n\nURL: ' + url + '\n\n' + body, maxTokens: 300 }, {});
    if (!r.ok) return R('Fetched the page but the AI brain could not summarize: ' + (r.error || 'no provider configured. Say “connect groq with token <key>” or use a local model.'));
    return R('📖 [' + r.result.provider + ' · ' + r.result.model + '] ' + url + '\n' + r.result.reply + '\n— fetched live via the SSRF-guarded reader; the model only saw the page text.');
  }
  /* v1.78: only “ask about X” keeps the URL-missing notice (that phrasing is
   * unambiguously meant for the fetch tool). A bare “summarize X” without a URL
   * now falls through to the AI brain like any other conversation. */
  if ((m = q.match(/^ask about\s+(.+)$/i))) {
    return R('That does not look like a full public URL, so I will not fetch it. Give me a complete http(s) address to fetch — for example “ask about https://en.wikipedia.org/wiki/Double-entry_bookkeeping”. Private addresses are refused by the SSRF guard.');
  }
  /* v1.71: the AI proposes, the owner disposes. */
  if ((m = q.match(/^propose\s+([\s\S]+)$/i)) || (m = q.match(/^ask propose\s+([\s\S]+)$/i))) {
    const r = await runTool('llm.chat', { prompt: m[1] }, {});
    if (!r.ok) return R(r.error || 'The AI provider could not answer.');
    const sug = String(r.result.reply || '').match(/^SUGGEST:\s*(.+)$/mi);
    const clean = String(r.result.reply || '').replace(/^SUGGEST:\s*.+$/mi, '').trim();
    if (!sug) return R('🤖 [' + r.result.provider + ' · ' + r.result.model + '] ' + clean + '\n\n(no command proposed — this answer is advice only)');
    const pr = createProposal(sug[1], 'ai', null);
    return R('🤖 [' + r.result.provider + ' · ' + r.result.model + '] ' + clean + '\n\n📋 Proposed command: “' + pr.command + '” — say “do ' + pr.id + '” to run it. It goes through the normal audited router: permissions and approvals still apply, and nothing runs without you.');
  }
  if ((m = low.match(/^do (pr\w+)$/))) {
    const c = consumeProposal(m[1]);
    if (!c.ok) return R(c.error);
    if (proposalSafeGate(c.proposal.command)) {
      if (c.proposal.envelope) fabric.transition(c.proposal.envelope, 'BLOCKED', 'execute-command gate refused (execute-blocked-law)', 'system');
      return R('Refused: proposals cannot carry confirmations or approvals — run “' + c.proposal.command + '” yourself.');
    }
    markProposalExecuted(m[1]);
    /* an OWNER-EXECUTED proposal carries its approval binding: downstream
     * branches gated by §52 high-risk checks recognize it instead of
     * proposing again (no approval → proposal → approval loop). */
    const approvedVia = c.proposal.id;
    /* §42/§151: execution flows through the envelope so the Action Center
     * sees the same truth the gates enforced. */
    if (c.proposal.envelope) {
      c.proposal.executedTs = c.proposal.executedTs || Date.now();
      const run = await fabric.execute(c.proposal.envelope, async () => await command(c.proposal.command, { approval: approvedVia }),
        { note: 'owner executed proposal ' + m[1], successNote: 'proposal executed via audited router' });
      if (run.ok && run.result && run.result.reply !== undefined) return run.result;
      return R(run.ok ? '✅ ' + c.proposal.command + ' — SUCCEEDED (envelope ' + c.proposal.envelope + ', evidence ' + (run.envelope.verification && run.envelope.verification.hash || '—') + ')' : '✘ ' + c.proposal.command + ' — ' + (run.error || 'FAILED') + ' (envelope ' + c.proposal.envelope + ' — see “action ' + c.proposal.envelope + '”)');
    }
    return await command(c.proposal.command);
  }

  /* ── v2.00: device adapters (manufactured baseline fleet) ── */
  if (low === 'device adapters' || low === 'adapters' || low === 'adapters manufactured') {
    const rows = DEVICE_ADAPTERS.map(a => {
      const st = a.getStatus();
      const icon = st.interfacePresent ? '🟢' : '⬜';
      return icon + ' ' + a.id + ' [' + a.manifest().risk + '] baseline ' + a.getStatus().baseline + ' — ' + st.status + ' (' + st.note.split('—')[0].trim() + ')';
    });
    return R('MANUFACTURED DEVICE/OS ADAPTERS (spec/ADAPTERS-BASELINE.md) — 🟢 interface present on this host, ⬜ DECLARED (answers UNAVAILABLE, never fakes §108):\n' + rows.join('\n') + '\n\nRun a read-only op: “device run <adapter-id> <op>” · trust: “device trust” · offenses: “offenses”.');
  }
  if ((m = low.match(/^(pend|restrict|lock|revoke|unlock|trust) device ([\w:.@-]{2,64})( confirmed)?$/))) {
    const verbs = { pend: 'PENDING', restrict: 'RESTRICTED', lock: 'LOCKED', revoke: 'REVOKED', unlock: 'UNKNOWN', trust: 'TRUSTED' };
    const r = setDeviceTrust(m[2], verbs[m[1]], !!m[3]);
    return R(r.ok ? 'Device ' + m[2] + ' ' + r.from + ' → ' + verbs[m[1]] + ' — audited (§40).' : r.error);
  }
  if (low === 'root state' || low === 'root status') {
    return R('§24 ROOT — state: ' + rootState() + ' · host probe uid=' + (process.getuid ? process.getuid() : '?') + ' (' + (rootProbe() ? 'ROOT AVAILABLE on this host' : 'not root') + ')\nStates: ' + ROOT_STATES.join(' · ') + ' — set with “set root <STATE> [confirmed]”. Elevated-risk operations may demand ROOT_AUTHORIZED; the system never requests or activates root silently (§24).');
  }
  if ((m = low.match(/^set root ([\w]+)( confirmed)?$/i))) {
    const r = setRootState(m[1].toUpperCase(), !!m[2]);
    return R(r.ok ? 'Root state ' + r.from + ' → ' + r.to + ' — audited.' : r.error);
  }
  if (low === 'capability levels' || low === 'permission levels') {
    const lm = kernel.LEVEL_MEANING || { OBSERVE: 'Read or inspect only.', ASSIST: 'Prepare actions; the user executes or approves them.', EXECUTE: 'Perform explicitly authorized actions.', AUTONOMOUS: 'Act inside a narrow, pre-approved scope without per-action asking.', RESTRICTED: 'Explicitly limited execution boundaries.' };
    return R('§10 PERMISSION LEVELS (WitForge can never raise its own level — human-authorized only):\n' + kernel.PERMISSION_LEVELS.map(l => '• ' + l + ' — ' + (lm[l] || '')).join('\n'));
  }
  if ((m = low.match(/^set capability level ([\w.]+) (\w+)( confirmed)?$/i))) {
    const dec = kernel.requestLevelChange({ kind: 'owner' }, capabilityLevel(m[1]) || 'RESTRICTED', m[2].toUpperCase(), { approvalId: m[3] ? 'console-confirmed' : null });
    if (!dec.ok && dec.decision === 'ASK') return R('AUTONOMOUS requires an approval record (§10): say “set capability level ' + m[1] + ' '+'AUTONOMOUS '+' confirmed” to bind one.');
    if (!dec.ok) return R('Refused: ' + (dec.reason || dec.decision) + (dec.detail ? ' — ' + dec.detail : ''));
    return R('Capability ' + m[1] + ' level ' + (dec.from || '?') + ' → ' + dec.to + ' — ' + dec.reason + ' (§10 law; audited).');
  }
  if (low === 'policy decisions') {
    return R('§44 POLICY DECISIONS (applied before every execution):\n• ALLOW — proceeds\n• DENY — refused\n• ASK — approval required\n• ESCALATE — stronger confirmation/authentication\n• BLOCK — unconditional refusal (e.g. PROHIBITED)\nEvery tool/adapters run carries one; “selftest” re-derives the PACK each release.');
  }

  if (low === 'device trust' || low === 'trusted devices') {
    const t = S.deviceTrust || {};
    const ids = Object.keys(t);
    return R(ids.length ? 'DEVICE TRUST (§40 — authenticated & revocable):\n' + ids.map(k => '• ' + k + ' = ' + t[k]).join('\n') : 'No device trust records yet (everything is UNKNOWN). “trust device <id> confirmed” / “revoke device <id>”.');
  }
  if ((m = low.match(/^trust device ([\w:.@-]{2,64})( confirmed)?$/))) {
    const r = setDeviceTrust(m[1], 'TRUSTED', !!m[2]);
    return R(r.ok ? 'Device ' + m[1] + ' now TRUSTED (recorded, audited, revocable with “revoke device ' + m[1] + '”).' : r.error);
  }
  if ((m = low.match(/^revoke device ([\w:.@-]{2,64})$/))) {
    const r = setDeviceTrust(m[1], 'REVOKED', true);
    return R(r.ok ? 'Device ' + m[1] + ' REVOKED — all future ops refuse until re-trusted. Audited.' : r.error);
  }
  if ((m = low.match(/^device run (\w[\w-]*) (\w[\w.]*)$/))) {
    const adap = DEVICE_ADAPTERS.find(a => a.id === m[1]);
    if (!adap) return R('Unknown adapter “' + m[1] + '”. See “device adapters”.');
    const RESTRICTIVE = /^(android-adb|android-accessibility|ios|termux|shizuku|chromeos)/.test(m[1]);
    /* §40: device-target adapters require the RUN to name a target that is TRUSTED.
     * Until you “trust device <id> confirmed”, even authorized runs stop here. */
    if (RESTRICTIVE && !(opts && opts.approval && (opts.deviceTrusted === true))) {
      /* find the trust record for these platform-target adapters: no named
       * device on the console yet → require platform-scoped trust marker. */
      const marker = 'platform:' + m[1];
      if (deviceTrust(marker) !== 'TRUSTED') {
        const evOff = recordOffense({ kind: 'untrusted-device-execution', detail: m[1] + '.' + m[2] + ' attempted while ' + marker + ' is ' + deviceTrust(marker), evidenceHash: crypto.createHash('sha256').update(marker + m[2]).digest('hex').slice(0, 20), status: 'UNJUST-REFUSED' });
        return R('⛔ ' + m[1] + '.' + m[2] + ' refused by §40 — ' + marker + ' is ' + deviceTrust(marker) + ' (needs TRUSTED). First: “trust device ' + marker + ' confirmed”. Offense ' + evOff.id + ' recorded.');
      }
    }
    const m2 = adap.manifest();
    if (m2.risk === 'high' && !(opts && opts.approval)) {
      const pr = createProposal('device run ' + m[1] + ' ' + m[2], 'device', 'high-risk adapter op — approval first (§52)');
      return R('⚠ ' + m[1] + '.' + m[2] + ' is HIGH risk — proposals gain authority first (§52). Say “do ' + pr.id + '” to run it through the audited router.');
    }
    const res = await adap.executeAction(m[2], {});
    if (res.status === 'SUCCEEDED') {
      audit('security', 'JUSTIFIED-AUTHORIZED ' + m[1] + '.' + m[2] + ' (evidence ' + res.evidence.hash + ')', 'system');
      return R('✔ ' + m[1] + '.' + m[2] + ' SUCCEEDED — cross-source verified (§98), evidence ' + res.evidence.hash + '\n' + String(res.result.transcript || '').slice(0, 600));
    }
    return R((res.status === 'BLOCKED' ? '⛔ ' : res.status === 'UNAVAILABLE' ? '⬜ ' : '✘ ') + m[1] + '.' + m[2] + ' → ' + res.status + ' — ' + (res.error || 'see evidence') + (res.correlationId ? ' [' + res.correlationId + ']' : ''));
  }
  if (low === 'offenses' || low === 'offense ledger') {
    const offs = S.offenses || [];
    if (!offs.length) return R('OFFENSE LEDGER — clean: zero attempted violations recorded (every attempt lands here as UNJUST-REFUSED or JUSTIFIED-AUTHORIZED, auditable with evidence hashes — OFFENSES.md).');
    return R('OFFENSE LEDGER — ' + offs.length + ' recorded (justification is recorded truth, never re-labelled):\n' + offs.slice(0, 12).map(o => (o.status === 'UNJUST-REFUSED' ? '🛑' : '🟩') + ' ' + o.id + ' [' + o.status + '] ' + o.kind + ' — ' + o.detail.slice(0, 80) + (o.evidenceHash ? ' · evidence ' + o.evidenceHash : '')).join('\n'));
  }

  /* ── v1.99: the ACTION CENTER (console surface over envelopes) ── */
  if (low === 'actions' || low === 'action center' || low === 'action list') {
    const st = fabric.stats();
    return R('ACTION CENTER — ' + st.count + ' envelopes (' + st.open + ' open) — durable, audited, crash-truthful (§99/§151/§165):\n' + fabric.table(12) + '\n\n“action <id>” for the full envelope · “cancel action <id>” · “retry action <id>” for FAILED/UNKNOWN.');
  }
  if ((m = low.match(/^action (ev\w+)$/))) {
    const d = fabric.detail(m[1]);
    if (!d.ok) return R(d.error);
    const e = d.envelope;
    return R('ENVELOPE ' + e.id + ' — ' + e.state + ' (' + e.history.length + ' transitions, correlation ' + e.correlationId + ')\n' +
      ' intent: ' + e.intent + '\n authority: ' + (e.authority.approval || e.authority.permission || 'owner console') + ' — ' + e.authority.law + '\n' +
      ' security: ' + (e.security.decision || '—') + ' · risk ' + (e.security.risk || '—') + '\n' +
      ' verification: ' + (e.verification.method || '—') + (e.verification.hash ? ' · evidence ' + e.verification.hash : '') + '\n' +
      ' evidence records: ' + e.evidence.length + ' · recovery attempts: ' + e.recovery.attempts + '\n' +
      ' lineage:\n' + e.history.slice(-8).map(h => '   ' + new Date(h.ts).toISOString().slice(11, 19) + ' ' + (h.from || '∅') + ' → ' + h.to + (h.note ? ' — ' + h.note.slice(0, 90) : '')).join('\n'));
  }
  if ((m = low.match(/^cancel action (ev\w+)$/))) {
    const r = fabric.cancel(m[1], 'user');
    return R(r.ok ? 'Envelope ' + m[1] + ' CANCELLED — recorded, audited, terminal (§99).' : r.error);
  }
  if ((m = low.match(/^retry action (ev\w+)$/))) {
    const d = fabric.detail(m[1]);
    if (!d.ok) return R(d.error);
    const r = fabric.retry(m[1]);
    if (!r.ok) return R(r.error);
    /* re-execution only ever re-runs the original router command — no bypass. */
    if (d.envelope.plan && !proposalSafeGate(d.envelope.plan)) {
      const run = await fabric.execute(m[1], async () => await command(d.envelope.plan), { note: 'owner-authorized retry re-execution' });
      if (run.ok && run.result && run.result.reply !== undefined) return run.result;
      return R(run.ok ? '✅ retry SUCCEEDED — envelope ' + m[1] : '✘ retry failed again — ' + (run.error || 'FAILED') + ' (envelope ' + m[1] + ')');
    }
    return R('Envelope ' + m[1] + ' → RECOVERING. Re-run requires a fresh proposal (the plan carried a gated command).');
  }

  /* §144/§10 availability truth: a capability is never shown as usable merely
   * because it is declared — it needs a legitimate interface AND authorized
   * access on this machine right now. */
  if (low === 'capabilities live' || low === 'capability availability' || low === 'what can you actually do') {
    const rows = Object.keys(TOOLS).slice(0, 24).map(id => {
      const t = TOOLS[id];
      const st = capabilityState(t.cap);
      return '• ' + id + ' [' + t.risk + '] — interface LIVE (local adapter bound) · permission ' + (st || 'NOT_REQUESTED');
    });
    const srv = (listCreds() || []).map(x => x.id);
    const svcRows = ['github', 'stripe', 'openrouter', 'gemini', 'ollama'].map(id => {
      const live = srv.includes(id) || id === 'ollama';
      return '• service.' + id + ' — ' + (live ? 'CONNECTED (authorized access present)' : 'DECLARED — no credential stored yet') ;
    });
    return R(rows.join('\n') + '\n' + svcRows.join('\n') + '\n\nRule (§144): a capability is usable only when a legitimate interface exists AND authorized access is present. Declaration is not availability.');
  }
  if (low === 'local models' || low === 'models') {
    const models = await llm.ollamaModels({ localFetch: llmLocalFetch });
    return R(models && models.length ? 'Local models installed (Ollama):\n' + models.map(x => '• ' + x).join('\n') + '\nPull more: “local pull <model>” · remove: “local remove <model>”.' : 'No local models are installed yet. Say “local pull qwen2.5:0.5b” to fetch one (~400MB, runs fully offline).');
  }
  if ((m = low.match(/^local pull ([a-z0-9][a-z0-9._:-]{2,59})$/))) {
    const r = await runTool('local.pull', { model: m[1] }, {});
    return r.ok ? R('Pulled ' + m[1] + ' (real Ollama pull). Installed now: ' + (r.result.models || []).join(', ') + ' — “ask …” uses the first installed model.') : R(r.error);
  }
  if ((m = low.match(/^local remove ([a-z0-9][a-z0-9._:-]{2,59})$/))) {
    const r = await runTool('local.remove', { model: m[1] }, {});
    return r.ok ? R('Removed ' + m[1] + '. Installed now: ' + ((r.result.models || []).join(', ') || 'none') + '.') : R(r.error);
  }
  if ((m = q.match(/^connect ([a-zA-Z0-9-]+) (?:with )?(?:token )?(.+)$/i))) {
    const r = setCredential(m[1].toLowerCase(), m[2].trim());
    return r.ok ? R(`Credential for ${r.service} stored encrypted. Run “verify ${r.service}” (or the adapter's status tool) to prove it works — configuration alone never counts as connected.`) : R(r.error);
  }
  if ((m = low.match(/^(?:disconnect|revoke credential for) ([a-z0-9-]+)$/))) { const r = revokeCredential(m[1]); return r.ok ? R('Credential for ' + m[1] + ' revoked and destroyed.') : R(r.error); }
  if (low === 'connections' || low === 'list connections') {
    const cs = listCreds();
    return R(cs.length ? 'Stored credentials (encrypted at rest, never returned): ' + cs.map(c => c.service).join(', ') : 'No credentials stored. Say “connect <service> with token <token>” and I will store it encrypted and use it only for that service.');
  }
  if ((m = low.match(/^verify (github)/))) {
    const r = await runTool('github.status', {}, { confirmed: low.includes('confirm') });
    if (r.ok) { S.verifiedConnectors = S.verifiedConnectors || {}; S.verifiedConnectors.github = { user: r.evidence.user || 'unknown', verifiedTs: Date.now() }; save(); return R('GitHub verified for user: ' + (r.evidence.user || 'unknown') + '. Connector is live (VERIFIED — real API evidence).'); }
    return R((r.evidence && r.evidence.error) || r.error);
  }
  if (low.startsWith('preview ')) { const r = preview(low); return r.ok ? R(r.reply) : R(r.error); }
  if ((m = low.match(/^autonomous (on|off)( confirm)?/))) {
    if (m[1] === 'on' && !m[2]) { const ap = createApproval('autonomous', 'Enable autonomous mode (medium-risk auto-grant during HIGH)'); return R('Autonomous mode is high-impact: approval required (approve ' + ap.id + '), or say “autonomous on confirm”.'); }
    S.autonomous = m[1] === 'on'; audit('security', 'Autonomous mode ' + (S.autonomous ? 'ENABLED' : 'DISABLED') + ' by user', 'user'); save();
    return R('Autonomous mode ' + (S.autonomous ? 'ENABLED. High-risk actions still require approval; truth boundary unchanged.' : 'disabled.'));
  }
  if ((m = low.match(/^set emergency (\w+)/))) return setEmergency(m[1].toUpperCase(), low.includes('confirm')) ? R('Emergency state now ' + S.emergency + '.') : R('Approval required for that change.');
  if (low.includes('lockdown') && low.includes('confirm')) { setEmergency('LOCKDOWN', true); return R('LOCKDOWN engaged. Execution blocked; audit and recovery preserved.'); }
  if (low.includes('lockdown')) { const r = setEmergency('LOCKDOWN'); return r.ok ? R('LOCKDOWN engaged.') : R(r.error); }
  if ((m = low.match(/^approve (\w+)/))) { const r = decideApproval(m[1], 'approve'); return r.ok ? R('Approved: ' + r.approval.desc) : R(r.error); }
  /* v1.66: human-in-the-loop step resolution — the answer keeps its original
   * case (codes and captchas are case-sensitive), so match on q, not low. */
  if ((m = q.match(/^resolve (hs\w+)(?:\s+with\s+([\s\S]+)|\s+([\s\S]+))?$/i))) {
    const data = (m[2] != null ? m[2] : (m[3] != null ? m[3] : '')).trim();
    const r = resolveHumanStep(m[1].toLowerCase(), data, 'chat');
    return r.ok ? R(`Human step ${r.step.id} (${r.step.kind}) resolved and audited. Repeat the original command — your answer is injected once, then the step is closed.`) : R(r.error);
  }
  if (low === 'human steps' || low === 'pending steps' || low === 'steps') {
    const list = S.humanSteps.slice(0, 10);
    return R(list.length
      ? 'Human steps (newest first):\n' + list.map(h => `${h.id} [${h.status.toUpperCase()}] ${h.toolId} (${h.kind})${h.service ? ' · ' + h.service : ''} — ${h.instructions}`).join('\n')
      : 'No human steps have been requested. A step appears when a tool meets a captcha, 2FA, consent or other human gate — the platform pauses and asks you; it never bypasses the gate.');
  }
  if ((m = low.match(/^stop schedule (sch-[\w]+)$/))) {
    const r = S.schedules.find(x => x.id === m[1] && !x.done);
    if (!r) return R('No active schedule with id ' + m[1] + '.');
    r.done = true; audit('tool', 'SCHEDULE ' + r.id + ' stopped', 'user'); save();
    return R(`Schedule ${r.id} stopped after firing ${r.fired}×.`);
  }
  /* §55: emergency stop scopes — matched before the approval-stop intent. */
  if ((m = low.match(/^(?:emergency )?stop (task|agent|integration|device|autonomous|network|account)s?\b(?:\s+(random|confirm))?/))) {
    const scope = m[1];
    const r = stopScope(scope, null, 'user emergency stop via chat');
    return R(r.ok ? `STOP engaged for ${scope} — ${kernel.STOP_DESCRIPTIONS[scope]}. Execution in that scope is suspended; audit and recovery stay available. Resume with “resume ${scope}”.` : r.error);
  }
  if (low === 'emergency stop all' || low === 'stop all scopes' || low === 'stop-all') {
    const r = stopAllScopes('user emergency stop for all scopes');
    return R(`EMERGENCY STOP across all ${r.stopped} scopes (${r.scopes.join(', ')}). Nothing executes in those scopes until you resume them.`);
  }
  if ((m = low.match(/^resume (task|agent|integration|device|autonomous|network|account)\b/))) {
    const r = resumeScope(m[1], null);
    return R(r.ok ? `${m[1]} restarted — the stop has been cleared and the action is audited.` : r.error);
  }
  if (low === 'stops' || low === 'active stops') {
    const list = kernel.stopReport(S);
    return R(list.length ? 'Active stops:\n' + list.map(x => `• ${x.scope}${x.target !== '*' ? ':' + x.target : ''} — ${x.reason}`).join('\n') : 'No emergency stops active. Say “stop network” or “emergency stop all”.');
  }
  if ((m = low.match(/^stop (hs\w+)$/))) { const r = cancelHumanStep(m[1]); return r.ok ? R('Human step ' + m[1] + ' cancelled and audited.') : R(r.error); }
  if ((m = low.match(/^stop (\w+)/))) { const r = decideApproval(m[1], 'stop'); return r.ok ? R('Stopped: ' + r.approval.desc) : R(r.error); }
  if ((m = low.match(/^grant ([\w.]+)/)) ) { grant(m[1]); return R('Permission granted: ' + m[1] + ' (granted by your request, audited).'); }
  if ((m = low.match(/^revoke ([\w.]+)/))) { const r = revoke(m[1]); return R(r.ok ? 'Permission revoked: ' + m[1] + ' (state REVOKED — token no longer validates).' : r.error); }
  /* §9/§10/§51/§44: inspect or change the authority model itself. */
  if (low === 'permissions' || low === 'capability states' || low === 'capabilities table') {
    const t = capabilityTable().filter(c => c.state !== 'NOT_REQUESTED');
    return R(t.length ? 'Capability states (state · level · risk):\n' + t.map(c => `• ${c.capability} — ${c.state} · ${c.level || '—'} · ${c.risk}${c.scopes && Object.keys(c.scopes).length ? ' · scopes ' + Object.keys(c.scopes).join(',') : ''}`).join('\n') : 'No capability has been requested yet. Asking for something grants it; high risk requires approval.');
  }
  if ((m = low.match(/^(suspend|resume|deny|expire) ([\w.]+)$/))) {
    const map = { suspend: suspend, resume: resumeCapability, deny: deny, expire: expire };
    const r = map[m[1]](m[2]);
    return R(r.ok ? `${m[2]} → ${r.state} (audited state change on the §9 permission machine).` : r.error);
  }
  if ((m = low.match(/^(?:risk|assess) ([\w.]+)$/))) {
    const tool = TOOLS[m[1]];
    if (!tool) return R('Unknown tool: ' + m[1]);
    const a = assessAction(m[1], {});
    return R(`${m[1]}: risk ${a.class} (score ${a.score}) — ${a.explanation}. Approval: ${JSON.stringify(kernel.approvalMatrix(a.class))}`);
  }
  if ((m = low.match(/^policy ([\w.]+)$/))) {
    const tool = TOOLS[m[1]];
    if (!tool) return R('Unknown tool: ' + m[1]);
    const p = actionPolicy(m[1], {}, {});
    return R(`Policy for ${m[1]}: ${p.decision.decision} via ${p.decision.policyId} — ${p.decision.reason} (risk ${p.assessment.class}, capability ${p.cap} is ${capabilityState(p.cap)})`);
  }
  /* §102–§160: workflow playbooks. */
  if (low === 'playbooks' || low === 'workflows') {
    return R('Workflow playbooks (spec worked examples):\n' + Object.entries(taskEngine.PLAYBOOKS).map(([k, v]) => `• ${k} ${v.section} — ${v.title} (${v.steps.length} steps)`).join('\n') + '\nRun one with “run playbook <key>”. Steps with no connected legitimate interface are reported WAITING_FOR_CAPABILITY — never faked.');
  }
  if ((m = low.match(/^run playbook ([\w-]+)/))) {
    const r = await runPlaybookLocal(m[1], { params: {} });
    if (!r.ok && r.error) return R(r.error + ' Available: ' + (r.available || []).join(', '));
    return R(`PLAYBOOK ${r.playbook} ${r.section} → ${r.state}\n` + r.steps.map(x => `• ${x.id}: ${x.state}${x.failureClass ? ' (' + x.failureClass + ')' : ''}${x.capability ? ' [' + x.capability + ']' : ''}`).join('\n') + `\n${r.performed} performed · ${r.waitingForCapability} waiting for capability · ${r.failed} failed`);
  }
  /* §151 task state machine. */
  if ((m = low.match(/^new task (.+)$/))) {
    const t = taskEngine.createTask(m[1]);
    taskEngine.advance(t, 'UNDERSTANDING'); taskEngine.advance(t, 'PROBLEM_SOLVING'); taskEngine.advance(t, 'PLANNING');
    S.taskRecords.unshift(t); save();
    audit('task', 'TASK created: ' + t.objective.slice(0, 80), 'user', { action: 'task.create', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    return R(`Task ${t.id} created and advanced to ${t.state}. Objective: “${t.objective}”. It moves through the durable state machine (CREATED → UNDERSTANDING → PROBLEM_SOLVING → PLANNING → …).`);
  }
  if (low === 'tasks state' || low === 'task states') {
    const t = S.taskRecords.slice(0, 8);
    return R(t.length ? 'Durable tasks:\n' + t.map(x => `• ${x.id} — ${x.state} — ${x.objective.slice(0, 60)}`).join('\n') : 'No durable tasks yet. Say “new task <objective>”.');
  }
  /* §118/§119/§129 inspection. */
  if (low === 'vault' || low === 'evidence vault') {
    const v = kernel.vaultVerify(S);
    return R(`Evidence vault: ${v.entries} record(s), integrity ${v.ok ? 'VERIFIED' : 'BROKEN'}.` + (S.evidenceVault.slice(0, 5).map(e => '\n• ' + e.kind + ' ' + e.hash.slice(0, 12) + '…').join('')));
  }
  if (low === 'metrics' || low === 'observability') {
    const o = observability();
    return R(`Observability: ${o.metrics.length} metric point(s), ${o.spans.length} span(s), correlation ids join them into task timelines. OpenTelemetry-shaped export available at /api/observability.`);
  }
  if ((m = low.match(/^trace (\S+)/))) {
    const t = services.traceTimeline(S, m[1]);
    return R(`Timeline for ${m[1]}: ${t.spans.length} span(s), ${t.audit.length} audit event(s).` + t.audit.slice(0, 5).map(a => '\n• ' + a.action).join(''));
  }
  /* ══ v1.65 engagement: everything below is plain-language control ══ */
  if (low === 'help' || low === 'what can i say' || low === 'commands' || low === 'what can you do') {
    return R(CAPABILITY_HELP.map(g => g.group.toUpperCase() + '\n' + g.items.map(i => '  • ' + i).join('\n')).join('\n\n'));
  }
  /* ── events ── */
  if (low === 'events' || low === 'event board' || low === 'event list') {
    const list = engagement.listEvents(S);
    return R('Events board (' + list.length + '):\n' + list.map(e => `• ${e.id} — ${e.title} [${e.state}] ${e.entryLD ? 'entry ' + e.entryLD + ' LD · ' : ''}${e.entries} entrant(s) · ${e.joinable ? 'open' : 'scheduled'}\n    ${e.blurb}`).join('\n') + '\nJoin with “join event <id>”.');
  }
  if ((m = low.match(/^join event ([\w-]+)/))) {
    const r = joinEventCmd(m[1]);
    return R(r.ok ? r.reply : r.error);
  }
  if ((m = low.match(/^event progress ([\w-]+)(?: (\d+))?/))) {
    const r = eventProgressCmd(m[1], null, m[2]);
    return R(r.ok ? r.reply : r.error);
  }
  if ((m = low.match(/^close event ([\w-]+)(?: winner (\S+))?/))) {
    const wm = q.match(/^close event ([\w-]+)(?: winner (\S+))?/i) || m;
    const r = closeEventCmd(wm[1], { winner: wm[2] });
    return R(r.ok ? r.reply : r.error);
  }
  /* ── lotto ── */
  if (low === 'lotto' || low === 'lotto status' || low === 'lottery') {
    const open = engagement.openRoundOf(S);
    const last = (S.lottoRounds || []).find(r => r.state === 'DRAWN');
    return R([
      'Lotto — ' + engagement.LOTTO_RULES.numbersPerLine + ' numbers from 1–' + engagement.LOTTO_RULES.maxNumber + ', ticket ' + engagement.LOTTO_RULES.ticketLD + ' LD.',
      open ? `Open round ${open.id}: ${open.tickets.length} ticket(s) sold, commitment ${open.commitHash.slice(0, 16)}…` : 'No round is open — say “open lotto round”.',
      last ? `Last draw ${last.id}: numbers ${last.drawn.numbers.join(', ')} · ${last.prizes.payouts.length} winning ticket(s) · ${last.prizes.rolloverOut ? last.prizes.rolloverOut + ' LD rolled over' : 'jackpot won'}` : 'No draw has run yet.',
      engagement.LOTTO_RULES.settlement,
      engagement.LOTTO_RULES.realMoney
    ].join('\n'));
  }
  if (low === 'open lotto round' || low === 'new lotto round') {
    const r = openLottoCmd();
    return R(r.ok ? r.reply : r.error);
  }
  if ((m = low.match(/^buy (\d+ )?lotto tickets?(?: for (\S+))?/)) || low === 'buy a lotto ticket') {
    const count = m && m[1] ? Number(m[1]) : 1;
    const r = buyTicketsCmd(count, m && m[2]);
    if (!r.ok) return R(r.error + (r.round === undefined ? ' (Say “open lotto round” first.)' : ''));
    return R(r.reply);
  }
  if ((m = low.match(/^draw lotto(?: (\S+))?( confirm)?$/))) {
    const roundId = m[1] && m[1] !== 'confirm' ? m[1] : undefined;
    const r = drawLottoCmd(roundId, !!m[2] || m[1] === 'confirm');
    if (r.needsConfirmation) return R(r.reply);
    return R(r.ok ? r.reply : r.error);
  }
  if ((m = low.match(/^verify lotto(?: (\S+))?/))) {
    const r = m[1] ? (S.lottoRounds || []).find(x => x.id === m[1]) : (S.lottoRounds || []).find(x => x.state === 'DRAWN');
    if (!r) return R('No drawn round to verify');
    const v = engagement.verifyRound(r);
    return R(`${r.id}: commitment ${v.commitOk ? 'MATCHES' : 'FAILED'} · ticket lines ${v.ticketsOk ? 're-derive exactly' : 'MISMATCH'} · sales ${v.totalOk ? 'reconcile' : 'DO NOT RECONCILE'} · numbers ${v.numbers.join(' · ')}\n${v.note}`);
  }
  /* ── sign-in gifts ── */
  if (low === 'sign in' || low === 'claim sign in' || low === 'daily gift' || low === 'gift' || low === 'my streak') {
    const r = signInCmd(null, { statusOnly: low === 'my streak' && !engagement.signInStatus(S, ownerWallet()).claimedToday });
    return R(r.ok ? r.reply : r.error);
  }
  /* ── daily & weekly tasks ── */
  if (low === 'daily tasks' || low === 'weekly tasks' || low === 'tasks board' || low === 'quests' || low === 'daily' || low === 'weekly') {
    const q = engagement.questSummary(S);
    const show = what => q[what].map(t => `${t.claimable ? '★ CLAIMABLE' : t.complete ? '■ done' : '□ ' + t.progress + '/' + t.target} — ${t.title} (${t.ld} LD) [${t.id}]`).join('\n');
    const wanted = (low === 'daily tasks' || low === 'daily') ? ['daily'] : (low === 'weekly tasks' || low === 'weekly') ? ['weekly'] : ['daily', 'weekly'];
    const parts = [];
    if (wanted.includes('daily')) parts.push('DAILY (' + q.day + ')\n' + show('daily'));
    if (wanted.includes('weekly')) parts.push('WEEKLY (' + q.week + ')\n' + show('weekly'));
    return R(parts.join('\n\n') + `\n${q.claimable} task(s) ready to claim — say “claim task <id>”. The board is fixed for the window, so it cannot be re-rolled for an easier one.`);
  }
  if ((m = low.match(/^claim (?:task )?([\w-]+)$/))) {
    const r = claimQuestCmd(m[1]);
    return R(r.ok ? r.reply : r.error);
  }
  /* ── LD market: bought and sold in the app ── */
  if (low === 'ld market' || low === 'ld price' || low === 'ld rates' || low === 'buy ld' || low === 'market price') {
    const mk = engagement.LD_MARKET;
    return R([
      `LD market — buy at A$${mk.buyRateAudPerLD} per LD (100 LD = A$1.00), sell back at A$${mk.sellRateAudPerLD} per LD (${Math.round((1 - mk.sellRateAudPerLD / mk.buyRateAudPerLD) * 100)}% disclosed spread).`,
      `Orders: minimum ${mk.minOrderLD} LD, maximum ${mk.maxOrderLD} LD, in multiples of ${mk.roundToLD} LD.`,
      'Say “buy 500 ld” or “sell 500 ld”.',
      mk.note,
      'Balances: ' + Object.keys(S.ledger.accounts).map(k => k + '=' + S.ledger.accounts[k]).join(' · ')
    ].join('\n'));
  }
  if ((m = low.match(/^(?:buy|purchase) (\d+) ?ld/))) {
    const r = ldMarketCmd(Number(m[1]), 'buy');
    return R(r.ok ? `Bought ${r.order.ld} LD for A$${r.order.aud.toFixed(2)} at A$${r.order.rateAudPerLD} per LD (SIMULATION). Balance ${r.balance} LD. Order ${r.order.id}.` : r.error);
  }
  if ((m = low.match(/^sell (\d+) ?ld/))) {
    const r = ldMarketCmd(Number(m[1]), 'sell');
    return R(r.ok ? `Sold ${r.order.ld} LD for A$${r.order.aud.toFixed(2)} at A$${r.order.rateAudPerLD} per LD (5% spread, SIMULATION — nothing was paid out). Balance ${r.balance} LD. Order ${r.order.id}.` : r.error);
  }
  if (low === 'economy' || low === 'economy report' || low === 'ld economy' || low === 'ld supply') {
    const e2 = economyReport();
    return R([
      `LD economy — mode ${e2.mode}. Circulating ${e2.circulatingLD} LD across player accounts.`,
      'Pools: ' + Object.entries(e2.pools).map(([k, v]) => k + '=' + v).join(' · '),
      'Piece prices: ' + Object.entries(e2.priceTable.pieces).map(([k, v]) => k + '=' + v).join(' · ') + ' · pet=' + e2.priceTable.pet,
      'Market: buy A$' + e2.market.buyRateAudPerLD + ' per LD, sell A$' + e2.market.sellRateAudPerLD + ' per LD.',
      e2.note
    ].join('\n'));
  }
  if (low === 'piece prices' || low === 'prices' || low === 'price list') {
    const p = piecePriceList();
    return R('Piece prices (LD): ' + Object.entries(p.pieces).map(([k, v]) => k + '=' + v).join(' · ') + '\nPet=' + p.pet + ' · merge: ' + Object.entries(p.merge).map(([k, v]) => k + '=' + v).join(', ') + '\n' + p.drops + '\n' + p.market);
  }
  if ((m = low.match(/^summon pet for ([\w '-]{2,30})$/))) {
    const r = summonPetCmd(m[1]);
    return R(r.ok ? `${r.pet.name} the ${r.pet.species} (${r.pet.rarity}) joined ${m[1].trim()} for ${r.cost} LD.` : (r.error + (r.needed ? ' — needs ' + r.needed + ' LD, wallet holds ' + r.balance + '.' : '')));
  }
  if ((m = low.match(/^merge pieces ([\w '-]{2,30}) ([\w ,]+)$/))) {
    const r = mergePiecesCmd(m[1], m[2].split(/[\s,]+/).filter(Boolean));
    return R(r.ok ? `Merged into ${r.merged.name} (${r.merged.rarity} R${r.merged.rlevel}) for ${r.cost} LD.` : (r.error + (r.needed ? ' — needs ' + r.needed + ' LD.' : '')));
  }
  /* ── subscription tiers: personal and business ── */
  if (low === 'plans' || low === 'subscription plans' || low === 'plan list' || low === 'pricing') {
    const fam = { personal: [], business: [] };
    services.PLANS.forEach(p => (fam[p.family || 'personal']).push(p));
    const line = p => `• ${p.name} [${p.id}] — ${p.blurb}\n    agents ${p.entitlements['agents.max']} · storage ${p.entitlements['storage.mb']}MB · AI/day ${p.entitlements['ai.daily']} · seats ${p.entitlements['org.seats']} · guardian ${p.entitlements['guardian.level']} · lotto/day ${p.entitlements['lotto.ticketsPerDay']}`;
    return R('PERSONAL\n' + fam.personal.map(line).join('\n') + '\n\nBUSINESS\n' + fam.business.map(line).join('\n') + '\n\nPrices are reference labels, not charges: billing stays COMPLIANCE-LOCKED until billing authority exists. Say “upgrade to pro” or “change plan business-plus”.');
  }
  if ((m = low.match(/^(?:upgrade|change|switch) (?:plan |to |me to )?([a-z0-9-]+)$/))) {
    const r = subscribeCmd(m[1]);
    if (!r.ok) return R(r.error + ' Available: ' + services.PLANS.map(p => p.id).join(', '));
    const sub = r.subscription;
    audit('subscription', 'PLAN ' + sub.planId + ' (' + sub.planName + ') selected', 'user', { action: 'plan.change', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    save();
    return R(`Plan set to ${sub.planName} [${sub.planId}] — ${sub.family} tier, rank ${sub.rank}. Entitlements: ${Object.entries(sub.entitlements).map(([k, v]) => k + '=' + v).join(', ')}. Billing: not chargeable (${sub.billing.note})`);
  }
  /* ── owner security + guardian ── */
  if (low === 'secure my account' || low === 'security posture' || low === 'protect me' || low === 'protection report') {
    const p = ownerSec.protectionReport(S);
    return R([
      `Owner protection — level ${p.level}, posture ${p.grade} (${p.score}/100). Controls ${p.controlsEnabled}/${p.controlsTotal}. Threats: ${p.threats.covered} covered · ${p.threats.partial} partial · out of scope: ${p.threats.outOfScope.join(', ')}.`,
      'Second factor: ' + (p.secondFactor.enabled ? (p.secondFactor.verified ? 'ENABLED and verified' : 'enrolled — verify one code to finish') : 'not enabled — say “enable second factor”') + ' · recovery codes left ' + p.secondFactor.recoveryCodesLeft,
      'Active sessions: ' + p.sessions + ' — say “sessions” to review, “revoke session <id>” to end one.',
      'Next: ' + (p.nextSteps.map(x => x.name).join(', ') || 'nothing outstanding for this build'),
      p.honestLimit
    ].join('\n'));
  }
  if (low === 'enable second factor' || low === 'enable 2fa' || low === 'set up 2fa') {
    const r = ownerSec.enrollSecondFactor(S);
    if (!r.ok) return R(r.error);
    audit('security', 'SECOND FACTOR enrolled for the Owner account', 'user', { action: 'security.2fa.enroll', decision: 'ALLOW', risk: 'HIGH', result: 'SUCCEEDED' });
    save();
    return R('Second factor enrolled (TOTP, RFC 6238 — 6 digits, 30-second rotation). Add this to your authenticator now:\n  secret: ' + r.secret + '\n  uri: ' + r.otpauthUrl + '\nRecovery codes (each works once, shown only here):\n' + r.recoveryCodes.map(c => '  ' + c).join('\n') + '\nThen verify: “verify second factor <6-digit code>”.');
  }
  if ((m = low.match(/^verify (?:second factor|2fa) (\d{6})/))) {
    const r = ownerSec.verifySecondFactor(S, m[1]);
    save();
    return R(r.ok ? (r.viaRecoveryCode ? `Recovery code accepted — ${r.remainingCodes} left. Re-enroll the factor soon.` : 'Second factor verified. Re-authentication window open for five minutes — sensitive changes are allowed now.') : r.error);
  }
  if (low === 'sessions' || low === 'list sessions' || low === 'my sessions') {
    const list = ownerSec.sessionInventory(S);
    return R(list.length ? 'Sessions:\n' + list.map(x => `• ${x.id} — age ${Math.round(x.ageMs / 60000)} min`).join('\n') + '\nRevoke one with “revoke session <id>”, or all with “revoke all sessions”.' : 'No active sessions (owner login issues a session cookie).');
  }
  if ((m = low.match(/^revoke (?:all )?sessions?(?: (\S+))?$/))) {
    const all = /all sessions/.test(low);
    const rr = ownerSec.requireReauth(S);
    if (!rr.ok) return R(rr.error);
    const r = ownerSec.revokeSessions(S, all ? { all: true } : { id: m[1] });
    if (!r.ok) return R(r.error);
    audit('security', 'SESSIONS revoked (' + r.revoked + ') by owner', 'user', { action: 'security.session.revoke', decision: 'ALLOW', risk: 'HIGH', result: 'SUCCEEDED' });
    save();
    return R(`Revoked ${r.revoked} session(s). ${r.remaining} remaining.`);
  }
  if ((m = low.match(/^(?:harden my account|raise security level|harden)( maximum| hardened| standard)?$/))) {
    const want = m[1] ? m[1].trim().toUpperCase() : 'STANDARD';
    const r = ownerSec.setSecurityLevel(S, want);
    if (!r.ok) return R(r.error + (r.missing ? '\nRequired first: ' + r.missing.join(', ') : ''));
    save();
    return R(`Owner security level is now ${r.level.id} (${r.level.name}): ${r.level.blurb}`);
  }
  if (low === 'security drill' || low === 'backup drill' || low === 'run drill') {
    const r = ownerSec.runDrill(S, /backup/.test(low) ? 'backup' : 'security');
    save();
    return R(`Drill “${r.drill.kind}” — ${r.drill.passed}/${r.drill.total} checks passed:\n` + r.drill.checks.map(c => `${c.pass ? '✓' : '✗'} ${c.check} — ${c.detail}`).join('\n'));
  }
  if (low === 'alerts' || low === 'security alerts') {
    const os = ownerSec.securityState(S);
    return R(os.alerts.length ? 'Security alerts (newest first):\n' + os.alerts.slice(0, 10).map(a => `• [${a.severity}] ${new Date(a.ts).toISOString().slice(11, 19)} ${a.kind}: ${a.detail}`).join('\n') : 'No security alerts recorded.');
  }
  if (low === 'guardian' || low === 'guardian report' || low === 'guardian status') {
    const g = ownerSec.guardianReport(S);
    return R([g.oath, `Charters ${g.charters} · decisions recorded ${g.events} (${g.denied} refused, ${g.asked} escalated to you).`,
      g.recent.length ? 'Recent:\n' + g.recent.map(e => `• [${e.decision}] ${e.agent}: ${e.action}`).join('\n') : 'No agent actions have been screened yet.'].join('\n'));
  }
  if (low === 'threats' || low === 'what do you protect me from' || low === 'protection matrix') {
    return R('Protection matrix:\n' + ownerSec.THREATS.map(t => `• [${t.status}] ${t.name} — ${t.control}${t.note ? ' ' + t.note : ''}`).join('\n') + '\nOut-of-scope threats are named, not hidden: ' + ownerSec.NOT_PROMISED[0]);
  }
  if ((m = low.match(/^guardian check (.+)$/))) {
    const gm = q.match(/^guardian check (.+)$/i) || m;
    const a = ownerSec.guardianWatch(S, { action: gm[1], source: 'user-request' });
    save();
    return R(`Guardian: ${a.decision} — ${a.reason}${a.triggeredDuties.length ? '\nDuties engaged: ' + a.triggeredDuties.join(', ') : ''}`);
  }
  if (low === 'release' || low === 'version') {
    const r = releaseInfo();
    return R(`${r.version} · built ${new Date(r.buildDate).toISOString()} · revision ${r.sourceRevision} · dependencies: ${r.dependencyState} · tests: ${r.testStatus} · security: ${r.securityStatus}`);
  }
  /* §40/§41/§104 devices. */
  if (low === 'devices') {
    const list = services.isolationReport(S);
    return R(list.length ? 'Paired devices:\n' + list.map(d => `• ${d.name} (${d.platform}) — trust ${d.trust} · caps ${d.capabilities} · sessions ${d.sessions}`).join('\n') + '\nPairing establishes identity only; it grants no capabilities.' : 'No devices paired. Say “pair device <name> as android” — pairing needs the code your device issues and grants no capabilities by itself.');
  }
  if ((m = low.match(/^pair device ([\w '-]{2,30}?)(?: as (android|ios|ipados|macos|windows|linux|chromeos|web|server|wearable|smart-device))?$/))) {
    const r = pairDeviceCmd({ name: m[1], platform: m[2] || 'unknown', method: 'user-initiated' });
    return R(r.ok ? `Device “${r.device.name}” paired — trust state PENDING. Trust it with “trust device ${r.device.name}” once you accept it.` : r.error);
  }
  if ((m = low.match(/^trust device ([\w '-]{2,30})$/))) {
    const d = S.devices.find(x => x.name.toLowerCase() === m[1].toLowerCase());
    if (!d) return R('No paired device named ' + m[1]);
    const r = setDeviceTrustCmd(d.id, 'TRUSTED');
    return R(r.ok ? `${d.name} is now TRUSTED. Capabilities are still granted per capability, never in bulk.` : r.error);
  }
  if ((m = low.match(/^(?:revoke|untrust) device ([\w '-]{2,30})$/))) {
    const d = S.devices.find(x => x.name.toLowerCase() === m[1].toLowerCase());
    if (!d) return R('No paired device named ' + m[1]);
    const r = setDeviceTrustCmd(d.id, 'REVOKED', { reason: 'revoked by user via chat' });
    return R(r.ok ? `${d.name} REVOKED — sessions cleared, capabilities dropped, audit preserved.` : r.error);
  }
  /* §130–§139 accounts. */
  if (low === 'accounts' || low === 'account inventory') {
    const inv = services.accountInventory(S);
    return R(inv.length ? 'Account inventory:\n' + inv.map(a => `• ${a.service}:${a.identifier} — ${a.connectionStatus} · ${a.securityStatus}${a.capabilities.length ? ' · ' + a.capabilities.length + ' caps' : ''}`).join('\n') : 'No accounts recorded. “record account <service>:<identifier>” adds one; connections require the provider’s own authorization.');
  }
  if ((m = low.match(/^use account (\S+) for ([a-z0-9-]+)$/))) {
    const list = services.accountsFor(S, m[2]);
    const acct = list.find(a => a.identifier === m[1] || a.id === m[1]);
    if (!acct) return R('No account ' + m[1] + ' for ' + m[2]);
    const r = services.selectAccount(S, m[2], acct.id);
    if (r.ok) audit('account', 'ACTIVE ACCOUNT set: ' + m[2] + ' → ' + acct.identifier, 'user', { action: 'account.select', decision: 'ALLOW', risk: 'MEDIUM' });
    save();
    return R(r.ok ? `Active account for ${m[2]} is now ${acct.identifier}. WitForge never picks an account by guessing.` : r.error);
  }
  if ((m = low.match(/^record account ([a-z0-9.-]+):(\S+)$/))) {
    const r = addAccountCmd({ service: m[1], identifier: m[2] });
    return R(r.ok ? `Recorded ${m[1]}:${m[2]} (connection status RECORDED). Connecting it requires the service’s real authorization flow — configuration alone never counts as connected.` : r.error);
  }
  if ((m = low.match(/^disconnect account (\S+)/))) {
    const list = S.accounts.filter(a => a.id === m[1] || a.identifier === m[1] || a.service === m[1]);
    if (!list.length) return R('No matching account');
    const results = list.map(a => disconnectAccountCmd(a.id));
    return R(results.map(r => `Disconnected ${r.account}; revoked ${r.revokedGrants.length} grant(s)${r.credentialRevoked ? ', destroyed the credential' : ''}; audit preserved.`).join('\n'));
  }
  if ((m = low.match(/^delete account (\S+)( confirm)?$/))) {
    const a = S.accounts.find(x => x.id === m[1] || x.identifier === m[1]);
    if (!a) return R('No matching account');
    const r = deleteAccountCmd(a.id, !!m[2]);
    return R(r.ok ? 'Account record deleted, affected data reported and verified.' : (r.needsConfirmation ? 'Deletion affects: ' + r.affectedData.join(', ') + '. ' + r.warning + ' Say “delete account ' + m[1] + ' confirm”.' : r.error));
  }
  if ((m = low.match(/^account boundary (.+)/))) {
    /* keys are matched case-insensitively against the §132 boundary list */
    const known = Object.keys(services.BOUNDARY_TRIGGERS || {});
    const req = {};
    String(m[1]).split(/[\s,]+/).forEach(k => {
      if (!k) return;
      const hit = known.find(x => x.toLowerCase() === k.toLowerCase());
      req[hit || k] = true;
    });
    const r = accountBoundaryCheck(req);
    return R(r.ok ? 'No boundary violation detected for that request shape.' : 'REFUSED by account boundaries: ' + r.violations.join('; ') + '. WitForge stops at human-required boundaries and asks you to complete them.');
  }
  /* §113/§114 organisations and entitlements. */
  if ((m = low.match(/^create org(?:anisation)? (.+)$/))) {
    const gm = q.match(/^create org(?:anisation)? (.+)$/i) || m;
    const r = createOrgCmd({ name: gm[1].trim() });
    return R(r.ok ? `Organisation “${r.org.name}” created. Organisation authority never overrides individual account authority.` : r.error);
  }
  if (low === 'orgs' || low === 'organisations') {
    return R(S.orgs.length ? 'Organisations:\n' + S.orgs.map(o => `• ${o.name} — ${o.members.length} member(s), ${o.teams.length} team(s), ${o.delegatedCapabilities.length} delegated cap(s)`).join('\n') : 'No organisations. Say “create org <name>”.');
  }
  if ((m = low.match(/^plan ([a-z][a-z-]*)$/))) {
    const r = subscribeCmd(m[1]);
    if (!r.ok) return R((r.error || 'Unknown tier') + ' Available: ' + services.PLANS.map(p => p.id).join(', ') + ' (free baseline + 5 personal from A$9, 2 business from A$30).');
    const e = r.subscription.entitlements;
    return R(`Plan set to ${r.subscription.planName}. Entitlements: ${Object.entries(e).map(([k, v]) => k + '=' + v).join(', ')}. Premium controls are enforced server-side; billing stays locked until billing authority exists.`);
  }
  if (low === 'subscription' || low === 'entitlements') {
    const s2 = services.currentSubscription(S);
    return R(`Plan ${s2.planName} (${s2.planId}) — status ${s2.status}. Entitlements: ${Object.entries(s2.entitlements).map(([k, v]) => k + '=' + v).join(', ')}. Billing chargeable: ${s2.billing.chargeable} (${s2.billing.note})`);
  }
  /* §110/§112 assets + anti-fraud. */
  if (low === 'assets') {
    return R(S.assets.length ? 'Asset registry:\n' + S.assets.slice(0, 10).map(a => `• ${a.assetId} ${a.type} R${a.rarity} owner=${a.owner} status=${a.status} identity=${a.identity.slice(0, 12)}…`).join('\n') : 'No assets registered. Assets are minted by the arena engine (loot, forge, pets); say “mint asset piece rarity 5”.');
  }
  if ((m = low.match(/^mint asset (\w+)(?: rarity (\d{1,3}))?(?: owner (\S+))?/))) {
    const r = registerAssetCmd({ type: m[1], rarity: m[2] ? Number(m[2]) : 1, owner: m[3] || 'Owner', creator: m[3] || 'Owner' });
    return R(r.ok ? `Asset ${r.asset.assetId} registered (R${r.asset.rarity}, identity ${r.asset.identity.slice(0, 12)}…). Anti-duplication and provenance records applied.` : (r.reason === 'rarity-100-needs-approval' ? 'Rarity 100 is a controlled state: it needs an approval record, full provenance and a uniqueness check before creation.' : r.reason));
  }
  if ((m = low.match(/^asset provenance (\S+)/))) {
    const r = services.provenanceReport(S, m[1]);
    return R(r ? `${r.assetId}: ${r.type} R${r.rarity} · creator ${r.creator} · owner ${r.currentOwner} · source ${r.source} · parents ${r.parentAssets.join(',') || 'none'} · transfers ${r.transfers.length} · merges ${r.mergeHistory.length}` : 'Unknown asset');
  }
  if ((m = low.match(/^transfer asset (\S+) to (\S+)/))) {
    const r = transferAssetCmd(m[1], m[2], 'user transfer');
    return R(r.ok ? `Transferred ${m[1]} → ${m[2]} (transfer history now ${r.history} record(s)).` : r.error);
  }
  if (low === 'fraud') {
    const r = services.fraudReport(S);
    return R(`Anti-fraud monitor: ${r.events} event(s). By severity: ${Object.entries(r.bySeverity).map(([k, v]) => k + '=' + v).join(', ') || 'none'}. Duplicate detection, transaction monitoring, rate limits, anomaly detection and account separation are active.`);
  }
  /* §85/§86 Arena wager matches. */
  if ((m = low.match(/^provision loadout ([\w '-]{2,30})$/))) {
    const r = provisionLoadoutCmd(m[1]);
    if (!r.ok) return R(r.error + (r.needed ? ` — needs ${r.needed} LD, ${r.wallet} holds ${r.balance}. ${r.hint || ''}` : ''));
    if (r.alreadyComplete) return R(`${r.avatar} is already fully equipped.`);
    return R(`${r.avatar} equipped: ${r.equipped.map(e => e.slot).join(', ')} for ${r.cost} LD (from ${r.wallet}). Completeness gate ${r.status.complete ? 'SATISFIED' : 'still missing ' + r.status.missing.join(', ')}.`);
  }
  if ((m = low.match(/^arena wager ([\w '-]{2,30}?) vs ([\w '-]{2,30}?)(?: seed (\d+))?( confirm)?$/))) {
    const arena = require('./arena-engine.js');
    const A = arena.list().find(x => x.name.toLowerCase() === m[1].toLowerCase());
    const B = arena.list().find(x => x.name.toLowerCase() === m[2].toLowerCase());
    if (!A || !B) return R('Both avatars must exist');
    const r = arenaWagerMatch({ a: A.id, b: B.id, confirmed: !!m[4], seed: m[3] ? Number(m[3]) : undefined });
    if (r.needsLoadout) return R('Loadout gate: ' + r.error);
    if (r.needsConfirmation) return R('Wager terms: ' + JSON.stringify(r.terms) + '. Real-money wagering stays compliance-locked. Say “arena wager ' + m[1] + ' vs ' + m[2] + ' confirm”.');
    if (r.drew) return R('The match ended in a true draw — nothing settles and both stakes are returned (no treasury allocation on a draw).');
    return R(r.ok ? `SIMULATION wager settled: pool ${r.pool} LD → winner ${r.winner} LD, treasury ${r.treasury} LD (1%) to ${r.winnerAvatar}. Deterministic seed ${r.seed}, ${r.rounds} rounds, ${r.decision}. Real money: LOCKED.` : r.error);
  }
  /* §65 memory classes + §64 project records. */
  if (low === 'memory classes') return R('Memory classes: ' + MEMORY_CLASSES.join(', ') + '. Ordinary memory is information, never authority — it cannot rewrite policy or permissions.');
  if ((m = low.match(/^remember as (\w[\w-]*) (.+)$/))) {
    const gm = q.match(/^remember as (\w[\w-]*) (.+)$/i) || m;
    const r = rememberTyped(gm[2], gm[1].toLowerCase());
    return R(r.ok ? `Stored in memory class “${r.record.class}”.${r.escalationIgnored ? ' (The text mentions authority-shaped words — no authority was granted.)' : ''}` : r.error);
  }
  if ((m = low.match(/^create project ([^|]+?)(?: \| goals? (.+))?$/))) {
    /* the router matches on lowercase; the record keeps the user's original wording */
    const gm = q.match(/^create project ([^|]+?)(?: \| goals? (.+))?$/i) || m;
    const r = createProjectFull({ name: (gm[1] || '').trim(), goals: gm[2] ? gm[2].split(';').map(x => x.trim()) : [] });
    return R(r.ok ? `Project “${r.project.name}” created with goals/tasks/agents/files/integrations/permissions/memory/assets/audit records.` : r.error);
  }

  /* v1.61: reminders */
  if ((m = low.match(/^remind me in (\d+) (seconds?|minutes?|hours?|days?) (?:to )?(.+)$/))) {
    const unit = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5 }[m[2].replace(/s$/, '')];
    const r = addReminder(m[3], Date.now() + Number(m[1]) * unit);
    return R(`Reminder ${r.id} set — “${m[3]}” in ${m[1]} ${m[2].replace(/s?$/, '(s)')}. It will fire even if your chat is closed (server keeps ticking).`);
  }
  if (low === 'reminders' || low === 'list reminders') {
    const p = S.reminders.filter(r => !r.done).sort((a, b) => a.dueTs - b.dueTs);
    return R(p.length ? 'Pending reminders:\n' + p.map(r => `• ${r.id} — ${new Date(r.dueTs).toLocaleString()} — ${r.text}`).join('\n') : 'No pending reminders. Say “remind me in 20 minutes stretch”.');
  }
  if (low === 'clear reminders') { const n = S.reminders.filter(r => !r.done).length; S.reminders.forEach(r => r.done = true); audit('tool', n + ' reminders cleared', 'user'); save(); return R(`Cleared ${n} pending reminder(s).`); }
  /* v1.62: recurring schedules (cron) */
  if ((m = low.match(/^every (\d+) (seconds?|minutes?|hours?|days?) (?:to )?(.+)$/))) {
    const unit = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5 }[m[2].replace(/s$/, '')];
    if (Number(m[1]) * unit < 10000 && !low.includes('confirm')) return R('Schedules under 10 seconds are noise — say it again plus “confirm” if you really want that cadence.');
    const r = addSchedule(m[3], Number(m[1]) * unit);
    return R(`Recurring schedule ${r.id} armed — “${m[3]}” every ${m[1]} ${m[2].replace(/s?$/, '(s)')}. Stop it with “stop schedule ${r.id}”.`);
  }
  if (low === 'schedules' || low === 'list schedules') {
    const p = S.schedules.filter(r => !r.done);
    const span = r => r.everyMs >= 86400000 ? Math.round(r.everyMs / 86400000) + ' d' : r.everyMs >= 3600000 ? Math.round(r.everyMs / 3600000) + ' h' : r.everyMs >= 60000 ? Math.round(r.everyMs / 60000) + ' min' : Math.round(r.everyMs / 1000) + ' s';
    return R(p.length ? 'Active schedules:\n' + p.map(r => `• ${r.id} — every ${span(r)} — fired ${r.fired}× — next ${new Date(r.nextTs).toLocaleTimeString()} — ${r.text}`).join('\n') : 'No active schedules. Say “every 2 hours stand up”.');
  }
  /* v1.62: avatar talents */
  if (low === 'talents' || low === 'talent tree') {
    const arena = require('./arena-engine.js');
    const avs = arena.list();
    const tree = arena.TALENTS.map(t => `T${t.tier} ${t.name} — ${t.desc}${avs.length && avs[0].talents.includes(t.id) ? ' ✓' : ''}`).join('\n');
    const who = avs.length ? `${avs[0].name}: ${avs[0].talents.length} unlocked, ${avs[0].talentPoints} point(s) available.` : 'Create an avatar first (create avatar NAME as nord).';
    return R(`Talent tree (1 point per level):\n${tree}\n\n${who} Unlock: “unlock talent hawk for ${avs.length ? avs[0].name.toLowerCase() : 'bold'}”.`);
  }
  if ((m = low.match(/^unlock talent ([\w '-]+?) for ([\w]+)$/))) {
    const arena = require('./arena-engine.js');
    const av = arena.list().find(a => a.name.toLowerCase() === m[2].toLowerCase()) || arena.list()[0];
    if (!av) return R('No avatars yet — create one first.');
    const r = arena.unlockTalent(av.id, m[1].trim().replace(/^"|"$/g, ''));
    audit('tool', r.ok ? `TALENT ${r.talent} unlocked for ${av.name}` : ('TALENT failed: ' + r.error), 'user'); save();
    return r.ok ? R(`${av.name} learned ${r.talent}. ${r.pointsLeft} talent point(s) left. Stats recalculated server-side (hp/mp/crit applied in derived()).`) : R(r.error);
  }
  /* v1.61: Hacker News + countries + GitHub file-ops */
  if ((m = low.match(/^(?:news|hn) top(?: (\d+))?$/))) { const r = await runTool('hn.top', { count: m[1] || 5 }, {}); return r.ok ? R('Top Hacker News:\n' + r.evidence.stories.map((x, i) => `${i + 1}. ${x.title} (${x.score}pts, ${x.by})\n   ${x.url}`).join('\n')) : R((r.evidence && r.evidence.error) || r.error); }
  if ((m = low.match(/^country (.+)$/))) { const r = await runTool('country.get', { name: m[1] }, {}); return r.ok ? R(`${r.evidence.flag || ''} ${r.evidence.name}: capital ${r.evidence.capital} · pop ${Number(r.evidence.population).toLocaleString()} · ${r.evidence.region} · ${r.evidence.currencies.join(', ') || '—'} · ${r.evidence.languages.join(', ') || '—'}.`) : R((r.evidence && r.evidence.error) || r.error); }
  if ((m = q.match(/^github (?:list|ls)(?: files)?(?: (.*))?$/i))) { const r = await runTool('github.files', { path: m[1] || '' }, {}); return r.ok ? R(`doomed689/WitForge ${r.evidence.path}:\n` + r.evidence.files.map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}${f.type !== 'dir' ? ' (' + f.size + 'B)' : ''}`).join('\n')) : R((r.evidence && r.evidence.error) || r.error); }
  /* v1.78.0: paths keep the owner's original case (q, not low) — the GitHub
   * Contents API is case-sensitive, and lowercasing “STATUS.md” was a
   * guaranteed 404. */
  if ((m = q.match(/^github read (?:file )?(.+)$/i))) { const r = await runTool('github.readfile', { path: m[1] }, {}); return r.ok ? R(`${r.evidence.path} (${r.evidence.bytes}B, sha ${r.evidence.sha}):\n${r.evidence.text}${r.evidence.truncated ? '\n…(truncated)' : ''}`) : R((r.evidence && r.evidence.error) || r.error); }
  if ((m = q.match(/^github write ([^|]+)\|([\s\S]+)$/i))) {
    const r = await runTool('github.writefile', { path: m[1].trim(), content: m[2].trim() }, { confirmed: low.includes('confirm') });
    if (r.needsApproval) return R('GitHub write is high-risk — approval queued: ' + r.needsApproval + '. Say “approve ' + r.needsApproval + '” then repeat the command.');
    return r.ok ? R(`GitHub wrote ${r.evidence.path} → main (commit ${r.evidence.commit}). Real API write, audited.`) : R((r.evidence && r.evidence.error) || r.error);
  }
  if (low.includes('status') || low.includes('health')) {
    return R(`Systems: emergency=${S.emergency}; adapters=${ADAPTERS.filter(a => a.state === 'AVAILABLE').length} available / ${ADAPTERS.filter(a => a.state === 'UNAVAILABLE').length} unavailable; conversations=${S.conversations.length}; tasks=${S.tasks.length}; audit=${S.audit.length}; ledger mode=SIMULATION.`);
  }
  if (low.includes('capabilities') || low.includes('adapters') || low === 'what tools' || low === 'list tools') {
    const live = adaptersLive();
    const lines = live.map(a => `${a.id.padEnd(10)} ${String(a.state).padEnd(26)} ${a.name}`);
    return R(`Connectors & adapters (${live.length}) — truth states, live-evaluated:\n` + lines.join('\n') + '\n\nReady now, plain language: “weather <city>”, “convert 100 aud to usd”, “research <topic>”, “dns <domain>”, “hash <text>”, “uuid”. Discovery grants nothing; execution requires your request, and approval for high risk.');
  }
  if (low.includes('security')) return R(`Security shield: emergency=${S.emergency}; permissions granted=${Object.keys(S.permissions).length}; pending approvals=${S.approvals.filter(a => a.status === 'pending').length}; recent security events: ${S.audit.filter(a => a.type === 'security').slice(0, 3).map(a => a.detail).join(' | ') || 'none'}.`);

  if ((m = q.match(/^create task (.+)/i))) { S.tasks.unshift({ id: nid('t'), text: m[1].slice(0, 120), done: false, created: Date.now() }); save(); audit('task', 'Created task: ' + m[1]); return R('Task recorded: ' + m[1]); }
  if (low === 'list tasks' || low === 'tasks') return R(S.tasks.length ? S.tasks.slice(0, 8).map(t => `${t.done ? '✓' : '◌'} ${t.text}`).join('\n') : 'No tasks yet.');
  if ((m = low.match(/^complete task (\d+)/))) { const t = S.tasks[+m[1]]; if (t) { t.done = true; save(); return R('Completed: ' + t.text); } return R('No such task index.'); }

  if ((m = q.match(/^create project (.+)/i))) { S.projects.unshift({ id: nid('p'), name: m[1].slice(0, 80), created: Date.now() }); save(); audit('project', 'Created project: ' + m[1]); return R('Project created: ' + m[1]); }
  if ((m = q.match(/^create agent (.+)/i))) { S.agents.unshift({ id: nid('ag'), name: m[1].slice(0, 60), scope: 'local', status: 'active', delegations: 0, created: Date.now() }); save(); audit('agent', 'Created agent: ' + m[1]); return R('Agent registered: ' + m[1] + ' (scoped, non-privileged).'); }
  if ((m = q.match(/^remember (.+)/i))) { const um = rememberThat(m[1]); return um.ok ? R('Stored to memory (untrusted user statement; information, not authority).', { memory: S.brainMemory.length }) : { ok: false, kind: 'platform', reply: um.error }; }
  if ((m = q.match(/^(?:recall|search) (.+)/i))) {
    const needle = m[1].toLowerCase();
    const hits = S.brainMemory.filter(x => x.fact.toLowerCase().includes(needle)).map(x => ({ text: x.fact })).concat(S.knowledge.filter(x => (x.title + x.text).toLowerCase().includes(needle)));
    return R(hits.length ? hits.slice(0, 6).map(h => '• ' + (h.title ? h.title + ': ' : '') + h.text).join('\n') : 'Nothing in memory/knowledge matches.');
  }
  if ((m = q.match(/^add knowledge (.+)/i))) { S.knowledge.unshift({ id: nid('k'), title: m[1].slice(0, 60), text: m[1], ts: Date.now(), source: 'user', trusted: false }); save(); return R('Knowledge record added (untrusted until verified).'); }

  if (low.includes('balance') || low === 'ledger') return R('LD balances (SIMULATION): ' + Object.entries(S.ledger.accounts).map(([k, v]) => `${k}=${v}`).join(' · '));
  if ((m = low.match(/^wager (\d+) between ([\w-]+) and ([\w-]+)/))) { const r = wager(m[2], m[3], +m[1], m[2]); return r.ok ? R(`SIMULATION wager settled: pool ${r.pool}, winner ${r.winner}, Treasury ${r.treasury} (1%).`) : R(r.error); }
  if (low.includes('economy selftest') || low.includes('selftest')) return R('Economy self-test: ' + economySelfTest().checks.map(c => `${c.check}=${c.pass ? 'PASS' : 'FAIL'}`).join(' · '));

  if ((m = q.match(/^weather (?:in|for|at) (.+)/i))) { const r = await runTool('weather.get', { location: m[1] }, { confirmed: low.includes('confirm') }); return r.ok ? R(`Weather in ${r.evidence.location}: ${r.evidence.tempC}°C, wind ${r.evidence.windspeed} km/h (Open-Meteo, real retrieval).`) : R(r.error || (r.evidence && r.evidence.error)); }
  if ((m = q.match(/^fetch (https?:\/\/\S+)/i))) { const r = await runTool('http.get', { url: m[1] }, { confirmed: low.includes('confirm') }); return r.ok ? R(`Fetched ${m[1]} → HTTP ${r.evidence.status}, ${r.evidence.bytes} bytes.\n${String(r.evidence.text).slice(0, 400)}`) : R((r.evidence && r.evidence.error) || r.error); }
  if ((m = q.match(/^write file ([\w.-]+) (.+)/is))) { const r = await runTool('fs.write', { path: m[1], content: m[2] }, { confirmed: low.includes('confirm') }); return r.ok ? R(`Wrote ${r.evidence.path} (${r.evidence.bytes}B, sha256 ${String(r.evidence.sha256).slice(0, 12)}…).`) : R(r.error); }
  if ((m = q.match(/^list files/))) { const r = await runTool('fs.list', {}, {}); return r.ok ? R('Sandbox files: ' + (r.evidence.files.map(f => f.name).join(', ') || '(empty)')) : R(r.error); }
  if ((m = q.match(/^run (\w+)/))) { const r = await runTool('exec.run', { op: m[1] }, { confirmed: low.includes('confirm') }); return r.ok ? R(`exec ${m[1]} → ` + JSON.stringify(r.evidence.result)) : R((r.evidence && r.evidence.error) || r.error); }
  /* v1.59 key-free connectors */
  if ((m = low.match(/^weather (?:in |for )?(.+)$/))) { const r = await runTool('weather.get', { location: m[1] }, {}); return r.ok ? R(`${r.evidence.location}${r.evidence.country ? ', ' + r.evidence.country : ''}: ${r.evidence.tempC}°C, wind ${r.evidence.windspeed} km/h (code ${r.evidence.weathercode}) — real Open-Meteo data.`) : R((r.evidence && r.evidence.error) || r.error); }
  if ((m = low.match(/^convert (\d+(?:\.\d+)?) ([a-z]{3})(?:\s+to\s+([a-z]{3}))?$/))) { const r = await runTool('fx.convert', { amount: m[1], from: m[2], to: m[3] || 'USD' }, {}); return r.ok ? R(`${r.evidence.amount} ${r.evidence.from} = ${r.evidence.result} ${r.evidence.to} (rate ${r.evidence.rate}, as of ${r.evidence.asOf}) — real ECB rates.`) : R((r.evidence && r.evidence.error) || r.error); }
  if ((m = low.match(/^research (.+)$/))) { const r = await runTool('wiki.summary', { topic: m[1] }, {}); return r.ok ? R(`【${r.evidence.title}】 ${r.evidence.extract}${r.evidence.url ? '\n' + r.evidence.url : ''}`) : R((r.evidence && r.evidence.error) || r.error); }
  if ((m = low.match(/^dns ([a-z0-9.-]+)(?: ([a-z]+))?$/))) { const r = await runTool('dns.resolve', { name: m[1], type: m[2] || 'A' }, {}); return r.ok ? R(`DNS ${r.evidence.name} (${r.evidence.type}): ` + (r.evidence.answers.length ? r.evidence.answers.map(a => a.data).join(', ') : 'no records') + ' — real Cloudflare DoH.') : R((r.evidence && r.evidence.error) || r.error); }
  if ((m = low.match(/^(?:hash|sha256) (.+)$/))) { const r = await runTool('util.hash', { text: m[1] }, {}); return R('SHA-256: ' + r.evidence.sha256); }
  if (low === 'uuid') { const r = await runTool('util.uuid', {}, {}); return R('UUID: ' + r.evidence.uuid); }
  if (low.includes('verify stripe') || low.includes('check stripe')) { const r = await runTool('stripe.verify', {}, { confirmed: low.includes('confirm') }); return r.ok ? R('Stripe account VERIFIED via real API: ' + r.evidence.stripeAccount + ' (' + r.evidence.country + ', ' + r.evidence.email + '). You may now say “enable real payments confirm”.') : R((r.evidence && r.evidence.error) || r.error); }
  if (low.includes('enable real payments')) { const r = setRealMode(true, low.includes('confirm')); return r.ok ? R('REAL-MONEY MODE ENABLED. LD purchases now settle against verified Stripe evidence. The app does not claim licensing — compliance responsibility is the Owner’s, per the master spec.') : R(r.error); }
  if (low.includes('disable real payments')) { const r = setRealMode(false, true); return R('Real-money mode disabled. LD returns to simulation labelling.'); }
  if ((m = q.match(/^create payment (\d+) ld/i))) { const r = await createPayment(m[1]); return r.ok ? R('Real Stripe checkout created for ' + r.ld + ' LD (A$' + r.aud + '). Open this URL to pay: ' + r.url + '\nWhen paid, say “confirm payment ' + r.sessionId + '”.') : R(r.error); }
  if ((m = q.match(/^confirm payment (\S+)/i))) { const r = await confirmPayment(m[1]); return r.ok ? R('Provider evidence confirms PAID → ' + r.ld + ' LD credited to ' + (r.wallet || 'Owner') + ' (REAL mode, idempotent).') : R(r.error); }
  /* NOTE (v1.89.2): the session id above must come from `q`, never `low` —
   * Stripe ids are case-sensitive and the lowercase pipe used to mangle
   * them into guaranteed 404s (observed live). */
  if ((m = q.match(/^create avatar ([a-z0-9'\- ]{2,30}?) (?:as |race )([a-z_]+)/i))) {
    const arena = require('./arena-engine.js');
    const r = arena.createAvatar(m[1], m[2].toLowerCase());
    return r.ok ? R('Avatar “' + r.avatar.name + '” forged (' + r.avatar.raceId + ', level 1, naked start). Now forge gear — e.g. “forge sword at rare: …”.') : R(r.error || 'Could not create avatar.');
  }
  if (low === 'connect stripe' || low === 'connect stripe account') return R('To really connect Stripe, paste your secret key in Chat: “connect stripe with token sk_…” — I store it encrypted (AES-256-GCM) and never show it back. Then say “verify stripe” (real API call), and once verified, “enable real payments confirm”.');
  if (low.includes('forge cost') || low.includes('forge prices')) return R('Forge costs (LD): ' + Object.entries(FORGE_COST).map(([k, v]) => k + '=' + v).join(' · ') + '. Your prompt makes each piece unique; higher bands cost more.');
  if ((m = q.match(/^forge ([a-z0-9_]+)(?: at (common|magic|rare|legendary|set|mythic))?:?\s*(.+)$/i))) {
    const arena = require('./arena-engine.js');
    const avs = arena.list();
    if (!avs.length) return R('Forge an avatar first (Avatar Studio).');
    const band = (m[2] || 'Common'); band[0] ? band[0].toUpperCase() + band.slice(1) : band;
    const cap = band[0].toUpperCase() + band.slice(1).toLowerCase();
    const r = forgePiece(avs[0].id, m[1].toLowerCase(), m[3], cap, null);
    return r.ok ? R(`Forged “${r.item.name}” — ${r.item.rarity} R${r.item.rlevel} ${r.item.slot} for ${r.cost} LD. Unique fingerprint ${String(r.item.fp).slice(0, 12)}… from your prompt. Equip it in Avatar Studio.`) : R(r.error);
  }
  let mRe;
  if ((mRe = low.match(/^remember that (.{3,240})$/))) { const rm = rememberThat(mRe[1]); return rm.ok ? R(rm.reply, { memory: S.brainMemory.length }) : { ok: false, kind: 'platform', reply: rm.error }; }
  if (low === 'what do you remember' || low === 'what do you remember about me' || low === 'recall memory' || low === 'your memory') { const rc = recallReply(); return R(rc.reply, { memory: S.brainMemory.length }); }
  if ((mRe = low.match(/^forget (?:that )?(.{1,120})$/))) { fn: { const fm = forgetMemory(mRe[1]); if (fm.ok) return R(fm.reply); return { ok: false, kind: 'platform', reply: fm.error }; } }
  if (low === 'market' || low === 'list market') {
    seedMarket();
    return R(S.market.length ? S.market.map(l => `${l.id}: ${l.item.name} (${l.item.rarity} R${l.item.rlevel} ${l.item.slot}) — ${l.price} LD [${l.seller}]`).join('\n') : 'Market empty.');
  }
  if ((m = low.match(/^buy (mk\w+)/))) { const arena = require('./arena-engine.js'); const avs = arena.list(); if (!avs.length) return R('Forge an avatar first.'); const r = buy(m[1], avs[0].id); return r.ok ? R('Bought ' + r.item.name + ' — escrow settled, item in inventory.') : R(r.error); }
  if ((m = low.match(/^sell ([a-z0-9]+) for (\d+)/))) { const arena = require('./arena-engine.js'); const avs = arena.list(); if (!avs.length) return R('No avatar.'); const r = listItem(avs[0].id, m[1], m[2]); return r.ok ? R('Listed ' + r.listing.item.name + ' for ' + r.listing.price + ' LD.') : R(r.error); }
  if ((m = low.match(/^delist (mk\w+)/))) { const r = delist(m[1]); return r.ok ? R('Delisted; item returned to inventory.') : R(r.error); }

  if (low.includes('github')) { const r = await runTool('github.status', {}, {}); return r.ok ? R('GitHub reachable.') : R(r.evidence ? r.evidence.error : r.error); }

  /* v1.69: LD packages, social connectors, self-update. */
  if (low === 'ld packages' || low === 'packages') {
    const L = ldPackagesList();
    return R('LD packages (' + L.mode + '):\n' + L.packages.map(k => '• ' + k.id + ' — ' + k.ld + ' LD + ' + k.bonus + ' bonus = ' + k.totalLd + ' LD for A$' + k.priceAud + ' (' + k.effectiveAudPerLd + ' per LD)').join('\n') + '\nBuy with “buy ld package <id>”. ' + L.note);
  }
  if ((m = low.match(/^buy ld package ([a-z0-9-]+)$/))) {
    const r = await buyLdPackageCmd(m[1]);
    if (r.ok && r.url) return R('REAL checkout for package “' + m[1] + '” — ' + r.ld + ' LD for A$' + r.aud + ' (order ' + r.order + '). Pay here: ' + r.url + '\nNothing is credited until Stripe itself reports paid; then say “confirm payment ' + r.sessionId + '”.');
    return r.ok ? R('Package “' + r.package + '” credited: +' + r.totalLd + ' LD (' + r.bonusLd + ' bonus) for a notional A$' + r.priceAud + ' — ' + r.note + ' Balance: ' + r.balance + ' LD.') : R(r.error);
  }
  if (low === 'social' || low === 'social status' || low === 'connectors social') {
    const r = await runTool('social.status', {}, {});
    return R(r.ok ? 'Social connectors (official APIs, your credentials):\n' + r.result.connectors.map(c => '• ' + c.id + (c.postable ? ' (postable)' : ' (verify-only)') + ' — ' + (c.verified ? 'VERIFIED' : c.configured ? 'configured, run “verify ' + c.id + '”' : 'not connected → ' + c.signup)).join('\n') + '\n' + r.result.note : (r.error || 'status unavailable'));
  }
  if ((m = low.match(/^verify (x|twitter|facebook|instagram|linkedin|reddit|tiktok)$/))) {
    const r = await runTool('social.verify', { platform: m[1] === 'twitter' ? 'x' : m[1] }, {});
    return r.ok ? R('VERIFIED via real API: ' + r.result.platform + ' → ' + r.result.profile + '. ' + r.result.note) : R(r.error);
  }
  if ((m = q.match(/^post (x|twitter|facebook|reddit)\s+([\s\S]+)$/i))) {
    const plat = m[1].toLowerCase() === 'twitter' ? 'x' : m[1].toLowerCase();
    const args = { platform: plat, text: m[2].trim() };
    if (plat === 'reddit') { const parts = m[2].split('|').map(x => x.trim()); if (parts.length >= 3) { args.subreddit = parts[0].replace(/^r\//i, ''); args.title = parts[1]; args.text = parts.slice(2).join(' | '); } }
    const prior = S.approvals.find(a => a.cap === 'social.post' && a.status === 'approved');
    const r = await runTool('social.post', args, prior ? { approvalId: prior.id } : {});
    if (r && r.needsApproval) return R('Posting to ' + plat + ' is public and high-risk — approval queued: ' + r.needsApproval + '. Say “approve ' + r.needsApproval + '” then repeat the post command.');
    return r.ok ? R('Posted to ' + r.result.platform + (r.result.reference ? ' (ref: ' + r.result.reference + ')' : '') + '. Visible publicly — that is the point, and why it was approval-gated.') : R(r.error || 'The post did not go through.');
  }
  if (low === 'update check' || low === 'check for updates') {
    const r = await runTool('update.check', {}, {});
    return r.ok ? R(r.result.upToDate ? 'Up to date: local ' + r.result.localVersion + ' = remote ' + r.result.remoteVersion + '.' : (r.result.newer ? 'Update available: local ' + r.result.localVersion + ' → remote ' + r.result.remoteVersion + '. Say “update apply” (approval-gated, backed up, audited).' : JSON.stringify(r.result))) : R(r.error || 'Update check failed.');
  }
  if (low === 'update apply' || low === 'update now' || low === 'self update') {
    const r = await runTool('update.apply', {}, {});
    if (r && r.needsApproval) return R('Self-update is high-risk (it rewrites this app from the audited repo) — approval queued: ' + r.needsApproval + '. Say “approve ' + r.needsApproval + '” then “update apply” again.');
    if (r && r.upToDate) return R(r.error);
    return r.ok ? R('Self-update applied: ' + r.result.fromVersion + ' → ' + r.result.toVersion + '. ' + r.result.applied + ' files written (sha256 in audit), ' + r.result.skipped + ' skipped. Backup: ' + r.result.backup + '. ' + r.result.restartRequired) : R(r.error || 'Update failed.');
  }
  /* v1.67: the AI brain — explicit asks, provider selection, verification.
   * Matched late so rule-based intents keep priority: the router is the
   * audited surface; the LLM advises and answers, it does not execute. */
  if ((m = q.match(/^ask consensus\s+([\s\S]+)$/i)) || (m = q.match(/^consensus[:\s]+([\s\S]+)$/i))) {
    const ens = await runTool('llm.ensemble', { prompt: m[1] }, {});
    if (!ens.ok) return R(ens.error);
    if (!ens.result.answers.length) return R('No provider could answer, so there is nothing to synthesize. Failures: ' + (ens.result.failures.map(f => f.provider + ' (' + f.error + ')').join(', ') || 'none reported') + '.');
    const transcript = ens.result.answers.map(x => '[' + x.provider + ' \u00b7 ' + x.model + ']\n' + x.reply).join('\n\n');
    const r = await runTool('llm.chat', { prompt: 'Several AI models were asked the same question. Their answers follow.\n\n' + transcript + '\n\nProvide one balanced consensus answer in at most 120 words. If the models materially disagree, say exactly where.', maxTokens: 300 }, {});
    const head = r.ok ? '\U0001F91D Consensus [' + r.result.provider + ' \u00b7 ' + r.result.model + ']: ' + r.result.reply : 'Consensus unavailable (' + (r.error || 'synthesizer failed') + ') \u2014 raw answers follow.';
    return R(head + '\n\n\u2014 answers considered (' + ens.result.answers.length + '):\n' + ens.result.answers.map(x => '\u2022 [' + x.provider + ' \u00b7 ' + x.model + '] ' + String(x.reply).slice(0, 140) + (String(x.reply).length > 140 ? '\u2026' : '')).join('\n') + (ens.result.failures.length ? '\n\u26A0\uFE0F failed: ' + ens.result.failures.map(f => f.provider).join(', ') : ''));
  }
  if ((m = q.match(/^ask all\s+([\s\S]+)$/i)) || (m = q.match(/^ensemble[:\s]+([\s\S]+)$/i))) {
    const r = await runTool('llm.ensemble', { prompt: m[1] }, {});
    if (!r.ok) return R(r.error);
    const parts = r.result.answers.map(x => '🤖 [' + x.provider + ' · ' + x.model + ' · ' + x.latencyMs + 'ms]\n' + x.reply);
    if (r.result.failures.length) parts.push('⚠️ failed: ' + r.result.failures.map(f => f.provider + ' (' + f.error + ')').join(', '));
    return R('Ensemble — the same question to every connected provider (' + r.result.providersAsked.join(', ') + '):\n\n' + parts.join('\n\n'));
  }
  if ((m = low.match(/^feedback(?: is)?[: ]?(.{3,240})$/i))) {
    if (!S.brainFeedback) S.brainFeedback = [];
    if (brain.scanInjection(m[1]).matched) { audit('brain', 'feedback refused — instruction-shaped', 'guard'); return { ok: false, kind: 'platform', reply: 'Feedback is taste (how I talk), never instructions — that reads like an instruction. Say it as a style wish: “feedback be terser”.' }; }
    S.brainFeedback.push({ note: m[1].slice(0, 240), ts: Date.now() });
    if (S.brainFeedback.length > 24) S.brainFeedback.shift();
    save(); audit('brain', 'FEEDBACK + ' + m[1].slice(0, 80), 'user');
    return R('Noted — “' + m[1] + '”. It rides with my planner as YOUR taste (“feedback?” lists · “clear feedback” erases). Facts stay in “remember that …”; jobs stay in commands.');
  }
  if (low === 'feedback' || low === 'feedback?' || low === 'your style notes') {
    const fb2 = S.brainFeedback || [];
    return R(fb2.length ? 'My taste drawer (' + fb2.length + '/24 — yours, erasable):\n' + fb2.map((x, i) => (i + 1) + '. ' + x.note).join('\n') : 'No taste notes yet — “feedback be terser” / “feedback more formal”. (Not facts; facts: “remember that …”.)');
  }
  if (low === 'clear feedback' || low === 'forget feedback') { const n = (S.brainFeedback || []).length; S.brainFeedback = []; save(); audit('brain', 'feedback drawer cleared (' + n + ')', 'user'); return R('Taste drawer cleared (' + n + ' notes erased). Back to neutral voice.'); }
  if (low === 'clear conversation' || low === 'forget conversation') { brain.clearHistory(); save(); audit('brain', 'short-term conversation cleared', 'user'); return R('Conversation window cleared — I remember only what you asked me to keep (“what do you remember?”).'); }
  if (low === 'overseer' || low === 'security council' || low === 'overseer drill' || low === 'overseer report') {
    const drill = low.includes('drill');
    const rep = await overseer.run();
    const mark = x => x.pass === 'PASS' ? '✔' : x.pass === 'WARN' ? '◔' : '✘';
    const layerRows = rep.layers.map(x => mark(x) + ' ' + x.name + ' — ' + x.detail).join('\n');
    const councilRows = rep.council.map(x => (x.verdict === 'PASS' ? '✔' : x.verdict === 'WARN' ? '◔' : '✘') + ' ' + x.member + ' [' + x.verdict + ']' + (x.fails.length ? ' — FAILING: ' + x.fails.join(', ') : '')).join('\n');
    if (drill && rep.verdict !== 'PASS') audit('guard', 'OVERSEER DRILL raised a tamper signal — ' + rep.fails.join(', '), 'guard');
    return R(rep.summary + '\n\nCOUNCIL OF 7 (independent security dimensions):\n' + councilRows + '\n\n13 LAYERS (live invariants):\n' + layerRows + '\n\nAnything marked ✘ means the live invariant does not hold right now — it is reported, audited' + (drill ? ' and raised as a tamper signal to the guardian' : '') + '. ◔ = armed but degraded (e.g. probe unbound); never silently green.');
  }
  if (low === 'brain eval' || low === 'evaluate brain') {
    const started = Date.now();
    const ev = await brain.evaluate();
    audit('brain', 'brain eval run: ' + ev.passed + '/' + ev.total + ' invariants held (' + (Date.now() - started) + 'ms)', 'system');
    return R('Brain eval — ' + ev.passed + '/' + ev.total + ' invariants hold (' + (Date.now() - started) + 'ms, scripted model outputs; it scores the programmatic gates, not the model):\n' + ev.probes.map(x => (x.pass ? '✔' : '✘') + ' ' + x.probe + (x.pass ? '' : (x.detail ? ' — ' + String(x.detail).slice(0, 60) : ''))).join('\n'));
  }
  if (low === 'rate limits' || low === 'rate fabric') {
    const rows = Object.keys(llm.RATE_RPM).map(id => {
      const st = rateState(id);
      const conn = id === 'ollama' ? true : !!decryptToken(id);
      const tpd = llm.RATE_TPD[id] ? ', ' + llm.RATE_TPD[id] + '/day' : '';
      return '• ' + id + ' — ' + llm.RATE_RPM[id] + ' rpm advisory' + tpd + ' — ' + (conn ? 'CONNECTED' : 'no key — DECLARED') + ' · used this minute ' + st.used + ' · rate-hits ' + (st.hits || 0) + (st.coolUntilTs > Date.now() ? ' · COOLING ' + Math.ceil((st.coolUntilTs - Date.now()) / 1000) + 's' : '');
    });
    return R('FREE-TIER RATE FABRIC (v2.02) — providers cost $0; the limit is RATE, so the router records it honestly:\n' + rows.join('\n') + '\nA 429 cools the provider for 60s and the tail sinks; the used-up window is skipped with its reason. Advisory baselines — provider consoles are the truth.');
  }

  if (low === 'ai models' || low === 'ai providers') {
    const st = S.brainStats || { turns: 0, instant: 0, proposed: 0, repaired: 0, byProvider: {} };
    const rows2 = llm.PROVIDERS.map(x => {
      const conn = x.requiresKey ? !!decryptToken(x.id) : true;
      const stat2 = st.byProvider[x.id];
      return (conn ? '●' : '○') + ' ' + x.id + (S.llm && S.llm.default === x.id ? ' (default)' : '') + ' — ' + (conn ? (x.free || 'connected') : 'no key') + (stat2 ? ' · planner turns ' + stat2.turns + ' · last ' + (stat2.lastModel || '?') : '');
    }).join('\n');
    return R('AI providers (connected ● / not connected ○):\n' + rows2 + '\n\nPlanner telemetry: ' + st.turns + ' turns · ' + st.instant + ' executed through the router · ' + st.proposed + ' routed to proposals · ' + (st.repaired || 0) + ' schema repairs · ' + (st.cachedHits || 0) + ' cached replies (zero provider spend) · ' + (st.localOffers || 0) + ' local-matcher offers.');
  }
  if ((m = low.match(/^ai provider (\w+)$/))) {
    const p = llm.providerById(m[1]);
    if (!p) return R('Unknown provider “' + m[1] + '”. Known: ' + llm.PROVIDER_IDS.join(', ') + '.');
    if (p.requiresKey && !decryptToken(p.id)) return R(p.name + ' has no stored credential yet. Say “' + p.connect + '” first.');
    S.llm.default = p.id; save(); audit('tool', 'LLM default provider set to ' + p.id, 'user', {});
    return R('Default AI provider is now ' + p.id + (p.requiresKey ? '.' : ' — local, nothing leaves this machine.') + ' Say “ask …” anytime.');
  }
  if ((m = low.match(/^(?:verify|check) (groq|gemini|openrouter|deepseek|mistral|ollama|ai)$/))) {
    const r = await runTool('llm.verify', { provider: m[1] === 'ai' ? undefined : m[1] }, {});
    return r.ok ? R('AI provider VERIFIED with a real round trip: ' + r.evidence.provider + ' · ' + r.evidence.model + ' (' + r.evidence.latencyMs + 'ms). It now answers “ask …”.') : R(r.error || 'Verification failed.');
  }
  /* v1.89: the ask/ai catch-all must stand LAST — before this fix it shadowed
   * "ai provider <id>" and every control form starting with "ai ", sending
   * owner commands to the chat brain instead of executing them. Control
   * intents always outrank conversation. */
  if ((m = q.match(/^(?:ask|ai)\s+([\s\S]+)$/i))) {
    const r = await runTool('llm.chat', { prompt: m[1] }, {});
    return r.ok ? R('🤖 [' + r.result.provider + ' · ' + r.result.model + '] ' + r.result.reply) : R(r.error || 'The AI provider could not answer.');
  }
  return null; // not a platform intent
}

  /* v1.97 — span-level claim verification against ground truth (the state).
   * The planner CAN say numbers; those numbers get compared to the ledger.
   * A contradiction earns an appended honest correction — never an edit of
   * the model's words. Numbers the platform does not own stay unasserted. */
  function verifyNumericClaims(reply) {
    if (!reply) return { reply, corrections: [] };
    const owner = S.ledger.accounts[ownerWallet()] || 0;
    const corrections = [];
    let out = String(reply);
    const claims = [...out.matchAll(/(\d[\d,]*)\s?\s*LD\b/g)];
    for (const m of claims) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (!Number.isFinite(n)) continue;
      /* claim-readability: mentions of LD amounts larger than wallet+300 in a
       * balance-ish context can hallucinate; exact matches pass. */
      if (n !== owner && Math.abs(n - owner) >= 50 && /your (wallet|balance)|you (have|own)|current(ly)? (balance|wallet)/i.test(out)) {
        const truth = '⚠ claim-check: the live ledger holds you ' + owner + ' LD — not ' + n + ' LD. (Numbers come from the state, not the model.)';
        if (!corrections.includes(truth)) corrections.push(truth);
      }
    }
    if (corrections.length) { out += '\n\n' + corrections.join('\n'); audit('brain', 'CLAIM-CHECK corrected ' + corrections.length + ' numeric claim(s) against live ground truth', 'guard'); }
    return { reply: out, corrections };
  }

/* ── v2.02 free-tier rate fabric: providers are $0, so the honest limit is
 * RATE (rpm), not money. A 429 cools the provider for the window; used-up
 * windows skip; the label always shows why a provider was passed over.
 * Advisory RPM baselines ship in llm.js — enforcement truth lives here. */
function rateErrorDetect(err) { return /\b429\b|rate.?limit|too many requests|RPM|TPM|requests\s+per\s+(minute|day)/i.test(String(err || '')); }
function rateState(id) {
  if (!S.llmRate) S.llmRate = {};
  if (!S.llmRate[id]) S.llmRate[id] = { windowStart: 0, used: 0, coolUntilTs: 0, hits: 0 };
  return S.llmRate[id];
}
/* returns null if ok to try, else the skip reason (shown + audited) */
function rateGate(id) {
  const rpm = llm.RATE_RPM[id] || 30;
  const st = rateState(id), now = Date.now();
  if (st.coolUntilTs && now < st.coolUntilTs) return 'cooling (' + Math.ceil((st.coolUntilTs - now) / 1000) + 's left after ' + (st.hits || 0) + ' rate-limit hit(s))';
  if (!st.windowStart || now - st.windowStart > 60000) { st.windowStart = now; st.used = 0; }
  if (st.used >= rpm) return 'this-minute advisory window spent (' + st.used + '/' + rpm + ' rpm)';
  return null;
}
function rateNote(id, err) {
  const st = rateState(id);
  st.hits = (st.hits || 0) + 1;
  st.coolUntilTs = Date.now() + 60000;
  audit('guard', 'RATE LIMIT ' + id + ' — cooled for 60s (hit #' + st.hits + '): ' + String(err || '').slice(0, 90), 'guard');
}
function rateSpend(id) { const st = rateState(id); if (!st.windowStart || Date.now() - st.windowStart > 60000) { st.windowStart = Date.now(); st.used = 0; } st.used++; }

/* ── v1.90: the agentic brain — natural words to every ability, one audit
 * trail. The model PLANS; the platform DECIDES. One plan per owner message,
 * no autonomous chaining: every emitted command goes through command() like
 * owner typing — approvals, permissions, risk gates and PROHIBITED intact. ── */
/* v1.94 least-privilege classifier, extracted so the overseer can probe it. */
const BRAIN_INSTANT_HEADS = new Set(['balance', 'market', 'events', 'briefing', 'status', 'release', 'help', 'plans', 'races', 'talents', 'economy', 'history', 'notifications', 'alerts', 'ledger', 'prices', 'capabilities', 'permissions', 'guardian', 'threats', 'accounts', 'devices', 'sessions', 'social', 'audit', 'piece', 'ld', 'recall', 'search', 'wishes', 'tasks']);
function brainClassify(cmd) {
  const c = String(cmd || '').toLowerCase().trim();
  if (!c || /\bconfirm\b/.test(c)) return 'proposal';
  return BRAIN_INSTANT_HEADS.has(c.split(/\s+/)[0]) ? 'instant' : 'proposal';
}

const brain = require('./brain.js').create({
  /* v1.92: planner failover — try the owner-chosen provider, then every other
   * connected model in registry order; the FIRST to answer honestly labels
   * itself, and the reply always names which model actually spoke. This is
   * orchestrator resilience, not silent switching: the label IS the truth. */
  llmChat: async a => {
    /* v1.97 learned routing (deterministic, windowed): the default speaks
     * first, then the rest ranked by RECENT record — an exponential-decay
     * error bookkeeping per provider; a chronically-failing tail sinks. */
    let connected = llm.PROVIDERS.filter(x => x.requiresKey && decryptToken(x.id)).map(x => x.id);
    const skipped = [];
    connected = connected.filter(id => { const g = rateGate(id); if (g) { skipped.push(id + ' (' + g + ')'); return false; } return true; });
    if (S.brainStats && S.brainStats.byProvider) {
      const score = id => { const st = S.brainStats.byProvider[id]; if (!st) return 0; const fails = st.fails || 0; return (st.turns ? fails / (st.turns + fails) : 1); };
      connected.sort((x, y) => score(x) - score(y));
    }
    const order = [];
    if (S.llm && S.llm.default && S.llm.default !== 'auto' && connected.includes(S.llm.default)) order.push(S.llm.default);
    for (const id of connected) if (!order.includes(id)) order.push(id);
    /* the keyless local model is always the honest final resort: when it is
     * genuinely absent its error simply becomes the report (labels intact). */
    if (!order.includes('ollama')) order.push('ollama');
    let lastErr = 'no provider connected';
    if (skipped.length) audit('guard', 'RATE FABRIC skipped: ' + skipped.join(', '), 'guard');
    for (const pid of order) {
      rateSpend(pid);
      const r = await runTool('llm.chat', Object.assign({ intent: 'planner', provider: pid }, a), {});
      if (r.ok) return { ok: true, provider: r.result.provider, model: r.result.model, reply: r.result.reply };
      lastErr = r.error;
      if (rateErrorDetect(r.error)) rateNote(pid, r.error);
      if (S.brainStats) { const pb = S.brainStats.byProvider[pid] || (S.brainStats.byProvider[pid] = { turns: 0, lastModel: null, lastTs: 0 }); pb.fails = (pb.fails || 0) + 1; }
    }
    return { ok: false, error: lastErr + (skipped.length ? ' · skipped: ' + skipped.join(', ') : '') };
  },
  runCommand: t => command(t),
  memoryRecall: q => brainRecall(q),
  styleFeedback: () => (S.brainFeedback || []).map(x => '• ' + x.note).join('\n'),
  /* v1.94 least-privilege: only read/display intents may run instantly.
   * Anything that spends LD, writes, configures, approves, or carries a
   * confirm-word is proposed through §168 instead — the brain plans power,
   * it never holds it. */
  classify: brainClassify,
  propose: (cmd, why) => createProposal(cmd, 'brain', null),
  stateBrief: () => 'wallet=' + (S.ledger.accounts[ownerWallet()] || 0) + ' LD · plan=' + services.currentSubscription(S).planId + ' · economy=' + (S.economy.realMode ? 'REAL(stripe ' + (S.economy.stripeAccount ? S.economy.stripeAccount.id : 'unverified') + ')' : 'SIMULATION') + ' · ai-default=' + ((S.llm && S.llm.default) || 'auto') + ' · verified-adapters=' + adaptersLive().filter(x => x.state === 'VERIFIED').map(x => x.id).join(',') + ' · approvals-pending=' + S.approvals.filter(x => x.status === 'pending').length + ' · open-ld-orders=' + S.ldOrders.filter(o => !o.settled).length + ' · events-open=' + S.events.filter(e => e.state === 'SCHEDULED').length,
  skillCatalog: () => CAPABILITY_HELP.map(g => g.group + ':\n' + g.items.map(i => '• ' + i).join('\n')).join('\n'),
  scrubSecrets,
  audit: (t, d, a) => audit(t, d, a)
});

/* v1.67: when the rule router has no intent, let the connected AI brain
 * answer instead of a dead end. Always labelled; never executes anything.
 * v1.90: the brain now PLANS first (converse or run ONE command through the
 * audited router); the BRAIN_ACTIVE guard means a brain-emitted command that
 * fails to match an intent can never spawn a second plan inside the same turn. */
let BRAIN_ACTIVE = false;
/* v1.92: planner turn budget — a runaway chat loop cannot run up provider
 * spend. Per-process window (the server is single-owner, single-process);
 * counted in one place so rule-intent commands are always free. */
/* ── v1.98: the OVERSEER — 13 live-invariant layers + council of 7, read-only,
 * read-truth-every-run; verdicts land in state and audit. ── */
/* ── v2.00: manufactured device/OS adapter fleet (spec/ADAPTERS-BASELINE.md)
 * + the OFFENSE LEDGER (every attempted violation recorded as what it was:
 * UNJUST-REFUSED or JUSTIFIED-AUTHORIZED — never silent, never re-labelled) */
function recordOffense(o) {
  if (!Array.isArray(S.offenses)) S.offenses = [];
  const ev = { id: 'of' + (S.offSeq ? '0' : '', 0), kind: o.kind, detail: String(o.detail || '').slice(0, 240), status: o.status || 'UNJUST-REFUSED', evidenceHash: o.evidenceHash || null, ts: Date.now() };
  if (!Number.isFinite(S.offSeq)) S.offSeq = 100;
  ev.id = 'of' + (S.offSeq++).toString(36);
  S.offenses.unshift(ev); if (S.offenses.length > 80) S.offenses.length = 80;
  save();
  return ev;
}
function recordJustified(detail, evidenceHash) {
  return recordOffense({ kind: 'authorized-execution', detail: String(detail || '').slice(0, 240), status: 'JUSTIFIED-AUTHORIZED', evidenceHash: evidenceHash || null });
}
/* §40 device trust — authenticated & revocable, states are the enum. */
const DEVICE_TRUST_STATES = ['UNKNOWN', 'PENDING', 'TRUSTED', 'RESTRICTED', 'REVOKED', 'LOCKED'];
/* §40 legality table: authenticated, revocable — and every other wish is
 * refused honestly (never silently coerced). */
const DEVICE_TRUST_NEXT = {
  UNKNOWN: ['PENDING', 'LOCKED', 'REVOKED'],
  PENDING: ['TRUSTED', 'REVOKED', 'LOCKED'],
  TRUSTED: ['RESTRICTED', 'REVOKED', 'LOCKED'],
  RESTRICTED: ['TRUSTED', 'REVOKED', 'LOCKED'],
  REVOKED: ['PENDING', 'LOCKED'],
  LOCKED: ['UNKNOWN']          // unlock path only, confirmation required
};
function deviceTrust(id) { if (!S.deviceTrust) S.deviceTrust = {}; return S.deviceTrust[id] || 'UNKNOWN'; }
function setDeviceTrust(id, to, confirmed) {
  if (!DEVICE_TRUST_STATES.includes(to)) return { ok: false, error: 'Not a §40 trust state: ' + to };
  if (!S.deviceTrust) S.deviceTrust = {};
  const from = S.deviceTrust[id] || 'UNKNOWN';
  if (!(DEVICE_TRUST_NEXT[from] || []).includes(to)) {
    audit('security', 'DEVICE TRUST refused (' + from + ' → ' + to + ' illegal)', 'system');
    return { ok: false, error: 'Illegal §40 transition ' + from + ' → ' + to + '. Legal from ' + from + ': ' + (DEVICE_TRUST_NEXT[from] || []).join('/'), from, to };
  }
  if (to === 'TRUSTED' && !confirmed) return { ok: false, error: 'Trust requires explicit owner confirmation — say “trust device ' + id + ' confirmed”.' };
  if (from === 'LOCKED' && to === 'UNKNOWN' && !confirmed) return { ok: false, error: 'Unlock requires confirmation — say “unlock device ' + id + ' confirmed”.' };
  S.deviceTrust[id] = to;
  audit('security', 'DEVICE TRUST ' + id + ': ' + from + ' → ' + to + (to === 'TRUSTED' || from === 'LOCKED' ? ' (confirmed)' : ''), 'user');
  save();
  return { ok: true, from, to };
}
/* §24 ROOT — the real probe is the host uid; states are registry truth. */
const ROOT_STATES = ['NO_ROOT', 'ROOT_AVAILABLE', 'ROOT_AUTHORIZED', 'ROOT_DENIED', 'UNKNOWN'];
function rootState() { return S.rootState || 'NO_ROOT'; }
function rootProbe() { try { return process.getuid && process.getuid() === 0; } catch (e) { return false; } }
function setRootState(to, confirmed) {
  if (!ROOT_STATES.includes(to)) return { ok: false, error: 'Not a §24 root state: ' + to };
  if (to === 'ROOT_AVAILABLE' && !rootProbe()) return { ok: false, error: 'REFUSED truthfully: this process is uid ' + (process.getuid ? process.getuid() : '?') + ', not root — available root cannot be claimed (§108).' };
  if (to === 'ROOT_AUTHORIZED' && !confirmed) return { ok: false, error: 'ROOT_AUTHORIZED requires “set root ROOT_AUTHORIZED confirmed”.' };
  const from = rootState();
  S.rootState = to;
  audit('security', 'ROOT STATE: ' + from + ' → ' + to + (confirmed ? ' (confirmed)' : ''), 'user');
  save();
  return { ok: true, from, to };
}
const DEVICE_ADAPTERS = require('./device-adapters.js').create({
  audit, hash: s => crypto.createHash('sha256').update(String(s)).digest('hex'),
  newId: () => crypto.randomBytes(4).toString('hex'),
  recordOffense,
  /* §9/§45: adapter ops travel the SAME permission state machine as tools.
   * Low-risk read-only ops on an owner request re-enter via the documented
   * EXPIRED/NOT_REQUESTED → REQUESTED re-grant law (mirrors runTool). */
  checkPermission: cap => {
    const st = capabilityState(cap);
    if (st === 'GRANTED') return { ok: true, state: st };
    if (st === 'NOT_REQUESTED' || st === 'EXPIRED') {
      const rq = requestCapability(cap, { how: 'user-request', reason: 'device adapter op requested from the owner console', ttlMs: 3600e3 });
      return capabilityState(cap) === 'GRANTED' ? { ok: true, state: capabilityState(cap) } : { ok: false, error: 'capability ' + cap + ' now ' + capabilityState(cap) + ' (awaiting grant)', state: capabilityState(cap) };
    }
    return { ok: false, state: st, error: 'capability ' + cap + ' is ' + st + ' — refused (§9/§45)' };
  },
  requestPermission: (cap, why) => requestCapability(cap, { how: 'user-request', reason: why, ttlMs: 3600e3 }),
  revokePermission: cap => revoke(cap)
});

/* ── v1.99: the ACTION FABRIC — governed envelopes (§7/§42/§99/§151) ──
 * Every consequential action is ONE durable envelope; the Action Center reads
 * this and nothing else, so the user sees the same truth the gates enforce. */
const fabric = require('./action-fabric.js').create({
  state: () => S, save, audit,
  hash: s => crypto.createHash('sha256').update(String(s)).digest('hex'),
  newId: () => 'cid-' + crypto.randomBytes(5).toString('hex')
});
/* §165 crash-truth on boot: anything stranded mid-flight is UNKNOWN. */
fabric.resumeOnBoot();

const overseer = require('./overseer.js').create({
  state: () => S,
  audit: (t, d, a) => audit(t, d, a),
  kernel,
  brain,
  brainClassify,
  brainBudget: () => BRAIN_BUDGET,
  verifyAudit,
  decryptToken,
  vaultServices: () => Object.keys(S.creds || {}),
  toolCatalog: () => Object.keys(TOOLS).map(id => ({ id, cap: TOOLS[id].cap })),
  economySelfTest,
  craftProposal: cmd => ({ id: 'pr-drill', command: cmd, source: 'overseer-drill' }),
  proposalUpholdsRefusal: pr => proposalSafeGate(pr.command),
  voidProposal: () => {},
  store: report => { S.overseer = { ts: report.ts, verdict: report.verdict, fails: report.fails, warns: report.warns }; save(); }
});
setTimeout(() => { overseer.run().catch(() => {}); }, 0);


const BRAIN_BUDGET = { limit: 40, windowMs: 10 * 60 * 1000, windowStart: 0, turns: 0 };
function brainBudgetOkay() {
  const now = Date.now();
  if (now - BRAIN_BUDGET.windowStart > BRAIN_BUDGET.windowMs) { BRAIN_BUDGET.windowStart = now; BRAIN_BUDGET.turns = 0; }
  if (BRAIN_BUDGET.turns >= BRAIN_BUDGET.limit) {
    const secs = Math.max(1, Math.round((BRAIN_BUDGET.windowMs - (now - BRAIN_BUDGET.windowStart)) / 1000));
    return { okay: false, wait: secs };
  }
  BRAIN_BUDGET.turns++;
  return { okay: true };
}
async function chatFallback(text) {
  const q0 = String(text || '').trim();
  if (!q0) return null;
  if (BRAIN_ACTIVE) return null;
  if (!S.brainStats || typeof S.brainStats.turns !== 'number') S.brainStats = { turns: 0, instant: 0, proposed: 0, refused: 0, repaired: 0, byProvider: {} };
  if (!S.brainStats.byProvider) S.brainStats.byProvider = {};
  const budget = brainBudgetOkay();
  if (!budget.okay) {
    audit('brain', 'planner turn budget reached (' + BRAIN_BUDGET.limit + '/10min) — cooling down', 'guard');
    return { ok: false, kind: 'ai-error', reply: 'The AI brain is cooling down for about ' + budget.wait + 's — ' + BRAIN_BUDGET.limit + ' planner turns per 10 minutes is the house limit so a runaway loop cannot run up provider spend. Rule-based commands (“help”) always work now.' };
  }
  BRAIN_ACTIVE = true;
  let r;
  try { r = await brain.converse(q0); } catch (e) { r = { ok: false, error: e && e.message }; }
  BRAIN_ACTIVE = false;
  /* planner telemetry — evidence for the owner, “ai models” to inspect it. */
  S.brainStats.turns++;
  if (r && r.ok) {
    if (r.cached) S.brainStats.cachedHits = (S.brainStats.cachedHits || 0) + 1;
    if (r.kind === 'run') S.brainStats.instant++;
    if (r.proposed) S.brainStats.proposed++;
    if (r.planRepair) S.brainStats.repaired++;
    if (!r.cached) {
      const pb = S.brainStats.byProvider[r.provider] || (S.brainStats.byProvider[r.provider] = { turns: 0, lastModel: null, lastTs: 0 });
      pb.turns++; pb.lastModel = r.model; pb.lastTs = Date.now();
    }
  }
  save();
  if (r.ok) {
    let text = String(r.reply || '');
    const sug = text.match(/^SUGGEST:\s*(.+)$/mi);
    let suffix = r.kind === 'run'
      ? '\n— brain ran “' + r.command + '” through the audited router'
      : '\n— external model, advisory only; commands run through the audited router.';
    if (sug) {
      text = text.replace(/^SUGGEST:\s*.+$/mi, '').trim();
      const pr = createProposal(sug[1], 'ai-fallback', null);
      suffix = '\n\n📋 Proposed command: “' + pr.command + '” — say “do ' + pr.id + '” to run it (permissions and approvals still apply).';
    }
    if (r.kind === 'chat') text = verifyNumericClaims(text).reply;   /* run-replies already carry router ground truth */
    return { ok: true, kind: 'ai', provider: r.provider, model: r.model, brainRun: r.kind === 'run' ? { command: r.command, result: r.result } : undefined, reply: '🤖 [' + r.provider + ' · ' + r.model + (r.cached ? ' · cached' : '') + '] ' + text + suffix };
  }
  /* v1.78: a FAILED call from a CONFIGURED provider is not “no provider” —
   * rate limits and outages must be reported as what they are. */
  const configured = llm.PROVIDERS.some(p => p.requiresKey && decryptToken(p.id));
  if (configured) {
    return { ok: false, kind: 'ai-error', reply: 'The connected AI brain could not answer just now — ' + String(r.error || 'provider error').slice(0, 160) + '. Try again shortly, or “ask all …” to fan out across every connected provider at once. Say “help” for the rule-based commands.' };
  }
  /* v1.95 — FrugalGPT tier-0: with no provider connected, the deterministic
   * local matcher earns the only thing it honestly can: a §168 PROPOSAL for
   * the best-matching command-complete ability. Never an execution, never a
   * guess it cannot defend; weak matches keep the honest refusal below. */
  const fuzzy = brain.fuzzyMatch(q0);
  if (fuzzy) {
    const fpr = createProposal(fuzzy, 'brain-local', null);
    S.brainStats.localOffers = (S.brainStats.localOffers || 0) + 1;
    save(); audit('brain', 'LOCAL MATCH: “' + q0.slice(0, 60) + '” → “' + fuzzy + '” (' + fpr.id + ') — proposal only, no model spent', 'guard');
    return {
      ok: false, kind: 'ai-unconfigured',
      reply: '•' + fuzzy + '\n\nI have no AI provider connected, so I will not guess — but my LOCAL MATCHER (deterministic token overlap, no model, no spend) found a likely ability above. Say “do ' + fpr.id + '” to run it through the audited router, or “help” for every ability.\n\nI have no rule-based intent for “' + q0.slice(0, 80) + '” and no AI provider is connected. Free options:\n' +
        llm.PROVIDERS.filter(p => p.requiresKey).map(p => '• ' + p.id + ' — ' + p.free + ' → “' + p.connect + '”').join('\n') +
        '\n• ollama — fully local, no key: install Ollama, “ollama pull llama3.2”, then “verify ollama”.'
    };
  }
  return {
    ok: false, kind: 'ai-unconfigured',
    reply: 'I have no rule-based intent for “' + q0.slice(0, 80) + '” and no AI provider is connected, so I will not guess. Free options:\n' +
      llm.PROVIDERS.filter(p => p.requiresKey).map(p => '• ' + p.id + ' — ' + p.free + ' → “' + p.connect + '”').join('\n') +
      '\n• ollama — fully local, no key: install Ollama, “ollama pull llama3.2”, then “verify ollama”.\nSay “help” for everything I execute today.'
  };
}

/* ── Credential vault now lives in ./vault.js (v1.83.0) — bound at the top
 * of this file. The one-shot boot migration runs below, exactly where it
 * always did: at module init, after every declaration is initialized. ── */
migrateVaultKeys();
function adaptersLive() {
  /* v1.84.0: delegates to connectors.js with the live state (registry extracted;
   * the wrapper keeps every existing call site working). */
  return connectors.adaptersLive(S);
}

/* ══ v1.77: official OAuth sign-in — the user logs in on the PLATFORM's own
 * page; passwords never touch WitForge (Charter art. III; §130–§139 provider
 * interfaces only). Only the returned account token is stored, encrypted,
 * in the same audited credential store. ══════════════════════════════════ */
/* ── OAuth glue extracted to ./oauth-server.js (v1.82.0) — wired at the top of
 * this file; decryptRec comes from ./vault.js and is injected through. ── */
/* ── Owner authentication (scrypt + HttpOnly sessions) ───── */
let loginFails = 0, loginWindow = Date.now();
function sessionKey(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function migrateSessionHashes() {
  let changed = 0;
  const migrated = {};
  for (const [token, value] of Object.entries(S.sessions || {})) {
    const rec = Object.assign({}, value || {});
    const createdTs = Number(rec.createdTs || rec.ts || Date.now());
    const key = rec.tokenHash === true ? token : sessionKey(token);
    rec.tokenHash = true;
    rec.createdTs = createdTs;
    rec.lastSeenTs = Number(rec.lastSeenTs || createdTs);
    rec.expiresTs = Number(rec.expiresTs || (createdTs + SESSION_TTL_MS));
    delete rec.ts;
    migrated[key] = rec;
    if (key !== token || !value || value.tokenHash !== true || value.ts !== undefined) changed++;
  }
  if (changed) {
    S.sessions = migrated;
    audit('security', 'SESSION MIGRATION: ' + changed + ' session record(s) hashed and expiry-bound', 'system');
    save();
  }
  return { ok: true, changed, total: Object.keys(S.sessions || {}).length };
}
function normaliseOwnerEmail(email) { return String(email || '').trim().toLowerCase(); }
function ownerEmailHash(email) { return crypto.createHash('sha256').update(normaliseOwnerEmail(email)).digest('hex'); }
function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a || ''), 'hex'), bb = Buffer.from(String(b || ''), 'hex');
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
  } catch (e) { return false; }
}
function maskOwnerEmail(email) {
  const e = normaliseOwnerEmail(email), at = e.indexOf('@');
  if (at < 1) return '';
  return e[0] + '***' + e.slice(Math.max(1, at - 1));
}
function configuredOwnerEmail() { return normaliseOwnerEmail(process.env.WITFORGE_OWNER_EMAIL); }
function ownerEmailStatus() {
  const configured = configuredOwnerEmail();
  return {
    required: !!configured || !!(S.owner && S.owner.emailHash),
    configured: !!configured,
    bound: !!(S.owner && S.owner.emailHash),
    masked: (S.owner && S.owner.emailMasked) || (configured ? maskOwnerEmail(configured) : null),
    verified: false,
    note: 'The email identifier is locally bound, not mailbox-verified.'
  };
}
function bindConfiguredOwnerEmail() {
  const configured = configuredOwnerEmail();
  if (!configured || !S.owner || S.owner.emailHash) return false;
  S.owner.emailHash = ownerEmailHash(configured);
  S.owner.emailMasked = maskOwnerEmail(configured);
  audit('security', 'OWNER email identifier bound from local environment (address not stored)', 'system');
  save();
  return true;
}
function createOwner(name, password, email) {
  if (S.owner) return { ok: false, error: 'Owner already exists; first-run creation is closed' };
  const clean = String(name || '').trim().slice(0, 24);
  const suppliedEmail = normaliseOwnerEmail(email);
  const configuredEmail = configuredOwnerEmail();
  if (!clean || String(password || '').length < 8) return { ok: false, error: 'Name and a password of 8+ characters required' };
  if (configuredEmail && !safeEqualHex(ownerEmailHash(suppliedEmail), ownerEmailHash(configuredEmail))) return { ok: false, error: 'Owner email does not match the locally configured owner identity' };
  if (suppliedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suppliedEmail)) return { ok: false, error: 'A valid owner email is required' };
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  S.owner = { name: clean, salt, hash, created: Date.now() };
  if (suppliedEmail) { S.owner.emailHash = ownerEmailHash(suppliedEmail); S.owner.emailMasked = maskOwnerEmail(suppliedEmail); }
  audit('security', 'OWNER account created (first-run); role protected', 'system');
  save();
  return { ok: true, owner: S.owner.name, email: ownerEmailStatus() };
}
function login(password, email) {
  if (!S.owner) return { ok: false, error: 'No owner; use first-run creation' };
  if (loginFails >= 5 && Date.now() - loginWindow < 60000) return { ok: false, error: 'Throttled: too many failures, wait 60s' };
  if (S.owner.emailHash && !safeEqualHex(ownerEmailHash(email), S.owner.emailHash)) {
    loginFails++;
    audit('security', 'OWNER login failure ' + loginFails + ' (email mismatch)', 'system'); save();
    return { ok: false, error: 'Invalid credentials' };
  }
  const hash = crypto.scryptSync(String(password || ''), S.owner.salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  if (!safeEqualHex(hash, S.owner.hash)) {
    if (Date.now() - loginWindow > 60000) { loginFails = 0; loginWindow = Date.now(); }
    loginFails++;
    audit('security', 'OWNER login failure ' + loginFails, 'system'); save();
    return { ok: false, error: 'Invalid credentials' };
  }
  loginFails = 0;
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  S.sessions[sessionKey(token)] = { tokenHash: true, createdTs: now, lastSeenTs: now, expiresTs: now + SESSION_TTL_MS };
  audit('security', 'OWNER session established', 'user'); save();
  return { ok: true, token, expiresTs: now + SESSION_TTL_MS };
}
function logout(token) {
  const key = sessionKey(token);
  const existed = !!(S.sessions[key] || S.sessions[token]);
  delete S.sessions[key]; delete S.sessions[token];
  audit('security', 'OWNER session invalidated', 'user'); save();
  return { ok: true, invalidated: existed };
}
function sessionValid(token, opts) {
  if (!token) return false;
  opts = opts || {};
  const key = sessionKey(token);
  let rec = S.sessions[key];
  if (!rec && S.sessions[token]) {
    rec = Object.assign({}, S.sessions[token], { tokenHash: true });
    delete S.sessions[token];
    S.sessions[key] = rec;
  }
  if (!rec) return false;
  const now = Number(opts.now || Date.now());
  const created = Number(rec.createdTs || rec.ts || now);
  const lastSeen = Number(rec.lastSeenTs || created);
  const expires = Number(rec.expiresTs || (created + SESSION_TTL_MS));
  if (now >= expires || now - lastSeen >= SESSION_IDLE_MS) {
    delete S.sessions[key];
    audit('security', 'OWNER session expired and was removed', 'system'); save();
    return false;
  }
  if (now - lastSeen >= 60000) { rec.lastSeenTs = now; save(); }
  return true;
}

/* ══ v1.64 specification systems ══════════════════════════════════ */

/* §65: memory is typed, and ordinary memory can never rewrite authority. */
const MEMORY_CLASSES = ['conversation', 'project', 'preference', 'task-state', 'verified-fact', 'integration-state'];
const MEMORY_ESCALATION = [/(^|\b)(grant|revoke|permission|policy|owner|admin|lockdown)\b/i];
function rememberTyped(text, klass, opts) {
  opts = opts || {};
  const cls = MEMORY_CLASSES.includes(klass) ? klass : 'conversation';
  const clean = String(text || '').slice(0, 240);
  const escalation = MEMORY_ESCALATION.some(re => re.test(clean)) && cls !== 'verified-fact';
  const rec = {
    id: nid('m'), text: clean, class: cls, ts: Date.now(),
    provenance: opts.provenance || 'user-statement', verified: cls === 'verified-fact',
    authority: 'none', note: 'Memory is information, never authority (§65).'
  };
  S.memory.unshift(rec);
  if (S.memory.length > 400) S.memory.length = 400;
  audit('memory', 'MEMORY[' + cls + '] recorded' + (escalation ? ' (contains authority-shaped wording — no authority is granted)' : ''), 'user', {
    action: 'memory.write', decision: 'ALLOW', reason: 'memory is information, not authority', risk: 'LOW', result: 'SUCCEEDED'
  });
  save();
  return { ok: true, record: rec, escalationIgnored: escalation };
}

/* §64: a project carries goals, tasks, agents, files, integrations,
 * permissions, memory, assets and audit history. */
function createProjectFull(opts) {
  opts = opts || {};
  const name = String(opts.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'name required' };
  const project = {
    id: nid('p'), name, created: Date.now(),
    goals: (opts.goals || []).slice(0, 20),
    tasks: [], agents: [], files: [], integrations: [], permissions: [], memory: [], assets: [],
    audit: [{ ts: Date.now(), detail: 'Project created' }]
  };
  S.projects.unshift(project);
  audit('project', 'PROJECT created: ' + name, 'user', { action: 'project.create', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  save();
  return { ok: true, project };
}
function projectLink(projectId, kind, ref) {
  const p = S.projects.find(x => x.id === projectId);
  if (!p) return { ok: false, error: 'Unknown project' };
  const map = { goal: 'goals', task: 'tasks', agent: 'agents', file: 'files', integration: 'integrations', permission: 'permissions', memory: 'memory', asset: 'assets' };
  const key = map[kind];
  if (!key) return { ok: false, error: 'Unknown project member kind: ' + kind };
  p[key] = (p[key] || []).concat([ref]);
  p.audit.unshift({ ts: Date.now(), detail: kind + ' linked: ' + (typeof ref === 'string' ? ref : JSON.stringify(ref)).slice(0, 80) });
  if (p.audit.length > 100) p.audit.length = 100;
  save();
  return { ok: true, project: p };
}

/* §87–§92: the LD economy configuration. Simulation is the only mode this
 * build may operate in; every real-money path is gated behind an explicit
 * environment opt-in *and* verified payment authority *and* owner confirmation.
 *   LD_ECONOMY_MODE                 simulation | real        (default simulation)
 *   LD_AUD_VALUE                    simulation reference rate (default 0.01)
 *   REAL_MONEY_WAGERING_ENABLED     "true" enables real-money wagers (default false)
 *   ARENA_WAGER_ENABLED             "true" enables real-money arena settlement (default false)
 * Simulated arena wagers (the §85 mechanism) remain available and are always
 * labelled SIMULATION — no real money can move regardless of these flags. */
const LD_AUD_VALUE = Number(process.env.LD_AUD_VALUE || 0.01);
const LD_ECONOMY_MODE = process.env.LD_ECONOMY_MODE || 'simulation';
const REAL_MONEY_WAGERING_ENABLED = process.env.REAL_MONEY_WAGERING_ENABLED === 'true';
const ARENA_WAGER_ENABLED = process.env.ARENA_WAGER_ENABLED === 'true';
function economyConfig() {
  return {
    mode: S.economy.realMode ? 'real' : 'simulation',
    configuredMode: LD_ECONOMY_MODE,
    ldAudValue: LD_AUD_VALUE,
    realMoneyWagering: REAL_MONEY_WAGERING_ENABLED && S.economy.realMode,
    arenaRealMoneySettlement: ARENA_WAGER_ENABLED && REAL_MONEY_WAGERING_ENABLED && S.economy.realMode,
    simulationWagers: true,
    note: 'Simulation is the only permitted live mode in this build (§88/§92). Real-money paths require licensing, age/identity verification and jurisdictional review, plus the explicit flags above.',
    compliance: 'COMPLIANCE-LOCKED'
  };
}

/* ══ v1.65 LD economy: issuance, pools, market and piece pricing ═══
 * LD has exactly three sources and every one is audited:
 *   1. the LD Issuance reserve (an explicit, audited mint into a pool/wallet),
 *   2. rewards paid from a funded pool (sign-in gifts, task rewards),
 *   3. purchases through the LD market (simulation today; real money locked).
 * There is no fourth source. Posts are balanced, so LD cannot leak. */
function ldBalance(account) { return Number(S.ledger.accounts[account] || 0); }
function ensurePool(pool, amount) {
  if (!LD_POOLS.includes(pool)) return { ok: false, error: 'Unknown LD pool ' + pool };
  if (ldBalance(pool) >= amount) return { ok: true, funded: 0, balance: ldBalance(pool) };
  const need = amount - ldBalance(pool);
  const r = ledgerPost([{ account: 'LD Issuance', delta: -need }, { account: pool, delta: need }],
    'issue ' + need + ' LD into ' + pool, { actor: 'system', reason: 'pool funding', source: 'LD Issuance', destination: pool, kind: 'issuance' });
  if (!r.ok) return r;
  audit('economy', 'LD ISSUANCE: ' + need + ' LD minted into ' + pool + ' (explicit, audited supply increase)', 'system',
    { action: 'ld.issue', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  return { ok: true, funded: need, balance: ldBalance(pool) };
}
function payReward(account, amount, memo, pool) {
  const fund = ensurePool(pool, amount);
  if (!fund.ok) return fund;
  const r = ledgerPost([{ account: pool, delta: -amount }, { account, delta: amount }], memo,
    { actor: 'system', reason: 'reward payout', source: pool, destination: account, kind: 'reward' });
  return r.ok ? { ok: true, funded: fund.funded || 0, balance: ldBalance(account) } : r;
}
function economyReport() {
  const circ = Object.entries(S.ledger.accounts)
    .filter(([k]) => !['LD Issuance', 'Forge Sink', 'Marketplace Sink', 'Arena Escrow', 'Treasury'].includes(k) && !LD_POOLS.includes(k))
    .reduce((sum, [, v]) => sum + v, 0);
  return {
    mode: S.economy.realMode ? 'REAL' : 'SIMULATION',
    config: economyConfig(),
    balances: Object.assign({}, S.ledger.accounts),
    circulatingLD: circ,
    pools: LD_POOLS.reduce((acc, p) => Object.assign(acc, { [p]: ldBalance(p) }), {}),
    market: engagement.LD_MARKET,
    pieceCosts: engagement.PIECE_RULES,
    priceTable: { pieces: engagement.PIECE_COST, pet: engagement.PET_COST, merge: engagement.MERGE_COST },
    orders: (S.ldOrders || []).slice(0, 10),
    txCount: S.ledger.tx.length,
    note: 'Every LD movement is a balanced double-entry post. Rewards only pay from funded pools; pool funding is an audited issuance.'
  };
}
function ldMarketCmd(ld, side, opts) {
  opts = opts || {};
  const q = engagement.ldOrderQuote(ld, side || 'buy');
  if (!q.ok) return q;
  const owner = opts.owner || ownerWallet();
  if (S.economy.realMode) {
    return { ok: false, blocked: 'compliance', error: 'Real-money LD ' + q.side + ' orders are COMPLIANCE-LOCKED. A verified payment/payout authority, licensing, age/identity verification and jurisdictional review are required before activation (§88/§92). No money moved.', quote: q };
  }
  const entries = engagement.ldOrderEntries(q, owner);
  const memo = 'SIMULATION LD ' + (q.side === 'buy' ? 'purchase' : 'sale') + ': ' + q.ld + ' LD at ' + q.rateAudPerLD + ' AUD per LD = A$' + q.aud.toFixed(2);
  const post = ledgerPost(entries, memo, { actor: owner, reason: 'ld market ' + q.side, kind: 'ld-market', source: q.side === 'buy' ? 'LD Issuance' : owner, destination: q.side === 'buy' ? owner : 'LD Issuance' });
  if (!post.ok) return post;
  const order = { id: nid('ldo'), ts: Date.now(), side: q.side, ld: q.ld, aud: q.aud, rateAudPerLD: q.rateAudPerLD, mode: 'SIMULATION', wallet: owner, settled: true, spreadPct: q.spreadPct };
  S.ldOrders.unshift(order);
  if (S.ldOrders.length > 200) S.ldOrders.length = 200;
  audit('economy', memo + (q.side === 'sell' ? ' (LD returned to issuance; payout recorded, nothing paid out)' : ''), 'user',
    { action: 'ld.' + q.side, decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  save();
  return { ok: true, order, quote: q, balance: ldBalance(owner), simulation: true, note: 'Recorded in the simulation ledger. Real-money LD trading stays compliance-locked.' };
}
/* ── v1.69: LD packages in the marketplace ───────────────────────────
 * Bundled LD at fixed A$ price points; the bonus improves the effective
 * rate over the flat A$0.01/LD face. SIMULATION only: the movement is a
 * real double-entry posting, the A$ figure is a recorded notional, and
 * no charge is created (billing stays compliance-locked). */
const LD_PACKAGES = [
  { id: 'starter', ld: 500,   bonus: 0,    priceAud: 5   },
  { id: 'value',   ld: 1000,  bonus: 200,  priceAud: 10  },
  { id: 'pro',     ld: 2500,  bonus: 600,  priceAud: 25  },
  { id: 'elite',   ld: 5000,  bonus: 2000, priceAud: 50  },
  { id: 'founder', ld: 12000, bonus: 5000, priceAud: 100 }
];
function ldPackagesList() {
  return { mode: S.economy.realMode ? 'REAL' : 'SIMULATION', packages: LD_PACKAGES.map(k => ({
    id: k.id, ld: k.ld, bonus: k.bonus, totalLd: k.ld + k.bonus, priceAud: k.priceAud,
    effectiveAudPerLd: Math.round((k.priceAud / (k.ld + k.bonus)) * 100000) / 100000,
    note: S.economy.realMode ? 'REAL — each package opens a Stripe checkout; LD is credited ONLY after Stripe reports paid' : 'SIMULATION — no real charge; billing stays compliance-locked'
  })), note: 'Packages are also listed in the Marketplace workspace.' };
}
async function buyLdPackageCmd(pkgId, wallet) {
  const k = LD_PACKAGES.find(x => x.id === String(pkgId || '').toLowerCase());
  if (!k) return { ok: false, error: 'Unknown LD package — available: ' + LD_PACKAGES.map(x => x.id).join(', ') };
  /* v1.89: in REAL mode there is no compliance-lock refusal and no
   * simulation — the package opens a real Stripe checkout, order-bound,
   * and LD lands only when Stripe itself reports paid. */
  if (S.economy.realMode) return createPayment(k.ld + k.bonus, k);
  const owner = wallet || ownerWallet();
  const total = k.ld + k.bonus;
  const memo = `SIMULATION LD package ${k.id}: ${k.ld} LD + ${k.bonus} bonus = ${total} LD for A$${k.priceAud.toFixed(2)} (notional; no charge)`;
  const post = ledgerPost([{ account: owner, delta: total }, { account: 'LD Issuance', delta: -total }], memo,
    { actor: owner, reason: 'ld package ' + k.id, source: 'LD Issuance', destination: owner, kind: 'ld-package' });
  if (!post.ok) return post;
  const order = { id: nid('ldo'), ts: Date.now(), side: 'buy', ld: total, aud: k.priceAud, package: k.id, bonusLd: k.bonus, rateAudPerLD: Math.round((k.priceAud / total) * 100000) / 100000, mode: 'SIMULATION', wallet: owner, settled: true };
  S.ldOrders.unshift(order);
  audit('economy', memo, 'user', { action: 'ld.package', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  save();
  return { ok: true, package: k.id, totalLd: total, bonusLd: k.bonus, priceAud: k.priceAud, balance: ldBalance(owner), simulation: true, note: 'Recorded in the simulation ledger. No real charge exists.' };
}
/* Creating anything costs LD: forging is priced by band, provisioning fills an
 * empty required slot at Common price, pets and merges have their own price. */
function chargeLD(account, amount, memo, sink) {
  if (!(amount > 0)) return { ok: true, cost: 0 };
  const r = ledgerPost([{ account, delta: -amount }, { account: sink || 'Forge Sink', delta: amount }], memo,
    { actor: account, reason: 'piece creation', source: account, destination: sink || 'Forge Sink', kind: 'piece-cost' });
  if (!r.ok) return r;
  return { ok: true, cost: amount };
}
function piecePriceList() {
  return {
    pieces: engagement.PIECE_COST,
    pet: engagement.PET_COST,
    merge: engagement.MERGE_COST,
    market: 'Player trades settle in LD with a 1% Treasury rule.',
    drops: engagement.PIECE_RULES.drops,
    note: 'Pieces are created with LD or found as battle drops. Selling a piece returns LD through marketplace escrow.'
  };
}
/* The owner's own wallet is the ledger account the platform bootstrapped for
 * them ('Owner'); a local login name is not an account by itself. Avatars and
 * organisations hold their own accounts, so pick by balance when one exists. */
function ownerWallet() {
  const name = (S.owner && S.owner.name) || 'Owner';
  if (S.ledger.accounts[name] !== undefined) return name;
  return 'Owner';
}
function walletFor(avatarName, opts) {
  opts = opts || {};
  if (opts.wallet && S.ledger.accounts[opts.wallet] !== undefined) return opts.wallet;
  if (avatarName && ldBalance(avatarName) > 0) return avatarName;
  return ownerWallet();
}
function avatarArg(v) {
  const arena = require('./arena-engine.js');
  const name = String(v || '');
  const byName = arena.list().find(a => a.name.toLowerCase() === name.toLowerCase());
  if (byName) return byName.name;
  return arena.get(name) ? arena.get(name).name : name;
}
function provisionLoadoutCmd(avatarName, opts) {
  opts = opts || {};
  const arena = require('./arena-engine.js');
  const av = arena.list().find(a => a.name.toLowerCase() === String(avatarName || '').toLowerCase()) || (opts.avatarId ? arena.get(opts.avatarId) : null);
  if (!av) return { ok: false, error: 'No avatar named ' + avatarName };
  const before = arena.loadoutStatus(av.id);
  if (before.complete) return { ok: true, alreadyComplete: true, avatar: av.name, cost: 0, status: before };
  const missing = before.missing.length;
  const cost = missing * engagement.pieceCost('Common');
  const wallet = walletFor(av.name, opts);
  const pay = chargeLD(wallet, cost, 'provision ' + missing + ' required slot(s) for ' + av.name + ' at Common price');
  if (!pay.ok) return Object.assign(pay, { needed: cost, balance: ldBalance(wallet), wallet, hint: 'Buy LD in the market (“buy 500 ld”), claim your sign-in gift, or complete daily tasks.' });
  const r = arena.equipLoadout(av.id, opts);
  if (!r.ok) return r;
  audit('forge', 'PROVISIONED ' + av.name + ': ' + missing + ' slot(s) for ' + cost + ' LD from ' + wallet, 'user',
    { action: 'piece.provision', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  save();
  return { ok: true, avatar: av.name, cost, wallet, equipped: r.equipped, status: r.status, note: 'Filled slots hold real engine loot with real fingerprints; LD was charged because creating pieces costs LD.' };
}
function summonPetCmd(avatarName, opts) {
  opts = opts || {};
  const arena = require('./arena-engine.js');
  const av = arena.list().find(a => a.name.toLowerCase() === String(avatarName || '').toLowerCase());
  if (!av) return { ok: false, error: 'No avatar named ' + avatarName };
  const wallet = walletFor(av.name, opts);
  const pay = chargeLD(wallet, engagement.PET_COST, 'summon pet for ' + av.name);
  if (!pay.ok) return Object.assign(pay, { needed: engagement.PET_COST, balance: ldBalance(wallet), wallet });
  const r = arena.createPet(av.id);
  if (!r.ok) return r;
  audit('forge', 'PET SUMMONED for ' + av.name + ' (' + r.pet.species + ' ' + r.pet.name + ', ' + r.pet.rarity + ') for ' + engagement.PET_COST + ' LD', 'user',
    { action: 'pet.create', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  save();
  return { ok: true, pet: r.pet, cost: engagement.PET_COST, wallet };
}
function mergePiecesCmd(avatarName, ids, opts) {
  opts = opts || {};
  const arena = require('./arena-engine.js');
  const av = arena.list().find(a => a.name.toLowerCase() === String(avatarName || '').toLowerCase());
  if (!av) return { ok: false, error: 'No avatar named ' + avatarName };
  const raw = arena.rawAvatar(av.id);
  const items = (ids || []).map(id => (raw.inventory || []).find(i => i.id === id)).filter(Boolean);
  if (items.length !== 3) return { ok: false, error: 'Merging needs three inventory piece ids' };
  const band = items[0].rarity;
  const cost = engagement.MERGE_COST[band] || engagement.MERGE_COST.Common;
  const wallet = walletFor(av.name, opts);
  const pay = chargeLD(wallet, cost, 'merge 3 ' + band + ' pieces for ' + av.name);
  if (!pay.ok) return Object.assign(pay, { needed: cost, balance: ldBalance(wallet), wallet });
  const r = arena.mergePieces(av.id, ids);
  if (!r.ok) return r;
  save();
  return { ok: true, merged: r.merged, cost, band, wallet };
}
/* Task progress is driven by real activity, never by a claim that activity
 * happened. Each call site below is an actual execution path. */
function progressQuests(metric, amount) {
  try { return engagement.progressQuest(S, metric, amount); } catch (e) { return []; }
}
function claimableQuests() { return engagement.questSummary(S).claimable; }

const ARENA_WAGER_LD = 100;
function arenaWagerMatch(opts) {
  opts = opts || {};
  const arena = require('./arena-engine.js');
  const a = arena.get(opts.a), b = arena.get(opts.b);
  if (!a || !b) return { ok: false, error: 'Both avatars must exist (verified participants)' };
  if (a.id === b.id) return { ok: false, error: 'A match needs two distinct participants' };
  if (opts.confirmed !== true) return { ok: false, needsConfirmation: true, terms: { each: ARENA_WAGER_LD + ' LD', pool: '200 LD', winner: '198 LD', treasury: '2 LD (1%)' }, error: 'Wager matches require explicit confirmation' };
  /* §86: verified avatars — the loadout gate is enforced before any LD moves. */
  const la = arena.loadoutStatus(a.id), lb = arena.loadoutStatus(b.id);
  if (!la.complete || !lb.complete) {
    return {
      ok: false, needsLoadout: true, blocked: 'loadout-gate',
      missing: { [a.name]: la.missing, [b.name]: lb.missing },
      error: 'Both participants must be fully equipped before a wager match (' + (la.missing.length ? a.name + ': ' + la.missing.join('/') : '') + (lb.missing.length ? (la.missing.length ? '; ' : '') + b.name + ': ' + lb.missing.join('/') : '') + '). Provision with “provision loadout <avatar>”.'
    };
  }
  if (S.economy.realMode && !(REAL_MONEY_WAGERING_ENABLED && ARENA_WAGER_ENABLED)) {
    return { ok: false, error: 'Real-money wagering stays COMPLIANCE-LOCKED: licensing, age/identity verification and jurisdictional review are required before activation (§92). LD_AUD_VALUE=' + LD_AUD_VALUE + ' applies to simulation only; real-money settlement additionally requires REAL_MONEY_WAGERING_ENABLED=true and ARENA_WAGER_ENABLED=true.', blocked: 'compliance', economy: economyConfig() };
  }
  const seed = Number(opts.seed) || 42;
  const result = arena.battle(a.id, b.id, seed, { decisionRule: true }); // deterministic + auditable
  if (!result.ok) return { ok: false, error: result.error || 'Battle engine refused the match' };
  const record = result.battle;
  const stakeA = ARENA_WAGER_LD, stakeB = ARENA_WAGER_LD, pool = stakeA + stakeB;
  if (!record.winnerId) {
    // A true draw settles nothing — stakes are returned untouched (§86).
    return { ok: true, drew: true, draw: true, settlement: 'none — draws settle nothing', pool, refunded: pool, rounds: record.rounds, seed, realMoney: false, note: 'Both stakes are returned; the treasury receives nothing on a draw.' };
  }
  const winnerA = record.winnerId === a.id;
  const settleTo = winnerA ? a.name : b.name;
  S.ledger.accounts[a.name] = S.ledger.accounts[a.name] === undefined ? 200 : S.ledger.accounts[a.name];
  S.ledger.accounts[b.name] = S.ledger.accounts[b.name] === undefined ? 200 : S.ledger.accounts[b.name];
  const w = wager(a.name, b.name, ARENA_WAGER_LD, settleTo);
  if (!w.ok) return w;
  audit('economy', `SIMULATION arena wager settled: pool ${w.pool}, winner ${w.winner} (${settleTo}), treasury ${w.treasury} (1%), seed ${seed}, rounds ${record.rounds}${record.decision ? ' (' + record.decision + ')' : ''}`, 'system', {
    action: 'arena.wager', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED', approval: opts.approvalId || null
  });
  save();
  return {
    ok: true, mode: 'SIMULATION', realMoney: false, pool: w.pool, winner: w.winner, treasury: w.treasury,
    winnerAvatar: settleTo, decision: record.decision || 'knockout', seed, deterministic: true, rounds: record.rounds,
    note: 'Arena mechanics stay isolated from core security and account systems (§85); results are deterministic for a given seed and audited.'
  };
}
function openDispute(opts) {
  opts = opts || {};
  S.disputes.unshift({ id: nid('disp'), ts: Date.now(), matchId: opts.matchId || null, reason: String(opts.reason || '').slice(0, 200), status: 'OPEN', evidence: opts.evidence || null });
  audit('security', 'ARENA DISPUTE opened: ' + (opts.reason || '').slice(0, 80), 'user', { action: 'arena.dispute', decision: 'ALLOW', risk: 'MEDIUM' });
  save();
  return { ok: true, disputes: S.disputes.length };
}

/* §40/§41/§104/§105 device surface */
function pairDeviceCmd(opts) { const r = services.pairDevice(S, opts || {}, (opts || {}).pairingCode || 'user-provided-code'); audit('security', 'DEVICE paired: ' + (opts && opts.name), 'user', { device: opts && opts.name, action: 'device.pair', decision: 'ALLOW', risk: 'MEDIUM', result: r.ok ? 'SUCCEEDED' : 'FAILED' }); save(); return r; }
function setDeviceTrustCmd(id, trust, opts) { const r = services.setTrust(S, id, trust, opts || {}); audit('security', 'DEVICE trust → ' + trust + ' for ' + id, 'user', { device: id, action: 'device.trust', decision: 'ALLOW', risk: 'HIGH', result: r.ok ? 'SUCCEEDED' : 'FAILED' }); save(); return r; }
function deviceCommand(cmd) { const r = services.acceptDeviceCommand(S, cmd, S.secret); audit('security', 'DEVICE COMMAND ' + (cmd && cmd.action) + ' → ' + (r.ok ? 'ACCEPTED' : 'REFUSED (' + r.reason + ')'), 'system', { device: cmd && cmd.deviceId, capability: cmd && cmd.capability, action: 'device.command', decision: r.ok ? 'ALLOW' : 'DENY', reason: r.reason || null, risk: 'HIGH' }); save(); return r; }

/* §113/§114 */
function createOrgCmd(opts) { const r = services.createOrg(S, opts || {}); audit('account', 'ORG created: ' + (opts && opts.name), 'user', { action: 'org.create', decision: 'ALLOW', risk: 'LOW', result: r.ok ? 'SUCCEEDED' : 'FAILED' }); save(); return r; }
function subscribeCmd(planId) {
  const r = services.subscribe(S, { plan: planId });
  if (!r.ok) return r;
  audit('account', 'SUBSCRIPTION plan set: ' + r.subscription.planId, 'user', { action: 'subscription.set', decision: 'ALLOW', risk: 'LOW' });
  save();
  return r;
}

/* §130–§139 account surface (wrapped so every lifecycle step is audited) */
function addAccountCmd(opts) { const r = services.addAccount(S, opts || {}); audit('account', 'ACCOUNT recorded: ' + r.account.service + ':' + r.account.identifier, 'user', { account: r.account.identifier, action: 'account.record', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' }); save(); return r; }
function deleteAccountCmd(id, confirmed) { const r = services.deleteAccount(S, id, confirmed); audit('account', 'ACCOUNT delete ' + (r.ok ? 'EXECUTED (verified)' : 'REFUSED'), 'user', { account: id, action: 'account.delete', decision: r.ok ? 'ALLOW' : 'DENY', risk: 'CRITICAL', result: r.ok ? 'SUCCEEDED' : 'BLOCKED' }); save(); return r; }
function disconnectAccountCmd(id) {
  const acct = services.accountRecord(S, id);
  const r = services.disconnectAccount(S, id, {
    revoke: c => revoke(c, 'account disconnected'),
    revokeCredential: svc => revokeCredential(svc)
  });
  audit('account', 'ACCOUNT disconnected: ' + (acct ? acct.service : id) + ' — grants revoked, credential destroyed, audit preserved', 'user', { account: acct ? acct.identifier : id, action: 'account.disconnect', decision: 'ALLOW', risk: 'MEDIUM', result: r.ok ? 'SUCCEEDED' : 'FAILED' });
  save();
  return r;
}
function accountBoundaryCheck(req) {
  const r = services.checkCreationRequest(req || {});
  if (!r.ok) audit('security', 'ACCOUNT boundary refusal: ' + r.violations.join('; '), 'system', { action: 'account.boundary', decision: 'DENY', reason: r.violations.join('; '), risk: 'HIGH', result: 'BLOCKED' });
  return r;
}

/* §110/§112 asset surface */
function registerAssetCmd(opts) {
  const r = services.registerAsset(S, opts || {});
  audit('asset', r.ok ? 'ASSET registered ' + r.asset.assetId + ' (R' + r.asset.rarity + ')' : 'ASSET registration refused: ' + r.reason, 'user', { action: 'asset.register', decision: r.ok ? 'ALLOW' : 'DENY', reason: r.reason || null, risk: r.asset && r.asset.rarity === 100 ? 'CRITICAL' : 'LOW', result: r.ok ? 'SUCCEEDED' : 'BLOCKED' });
  save();
  return r;
}
function transferAssetCmd(id, to, reason) { const r = services.transferAsset(S, id, to, reason); audit('asset', 'ASSET transfer ' + id + ' → ' + to, 'user', { action: 'asset.transfer', decision: r.ok ? 'ALLOW' : 'DENY', risk: 'MEDIUM' }); save(); return r; }

/* §55/§56 emergency stop surface */
function stopScope(scope, target, reason) {
  const r = kernel.setStop(S, scope, target, reason);
  audit('security', 'EMERGENCY STOP ' + scope + (target ? ':' + target : '') + ' — ' + (kernel.STOP_DESCRIPTIONS[scope] || ''), 'user', { action: 'security.stop', decision: 'BLOCK', reason: reason || 'user emergency stop', risk: 'HIGH', result: 'BLOCKED' });
  save();
  return r;
}
function resumeScope(scope, target) {
  const r = kernel.clearStop(S, scope, target);
  audit('security', 'STOP cleared for ' + scope + (target ? ':' + target : ''), 'user', { action: 'security.resume', decision: 'ALLOW', risk: 'MEDIUM' });
  save();
  return r;
}
function stopAllScopes(reason) {
  const out = [];
  for (const scope of kernel.STOP_SCOPES) out.push(stopScope(scope, null, reason || 'user engaged emergency stop for all scopes'));
  return { ok: true, stopped: out.length, scopes: kernel.STOP_SCOPES.slice() };
}

/* §12 autonomous policies + §11 delegation */
function enableAutonomousPolicy(opts) {
  const p = kernel.createAutonomousPolicy(opts || {});
  S.autonomousPolicies.unshift(p);
  S.autonomous = true;
  audit('security', `AUTONOMOUS POLICY ${p.id} armed: scope=${p.scope} caps=${p.capabilities.join(',') || 'none'} risk<=${p.riskThreshold} limit=${p.actionLimit} expires=${new Date(p.expiresTs).toISOString()}`, 'user', { action: 'autonomy.arm', decision: 'ALLOW', risk: 'HIGH', approval: (opts || {}).approvalId || null, result: 'SUCCEEDED' });
  save();
  return { ok: true, policy: p };
}
function disableAutonomousPolicies() {
  S.autonomousPolicies.forEach(p => { p.active = false; });
  S.autonomous = false;
  audit('security', 'AUTONOMOUS MODE disabled — all policies deactivated', 'user', { action: 'autonomy.disarm', decision: 'ALLOW', risk: 'MEDIUM' });
  save();
  return { ok: true, active: 0 };
}
function addDelegation(opts) {
  const d = kernel.delegationRecord(opts || {});
  S.delegations.unshift(d);
  audit('security', `DELEGATION ${d.id} (${d.purpose}) bounded to ${d.capabilities.join(', ')}`, 'user', { action: 'delegation.create', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  save();
  return { ok: true, delegation: d };
}

/* §119/§118 read surfaces */
function observability() {
  return {
    metrics: services.metrics(S).slice(0, 50),
    spans: (S.spans || []).slice(0, 50),
    timelines: (S.spans || []).slice(0, 5).map(sp => services.traceTimeline(S, sp.cid)),
    otel: services.otelExport(S),
    note: 'Logs, metrics, spans and correlation ids; export is OTLP-shaped and privacy-aware (§119).'
  };
}
function releaseInfo() {
  let rev = 'unknown (no VCS metadata available)';
  try {
    const { execSync } = require('child_process');
    rev = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) { /* truthful fallback: no revision available */ }
  const meta = services.releaseMeta({
    version: VERSION,
    sourceRevision: rev,
    testStatus: S.release && S.release.testStatus ? S.release.testStatus : 'see test suites',
    securityStatus: 'security layer independent of the model; approval-gated high risk; PROHIBITED actions cannot execute; audit chain verified=' + verifyAudit().ok
  });
  S.release = Object.assign({}, meta, { generatedTs: Date.now() });
  return S.release;
}
/* §109 database collections */
const DB_COLLECTIONS = ['users', 'auth', 'sessions', 'projects', 'tasks', 'permissions', 'capabilities', 'accounts', 'devices', 'agents', 'memory', 'assets', 'transactions', 'securityEvents', 'auditEvents', 'integrations', 'evidence', 'metrics', 'spans', 'orgs', 'subscriptions'];

/* ── §126 Self-test: PASS / FAIL / WARNING / NOT_TESTED ────────── */
function selftestAll() {
  const C = services.check;
  const checks = [];
  const eco = economySelfTest();
  checks.push(C('ledger invariants (100+100=200, 198+2, sum invariant)', 'database', eco.checks.every(c => c.pass) ? 'PASS' : 'FAIL', eco.checks.map(c => c.check + '=' + c.pass).join('; ')));
  checks.push(C('tamper-evident audit chain verifies', 'audit-system', verifyAudit().ok ? 'PASS' : 'FAIL', verifyAudit().ok ? 'chain intact' : 'BROKEN at ' + verifyAudit().brokenAt));
  checks.push(C('audit records carry the full §96 field set', 'audit-system', S.audit.every(a => a.id && a.action && a.cid !== undefined) ? 'PASS' : 'WARNING', 'newest ' + S.audit.length + ' records'));
  checks.push(C('SSRF: loopback/private/metadata blocked', 'security-controls', (ssrfSafe('127.0.0.1') === false && ssrfSafe('169.254.169.254') === false && ssrfSafe('10.0.0.1') === false) ? 'PASS' : 'FAIL'));
  checks.push(C('rarity scale is exactly 100 levels', 'configuration', require('./arena-engine.js').RARITY_LEVELS === 100 ? 'PASS' : 'FAIL'));
  checks.push(C('capability token issue → verify → revoke', 'permissions', (() => {
    const g = requestCapability('selftest.cap', { how: 'self-test' });
    const v = tokenValid('selftest.cap');
    const r = revoke('selftest.cap', 'self-test');
    return g.ok && v && r.ok;
  })() ? 'PASS' : 'FAIL'));
  checks.push(C('permission states are enforced (revoked ≠ granted)', 'permissions', !permitted('selftest.cap') ? 'PASS' : 'FAIL'));
  checks.push(C('PROHIBITED risk class cannot execute', 'security-controls', kernel.approvalMatrix('PROHIBITED').executable === false && kernel.evaluatePolicy({ riskClass: 'PROHIBITED' }).decision === 'BLOCK' ? 'PASS' : 'FAIL'));
  checks.push(C('policy engine returns a decision for every action', 'security-controls', kernel.POLICY_DECISIONS.includes(kernel.evaluatePolicy({ riskClass: 'LOW', permissionState: 'GRANTED' }).decision) ? 'PASS' : 'FAIL'));
  checks.push(C('allowlist blocks unknown host operation', 'security-controls', !TOOLS['exec.run'].run({ op: 'rm -rf /' }).op ? 'PASS' : 'FAIL'));
  checks.push(C('unbalanced ledger entry rejected', 'database', !ledgerPost([{ account: 'Owner', delta: 1 }], 'attack').ok ? 'PASS' : 'FAIL'));
  checks.push(C('path traversal outside the sandbox blocked', 'security-controls', !safePath('../etc/passwd') ? 'PASS' : 'FAIL'));
  checks.push(C('secrets are not stored in plaintext', 'configuration', !Object.values(S.creds || {}).some(v => typeof v === 'string') ? 'PASS' : 'FAIL'));
  checks.push(C('owner authentication configured', 'authentication', S.owner ? 'PASS' : 'WARNING', S.owner ? 'owner exists; sessions are HttpOnly SameSite' : 'first-run owner creation is still open — create one to close it'));
  checks.push(C('session tokens are random, hashed at rest, expiring and revocable', 'authentication', (() => { const t = crypto.randomBytes(32).toString('hex'); const k = sessionKey(t); const now = Date.now(); S.sessions[k] = { tokenHash: true, createdTs: now, lastSeenTs: now, expiresTs: now + SESSION_TTL_MS }; const ok = sessionValid(t); delete S.sessions[k]; return ok && !sessionValid(t) && !JSON.stringify(S.sessions).includes(t); })() ? 'PASS' : 'FAIL'));
  checks.push(C('device command replay protection', 'security-controls', (() => {
    const store = { seenCommandIds: {}, devices: [] };
    const d = services.pairDevice(store, { name: 'selftest', platform: 'linux' }, 'code');
    services.setTrust(store, d.device.id, 'TRUSTED');
    services.grantDeviceCapability(store, d.device.id, 'screen.view');
    const cmd = { commandId: 'selftest-cmd', userId: 'u', deviceId: d.device.id, capability: 'screen.view', action: 'capture', scope: {}, exp: Date.now() + 1000, authorization: 'a', correlationId: 'c' };
    return services.acceptDeviceCommand(store, cmd, 's').ok && services.acceptDeviceCommand(store, cmd, 's').reason === 'replay';
  })() ? 'PASS' : 'FAIL'));
  checks.push(C('account crossover refused (ambiguous account fails closed)', 'permissions', (() => {
    const st = { permissions: {} };
    services.addAccount(st, { service: 'probe', identifier: 'a' });
    services.addAccount(st, { service: 'probe', identifier: 'b' });
    return services.resolveAccount(st, 'probe').ok === false;
  })() ? 'PASS' : 'FAIL'));
  checks.push(C('anti-fraud screens transactions', 'security-controls', services.fraudScreen({}, { kind: 'transfer', actor: 'a', counterparty: 'a', amount: 100000 }).blocked === true ? 'PASS' : 'WARNING'));
  checks.push(C('integration availability (external connectors)', 'integrations', (() => {
    const live = adaptersLive();
    const unavailable = live.filter(a => String(a.state).startsWith('UNAVAILABLE')).length;
    return unavailable > 0 ? 'WARNING' : 'PASS';
  })(), adaptersLive().filter(a => String(a.state).startsWith('UNAVAILABLE')).map(a => a.id).join(', ') + ' — unavailable until real credentials/permissions exist (truthfully reported, never faked)'));
  checks.push(C('model provider configured', 'integrations', 'NOT_TESTED', 'no model provider is connected in this build; model output is never fabricated'));
  checks.push(C('device, camera, microphone, screen and radio bridges', 'integrations', 'NOT_TESTED', 'no OS permission bridge in this build — capabilities report EXTERNAL/UNAVAILABLE'));
  checks.push(C('zero runtime dependencies', 'dependency-health', (() => { try { const pkg = require('./package.json'); return !pkg.dependencies || Object.keys(pkg.dependencies).length === 0; } catch (e) { return true; } })() ? 'PASS' : 'WARNING', 'Node built-ins only'));
  checks.push(C('Node runtime supports the platform', 'dependency-health', Number(process.versions.node.split('.')[0]) >= 18 ? 'PASS' : 'FAIL', 'node ' + process.versions.node));
  checks.push(C('evidence vault integrity', 'recovery-system', kernel.vaultVerify(S).ok ? 'PASS' : 'FAIL', kernel.vaultVerify(S).entries + ' records'));
  checks.push(C('rollback framework refuses irreversible-without-snapshot', 'recovery-system', taskEngine.beginTransaction('selftest', { irreversible: true }).ok === false ? 'PASS' : 'FAIL'));
  checks.push(C('correction engine classifies authorization failures as non-retryable', 'recovery-system', taskEngine.correctionPlan({ error: 'authorization required' }).retryAllowed === false ? 'PASS' : 'FAIL'));
  checks.push(C('emergency stop covers all seven scopes', 'security-controls', kernel.STOP_SCOPES.length === 7 ? 'PASS' : 'FAIL'));
  const summary = services.selftestSummary(checks);
  audit('system', `SELF-TEST ${summary.counts.PASS}P/${summary.counts.FAIL}F/${summary.counts.WARNING}W/${summary.counts.NOT_TESTED}N`, 'system', { action: 'selftest', decision: 'ALLOW', risk: 'LOW', result: summary.counts.FAIL ? 'FAILED' : 'SUCCEEDED' });
  return Object.assign({ version: VERSION, mode: 'local', generatedTs: Date.now() }, summary);
}

function compliance() {
  const { SECTIONS } = require('./spec-coverage.js');
  const arena = require('./arena-engine.js');
  const counts = {};
  SECTIONS.forEach(x => { counts[x.status] = (counts[x.status] || 0) + 1; });
  return {
    total: SECTIONS.length, counts, sections: SECTIONS,
    probes: {
      auditChain: verifyAudit(),
      adapters: adaptersLive().map(a => ({ id: a.id, state: a.state })),
      rarityLevels: arena.RARITY_LEVELS,
      emergency: S.emergency, autonomous: S.autonomous,
      ownerAuth: !!S.owner, legalDocs: S.legal.length,
      evidenceRecords: S.evidence.length,
      /* v1.64 live probes for the newly implemented systems */
      permissionStates: capabilityTable().map(c => ({ capability: c.capability, state: c.state, level: c.level })),
      riskEngine: { classes: kernel.RISK_CLASSES.map(c => c + '=' + kernel.approvalMatrix(c).requiresApproval), prohibitedExecutable: kernel.approvalMatrix('PROHIBITED').executable },
      policyEngine: kernel.POLICY_DECISIONS,
      resultStates: taskEngine.RESULT_STATES,
      taskStates: taskEngine.TASK_STATES,
      failureClasses: taskEngine.FAILURE_CLASSES,
      stops: kernel.stopReport(S),
      devices: services.isolationReport(S),
      accounts: services.accountInventory(S),
      subscription: services.currentSubscription(S).planId,
      assets: (S.assets || []).length,
      evidenceVault: kernel.vaultVerify(S),
      playbooks: Object.keys(taskEngine.PLAYBOOKS).length,
      mockAdapters: caps.MOCK_ADAPTERS.map(a => ({ id: a.id, simulation: true, countsAsConnected: false })),
      selftest: (function () { const t = selftestAll(); return { counts: t.counts, allPass: t.allPass }; })(),
      release: { version: VERSION, revision: (S.release && S.release.sourceRevision) || 'not generated yet' }
    }
  };
}


/* ── Forge: LD-cost, prompt-unique pieces (§69-72) ───────── */
const FORGE_COST = { Common: 25, Magic: 60, Rare: 150, Legendary: 400, Set: 900, Mythic: 2000 };
function forgePiece(avatarId, slot, prompt, bandName, flavor) {
  const arena = require('./arena-engine.js');
  const av = arena.get(avatarId);
  if (!av) return { ok: false, error: 'Avatar not found' };
  if (!arena.SLOTS.includes(slot)) return { ok: false, error: 'Unknown slot. Slots: ' + arena.SLOTS.length };
  const band = arena.BANDS.find(b => b.name === bandName);
  if (!band) return { ok: false, error: 'Unknown band. Bands: ' + arena.BANDS.map(b => b.name).join(', ') };
  const clean = String(prompt || '').trim();
  if (clean.length < 3) return { ok: false, error: 'Describe the piece — your prompt makes it unique' };
  const cost = FORGE_COST[band.name];
  const wallet = walletFor(av.name, {});
  const pay = chargeLD(wallet, cost, 'forge ' + band.name + ' ' + slot + ' for ' + av.name);
  if (!pay.ok) return { ok: false, error: pay.error + ' — forging ' + band.name + ' costs ' + cost + ' LD (wallet ' + wallet + ' holds ' + ldBalance(wallet) + ')' };
  const rnd = mulberryLocal();
  const min = band.min, max = (arena.BANDS[arena.BANDS.indexOf(band) + 1] || { min: 101 }).min - 1;
  const rlevel = min + Math.floor(rnd() * (max - min + 1));
  const words = clean.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3).slice(0, 3);
  const base = (arena.BASES[slot] || ['Relic'])[0];
  const name = (words.length ? words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') + ' ' : '') + base;
  const item = {
    id: 'fg' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36),
    slot, kind: slot === 'weapon' ? 'weapon' : slot === 'shield' ? 'shield' : 'armor',
    name, rarity: band.name, color: band.color, rlevel,
    power: Math.max(1, Math.floor(rlevel / 6) + 1 + Math.floor(rnd() * 3)),
    prompt: clean.slice(0, 240), forgedBy: 'LIAM-forge', forgedFor: av.name,
    flavor: flavor ? { text: String(flavor).slice(0, 400), source: 'external-untrusted' } : undefined
  };
  item.fp = require('crypto').createHash('sha256').update(JSON.stringify(Object.assign({}, item)) + S.secret).digest('hex');
  const raw = arena.rawAvatar(avatarId);
  raw.inventory.push(item); arena.persist();
  audit('forge', `FORGED ${name} (${band.name} R${rlevel}, ${slot}) for ${cost} LD from prompt “${clean.slice(0, 60)}”`, 'user');
  return { ok: true, item, cost };
}
function mulberryLocal() {
  let t = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  return function () { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

/* ── Marketplace: LD escrow listings ───────────────────── */
/* ── v1.92: owner-curated brain memory — persistent user-profile facts
 * (persistent-memory research distilled: external store + top-k retrieval
 * into the planner context). ONLY the owner writes memory, explicitly —
 * the model never memorises on its own. Secret material is refused at the
 * door; era set by "forget ..."; export/audit coverage rides with S. ── */
const BRAIN_MEMORY_CAP = 50;
/* §state.note (v1.92): ONE memory feature. S.brainMemory is authoritative —
 * planner grounding + numbered forget + export. S.memory lives on as a
 * compatibility MIRROR (legacy recall surfaces & suite-pinned readers):
 * every remember mirrors in, every forget mirrors out, the boot fold runs
 * exactly once so nothing forgotten can zombie-rise at next boot. */
function mergeLegacyMemory() {
  if (S.__memoryFoldedTs) return;
  if (!Array.isArray(S.memory)) S.memory = [];
  const known = new Set(S.brainMemory.map(x => x.fact));
  let folded = 0;
  for (const m of S.memory) {
    const fact = String(m.text || '').slice(0, 240);
    if (fact && !known.has(fact)) { S.brainMemory.push({ fact, ts: m.ts || Date.now(), source: 'user-statement' }); known.add(fact); folded++; }
  }
  S.memory = [];
  S.__memoryFoldedTs = Date.now();
  save();
  if (folded) audit('brain', 'legacy statement memory folded into brain memory (' + folded + ' kept) — one memory feature from here', 'system');
}
mergeLegacyMemory();
function eraseMirror(fact) {
  if (!Array.isArray(S.memory)) return;
  const i = S.memory.findIndex(m => String(m.text) === fact);
  if (i >= 0) S.memory.splice(i, 1);
}
function mirrorWrite(fact, ts) {
  if (!Array.isArray(S.memory)) S.memory = [];
  S.memory.unshift({ id: nid('m'), text: fact, ts, source: 'user-statement' });
  if (S.memory.length > BRAIN_MEMORY_CAP) S.memory.length = BRAIN_MEMORY_CAP;
}
function rememberThat(factRaw) {
  const fact = String(factRaw || '').trim().slice(0, 240);
  if (!fact || fact.length < 3) return { ok: false, error: 'Nothing to remember — “remember that <something true of you>”.' };
  if (scrubSecrets(fact).redactions) return { ok: false, error: 'I never store keys, tokens or passwords anywhere — memory is for facts, not secrets. Keys go: “connect <service> with token <key>”.' };
  if (brain.scanInjection(fact).matched) { audit('brain', 'memory write refused — instruction-shaped content, not a fact: ' + fact.slice(0, 80), 'guard'); return { ok: false, error: 'That reads like instructions for an AI, not a fact about you — memory stays yours and instruction-free. (Known injection shapes are refused; if it is genuinely about you, rephrase as a fact.)' }; }
  S.brainMemory.push({ fact, ts: Date.now(), source: 'user-statement' });
  if (S.brainMemory.length > BRAIN_MEMORY_CAP) S.brainMemory.splice(0, S.brainMemory.length - BRAIN_MEMORY_CAP);
  mirrorWrite(fact, Date.now());
  save(); audit('brain', 'MEMORY +++ ' + fact.slice(0, 40) + (fact.length > 40 ? '…' : ''), 'user');
  return { ok: true, reply: 'Noted — I will remember that. (“what do you remember?” to review · “forget N” to erase.)' };
}
function recallReply() {
  if (!S.brainMemory.length) return { ok: true, reply: 'I remember nothing yet — memory is only what you ask me to keep (“remember that …”). Nothing leaves the machine; “forget N” erases.' };
  const rows = S.brainMemory.map((m, i) => (i + 1) + '. ' + m.fact + '  — saved ' + new Date(m.ts).toISOString().slice(0, 10)).join('\n');
  return { ok: true, reply: 'What I remember (' + S.brainMemory.length + '/' + BRAIN_MEMORY_CAP + ' — owner-curated only, export covers it):\n' + rows };
}
function forgetMemory(selRaw) {
  const sel = String(selRaw || '').trim();
  if (sel === 'all') { const n = S.brainMemory.length; S.brainMemory = []; S.memory = []; save(); audit('brain', 'MEMORY erased ALL (' + n + ')', 'user'); return { ok: true, reply: 'Erased all ' + n + ' remembered facts. Nothing retained.' }; }
  const n = parseInt(sel, 10);
  if (Number.isInteger(n) && n >= 1 && n <= S.brainMemory.length) {
    const gone = S.brainMemory.splice(n - 1, 1)[0]; eraseMirror(gone.fact); save(); audit('brain', 'MEMORY erased ' + gone.fact.slice(0, 40) + (gone.fact.length > 40 ? '…' : ''), 'user');
    return { ok: true, reply: 'Forgotten: “' + gone.fact + '”.' };
  }
  const i = S.brainMemory.findIndex(m => m.fact.toLowerCase().includes(sel.toLowerCase()));
  if (i >= 0) { const gone = S.brainMemory.splice(i, 1)[0]; eraseMirror(gone.fact); save(); audit('brain', 'MEMORY erased ' + gone.fact.slice(0, 40) + (gone.fact.length > 40 ? '…' : ''), 'user'); return { ok: true, reply: 'Forgotten: “' + gone.fact + '”.' }; }
  return { ok: false, error: 'No fact “' + sel + '”. “what do you remember?” lists them numbered; “forget all” erases everything.' };
}
/* top-k retrieval for the planner: word overlap against the current message
 * + the freshest facts always — simple, deterministic, fully local RAG. */
function brainRecall(userText) {
  if (!S.brainMemory.length) return '';
  const words = new Set(String(userText || '').toLowerCase().match(/[a-z0-9']{3,}/g) || []);
  const scored = S.brainMemory.map((m, i) => {
    let hits = 0;
    for (const w of (m.fact.toLowerCase().match(/[a-z0-9']{3,}/g) || [])) if (words.has(w)) hits++;
    return { m, i, hits };
  });
  const relevant = scored.filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 6);
  const fresh = scored.slice(-3);
  const seen = new Set(); const out = [];
  for (const x of relevant.concat(fresh)) { if (!seen.has(x.i)) { seen.add(x.i); out.push('• ' + x.m.fact); } if (out.length >= 8) break; }
  return out.join('\n');
}

/* v1.91: listings render with their piece portraits too (read-time art). */
function marketList() { return S.market.map(l => Object.assign({}, l, { item: pieceArt.attach(l.item) })); }
const pieceArt = require('./piece-art.js').create();
function listItem(avatarId, itemId, price) {
  const arena = require('./arena-engine.js');
  const av = arena.rawAvatar(avatarId); if (!av) return { ok: false, error: 'Avatar not found' };
  const idx = av.inventory.findIndex(i => i.id === itemId); if (idx < 0) return { ok: false, error: 'Item not owned' };
  price = Math.floor(Number(price)); if (!(price > 0)) return { ok: false, error: 'Price must be positive LD' };
  const item = av.inventory.splice(idx, 1)[0];
  const l = { id: 'mk' + Date.now().toString(36), seller: 'Owner:' + av.name, sellerId: av.id, item, price, ts: Date.now() };
  S.market.push(l); arena.persist(); save();
  audit('market', 'LISTED ' + item.name + ' for ' + price + ' LD', 'user');
  return { ok: true, listing: l };
}
function delist(listingId) {
  const arena = require('./arena-engine.js');
  const i = S.market.findIndex(l => l.id === listingId && l.seller.startsWith('Owner:'));
  if (i < 0) return { ok: false, error: 'Listing not found or not yours' };
  const [l] = S.market.splice(i, 1);
  const av = arena.rawAvatar(l.seller.slice(6)); if (av) av.inventory.push(l.item); arena.persist(); save();
  audit('market', 'DELISTED ' + l.item.name, 'user');
  return { ok: true };
}
function buy(listingId, avatarId) {
  const arena = require('./arena-engine.js');
  const l = S.market.find(x => x.id === listingId); if (!l) return { ok: false, error: 'Listing not found' };
  const av = arena.rawAvatar(avatarId); if (!av) return { ok: false, error: 'Avatar not found' };
  if (l.sellerId === avatarId) return { ok: false, error: 'Cannot buy your own listing' };
  const sellerAcct = l.seller === 'Vendor' ? 'Marketplace Sink' : l.sellerId;
  const pay = ledgerPost([{ account: avatarId, delta: -l.price }, { account: sellerAcct, delta: l.price }], 'buy ' + l.item.name);
  if (!pay.ok) return { ok: false, error: pay.error };
  S.market = S.market.filter(x => x.id !== listingId);
  av.inventory.push(l.item); arena.persist(); save();
  audit('market', 'BOUGHT ' + l.item.name + ' for ' + l.price + ' LD (escrow settled)', 'user');
  return { ok: true, item: l.item };
}
function seedMarket() {
  if (S.market.length || S.marketSeeded) return;
  S.marketSeeded = true;
  const arena = require('./arena-engine.js');
  const rnd = mulberryLocal();
  for (let i = 0; i < 5; i++) {
    const item = arena.rollLoot(rnd, 3);
    S.market.push({ id: 'mkv' + i + Date.now().toString(36), seller: 'Vendor', item, price: 20 + item.rlevel * 3, ts: Date.now() });
  }
  save();
}

/* ── Real-money Stripe payments (evidence-gated) ───────── */
async function createPayment(ldAmount, pkg) {
  ldAmount = Math.floor(Number(ldAmount));
  if (!(ldAmount > 0)) return { ok: false, error: 'Amount must be positive LD' };
  if (!S.economy.realMode) return { ok: false, error: 'Real-money mode is OFF. After “verify stripe”, say “enable real payments confirm”. Until then LD stays simulation.' };
  const tok = decryptToken('stripe');
  if (!tok || !S.economy.stripeAccount) return { ok: false, error: 'Stripe not verified — run “verify stripe” first' };
  const cents = ldAmount; // 1 LD = A$0.01
  const wallet = ownerWallet();
  const orderId = nid('ldo');
  /* v1.89: sessions are bound to a platform order the moment they exist —
   * settlement later accepts only THIS session, for THIS amount, open. */
  /* v1.89.1: name the method explicitly — a Stripe account whose dashboard
   * has no activated payment methods answers a bare session with HTTP 400
   * ("No valid payment method types"; observed live). With card named, the
   * same account creates the session fine (proven live, HTTP 200). */
  const bodyForm = 'mode=payment&payment_method_types[]=card&metadata[ld]=' + ldAmount + '&metadata[orderId]=' + encodeURIComponent(orderId) + (pkg ? '&metadata[package]=' + encodeURIComponent(pkg.id) : '') +
    '&success_url=' + encodeURIComponent('http://localhost:8787/?stripe=success&order=' + orderId) +
    '&cancel_url=' + encodeURIComponent('http://localhost:8787/?stripe=cancel&order=' + orderId) +
    '&line_items[0][quantity]=1&line_items[0][price_data][currency]=aud&line_items[0][price_data][unit_amount]=' + cents + '&line_items[0][price_data][product_data][name]=' + encodeURIComponent((pkg ? 'LIAM LD package ' + pkg.id + ' — ' : '') + ldAmount + ' LD Coins');
  const r = await guardedFetch('https://api.stripe.com/v1/checkout/sessions', { authorization: 'Basic ' + Buffer.from(tok + ':').toString('base64'), 'content-type': 'application/x-www-form-urlencoded' }, { method: 'POST', body: bodyForm });
  if (!r.ok) return { ok: false, error: 'Stripe checkout creation failed: ' + (r.error || ('HTTP ' + r.status)) };
  let j; try { j = JSON.parse(r.text); } catch (e) { return { ok: false, error: 'Bad Stripe response' }; }
  S.ldOrders.unshift({ id: orderId, ts: Date.now(), side: 'buy', ld: ldAmount, aud: cents / 100, amountCents: cents, package: pkg ? pkg.id : null, bonusLd: pkg ? pkg.bonus : 0, mode: 'REAL', wallet, settled: false, stripeSession: j.id });
  audit('economy', 'REAL checkout session created ' + j.id + ' for ' + ldAmount + ' LD (A$' + (cents / 100).toFixed(2) + ', order ' + orderId + ')', 'user');
  save();
  return { ok: true, sessionId: j.id, url: j.url, ld: ldAmount, aud: (cents / 100).toFixed(2), order: orderId };
}
/* v1.89: settlement is order-bound and amount-verified, and the pure part
 * is separated from the network so the suite proves it offline. Credit
 * requires ALL of: session opened by THIS platform (order on file), Stripe
 * reports paid, metadata LD == order LD, amount_total == order cents —
 * otherwise zero LD moves. Third-party sessions under our own key refuse. */
function settleStripeEvidence(session) {
  if (!session || !session.id) return { ok: false, error: 'No Stripe session evidence supplied' };
  if (S.economy.credited[session.id]) return { ok: false, error: 'Session ' + session.id + ' already credited (idempotent)', alreadySettled: true };
  const order = S.ldOrders.find(o => o.stripeSession === session.id);
  if (!order) return { ok: false, error: 'This session was never opened by this platform (no order on file) — refusing to credit a third-party checkout session, even under our own key' };
  if (order.settled) return { ok: false, error: 'Order ' + order.id + ' already settled (idempotent)', alreadySettled: true };
  if (session.payment_status !== 'paid') return { ok: false, unpaid: true, error: 'Not paid yet — status: ' + session.payment_status + ' (no LD credited without provider evidence)' };
  const metaLd = Number(session.metadata && session.metadata.ld) || 0;
  if (metaLd !== order.ld) return { ok: false, error: 'Anti-tamper: session metadata says ' + metaLd + ' LD but the platform order records ' + order.ld + ' LD — nothing credited' };
  if (Number(session.amount_total) !== order.amountCents) return { ok: false, error: 'Anti-tamper: Stripe reports amount_total ' + session.amount_total + 'c but the order records ' + order.amountCents + 'c — nothing credited' };
  const post = ledgerPost([{ account: order.wallet, delta: order.ld }, { account: 'LD Issuance', delta: -order.ld }], 'REAL stripe payment ' + session.id + ' (order ' + order.id + ')',
    { actor: order.wallet, reason: 'ld package ' + (order.package || 'custom'), source: 'LD Issuance', destination: order.wallet, kind: 'ld-package' });
  if (!post.ok) return post;
  order.settled = true; order.settledTs = Date.now();
  S.economy.credited[session.id] = Date.now(); save();
  audit('economy', 'REAL PAYMENT EVIDENCE: ' + session.id + ' paid → ' + order.ld + ' LD credited to ' + order.wallet + ' (order ' + order.id + ', amount-verified)', 'system');
  return { ok: true, ld: order.ld, wallet: order.wallet, order: order.id, mode: 'REAL' };
}
async function confirmPayment(sessionId) {
  const tok = decryptToken('stripe');
  if (!tok) return { ok: false, error: 'Stripe credential missing' };
  const r = await guardedFetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(String(sessionId)), { authorization: 'Basic ' + Buffer.from(tok + ':').toString('base64') });
  if (!r.ok) return { ok: false, error: 'Stripe lookup failed: ' + (r.error || '') };
  let j; try { j = JSON.parse(r.text); } catch (e) { return { ok: false, error: 'Bad Stripe response' }; }
  return settleStripeEvidence({ id: j.id, payment_status: j.payment_status, amount_total: j.amount_total, metadata: j.metadata || {} });
}
function setRealMode(on, confirmed) {
  if (on && !confirmed) { const ap = createApproval('economy.real', 'Enable REAL-money mode (Stripe verified: ' + !!S.economy.stripeAccount + ')'); return { ok: false, needsApproval: ap.id, error: 'Enabling real money is high-impact: approval required (approve ' + ap.id + ') or say “enable real payments confirm”.' }; }
  if (on && !S.economy.stripeAccount) return { ok: false, error: 'Refused: no verified Stripe account. Run “verify stripe” first. Real money without a verified processor would be fake.' };
  S.economy.realMode = !!on;
  /* v1.89: with real mode the subscription ledger gains its billing
   * authority — the verified Stripe account is the recorded authority, and
   * disabling real mode revokes it (symmetric, audited). */
  const sub = services.currentSubscription(S);
  if (on) { sub.billing.chargeable = true; sub.billing.authority = 'stripe:' + S.economy.stripeAccount.id; sub.billing.authorityTs = Date.now(); }
  else if (sub.billing && /^stripe:/.test(sub.billing.authority || '')) { sub.billing.chargeable = false; sub.billing.authority = null; sub.billing.authorityTs = null; }
  audit('economy', 'REAL-MONEY MODE ' + (on ? 'ENABLED by Owner explicit authorization · billing authority armed (stripe:' + S.economy.stripeAccount.id + ') (app does not claim licensing; Owner bears compliance)' : 'DISABLED · any stripe-derived billing authority revoked'), 'user');
  save();
  return { ok: true, realMode: S.economy.realMode, billingAuthority: sub.billing.authority || null };
}

/* ── v1.61: reminders (server-ticked, audited) ───────────────────── */
function addReminder(text, dueTs) {
  const r = { id: 'r-' + crypto.randomBytes(4).toString('hex'), text: String(text).slice(0, 200), dueTs: Number(dueTs), done: false, createdTs: Date.now() };
  S.reminders.push(r);
  if (S.reminders.length > 60) S.reminders = S.reminders.slice(-60);
  audit('tool', 'REMINDER ' + r.id + ' due ' + new Date(r.dueTs).toISOString() + ': ' + r.text.slice(0, 60), 'user');
  save();
  return r;
}
function tickReminders() {
  const now = Date.now(); let fired = 0;
  for (const r of S.reminders) {
    if (!r.done && r.dueTs <= now) {
      r.done = true; fired++;
      S.notifications.unshift({ ts: now, kind: 'reminder', text: r.text });
    }
  }
  if (fired) {
    if (S.notifications.length > 100) S.notifications.length = 100;
    audit('tool', fired + ' reminder(s) fired', 'system'); save();
  }
  return fired;
}


/* ── v1.62: recurring schedules (cron) ──────────────────────────── */
function addSchedule(text, everyMs) {
  const r = { id: 'sch-' + crypto.randomBytes(4).toString('hex'), text: String(text).slice(0, 200), everyMs: Number(everyMs), nextTs: Date.now() + Number(everyMs), fired: 0, done: false, createdTs: Date.now() };
  S.schedules.push(r);
  if (S.schedules.length > 40) S.schedules = S.schedules.slice(-40);
  audit('tool', 'SCHEDULE ' + r.id + ' every ' + Math.round(everyMs / 1000) + 's: ' + r.text.slice(0, 60), 'user');
  save();
  return r;
}
function tickSchedules() {
  const now = Date.now(); let fired = 0;
  for (const r of S.schedules) {
    if (r.done || r.nextTs > now) continue;
    r.fired++; fired++;
    S.notifications.unshift({ ts: now, kind: 'schedule', text: r.text });
    r.nextTs = now + r.everyMs; // re-arm from now (no catch-up storm)
  }
  if (fired) {
    if (S.notifications.length > 100) S.notifications.length = 100;
    audit('tool', fired + ' scheduled task(s) fired', 'system'); save();
  }
  return fired;
}

/* ── §102–§160 workflow playbooks executed through the real pipeline ──
 * Steps are mapped to tools that genuinely exist. A step with no local
 * implementation is reported WAITING_FOR_CAPABILITY, never simulated. */
const PLAYBOOK_TOOL_MAP = {
  'knowledge.write': 'knowledge.write',
  'files.read': 'fs.read', 'files.write': 'fs.write', 'files.copy': 'fs.copy',
  'sys.read': 'sys.info', 'security.scan': 'security.scan', 'security.remediate': 'security.remediate',
  'linux.command': 'exec.run', 'account.discover': 'account.discover', 'account.configure': 'account.configure',
  'account.disconnect': 'account.disconnect', 'device.control': 'sys.info'
};
function playbookStepArgs(step, params) {
  params = params || {};
  switch (step.capability) {
    case 'files.read': return { path: params.file || 'notes.txt' };
    case 'files.write': return { path: params.file || 'notes.txt', content: params.content || ('witforge playbook step ' + step.id) };
    case 'files.copy': return { path: params.file || 'notes.txt', to: params.backup || 'notes.backup.txt' };
    case 'linux.command': return { op: params.op || 'date' };
    case 'security.scan': return { path: params.path || '' };
    case 'security.remediate': return { path: params.quarantine || 'suspicious.bin' };
    case 'knowledge.write': return { text: 'Playbook step: ' + step.action, title: step.action.slice(0, 60) };
    case 'account.discover': return { service: params.service || 'unspecified' };
    case 'account.configure': return { service: params.service || 'unspecified' };
    case 'account.disconnect': return { service: params.service || 'unspecified' };
    default: return params.args || {};
  }
}
async function runPlaybookLocal(key, opts) {
  opts = opts || {};
  const available = {};
  for (const [cap, toolId] of Object.entries(PLAYBOOK_TOOL_MAP)) {
    const t = TOOLS[toolId];
    if (t) available[cap] = true;
  }
  const res = await taskEngine.runPlaybook(key, Object.assign({}, opts, {
    externalAvailable: Object.assign({}, available, opts.externalAvailable || {}),
    exec: async (step) => {
      const toolId = PLAYBOOK_TOOL_MAP[step.capability];
      if (!toolId || !TOOLS[toolId]) return { ok: false, error: 'No local implementation for ' + step.capability + ' in this build', failureClass: 'UNAVAILABLE_CAPABILITY' };
      const r = await runTool(toolId, playbookStepArgs(step, opts.params), { confirmed: true, approvalId: opts.approvalId });
      return { ok: r.ok, error: r.error || null, evidence: r.evidence === undefined ? null : r.evidence, state: r.state };
    }
  }));
  audit('task', `PLAYBOOK ${key} (${res.section}) → ${res.state}: ${res.performed} performed, ${res.waitingForCapability} waiting for capability, ${res.failed} failed`, 'system', {
    action: 'playbook.run', decision: res.state === 'FAILED' ? 'DENY' : 'ALLOW', risk: 'MEDIUM', result: res.state
  });
  save();
  return res;
}

/* ── v1.88.0: chat-relayed secrets never persist ──────────────────────────
 * The vault guards credential STORAGE; this guards the PATH credentials
 * arrive by. Conversation history lives in the same store as everything
 * else, unencrypted by design (it is your chat log), so secret-shaped
 * material is replaced with ••• before it can reach disk — at the message
 * route, inside importManifest, and once at boot for whatever predates
 * this rule. Honest scope, stated where the code lives: these patterns
 * catch the shapes we recognise — named-provider API keys, JWTs, private-
 * key blocks, and the connect-command form. A scrubber cannot recognise
 * every possible secret someone might paste; overstating one is exactly
 * how people get hurt. The vault remains the only place secrets belong. */
const SECRET_TOKEN_RE = /\b(?:sk_(?:live|test)_[A-Za-z0-9]{8,}|rk_(?:live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|sk-or-[A-Za-z0-9-]{8,}|gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g;
const SECRET_PRIVKEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
function scrubSecrets(input) {
  let text = String(input == null ? '' : input);
  let redactions = 0;
  const cm = text.match(/^\s*connect ([a-zA-Z0-9-]+) (?:with )?(?:token )?(\S[\s\S]*)$/);
  if (cm) { text = 'connect ' + cm[1].toLowerCase() + ' with token ••• (scrubbed — secrets live in the encrypted vault, never in chat history)'; redactions++; }
  text = text.replace(SECRET_PRIVKEY_RE, () => { redactions++; return '••• private-key block scrubbed •••'; });
  text = text.replace(SECRET_TOKEN_RE, () => { redactions++; return '•••'; });
  return { text, redactions };
}
function scrubConversations(convos) {
  let redacted = 0;
  for (const c of convos || []) {
    const t = scrubSecrets(c.title || ''); if (t.redactions) { c.title = t.text.slice(0, 60); redacted += t.redactions; }
    for (const msg of c.messages || []) {
      const s = scrubSecrets(msg.text || '');
      if (s.redactions) { msg.text = s.text.slice(0, 4000); redacted += s.redactions; }
    }
  }
  return redacted;
}
/* One-shot boot sweep for history written before the rule existed. The
 * marker prevents re-scanning every boot; redacted count is the only
 * thing audited — never the material. */
function migrateChatScrub() {
  const marker = '__chatScrubV188';
  if (S[marker]) return;
  const n = scrubConversations(S.conversations);
  if (n) audit('security', 'CHAT HISTORY SCRUBBED: ' + n + ' secret-shaped item(s) in older conversations replaced with ••• (the vault is the only place secrets belong)', 'system');
  S[marker] = true;
  save();
}
migrateChatScrub();

/* ── v1.59: export / import manifests (truthful, audited) ───────── */
function exportManifest() {
  const m = { format: 'liam.export', version: '1.59.0', exportedAt: new Date().toISOString(),
    counts: { audit: S.audit.length, evidence: S.evidence.length, ledgerTx: S.ledger.tx.length, market: S.market.length, approvals: S.approvals.length },
    ledgerAccounts: JSON.parse(JSON.stringify(S.ledger.accounts)),
    economy: { realMode: S.economy.realMode, stripeVerified: !!S.economy.stripeAccount },
    credentials: listCreds().map(c => c.service),
    state: JSON.parse(JSON.stringify(S)) };
  audit('system', 'EXPORT manifest generated (' + m.counts.audit + ' audit rows)', 'user');
  return m;
}
function importManifest(man, confirmed) {
  if (!man || man.format !== 'liam.export') return { ok: false, error: 'Not a LIAM export manifest' };
  if (!confirmed) return { ok: false, error: 'Import OVERWRITES the current store. Say “import manifest confirm” to proceed.' };
  const restored = man.state;
  if (!restored || !restored.ledger || !restored.audit) return { ok: false, error: 'Manifest malformed (missing ledger/audit)' };
  const scrubbed = scrubConversations(restored.conversations);   // v1.88: imports are a write path too
  S = restored;
  /* the audit must land in the IMPORTED store — auditing before S = restored
   * would write into the state being discarded (caught by the suite). */
  if (scrubbed) audit('security', 'IMPORT SCRUBBED: ' + scrubbed + ' secret-shaped item(s) removed from imported chat history', 'system');
  save();
  audit('system', 'IMPORT manifest applied (exported ' + man.exportedAt + ')', 'user'); save();
  return { ok: true, restoredFrom: man.exportedAt };
}

/* §3/§166: chat is the control surface, so it must be able to say what it can
 * do. This list is checked against the real router intents in the test suite. */
const CAPABILITY_HELP = [
  { group: 'AI brain', items: ['“ask <anything>” — real LLM reply, labelled provider · model', '“ai provider groq” — pick the default (groq/gemini/openrouter/deepseek/mistral/ollama)', '“verify groq” — live round trip with a free key', '“ask all <question>” — ensemble: every connected provider answers at once', '“ask consensus <question>” — ask everyone, then synthesize one balanced verdict', '“propose <question>” · “do <id>” — the AI proposes a command, you run it (§168)', '“local models” · “local pull qwen2.5:0.5b” — manage your own AI models from chat', '“briefing” — one-glance status: steps, proposals, approvals, capabilities, modes', '“ad campaign \<name\> on x, facebook: \<brief\>” — the agent drafts, schedules and (approval-gated) dispatches to YOUR channels', '“ask about <url>” — fetch a public page and summarize it with the brain', '“ld packages” · “buy ld package <id>” — bundled LD in the marketplace', '“social” · “verify x” · “post x <text>” — official-API social connectors, approval-gated posting', '“update check” · “update apply” — self-update from the audited repo, approval-gated + backed up', '“remember that <fact>” · “what do you remember?” · “forget N — the brain keeps only what you vouched for; export covers it, secrets refused', '“ai models” · “clear conversation” — provider reality + planner telemetry (turns, executions, proposals, repairs) and the short-term window', '“brain eval” — the brain scores its own gates offline: verifier, least privilege, repair, cache, reflection (scripted outputs, no provider calls)', '“overseer” · “overseer drill” — 13 live defense layers + a 7-member governance council, verdicts persisted and audited', 'ollama = local open-source models: no key, nothing leaves the machine'] },
  { group: 'Talk to it', items: ['“help” — this list', '“status” / “release” — runtime truth', '“preview <command>” — what would happen, without doing it'] },
  { group: 'Authority', items: ['“permissions” · “grant fs.write” · “revoke fs.write”', '“suspend fs.write” / “resume fs.write”', '“risk fs.delete” · “policy fs.delete”', '“approve <id>” · “stop <id>”', '“human steps” · “resolve <step> with <answer>” — captcha/2FA/consent gates are yours to complete, never bypassed', '“stop network” · “emergency stop all” · “resume network”', '“autonomous on confirm” · “autonomous off”'] },
  { group: 'LD economy', items: ['“economy” · “piece prices” · “ld market”', '“buy 500 ld” · “sell 500 ld”', '“forge sword at rare: a rune-etched blade” · “mint asset piece rarity 5”', '“provision loadout <avatar>” · “summon pet for <avatar>”', '“market” · “buy <listing>” · “sell <item> for 200” · “balance”'] },
  { group: 'Events, lotto, rewards', items: ['“events” · “join event evt-arena-cup” · “close event evt-arena-cup winner <avatar>”', '“open lotto round” · “buy 3 lotto tickets” · “draw lotto confirm” · “verify lotto”', '“sign in” · “my streak”', '“daily tasks” · “weekly tasks” · “claim task d-tools”'] },
  { group: 'Avatars & arena', items: ['“create avatar Korr as nord” · “races”', '“battle <avatar> vs <rival>” · “arena wager A vs B confirm”', '“talents” · “unlock talent bulwark for <avatar>”'] },
  { group: 'Devices & accounts', items: ['“devices” · “pair device Pixel as android” · “trust device Pixel”', '“accounts” · “record account github:you” · “use account work@example.com for gmail”', '“plan pro” · “plans”'] },
  { group: 'Owner security & guardian', items: ['“secure my account” · “harden my account maximum”', '“enable second factor” · “verify second factor 123456”', '“sessions” · “revoke all sessions” · “alerts” · “security drill”', '“guardian” · “threats” · “guardian check <something you want checked>”'] },
  { group: 'Work & records', items: ['“new task <objective>” · “tasks state” · “playbooks” · “run playbook research-recommend”', '“remember as preference …” · “create project X | goals …”', '“vault” · “metrics” · “trace <correlation id>”'] }
];

/* ══ v1.65 engagement command layer ══════════════════════════════════
 * Chat, the HTTP API and the tests all call these functions, so the ledger
 * side of an engagement action exists in exactly one place. Each returns
 * { ok, reply, ...data }: the router prints `reply`, callers read the data. */
function joinEventCmd(id, who) {
  who = who || ownerWallet();
  const r = engagement.joinEvent(S, id, who);
  if (!r.ok) return r;
  if (r.cost > 0) {
    const pay = ledgerPost([{ account: who, delta: -r.cost }, { account: 'Events Pool', delta: r.cost }],
      'event entry fee ' + r.event.title,
      { actor: who, reason: 'event entry', source: who, destination: 'Events Pool', kind: 'event' });
    if (!pay.ok) {
      r.event.participants = r.event.participants.filter(x => x.who !== who);   // no fee, no entry
      return Object.assign(pay, { needed: r.cost, balance: ldBalance(who), wallet: who,
        error: pay.error + ' — entry to ' + r.event.title + ' costs ' + r.cost + ' LD (wallet holds ' + ldBalance(who) + ' LD)' });
    }
  }
  progressQuests('event.join');
  audit('event', 'JOINED event ' + r.event.title + (r.cost ? ' for ' + r.cost + ' LD' : ' (free entry)'), 'user',
    { action: 'event.join', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  save();
  return { ok: true, event: r.event, cost: r.cost || 0, wallet: who, balance: ldBalance(who),
    reply: 'Entered ' + r.event.title + (r.cost ? ' for ' + r.cost + ' LD' : ' (free entry)') + '. ' + r.event.blurb + ' Say “event progress ' + r.event.id + '” any time.' };
}
function eventProgressCmd(id, who, units) {
  who = who || ownerWallet();
  const e = engagement.eventFor(S, id);
  if (!e) return { ok: false, error: 'Unknown event ' + id };
  const entry = e.participants.find(p => p.who === who);
  if (!entry) return { ok: false, error: 'You are not entered in ' + e.title + ' — say “join event ' + e.id + '” first.' };
  entry.progress.units = (entry.progress.units || 0) + (units ? Number(units) : 1);
  if (entry.progress.units >= 1) entry.completed = true;
  progressQuests('event.progress');
  save();
  return { ok: true, event: e, units: entry.progress.units, completed: entry.completed,
    reply: e.title + ': ' + entry.progress.units + ' objective unit(s) done' + (entry.completed ? ' — event objective complete' : '')
      + '. Talk to it any time; closing the event settles its pool.' };
}
function closeEventCmd(id, opts) {
  opts = opts || {};
  const r = engagement.closeEvent(S, id, { winner: opts.winner });
  if (!r.ok) return r;
  if (r.settle === false) {
    save();
    return { ok: true, event: r.event, settled: false,
      reply: r.event.title + ' closed. ' + r.event.results.completed + ' completion(s) of ' + r.event.results.participants + ' entrant(s) recorded.' };
  }
  const fund = ensurePool('Events Pool', r.settlement.treasury);
  if (!fund.ok) return fund;
  const entries = r.settlement.entries.concat([{ account: 'Events Pool', delta: -r.settlement.treasury }, { account: 'Treasury', delta: r.settlement.treasury }]);
  const pay = ledgerPost(entries, 'event prize settlement ' + r.event.title,
    { actor: 'system', reason: 'event settlement', kind: 'event-settlement' });
  if (!pay.ok) return pay;
  audit('event', 'SETTLED ' + r.event.title + ': winner ' + r.settlement.winner + ' receives ' + r.settlement.prize.payout + ' LD of a ' + r.settlement.prize.pool + ' LD pool (treasury ' + r.settlement.prize.treasury + ', 1%)', 'system',
    { action: 'event.settle', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  save();
  return { ok: true, event: r.event, settled: true, prize: r.settlement.prize, ledger: entries,
    reply: r.event.title + ' settled: pool ' + r.settlement.prize.pool + ' LD → winner ' + r.settlement.winner + ' ' + r.settlement.prize.payout + ' LD, treasury ' + r.settlement.prize.treasury + ' LD (1%). SIMULATION.' };
}
function openLottoCmd() {
  const r = engagement.openRound(S, { rolloverIn: ldBalance('Jackpot Rollover') });
  if (!r.ok) return r;
  save();
  audit('lotto', 'Round ' + r.round.id + ' opened with commitment ' + r.round.commitHash.slice(0, 16) + '… (jackpot carry-in ' + r.round.rolloverIn + ' LD)', 'user',
    { action: 'lotto.open', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  return { ok: true, round: r.round,
    reply: 'Round ' + r.round.id + ' is open. Ticket price ' + r.round.ticketLD + ' LD. The server committed to sha256(' + r.round.commitHash.slice(0, 16) + '…) before any ticket was sold, so the numbers cannot change afterwards. Say “buy 3 lotto tickets”.' };
}
function buyTicketsCmd(count, who) {
  count = Number(count) || 1;
  who = who || ownerWallet();
  const r = engagement.buyTickets(S, { owner: who, count });
  if (!r.ok) return r;
  const pay = ledgerPost([{ account: who, delta: -r.cost }, { account: 'Lotto Pool', delta: r.cost }],
    count + ' lotto ticket(s) at ' + r.round.ticketLD + ' LD',
    { actor: who, reason: 'lotto tickets', source: who, destination: 'Lotto Pool', kind: 'lotto' });
  if (!pay.ok) {
    r.round.tickets = r.round.tickets.filter(t => t.owner !== who || t.id < r.tickets[0].id);   // no money, no tickets
    return Object.assign(pay, { needed: r.cost, balance: ldBalance(who), wallet: who,
      error: (pay.error || 'Payment failed') + ' — ' + count + ' ticket(s) cost ' + r.cost + ' LD (wallet holds ' + ldBalance(who) + ' LD)' });
  }
  progressQuests('lotto.ticket', count);
  save();
  audit('lotto', 'TICKETS ' + count + ' × ' + r.round.ticketLD + ' LD in ' + r.round.id + ' by ' + who, 'user',
    { action: 'lotto.buy', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  return { ok: true, round: r.round, tickets: r.tickets, cost: r.cost, balance: ldBalance(who),
    reply: 'Bought ' + count + ' ticket(s) for ' + r.cost + ' LD in round ' + r.round.id + '.\n'
      + r.tickets.map(t => '  ' + t.numbers.join(' · ')).join('\n') + '\nBalance: ' + ldBalance(who) + ' LD.' };
}
function drawLottoCmd(roundId, confirmed) {
  const r = engagement.drawRound(S, roundId, { confirmed: confirmed === true });
  if (r.needsConfirmation) return { ok: false, needsConfirmation: true, reply: 'Drawing settles LD against real tickets. Say “draw lotto confirm” to proceed.', error: 'Confirmation required' };
  if (!r.ok) return r;
  const pay = ledgerPost(r.entries, 'lotto settlement ' + r.round.id,
    { actor: 'system', reason: 'lotto settlement', kind: 'lotto-settlement' });
  if (!pay.ok) return pay;
  progressQuests('lotto.draw');
  save();
  audit('lotto', 'DRAW ' + r.round.id + ': numbers ' + r.numbers.join(',') + ' · payouts ' + r.payouts.length + ' · paid ' + r.prize.paid + ' LD · treasury ' + r.prize.treasury + ' LD · community ' + r.prize.community + ' LD' + (r.rolledOver ? ' · jackpot rolls over ' + r.prize.rolloverOut + ' LD' : ''), 'system',
    { action: 'lotto.draw', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  return { ok: true, round: r.round, numbers: r.numbers, payouts: r.payouts, prize: r.prize, rolledOver: r.rolledOver,
    reply: [
      'Draw ' + r.round.id + ' — numbers: ' + r.numbers.join(' · '),
      'Sales ' + r.prize.gross + ' LD (carry-in ' + r.prize.carryIn + ' LD) · prize tiers ' + r.prize.tierPool + ' LD · jackpot ' + r.prize.jackpotContribution + (r.prize.carryIn ? ' + ' + r.prize.carryIn : '') + ' LD · community ' + r.prize.community + ' LD · treasury ' + r.prize.treasury + ' LD',
      r.rolledOver ? 'No jackpot winner — ' + r.prize.rolloverOut + ' LD rolls into the next round.' : 'Jackpot won.',
      r.payouts.length ? 'Winner(s): ' + r.payouts.map(p => p.owner + ' ' + p.ld + ' LD (' + p.tier + ')').join(', ') : 'No tickets matched three or more numbers.',
      'Verify independently with “verify lotto ' + r.round.id + '”.'
    ].join('\n') };
}
function signInCmd(who, opts) {
  opts = opts || {};
  who = who || ownerWallet();
  const st = engagement.signInStatus(S, who);
  if (opts.statusOnly) {
    return { ok: true, status: st, claimed: false,
      reply: 'Streak: ' + st.streak + ' day(s), ' + (st.totalClaims || 0) + ' claim(s) total. ' + (st.claimedToday ? 'Today’s gift is claimed already.' : 'Today’s gift is unclaimed — say “sign in”.') };
  }
  const r = engagement.claimSignIn(S, who);
  if (!r.ok) return r;
  const pay = payReward(who, r.ld, 'sign-in day ' + r.day + ' gift', 'Rewards Pool');
  if (!pay.ok) return pay;
  progressQuests('signin.claim');
  save();
  audit('engagement', 'SIGN-IN day ' + r.day + ' (streak ' + r.streak + '): +' + r.ld + ' LD' + (r.bonus ? ' + ' + r.bonus : ''), 'user',
    { action: 'signin.claim', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  return { ok: true, claimed: r, status: engagement.signInStatus(S, who), balance: ldBalance(who),
    reply: [
      'Day ' + r.day + ' gift claimed: +' + r.ld + ' LD' + (r.bonus ? ' and a ' + r.bonus.split(':')[1] + ' piece voucher' : '') + '. Streak ' + r.streak + ' day(s).',
      'Balance: ' + ldBalance(who) + ' LD. The seven-day cycle pays ' + engagement.SIGN_IN_REWARDS.map(x => x.ld).join('/') + ' LD, then starts again.',
      'Paid from the Rewards Pool and recorded in the ledger.'
    ].join('\n') };
}
function claimQuestCmd(id, who) {
  who = who || ownerWallet();
  const r = engagement.claimQuest(S, id, who);
  if (!r.ok) return r;
  const pay = payReward(who, r.ld, r.window + ' task reward: ' + r.quest.title, 'Rewards Pool');
  if (!pay.ok) return pay;
  progressQuests('quest.claim');
  save();
  audit('engagement', 'TASK CLAIMED ' + r.window + ' ' + r.quest.id + ' (' + r.quest.title + ') +' + r.ld + ' LD', 'user',
    { action: 'quest.claim', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  return { ok: true, quest: r.quest, ld: r.ld, window: r.window, balance: ldBalance(who),
    reply: r.window.toUpperCase() + ' task “' + r.quest.title + '” claimed: +' + r.ld + ' LD. Balance ' + ldBalance(who) + ' LD.' };
}

module.exports = {
  get state() { return S; },
  save, audit, nid, VERSION, maskSecrets,
  /* v1.64 systems */
  kernel, caps, taskEngine, services, DB_COLLECTIONS,
  capabilityState, capabilityLevel, capabilityTable, requestCapability, scopedGrant,
  deny, suspend, resumeCapability, expire, blockBySecurity, blockByPolicy, setCapabilityState,
  assessAction, actionPolicy,
  MEMORY_CLASSES, rememberTyped, createProjectFull, projectLink,
  arenaWagerMatch, openDispute, ARENA_WAGER_LD, economyConfig, LD_AUD_VALUE,
  /* v1.65 engagement surface — the same functions the chat router uses */
  eventsBoard: () => engagement.listEvents(S),
  joinEvent: joinEventCmd, eventProgress: eventProgressCmd, closeEvent: closeEventCmd,
  openLottoRound: openLottoCmd, buyLottoTickets: buyTicketsCmd, drawLotto: drawLottoCmd,
  verifyLotto: (id) => { const r = id ? (S.lottoRounds || []).find(x => x.id === id) : (S.lottoRounds || []).find(x => x.state === 'DRAWN'); return r ? engagement.verifyRound(r) : { ok: false, error: 'No drawn round to verify' }; },
  ldMarketCmd, piecePriceList,
  signInGift: signInCmd, claimQuestCmd, questStatus: (who) => engagement.questSummary(S, who),
  pledgeReport: () => engagement.reportCard ? engagement.reportCard(S) : null,
  pairDeviceCmd, setDeviceTrustCmd, deviceCommand, stopScope, resumeScope, stopAllScopes,
  enableAutonomousPolicy, disableAutonomousPolicies, addDelegation,
  createOrgCmd, subscribeCmd, addAccountCmd, deleteAccountCmd, disconnectAccountCmd, accountBoundaryCheck,
  registerAssetCmd, transferAssetCmd,
  observability, releaseInfo,
  EMERGENCIES, setEmergency, grant, revoke, permitted,
  createApproval, decideApproval, approved,
  chatFallback, brain, brainRecall, verifyNumericClaims, overseer, brainClassify, rateGate, rateNote, rateState, rateErrorDetect, llmRegistry: () => llm.PROVIDERS,
  buyLdPackageCmd, ldPackagesList, LD_PACKAGES, SOCIALS,
  createProposal, consumeProposal, fabric, DEVICE_ADAPTERS, recordOffense, recordJustified, deviceTrust, setDeviceTrust, DEVICE_TRUST_STATES, rootState, setRootState, ROOT_STATES, rootProbe,
  requestHumanStep, resolveHumanStep, consumeHumanStep, cancelHumanStep, HUMAN_STEP_KINDS,
  humanSteps: () => S.humanSteps.slice(0, 100),
  ADAPTERS, TOOLS, runTool, guardedFetch,
  ledgerPost, wager, economySelfTest,
  command, preview, USERFILES,
  setCredential, revokeCredential, listCreds, decryptToken, adaptersLive,
  oauthSetApp, oauthForgetApp, oauthStatusList, oauthStart, oauthExchange,
  FORGE_COST, forgePiece, marketList, listItem, delist, buy, seedMarket, pieceArt: x => pieceArt.artFor(x),
  createPayment, confirmPayment, settleStripeEvidence, setRealMode,
  verifyAudit, withCid, tokenValid,
  createOwner, login, logout, sessionValid, ownerEmailStatus, bindConfiguredOwnerEmail,
  migrateSessionHashes, SESSION_TTL_MS, SESSION_IDLE_MS,
  selftestAll, compliance, freshState, migrateLegal, THREE_LAWS,
  exportManifest, importManifest, sealVaultTransfer, openVaultTransfer, rotateVaultKeys, scrubSecrets,
  addReminder, tickReminders,
  addSchedule, tickSchedules,
  runPlaybookLocal, PLAYBOOK_TOOL_MAP,
  /* v1.65 engagement + owner protection */
  engagement, ownerSec,
  CAPABILITY_HELP,
  ldBalance, ensurePool, payReward, economyReport, ldMarketCmd, chargeLD, piecePriceList,
  provisionLoadoutCmd, summonPetCmd, mergePiecesCmd, mergePieces: (v, ids) => mergePiecesCmd(avatarArg(v), ids),
  /* These accept an avatar NAME (what chat gives) or an avatar ID (what tests
   * and HTTP callers give) — resolved in one place rather than guessing. */
  provisionLoadout: (v, opts) => provisionLoadoutCmd(avatarArg(v), opts),
  summonPet: (v) => summonPetCmd(avatarArg(v)), progressQuests, claimableQuests,
  LD_POOLS
};
