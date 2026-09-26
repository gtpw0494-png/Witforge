/* Patch 1 for platform.js: requires, state, audit, permission kernel, executor. */
'use strict';
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'platform.js');
let s = fs.readFileSync(f, 'utf8');
let n = 0;
function rep(old, neu, label) {
  if (!s.includes(old)) { console.error('MISS: ' + label); process.exitCode = 1; return; }
  s = s.replace(old, neu); n++;
  console.log('ok: ' + label);
}

/* ── 1. requires + version ─────────────────────────────────────── */
rep(`const crypto = require('crypto');
`,
`const crypto = require('crypto');
const kernel = require('./kernel.js');
const caps = require('./capabilities.js');
const taskEngine = require('./task-engine.js');
const services = require('./platform-services.js');

const VERSION = '1.64.0';
`, 'requires');

/* ── 2. fresh state collections ────────────────────────────────── */
rep(`    reminders: [], notifications: [], schedules: [],
    seq: 1
  };
}`,
`    reminders: [], notifications: [], schedules: [],
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
    seq: 1
  };
}`, 'fresh state');

/* ── 3. legal documents required by §94 ────────────────────────── */
rep(`    mk('ai', 'AI Policy', 'AI proposes; never authority; provider output untrusted.')
  ];`,
`    mk('ai', 'AI Policy', 'AI proposes; never authority; provider output untrusted.'),
    mk('delegation', 'Capability Delegation Terms', 'Act-on-my-behalf is bounded to the listed capabilities and scope; unrelated accounts, devices and security-sensitive operations stay excluded (§11).'),
    mk('accounts', 'Account Terms', 'Account lifecycle operations use provider interfaces only; human-required steps (CAPTCHA, identity, phone) are completed by the user (§130–§139).'),
    mk('marketplace', 'Marketplace Terms', 'Authorized asset exchange only: ownership verification, anti-fraud, transaction integrity, applicable legal controls and user authorization (§84).'),
    mk('economic', 'Economic Terms', '100 LD = A$1.00 reference. Simulation is labelled SIMULATION; real money stays locked until every licensing, regulatory and identity requirement is satisfied (§87–§92).'),
    mk('arena', 'Arena Terms', 'Wagers escrow 100 LD per participant (pool 200 LD); settlement pays the winner 198 LD and the treasury 2 LD (1%). Real-money wagering is compliance-locked (§85–§90).')
  ];`, 'legal docs');

/* ── 4. backfill on load ───────────────────────────────────────── */
rep(`const nid = p => p + (S.seq++).toString(36) + Date.now().toString(36);`,
`for (const k of ['stops', 'devices', 'deviceCommands', 'seenCommandIds', 'taskHandoffs', 'accounts', 'activeAccounts', 'orgs', 'assets', 'disputes', 'fraudEvents', 'offlineQueue', 'metrics', 'spans', 'autonomousPolicies', 'delegations', 'evidenceVault', 'taskRecords']) {
  if (S[k] === undefined || S[k] === null) S[k] = (k === 'stops' || k === 'seenCommandIds' || k === 'activeAccounts') ? {} : [];
}
if (S.subscription === undefined) S.subscription = null;
if (S.release === undefined) S.release = null;
// §10: existing grants from earlier stores are normalised into the state model.
for (const [cap, rec] of Object.entries(S.permissions || {})) {
  if (!rec.state) { rec.state = 'GRANTED'; rec.level = rec.level || 'EXECUTE'; rec.scopes = rec.scopes || {}; rec.model = 'kernel/1.64'; }
}
const nid = p => p + (S.seq++).toString(36) + Date.now().toString(36);`, 'backfill');

/* ── 5. audit(): §96-shaped records, same tamper-evident chain ─── */
rep(`function audit(type, detail, actor) {
  const prev = S.audit[0] ? S.audit[0].hash : 'GENESIS';
  const e = { ts: Date.now(), type, detail: String(detail).slice(0, 300), actor: actor || 'user', cid: currentCid || 'ui' };
  e.hash = crypto.createHash('sha256').update(prev + '|' + e.ts + '|' + e.type + '|' + e.detail + '|' + e.actor).digest('hex');
  S.audit.unshift(e);
  if (S.audit.length > 600) S.audit.length = 600;
  save();
}`,
`/* §96: every consequential operation produces a structured audit record.
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
  if (S.audit.length > 600) S.audit.length = 600;
  save();
  return e;
}
/* Secrets are masked/excluded before an audit detail is written (§96). */
function maskSecrets(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/(sk_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1…[masked]')
    .replace(/(ghp_[A-Za-z0-9]{4})[A-Za-z0-9]+/g, '$1…[masked]')
    .replace(/((?:token|password|secret|api[_-]?key)"?\\s*[:=]\\s*"?)([^"\\s,}]{4})[^"\\s,}]*/gi, '$1$2…[masked]');
}`, 'audit');

/* ── 6. permission kernel ──────────────────────────────────────── */
rep(`/* ── Permissions: the user's request is the grant ─────── */
function signToken(cap, id, exp) {
  return crypto.createHmac('sha256', S.secret).update(cap + '|' + id + '|' + exp).digest('hex');
}
function grant(cap, how) {
  const id = 'tk' + (S.seq++).toString(36), exp = Date.now() + 3600e3;
  S.permissions[cap] = { level: 'granted', grantedBy: how || 'user-request', ts: Date.now(), token: { id, exp, sig: signToken(cap, id, exp) } };
  audit('permission', \`PERMISSION GRANTED \${cap} (\${S.permissions[cap].grantedBy}) token \${id} expires 1h\`, 'user');
  save();
}
function revoke(cap) { delete S.permissions[cap]; audit('permission', 'PERMISSION REVOKED ' + cap, 'user'); save(); }
const permitted = cap => !!S.permissions[cap];
function tokenValid(cap) {
  const p = S.permissions[cap]; if (!p || !p.token) return false;
  if (Date.now() > p.token.exp) return false;
  return signToken(cap, p.token.id, p.token.exp) === p.token.sig;
}`,
`/* ── Permissions: §9 states, §10 levels, §46 scoped tokens ──────
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
  audit('permission', opts.detail || \`PERMISSION \${t.from} → \${t.to}: \${cap}\${opts.reason ? ' (' + opts.reason + ')' : ''}\`, opts.actor || 'user', {
    capability: cap, decision: t.to, reason: opts.reason || null, risk: out.risk, approval: opts.approval || null,
    result: t.to === 'GRANTED' ? 'SUCCEEDED' : 'BLOCKED'
  });
  save();
  return { ok: true, capability: cap, state: t.to, record: out, from: t.from };
}
function requestCapability(cap, opts) {
  opts = opts || {};
  const level = opts.level || RISK_LEVEL_DEFAULT[String(capRisk(cap)).toLowerCase()] || 'EXECUTE';
  if (!capabilityRecord(cap)) setCapabilityState(cap, 'REQUESTED', { detail: 'PERMISSION REQUESTED ' + cap, reason: opts.reason || 'capability needed for the request' });
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
  audit('permission', \`PERMISSION GRANTED \${cap} (\${r.record.grantedBy}) level \${level} token \${token.id} expires \${new Date(token.exp).toISOString()}\`, 'user',
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
}`, 'permissions');

/* ── 7. ledger entries carry the §89 fields ────────────────────── */
rep(`function ledgerPost(entries, memo) {
  const sum = entries.reduce((n, e) => n + e.delta, 0);
  if (sum !== 0) return { ok: false, error: 'Unbalanced entry rejected (debits must equal credits)' };
  for (const e of entries) {
    if (!(e.account in S.ledger.accounts)) S.ledger.accounts[e.account] = 0;
    if (S.ledger.accounts[e.account] + e.delta < 0) return { ok: false, error: 'Negative balance prevented on ' + e.account };
  }
  for (const e of entries) S.ledger.accounts[e.account] += e.delta;
  S.ledger.tx.unshift({ id: nid('tx'), ts: Date.now(), entries, memo, mode: 'SIMULATION' });
  save();
  return { ok: true };
}`,
`/* §89: every transaction records debit, credit, id, timestamp, actor, reason,
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
}`, 'ledger');

/* ── 8. wager uses the extended ledger with attributed meta ────── */
rep(`  const hold = ledgerPost([{ account: playerA, delta: -amount }, { account: 'Arena Escrow', delta: amount }], 'wager hold ' + playerA);
  if (!hold.ok) return hold;
  const hold2 = ledgerPost([{ account: playerB, delta: -amount }, { account: 'Arena Escrow', delta: amount }], 'wager hold ' + playerB);
  if (!hold2.ok) return hold2;
  const pool = amount * 2, treasury = Math.round(pool * 0.01), winner = pool - treasury;
  const settle = ledgerPost([{ account: 'Arena Escrow', delta: -pool }, { account: settleTo, delta: winner }, { account: 'Treasury', delta: treasury }], 'wager settlement');`,
`  const hold = ledgerPost([{ account: playerA, delta: -amount }, { account: 'Arena Escrow', delta: amount }], 'wager hold ' + playerA, { actor: playerA, reason: 'arena wager hold', destination: 'Arena Escrow', kind: 'wager' });
  if (!hold.ok) return hold;
  const hold2 = ledgerPost([{ account: playerB, delta: -amount }, { account: 'Arena Escrow', delta: amount }], 'wager hold ' + playerB, { actor: playerB, reason: 'arena wager hold', destination: 'Arena Escrow', kind: 'wager' });
  if (!hold2.ok) return hold2;
  const pool = amount * 2, treasury = Math.round(pool * 0.01), winner = pool - treasury;
  const settle = ledgerPost([{ account: 'Arena Escrow', delta: -pool }, { account: settleTo, delta: winner }, { account: 'Treasury', delta: treasury }], 'wager settlement', { actor: 'arena', reason: 'wager settlement (1% treasury)', source: 'Arena Escrow', destination: settleTo + ' + Treasury', kind: 'wager-settlement' });`, 'wager meta');

/* ── 9. executor pipeline ──────────────────────────────────────── */
rep(`/* ── Tool execution pipeline: policy → permission → approval → run → audit */
async function runTool(toolId, args, opts) {
  opts = opts || {};
  const tool = TOOLS[toolId];
  if (!tool) return { ok: false, state: 'FAILED', error: 'Unknown tool ' + toolId };
  if (S.emergency === 'LOCKDOWN' && tool.risk !== 'low') { audit('security', 'LOCKDOWN blocked ' + toolId, 'system'); return { ok: false, state: 'BLOCKED', error: 'LOCKDOWN: execution blocked (security policy)', blocked: 'lockdown' }; }
  if (S.emergency === 'HIGH' && tool.risk === 'medium' && !opts.confirmed && !S.autonomous) {
    const ap = createApproval(tool.cap, 'Run ' + toolId + ' during HIGH emergency');
    return { ok: false, state: 'BLOCKED', needsApproval: ap.id, error: 'HIGH emergency: explicit approval required for ' + toolId };
  }
  if (!tokenValid(tool.cap)) {
    if (tool.risk === 'low' || tool.risk === 'medium') grant(tool.cap, S.autonomous ? 'autonomous-mode' : 'user-request');
    else { const ap = createApproval(tool.cap, 'Grant+run high-risk ' + toolId); return { ok: false, state: 'BLOCKED', needsApproval: ap.id, error: 'High-risk capability requires approval (approve ' + ap.id + ')' }; }
  }
  audit('tool', \`EXEC \${toolId} \${JSON.stringify(args || {}).slice(0, 140)}\`, 'user');
  const out = await tool.run(args || {});
  const state = out.error ? (out.blocked ? 'BLOCKED' : 'FAILED') : 'SUCCEEDED';
  audit('tool', \`RESULT \${toolId}: \${state}\${out.error ? ' ' + out.error : ''}\`, 'system');
  if (state === 'SUCCEEDED') {
    S.evidence.unshift({ ts: Date.now(), tool: toolId, cid: currentCid || 'ui', sha256: crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex') });
    if (S.evidence.length > 200) S.evidence.length = 200;
    save();
  }
  return { ok: !out.error, state, tool: toolId, evidence: out };
}`,
`/* ── §42 execution pipeline ──────────────────────────────────────
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
  f.deviceImpact = /device|exec|termux|adb|shizuku|linux\\./.test(toolId) ? 2 : 0;
  f.externalVisibility = /publish|upload|post|email|send|share|youtube/.test(toolId) ? 3 : (t.network ? 1 : 0);
  f.securityImpact = /security|credential|permission|grant|revoke|emergency/.test(toolId) ? 3 : 0;
  f.legalImpact = /publish|upload|send|share|delete|account/.test(toolId) ? 2 : 0;
  f.dataSensitivity = /fs\\.|github|credential|memory/.test(toolId) ? 2 : 0;
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
  const { assessment, decision, ctx } = actionPolicy(toolId, args, opts);
  const base = {
    ok: false, tool: toolId, toolId, correlationId: cid, manifest,
    risk: { class: assessment.class, score: assessment.score, factors: assessment.factors, explanation: assessment.explanation },
    policy: decision
  };
  const finish = (extra) => {
    const res = Object.assign({}, base, extra);
    services.endSpan(S, span, res.state || 'UNKNOWN', { risk: assessment.class, decision: decision.decision });
    services.metric(S, 'tool.' + toolId + '.calls', 1, { state: res.state });
    return res;
  };

  /* §55/§56 emergency stop and hierarchy, before anything else runs. */
  if (kernel.isStopped(S, 'network', null) && tool.network) {
    audit('security', 'STOP(network) blocked ' + toolId, 'system', { capability: tool.cap, decision: 'BLOCK', reason: 'network execution stopped by user', risk: assessment.class, result: 'BLOCKED' });
    return finish({ state: 'BLOCKED', blocked: 'stop-network', error: 'Network execution is stopped. Resume with “resume network”.', evidence: { error: 'network stop active', blocked: 'stop-network' } });
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
    audit('policy', maskSecrets(\`POLICY \${decision.decision} \${toolId} via \${decision.policyId}: \${decision.reason}\`), 'system', {
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
      const ap = createApproval(tool.cap, \`\${assessment.class}-risk approval for \${toolId}\`);
      return finish({ state: 'WAITING_FOR_APPROVAL', needsApproval: ap.id, error: assessment.class + ' risk: approval required (approve ' + ap.id + ')', evidence: { error: 'approval required', needsApproval: ap.id, risk: assessment.class } });
    }
  }
  if (!tokenValid(tool.cap)) {
    if (String(tool.risk).toLowerCase() === 'low' || String(tool.risk).toLowerCase() === 'medium') requestCapability(tool.cap, { how: S.autonomous ? 'autonomous-mode' : 'user-request' });
  }

  audit('tool', maskSecrets(\`EXEC \${toolId} \${JSON.stringify(args || {}).slice(0, 140)}\`), 'user', {
    capability: tool.cap, decision: 'ALLOW', risk: assessment.class, result: 'EXECUTING', approval: opts.approvalId || null
  });
  const t0 = Date.now();
  let out;
  try { out = await tool.run(args); } catch (e) { out = { error: 'Tool threw: ' + e.message }; }
  const failureClass = out.error ? taskEngine.classifyFailure(out) : null;
  const state = out.error ? (out.blocked ? 'BLOCKED' : (out.partial ? 'PARTIALLY_SUCCEEDED' : 'FAILED')) : 'SUCCEEDED';
  const correction = failureClass ? taskEngine.correctionPlan(out) : null;
  const verification = out.error ? { method: tool.verification || 'result inspection', result: 'no success evidence' }
    : (typeof tool.verify === 'function' ? tool.verify(out) : { method: tool.verification || 'structured result', result: 'result accepted as evidence' });
  const evidenceHash = caps.structuredResultHash(out);
  audit('tool', maskSecrets(\`RESULT \${toolId}: \${state}\${out.error ? ' ' + out.error : ''}\`), 'system', {
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
}`, 'executor');

fs.writeFileSync(f, s);
console.log(n + ' replacements applied');
