/* ForgeLM/UAI v2 governed memory manager over WitForge authoritative state.
 * Backward compatible with existing {text,class,ts,provenance} memory records.
 */
'use strict';
const crypto = require('crypto');
const C = require('./forge-contracts.js');

const LEGACY_CLASS_MAP = Object.freeze({
  conversation: 'EPISODIC',
  project: 'PROJECT',
  preference: 'SEMANTIC',
  'task-state': 'PROCEDURAL',
  'verified-fact': 'EVIDENCE',
  'integration-state': 'CAPABILITY'
});

function words(s) {
  return new Set(String(s || '').toLowerCase().match(/[a-z0-9_\-]{2,}/g) || []);
}
function overlap(a,b) {
  const A=words(a), B=words(b);
  if (!A.size || !B.size) return 0;
  let n=0; for (const x of A) if (B.has(x)) n++;
  return n / Math.sqrt(A.size * B.size);
}
function normalize(rec) {
  const content = String(rec.content != null ? rec.content : rec.text || '');
  const type = C.MEMORY_TYPES.includes(rec.type) ? rec.type : (LEGACY_CLASS_MAP[rec.class] || 'EPISODIC');
  const createdAt = rec.createdAt || (rec.ts ? new Date(rec.ts).toISOString() : new Date().toISOString());
  return Object.assign({}, rec, {
    id: String(rec.id || ''),
    ownerId: String(rec.ownerId || 'owner'),
    namespace: String(rec.namespace || 'default'),
    type,
    content,
    summary: rec.summary == null ? null : String(rec.summary),
    confidence: Number.isFinite(Number(rec.confidence)) ? Number(rec.confidence) : (rec.verified ? 1 : 0.7),
    importance: Number.isFinite(Number(rec.importance)) ? Number(rec.importance) : 0.5,
    privacyClass: C.PRIVACY_CLASSES.includes(rec.privacyClass) ? rec.privacyClass : 'PERSONAL',
    sourceType: String(rec.sourceType || 'legacy'),
    sourceId: String(rec.sourceId || rec.provenance || rec.id || 'unknown'),
    sourceHash: String(rec.sourceHash || crypto.createHash('sha256').update(content).digest('hex')),
    validFrom: rec.validFrom || createdAt,
    validUntil: rec.validUntil || null,
    status: C.MEMORY_STATUS.includes(rec.status) ? rec.status : 'ACTIVE',
    supersedesId: rec.supersedesId || null,
    createdAt,
    updatedAt: rec.updatedAt || createdAt,
    authority: 'none',
    canInstruct: false
  });
}

function create(deps) {
  deps = deps || {};
  const getState = typeof deps.getState === 'function' ? deps.getState : () => ({ memory: [] });
  const save = typeof deps.save === 'function' ? deps.save : () => {};
  const audit = typeof deps.audit === 'function' ? deps.audit : () => {};
  const nid = typeof deps.nid === 'function' ? deps.nid : p => p + crypto.randomBytes(8).toString('hex');

  function state() {
    const s = getState();
    if (!Array.isArray(s.memory)) s.memory = [];
    if (!Array.isArray(s.forgeMemoryProposals)) s.forgeMemoryProposals = [];
    return s;
  }

  function search(query, opts) {
    opts = opts || {};
    const now = Date.now();
    const namespace = opts.namespace || null;
    const limit = Math.max(1, Math.min(50, Number(opts.limit) || 10));
    const rows = state().memory.map(normalize).filter(m => {
      if (m.status !== 'ACTIVE') return false;
      if (namespace && m.namespace !== namespace) return false;
      if (m.validUntil && new Date(m.validUntil).getTime() <= now) return false;
      if (opts.ownerId && m.ownerId !== opts.ownerId) return false;
      if (m.privacyClass === 'SECRET' && opts.includeSecret !== true) return false;
      return true;
    }).map(m => {
      const lexical = overlap(query, m.content + ' ' + (m.summary || ''));
      const age = Math.max(0, now - new Date(m.createdAt).getTime());
      const freshness = 1 / (1 + age / (30 * 24 * 60 * 60 * 1000));
      const score = 0.55 * lexical + 0.15 * freshness + 0.15 * Math.max(0,Math.min(1,m.importance)) + 0.15 * Math.max(0,Math.min(1,m.confidence));
      return { memory: m, lexical, freshness, score };
    }).filter(x => x.lexical > 0 || opts.includeZero === true)
      .sort((a,b) => (b.score-a.score) || b.memory.createdAt.localeCompare(a.memory.createdAt))
      .slice(0, limit);
    return rows;
  }

  function renderForContext(query, opts) {
    return search(query, opts).map(x => {
      const m=x.memory;
      return '• [' + m.type + '][' + m.status + '][source=' + m.sourceId + '] ' + m.content;
    }).join('\n');
  }

  function propose(input) {
    input = input || {};
    const content = String(input.content || input.text || '').trim().slice(0, 4000);
    if (!content) return { ok:false, error:'memory content required' };
    const type = C.MEMORY_TYPES.includes(input.type) ? input.type : 'EPISODIC';
    const p = {
      id: nid('mp'), content, type,
      ownerId: String(input.ownerId || 'owner'),
      namespace: String(input.namespace || 'default'),
      privacyClass: C.PRIVACY_CLASSES.includes(input.privacyClass) ? input.privacyClass : 'PERSONAL',
      confidence: Number.isFinite(Number(input.confidence)) ? Math.max(0,Math.min(1,Number(input.confidence))) : 0.7,
      importance: Number.isFinite(Number(input.importance)) ? Math.max(0,Math.min(1,Number(input.importance))) : 0.5,
      sourceType: String(input.sourceType || 'model-proposal'),
      sourceId: String(input.sourceId || 'unknown'),
      sourceHash: crypto.createHash('sha256').update(content).digest('hex'),
      createdAt: new Date().toISOString(),
      status: 'PROPOSED'
    };
    const s=state();
    s.forgeMemoryProposals.unshift(p);
    if (s.forgeMemoryProposals.length > 200) s.forgeMemoryProposals.length = 200;
    audit('memory','Forge memory proposal ' + p.id + ' [' + p.type + ']','guard',{ action:'memory.propose', decision:'ALLOW', risk:'LOW', result:'SUCCEEDED' });
    save();
    return { ok:true, proposal:p };
  }

  function approve(proposalId, opts) {
    opts = opts || {};
    const s=state();
    const idx=s.forgeMemoryProposals.findIndex(x => x.id === proposalId);
    if (idx < 0) return { ok:false, error:'unknown memory proposal' };
    const p=s.forgeMemoryProposals[idx];
    const duplicate=s.memory.map(normalize).find(x => x.status === 'ACTIVE' && x.namespace === p.namespace && x.sourceHash === p.sourceHash);
    if (duplicate) {
      s.forgeMemoryProposals.splice(idx,1); save();
      return { ok:false, duplicate:true, existingId:duplicate.id, error:'duplicate memory' };
    }
    const now=new Date().toISOString();
    const id=nid('m');
    const rec={
      id, ownerId:p.ownerId, namespace:p.namespace, type:p.type, content:p.content, summary:null,
      confidence:p.confidence, importance:p.importance, privacyClass:p.privacyClass,
      sourceType:p.sourceType, sourceId:p.sourceId, sourceHash:p.sourceHash,
      validFrom:now, validUntil:null, status:'ACTIVE', supersedesId:opts.supersedesId || null,
      createdAt:now, updatedAt:now, authority:'none', canInstruct:false,
      // legacy compatibility:
      text:p.content, class:'conversation', ts:Date.now(), provenance:p.sourceId, verified:p.type === 'EVIDENCE'
    };
    if (rec.supersedesId) {
      const old=s.memory.find(x => x.id === rec.supersedesId);
      if (old) { old.status='SUPERSEDED'; old.updatedAt=now; }
    }
    s.memory.unshift(rec);
    s.forgeMemoryProposals.splice(idx,1);
    if (s.memory.length > 400) s.memory.length=400;
    audit('memory','Forge memory committed ' + rec.id + ' [' + rec.type + ']','user',{ action:'memory.approve', decision:'ALLOW', risk:'LOW', result:'SUCCEEDED' });
    save();
    return { ok:true, memory:normalize(rec) };
  }

  function reject(proposalId, reason) {
    const s=state();
    const idx=s.forgeMemoryProposals.findIndex(x => x.id === proposalId);
    if (idx < 0) return { ok:false, error:'unknown memory proposal' };
    const p=s.forgeMemoryProposals.splice(idx,1)[0];
    audit('memory','Forge memory proposal rejected ' + p.id + ': ' + String(reason || 'no reason').slice(0,120),'user',{ action:'memory.reject', decision:'ALLOW', risk:'LOW', result:'SUCCEEDED' });
    save(); return { ok:true };
  }

  function expire(memoryId, reason) {
    const s=state(), rec=s.memory.find(x => x.id === memoryId);
    if (!rec) return { ok:false, error:'unknown memory' };
    rec.status='EXPIRED'; rec.validUntil=new Date().toISOString(); rec.updatedAt=rec.validUntil;
    audit('memory','Forge memory expired ' + memoryId + ': ' + String(reason || '').slice(0,100),'user',{ action:'memory.expire', decision:'ALLOW', risk:'LOW', result:'SUCCEEDED' });
    save(); return { ok:true, memory:normalize(rec) };
  }

  function stats() {
    const s=state(), rows=s.memory.map(normalize);
    return {
      total: rows.length,
      active: rows.filter(x=>x.status==='ACTIVE').length,
      proposed: s.forgeMemoryProposals.length,
      byType: Object.fromEntries(C.MEMORY_TYPES.map(t => [t, rows.filter(x=>x.type===t).length]))
    };
  }

  return { normalize, search, renderForContext, propose, approve, reject, expire, stats };
}

module.exports = { create, normalize, overlap };
