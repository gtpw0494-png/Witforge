'use strict';
/* WitForge security kernel — the authority layer that surrounds execution.
 *
 * Implements the normative systems of the master specification that the
 * platform previously approximated:
 *   §9   Universal permission system (9 states, 12 scope dimensions)
 *   §10  Permission levels (OBSERVE / ASSIST / EXECUTE / AUTONOMOUS / RESTRICTED)
 *   §11  Act-on-my-behalf bounded delegation
 *   §12  Autonomous mode as a bounded policy object, never a boolean
 *   §44  Policy engine (ALLOW / DENY / ASK / ESCALATE / BLOCK)
 *   §46  Scoped capability tokens (10 bound fields, revocable, policy-versioned)
 *   §51  Risk engine (12 factors → 5 classifications)
 *   §52  Human approval matrix (PROHIBITED must never execute)
 *   §55  Emergency stop across 7 scopes
 *   §56  Emergency control hierarchy
 *   §96  Audit record shape (15 fields)
 *   §148 Data authority model (external content can never outrank authority)
 *
 * The kernel is pure: it never touches the filesystem, the network or the
 * model. Callers pass state in and persist the returned records themselves.
 */
'use strict';
const crypto = require('crypto');

/* ── §9 Permission system ─────────────────────────────────────────── */

const PERMISSION_STATES = [
  'NOT_REQUESTED',       // default: nothing has been asked for
  'REQUESTED',           // asked, awaiting a decision
  'GRANTED',             // authorised and currently usable
  'DENIED',              // explicitly refused by the user
  'EXPIRED',             // granted, but the authorization window closed
  'REVOKED',             // withdrawn after being granted
  'SUSPENDED',           // user-paused: reversible, does not imply refusal
  'BLOCKED_BY_SECURITY', // the security layer refuses it (lockdown/threat)
  'BLOCKED_BY_POLICY'    // policy refuses it (jurisdiction/legal/prohibited)
];

const SCOPE_DIMENSIONS = [
  'user', 'agent', 'task', 'project', 'application', 'account',
  'device', 'resource', 'action', 'time', 'purpose', 'environment'
];

const DEFAULT_POLICY_VERSION = 'witforge-policy/2.03.0';

/* ── §10 Permission levels ────────────────────────────────────────── */

const PERMISSION_LEVELS = ['RESTRICTED', 'OBSERVE', 'ASSIST', 'EXECUTE', 'AUTONOMOUS'];
const LEVEL_RANK = { RESTRICTED: 0, OBSERVE: 1, ASSIST: 2, EXECUTE: 3, AUTONOMOUS: 4 };
const LEVEL_MEANING = {
  OBSERVE: 'Read or inspect only.',
  ASSIST: 'Prepare actions; the user executes or approves them.',
  EXECUTE: 'Perform explicitly authorized actions.',
  AUTONOMOUS: 'Act inside a narrow, pre-approved scope without per-action asking.',
  RESTRICTED: 'Explicitly limited execution boundaries.'
};

/* WitForge cannot elevate itself between levels (§10). Only a human subject
 * may raise a level, and AUTONOMOUS raises require an approval record. */
function requestLevelChange(actor, from, to, opts) {
  opts = opts || {};
  const kind = actor && actor.kind ? actor.kind : (actor && actor.subject) || 'unknown';
  const human = ['owner', 'user', 'human'].includes(String(kind).toLowerCase());
  if (!PERMISSION_LEVELS.includes(to) || !PERMISSION_LEVELS.includes(from)) return { ok: false, decision: 'DENY', reason: 'unknown-level' };
  if (to === from) return { ok: true, decision: 'ALLOW', from, to, reason: 'no-change' };
  if (LEVEL_RANK[to] > LEVEL_RANK[from]) {
    if (!human) return { ok: false, decision: 'DENY', reason: 'no-self-elevation', detail: 'WitForge, agents and adapters can never raise their own level (§10).' };
    if (to === 'AUTONOMOUS' && !opts.approvalId) return { ok: false, decision: 'ASK', reason: 'autonomous-requires-approval' };
  }
  return { ok: true, decision: 'ALLOW', from, to, reason: 'authorised-level-change' };
}

/* ── §11 / §12 Delegation + autonomous policy objects ─────────────── */

function delegationRecord(opts) {
  opts = opts || {};
  const caps = Array.isArray(opts.capabilities) ? opts.capabilities.slice(0, 64) : [];
  const forbidden = ['account.delete', 'security.remediate', 'economy.manage'];
  const rejected = caps.filter(c => forbidden.includes(c) && !opts.explicitHumanApproval);
  return {
    id: opts.id || 'dl' + crypto.randomBytes(5).toString('hex'),
    kind: 'act-on-my-behalf',
    subject: String(opts.subject || 'owner').slice(0, 40),
    purpose: String(opts.purpose || 'unspecified').slice(0, 120),
    capabilities: caps.filter(c => !rejected.includes(c)),
    rejected,
    scope: Object.assign({}, opts.scope || {}),
    createdTs: Date.now(),
    expiresTs: Number(opts.expiresTs) || Date.now() + 24 * 3600e3,
    bounded: true,
    note: 'Bounded by the listed capabilities and scope only — unrelated accounts, devices and security-sensitive operations stay excluded (§11).'
  };
}

function createAutonomousPolicy(opts) {
  opts = opts || {};
  const cap = ['LOW', 'MEDIUM', 'HIGH'];
  return {
    id: opts.id || 'ap-' + crypto.randomBytes(5).toString('hex'),
    kind: 'autonomous-policy',
    scope: String(opts.scope || 'unspecified').slice(0, 60),
    capabilities: Array.isArray(opts.capabilities) ? opts.capabilities.slice(0, 32) : [],
    resources: Array.isArray(opts.resources) ? opts.resources.slice(0, 32) : [],
    riskThreshold: cap.includes(opts.riskThreshold) ? opts.riskThreshold : 'MEDIUM',
    actionLimit: Math.max(1, Math.min(1000, Number(opts.actionLimit) || 10)),
    actionsUsed: 0,
    createdTs: Date.now(),
    expiresTs: Number(opts.expiresTs) || Date.now() + (Number(opts.ttlMs) || 3600e3),
    emergencyStopRef: opts.emergencyStopRef || null,
    auditTrail: [],
    active: true
  };
}

function checkAutonomousPolicy(policy, action) {
  if (!policy || !policy.active) return { allow: false, reason: 'no-policy' };
  if (Date.now() > policy.expiresTs) { policy.active = false; return { allow: false, reason: 'policy-expired' }; }
  if (policy.actionsUsed >= policy.actionLimit) return { allow: false, reason: 'action-limit-reached' };
  if (action.capability && policy.capabilities.length && !policy.capabilities.includes(action.capability)) return { allow: false, reason: 'capability-outside-policy-scope' };
  if (action.resource && policy.resources.length && !policy.resources.includes(action.resource)) return { allow: false, reason: 'resource-outside-policy-scope' };
  if (action.riskClass && RISK_RANK[action.riskClass] > RISK_RANK[policy.riskThreshold]) return { allow: false, reason: 'above-risk-threshold', detail: action.riskClass + ' > ' + policy.riskThreshold };
  policy.actionsUsed++;
  policy.auditTrail.unshift({ ts: Date.now(), capability: action.capability || null, resource: action.resource || null, riskClass: action.riskClass || null });
  if (policy.auditTrail.length > 50) policy.auditTrail.length = 50;
  return { allow: true, reason: 'within-policy', remaining: policy.actionLimit - policy.actionsUsed };
}

/* ── §51 Risk engine ─────────────────────────────────────────────── */

const RISK_CLASSES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'PROHIBITED'];
const RISK_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3, PROHIBITED: 4 };
const RISK_FACTOR_IDS = [
  'capabilitySensitivity', 'dataSensitivity', 'financialImpact', 'reversibility',
  'accountImpact', 'deviceImpact', 'externalVisibility', 'securityImpact',
  'legalImpact', 'scope', 'autonomy', 'uncertainty'
];
const RISK_FACTORS = RISK_FACTOR_IDS.map(id => ({ id, weight: 1, range: [0, 3] }));
const RISK_FACTOR_LABELS = {
  capabilitySensitivity: 'how sensitive the capability itself is',
  dataSensitivity: 'how sensitive the data touched is',
  financialImpact: 'money or value at stake',
  reversibility: 'how hard the action is to undo (3 = irreversible)',
  accountImpact: 'accounts affected or created',
  deviceImpact: 'devices or hosts affected',
  externalVisibility: 'how publicly visible the result becomes',
  securityImpact: 'effect on security posture',
  legalImpact: 'legal/regulatory exposure',
  scope: 'breadth of what is touched',
  autonomy: 'how much runs without per-action human consent',
  uncertainty: 'how much the outcome cannot be predicted'
};

function assessRisk(factors) {
  factors = factors || {};
  let score = 0, worst = 0, used = [];
  for (const id of RISK_FACTOR_IDS) {
    const v = Math.max(0, Math.min(3, Number(factors[id]) || 0));
    if (v > 0) { score += v; used.push({ id, value: v, label: RISK_FACTOR_LABELS[id] }); }
    if (v > worst) worst = v;
  }
  if (factors.prohibited === true) return { class: 'PROHIBITED', score: score + 12, factors: used, explanation: 'Explicitly prohibited by policy — must not execute (§52).' };
  // §51 compound-risk rule: the class escalates with both the total score and
  // the number of factors that are themselves maximal (irreversibility +
  // external visibility + financial impact on one action is not "medium").
  const maxima = RISK_FACTOR_IDS.filter(id => Number(factors[id]) === 3).length;
  let cls = 'LOW';
  if (score >= 18 || maxima >= 3 || (maxima >= 2 && score >= 14)) cls = 'CRITICAL';
  else if (score >= 10 || maxima >= 2) cls = 'HIGH';
  else if (score >= 4) cls = 'MEDIUM';
  return { class: cls, score, factors: used, explanation: cls + ' — ' + (used.length ? used.map(f => f.label).join(', ') : 'no material risk factors reported') };
}

/* ── §52 Human approval matrix ───────────────────────────────────── */

const APPROVAL_MATRIX = {
  LOW: { executable: true, requiresApproval: false, requiresStrongConfirmation: false, note: 'May execute within existing authorization.' },
  MEDIUM: { executable: true, requiresApproval: false, requiresStrongConfirmation: false, note: 'May execute under defined permissions.' },
  HIGH: { executable: true, requiresApproval: true, requiresStrongConfirmation: false, note: 'Normally requires explicit approval unless a narrowly scoped autonomous policy exists.' },
  CRITICAL: { executable: true, requiresApproval: true, requiresStrongConfirmation: true, note: 'Requires strong human confirmation and may require additional authentication.' },
  PROHIBITED: { executable: false, requiresApproval: false, requiresStrongConfirmation: false, note: 'Must not execute.' }
};
function approvalMatrix(riskClass, opts) {
  const m = APPROVAL_MATRIX[riskClass] || APPROVAL_MATRIX.HIGH;
  if (riskClass === 'HIGH' && opts && opts.coveredByAutonomousPolicy) return Object.assign({}, m, { requiresApproval: false, note: 'High risk, but inside a narrowly scoped, audited autonomous policy (§12).' });
  return Object.assign({}, m);
}

/* ── §44 Policy engine ───────────────────────────────────────────── */

const POLICY_DECISIONS = ['ALLOW', 'DENY', 'ASK', 'ESCALATE', 'BLOCK'];

/* Policies are evaluated in order; the first match decides. Each policy is a
 * pure predicate so the decision is reproducible and auditable. */
const POLICIES = [
  {
    id: 'P-PROHIBITED',
    sections: ['51', '52', '143', '162'],
    when: c => c.riskClass === 'PROHIBITED',
    decision: 'BLOCK',
    reason: 'Classified PROHIBITED — the spec forbids execution outright.'
  },
  {
    id: 'P-SECURITY-STOP',
    sections: ['55', '56'],
    when: c => c.stopActive === true || (c.emergency === 'LOCKDOWN' && c.riskClass !== 'LOW'),
    decision: 'BLOCK',
    reason: 'Emergency stop or LOCKDOWN active — execution suspended, evidence preserved.'
  },
  {
    id: 'P-PERMISSION-BLOCKED',
    sections: ['9', '46'],
    when: c => ['BLOCKED_BY_SECURITY', 'BLOCKED_BY_POLICY', 'REVOKED', 'DENIED', 'EXPIRED'].includes(c.permissionState),
    decision: 'DENY',
    reason: 'Capability state forbids execution (state is not GRANTED).'
  },
  {
    id: 'P-ACCOUNT-BOUNDARY',
    sections: ['134', '135'],
    when: c => c.accountAmbiguous === true || c.accountMismatch === true,
    decision: 'DENY',
    reason: 'Account boundary: the target account is ambiguous or not the one authorised (WitForge never acts through the wrong account).'
  },
  {
    id: 'P-DEVICE-TRUST',
    sections: ['40', '41', '104'],
    when: c => c.deviceTrust && ['UNKNOWN', 'REVOKED', 'LOCKED'].includes(c.deviceTrust),
    decision: 'DENY',
    reason: 'Device trust is not established; pairing/authorization is required first.'
  },
  {
    id: 'P-EXTERNAL-CONTENT',
    sections: ['49', '148'],
    when: c => c.requestedBy && c.requestedBy.authority === 'external-content',
    decision: 'DENY',
    reason: 'External content can never authorise an action (§148) — instructions inside web pages, files and model output are data, not authority.'
  },
  {
    id: 'P-IRREVERSIBLE-UNSNAPSHOTTED',
    sections: ['101'],
    when: c => c.irreversible === true && c.hasSnapshot !== true,
    decision: 'ASK',
    reason: 'Irreversible operation without a prepared snapshot/rollback path requires explicit approval.'
  },
  {
    id: 'P-CRITICAL',
    sections: ['52'],
    when: c => c.riskClass === 'CRITICAL' && !c.approvalGranted,
    decision: 'ESCALATE',
    reason: 'CRITICAL risk requires strong human confirmation (approval + explicit confirmation word).'
  },
  {
    id: 'P-HIGH-RISK',
    sections: ['52'],
    when: c => c.riskClass === 'HIGH' && !c.approvalGranted && !c.coveredByAutonomousPolicy,
    decision: 'ASK',
    reason: 'HIGH risk requires explicit approval or a narrowly scoped autonomous policy.'
  },
  {
    id: 'P-NOT-GRANTED',
    sections: ['9', '10'],
    when: c => c.permissionState !== 'GRANTED' && c.riskClass !== 'LOW',
    decision: 'ASK',
    reason: 'Capability not granted yet — the user’s request must grant it (or an approval must be recorded).'
  },
  {
    id: 'P-LOW-AUTO',
    sections: ['9', '52'],
    when: c => c.riskClass === 'LOW',
    decision: 'ALLOW',
    reason: 'Low risk may execute within existing authorization.'
  },
  {
    id: 'P-DEFAULT',
    sections: ['44'],
    when: () => true,
    decision: 'ALLOW',
    reason: 'No policy objects to this action; it is inside the granted, scoped authority.'
  }
];

function evaluatePolicy(ctx) {
  ctx = ctx || {};
  for (const p of POLICIES) {
    let match = false;
    try { match = !!p.when(ctx); } catch (e) { match = false; }
    if (match) return { decision: p.decision, policyId: p.id, sections: p.sections, reason: p.reason, ctx: { riskClass: ctx.riskClass, permissionState: ctx.permissionState } };
  }
  return { decision: 'DENY', policyId: 'P-FAIL-CLOSED', sections: [], reason: 'No policy matched — fail closed.' };
}

/* ── §46 Scoped capability tokens ────────────────────────────────── */

const TOKEN_FIELDS = ['id', 'capability', 'subject', 'agent', 'device', 'account', 'resource', 'scope', 'purpose', 'exp', 'approval', 'policyVersion', 'sig'];

function createToken(binding, secret, ttlMs) {
  binding = binding || {};
  const exp = Number(binding.exp) || Date.now() + (Number(ttlMs) || Number(binding.ttlMs) || 3600e3);
  const t = {
    id: binding.id || 'tk' + crypto.randomBytes(6).toString('hex'),
    capability: String(binding.capability || 'unknown'),
    subject: binding.subject || 'owner',
    agent: binding.agent || null,
    device: binding.device || null,
    account: binding.account || null,
    resource: binding.resource || null,
    scope: Object.assign({}, binding.scope || {}),
    purpose: binding.purpose || 'user-request',
    exp,
    approval: binding.approval || null,
    policyVersion: binding.policyVersion || DEFAULT_POLICY_VERSION
  };
  t.sig = tokenSig(t, secret);
  return t;
}
function tokenPayload(t) {
  return [t.id, t.capability, t.subject, t.agent || '', t.device || '', t.account || '', t.resource || '',
    JSON.stringify(t.scope || {}), t.purpose, t.exp, t.approval || '', t.policyVersion].join('|');
}
function tokenSig(t, secret) { return crypto.createHmac('sha256', String(secret)).update(tokenPayload(t)).digest('hex'); }

function verifyToken(token, secret, ctx) {
  ctx = ctx || {};
  if (!token) return { ok: false, reason: 'missing-token' };
  if (!TOKEN_FIELDS.every(f => f in token)) return { ok: false, reason: 'malformed-token' };
  if (tokenSig(token, secret) !== token.sig) return { ok: false, reason: 'signature-invalid' };
  if (Date.now() > token.exp) return { ok: false, reason: 'expired' };
  for (const dim of ['agent', 'device', 'account', 'resource']) {
    if (token[dim] && ctx[dim] && token[dim] !== ctx[dim]) return { ok: false, reason: dim + '-binding-mismatch' };
    if (token[dim] && !ctx[dim] && ctx.requireBinding) return { ok: false, reason: dim + '-required-but-absent' };
  }
  if (token.policyVersion !== (ctx.policyVersion || DEFAULT_POLICY_VERSION)) return { ok: false, reason: 'policy-version-changed' };
  return { ok: true, reason: 'valid', token };
}

/* ── §55 Emergency stop scopes ───────────────────────────────────── */

const STOP_SCOPES = ['task', 'agent', 'integration', 'device', 'autonomous', 'network', 'account'];
const STOP_DESCRIPTIONS = {
  task: 'stop the current task', agent: 'stop an agent', integration: 'stop an application integration',
  device: 'stop a device', autonomous: 'stop autonomous mode', network: 'stop network execution',
  account: 'stop account operations'
};

function setStop(state, scope, target, reason) {
  if (!STOP_SCOPES.includes(scope)) return { ok: false, error: 'Unknown stop scope: ' + scope };
  state.stops = state.stops || {};
  state.stops[scope] = state.stops[scope] || {};
  state.stops[scope][target || '*'] = { ts: Date.now(), reason: reason || 'user emergency stop' };
  return { ok: true, scope, target: target || '*', description: STOP_DESCRIPTIONS[scope] };
}
function clearStop(state, scope, target) {
  if (!state.stops || !state.stops[scope]) return { ok: false, error: 'Not stopped: ' + scope };
  delete state.stops[scope][target || '*'];
  if (!Object.keys(state.stops[scope]).length) delete state.stops[scope];
  return { ok: true, scope, target: target || '*' };
}
function isStopped(state, scope, target) {
  const s = state.stops && state.stops[scope];
  if (!s) return false;
  return !!(s['*'] || (target && s[target]));
}
function stopReport(state) {
  const out = [];
  const s = state.stops || {};
  for (const scope of STOP_SCOPES) for (const [target, rec] of Object.entries(s[scope] || {})) out.push({ scope, target, ts: rec.ts, reason: rec.reason });
  return out;
}

/* ── §56 Emergency control hierarchy ─────────────────────────────── */

const EMERGENCY_LEVELS = ['NORMAL', 'ELEVATED', 'HIGH', 'LOCKDOWN'];
const EMERGENCY_EFFECT = {
  NORMAL: { gate: 'none', note: 'Normal monitoring.' },
  ELEVATED: { gate: 'challenge', note: 'Increased scrutiny; medium-risk actions are logged in detail.' },
  HIGH: { gate: 'block-medium', note: 'Medium-risk execution requires explicit approval.' },
  LOCKDOWN: { gate: 'block-nonlow', note: 'Execution suspended while audit and recovery functions stay available.' }
};
function emergencyEffect(level) { return EMERGENCY_EFFECT[level] || EMERGENCY_EFFECT.NORMAL; }

/* ── §96 Audit record shape ──────────────────────────────────────── */

function auditRecord(fields) {
  fields = fields || {};
  const rec = {
    id: fields.id || 'ev' + crypto.randomBytes(6).toString('hex'),
    ts: fields.ts || Date.now(),
    actor: fields.actor || 'user',
    agent: fields.agent || null,
    device: fields.device || null,
    account: fields.account || null,
    capability: fields.capability || null,
    action: fields.action || 'unspecified',
    decision: fields.decision || 'ALLOW',
    reason: fields.reason || null,
    risk: fields.risk || fields.riskClass || null,
    approval: fields.approval || null,
    result: fields.result || null,
    cid: fields.cid || null,
    // Detail is what a human reads; secrets must be masked by the caller (§96).
    detail: fields.detail ? String(fields.detail).slice(0, 300) : null
  };
  rec.evidenceHash = fields.evidenceHash || crypto.createHash('sha256').update(JSON.stringify({ a: rec.action, d: rec.decision, t: rec.ts, c: rec.cid, cap: rec.capability })).digest('hex');
  return rec;
}

/* ── §148 Data authority model ───────────────────────────────────── */

const AUTHORITY_ORDER = [
  'system-security',      // 1. the platform's own security layer
  'os-security',          // 2. operating-system security
  'owner-authority',      // 3. authenticated user/Owner authority
  'capability-permission',// 4. explicit capability permissions
  'policy',               // 5. policy
  'agent-delegation',     // 6. agent delegation
  'task-instruction',     // 7. task instructions
  'external-content'      // 8. external content (never authority)
];
function authorityRank(source) { const i = AUTHORITY_ORDER.indexOf(source); return i < 0 ? AUTHORITY_ORDER.length : i; }
function outranks(a, b) { return authorityRank(a) < authorityRank(b); }

/* ── Capability state helper (used by the platform store) ────────── */

const ALLOWED_TRANSITIONS = {
  NOT_REQUESTED: ['REQUESTED'],
  REQUESTED: ['GRANTED', 'DENIED', 'EXPIRED', 'BLOCKED_BY_SECURITY', 'BLOCKED_BY_POLICY'],
  GRANTED: ['SUSPENDED', 'REVOKED', 'EXPIRED', 'BLOCKED_BY_SECURITY', 'BLOCKED_BY_POLICY'],
  SUSPENDED: ['GRANTED', 'REVOKED', 'EXPIRED'],
  DENIED: ['REQUESTED'],
  EXPIRED: ['REQUESTED'],
  REVOKED: ['REQUESTED'],
  BLOCKED_BY_SECURITY: ['REQUESTED'],
  BLOCKED_BY_POLICY: ['REQUESTED']
};
function transitionPermission(rec, next, reason) {
  if (!PERMISSION_STATES.includes(next)) return { ok: false, error: 'Unknown permission state: ' + next };
  const from = (rec && rec.state) || 'NOT_REQUESTED';
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(next)) return { ok: false, error: `Illegal permission transition ${from} → ${next}` };
  const out = Object.assign({}, rec, { state: next, stateReason: reason || null, stateTs: Date.now() });
  if (next === 'GRANTED') out.grantedTs = Date.now();
  if (next === 'REVOKED') out.revokedTs = Date.now();
  return { ok: true, record: out, from, to: next };
}

/* ── Evidence vault (§118) ───────────────────────────────────────── */

function vaultStore(state, opts) {
  opts = opts || {};
  state.evidenceVault = state.evidenceVault || [];
  const payload = opts.payload === undefined ? null : opts.payload;
  const rec = {
    id: opts.id || 'ev-' + crypto.randomBytes(6).toString('hex'),
    ts: Date.now(),
    kind: String(opts.kind || 'record').slice(0, 40),
    classification: opts.classification || 'operational',
    hash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    resources: Array.isArray(opts.resources) ? opts.resources.map(r => String(r).slice(0, 120)).slice(0, 32) : [],
    cid: opts.cid || null,
    // Secrets are stored by reference only (§118 "secrets must be protected").
    secretRef: opts.secretRef || null,
    payload: opts.retainPayload === false ? null : payload
  };
  state.evidenceVault.unshift(rec);
  if (state.evidenceVault.length > 400) state.evidenceVault.length = 400;
  return { ok: true, record: rec };
}
function vaultList(state, filter) {
  const list = state.evidenceVault || [];
  if (!filter) return list;
  return list.filter(e => (filter.kind ? e.kind === filter.kind : true) && (filter.since ? e.ts >= filter.since : true));
}
function vaultVerify(state) {
  const list = (state.evidenceVault || []).slice();
  const bad = [];
  for (const e of list) {
    if (e.payload === null) continue;
    const h = crypto.createHash('sha256').update(JSON.stringify(e.payload)).digest('hex');
    if (h !== e.hash) bad.push(e.id);
  }
  return { ok: bad.length === 0, entries: list.length, tampered: bad };
}

module.exports = {
  // §9/§10
  PERMISSION_STATES, SCOPE_DIMENSIONS, PERMISSION_LEVELS, LEVEL_RANK, LEVEL_MEANING, DEFAULT_POLICY_VERSION,
  requestLevelChange, transitionPermission, ALLOWED_TRANSITIONS,
  // §11/§12
  delegationRecord, createAutonomousPolicy, checkAutonomousPolicy,
  // §44/§51/§52
  RISK_CLASSES, RISK_RANK, RISK_FACTORS, RISK_FACTOR_IDS, RISK_FACTOR_LABELS, assessRisk,
  APPROVAL_MATRIX, approvalMatrix, POLICY_DECISIONS, POLICIES, evaluatePolicy,
  // §46
  TOKEN_FIELDS, createToken, verifyToken, tokenSig,
  // §55/§56
  STOP_SCOPES, STOP_DESCRIPTIONS, setStop, clearStop, isStopped, stopReport,
  EMERGENCY_LEVELS, EMERGENCY_EFFECT, emergencyEffect,
  // §96/§118/§148
  auditRecord, AUTHORITY_ORDER, authorityRank, outranks,
  vaultStore, vaultList, vaultVerify
};
