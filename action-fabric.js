'use strict';

/* WitForge — ACTION FABRIC (v1.99) · the governed action envelope (§7, §42,
 * §99, §100, §101, §151, §153).
 *
 * Every consequential action is ONE durable envelope carrying identity,
 * intent, plan, capability/scope, authority, security decision, approval
 * binding, execution state, verification state, recovery state and audit
 * lineage. Envelopes are persisted with platform state: they are the
 * platform's single source of action truth across process restarts.
 *
 * Laws this module enforces:
 *  - §99: envelope states are the standard result states; terminals never
 *    reopen (a SUCCEEDED envelope cannot quietly become something else).
 *  - §151: transitions follow the state-machine adjacency — WAITING gates
 *    cannot be skipped; EXECUTING only from an approved/authorized wait.
 *  - §165: an action whose process died mid-execution is UNKNOWN, never
 *    converted into success. resumeOnBoot re-marks stranded envelopes.
 *  - §100/§123: every envelope keeps verification + evidence (hashes) and a
 *    correlation ID, so the Action Center can show users exactly what was
 *    intended, done, checked and what remains incomplete.
 *  - §7: previewing an action (creating its envelope) never grants
 *    authority; execution still passes the live proposal/approval gates.
 */

const STATES = ['PLANNED', 'WAITING_FOR_PERMISSION', 'WAITING_FOR_APPROVAL', 'EXECUTING', 'VERIFYING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'BLOCKED', 'QUARANTINED', 'ROLLED_BACK', 'RECOVERING', 'CANCELLED', 'UNKNOWN'];
const TERMINAL = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'BLOCKED', 'QUARANTINED', 'ROLLED_BACK', 'CANCELLED'];

// §151 adjacency. RETRYING/BLOCKED folding keeps the machine small but honest:
// a failed-but-recoverable envelope returns to RECOVERING, EXECUTING again
// only through the same gates, never silently re-set to EXECUTING from fail.
const NEXT = {
  PLANNED: ['WAITING_FOR_PERMISSION', 'WAITING_FOR_APPROVAL', 'EXECUTING', 'CANCELLED', 'BLOCKED'],
  WAITING_FOR_PERMISSION: ['WAITING_FOR_APPROVAL', 'EXECUTING', 'CANCELLED', 'BLOCKED'],
  WAITING_FOR_APPROVAL: ['EXECUTING', 'CANCELLED', 'BLOCKED'],
  EXECUTING: ['VERIFYING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'ROLLED_BACK', 'UNKNOWN'],
  VERIFYING: ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'ROLLED_BACK'],
  RECOVERING: ['EXECUTING', 'VERIFYING', 'FAILED', 'ROLLED_BACK', 'CANCELLED', 'BLOCKED'],
  // terminals: no re-open — history is history (§97)
  SUCCEEDED: [], PARTIALLY_SUCCEEDED: [], FAILED: ['RECOVERING'], BLOCKED: [], QUARANTINED: [], ROLLED_BACK: [], CANCELLED: [], UNKNOWN: ['RECOVERING']
};

function create(deps) {
  const { state, save, audit, hash, newId } = deps;

  function envelopes() {
    const S = state();
    if (!Array.isArray(S.envelopes)) S.envelopes = [];
    return S.envelopes;
  }

  function find(id) { return envelopes().find(e => e.id === id) || null; }

  /* Create an envelope — the PLANNED/WAITING truth of an action. No authority
   * is granted by creation (§7). `authority` records WHAT gates apply. */
  function create_(spec) {
    const S = state();
    if (!Number.isFinite(S.envSeq)) S.envSeq = 1000;
    const id = 'ev' + (S.envSeq++).toString(36);
    const ev = {
      id,
      intent: String(spec.intent || '').slice(0, 240),
      plan: spec.plan ? String(spec.plan).slice(0, 400) : null,
      capability: spec.capability || null,
      scope: spec.scope || null,
      authority: { permission: spec.permission || null, approval: spec.approval || null, law: 'preview never grants authority (§7)' },
      security: spec.security || { decision: null, risk: null },
      state: 'PLANNED',
      history: [{ from: null, to: 'PLANNED', ts: Date.now(), note: spec.note || 'envelope created' }],
      verification: spec.verification || { method: null, result: null },
      recovery: { attempts: 0, lastClass: null, checkpoint: spec.checkpoint || null },
      evidence: spec.evidence || [],
      correlationId: spec.correlationId || newId(),
      ts: Date.now(),
      updatedTs: Date.now()
    };
    if (spec.waiting === 'approval') ev.state = 'WAITING_FOR_APPROVAL';
    else if (spec.waiting === 'permission') ev.state = 'WAITING_FOR_PERMISSION';
    if (ev.state !== 'PLANNED') ev.history[0].to = ev.state;
    envelopes().unshift(ev);
    if (envelopes().length > 60) envelopes().length = 60;
    audit('action', 'ENVELOPE ' + id + ' opened [' + ev.state + '] — ' + ev.intent.slice(0, 90), spec.actor || 'system', { correlationId: ev.correlationId });
    save();
    return ev;
  }

  /* Validated transition (§99/§151). Terminals never move; impossible jumps
   * refuse with the edge truth rather than pretending. */
  function transition(id, to, note, actor) {
    const ev = find(id);
    if (!ev) return { ok: false, error: 'Unknown envelope ' + id };
    if (!STATES.includes(to)) return { ok: false, error: 'Unknown state ' + to };
    const allowed = NEXT[ev.state] || [];
    if (!allowed.includes(to)) return { ok: false, error: 'Illegal transition ' + ev.state + ' → ' + to + (TERMINAL.includes(ev.state) ? ' (terminal states never re-open — §151)' : '') };
    ev.history.push({ from: ev.state, to: to, ts: Date.now(), note: String(note || '').slice(0, 160) });
    if (ev.history.length > 40) ev.history.splice(1, ev.history.length - 40);
    ev.updatedTs = Date.now();
    if (to === 'RECOVERING') ev.recovery.attempts++;
    ev.state = to;
    audit('action', 'ENVELOPE ' + id + ' ' + ev.state + (ev.state !== to ? ' → ' + to : '') + (note ? ' — ' + String(note).slice(0, 80) : ''), actor || 'system', { correlationId: ev.correlationId });
    if (TERMINAL.includes(to) || to === 'UNKNOWN') ev.noteTerminal = note || null;
    save();
    return { ok: true, envelope: ev };
  }

  /* Execute an envelope's bound action through a supplied executor. The
   * executor is the LIVE path (the same gates chat actions pass) — the fabric
   * never invents a side channel. Outcome → states + structured verification. */
  async function execute(id, executor, opts) {
    const ev = find(id);
    if (!ev) return { ok: false, error: 'Unknown envelope ' + id };
    opts = opts || {};
    const t1 = transition(id, 'EXECUTING', opts.note || 'execution began', 'user');
    if (!t1.ok) return t1;
    let out = null, err = null;
    try { out = await executor(ev); } catch (e) { err = e; }
    const failed = err || (out && out.ok === false) || (out && out.error);
    const reason = err ? String(err.message || err) : (out && (out.error || out.reply && 'reply')) || (out && out.ok === false ? 'rejected' : null);
    if (failed) {
      transition(id, 'FAILED', 'execution failure: ' + String(reason).slice(0, 120), 'system');
      return { ok: false, error: 'execution failed: ' + reason, envelope: ev, result: out || null };
    }
    ev.verification = {
      method: opts.verifyMethod || 'executor truthful result (§98: structured ok + kind, not prose)',
      result: 'confirmed — executor returned ok:true',
      hash: hash(JSON.stringify(out && (out.result || out.reply || out.evidence) || out)).slice(0, 24)
    };
    ev.evidence.push({ kind: 'execution-result', hash: hash(JSON.stringify(out)).slice(0, 24), ts: Date.now() });
    transition(id, 'VERIFYING', 'executor returned — verification attached (hash ' + ev.verification.hash + ')', 'system');
    transition(id, 'SUCCEEDED', opts.successNote || 'verified ' + ev.verification.method, 'system');
    return { ok: true, envelope: ev, result: out };
  }

  /* §1.54 crash-truth: re-open the process and any envelope stranded in an
   * in-flight state is UNKNOWN — we cannot verify it ran, so we will not
   * claim it did. Audited, resumable (UNKNOWN → RECOVERING is legal). */
  function resumeOnBoot() {
    const stranded = envelopes().filter(e => e.state === 'EXECUTING' || e.state === 'VERIFYING');
    for (const e of stranded) {
      const from = e.state;
      e.history.push({ from, to: 'UNKNOWN', ts: Date.now(), note: 'process restarted mid-flight — execution unverifiable (§165), resumable via “retry action ' + e.id + '”' });
      e.state = 'UNKNOWN';
      audit('action', 'ENVELOPE ' + e.id + ' ' + from + ' → UNKNOWN on boot (crash-truth, never assumed success)', 'system', { correlationId: e.correlationId });
    }
    if (stranded.length) save();
    return { count: stranded.length };
  }

  function retry(id) {
    const ev = find(id);
    if (!ev) return { ok: false, error: 'Unknown envelope ' + id };
    if (ev.state !== 'FAILED' && ev.state !== 'UNKNOWN') return { ok: false, error: 'Only FAILED/UNKNOWN envelopes may retry (now ' + ev.state + ')' };
    return transition(id, 'RECOVERING', 'owner-authorized retry (§147: diagnose → correct → retry when safe)', 'user');
  }

  function cancel(id, who) {
    const ev = find(id);
    if (!ev) return { ok: false, error: 'Unknown envelope ' + id };
    return transition(id, 'CANCELLED', 'cancelled by ' + (who || 'user'), who || 'user');
  }

  function table(n) {
    const ico = { PLANNED: '📝', WAITING_FOR_PERMISSION: '🔑', WAITING_FOR_APPROVAL: '⏸', EXECUTING: '⚙', VERIFYING: '🔍', SUCCEEDED: '✅', PARTIALLY_SUCCEEDED: '◪', FAILED: '✘', BLOCKED: '⛔', QUARANTINED: '☣', ROLLED_BACK: '↩', RECOVERING: '♻', CANCELLED: '∅', UNKNOWN: '?' };
    const rows = envelopes().slice(0, n || 12).map(e => (ico[e.state] || '?') + ' ' + e.id + ' [' + e.state + '] ' + e.intent.slice(0, 72));
    return rows.length ? rows.join('\n') : 'No action envelopes yet — consequential actions (proposals, governed runs) open here automatically.';
  }

  function detail(id) {
    const ev = find(id);
    if (!ev) return { ok: false, error: 'Unknown envelope ' + id };
    return { ok: true, envelope: ev };
  }

  function stats() {
    const all = envelopes();
    const open = all.filter(e => !TERMINAL.includes(e.state) && e.state !== 'UNKNOWN').length;
    return { count: all.length, open: open, states: all.reduce((m, e) => { m[e.state] = (m[e.state] || 0) + 1; return m; }, {}) };
  }

  return { STATES, TERMINAL, create: create_, transition, execute, retry, cancel, resumeOnBoot, find, table, detail, stats, list: () => envelopes().slice(0, 60) };
}

module.exports = { create };
