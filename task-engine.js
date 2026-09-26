/* WitForge task engine — §5, §6, §99, §101, §102–§103, §122–§123,
 * §147, §149, §151–§157, §159–§160.
 *
 * Durable task state, honest result states, the failure taxonomy, the
 * correction/continuation loops, transactional rollback and the workflow
 * playbooks described by the master specification's worked examples.
 *
 * Design rules:
 *  - Every state change is guarded; illegal transitions are refused, never
 *    silently coerced (§151).
 *  - A step that is not verified is never reported as done (§160).
 *  - Steps that need a capability this build does not have are reported as
 *    WAITING_FOR_CAPABILITY — the spec's honesty rule, not a failure (§108).
 */
'use strict';
const crypto = require('crypto');

/* ── §151 Durable task state machine ─────────────────────────────── */

const TASK_STATES = [
  'CREATED', 'UNDERSTANDING', 'PROBLEM_SOLVING', 'PLANNING',
  'WAITING_FOR_CAPABILITY', 'WAITING_FOR_PERMISSION', 'WAITING_FOR_APPROVAL',
  'EXECUTING', 'VERIFYING', 'CORRECTING', 'RETRYING', 'RECOVERING',
  'SUCCESS', 'BLOCKED', 'FAILED'
];
const TASK_TRANSITIONS = {
  CREATED: ['UNDERSTANDING', 'BLOCKED', 'FAILED'],
  UNDERSTANDING: ['PROBLEM_SOLVING', 'BLOCKED', 'FAILED'],
  PROBLEM_SOLVING: ['PLANNING', 'BLOCKED', 'FAILED'],
  PLANNING: ['WAITING_FOR_CAPABILITY', 'WAITING_FOR_PERMISSION', 'WAITING_FOR_APPROVAL', 'EXECUTING', 'BLOCKED', 'FAILED'],
  WAITING_FOR_CAPABILITY: ['PLANNING', 'BLOCKED', 'FAILED'],
  WAITING_FOR_PERMISSION: ['EXECUTING', 'BLOCKED', 'FAILED'],
  WAITING_FOR_APPROVAL: ['EXECUTING', 'BLOCKED', 'FAILED'],
  EXECUTING: ['VERIFYING', 'CORRECTING', 'RECOVERING', 'BLOCKED', 'FAILED'],
  VERIFYING: ['SUCCESS', 'CORRECTING', 'RECOVERING', 'FAILED'],
  CORRECTING: ['RETRYING', 'RECOVERING', 'BLOCKED', 'FAILED'],
  RETRYING: ['VERIFYING', 'CORRECTING', 'RECOVERING', 'FAILED'],
  RECOVERING: ['EXECUTING', 'VERIFYING', 'SUCCESS', 'FAILED', 'BLOCKED'],
  SUCCESS: [], BLOCKED: ['RECOVERING'], FAILED: ['RECOVERING']
};

function createTask(objective, opts) {
  opts = opts || {};
  return {
    id: opts.id || 'task-' + crypto.randomBytes(5).toString('hex'),
    objective: String(objective || '').slice(0, 300),
    state: 'CREATED',
    createdTs: Date.now(),
    updatedTs: Date.now(),
    history: [{ state: 'CREATED', ts: Date.now() }],
    checkpoints: [],
    attempts: 0,
    retryBudget: Number(opts.retryBudget) || 3,
    corrections: [],
    permissionsRequired: [],
    capabilitiesRequired: [],
    result: null
  };
}
function advance(task, next, meta) {
  if (!task) return { ok: false, error: 'no-task' };
  if (!TASK_STATES.includes(next)) return { ok: false, error: 'Unknown task state: ' + next };
  const allowed = TASK_TRANSITIONS[task.state] || [];
  if (!allowed.includes(next)) return { ok: false, error: `Illegal task transition ${task.state} → ${next}`, from: task.state, allowed };
  task.state = next;
  task.updatedTs = Date.now();
  task.history.unshift(Object.assign({ state: next, ts: Date.now() }, meta || {}));
  if (task.history.length > 200) task.history.length = 200;
  return { ok: true, state: next, from: allowed.length ? task.history[1] && task.history[1].state : null };
}
function taskSummary(task) {
  return {
    id: task.id, objective: task.objective, state: task.state,
    attempts: task.attempts, corrections: task.corrections.length,
    verifiedSteps: task.checkpoints.filter(c => c.verified).map(c => c.step),
    remaining: task.remainingWork || null,
    result: task.result
  };
}

/* ── §99 Standard result states ──────────────────────────────────── */

const RESULT_STATES = [
  'PLANNED', 'WAITING_FOR_PERMISSION', 'WAITING_FOR_APPROVAL', 'EXECUTING', 'SUCCEEDED',
  'PARTIALLY_SUCCEEDED', 'FAILED', 'BLOCKED', 'QUARANTINED', 'ROLLED_BACK',
  'RECOVERING', 'CANCELLED', 'UNKNOWN'
];
function isTerminalResult(state) { return ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'BLOCKED', 'QUARANTINED', 'ROLLED_BACK', 'CANCELLED'].includes(state); }
function normalizeResult(state, fallback) {
  if (RESULT_STATES.includes(state)) return state;
  return fallback || 'UNKNOWN';
}

/* ── §6 Failure taxonomy ─────────────────────────────────────────── */

const FAILURE_CLASSES = [
  'RECOVERABLE',            // temporary; retry is safe
  'AUTHORIZATION_FAILURE',  // credentials/consent missing or stale
  'SECURITY_BLOCK',         // security layer refused
  'POLICY_VIOLATION',       // policy/legal refusal
  'UNAVAILABLE_CAPABILITY', // no legitimate interface in this build
  'EXTERNAL_SERVICE_FAILURE',// remote system failed
  'INVALID_INPUT',          // the request/args are wrong
  'ENVIRONMENTAL',          // local environment (disk, permissions, offline)
  'IRREVERSIBLE'            // cannot be undone; must not be retried blindly
];

function classifyFailure(f) {
  f = f || {};
  if (f.class && FAILURE_CLASSES.includes(f.class)) return f.class;
  if (f.blocked === 'ssrf' || f.blocked === 'lockdown' || f.blocked === 'security') return 'SECURITY_BLOCK';
  if (f.blocked === 'allowlist' || f.blocked === 'policy') return 'POLICY_VIOLATION';
  if (f.blocked === 'permission') return 'AUTHORIZATION_FAILURE';
  const err = String(f.error || f.message || '').toLowerCase();
  const status = Number(f.httpStatus || f.status || 0);
  if (status === 401 || status === 403 || /unauthor|forbidden|token|credential|expired session/.test(err)) return 'AUTHORIZATION_FAILURE';
  if (status === 429 || status >= 500 && status < 600 || /timeout|timed out|temporar|rate limit|unavailable|econnreset/.test(err)) return 'EXTERNAL_SERVICE_FAILURE';
  if (/no credential|unavailable — no credential|bridge|not configured|no public api/.test(err)) return 'UNAVAILABLE_CAPABILITY';
  if (/invalid|required|malformed|must be|unknown tool|unknown op/.test(err)) return 'INVALID_INPUT';
  if (/enospc|disk|permission denied on host|offline/.test(err)) return 'ENVIRONMENTAL';
  if (f.irreversible === true) return 'IRREVERSIBLE';
  return 'RECOVERABLE';
}
function failureIsRetryable(cls) {
  return cls === 'RECOVERABLE' || cls === 'EXTERNAL_SERVICE_FAILURE' || cls === 'ENVIRONMENTAL';
}

/* ── §147 Correction engine ──────────────────────────────────────── */

function correctionPlan(failure) {
  const cls = classifyFailure(failure);
  const base = { failureClass: cls, diagnosis: '', actions: [], retryAllowed: failureIsRetryable(cls), stopReason: null };
  switch (cls) {
    case 'RECOVERABLE':
      return Object.assign(base, {
        diagnosis: 'Transient condition — the same legitimate method may succeed on retry.',
        actions: ['retry-same-method', 'verify-result']
      });
    case 'EXTERNAL_SERVICE_FAILURE':
      return Object.assign(base, {
        diagnosis: 'The external service failed or throttled. This is not an authorization problem.',
        actions: ['backoff-and-retry', 'try-alternative-endpoint', 'verify-result', 'report-partial-if-degraded']
      });
    case 'AUTHORIZATION_FAILURE':
      return Object.assign(base, {
        diagnosis: 'Authorization is missing or stale. Bypassing is forbidden; the user must reconnect or re-consent.',
        actions: ['explain-boundary', 'request-legitimate-authorization', 'replan', 'resume-from-checkpoint'],
        retryAllowed: false, stopReason: 'authorization-boundary'
      });
    case 'SECURITY_BLOCK':
      return Object.assign(base, {
        diagnosis: 'The security layer refused the action. Report and stop; do not reroute around it.',
        actions: ['explain-boundary', 'preserve-evidence', 'stop'],
        retryAllowed: false, stopReason: 'security-boundary'
      });
    case 'POLICY_VIOLATION':
      return Object.assign(base, {
        diagnosis: 'Policy, legal or jurisdictional rules refuse this action.',
        actions: ['identify-uncertainty', 'explain-boundary', 'stop'],
        retryAllowed: false, stopReason: 'policy-boundary'
      });
    case 'UNAVAILABLE_CAPABILITY':
      return Object.assign(base, {
        diagnosis: 'No legitimate technical interface exists in this build for that method.',
        actions: ['try-authorized-alternative-method', 'mark-waiting-for-capability', 'handoff-to-human'],
        retryAllowed: false, stopReason: 'capability-missing'
      });
    case 'INVALID_INPUT':
      return Object.assign(base, {
        diagnosis: 'The request or its parameters are invalid; a retry with identical input would fail identically.',
        actions: ['request-missing-information', 'replan'],
        retryAllowed: false
      });
    case 'ENVIRONMENTAL':
      return Object.assign(base, {
        diagnosis: 'A local environmental condition (disk, host permission, offline) must be repaired first.',
        actions: ['repair-configuration-if-authorized', 'retry-same-method', 'verify-result']
      });
    case 'IRREVERSIBLE':
      return Object.assign(base, {
        diagnosis: 'The action is irreversible; blind retries risk duplication or destruction.',
        actions: ['verify-current-state', 'rollforward-or-report', 'handoff-to-human'],
        retryAllowed: false, stopReason: 'irreversible'
      });
    default:
      return Object.assign(base, { diagnosis: 'Unknown failure.', actions: ['stop', 'handoff-to-human'], retryAllowed: false });
  }
}

function attemptCorrection(task, failure) {
  const plan = correctionPlan(failure);
  task.corrections.unshift({ ts: Date.now(), failureClass: plan.failureClass, diagnosis: plan.diagnosis, actions: plan.actions });
  if (task.corrections.length > 50) task.corrections.length = 50;
  if (!plan.retryAllowed) return { ok: false, plan, state: classifyFailure(failure) === 'SECURITY_BLOCK' || classifyFailure(failure) === 'POLICY_VIOLATION' ? 'BLOCKED' : 'FAILED' };
  if (task.attempts >= task.retryBudget) return { ok: false, plan, state: 'FAILED', exhausted: true, reason: 'retry-budget-exhausted(' + task.retryBudget + ')' };
  task.attempts++;
  advance(task, 'CORRECTING', { reason: plan.diagnosis });
  advance(task, 'RETRYING', { attempt: task.attempts });
  return { ok: true, plan, state: 'RETRYING', attempt: task.attempts, remaining: task.retryBudget - task.attempts };
}

/* ── §149 Failure containment ────────────────────────────────────── */

const CONTAINMENT_STEPS = [
  'stop unsafe propagation', 'preserve evidence', 'determine scope',
  'isolate affected resources', 'diagnose', 'repair if safe',
  'restore if necessary', 'verify', 'continue where safe', 'report honestly'
];
function contain(failure) {
  const cls = classifyFailure(failure);
  const isolate = cls === 'SECURITY_BLOCK' || cls === 'AUTHORIZATION_FAILURE' || cls === 'POLICY_VIOLATION';
  return {
    failureClass: cls,
    steps: CONTAINMENT_STEPS.slice(),
    stopPropagation: true,
    preserveEvidence: true,
    isolateAffected: isolate,
    continueAllowed: !isolate && failureIsRetryable(cls),
    quarantined: cls === 'SECURITY_BLOCK'
  };
}

/* ── §101 Rollback / transaction framework ───────────────────────── */

const TX_STATES = ['PLANNED', 'PREPARED', 'EXECUTED', 'VERIFIED', 'COMMITTED', 'ROLLED_BACK', 'FAILED'];

function beginTransaction(name, opts) {
  opts = opts || {};
  if (opts.irreversible === true && typeof opts.snapshot !== 'function') {
    return { ok: false, error: 'Irreversible operations must declare a snapshot or recovery path before execution (§101).' };
  }
  const tx = {
    id: 'tx-' + crypto.randomBytes(5).toString('hex'),
    name: String(name || 'transaction'),
    state: 'PLANNED',
    reversible: opts.irreversible !== true,
    createdTs: Date.now(),
    log: [],
    snapshot: null
  };
  const record = (s, extra) => { tx.state = s; tx.log.unshift(Object.assign({ state: s, ts: Date.now() }, extra || {})); };
  return {
    ok: true, id: tx.id, tx,
    prepare() {
      if (tx.state !== 'PLANNED') return { ok: false, error: 'prepare() requires PLANNED (was ' + tx.state + ')' };
      if (typeof opts.snapshot === 'function') { tx.snapshot = opts.snapshot(); }
      record('PREPARED', { snapshotTaken: tx.snapshot !== null });
      return { ok: true, state: tx.state, snapshotTaken: tx.snapshot !== null };
    },
    executed(detail) {
      if (tx.state !== 'PREPARED') return { ok: false, error: 'executed() requires PREPARED (was ' + tx.state + ')' };
      record('EXECUTED', detail || {});
      return { ok: true, state: tx.state };
    },
    verify(predicate) {
      if (tx.state !== 'EXECUTED') return { ok: false, error: 'verify() requires EXECUTED (was ' + tx.state + ')' };
      let pass = false;
      try { pass = !!predicate(); } catch (e) { pass = false; }
      record('VERIFIED', { pass });
      if (!pass) { tx.state = 'FAILED'; return { ok: false, verified: false, nextAction: 'STOP → DIAGNOSE → ROLLBACK/RECOVER → VERIFY' }; }
      return { ok: true, verified: true };
    },
    commit() {
      if (tx.state !== 'VERIFIED') return { ok: false, error: 'commit() requires a verified transaction (was ' + tx.state + ')' };
      record('COMMITTED');
      return { ok: true, state: tx.state };
    },
    rollback() {
      if (tx.state === 'COMMITTED') return { ok: false, error: 'Committed transactions cannot be rolled back' };
      if (!tx.reversible) return { ok: false, error: 'Declared irreversible — use recovery instead of rollback' };
      if (typeof opts.restore === 'function') { try { opts.restore(tx.snapshot); } catch (e) { return { ok: false, error: 'Restore failed: ' + e.message }; } }
      record('ROLLED_BACK');
      return { ok: true, state: tx.state, restored: tx.snapshot !== null };
    },
    status() { return { id: tx.id, name: tx.name, state: tx.state, reversible: tx.reversible, log: tx.log }; }
  };
}

/* ── §153 / §160 Checkpoints, continuation and recovery ──────────── */

function checkpoint(task, step, data) {
  task.checkpoints = task.checkpoints || [];
  const existing = task.checkpoints.find(c => c.step === step);
  const rec = { step: String(step), ts: Date.now(), verified: true, data: data === undefined ? null : data };
  if (existing) Object.assign(existing, rec); else task.checkpoints.push(rec);
  task.updatedTs = Date.now();
  return { ok: true, checkpoint: rec, total: task.checkpoints.length };
}
function isStepVerified(task, step) { return !!(task.checkpoints || []).find(c => c.step === step && c.verified); }
function remainingWork(task, plannedSteps) {
  task.remainingWork = (plannedSteps || []).filter(s => !isStepVerified(task, s));
  return task.remainingWork;
}
function resume(task) {
  const done = (task.checkpoints || []).filter(c => c.verified).map(c => c.step);
  return {
    ok: true, taskId: task.id, objective: task.objective, state: task.state,
    completedVerified: done,
    remainingWork: task.remainingWork || null,
    note: 'Verified steps are not repeated — the task resumes from the last verified checkpoint (§160).'
  };
}

/* ── §154 Human handoff ──────────────────────────────────────────── */

function handoff(task) {
  const t = task || {};
  const plan = t.failure ? correctionPlan(t.failure) : null;
  const cls = t.failure ? classifyFailure(t.failure) : 'UNKNOWN';
  const done = t.verifiedSteps || [];
  const objective = t.objective || 'the task';
  const failedStep = t.failedStep || 'the current step';
  let blockedBecause = 'it could not be completed safely';
  if (cls === 'AUTHORIZATION_FAILURE') blockedBecause = 'authorization is required again (a fresh, legitimate authorization — not a workaround)';
  else if (cls === 'SECURITY_BLOCK') blockedBecause = 'the security layer refused the action, and WitForge does not bypass security boundaries';
  else if (cls === 'POLICY_VIOLATION') blockedBecause = 'policy or legal rules refuse the action';
  else if (cls === 'UNAVAILABLE_CAPABILITY') blockedBecause = 'no legitimate interface is connected for that step';
  else if (cls === 'EXTERNAL_SERVICE_FAILURE') blockedBecause = 'the external service failed repeatedly';
  else if (cls === 'IRREVERSIBLE') blockedBecause = 'the action is irreversible and unverified';
  return {
    kind: 'handoff',
    failureClass: cls,
    completedVerified: done,
    remaining: t.remaining || [],
    requiredFromHuman: t.requiredFromHuman || (cls === 'AUTHORIZATION_FAILURE' ? ['reconnect the account', 're-approve the capability'] : ['decide how to proceed']),
    message: `${objective}: ${failedStep} could not continue because ${blockedBecause}. ` +
      (done.length ? `Verified so far: ${done.join(', ')}. ` : '') +
      `Nothing was published or claimed as done beyond those verified steps. ` +
      (plan ? `Recommended next step: ${plan.actions.join(' → ')}.` : '')
  };
}

/* ── §5 Problem-solving lifecycle ────────────────────────────────── */

const PROBLEM_SOLVING_STAGES = ['Understand', 'Diagnose', 'Generate Solutions', 'Evaluate', 'Select', 'Plan', 'Execute', 'Verify', 'Correct', 'Continue/Recover', 'Report'];

/* ── §100 Action transparency ────────────────────────────────────── */

function transparencyReport(t) {
  t = t || {};
  return {
    kind: 'transparency',
    intended: t.intended || [],
    did: t.did || [],
    permissionsUsed: t.permissionsUsed || [],
    failures: t.failures || [],
    corrections: t.corrections || [],
    verified: t.verified || [],
    remaining: t.remaining || [],
    summary: `${(t.did || []).length} action(s) performed, ${(t.verified || []).length} verified, ${(t.failures || []).length} failed, ${(t.remaining || []).length} outstanding.`
  };
}

/* ── Workflow playbooks (the specification's worked examples) ─────
 *
 * Each step declares: the capability it needs, its risk class, whether this
 * build can perform it locally, and how the result is verified. Steps whose
 * capability is external are reported as WAITING_FOR_CAPABILITY — never faked.
 */
const S = (id, action, capability, riskClass, mode, verification) => ({ id, action, capability, riskClass, mode, verification });

const PLAYBOOKS = {
  'email-reply': {
    section: '§102', title: 'Reply to an email through an authorized mailbox',
    steps: [
      S('locate', 'Locate the message in the mailbox', 'email.read', 'MEDIUM', 'external', 'message id returned by provider'),
      S('draft', 'Compose the reply text', 'email.compose', 'LOW', 'local', 'draft stored with a hash'),
      S('reply', 'Attach the reply to the thread', 'email.reply', 'HIGH', 'external', 'provider thread state'),
      S('send', 'Send (separate authority from composing)', 'email.send', 'HIGH', 'external', 'provider “sent” evidence'),
      S('verify', 'Verify the sent state', 'email.read', 'MEDIUM', 'external', 'message present in Sent with matching id')
    ]
  },
  'device-install': {
    section: '§103', title: 'Install an application on an authorized device',
    steps: [
      S('identify', 'Identify the target device', 'device.control', 'MEDIUM', 'local', 'device record + trust state'),
      S('trust', 'Verify device trust', 'device.control', 'MEDIUM', 'local', 'trust == TRUSTED'),
      S('inspect', 'Inspect the package and its source', 'security.scan', 'MEDIUM', 'local', 'package hash + source record'),
      S('authorize', 'Request installation authorization', 'device.control', 'HIGH', 'local', 'approval record'),
      S('install', 'Install through the platform installer', 'device.control', 'HIGH', 'external', 'installer result / package manager state'),
      S('verify', 'Verify the installation', 'device.control', 'MEDIUM', 'external', 'package present and launchable')
    ]
  },
  'media-publish': {
    section: '§155', title: 'Create media and publish it under separate authorities',
    steps: [
      S('style', 'Understand the requested style', 'media.video.edit', 'LOW', 'local', 'style brief recorded'),
      S('footage', 'Obtain or generate authorized footage', 'media.video.create', 'MEDIUM', 'external', 'asset with provenance'),
      S('music', 'Obtain appropriately licensed music', 'media.audio.create', 'LOW', 'external', 'licence record'),
      S('edit', 'Edit the video', 'media.video.edit', 'MEDIUM', 'external', 'rendered artifact hash'),
      S('verify-media', 'Verify audio/video integrity', 'media.video.edit', 'LOW', 'local', 'rendered file readable, duration/hash recorded'),
      S('upload', 'Upload to the authorized channel', 'youtube.upload', 'HIGH', 'external', 'video id from API'),
      S('publish', 'Publish publicly (separate authority)', 'youtube.publish', 'HIGH', 'external', 'visibility == public'),
      S('verify-public', 'Verify public status', 'youtube.publish', 'MEDIUM', 'external', 'API visibility check')
    ]
  },
  'research-recommend': {
    section: '§156', title: 'Research a problem and recommend an approach',
    steps: [
      S('define', 'Define the problem and constraints', 'knowledge.write', 'LOW', 'local', 'problem statement stored'),
      S('gather', 'Gather attributable evidence', 'web.retrieve', 'MEDIUM', 'local', 'sources with URLs and hashes'),
      S('separate', 'Separate facts from assumptions', 'knowledge.write', 'LOW', 'local', 'assumption list'),
      S('alternatives', 'Generate alternatives', 'knowledge.write', 'LOW', 'local', 'option list'),
      S('compare', 'Compare cost, risk and benefit', 'knowledge.write', 'LOW', 'local', 'comparison table'),
      S('uncertainty', 'Identify uncertainty', 'knowledge.write', 'LOW', 'local', 'uncertainty notes'),
      S('recommend', 'Recommend an approach', 'knowledge.write', 'LOW', 'local', 'recommendation with reasons')
    ]
  },
  'dev-fix': {
    section: '§157', title: 'Inspect, patch, test and roll back safely',
    steps: [
      S('inspect', 'Inspect the project', 'files.read', 'LOW', 'local', 'file inventory + hashes'),
      S('reproduce', 'Reproduce the issue', 'linux.command', 'MEDIUM', 'local', 'failing command captured'),
      S('root-cause', 'Identify the root cause', 'knowledge.write', 'LOW', 'local', 'cause statement'),
      S('patch', 'Create a patch', 'files.write', 'MEDIUM', 'local', 'patch diff + file hash'),
      S('test', 'Run tests', 'linux.command', 'MEDIUM', 'local', 'test output'),
      S('security', 'Inspect security impact', 'security.scan', 'MEDIUM', 'local', 'impact note'),
      S('apply', 'Apply the patch if authorized', 'files.write', 'MEDIUM', 'local', 'applied hash'),
      S('regression', 'Run regression tests', 'linux.command', 'MEDIUM', 'local', 'regression output'),
      S('rollback-state', 'Preserve rollback state', 'files.copy', 'LOW', 'local', 'backup copy verified')
    ]
  },
  'security-harden': {
    section: '§158', title: 'Harden an authorized asset only',
    steps: [
      S('authorize-asset', 'Confirm the asset is registered and authorized', 'security.scan', 'MEDIUM', 'local', 'asset registration record'),
      S('inventory', 'Inventory services', 'sys.read', 'LOW', 'local', 'service inventory'),
      S('scan', 'Scan configuration', 'security.scan', 'MEDIUM', 'local', 'findings with evidence hashes'),
      S('prioritize', 'Prioritize risks', 'security.scan', 'LOW', 'local', 'ranked findings'),
      S('propose', 'Propose remediation', 'security.remediate', 'MEDIUM', 'local', 'remediation plan'),
      S('approve', 'Obtain approval', 'security.remediate', 'HIGH', 'local', 'approval record'),
      S('apply', 'Apply safe fixes', 'security.remediate', 'HIGH', 'local', 'change log + before/after'),
      S('verify', 'Verify and monitor', 'security.scan', 'MEDIUM', 'local', 're-scan clean')
    ]
  },
  'account-onboard': {
    section: '§159', title: 'Onboard an account through legitimate interfaces',
    steps: [
      S('discover', 'Discover whether the service supports account creation', 'account.discover', 'LOW', 'local', 'capability record'),
      S('requirements', 'Identify requirements (email/phone/payment/terms)', 'account.discover', 'LOW', 'local', 'requirements list'),
      S('register', 'Register through the official interface', 'account.create', 'HIGH', 'external', 'provider confirmation'),
      S('verify', 'Complete legitimate verification', 'account.verify', 'MEDIUM', 'external', 'provider verification state'),
      S('secure', 'Store credentials securely and enable MFA where supported', 'account.configure', 'MEDIUM', 'local', 'credential reference stored, never returned'),
      S('connect', 'Register the integration', 'account.disconnect', 'MEDIUM', 'local', 'integration record'),
      S('test', 'Test the integration', 'account.verify', 'MEDIUM', 'external', 'real API evidence'),
      S('audit', 'Audit the lifecycle', 'account.discover', 'LOW', 'local', 'audit records written')
    ]
  },
  'recovery-resume': {
    section: '§160', title: 'Recover an interrupted task without duplicating work',
    steps: [
      S('preserve', 'Preserve task state', 'knowledge.write', 'LOW', 'local', 'checkpoint list'),
      S('diagnose', 'Diagnose the failure class', 'knowledge.write', 'LOW', 'local', 'failure classification'),
      S('identify', 'Identify completed verified actions', 'knowledge.write', 'LOW', 'local', 'verified step list'),
      S('repair', 'Repair where safe and authorized', 'linux.command', 'MEDIUM', 'local', 'repair evidence'),
      S('resume', 'Resume from the checkpoint', 'knowledge.write', 'LOW', 'local', 'remaining work list'),
      S('verify', 'Verify the completed work', 'knowledge.write', 'LOW', 'local', 'verification record'),
      S('complete', 'Complete the remaining steps', 'knowledge.write', 'MEDIUM', 'local', 'final state')
    ]
  }
};

/* runPlaybook executes every step this build can actually perform and reports
 * the truthful aggregate state. `exec(step, params)` runs local steps; steps
 * marked external without a connected adapter return WAITING_FOR_CAPABILITY. */
async function runPlaybook(key, opts) {
  opts = opts || {};
  const pb = PLAYBOOKS[key];
  if (!pb) return { ok: false, state: 'FAILED', error: 'Unknown playbook: ' + key, available: Object.keys(PLAYBOOKS) };
  const exec = typeof opts.exec === 'function' ? opts.exec : null;
  const externalAvailable = opts.externalAvailable || {};
  const task = createTask(pb.title, { retryBudget: opts.retryBudget || 2 });
  advance(task, 'UNDERSTANDING');
  advance(task, 'PROBLEM_SOLVING');
  advance(task, 'PLANNING');
  const steps = [], planned = pb.steps.map(s => s.id);
  let waiting = 0, failed = 0, done = 0;
  for (const step of pb.steps) {
    if (isStepVerified(task, step.id)) { steps.push({ id: step.id, state: 'SUCCEEDED', note: 'already verified — not repeated' }); done++; continue; }
    const externalReady = step.mode === 'local' ? true : !!externalAvailable[step.capability];
    if (!externalReady) {
      waiting++;
      /* §99: the step's *result* is BLOCKED (it could not run); §151: the task
       * itself is WAITING_FOR_CAPABILITY. Both are reported, never blurred. */
      steps.push({ id: step.id, action: step.action, state: 'BLOCKED', taskState: 'WAITING_FOR_CAPABILITY', capability: step.capability, failureClass: 'EXTERNAL_DEPENDENCY', note: 'No legitimate interface connected in this build — reported truthfully, not simulated (§108).' });
      continue;
    }
    if (!exec) { waiting++; steps.push({ id: step.id, action: step.action, state: 'UNKNOWN', taskState: 'WAITING_FOR_CAPABILITY', capability: step.capability, note: 'no executor supplied — the step cannot be claimed as done' }); continue; }
    let out;
    try { out = await exec(step, opts.params || {}); } catch (e) { out = { ok: false, error: e.message }; }
    if (out && out.ok) {
      done++;
      checkpoint(task, step.id, out.evidence === undefined ? null : out.evidence);
      steps.push({ id: step.id, action: step.action, state: 'SUCCEEDED', capability: step.capability, verification: step.verification, evidence: out.evidence === undefined ? null : out.evidence });
    } else {
      const plan = correctionPlan(out || {});
      failed++;
      steps.push({ id: step.id, action: step.action, state: plan.retryAllowed ? 'RECOVERING' : 'FAILED', taskState: plan.retryAllowed ? 'CORRECTING' : 'FAILED', capability: step.capability, failureClass: plan.failureClass, diagnosis: plan.diagnosis, corrections: plan.actions });
      if (!plan.retryAllowed) break;
    }
  }
  remainingWork(task, planned);
  /* §99 result state for the run, and the §151 lifecycle state beside it. */
  const resultState = failed && done ? 'PARTIALLY_SUCCEEDED'
    : failed && !done ? 'FAILED'
      : waiting && done ? 'PARTIALLY_SUCCEEDED'
        : waiting && !done ? 'BLOCKED'
          : 'SUCCEEDED';
  const taskState = waiting && !done ? 'WAITING_FOR_CAPABILITY' : resultState;
  if (resultState === 'SUCCEEDED') { advance(task, 'EXECUTING'); advance(task, 'VERIFYING'); advance(task, 'SUCCESS'); }
  task.result = resultState;
  return {
    ok: resultState === 'SUCCEEDED' || resultState === 'PARTIALLY_SUCCEEDED' || (waiting > 0 && !failed),
    kind: 'playbook', playbook: key, section: pb.section, title: pb.title,
    state: resultState, resultState, taskState,
    realMoney: opts.realMoney === true ? 'REAL' : 'SIMULATION',
    performed: done, waitingForCapability: waiting, failed,
    steps, task: taskSummary(task)
  };
}

module.exports = {
  TASK_STATES, TASK_TRANSITIONS, createTask, advance, taskSummary,
  RESULT_STATES, isTerminalResult, normalizeResult,
  FAILURE_CLASSES, classifyFailure, failureIsRetryable,
  correctionPlan, attemptCorrection,
  CONTAINMENT_STEPS, contain,
  TX_STATES, beginTransaction,
  checkpoint, isStepVerified, remainingWork, resume,
  handoff, PROBLEM_SOLVING_STAGES, transparencyReport,
  PLAYBOOKS, runPlaybook
};
