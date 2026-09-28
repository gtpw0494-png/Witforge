/* LIAM — AI Control Centre · conversational operating surface.
 * The server is authoritative (state, permissions, approvals, execution,
 * audit, ledger). The user's request grants permission; explicit approval
 * governs high-risk actions; nothing is ever simulated as success.
 */
'use strict';

/* ── Module registry ─────────────────────────────────────────────── */
const STATE = {
  operational: { pill: 'OPERATIONAL', cls: 'operational', eyebrow: 'READY' },
  config:      { pill: 'CONFIGURATION REQUIRED', cls: 'config', eyebrow: 'SETUP REQUIRED' },
  disconnected:{ pill: 'DISCONNECTED', cls: 'disconnected', eyebrow: 'NOT CONNECTED' },
  simulation:  { pill: 'SIMULATION', cls: 'simulation', eyebrow: 'SIMULATION MODE' }
};
function m(id, section, label, icon, state, source, sub, extra) {
  return Object.assign({ id, section, label, icon, state, source, sub, control: 'User controlled' }, extra || {});
}
const MODULES = [
  m('chat', 'CORE', 'Chat', '✦', 'operational', 'Local LIAM store', 'The primary control surface. Request anything — your request is the permission; high-risk actions queue for your approval.'),
  m('conversations', 'CORE', 'Conversations', '▣', 'operational', 'Local LIAM store', 'History, search, archive and project context.'),
  m('projects', 'CORE', 'Projects', '◇', 'operational', 'Local LIAM store', 'Persistent workspaces for goals, tasks and context.'),
  m('research', 'CORE', 'Research', '⌁', 'config', 'Configured provider required', 'Retrieval-backed research with attributable sources only.', {
    facetBlurb: 'Only retrieved, attributable sources should be presented as live research.',
    truthNote: 'This capability is intentionally shown as configuration-required until a real provider, credential and verification flow are connected. Use “fetch <url>” or “weather in <place>” in Chat for real guarded retrievals.'
  }),
  m('tasks', 'CORE', 'Tasks', '✓', 'operational', 'Local LIAM store', 'Create, track and verify work items — by UI or by asking LIAM.'),
  m('automations', 'CORE', 'Automations', '↻', 'operational', 'Built-in scheduler runtime', 'Server-ticked reminders and recurring schedules (15s tick, survives closed chat) — real, audited events.'),
  m('memory', 'CORE', 'Memory', '●', 'operational', 'Local LIAM store', 'Persistent records with provenance. Memory is information — not authority.'),
  m('files', 'CORE', 'Files', '▤', 'operational', 'Sandboxed filesystem', 'Real reads/writes inside the server userfiles sandbox, path-traversal protected, integrity-hashed.'),
  m('knowledge', 'AI', 'Knowledge', '✦', 'operational', 'Local LIAM store', 'Indexed records with provenance; untrusted until verified.'),
  m('agents', 'AI', 'Agents', '▣', 'operational', 'Local LIAM store', 'Explicit identities with bounded scope. Agents cannot elevate themselves.'),
  m('tools', 'AI', 'Tools', '◇', 'operational', 'Capability broker', 'Live adapter registry and the real tool executor: scoped FS, guarded HTTP, weather, allowlisted exec.'),
  m('models', 'AI', 'Models', '⌁', 'config', 'Configured provider required', 'Model discovery requires a live verified provider (Puter bridge or configured server).'),
  m('permissions', 'CONTROL', 'Permissions', '◉', 'operational', 'Local LIAM store', 'Capability grants. Requesting a capability in Chat grants it — audited.'),
  m('approvals', 'CONTROL', 'Approvals', '▣', 'operational', 'Local LIAM store', 'Your decisions on high-risk actions. Approve or stop, by button or by asking.'),
  m('termux', 'CONTROL', 'Termux', '⌁', 'disconnected', 'Termux runtime not detected', 'Termux execution is real only when a Termux runtime is detected.'),
  m('puter', 'CONTROL', 'Puter', '↻', 'config', 'Provider connection required', 'Optional Puter.js bridge: live model discovery and chat. External output stays untrusted.'),
  m('credentials', 'CONTROL', 'Credentials', '⚿', 'operational', 'Encrypted local cred store', 'AI provider and social-platform keys: stored AES-256-GCM encrypted, never returned by APIs, used only for their own service. Verify proves each one live.'),
  m('github', 'CONTROL', 'GitHub', '↻', 'config', 'Token / OAuth required', 'Real GitHub REST reads when GITHUB_TOKEN is configured on the server.'),
  m('device', 'CONTROL', 'Device (capability)', '◇', 'disconnected', 'Device bridge not connected', 'Capability page for the device-bridge module.'),
  m('devices', 'CONTROL', 'Devices', '◇', 'operational', 'Local device registry', 'Paired devices with trust states, per-device capabilities, replay-protected commands and checkpoints.'),
  m('security', 'SECURITY', 'Security', '◉', 'operational', 'Local LIAM store', 'Emergency states and stops, risk matrix, policy decisions, SSRF shield events, permission and approval posture.'),
  m('evidence', 'SECURITY', 'Evidence', '▤', 'operational', 'Local vault + monitors', 'Tamper-evident evidence vault, anti-fraud monitor, metrics, spans and correlation timelines.'),
  m('guardian', 'SECURITY', 'Guardian', '🛡', 'operational', 'Owner protection layer', 'Personal security for your account and the duty charter that keeps agents serving you: second factor, sessions, alerts, threat matrix.'),
  m('audit', 'SECURITY', 'Audit', '≡', 'operational', 'Local LIAM store', 'Structured records: actor, capability, decision, reason, risk, approval, result, correlation id.'),
  m('profile', 'ACCOUNT', 'Profile', '✦', 'operational', 'Local LIAM store', 'Local identity record. Owner data stays on this device.'),
  m('subscription', 'ACCOUNT', 'Subscription', '▣', 'operational', 'Local LIAM store', 'Local plan record. No payment processing is active.'),
  m('organization', 'ACCOUNT', 'Organization', '◇', 'operational', 'Local LIAM store', 'Organization structure and roles (local record).'),
  m('plans', 'ACCOUNT', 'Plans', '◈', 'operational', 'Local plan record', 'Personal and business tiers with server-side entitlements. Billing stays compliance-locked.'),
  m('billing', 'ACCOUNT', 'Billing', '⌁', 'config', 'Compliance-locked', 'Real-money billing stays disabled until legal and compliance review.'),
  m('ldcoins', 'COMMERCE', 'LD Coins', '✦', 'simulation', 'Simulation ledger', 'Balanced double-entry simulation ledger. 100 LD = A$1.00 reference. Self-test included.'),
  m('ldmarket', 'COMMERCE', 'LD Market', '⇄', 'simulation', 'Simulation trading', 'Buy and sell LD in the app at the reference rate with a disclosed spread. Real money stays compliance-locked.'),
  m('events', 'COMMERCE', 'Events', '★', 'operational', 'Events board', 'Timed events with entry fees, prize pools and the 1% Treasury rule.'),
  m('lotto', 'COMMERCE', 'Lotto', '◎', 'simulation', 'Simulation lotto', 'Six numbers from 1–49, tickets in LD, commit→reveal fairness you can verify yourself.'),
  m('rewards', 'COMMERCE', 'Rewards', '✧', 'operational', 'Sign-in + task board', 'Daily sign-in gifts and the daily/weekly task board, paid from funded pools.'),
  m('avatar', 'COMMERCE', 'Avatar Studio', '▣', 'operational', 'Local LIAM store', 'Create an avatar from 100 races of the Diablo & Skyrim lineage. Every avatar starts naked.'),
  m('inventory', 'COMMERCE', 'Inventory', '◇', 'operational', 'Local LIAM store', 'Arena loot inventory with provenance, per avatar.'),
  m('marketplace', 'COMMERCE', 'Marketplace', '⌁', 'simulation', 'Simulation economy', 'Listings and trades run in labelled simulation mode.'),
  m('auctions', 'COMMERCE', 'Auctions', '✓', 'simulation', 'Simulation economy', 'Auction flow with escrow in labelled simulation mode.'),
  m('arena', 'COMMERCE', 'Arena', '⚔', 'operational', 'Local arena engine', 'Server-authoritative PvP brawls. Diablo stats & loot, Skyrim skills. Wagers compliance-locked.'),
  m('notifications', 'SYSTEM', 'Notifications', '✦', 'operational', 'Local LIAM store', 'Local notification centre fed by audit events.'),
  m('documentation', 'SYSTEM', 'Documentation', '▣', 'operational', 'Legal + lineage records', 'Versioned legal documents, architecture lineage and truth rules.'),
  m('status', 'SYSTEM', 'Status', '◇', 'operational', 'Local LIAM store', 'Live runtime truth: adapters, emergency state, ledger mode, connectivity.'),
  m('spec', 'SYSTEM', 'Spec', '◈', 'operational', '177-requirement registry', 'Live coverage of the definitive WitForge specification with evidence probes.'),
  m('settings', 'SYSTEM', 'Settings', '⌁', 'operational', 'Local LIAM store', 'User-controlled preferences and data controls.')
];
const byId = id => MODULES.find(x => x.id === id);
const SECTIONS = ['CORE', 'AI', 'CONTROL', 'SECURITY', 'ACCOUNT', 'COMMERCE', 'SYSTEM'];
const LIVE = new Set(['chat', 'conversations', 'tasks', 'projects', 'agents', 'memory', 'knowledge', 'files', 'tools', 'permissions', 'approvals', 'security', 'evidence', 'guardian', 'audit', 'devices', 'credentials', 'ldcoins', 'ldmarket', 'events', 'lotto', 'rewards', 'plans', 'status', 'settings', 'spec', 'documentation', 'profile', 'puter', 'avatar', 'arena', 'marketplace', 'automations', 'notifications', 'inventory']);

/* ── Helpers ─────────────────────────────────────────────────────── */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* v1.91: every piece renders with its identity-keyed sigil portrait; pieces
 * from older responses without art fall back to a null-safe empty string. */
/* v1.93: piece registry + inspector — every rendered piece registers by fp;
 * clicking any portrait opens the Piece Inspector (big procedural portrait,
 * full provenance: slot/rarity band/rlevel/power/element/resists/fp). */
const PIECE_REG = {};
const registerPiece = i => { if (i && i.fp && i.art) PIECE_REG[i.fp] = i; return i; };
const pieceThumb = (i, s) => (i && i.art && i.art.dataUri) ? (registerPiece(i), `<img class="piece-thumb inspectable" data-inspect-fp="${esc(i.fp)}" width="${s || 26}" height="${s || 26}" src="${i.art.dataUri}" alt="${esc(i.name || 'piece')}" title="${esc(i.name || '')} · ${esc((i.art.band || i.rarity || ''))} — click to inspect">`) : '';
/* ── v1.96: opt-in AI-painted art via Puter (the ONLY sanctioned external
 * runtime, spec C(69)). Default and fallback stay the deterministic
 * procedural sigils — pieces always have pictures offline. Puter loads
 * lazily, only when the owner turns it on; results cache per-identities in
 * localStorage; the thumb title says exactly which layer painted it. ── */
const AIArt = {
  enabled() { try { return localStorage.getItem('wf.aiart') === 'on'; } catch (e) { return false; } },
  set(on) { try { localStorage.setItem('wf.aiart', on ? 'on' : 'off'); } catch (e) {} if (on) this._ensure(); toast(on ? 'AI art ON — Puter will paint the piece thumbnails that appear next (external call, only on this toggle).' : 'AI art off — deterministic sigil portraits only.'); },
  _promise: null,
  _ensure() {
    if (window.puter) return Promise.resolve(true);
    if (!this._promise) {
      this._promise = new Promise(res => {
        if (this._disabled) return res(false);
        const s = document.createElement('script');
        s.src = 'https://js.puter.com/v2/';
        const timer = setTimeout(() => { this._disabled = true; res(false); }, 8000);
        s.onload = () => { clearTimeout(timer); const ok2 = !!(window.puter && window.puter.ai && window.puter.ai.txt2img); this._disabled = !ok2; res(ok2); };
        s.onerror = () => { clearTimeout(timer); this._disabled = true; res(false); };
        document.head.appendChild(s);
      });
    }
    return this._promise;
  },
  _cacheGet(fp) { try { return localStorage.getItem('wf.art.' + fp); } catch (e) { return null; } },
  _cacheSet(fp, v) { try { const keys = Object.keys(localStorage).filter(k => k.startsWith('wf.art.')); if (keys.length > 40) localStorage.removeItem(keys[0]); localStorage.setItem('wf.art.' + fp, v); } catch (e) {} },
  applyImmediate(container) {
    if (!this.enabled()) return;
    const imgs = [...(container || document).querySelectorAll('img[data-inspect-fp]:not([data-ai-attempted])')];
    imgs.forEach(img => {
      img.setAttribute('data-ai-attempted', '1');
      const fp = img.getAttribute('data-inspect-fp');
      const cached = this._cacheGet(fp);
      if (cached) { img.src = cached; img.title = (img.title || '') + ' · AI-painted via Puter (external, owner-opted-in; procedural sigil kept as fallback)'; return; }
      if (this._disabled) return;
      this._ensure().then(ok => {
        if (!ok) { return; }
        const p = PIECE_REG[fp]; if (!p) return;
        const prompt = `${p.slot || 'equipment'} ${p.rarity || ''} medieval fantasy game item icon titled "${p.name}", ${p.color || '#a894ff'} accent glow, dark emblem style, centered single item, painterly, no text`;
        window.puter.ai.txt2img(prompt, true).then(url => {
          const src = typeof url === 'string' ? url : (url && url.src) || '';
          if (!src) return;
          img.src = src; img.setAttribute('data-ai-done', '1');
          img.title = (img.title || '') + ' · AI-painted via Puter (external, owner-opted-in; procedural sigil kept as fallback)';
          if (src.startsWith('data:') && src.length < 380000) this._cacheSet(fp, src);
        }).catch(() => {});
      });
    });
  }
};
let _artObs = null;
function ensureArtObserver() {
  /* DOM-guarded: the smoke harness evaluates this file outside a browser. */
  if (_artObs || typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body) return;
  _artObs = new MutationObserver(() => { if (AIArt.enabled()) { clearTimeout(ensureArtObserver._t); ensureArtObserver._t = setTimeout(() => AIArt.applyImmediate(document.getElementById('main')), 350); } });
  _artObs.observe(document.body, { childList: true, subtree: true });
}

function openPieceInspector(fp) {
  const p = PIECE_REG[fp]; if (!p) { toast('Piece no longer on screen.'); return; }
  let card = document.getElementById('pieceInspector');
  if (!card) {
    card = document.createElement('div'); card.id = 'pieceInspector';
    card.style.cssText = 'position:fixed;inset:0;background:rgba(6,3,10,.86);display:flex;align-items:center;justify-content:center;z-index:999;backdrop-filter:blur(4px)';
    card.onclick = e => { if (e.target === card || e.target.closest('[data-close-inspector]')) card.remove(); };
    document.body.appendChild(card);
  }
  const rows = [['Slot', p.slot + (p.kind ? ' · ' + p.kind : '')], ['Rarity', p.rarity + ' · R' + p.rlevel], ['Power', p.power] ];
  if (p.element) rows.push(['Element', p.element]);
  if (p.resists) rows.push(['Resists', Object.entries(p.resists).map(([k, v]) => k + ' +' + v + '%').join(' · ')]);
  if (p.species) rows.push(['Species', p.species]);
  rows.push(['Identity (fp)', String(p.fp || '').slice(0, 22)]);
  card.innerHTML = `<div style="background:#17101f;border:1px solid #2b1d45;border-radius:16px;padding:22px;max-width:340px;text-align:center">
    <img src="${p.art.dataUri}" width="168" height="168" style="border-radius:14px;box-shadow:0 0 32px ${esc(p.art.accent || '#a894ff')}44">
    <h3 style="color:${esc(p.color || '#cbb8ff')};margin:12px 0 2px">${esc(p.name || '')}</h3>
    <p style="color:#9a86c8;font-size:11px;margin:0 0 12px">sigil portrait — deterministic by identity · same piece, same picture, forever</p>
    ${rows.map(r => `<div class="kv" style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid #2b1d4533"><span style="color:#9a86c8">${esc(r[0])}</span><b style="color:#e8dcff">${esc(String(r[1]))}</b></div>`).join('')}
    <button class="mini-btn" data-close-inspector style="margin-top:14px">Close</button></div>`;
}
document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-inspect-fp]'); if (t) openPieceInspector(t.getAttribute('data-inspect-fp')); });
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = ts => new Date(ts).toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + fmtTime(ts);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._h); toast._h = setTimeout(() => { t.hidden = true; }, 2800); }
let OFFLINE = false;
function showOfflineBanner() {
  if ($('#offlineBanner')) return;
  const b = document.createElement('div');
  b.id = 'offlineBanner';
  b.innerHTML = '⚠ <b>BACKEND OFFLINE — STATIC PREVIEW.</b> This page is hosted without the LIAM server. For live control run <code>node server.js</code> locally and open <code>http://127.0.0.1:8787</code>. Nothing here is simulated or faked — data panels stay empty until a real backend answers.';
  document.body.appendChild(b);
}
function enterOffline() { if (!OFFLINE) { OFFLINE = true; showOfflineBanner(); refreshStatus(); } }
async function api(path, opts) {
  try {
    const request = Object.assign({ credentials: 'same-origin' }, opts || {});
    const r = await fetch(path, request);
    if (OFFLINE) { OFFLINE = false; const b = $('#offlineBanner'); if (b) b.remove(); refreshStatus(); }
    const raw = await r.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch (e) { data = { ok: false, error: 'invalid-json-response', detail: raw.slice(0, 240) }; }
    if (r.status === 401) { toast('Owner sign-in required — open Profile to unlock this session.'); return Object.assign({ ok: false, error: 'auth-required', status: 401 }, data); }
    if (!r.ok) {
      const msg = data.error || data.message || ('HTTP ' + r.status);
      toast('Request failed: ' + String(msg).slice(0, 120));
      return Object.assign({ ok: false, error: msg, status: r.status }, data);
    }
    return data;
  }
  catch (e) { enterOffline(); return { ok: false, offline: true, error: 'offline', detail: String(e && e.message || e) }; }
}
const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

/* Build 8: no silent-dead controls. Renderer mistakes and rejected async
 * handlers surface to the owner instead of disappearing in the console. */
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', e => {
    const msg = e && e.reason && (e.reason.message || e.reason) || 'unknown async error';
    toast('Action failed: ' + String(msg).slice(0, 140));
  });
  window.addEventListener('error', e => {
    if (e && e.message) toast('UI error: ' + String(e.message).slice(0, 140));
  });
}

let S = null; // server state snapshot
async function refreshState() { const j = await api('/api/state'); if (j.ok) S = j; return S; }

/* ── Navigation ──────────────────────────────────────────────────── */
let currentView = 'conversations';
function renderNav() {
  $('#nav').innerHTML = SECTIONS.map(sec =>
    `<div class="workspace-label">${sec}</div>` +
    MODULES.filter(x => x.section === sec).map(x =>
      `<button class="nav ${x.id === currentView ? 'active' : ''}" data-view="${x.id}" title="${esc(x.label)}"><i class="navicon">${x.icon}</i><span class="navlabel">${esc(x.label)}</span></button>`).join('')).join('');
}
async function setView(id, opts) {
  const mod = byId(id); if (!mod) return;
  currentView = id;
  document.body.classList.remove('sidebar-open');
  renderNav();
  $('#crumbCurrent').textContent = mod.label;
  if (!S) await refreshState();
  if (LIVE.has(id)) await renderLive(id);
  else renderCapability(mod);
  if (!opts || !opts.silent) post('/api/audit', { type: 'nav', detail: 'Opened ' + mod.label });
  window.scrollTo({ top: 0 });
}

/* audit endpoint convenience */
api; // (noop reference keeps linters calm)

/* ── Capability page (non-live modules) ──────────────────────────── */
const FACETS = [
  { id: 'overview', label: 'Overview', icon: '◈' },
  { id: 'configuration', label: 'Configuration', icon: '✳' },
  { id: 'permissions', label: 'Permissions', icon: '◉' },
  { id: 'activity', label: 'Activity', icon: '◌' },
  { id: 'history', label: 'History', icon: '▤' },
  { id: 'documentation', label: 'Documentation', icon: '?' }
];
function renderCapability(mod) {
  const st = STATE[mod.state];
  const facets = FACETS.map(f => {
    const blurb = mod.facetBlurb || `${f.label} for ${mod.label}, backed by the configured LIAM data model.`;
    return `<button class="module-card" data-facet="${f.id}" data-module="${mod.id}"><span class="module-icon">${f.icon}</span><span class="module-body"><h3>${f.label}</h3><p>${esc(blurb)}</p></span><span class="module-open">Open ↗</span></button>`;
  }).join('');
  const truth = mod.truthNote ? `<div class="truth-card"><b>Truth &amp; safety</b><p>${esc(mod.truthNote)}</p></div>` : '';
  $('#main').innerHTML = `<div class="page-head"><div><p class="eyebrow">${st.eyebrow}</p><h1>${esc(mod.label)}</h1><p class="page-sub">${esc(mod.sub)}</p></div></div>
  <div class="stat-grid">
    <div class="stat-card"><p class="stat-label">Capability state</p><span class="pill ${st.cls}">${st.pill}</span></div>
    <div class="stat-card"><p class="stat-label">Data source</p><p class="stat-value">${esc(mod.source)}</p></div>
    <div class="stat-card"><p class="stat-label">Control model</p><p class="stat-value">${esc(mod.control)}</p></div>
  </div><div class="module-list">${facets}</div>${truth}`;
}
function kv(rows) { return rows.map(r => `<div class="kv"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join(''); }
function card(title, inner) { return `<div class="facet-card"><h4>${esc(title)}</h4>${inner}</div>`; }
function openFacet(moduleId, facetId) {
  const mod = byId(moduleId), f = FACETS.find(x => x.id === facetId);
  if (!mod || !f || !S) return;
  $('#facetEyebrow').textContent = mod.section + ' / ' + mod.label.toUpperCase();
  $('#facetTitle').textContent = f.label;
  $('#facetSub').textContent = mod.sub;
  const st = STATE[mod.state];
  let html = '';
  if (facetId === 'overview') html = card('About', `<p>${esc(mod.sub)}</p>`) + card('State', kv([['Capability state', st.pill], ['Data source', mod.source], ['Control model', mod.control], ['Emergency', S.emergency]]));
  else if (facetId === 'configuration') html = card('Configuration', kv([['Data source', mod.source], ['Control model', mod.control], ['Persistence', 'Server store (SQLite/WAL or atomic JSON compatibility mode)'], ['External telemetry', 'None']]));
  else if (facetId === 'permissions') html = card('Effective permissions', kv([['Local read/write', 'GRANTED — user controlled'], ['External network', 'Granted per-request via Chat or Permissions workspace'], ['High-risk actions', 'Approval-gated'], ['Emergency', S.emergency]]));
  else if (facetId === 'activity') {
    const evts = S.audit.filter(a => (a.detail || '').toLowerCase().includes(mod.label.toLowerCase()) || a.type === mod.id).slice(0, 20);
    html = card('Recent events', evts.length ? evts.map(e => `<div class="row-item"><span class="t">${fmtTime(e.ts)}</span><span class="d">[${esc(e.type)}] ${esc(e.detail)}</span></div>`).join('') : `<p class="empty-note">No activity recorded for ${esc(mod.label)} yet.</p>`);
  } else if (facetId === 'history') {
    const evts = S.audit.slice(0, 10);
    html = card('History', `<p class="empty-note">Historical records live in the Audit workspace; latest ${evts.length} events shown.</p>` + evts.map(e => `<div class="row-item"><span class="t">${fmtDate(e.ts)}</span><span class="d">[${esc(e.type)}] ${esc(e.detail)}</span></div>`).join(''));
  } else html = card(mod.label, `<p>${esc(mod.sub)}</p>`) + card('Truth boundary', `<p>${esc(mod.label)} reports ${st.pill.toLowerCase()} truthfully. External execution requires a real provider, credential and verification flow; provider output never grants authority.</p>`);
  $('#facetBody').innerHTML = html;
  $('#facetOverlay').hidden = false;
}

/* ── Live workspaces ─────────────────────────────────────────────── */
async function renderLive(id) {
  await refreshState();
  const renderer = ({ chat: renderChat, conversations: renderConversations, tasks: renderTasks, projects: renderProjects, agents: renderAgents, memory: renderMemory, knowledge: renderKnowledge, files: renderFiles, tools: renderTools, permissions: renderPermissions, approvals: renderApprovals, security: renderSecurity, evidence: renderEvidence, guardian: renderGuardian, audit: renderAudit, credentials: renderCredentials, ldmarket: renderLDMarket, events: renderEvents, lotto: renderLotto, rewards: renderRewards, plans: renderPlans, devices: renderDevices, ldcoins: renderLD, status: renderStatus, settings: renderSettings, puter: renderPuter, avatar: renderAvatarStudio, arena: renderArena, spec: renderSpec, documentation: renderDocs, profile: renderProfile, marketplace: renderMarket, automations: renderAutomations, notifications: renderNotifications, inventory: renderInventory })[id];
  if (typeof renderer === 'function') await renderer();
}
function head(eyebrow, title, sub, right) {
  return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${esc(title)}</h1><p class="page-sub">${esc(sub)}</p></div>${right || ''}</div>`;
}
const row = (t, d, btns) => `<div class="row-item"><span class="t">${esc(t)}</span><span class="d">${d}</span>${btns || ''}</div>`;

/* Chat — the primary control surface */
let chatConvoId = null;
function renderChat() {
  let c = S.conversations.find(x => x.id === chatConvoId) || S.conversations[0];
  $('#main').innerHTML = head('COMMAND SURFACE', 'Chat', 'Ask LIAM to do anything in the app. Your request grants permission; high-risk actions queue for your explicit approval.',
    `<div style="display:flex;gap:8px"><button class="mini-btn" id="chatHistoryBtn">History</button><button class="mini-btn" id="chatNewBtn">＋ New</button></div>`) +
  `<div class="chat-card"><div class="chat-head"><div><b>${c ? esc(c.title) : 'New conversation'}</b><span class="subhead">REQUEST = PERMISSION · HIGH-RISK = APPROVAL · EMERGENCY ${esc(S.emergency)}</span></div></div>
   <div class="chat-log" id="chatLog"></div>
   <div class="composer-wrap"><div class="composer"><textarea id="chatInput" placeholder='Try: “create task review audit” · “weather in Perth” · “fetch https://example.com” · “balance” · “open security” · “help”'></textarea><button class="send" id="chatSend" aria-label="Send">↑</button></div>
   <div class="composer-footer"><span>SERVER-AUTHORITATIVE EXECUTION</span><span>PROVIDER OUTPUT STAYS UNTRUSTED</span></div></div></div>`;
  paintLog(c);
  $('#chatSend').onclick = sendChat;
  $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  $('#chatNewBtn').onclick = async () => { const j = await post('/api/conversations', { title: 'New conversation' }); chatConvoId = j.conversation.id; renderChat(); };
  $('#chatHistoryBtn').onclick = () => setView('conversations');
}
function paintLog(c) {
  const log = $('#chatLog'); if (!log) return;
  log.innerHTML = (c ? c.messages : []).map(msg => `<div class="msg ${msg.role}"><div class="who">${msg.role === 'user' ? 'YOU' : msg.role === 'external' ? 'EXTERNAL · UNTRUSTED' : 'LIAM'}</div><p>${esc(msg.text)}</p></div>`).join('') || '<p class="empty-note">No messages yet. LIAM obeys real commands only.</p>';
  log.scrollTop = log.scrollHeight;
}
async function pushMsg(convoId, role, text) {
  const j = await post(`/api/conversations/${convoId}/message`, { role, text });
  return j.conversation;
}
async function sendChat() {
  const input = $('#chatInput'); const text = input.value.trim(); if (!text) return;
  input.value = '';
  let c = S.conversations.find(x => x.id === chatConvoId) || S.conversations[0];
  if (!c) { const j = await post('/api/conversations', { title: text.slice(0, 42) }); c = j.conversation; }
  chatConvoId = c.id;
  c = await pushMsg(c.id, 'user', text);
  paintLog(c);
  const reply = await routeCommand(text);
  c = await pushMsg(c.id, reply.role || 'local', reply.text);
  paintLog(c);
  if (reply.action) setTimeout(reply.action, 200);
  refreshState();
}
/* Router: UI intents → server platform intents → Puter (opt-in) → honest fallback */
async function routeCommand(text) {
  if (OFFLINE) return { text: 'Backend offline — I cannot act without the LIAM server. This hosted page is a static preview: run “node server.js” in the liam folder locally, then open http://127.0.0.1:5173 for full control. Truth rule intact: I will not pretend to execute anything.' };
  const low = text.toLowerCase().trim();
  let m;
  if ((m = low.match(/^(?:open|go to|show|switch to)\s+(.+)$/))) {
    const t = MODULES.find(x => x.label.toLowerCase() === m[1].trim()) || MODULES.find(x => x.label.toLowerCase().startsWith(m[1].trim()));
    if (t) return { text: 'Opening ' + t.label + '.', action: () => setView(t.id) };
  }
  if (low.includes('new chat')) return { text: 'Started a new conversation.', action: async () => { const j = await post('/api/conversations', { title: 'New conversation' }); chatConvoId = j.conversation.id; renderChat(); } };
  if (low.includes('collapse')) return { text: 'Toggling navigation.', action: toggleCollapse };
  if (low.includes('help') || low.includes('what can you do')) return { text:
`I control every workspace on your request — the request is the permission grant (audited); high-risk actions queue in Approvals.
• UI: “open security”, “new chat”, “collapse”
• Work: “create task X”, “complete task 0”, “create project X”, “create agent X”, “remember X”, “recall X”, “add knowledge X”
• Tools: “list files”, “write file notes.txt …”, “fetch <url>”, “weather in <city>”, “run date”, “github”
• Control: “status”, “capabilities”, “security”, “grant http.get”, “revoke http.get”, “set emergency HIGH”, “lockdown confirm”, “approve <id>”, “stop <id>”
• Economy: “balance”, “wager 100 between A and B”, “economy selftest”
• Arena: “forge avatar <race>”, “fight” (in Arena workspace)
• Accounts & connectors: create the first Owner in Profile with the configured email; “logout”, “connect github with token …”, “verify github”, “connections”, “disconnect github”
• Forge & market: “forge wings at legendary: <your imaginative prompt>”, “forge cost”, “market”, “buy <id>”, “sell <itemId> for <n>”, “delist <id>”
• Real payments: “connect stripe with token sk_…”, “verify stripe”, “enable real payments confirm”, “create payment 500 ld”, “confirm payment <id>” · Proton has NO public API — never simulated
• Connectors (live, key-free): “weather <city>”, “convert 100 aud to usd”, “research <topic>”, “dns <domain>”, “hash <text>”, “uuid”, “capabilities”
• v1.61: “news top”, “country Australia”, “remind me in 20 minutes stretch”, “reminders”, “github list”, “github read file README.md”, “github write notes.md | hello” (approval-gated)
• v1.62: “every 2 hours stand up” (recurring), “schedules”, “stop schedule <id>”, “talents”, “unlock talent body for <avatar>”
• Preview & autonomy: “preview fetch <url>”, “autonomous on confirm”, “autonomous off”
• Optional external: “ask puter <question>” (only if the Puter bridge loads; output labelled untrusted)` };
  if ((m = text.match(/^(?:create|make)(?: an?)? owner(?: account)?(?: called| named)? ([a-z0-9_-]+) email (\S+@\S+) (?:with )?password (.+)$/i))) {
    const r = await post('/api/auth/owner', { name: m[1], email: m[2], password: m[3] });
    return r.ok ? { text: 'Owner account created for ' + r.owner + ' and bound to ' + (r.email.masked || 'the configured email') + '. The first-run path is now closed.' } : { role: 'notice', text: r.error || 'Owner creation failed.' };
  }
  if ((m = text.match(/^(?:log ?in|sign in) email (\S+@\S+) password (.+)$/i))) {
    const r = await post('/api/auth/login', { email: m[1], password: m[2] });
    return r.ok ? { text: 'Logged in. Session cookie set (HttpOnly, SameSite). Mutations now require this session.' } : { role: 'notice', text: r.error || 'Login failed.' };
  }
  if (low === 'logout' || low === 'log out') { await post('/api/auth/logout', {}); return { text: 'Logged out; session invalidated server-side.' }; }
  const cmd = await post('/api/command', { text });
  if (cmd && cmd.ok && cmd.reply) return { text: cmd.reply };
  if (cmd && cmd.unhandled && low.startsWith('ask puter')) return puterAsk(text.replace(/^ask puter\s*/i, ''));
  if (/^(hi|hello|hey|yo)\b/.test(low)) return { text: 'Hey — LIAM, fully operational on your local server. Every system is live: type “help”.' };
  if (low.includes('who are you') || low.includes('your name')) return { text: 'I am LIAM, the conversational control layer of this platform. I propose and execute; you authorize by asking; the server enforces and audits.' };
  if (low.includes('time') || low.includes('date')) return { text: 'Local device time: ' + new Date().toString() };
  return { role: 'notice', text: 'Not a recognised command and no provider is connected for open questions. Type “help” for the full command surface, or “ask puter …” to opt into the external bridge.' };
}

/* Puter bridge (optional, truthful) */
let puterState = { loaded: false, signedIn: false, user: null, models: [] };
function loadPuterScript() {
  return new Promise(resolve => {
    if (window.puter) { puterState.loaded = true; return resolve(true); }
    const existing = document.querySelector('script[data-witforge-puter]');
    if (existing && String(existing.tagName || '').toUpperCase() === 'SCRIPT') {
      existing.addEventListener('load', () => resolve(!!window.puter), { once:true });
      existing.addEventListener('error', () => resolve(false), { once:true });
      setTimeout(() => resolve(!!window.puter), 8000);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://js.puter.com/v2/';
    s.dataset.witforgePuter = '1';
    let settled = false;
    const done = ok => { if (settled) return; settled = true; puterState.loaded = !!ok; resolve(!!ok); };
    s.onload = () => done(!!window.puter);
    s.onerror = () => done(false);
    document.head.appendChild(s);
    setTimeout(() => done(!!window.puter), 8000);
  });
}
async function refreshPuterAuth() {
  const ok = await loadPuterScript();
  if (!ok || !window.puter?.auth) { puterState = { ...puterState, loaded:false, signedIn:false, user:null }; return puterState; }
  puterState.loaded = true;
  try {
    puterState.signedIn = !!window.puter.auth.isSignedIn();
    puterState.user = puterState.signedIn && window.puter.auth.getUser ? await window.puter.auth.getUser() : null;
  } catch (e) {
    puterState.signedIn = false; puterState.user = null;
  }
  return puterState;
}
async function puterSignIn() {
  const ok = await loadPuterScript();
  if (!ok || !window.puter?.auth?.signIn) throw new Error('Puter authentication is unavailable in this browser.');
  await window.puter.auth.signIn();
  return refreshPuterAuth();
}
async function puterSignOut() {
  const ok = await loadPuterScript();
  if (!ok || !window.puter?.auth?.signOut) return refreshPuterAuth();
  await window.puter.auth.signOut();
  puterState.models = [];
  return refreshPuterAuth();
}
async function puterAsk(q) {
  const ok = await loadPuterScript();
  if (!ok || !window.puter?.ai) return { role: 'notice', text: 'Puter.js could not load in this environment — external model access UNAVAILABLE (not faked).' };
  try {
    if (window.puter.auth && !window.puter.auth.isSignedIn()) await puterSignIn();
    if (!puterState.models.length && window.puter.ai.listModels) {
      try { puterState.models = (await window.puter.ai.listModels()) || []; } catch (e) { puterState.models = []; }
    }
    const resp = await window.puter.ai.chat(q);
    const txt = typeof resp === 'string' ? resp : (resp && resp.message && resp.message.content) || (resp && resp.text) || JSON.stringify(resp).slice(0, 1200);
    return { role: 'external', text: String(txt).slice(0, 8000) };
  } catch (e) {
    return { role: 'notice', text: 'Puter request failed: ' + (e.message || e) + '. External access remains UNAVAILABLE until authentication/request succeeds.' };
  }
}
async function renderPuter() {
  $('#main').innerHTML = head('OPTIONAL EXTERNAL BRIDGE', 'Puter', 'Browser-based Puter sign-in, live model discovery and opt-in AI calls. External output is always labelled EXTERNAL · UNTRUSTED and grants no authority.') +
  `<div class="facet-card"><h4>Account</h4><p id="puterStatus">Checking Puter.js and account state…</p><div class="input-line"><button class="mini-btn" id="puterLogin">Sign in to Puter</button><button class="mini-btn" id="puterLogout">Sign out</button><button class="mini-btn" id="puterModels">List models</button></div></div>
   <div class="facet-card"><h4>Ask (opt-in)</h4><div class="input-line"><input id="puterQ" placeholder="Ask via Puter…"><button class="mini-btn" id="puterSend">Ask</button></div><p class="empty-note" id="puterOut" style="margin-top:10px">No external output this session.</p></div>`;
  const st = $('#puterStatus');
  const paint = async ({ load=false }={}) => {
    if (!window.puter && !load) {
      puterState = { ...puterState, loaded:false, signedIn:false, user:null };
      st.textContent = 'Puter bridge not loaded. Press “Sign in to Puter”, “List models”, or “Ask” to opt in.';
      $('#puterLogin').hidden = false; $('#puterLogout').hidden = true;
      return;
    }
    const ps = await refreshPuterAuth();
    const username = ps.user?.username || ps.user?.email || '';
    st.textContent = !ps.loaded ? 'Puter.js unavailable in this browser.' : ps.signedIn ? 'SIGNED IN' + (username ? ' · ' + username : '') + ' · browser credentials remain managed by Puter.js.' : 'Puter.js loaded · not signed in.';
    $('#puterLogin').hidden = ps.signedIn; $('#puterLogout').hidden = !ps.signedIn;
  };
  $('#puterLogin').onclick = async () => { try { st.textContent = 'Opening Puter sign-in…'; await puterSignIn(); await paint({load:true}); } catch (e) { st.textContent = 'Sign-in failed: ' + (e.message || e); } };
  $('#puterLogout').onclick = async () => { try { await puterSignOut(); await paint({load:true}); } catch (e) { st.textContent = 'Sign-out failed: ' + (e.message || e); } };
  $('#puterModels').onclick = async () => {
    const ok = await loadPuterScript();
    if (!ok || !window.puter?.ai) { st.textContent = 'UNAVAILABLE.'; return; }
    try { if (window.puter.auth && !window.puter.auth.isSignedIn()) await puterSignIn(); const ms = await window.puter.ai.listModels(); puterState.models = ms || []; st.textContent = `SIGNED IN · models discovered: ${puterState.models.length}` + (puterState.models.length ? ' · ' + puterState.models.slice(0, 8).map(x => x.id || x.name).join(', ') : ''); }
    catch (e) { st.textContent = 'Discovery failed: ' + (e.message || e); }
  };
  $('#puterSend').onclick = async () => { const out=$('#puterOut'); out.textContent='Calling Puter…'; const r = await puterAsk($('#puterQ').value || 'hello'); out.textContent = (r.role === 'external' ? '[EXTERNAL · UNTRUSTED] ' : '[NOTICE] ') + r.text; await paint({load:true}); };
  await paint();
}

/* Conversations */
function renderConversations() {
  $('#main').innerHTML = head('READY', 'Conversations', 'History, search, archive and project context.', '') +
  `<div class="facet-card"><h4>Search</h4><div class="input-line" style="margin-top:0"><input id="convoSearch" placeholder="Filter by title…"></div></div>
   <div class="facet-card"><h4>Conversations (${S.conversations.length})</h4><div id="convoList"></div></div>`;
  const paint = q => {
    const list = S.conversations.filter(c => !q || c.title.toLowerCase().includes(q));
    $('#convoList').innerHTML = list.length ? list.map(c => row(fmtDate(c.updated), `${esc(c.title)} · ${c.messages.length} msg`, `<button class="mini-btn" data-open="${c.id}">Open</button><button class="mini-btn danger" data-del="${c.id}">Delete</button>`)).join('') : '<p class="empty-note">No conversations.</p>';
  };
  paint('');
  $('#convoSearch').oninput = e => paint(e.target.value.toLowerCase());
  $('#convoList').onclick = async e => {
    const o = e.target.closest('[data-open]'); if (o) { chatConvoId = o.dataset.open; setView('chat'); return; }
    const d = e.target.closest('[data-del]'); if (d) { await api(`/api/conversations/${d.dataset.del}`, { method: 'DELETE' }); refreshState().then(() => renderConversations()); }
  };
}
/* Tasks */
function renderTasks() {
  const done = S.tasks.filter(t => t.done).length;
  $('#main').innerHTML = head('OPERATIONS', 'Tasks', 'Create, track and verify work items — by UI or by asking LIAM in Chat.') +
  `<div class="stat-grid"><div class="stat-card"><p class="stat-label">Open / Done</p><p class="stat-value">${S.tasks.length - done} / ${done}</p></div><div class="stat-card"><p class="stat-label">Control</p><p class="stat-value">User controlled</p></div></div>
   <div class="facet-card"><h4>Record a task</h4><div class="input-line" style="margin-top:0"><input id="taskInput" placeholder="e.g. Review audit trail"><button class="mini-btn" id="taskAdd">Add</button></div></div>
   <div class="facet-card"><h4>Tasks</h4>${S.tasks.length ? S.tasks.map((t, i) => row(t.done ? '✓' : '◌', `${esc(t.text)} <small>#${i}</small>`, `<button class="mini-btn" data-t="toggle" data-id="${t.id}">${t.done ? 'Reopen' : 'Done'}</button><button class="mini-btn danger" data-t="del" data-id="${t.id}">Delete</button>`)).join('') : '<p class="empty-note">No tasks yet — or say “create task …” in Chat.</p>'}</div>`;
  $('#taskAdd').onclick = async () => { await post('/api/tasks', { text: $('#taskInput').value }); setView('tasks', { silent: true }); };
  $('#main').onclick = async e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    await post(`/api/tasks/${b.dataset.id}`, { action: b.dataset.t === 'del' ? 'delete' : (S.tasks.find(t => t.id === b.dataset.id).done ? 'reopen' : 'done') });
    setView('tasks', { silent: true });
  };
}
/* Projects / Agents / Memory / Knowledge */
function renderProjects() {
  $('#main').innerHTML = head('WORK MANAGEMENT', 'Projects', 'Persistent workspaces for goals, tasks, agents and audit history.') +
  `<div class="facet-card"><h4>Create</h4><div class="input-line" style="margin-top:0"><input id="projInput" placeholder="Project name"><button class="mini-btn" id="projAdd">Create</button></div></div>
   <div class="facet-card"><h4>Projects (${S.projects.length})</h4>${S.projects.length ? S.projects.map(p => row(fmtDate(p.created), esc(p.name), `<button class="mini-btn danger" data-del="${p.id}">Delete</button>`)).join('') : '<p class="empty-note">No projects — or say “create project …” in Chat.</p>'}</div>`;
  $('#projAdd').onclick = async () => { await post('/api/projects', { name: $('#projInput').value }); setView('projects', { silent: true }); };
  $('#main').onclick = async e => { const d = e.target.closest('[data-del]'); if (d) { await api(`/api/projects/${d.dataset.del}`, { method: 'DELETE' }); setView('projects', { silent: true }); } };
}
function renderAgents() {
  $('#main').innerHTML = head('DELEGATED INTELLIGENCE', 'Agents', 'Explicit identities with bounded scope. Agents cannot elevate, bypass security or forge approval.') +
  `<div class="facet-card"><h4>Register</h4><div class="input-line" style="margin-top:0"><input id="agentInput" placeholder="Agent name"><button class="mini-btn" id="agentAdd">Register</button></div></div>
   <div class="facet-card"><h4>Registry (${S.agents.length})</h4>${S.agents.length ? S.agents.map(a => row(fmtDate(a.created), `${esc(a.name)} · scope ${a.scope} · <span class="pill operational">ACTIVE</span>`, '')).join('') : '<p class="empty-note">No agents — or say “create agent …” in Chat.</p>'}</div>`;
  $('#agentAdd').onclick = async () => { await post('/api/agents', { name: $('#agentInput').value }); setView('agents', { silent: true }); };
}
function renderMemory() {
  $('#main').innerHTML = head('KNOWLEDGE INTEGRITY', 'Memory', 'Persistent records with provenance. Memory is information — not authority.') +
  `<div class="facet-card"><h4>Record</h4><div class="input-line" style="margin-top:0"><input id="memInput" placeholder="Fact or note (stays local)"><button class="mini-btn" id="memAdd">Add</button></div></div>
   <div class="facet-card"><h4>Memory (${S.memory.length})</h4>${S.memory.length ? S.memory.map(r => row(fmtDate(r.ts), esc(r.text), `<button class="mini-btn danger" data-del="${r.id}">Delete</button>`)).join('') : '<p class="empty-note">Empty. “remember …” in Chat also records here.</p>'}</div>`;
  $('#memAdd').onclick = async () => { await post('/api/memory', { text: $('#memInput').value }); setView('memory', { silent: true }); };
  $('#main').onclick = async e => { const d = e.target.closest('[data-del]'); if (d) { await api(`/api/memory/${d.dataset.del}`, { method: 'DELETE' }); setView('memory', { silent: true }); } };
}
function renderKnowledge() {
  $('#main').innerHTML = head('UNTRUSTED UNTIL VERIFIED', 'Knowledge', 'Indexed records with provenance. External or user content never grants authority.') +
  `<div class="facet-card"><h4>Add record</h4><div class="input-line" style="margin-top:0"><input id="knowInput" placeholder="Knowledge statement"><button class="mini-btn" id="knowAdd">Add</button></div></div>
   <div class="facet-card"><h4>Records (${S.knowledge.length})</h4>${S.knowledge.length ? S.knowledge.map(k => row(fmtDate(k.ts), `${esc(k.title)} <small>source:${k.source} trusted:${k.trusted}</small>`, '')).join('') : '<p class="empty-note">Empty. “add knowledge …” in Chat also records here.</p>'}</div>`;
  $('#knowAdd').onclick = async () => { await post('/api/knowledge', { text: $('#knowInput').value }); setView('knowledge', { silent: true }); };
}
/* Files — real sandboxed FS through the tool pipeline */
async function renderFiles() {
  const list = await post('/api/tools/run', { tool: 'fs.list', args: {} });
  $('#main').innerHTML = head('SANDBOXED FILESYSTEM', 'Files', 'Real reads/writes inside the server userfiles sandbox. Path traversal blocked; writes return SHA-256 evidence.') +
  `<div class="facet-card"><h4>Write a file</h4><div class="input-line" style="margin-top:0"><input id="fileName" placeholder="name.txt"><input id="fileContent" placeholder="content…"><button class="mini-btn" id="fileWrite">Write</button></div></div>
   <div class="facet-card"><h4>Sandbox contents</h4>${list.ok ? (list.evidence.files.length ? list.evidence.files.map(f => row(String(f.size) + 'B', esc(f.name), `<button class="mini-btn" data-read="${esc(f.name)}">Read</button>`)).join('') : '<p class="empty-note">Sandbox empty.</p>') : `<p class="empty-note">${esc(list.error || 'unavailable')}</p>`}</div>
   <div class="facet-card"><h4>Read output</h4><pre class="studio-output" id="fileOut" style="white-space:pre-wrap">(none)</pre></div>`;
  $('#fileWrite').onclick = async () => {
    const r = await post('/api/tools/run', { tool: 'fs.write', args: { path: $('#fileName').value, content: $('#fileContent').value } });
    toast(r.ok ? `Wrote ${r.evidence.path} · sha256 ${String(r.evidence.sha256).slice(0, 12)}…` : (r.error || (r.evidence && r.evidence.error)));
    setView('files', { silent: true });
  };
  $('#main').onclick = async e => {
    const b = e.target.closest('[data-read]'); if (!b) return;
    const r = await post('/api/tools/run', { tool: 'fs.read', args: { path: b.dataset.read } });
    $('#fileOut').textContent = r.ok ? r.evidence.text : (r.error || r.evidence.error);
  };
}
/* Tools & adapters */
const TOOL_HINTS = { 'sys.info': '{}', 'fs.list': '{}', 'fs.read': '{"path":"notes.txt"}', 'fs.write': '{"path":"notes.txt","content":"hello"}', 'http.get': '{"url":"https://example.com"}', 'weather.get': '{"location":"Perth"}', 'exec.run': '{"op":"date"}', 'github.status': '{}', 'economy.selftest': '{}' };
async function renderTools() {
  $('#main').innerHTML = head('CAPABILITY BROKER', 'Tools', 'Live adapter registry and the real executor. Discovery grants nothing; your request grants low/medium risk; high risk queues for approval; LOCKDOWN blocks execution.') +
  `<div class="module-list">${S.adapters.map(a => `<div class="module-card" style="cursor:default"><span class="module-icon">${a.state === 'AVAILABLE' ? '◈' : a.state === 'UNAVAILABLE' ? '' : '◌'}</span><span class="module-body"><h3>${esc(a.name)}</h3><p>${a.caps.map(c => `${esc(c.id)} (${c.risk})`).join(' · ')} — <b>${esc(a.state)}</b></p></span></div>`).join('')}</div>
   <div class="facet-card" style="margin-top:16px"><h4>Run a tool</h4>
     <div class="input-line" style="margin-top:0"><select id="toolSel" class="chip">${Object.keys(TOOL_HINTS).map(t => `<option>${t}</option>`).join('')}</select><input id="toolArgs" value="{}"></div>
     <div class="input-line"><button class="mini-btn" id="toolRun">Execute (permission by request)</button></div>
     <pre class="studio-output" id="toolOut" style="white-space:pre-wrap;margin-top:10px">Evidence appears here.</pre></div>`;
  $('#toolSel').onchange = () => { $('#toolArgs').value = TOOL_HINTS[$('#toolSel').value] || '{}'; };
  $('#toolRun').onclick = async () => {
    let args; try { args = JSON.parse($('#toolArgs').value || '{}'); } catch (e) { $('#toolOut').textContent = 'Invalid JSON args'; return; }
    const r = await post('/api/tools/run', { tool: $('#toolSel').value, args });
    if (r.needsApproval) { $('#toolOut').textContent = 'QUEUED FOR APPROVAL: ' + r.error + '\nSay “approve ' + r.needsApproval + '” in Chat or use the Approvals workspace.'; }
    else $('#toolOut').textContent = JSON.stringify(r.evidence || r, null, 2).slice(0, 3000);
  };
}
/* Permissions */
function renderPermissions() {
  const table = S.capabilityTable || [];
  const k = S.kernel || {};
  const statePill = st => st === 'GRANTED' ? 'operational' : ['BLOCKED_BY_SECURITY', 'BLOCKED_BY_POLICY', 'DENIED', 'REVOKED'].includes(st) ? 'disconnected' : st === 'SUSPENDED' || st === 'EXPIRED' ? 'config' : 'simulation';
  $('#main').innerHTML = head('AUTHORITY BOUNDARY', 'Permissions', 'Nine permission states, five delegation levels and twelve scope dimensions. Requesting a capability grants it (audited); revocation is immediate; high risk always requires approval.') +
  `<div class="facet-card"><h4>Permission states supported (§9)</h4><p class="empty-note">${(k.permissionStates || []).join(' · ')}</p>
     <h4>Delegation levels (§10)</h4><p class="empty-note">${(k.permissionLevels || []).join(' · ')} — WitForge and its agents cannot raise their own level.</p>
     <h4>Scope dimensions (§9)</h4><p class="empty-note">${(k.scopeDimensions || []).join(' · ')}</p></div>
   <div class="facet-card"><h4>Capability register (${table.length})</h4>${table.map(c => row(c.risk, `<b>${esc(c.capability)}</b> — <span class="pill ${statePill(c.state)}">${esc(c.state)}</span> <small>level ${esc(c.level || '—')} · risk ${esc(c.risk)}${c.scopes && Object.keys(c.scopes).length ? ' · scope ' + esc(Object.keys(c.scopes).join(',')) : ''}${c.expires ? ' · expires ' + fmtTime(c.expires) : ''}${c.tokenId ? ' · token ' + esc(c.tokenId) : ''}</small>`,
     `<button class="mini-btn" data-g="${c.capability}">Grant</button><button class="mini-btn" data-s="${c.capability}">Suspend</button><button class="mini-btn" data-rs="${c.capability}">Resume</button><button class="mini-btn danger" data-r="${c.capability}">Revoke</button>`)).join('')}</div>
   <div class="facet-card"><h4>Request a scoped grant</h4>
     <p class="empty-note">Scopes bind authority to a dimension — e.g. <code>scoped grant files.write purpose=project-x ttl=1h</code> in Chat. Every grant carries a signed, expiring capability token (§46).</p>
     <div class="input-line" style="margin-top:0"><input id="permCap" placeholder="capability (e.g. files.read)"><input id="permWhy" placeholder="purpose"><button class="mini-btn" id="permAsk">Request</button></div></div>`;
  $('#permAsk').onclick = async () => { const r = await post('/api/permissions/grant', { cap: $('#permCap').value, purpose: $('#permWhy').value }); toast(r.ok ? 'Granted ' + $('#permCap').value : (r.error || 'failed')); setView('permissions', { silent: true }); };
  $('#main').onclick = async e => {
    const g = e.target.closest('[data-g]'); if (g) { await post('/api/permissions/grant', { cap: g.dataset.g }); setView('permissions', { silent: true }); return; }
    const s2 = e.target.closest('[data-s]'); if (s2) { await post('/api/command', { text: 'suspend ' + s2.dataset.s }); toast('Suspended ' + s2.dataset.s); setView('permissions', { silent: true }); return; }
    const rs = e.target.closest('[data-rs]'); if (rs) { await post('/api/command', { text: 'resume ' + rs.dataset.rs }); toast('Resumed ' + rs.dataset.rs); setView('permissions', { silent: true }); return; }
    const r = e.target.closest('[data-r]'); if (r) { await post('/api/permissions/revoke', { cap: r.dataset.r }); setView('permissions', { silent: true }); }
  };
}
/* Approvals */
function renderApprovals() {
  const pend = S.approvals.filter(a => a.status === 'pending');
  const steps = S.humanSteps || [];
  $('#main').innerHTML = head('HUMAN DECISIONS', 'Approvals', 'High-risk actions wait here until you approve or stop them — by button or by asking in Chat.') +
  `<div class="facet-card"><h4>Pending (${pend.length})</h4>${pend.length ? pend.map(a => row(fmtTime(a.ts), `${esc(a.desc)} <small>${a.id}</small>`, `<button class="mini-btn" data-d="approve" data-id="${a.id}">Approve</button><button class="mini-btn danger" data-d="stop" data-id="${a.id}">Stop</button>`)).join('') : '<p class="empty-note">Nothing pending.</p>'}</div>
   ${(S.proposals || []).filter(p => p.status === 'proposed').length ? `<div class="facet-card"><h4>AI proposals (${(S.proposals || []).filter(p => p.status === 'proposed').length} pending)</h4>${(S.proposals || []).filter(p => p.status === 'proposed').slice(0, 8).map(p => row(fmtTime(p.ts), `“${esc(p.command)}” <small>${p.id} · ${esc(p.source)}</small>`, '')).join('')}<p class="empty-note">Run one from Chat: “do &lt;id&gt;” — it goes through the normal audited router.</p></div>` : ''}
   ${steps.length ? `<div class="facet-card"><h4>Human steps (${steps.filter(h => h.status === 'pending').length} pending)</h4>${steps.slice(0, 8).map(h => row(fmtTime(h.requestedTs), `${esc(h.instructions)} <small>${h.id} · ${esc(h.kind)}${h.service ? ' · ' + esc(h.service) : ''} · ${h.status.toUpperCase()}</small>`, h.status === 'pending' ? `<button class="mini-btn danger" data-d="stop" data-id="${h.id}">Cancel</button>` : '')).join('')}<p class="empty-note">Complete the gate yourself, then in Chat: “resolve &lt;id&gt; with &lt;your answer&gt;” and repeat the command. The platform never bypasses a human gate.</p></div>` : ''}
   <div class="facet-card"><h4>Decided</h4>${S.approvals.filter(a => a.status !== 'pending').slice(0, 12).map(a => row(fmtTime(a.ts), `${esc(a.desc)} → <b>${a.status.toUpperCase()}</b>`)).join('') || '<p class="empty-note">None yet.</p>'}</div>`;
  $('#main').onclick = async e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    if (/^hs/.test(b.dataset.id)) { await post(`/api/human-steps/${b.dataset.id}/cancel`, {}); setView('approvals', { silent: true }); return; }
    await post(`/api/approvals/${b.dataset.id}`, { decision: b.dataset.d });
    setView('approvals', { silent: true });
  };
}
/* Security */
function renderSecurity() {
  const evts = S.audit.filter(a => a.type === 'security' || a.type === 'permission' || a.type === 'approval').slice(0, 20);
  $('#main').innerHTML = head('SECURITY SHIELD', 'Security', 'AI proposes. Policy, permission, risk and the approval gate decide what may execute.', `<span class="pill ${S.emergency === 'NORMAL' ? 'operational' : S.emergency === 'LOCKDOWN' ? 'disconnected' : 'config'}">${esc(S.emergency)}</span>`) +
  `<div class="facet-card"><h4>Emergency controls</h4><div class="input-line" style="margin-top:0">
     ${['NORMAL', 'ELEVATED', 'HIGH'].map(s => `<button class="mini-btn" data-em="${s}">${s}</button>`).join('')}
     <button class="mini-btn danger" data-em="LOCKDOWN">LOCKDOWN (approval-gated)</button></div>
   <p class="empty-note">Lockdown blocks execution; audit and recovery preserved. “lockdown confirm” in Chat engages immediately with your explicit confirmation.</p></div>
   <div class="facet-card"><h4>Emergency stop scopes (§55)</h4>
     <div class="input-line" style="margin-top:0">${(S.kernel && S.kernel.stopScopes || []).map(sc => `<button class="mini-btn" data-stop="${sc}">stop ${sc}</button>`).join('')}</div>
     <div class="input-line"><button class="mini-btn danger" data-stopall="1">EMERGENCY STOP ALL</button><button class="mini-btn" data-stopclear="1">Clear all stops</button></div>
     ${(S.kernel && S.kernel.stops || []).length ? (S.kernel.stops).map(x => row(fmtTime(x.ts), 'STOPPED ' + esc(x.scope) + (x.target !== '*' ? ':' + esc(x.target) : '') + ' — ' + esc(x.reason))).join('') : '<p class="empty-note">No stops engaged. Emergency stop halts one scope without freezing audit or recovery.</p>'}</div>
   <div class="facet-card"><h4>Risk engine (§51/§52)</h4>
     <p class="empty-note">${(S.kernel && S.kernel.riskClasses || []).join(' · ')} — PROHIBITED never executes; CRITICAL needs strong confirmation; HIGH needs approval or a scoped autonomous policy.</p>
     <div class="input-line" style="margin-top:0"><input id="riskTool" placeholder="tool id (e.g. fs.delete)"><button class="mini-btn" id="riskCheck">Assess risk</button><button class="mini-btn" id="policyCheck">Policy decision</button></div>
     <div id="riskOut" class="empty-note" style="margin-top:8px">Twelve risk factors score each action into a class before anything runs.</div></div>
   <div class="facet-card"><h4>Security / permission / approval events</h4>${evts.length ? evts.map(e => row(fmtTime(e.ts), `[${esc(e.type)}] ${esc(e.detail)}`)).join('') : '<p class="empty-note">No events yet.</p>'}</div>`;
  $('#main').onclick = async e => {
    const b = e.target.closest('[data-em]'); if (!b) return;
    const r = await post('/api/security/emergency', { state: b.dataset.em });
    if (r.needsApproval) toast('Approval queued: ' + r.needsApproval + ' — approve it in Approvals or Chat.');
    else toast('Emergency state: ' + (r.state || r.error));
    setView('security', { silent: true });
  };
  $('#riskCheck') && ($('#riskCheck').onclick = async () => { const r = await post('/api/command', { text: 'risk ' + $('#riskTool').value }); $('#riskOut').innerHTML = esc(r.reply || r.error || ''); });
  $('#policyCheck') && ($('#policyCheck').onclick = async () => { const r = await post('/api/command', { text: 'policy ' + $('#riskTool').value }); $('#riskOut').innerHTML = esc(r.reply || r.error || ''); });
}
/* §118/§112/§119: evidence vault, anti-fraud monitor, observability */
async function renderEvidence() {
  const v = await api('/api/evidence');
  const fr = await api('/api/fraud');
  const ob = await api('/api/observability');
  const vault = (v.vault || []).slice(0, 20);
  $('#main').innerHTML = head('EVIDENCE & TELEMETRY', 'Evidence', 'Tamper-evident vault, anti-fraud monitor and OTLP-shaped observability. Secrets are referenced, never stored in the clear.', `<span class="pill ${v.integrity && v.integrity.ok ? 'operational' : 'disconnected'}">${v.integrity && v.integrity.ok ? 'VAULT VERIFIED' : 'VAULT CHECK'}</span>`) +
  `<div class="stat-grid">
     <div class="stat-card"><p class="stat-label">Vault records</p><p class="stat-value">${(v.integrity || {}).entries || 0}</p></div>
     <div class="stat-card"><p class="stat-label">Fraud events</p><p class="stat-value">${(fr.report || {}).events || 0}</p></div>
     <div class="stat-card"><p class="stat-label">Metrics</p><p class="stat-value">${(ob.observability || {}).metrics.length}</p></div>
     <div class="stat-card"><p class="stat-label">Spans</p><p class="stat-value">${(ob.observability || {}).spans.length}</p></div>
   </div>
   <div class="facet-card"><h4>Evidence vault (§118)</h4>${vault.length ? vault.map(e => row(fmtTime(e.ts), `${esc(e.kind)} <small>${esc(e.classification)} · ${esc(e.hash).slice(0, 16)}… ${e.resources.length ? '· resources ' + esc(e.resources.join(', ')) : ''}</small>`)).join('') : '<p class="empty-note">No evidence recorded yet — execute something and the tool result, verification and hash land here.</p>'}</div>
   <div class="facet-card"><h4>Anti-fraud signals (§112)</h4>${(fr.signals || []).map(x => row(x.severity, esc(x.id) + ' — ' + esc(x.note))).join('')}
     <p class="empty-note">Duplicate detection, transaction monitoring, rate limits, anomaly detection and account separation run on every ledger post and asset mint.</p></div>
   <div class="facet-card"><h4>Observability (§119)</h4>
     <p class="empty-note">${esc((ob.observability || {}).note || '')}</p>
     <div class="input-line" style="margin-top:0"><input id="evTrace" placeholder="correlation id"><button class="mini-btn" id="evTraceBtn">Open timeline</button></div>
     <div id="evTraceOut" class="empty-note" style="margin-top:8px">Correlation ids join spans, audit events and tool evidence.</div></div>`;
  $('#evTraceBtn').onclick = async () => { const r = await post('/api/command', { text: 'trace ' + $('#evTrace').value }); $('#evTraceOut').innerHTML = esc(r.reply || r.error || ''); };
}
/* §40/§41/§104 devices */
function renderDevices() {
  const list = S.devices || [];
  const trustPill = t => t === 'TRUSTED' ? 'operational' : t === 'PENDING' ? 'config' : 'disconnected';
  $('#main').innerHTML = head('DEVICE ECOSYSTEM', 'Devices', 'Pairing establishes identity only — capabilities are granted per capability and every command is replay-protected.', '<span class="pill operational">' + list.length + ' PAIRED</span>') +
  `<div class="facet-card"><h4>Pair a device (§40)</h4>
     <div class="input-line" style="margin-top:0"><input id="devName" placeholder="device name"><select id="devPlatform" class="chip"><option>android</option><option>ios</option><option>ipados</option><option>macos</option><option>windows</option><option>linux</option><option>chromeos</option><option>web</option><option>server</option><option>wearable</option><option>smart-device</option></select><button class="mini-btn" id="devPair">Pair</button></div>
     <p class="empty-note">Trust states: ${(S.kernel && S.kernel.deviceTrust || ['UNKNOWN', 'PENDING', 'TRUSTED', 'RESTRICTED', 'REVOKED', 'LOCKED']).join(' · ')}. Companion bridges (ADB, Shizuku, Accessibility) remain UNAVAILABLE until a real one is connected.</p></div>
   <div class="facet-card"><h4>Paired devices (${list.length})</h4>${list.length ? list.map(d => row(d.platform, `<b>${esc(d.name)}</b> — <span class="pill ${trustPill(d.trust)}">${esc(d.trust)}</span> <small>${d.capabilities} cap(s) · ${d.sessions} session(s)${d.revoked ? ' · revoked' : ''}</small>`, `<button class="mini-btn" data-trust="${d.id}">Trust</button><button class="mini-btn" data-restrict="${d.id}">Restrict</button><button class="mini-btn danger" data-revoke="${d.id}">Revoke</button>`)).join('') : '<p class="empty-note">No devices paired. Nothing is trusted by default.</p>'}</div>
   <div class="facet-card"><h4>Device-to-device commands (§41)</h4><p class="empty-note">Every command must carry: command ID · user ID · device ID · capability · action · scope · expiration · authorization · correlation ID. Replays, expired commands and untrusted devices are refused before execution.</p></div>`;
  $('#devPair').onclick = async () => {
    const r = await post('/api/devices', { action: 'pair', name: $('#devName').value, platform: $('#devPlatform').value });
    toast(r.ok ? 'Paired ' + r.device.name + ' — trust PENDING' : (r.error || 'failed'));
    setView('devices', { silent: true });
  };
  $('#main').onclick = async e => {
    const t = e.target.closest('[data-trust]'); if (t) { await post('/api/devices', { action: 'trust', id: t.dataset.trust, trust: 'TRUSTED' }); setView('devices', { silent: true }); return; }
    const r2 = e.target.closest('[data-restrict]'); if (r2) { await post('/api/devices', { action: 'trust', id: r2.dataset.restrict, trust: 'RESTRICTED' }); setView('devices', { silent: true }); return; }
    const rv = e.target.closest('[data-revoke]'); if (rv) { await post('/api/devices', { action: 'trust', id: rv.dataset.revoke, trust: 'REVOKED' }); setView('devices', { silent: true }); }
  };
}
/* Audit */
function renderAudit() {
  let filter = 'all';
  const paint = () => {
    const list = S.audit.filter(a => filter === 'all' || a.type === filter || (filter === 'task' && ['task', 'tool', 'command'].includes(a.type))).slice(0, 80);
    $('#auditBody').innerHTML = list.length ? list.map(e => row(fmtDate(e.ts), `[${esc(e.type)}] ${esc(e.detail || e.action)}` +
      ` <small>${esc(e.actor)}${e.capability ? ' · cap ' + esc(e.capability) : ''}${e.decision ? ' · ' + esc(e.decision) : ''}${e.risk ? ' · risk ' + esc(e.risk) : ''}${e.result ? ' · ' + esc(e.result) : ''}${e.approval ? ' · approval ' + esc(e.approval) : ''}${e.cid ? ' · cid ' + esc(String(e.cid).slice(0, 8)) : ''}</small>`)).join('') : '<p class="empty-note">Empty.</p>';
  };
  $('#main').innerHTML = head('EVIDENCE', 'Audit', 'What was requested, granted, executed, verified or blocked.', '') +
  `<div class="chip-row">${['all', 'security', 'permission', 'approval', 'tool', 'task', 'chat', 'nav'].map(f => `<button class="chip ${f === filter ? 'on' : ''}" data-f="${f}">${f}</button>`).join('')}</div>
   <div class="facet-card"><h4>Timeline</h4><div id="auditBody"></div></div>`;
  paint();
  $('#main').onclick = e => { const c = e.target.closest('[data-f]'); if (!c) return; filter = c.dataset.f; [...document.querySelectorAll('.chip')].forEach(x => x.classList.toggle('on', x === c)); paint(); };
}
/* LD Coins */
async function renderLD() {
  const eco = await api('/api/economy');
  $('#main').innerHTML = head('SIMULATION ECONOMY', 'LD Coins', 'Balanced double-entry ledger. Real-money functions stay compliance-locked until legal review.', '<span class="pill simulation">SIMULATION</span>') +
  `<div class="stat-grid">${Object.entries(eco.ledger.accounts).map(([k, v]) => `<div class="stat-card"><p class="stat-label">${esc(k)}</p><p class="stat-value">${v} LD</p></div>`).join('')}</div>
   <div class="facet-card"><h4>Controls</h4><div class="input-line" style="margin-top:0"><button class="mini-btn" id="ecoTest">Run economic self-test</button></div><p class="empty-note">Checks 100+100=200 pool, 198+2 settlement, sum invariant, negative-balance and unbalanced-entry rejection.</p></div>
   <div class="facet-card"><h4>Real-money receiving (Stripe)</h4>
     <p class="empty-note">Stripe: <b>${eco.stripe ? 'VERIFIED (' + esc(eco.stripe.id) + ')' : 'not verified'}</b> · Mode: <b>${eco.realMode ? 'REAL' : 'SIMULATION'}</b>. Proton: NO PUBLIC API (never simulated).</p>
     <div class="input-line"><button class="mini-btn" id="stVerify">verify stripe</button><button class="mini-btn" id="stEnable">enable real payments (confirm)</button><button class="mini-btn danger" id="stDisable">disable real payments</button></div>
     <p class="empty-note">In Chat: “connect stripe with token sk_…”, “verify stripe”, “enable real payments confirm”, “create payment 500 ld”, “confirm payment <id>”. LD is credited only on Stripe paid-status evidence.</p></div>
   <div class="facet-card"><h4>Transactions</h4>${eco.ledger.tx.slice(0, 14).map(t => row(fmtTime(t.ts), `${esc(t.memo)} · ${t.entries.map(e => `${esc(e.account)} ${e.delta > 0 ? '+' : ''}${e.delta}`).join(', ')}`)).join('') || '<p class="empty-note">No transactions.</p>'}</div>`;
  $('#stVerify').onclick = async () => { const r = await post('/api/tools/run', { tool: 'stripe.verify', args: {} }); toast(r.ok ? 'Stripe verified: ' + r.evidence.stripeAccount : ((r.evidence && r.evidence.error) || r.error || 'failed')); renderLD(); };
  $('#stEnable').onclick = async () => { const r = await post('/api/command', { text: 'enable real payments confirm' }); toast(r.reply || r.error); renderLD(); };
  $('#stDisable').onclick = async () => { const r = await post('/api/command', { text: 'disable real payments' }); toast(r.reply || r.error); renderLD(); };
  $('#ecoTest').onclick = async () => {
    const r = await api('/api/economy/selftest');
    toast(r.ok ? 'Self-test: ' + r.result.checks.map(c => (c.pass ? '✓' : '✗') + ' ' + c.check).join(' · ') : 'failed');
    renderLD();
  };
}
/* Status */
function renderStatus() {
  const av = S.adapters.filter(a => a.state === 'AVAILABLE').length;
  const un = S.adapters.filter(a => a.state === 'UNAVAILABLE').length;
  $('#main').innerHTML = head('LIVE TRUTH', 'Status', 'Runtime facts only — no adapter is connected merely because it exists.') +
  `<div class="stat-grid">
    <div class="stat-card"><p class="stat-label">Emergency state</p><p class="stat-value">${esc(S.emergency)}</p></div>
    <div class="stat-card"><p class="stat-label">Adapters</p><p class="stat-value">${av} available · ${un} unavailable</p></div>
    <div class="stat-card"><p class="stat-label">Permissions granted</p><p class="stat-value">${Object.keys(S.permissions).length}</p></div>
    <div class="stat-card"><p class="stat-label">Pending approvals</p><p class="stat-value">${S.approvals.filter(a => a.status === 'pending').length}</p></div>
    <div class="stat-card"><p class="stat-label">Conversations / Tasks</p><p class="stat-value">${S.conversations.length} / ${S.tasks.length}</p></div>
    <div class="stat-card"><p class="stat-label">Audit events</p><p class="stat-value">${S.audit.length}</p></div>
  </div>
  <div class="facet-card"><h4>Adapter truth table</h4>${S.adapters.map(a => row(a.id, `${esc(a.name)} → <b>${esc(a.state)}</b>`)).join('')}</div>
   <div class="facet-card"><h4>Release metadata (§129)</h4>
     ${(S.release ? [['version', S.release.version], ['build date', fmtDate(S.release.buildDate)], ['source revision', S.release.sourceRevision], ['dependency state', S.release.dependencyState], ['test status', S.release.testStatus], ['security status', S.release.securityStatus]] : [['version', S.version || '1.95.1'], ['release metadata', 'say “release” in Chat to generate it']]).map(([k, v]) => row(k, esc(String(v)))).join('')}</div>
   <div class="facet-card"><h4>Live systems (§119)</h4>
     ${row('observability', `metrics ${(S.observability || {}).metrics || 0} · spans ${(S.observability || {}).spans || 0}`)}
     ${row('evidence vault', S.evidenceVault ? `${S.evidenceVault.entries} record(s) · ${S.evidenceVault.ok ? 'VERIFIED' : 'CHECK'}` : '—')}
     ${row('anti-fraud', S.fraud ? `${S.fraud.events} event(s)` : '—')}
     ${row('devices', (S.devices || []).length + ' paired')}
     ${row('stops', ((S.kernel || {}).stops || []).length ? ((S.kernel.stops).map(x => x.scope).join(', ')) : 'none')}</div>
   <div class="facet-card"><h4>Diagnostics</h4><div class="input-line" style="margin-top:0"><button class="mini-btn" id="stRun">Run full self-test</button></div><div id="stOut" class="empty-note" style="margin-top:8px">Aggregates economy, audit-chain, SSRF, token and allowlist probes.</div></div>`;
  $('#stRun').onclick = async () => {
    const r = await api('/api/selftest');
    if (!r.ok) { $('#stOut').innerHTML = 'selftest unavailable'; return; }
    const mark = { PASS: '✓', FAIL: '✗', WARNING: '!', NOT_TESTED: '–' };
    $('#stOut').innerHTML = `<p class="empty-note">${Object.entries(r.result.counts).map(([k, v]) => k + ': ' + v).join(' · ')}</p>` +
      r.result.checks.map(c => row(mark[c.result] || '?', `[${esc(c.category)}] ${esc(c.check)}${c.detail ? ' <small>' + esc(c.detail) + '</small>' : ''}`)).join('');
  };
}
/* Settings */
function renderSettings() {
  $('#main').innerHTML = head('USER CONTROLLED', 'Settings', 'Preferences and data controls. Destructive actions require your explicit confirmation word.') +
  `<div class="facet-card"><h4>Data</h4><div class="input-line" style="margin-top:0"><button class="mini-btn" id="setExport">Export all platform data</button></div>
   <div class="input-line"><input id="wipeWord" placeholder="type WIPE to enable"><button class="mini-btn danger" id="setWipe" disabled>Reset platform (high-risk)</button></div></div>
   <div class="facet-card"><h4>Navigation</h4><div class="input-line" style="margin-top:0"><button class="mini-btn" id="setCollapse">Toggle collapsed sidebar (Ctrl+B)</button></div></div>`;
  $('#setExport').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'liam-platform-export.json'; a.click();
  };
  $('#wipeWord').oninput = e => { $('#setWipe').disabled = e.target.value !== 'WIPE'; };
  $('#setWipe').onclick = async () => { await post('/api/admin/clear', { confirm: 'WIPE' }); location.reload(); };
  $('#setCollapse').onclick = toggleCollapse;
}



/* ── Marketplace ─────────────────────────────────────────────────── */
/* v1.69: LD packages card for the Marketplace workspace. */
function ldPackagesCard(pk) {
  const list = (pk && Array.isArray(pk.packages)) ? pk.packages : [];
  return '<div class="facet-card"><h4>LD packages (' + list.length + ')</h4>' +
    list.map(k => row(k.priceAud + ' A$*', '+' + k.totalLd + ' LD (' + k.ld + ' + ' + k.bonus + ' bonus) · ' + k.effectiveAudPerLd + ' per LD', '<button class="mini-btn" data-lpkg="' + k.id + '">Buy</button>')).join('') +
    '<p class="empty-note">* notional A$ — SIMULATION, no real charge (billing compliance-locked).</p></div>';
}
async function renderMarket() {
  const j = await api('/api/market');
  const avs = await api('/api/avatars');
  const avatars = avs.ok ? avs.avatars : [];
  const eco = await api('/api/economy');
  const pk = await api('/api/ld-packages');
  $('#main').innerHTML = head('SIMULATION MARKETPLACE', 'Marketplace', 'Fixed-price listings with LD escrow. Real-money settlement stays compliance-locked; LD mode: ' + (eco.mode || 'SIMULATION') + '.', '<span class="pill simulation">' + esc(eco.mode || 'SIMULATION') + '</span>') +
  ldPackagesCard(pk) +
  `<div class="facet-card"><h4>Listings (${(j.listings || []).length})</h4>${(j.listings || []).map(l => row(l.price + ' LD', `<span style="color:${l.item.color}">${pieceThumb(l.item)}${esc(l.item.name)}</span> <small>${l.item.rarity} R${l.item.rlevel} ${l.item.slot} · ${esc(l.seller)}</small>`, l.seller === 'Vendor' ? (avatars.length ? `<button class="mini-btn" data-buy="${l.id}">Buy</button>` : '') : `<button class="mini-btn danger" data-delist="${l.id}">Delist</button>`)).join('') || '<p class="empty-note">Empty.</p>'}</div>
  <div class="facet-card"><h4>List one of your items</h4>${avatars.length ? `<div class="input-line" style="margin-top:0"><select id="mkItem" class="chip">${avatars[0].inventory.map(i => `<option value="${i.id}">${esc(i.name)} (${i.rarity})</option>`).join('')}</select><input id="mkPrice" placeholder="price LD" style="max-width:110px"><button class="mini-btn" data-list="1">List</button></div>` : '<p class="empty-note">Forge an avatar first.</p>'}</div>`;
  $('#main').onclick = async e => {
    const b = e.target.closest('[data-buy]');
    if (b) { const r = await post('/api/market/buy', { listingId: b.dataset.buy, avatarId: avatars[0].id }); toast(r.ok ? 'Bought ' + r.item.name : (r.error || 'failed')); renderMarket(); return; }
    const lp = e.target.closest('[data-lpkg]');
    if (lp) { const r = await post('/api/command', { text: 'buy ld package ' + lp.dataset.lpkg }); toast(r.ok ? 'LD package bought (+LD credited)' : (r.reply || r.error || 'failed')); renderMarket(); return; }
    const d = e.target.closest('[data-delist]');
    if (d) { const r = await post('/api/market/delist', { listingId: d.dataset.delist }); toast(r.ok ? 'Delisted' : (r.error || 'failed')); renderMarket(); return; }
    const l = e.target.closest('[data-list]');
    if (l) { const r = await post('/api/market/list', { avatarId: avatars[0].id, itemId: $('#mkItem').value, price: $('#mkPrice').value }); toast(r.ok ? 'Listed for ' + r.listing.price + ' LD' : (r.error || 'failed')); renderMarket(); }
  };
}
/* ── Spec Coverage / Documentation / Profile ─────────────────────── */
/* ══ v1.65: events, lotto, rewards, LD market, plans, guardian ══════ */
function ld(n) { return Number(n || 0).toLocaleString() + ' LD'; }
async function renderEvents() {
  const j = await api('/api/engagement');
  const events = (j.events || []);
  const pill = st => st === 'RUNNING' ? 'operational' : st === 'CLOSED' ? 'disconnected' : 'config';
  $('#main').innerHTML = head('EVENTS', 'Events', 'Timed events run inside the labelled simulation economy: entry fees form the pool, the winner takes it less the 1% Treasury rule.', `<span class="pill operational">${events.length} EVENTS</span>`) +
  `<div class="facet-card"><h4>Board</h4>${events.length ? events.map(e => row(e.type, `<b>${esc(e.title)}</b> <span class="pill ${pill(e.state)}">${esc(e.state)}</span> <small>${e.entryLD ? 'entry ' + e.entryLD + ' LD · ' : 'free entry · '}${e.participants} entrant(s) · ${fmtDate(e.startsTs)} → ${fmtDate(e.endsTs)}</small><br>${esc(e.blurb)}`, `<button class="mini-btn" data-join="${e.id}">Join</button><button class="mini-btn" data-prog="${e.id}">Progress</button><button class="mini-btn danger" data-close="${e.id}">Close</button>`)).join('') : '<p class="empty-note">No events on the board.</p>'}</div>
   <div class="facet-card"><h4>Create an event</h4>
     <div class="input-line" style="margin-top:0"><input id="evTitle" placeholder="event title"><input id="evDays" type="number" min="1" value="3" style="max-width:90px"><button class="mini-btn" id="evCreate">Create</button></div>
     <p class="empty-note">Events are records with real windows and real rewards. Closing a tournament settles its entry-fee pool through the ledger.</p></div>`;
  $('#evCreate').onclick = async () => {
    const r = await post('/api/events', { action: 'create', title: $('#evTitle').value, days: $('#evDays').value, type: 'launch', rewardLD: 100 });
    toast(r.ok ? 'Event created: ' + r.event.title : (r.error || 'failed'));
    setView('events', { silent: true });
  };
  $('#main').onclick = async e => {
    const j2 = e.target.closest('[data-join]'); if (j2) { const r = await post('/api/events', { action: 'join', id: j2.dataset.join }); toast(r.reply || r.error || 'joined'); setView('events', { silent: true }); return; }
    const p2 = e.target.closest('[data-prog]'); if (p2) { const r = await post('/api/events', { action: 'progress', id: p2.dataset.prog }); toast(r.reply || r.error || 'recorded'); setView('events', { silent: true }); return; }
    const c2 = e.target.closest('[data-close]'); if (c2) { const r = await post('/api/events', { action: 'close', id: c2.dataset.close, winner: (S && S.owner && S.owner.name) || 'Owner' }); toast(r.reply || r.error || 'closed'); setView('events', { silent: true }); }
  };
}
async function renderLotto() {
  const j = await api('/api/engagement');
  const L = j.lotto || {};
  const open = L.open;
  const rules = L.rules || { ticketLD: 5 };
  $('#main').innerHTML = head('LOTTO', 'Lotto', 'Six numbers from 1–49, tickets bought in LD. The server publishes a hash of its secret seed before any ticket is sold and reveals the seed at the draw — so the numbers cannot be changed afterwards.', `<span class="pill ${open ? 'operational' : 'config'}">${open ? 'ROUND OPEN' : 'NO OPEN ROUND'}</span>`) +
  `<div class="stat-grid">
     <div class="stat-card"><p class="stat-label">Ticket</p><p class="stat-value">${rules.ticketLD} LD</p></div>
     <div class="stat-card"><p class="stat-label">Tickets sold</p><p class="stat-value">${open ? open.tickets : 0}</p></div>
     <div class="stat-card"><p class="stat-label">Prize tiers</p><p class="stat-value">${(rules.split ? Math.round(rules.split.tiers * 100) : 50)}%</p></div>
     <div class="stat-card"><p class="stat-label">Jackpot share</p><p class="stat-value">${(rules.split ? Math.round(rules.split.jackpot * 100) : 30)}%</p></div>
   </div>
   <div class="facet-card"><h4>Round</h4>
     ${open ? row('commitment', `<code>${esc(open.commitHash).slice(0, 32)}…</code>`) : '<p class="empty-note">No round is open.</p>'}
     <div class="input-line" style="margin-top:8px"><input id="ltCount" type="number" min="1" max="50" value="3" style="max-width:90px"><button class="mini-btn" id="ltOpen">Open round</button><button class="mini-btn" id="ltBuy">Buy tickets</button><button class="mini-btn" id="ltDraw">Draw</button><button class="mini-btn" id="ltVerify">Verify last draw</button></div>
     <div id="ltOut" class="empty-note" style="margin-top:8px">${esc(rules.settlement || '')}</div></div>
   <div class="facet-card"><h4>Recent draws</h4>${(L.rounds || []).filter(r => r.state === 'DRAWN').map(r => row(fmtDate(r.drawnTs), `<b>${r.drawn.numbers.join(' · ')}</b> <small>${r.prizes.payouts.length} winner(s) · paid ${r.prizes.paid} LD · treasury ${r.prizes.treasury} LD · rollover ${r.prizes.rolloverOut} LD</small>`)).join('') || '<p class="empty-note">No draws yet.</p>'}</div>`;
  const cmd = async t => { const r = await post('/api/command', { text: t }); $('#ltOut').innerHTML = esc(r.reply || r.error || ''); };
  $('#ltOpen').onclick = async () => { await cmd('open lotto round'); setView('lotto', { silent: true }); };
  $('#ltBuy').onclick = async () => { await cmd('buy ' + ($('#ltCount').value || 1) + ' lotto tickets'); setView('lotto', { silent: true }); };
  $('#ltDraw').onclick = async () => { await cmd('draw lotto confirm'); setView('lotto', { silent: true }); };
  $('#ltVerify').onclick = async () => { await cmd('verify lotto'); };
}
async function renderRewards() {
  const j = await api('/api/engagement');
  const si = j.signIn || {};
  const q = j.quests || { daily: [], weekly: [] };
  const bar = t => `<div style="height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:4px"><div style="height:100%;width:${Math.min(100, Math.round((t.progress / t.target) * 100))}%;background:linear-gradient(90deg,#7c5cff,#4fd1c5)"></div></div>`;
  const taskRow = t => row(t.claimable ? '★' : t.complete ? '■' : '□', `<b>${esc(t.title)}</b> <small>${t.progress}/${t.target} · ${t.ld} LD · ${esc(t.window)}</small>${bar(t)}`, `<button class="mini-btn" data-claim="${t.id}" ${t.claimable ? '' : 'disabled'}>Claim</button>`);
  $('#main').innerHTML = head('REWARDS', 'Rewards', 'Sign-in gifts and the daily/weekly task board. Rewards are paid from the funded Rewards Pool and recorded in the ledger — never minted silently.', `<span class="pill operational">STREAK ${si.streak || 0}</span>`) +
  `<div class="stat-grid">
     <div class="stat-card"><p class="stat-label">Streak</p><p class="stat-value">${si.streak || 0}d</p></div>
     <div class="stat-card"><p class="stat-label">Next gift</p><p class="stat-value">${si.nextReward ? si.nextReward.ld : 10} LD</p></div>
     <div class="stat-card"><p class="stat-label">Claimable tasks</p><p class="stat-value">${q.claimable || 0}</p></div>
     <div class="stat-card"><p class="stat-label">Window</p><p class="stat-value" style="font-size:15px">${esc(q.day || '')}</p></div>
   </div>
   <div class="facet-card"><h4>Sign-in gift</h4>
     ${si.claimedToday ? row('claimed', `Today’s gift is claimed. Next in ${Math.round((si.nextInMs || 0) / 3600000)}h.`) : row('ready', 'Your gift is unclaimed.')}
     <div class="input-line" style="margin-top:8px"><button class="mini-btn" id="rwClaim">Claim sign-in gift</button></div>
     <p class="empty-note">Seven-day cycle: ${(si.cycle || []).map(c => c.ld).join(' / ')} LD.</p></div>
   <div class="facet-card"><h4>Daily tasks (${esc(q.day || '')})</h4>${(q.daily || []).map(taskRow).join('')}</div>
   <div class="facet-card"><h4>Weekly tasks (${esc(q.week || '')})</h4>${(q.weekly || []).map(taskRow).join('')}</div>`;
  $('#rwClaim').onclick = async () => { const r = await post('/api/signin', {}); toast(r.reply || r.error || 'claimed'); setView('rewards', { silent: true }); };
  $('#main').onclick = async e => {
    const b = e.target.closest('[data-claim]'); if (!b) return;
    const r = await post('/api/quests', { action: 'claim', id: b.dataset.claim });
    toast(r.reply || r.error || 'claimed'); setView('rewards', { silent: true });
  };
}
async function renderLDMarket() {
  const j = await api('/api/ldmarket');
  const mk = j.market || {};
  const eco = j.economy || { balances: {}, pools: {}, orders: [] };
  const bal = (S && S.owner && S.owner.name) || 'Owner';
  $('#main').innerHTML = head('LD MARKET', 'LD Market', 'Buy and sell LD here. Simulation is the only permitted live mode: no money is charged or paid out, and every LD movement is a balanced double-entry post at the disclosed reference rate.', `<span class="pill simulation">SIMULATION</span>`) +
  `<div class="stat-grid">
     <div class="stat-card"><p class="stat-label">Wallet</p><p class="stat-value">${ld(eco.balances ? eco.balances[bal] : 0)}</p></div>
     <div class="stat-card"><p class="stat-label">Buy rate</p><p class="stat-value" style="font-size:16px">A$${mk.buyRateAudPerLD} / LD</p></div>
     <div class="stat-card"><p class="stat-label">Sell rate</p><p class="stat-value" style="font-size:16px">A$${mk.sellRateAudPerLD} / LD</p></div>
     <div class="stat-card"><p class="stat-label">Spread</p><p class="stat-value">${Math.round((1 - (mk.sellRateAudPerLD || 0.0095) / (mk.buyRateAudPerLD || 0.01)) * 100)}%</p></div>
   </div>
   <div class="facet-card"><h4>Order</h4>
     <div class="input-line" style="margin-top:0"><input id="ldAmt" type="number" min="100" step="10" value="500"><button class="mini-btn" id="ldBuy">Buy LD</button><button class="mini-btn" id="ldSell">Sell LD</button></div>
     <p class="empty-note">Minimum ${mk.minOrderLD} LD, multiples of ${mk.roundToLD} LD. ${esc(mk.note || '')}</p></div>
   <div class="facet-card"><h4>LD pools (rewards can only be paid from a funded pool)</h4>
     ${Object.entries(eco.pools || {}).map(([k, v]) => row(k, ld(v))).join('')}</div>
   <div class="facet-card"><h4>Piece prices</h4>
     ${Object.entries((j.prices || {}).pieces || {}).map(([k, v]) => row(k, ld(v))).join('')}
     ${row('pet', ld((j.prices || {}).pet))}${row('merge', Object.entries((j.prices || {}).merge || {}).map(([k, v]) => k + ' ' + v).join(' · '))}
     <p class="empty-note">${esc((j.prices || {}).drops || '')}</p></div>
   <div class="facet-card"><h4>Recent orders</h4>${(eco.orders || []).length ? eco.orders.map(o => row(o.side, `${ld(o.ld)} for A$${Number(o.aud).toFixed(2)} at A$${o.rateAudPerLD}/LD <small>${esc(o.mode)} · ${fmtDate(o.ts)}</small>`)).join('') : '<p class="empty-note">No orders yet.</p>'}</div>`;
  const order = async side => {
    const r = await post('/api/ldmarket', { side, ld: Number($('#ldAmt').value) || 0 });
    toast(r.ok ? `${side === 'buy' ? 'Bought' : 'Sold'} ${r.order.ld} LD (SIMULATION) — balance ${r.balance} LD` : (r.error || 'failed'));
    setView('ldmarket', { silent: true });
  };
  $('#ldBuy').onclick = () => order('buy');
  $('#ldSell').onclick = () => order('sell');
}
/* ══ v1.76: credentials surface — keys with their developer-portal guides ══ */
const CRED_CATALOG = [
  { g: 'AI BRAIN', id: 'groq', name: 'Groq', portal: 'console.groq.com/keys', portalUrl: 'https://console.groq.com/keys', steps: 'Sign up (free, no card) → API Keys → Create API Key. OpenAI-compatible endpoint; the free tier is roughly 30 req/min, 14,400 req/day.', ph: 'gsk_…' },
  { g: 'AI BRAIN', id: 'gemini', name: 'Google AI Studio (Gemini)', portal: 'aistudio.google.com/apikey', portalUrl: 'https://aistudio.google.com/apikey', steps: 'Sign in with a Google account → Get API key → Create API key. Free tier, no card (rate-limited per model).', ph: 'AIza…' },
  { g: 'AI BRAIN', id: 'openrouter', name: 'OpenRouter', portal: 'openrouter.ai/keys', portalUrl: 'https://openrouter.ai/keys', steps: 'Sign in → Keys → Create key. One key reaches 400+ models; “:free”-tagged models cost nothing, paid models bill per token.', ph: 'sk-or-v1-…' },
  { g: 'AI BRAIN', id: 'deepseek', name: 'DeepSeek', portal: 'platform.deepseek.com', portalUrl: 'https://platform.deepseek.com/api_keys', steps: 'Sign up → API keys → Create new secret key. Free credit grant on signup, then pay-as-you-go.', ph: 'sk-…' },
  { g: 'AI BRAIN', id: 'mistral', name: 'Mistral', portal: 'console.mistral.ai/api-keys', portalUrl: 'https://console.mistral.ai/api-keys', steps: 'Sign up → API keys → Create new key. The “experiment” plan is a free tier.', ph: '…' },
  { g: 'SOCIAL', id: 'x', name: 'X (Twitter)', portal: 'console.x.com', portalUrl: 'https://console.x.com', steps: 'Sign in → create a project/app → copy the Bearer Token. 2026 truth: no free tier for new developers — pay-per-use credits must be loaded first (≈$0.015 per post, ≈$0.005 per read).', ph: 'Bearer AAAA…', risk: 'Posting is HIGH RISK → approval-gated' },
  { g: 'SOCIAL', id: 'facebook', name: 'Facebook (Graph API)', portal: 'developers.facebook.com', portalUrl: 'https://developers.facebook.com', steps: 'Create app → Tools → Graph API Explorer → Get Token → Page Access Token with pages_manage_posts. Page posting only, high-risk, approval-gated.', ph: 'EAA…', risk: 'Posting is HIGH RISK → approval-gated' },
  { g: 'SOCIAL', id: 'reddit', name: 'Reddit', portal: 'reddit.com/prefs/apps', portalUrl: 'https://www.reddit.com/prefs/apps', steps: 'Prefs → apps → “create another app…” (type: script) → combine as client_id:client_secret. Submission is high-risk, approval-gated.', ph: 'client_id:client_secret', risk: 'Posting is HIGH RISK → approval-gated' },
  { g: 'SOCIAL', id: 'instagram', name: 'Instagram (Business)', portal: 'developers.facebook.com', portalUrl: 'https://developers.facebook.com', steps: 'Meta app → add the Instagram product → generate token. Requires a Business/Creator account linked to a Facebook Page. This connector verifies identity only.', ph: 'EAA… / IGAA…', risk: 'Verify-only connector' },
  { g: 'SOCIAL', id: 'linkedin', name: 'LinkedIn', portal: 'linkedin.com/developers', portalUrl: 'https://www.linkedin.com/developers/apps', steps: 'Create app → request the Sign In / Share products → OAuth 2.0 member token. This connector verifies identity only.', ph: 'AQX… / AQY…', risk: 'Verify-only connector' },
  { g: 'SOCIAL', id: 'tiktok', name: 'TikTok', portal: 'developers.tiktok.com', portalUrl: 'https://developers.tiktok.com', steps: 'Create app → manage apps → client key + secret as key:secret. This connector verifies identity only.', ph: 'client_key:client_secret', risk: 'Verify-only connector' },
  { g: 'CORE', id: 'github', name: 'GitHub', portal: 'github.com/settings/tokens', portalUrl: 'https://github.com/settings/tokens', steps: 'Settings → Developer settings → Personal access tokens → fine-grained PAT with Contents read/write on gtpw0494-png/Witforge. Unlocks real repo reads and approval-gated writes.', ph: 'github_pat_…' },
  { g: 'CORE', id: 'stripe', name: 'Stripe', portal: 'dashboard.stripe.com/apikeys', portalUrl: 'https://dashboard.stripe.com/apikeys', steps: 'Developers → API keys → a restricted key (rk_…) is recommended — least privilege. Verification + evidence only: real money stays compliance-locked (Charter art. IV).', ph: 'rk_live_… / sk_…' }
];
async function renderCredentials() {
  const [j, oj] = await Promise.all([api('/api/credentials'), api('/api/oauth')]);
  const stored = new Set((j.credentials || []).map(c => c.service));
  const adState = {}; (j.adapters || []).forEach(a => { adState[a.id] = String(a.state || ''); });
  const oa = {}; (oj.providers || []).forEach(x => { oa[x.id] = x; });
  const callbackUrl = oj.callbackUrl || '…/api/oauth/callback';
  /* v1.77: official sign-in — user authenticates on the platform's page; the
   * password never touches WitForge. Paste-a-bearer-token stays available for
   * developers; OAuth is the familiar path for everyone else. */
  /* v1.80: the OAuth journey renders its truthful stage — never a flat
   * “unverified”. SETUP REQUIRED → REGISTERED · NOT AUTHORISED → AUTHORISED ·
   * NOT CONNECTED → CONNECTED · VERIFIED. Each stage shows its next honest
   * action (inputs for registration, Authorise for grant, Verify for proof). */
  const OA_PILL = {
    'setup-required': '<span class="pill config">SETUP REQUIRED</span>',
    'registered-not-authorised': '<span class="pill simulation">REGISTERED · NOT AUTHORISED</span>',
    'authorised-not-connected': '<span class="pill config">AUTHORISED · NOT CONNECTED</span>',
    'connected-verified': '<span class="pill operational">CONNECTED · VERIFIED</span>'
  };
  const oauthBlock = c => {
    const s = oa[c.id]; if (!s) return '';
    if (s.stage === 'setup-required') return `<div style="margin-top:8px;padding:8px;border:1px dashed #3a4360;border-radius:8px">
       <b>🔐 Official sign-in</b> ${OA_PILL[s.stage]}
       <p class="empty-note">No developer app registered yet — register one at <a href="${esc(c.portalUrl)}" target="_blank" rel="noopener">${esc(s.portal)} ↗</a> (steps above), enter the callback URL there exactly as shown here: <code>${esc(callbackUrl)}</code>, then paste its credentials:</p>
       <div class="input-line"><input id="oa-id-${c.id}" placeholder="client id" style="flex:1;min-width:140px"><input id="oa-sc-${c.id}" type="password" placeholder="client secret (if issued)" autocomplete="off" style="flex:1;min-width:140px"><button class="mini-btn" data-oa-act="register" data-cr="${c.id}">Save app</button></div></div>`;
    if (s.stage === 'registered-not-authorised') return `<div style="margin-top:8px;padding:8px;border:1px solid #46557d;border-radius:8px">
       <b>🔐 Official sign-in</b> ${OA_PILL[s.stage]}
       <p class="empty-note">Your app is saved. Nothing is authorised yet — authorise on ${esc(c.name)}'s own page; your password never touches WitForge and the callback lands back here automatically.</p>
       <div class="input-line"><button class="mini-btn" data-oa-act="start" data-cr="${c.id}">Authorise with ${esc(c.name)}</button><button class="mini-btn danger" data-oa-act="forget" data-cr="${c.id}">Forget app</button>
       <input id="oa-code-${c.id}" placeholder="…or paste code" style="width:130px"><button class="mini-btn" data-oa-act="exchange" data-cr="${c.id}">Exchange</button></div></div>`;
    if (s.stage === 'authorised-not-connected') return `<div style="margin-top:8px;padding:8px;border:1px solid #3a4360;border-radius:8px">
       <b>🔐 Official sign-in</b> ${OA_PILL[s.stage]}
       <p class="empty-note">An account token is <b>authorised and stored</b> (AES-256-GCM) — but it is <b>not connected</b>: nothing has proven it against the live API. Press <b>Verify</b> below for a real round trip with recorded evidence (or “verify ${c.id}” in Chat).</p>
       <div class="input-line"><button class="mini-btn" data-oa-act="start" data-cr="${c.id}">Authorise again</button><button class="mini-btn danger" data-oa-act="forget" data-cr="${c.id}">Forget app</button></div></div>`;
    return `<div style="margin-top:8px;padding:8px;border:1px solid #2e7d5b;border-radius:8px">
       <b>🔐 Official sign-in</b> ${OA_PILL[s.stage]}
       <p class="empty-note"><b>Connected and proven</b> with a real round trip${s.verifiedTs ? ' on ' + new Date(s.verifiedTs).toLocaleString() : ''} — evidence is in the audit log.</p>
       <div class="input-line"><button class="mini-btn" data-oa-act="start" data-cr="${c.id}">Authorise again</button><button class="mini-btn danger" data-oa-act="forget" data-cr="${c.id}">Forget app</button></div></div>`;
  };
  const pill = c => !stored.has(c.id) ? '<span class="pill disconnected">NO KEY</span>'
    : adState[c.id].startsWith('VERIFIED') ? (oa[c.id] ? '<span class="pill operational">CONNECTED · VERIFIED</span>' : '<span class="pill operational">VERIFIED</span>')
    : oa[c.id] ? '<span class="pill config">AUTHORISED · NOT CONNECTED</span>'
    : '<span class="pill config">KEY STORED · not verified</span>';
  const card = c => `<div class="facet-card"><h4>🔑 ${esc(c.name)} <small>[${c.id}]</small> ${pill(c)}</h4>
     <p class="empty-note">${esc(c.steps)} → <a href="${c.portalUrl}" target="_blank" rel="noopener">${esc(c.portal)} ↗</a>${c.risk ? ' · <b>' + esc(c.risk) + '</b>' : ''}</p>
     ${c.g === 'SOCIAL' ? oauthBlock(c) : ''}
     <div class="input-line" style="margin-top:8px"><input type="password" id="cr-${c.id}" placeholder="${esc(c.ph)}" autocomplete="off" style="flex:1;min-width:180px"><button class="mini-btn" data-cr-act="connect" data-cr="${c.id}">Connect</button><button class="mini-btn" data-cr-act="verify" data-cr="${c.id}" ${stored.has(c.id) ? '' : 'disabled'}>Verify</button><button class="mini-btn danger" data-cr-act="revoke" data-cr="${c.id}" ${stored.has(c.id) ? '' : 'disabled'}>Revoke</button></div>
     <div class="empty-note" id="cr-out-${c.id}" style="margin-top:6px"></div></div>`;
  $('#main').innerHTML = head('CREDENTIALS', 'Credentials — connections & API keys', 'Keys are stored AES-256-GCM encrypted on this server, are never returned by any API, and are sent only to the service they belong to. Connecting proves nothing — Verify proves it with a real round trip and recorded evidence.', `<span class="pill operational">${stored.size} stored</span>`) +
    `<div class="facet-card"><h4>Charter art. III §3 — informed consent</h4><p class="empty-note">Every key here is owner-granted and revocable in one click (“disconnect &lt;id&gt;” also works in Chat, as do “connect &lt;id&gt; with token &lt;key&gt;” and “verify &lt;id&gt;”). Hosted WitForge can use ForgeNative or verified cloud providers; Ollama is optional and only needed if you explicitly choose that provider.</p></div>` +
    ['AI BRAIN', 'SOCIAL', 'CORE'].map(g => `<h4 style="margin:18px 0 8px">${g}</h4>` + CRED_CATALOG.filter(c => c.g === g).map(card).join('')).join('');
  $('#main').onclick = async e => {
    const ob = e.target.closest('[data-oa-act]');
    if (ob) {
      const id = ob.dataset.cr, act = ob.dataset.oaAct, out = document.getElementById('cr-out-' + id);
      if (act === 'register') {
        const cid = (document.getElementById('oa-id-' + id).value || '').trim(), cs = (document.getElementById('oa-sc-' + id).value || '').trim();
        const r = await api('/api/oauth', { method: 'POST', body: { action: 'register', id, clientId: cid, clientSecret: cs } });
        toast(r.ok ? 'OAuth app saved: ' + id : (r.error || 'failed')); setView('credentials', { silent: true });
      } else if (act === 'forget') {
        const r = await api('/api/oauth', { method: 'POST', body: { action: 'forget', id } });
        toast(r.ok ? 'OAuth app removed: ' + id : (r.error || 'failed')); setView('credentials', { silent: true });
      } else if (act === 'start') {
        const r = await api('/api/oauth', { method: 'POST', body: { action: 'start', id } });
        if (r.ok === false || r.error) { if (out) out.textContent = r.error || 'failed'; return; }
        if (out) out.textContent = 'Opened the official ' + id + ' sign-in — finish it there; the token stores itself on return (callback).';
        window.open(r.url, '_blank', 'noopener');
      } else if (act === 'exchange') {
        const code = (document.getElementById('oa-code-' + id).value || '').trim();
        const r = await api('/api/oauth', { method: 'POST', body: { action: 'exchange', id, code } });
        if (out) out.textContent = r.ok ? (r.note || 'Token stored') : (r.error || 'failed');
        if (r.ok) setView('credentials', { silent: true });
      }
      return;
    }
    const b = e.target.closest('[data-cr-act]'); if (!b) return;
    const id = b.dataset.cr, act = b.dataset.crAct, out = document.getElementById('cr-out-' + id);
    if (act === 'connect') {
      const inp = document.getElementById('cr-' + id), tok = (inp.value || '').trim();
      if (!tok) { if (out) out.textContent = 'Paste the key into the field first.'; return; }
      const r = await api('/api/credentials', { method: 'POST', body: { id, token: tok } });
      inp.value = ''; toast(r.ok ? 'Key stored (encrypted): ' + id : (r.error || 'failed'));
      setView('credentials', { silent: true });
    } else if (act === 'verify') {
      if (out) out.textContent = 'Verifying with a real API round trip…';
      const r = await api('/api/command', { method: 'POST', body: { text: 'verify ' + id } });
      if (out) out.textContent = (r.reply || r.error || 'no reply');
    } else if (act === 'revoke') {
      const r = await api('/api/credentials', { method: 'POST', body: { id, revoke: true } });
      toast(r.ok ? 'Credential destroyed: ' + id : (r.error || 'failed'));
      setView('credentials', { silent: true });
    }
  };
}
async function renderPlans() {
  const j = await api('/api/plans');
  const cur = j.current || {};
  const tierCard = p => `<div class="facet-card"><h4>${esc(p.name)} <small>[${esc(p.id)}]${cur.planId === p.id ? ' — current' : ''}</small></h4>
     <p class="empty-note">${esc(p.blurb || '')}</p>
     ${row('price', p.priceAudMonth ? 'A$' + p.priceAudMonth + ' / month (reference label — nothing is charged)' : 'free')}
     ${Object.entries(p.entitlements).map(([k, v]) => row(k, esc(String(v)))).join('')}
     <div class="input-line" style="margin-top:8px"><button class="mini-btn" data-plan="${p.id}" ${cur.planId === p.id ? 'disabled' : ''}>Select</button></div></div>`;
  const fam = f => (j.plans || []).filter(p => (p.family || 'personal') === f);
  $('#main').innerHTML = head('SUBSCRIPTIONS', 'Plans', 'Personal and business tiers with server-side entitlements. Selecting a tier changes what the platform allows your agents to do — it never changes what the platform promises you.', `<span class="pill operational">${cur.planName || '—'}</span>`) +
  `<div class="facet-card"><h4>Billing truth</h4><p class="empty-note">${esc((cur.billing || {}).note || 'Billing is not chargeable in this build.')} Prices shown are reference labels; no charge is created, and the compliance lock on real money is unchanged.</p></div>
   <h4 style="margin:18px 0 8px">Personal</h4>${fam('personal').map(tierCard).join('')}
   <h4 style="margin:18px 0 8px">Business</h4>${fam('business').map(tierCard).join('')}`;
  $('#main').onclick = async e => {
    const b = e.target.closest('[data-plan]'); if (!b) return;
    const r = await api('/api/plans', { method: 'POST', body: { plan: b.dataset.plan } });
    toast(r.ok ? 'Plan: ' + r.subscription.planName : (r.error || 'failed'));
    setView('plans', { silent: true });
  };
}
async function renderGuardian() {
  const j = await api('/api/guardian');
  const sec = await api('/api/security/owner');
  const p = sec.protection || {};
  const g = j.guardian || {};
  const badge = st => st === 'COVERED' ? 'operational' : st === 'PARTIAL' ? 'simulation' : 'disconnected';
  $('#main').innerHTML = head('OWNER PROTECTION', 'Guardian', 'Personal security for your account, and the duty charter every agent owes you. Everything an agent does is screened against these duties and recorded.', `<span class="pill ${p.score >= 70 ? 'operational' : 'config'}">POSTURE ${esc(p.grade || '—')} ${p.score || 0}/100</span>`) +
  `<div class="facet-card"><h4>Owner account</h4>
     ${row('security level', esc(p.level || 'BASIC'))}
     ${row('second factor', p.secondFactor && p.secondFactor.enabled ? (p.secondFactor.verified ? 'ENABLED · verified · ' + p.secondFactor.recoveryCodesLeft + ' recovery code(s) left' : 'enrolled — verify a code to finish') : 'not enabled')}
     ${row('sessions', String(p.sessions || 0) + ' active')}
     <div class="input-line" style="margin-top:8px"><button class="mini-btn" id="gc2fa">${p.secondFactor && p.secondFactor.enabled ? 'Rotate factor' : 'Enable second factor'}</button><button class="mini-btn" id="gcharden">Harden to maximum</button><button class="mini-btn" id="gcdrill">Run drill</button><button class="mini-btn danger" id="gcrevoke">Revoke all sessions</button></div>
     <div id="gcOut" class="empty-note" style="margin-top:8px">${esc(p.honestLimit || '')}</div></div>
   <div class="facet-card"><h4>Controls (${p.controlsEnabled || 0}/${p.controlsTotal || 0} enabled)</h4>${(sec.controls || []).map(c => row(c.enabled ? '✓' : '○', `<b>${esc(c.name)}</b> <small>${esc(c.section)}</small><br><span class="empty-note">${esc(c.blurb)}</span>`)).join('')}</div>
   <div class="facet-card"><h4>Threat matrix</h4>${(j.threats || []).map(t => row(t.status, `<b>${esc(t.name)}</b> <span class="pill ${badge(t.status)}">${esc(t.status)}</span><br><small>${esc(t.control)}${t.note ? ' — ' + esc(t.note) : ''}</small>`)).join('')}
     <p class="empty-note">${esc((j.notPromised || [])[0] || '')}</p></div>
   <div class="facet-card"><h4>Agent duties (${(g.duties || []).length})</h4>${(g.duties || []).map(d => row('•', `<b>${esc(d.name)}</b><br><small>${esc(d.blurb)}</small>`)).join('')}
     <p class="empty-note">${esc(g.oath || '')}</p>
     <div class="input-line" style="margin-top:8px"><input id="gCheck" placeholder="something an agent might do"><button class="mini-btn" id="gCheckBtn">Screen it</button></div>
     <div id="gOut" class="empty-note" style="margin-top:8px">Decisions recorded: ${g.events || 0} (${g.denied || 0} refused, ${g.asked || 0} escalated to you).</div></div>
   <div class="facet-card"><h4>Recent guardian decisions</h4>${(g.recent || []).length ? g.recent.map(e => row(e.decision, `${esc(e.agent)}: ${esc(e.action)} <small>${fmtTime(e.ts)}</small>`)).join('') : '<p class="empty-note">Nothing screened yet.</p>'}</div>
   <div class="facet-card"><h4>Alerts</h4>${(sec.alerts || []).length ? sec.alerts.map(a => row(a.severity, `${esc(a.kind)}: ${esc(a.detail)} <small>${fmtTime(a.ts)}</small>`)).join('') : '<p class="empty-note">No security alerts.</p>'}</div>`;
  $('#gc2fa').onclick = async () => {
    const r = await post('/api/security/owner', { action: 'enroll', rotate: true });
    if (!r.ok) { $('#gcOut').innerHTML = esc(r.error || 'failed'); return; }
    $('#gcOut').innerHTML = '<b>Add to your authenticator now (shown once):</b><br><code>' + esc(r.secret) + '</code><br><small>' + esc(r.otpauthUrl) + '</small><br><b>Recovery codes:</b><br>' + r.recoveryCodes.map(c => '<code>' + esc(c) + '</code>').join(' ') + '<br>Then verify with a code: “verify second factor 123456” in Chat.';
  };
  $('#gcharden').onclick = async () => { const r = await post('/api/security/owner', { action: 'level', level: 'MAXIMUM' }); $('#gcOut').innerHTML = esc(r.ok ? 'Level ' + r.level.id + ': ' + r.level.blurb : (r.error || 'failed')); };
  $('#gcdrill').onclick = async () => { const r = await post('/api/security/owner', { action: 'drill', kind: 'security' }); $('#gcOut').innerHTML = r.ok ? r.drill.checks.map(c => (c.pass ? '✓ ' : '✗ ') + esc(c.check) + ' — ' + esc(c.detail)).join('<br>') : 'failed'; };
  $('#gcrevoke').onclick = async () => { const r = await post('/api/security/owner', { action: 'revoke', all: true }); $('#gcOut').innerHTML = esc(r.ok ? 'Revoked ' + r.revoked + ' session(s)' : (r.error || 'failed')); };
  $('#gCheckBtn').onclick = async () => {
    const r = await api('/api/guardian', { method: 'POST', body: { text: $('#gCheck').value } });
    $('#gOut').innerHTML = `<b>${esc(r.decision)}</b> — ${esc(r.reason)}${r.triggeredDuties && r.triggeredDuties.length ? '<br>Duties engaged: ' + esc(r.triggeredDuties.join(', ')) : ''}`;
  };
}
async function renderSpec() {
  const j = await api('/api/spec/compliance');
  if (!j.ok) { $('#main').innerHTML = head('SPEC', 'Spec', 'Compliance registry unavailable.'); return; }
  const c = j.coverage;
  const counts = c.counts;
  $('#main').innerHTML = head('DEFINITIVE ARCHITECTURE', 'Specification Coverage', 'All 177 requirements (168 master sections + 9 additive platform requirements) with truthful status and live evidence probes.', '<span class="pill operational">' + c.total + ' SECTIONS</span>') +
  `<div class="stat-grid">
    <div class="stat-card"><p class="stat-label">LIVE</p><p class="stat-value">${counts.LIVE || 0}</p></div>
    <div class="stat-card"><p class="stat-label">PARTIAL</p><p class="stat-value">${counts.PARTIAL || 0}</p></div>
    <div class="stat-card"><p class="stat-label">EXTERNAL</p><p class="stat-value">${counts.EXTERNAL || 0}</p></div>
    <div class="stat-card"><p class="stat-label">LOCKED / POLICY</p><p class="stat-value">${(counts.LOCKED || 0) + (counts.POLICY || 0)}</p></div>
  </div>
  <div class="facet-card"><h4>Live probes</h4>
    ${row('audit', `tamper-evident chain → <b>${c.probes.auditChain.ok ? 'VERIFIED' : 'BROKEN'}</b> (${c.probes.auditChain.entries} entries)`)}
    ${row('assets', `rarity scale → <b>${c.probes.rarityLevels} levels</b> · registered assets → <b>${c.probes.assets}</b>`)}
    ${row('legal', `versioned legal records → <b>${c.probes.legalDocs}</b>`)}
    ${row('auth', `owner auth → <b>${c.probes.ownerAuth ? 'ACTIVE' : 'first-run open'}</b> · evidence vault → <b>${c.probes.evidenceRecords}</b>`)}
    ${row('permissions', `capabilities tracked → <b>${(c.probes.permissionStates || []).length}</b> · policy decisions → <b>${(c.probes.policyEngine || []).join('/')}</b>`)}
    ${row('risk', `classes → <b>${(c.probes.riskEngine && c.probes.riskEngine.classes || []).join(' ')}</b> · PROHIBITED executable → <b>${String(c.probes.riskEngine && c.probes.riskEngine.prohibitedExecutable)}</b>`)}
    ${row('tasks', `task states → <b>${(c.probes.taskStates || []).length}</b> · result states → <b>${(c.probes.resultStates || []).length}</b> · failure classes → <b>${(c.probes.failureClasses || []).length}</b>`)}
    ${row('stops', `active emergency stops → <b>${(c.probes.stops || []).length}</b>${(c.probes.stops || []).length ? ' (' + c.probes.stops.map(x => esc(x.scope)).join(', ') + ')' : ''}`)}
    ${row('devices', `paired devices → <b>${(c.probes.devices || []).length}</b> · accounts recorded → <b>${(c.probes.accounts || []).length}</b> · plan → <b>${esc(String(c.probes.subscription))}</b>`)}
    ${row('playbooks', `spec workflows → <b>${c.probes.playbooks}</b> · mock adapters → <b>${c.probes.mockAdapters.length} (never connected)</b>`)}
    ${row('selftest', `PASS ${c.probes.selftest.counts.PASS} · FAIL ${c.probes.selftest.counts.FAIL} · WARNING ${c.probes.selftest.counts.WARNING} · NOT_TESTED ${c.probes.selftest.counts.NOT_TESTED}`)}
    ${row('release', `${esc(String(c.probes.release.version))} · revision ${esc(String(c.probes.release.revision))}`)}
    ${c.probes.adapters.map(a => row(a.id, esc(a.state))).join('')}
  </div>
  <div class="chip-row" id="specFilter">${['ALL', 'LIVE', 'PARTIAL', 'EXTERNAL', 'LOCKED', 'POLICY'].map((f, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-sf="${f}">${f}</button>`).join('')}</div>
  <div class="facet-card"><h4>Sections</h4><div id="specList"></div></div>`;
  const paint = f => {
    const list = c.sections.filter(x => f === 'ALL' || x.status === f);
    $('#specList').innerHTML = list.map(x => row(String(x.n).padStart(3, '0'), `<b>${esc(x.t)}</b> <small>[${esc(x.area)}]</small> — ${esc(x.note)}${x.evidence ? `<br><small class="probe-evidence">evidence: ${esc(x.evidence)}</small>` : ''}`, `<span class="pill ${x.status === 'LIVE' ? 'operational' : x.status === 'EXTERNAL' ? 'disconnected' : x.status === 'LOCKED' ? 'config' : x.status === 'PARTIAL' ? 'simulation' : 'operational'}" style="${x.status === 'POLICY' ? 'opacity:.7' : ''}">${x.status}</span>`)).join('');
  };
  paint('ALL');
  $('#specFilter').onclick = e => { const b = e.target.closest('[data-sf]'); if (!b) return; [...$('#specFilter').children].forEach(x => x.classList.toggle('on', x === b)); paint(b.dataset.sf); };
}
/* §130–§139 accounts + §113 organisations + §114 entitlements */
function renderAccountsPanel() {
  const accts = S.accounts || [];
  const subs = S.subscription || { planName: '—', entitlements: {} };
  return `<div class="facet-card"><h4>Account inventory (§134)</h4>
    ${accts.length ? accts.map(a => row(a.connectionStatus, `<b>${esc(a.service)}:${esc(a.identifier)}</b> <small>${esc(a.securityStatus)} · ${a.capabilities.length} cap(s)${a.expiresTs ? ' · expires ' + fmtDate(a.expiresTs) : ''}${a.revocationState ? ' · revoked' : ''}</small>`, `<button class="mini-btn" data-acctsel="${a.id}">Use</button><button class="mini-btn danger" data-acctdisc="${a.id}">Disconnect</button>`)).join('') : '<p class="empty-note">No accounts recorded. “record account <service>:<identifier>” in Chat. Configuration alone never counts as connected.</p>'}
    <div class="input-line" style="margin-top:8px"><input id="acctRec" placeholder="service:identifier"><button class="mini-btn" id="acctRecord">Record</button></div>
    <p class="empty-note">Multiple accounts per service stay separated; an ambiguous service fails closed rather than acting through the wrong account (§135).</p></div>
  <div class="facet-card"><h4>Subscription (§114)</h4>
    ${row('plan', `<b>${esc(subs.planName || '—')}</b> · ${esc(subs.planId || '')}`)}
    ${Object.entries(subs.entitlements || {}).map(([k, v]) => row(k, esc(String(v)))).join('')}
    <p class="empty-note">Premium controls are enforced server-side. Billing stays locked until billing authority exists — the platform never creates charges it is not authorized to create.</p></div>
  <div class="facet-card"><h4>Organisations (§113)</h4>
    ${(S.orgs || []).length ? (S.orgs).map(o => row(o.name, `${o.members.length} member(s) · ${o.teams.length} team(s) · ${o.delegatedCapabilities.length} delegated cap(s)`)).join('') : '<p class="empty-note">No organisations. Organisation authority never overrides individual account authority.</p>'}
    <div class="input-line" style="margin-top:8px"><input id="orgName" placeholder="organisation name"><button class="mini-btn" id="orgCreate">Create</button></div></div>`;
}
async function renderDocs() {
  const j = await api('/api/legal');
  const docs = j.ok ? j.docs : [];
  $('#main').innerHTML = head('GOVERNANCE', 'Documentation', 'Versioned legal records with effective dates, architecture lineage and the absolute truth rules. Records are not legal advice.') +
  `<div class="facet-card"><h4>Legal documents (${docs.length})</h4>${docs.map(d => row(d.effective, `<b>${esc(d.title)}</b> v${esc(d.version)} — ${esc(d.summary)} <small>${esc(d.status)}</small>`)).join('')}</div>
   <div class="facet-card"><h4>Architecture lineage</h4><p>LIAM v16–v20 → WitForge v1.0–v1.54 → IcyT master spec → this build (v1.59). Historical defects are lessons, not features.</p></div>
   <div class="facet-card"><h4>Absolute rules</h4><p>§162 Security never bypassable · §163 Ledger authoritative · §164 Engine authoritative over assets · §165 Unavailable is reported as unavailable · §143 No universal security bypass.</p></div>`;
}
async function renderProfile() {
  const st = await api('/api/auth/status');
  $('#main').innerHTML = head('ACCOUNT', 'Profile', 'The first local account becomes Owner and is bound to the configured email using a one-way hash. Sessions use scrypt-backed credentials and HttpOnly cookies.') +
  (!st.owner ? `
   <div class="facet-card"><h4>First-run Owner creation</h4>
     <div class="input-line" style="margin-top:0"><input id="ownerName" placeholder="Owner name"><input id="ownerEmail" type="email" placeholder="Configured owner email"><input id="ownerPass" type="password" placeholder="Password (8+ chars)"><button class="mini-btn" id="ownerCreate">Create Owner</button></div>
     <p class="empty-note">Creation is accepted only from this local device and only when the email matches WITFORGE_OWNER_EMAIL. The address is stored only as a one-way hash.</p></div>`
  : !st.authed ? `
   <div class="facet-card"><h4>Owner login</h4>
     <div class="input-line" style="margin-top:0"><input id="loginEmail" type="email" placeholder="Owner email"><input id="loginPass" type="password" placeholder="Password"><button class="mini-btn" id="ownerLogin">Log in</button></div>
     <p class="empty-note">Sessions use HttpOnly SameSite cookies. Failures are throttled and audited.</p></div>`
  : `
   <div class="facet-card"><h4>Session</h4>${row('owner', 'Authenticated session active.')}${row('role', 'OWNER — highest application-level administrative role.')}<div class="input-line"><button class="mini-btn" id="ownerLogout">Log out</button></div></div>`) +
  `<div class="facet-card"><h4>Plain-language account control</h4><p>Use the Profile form so credentials never enter chat history. Chat also accepts “create owner account NAME email ADDRESS password PASS” and “login email ADDRESS password PASS”.</p></div>` +
  renderAccountsPanel();
  if ($('#ownerCreate')) $('#ownerCreate').onclick = async () => {
    const r = await post('/api/auth/owner', { name: $('#ownerName').value, email: $('#ownerEmail').value, password: $('#ownerPass').value });
    toast(r.ok ? 'Owner created: ' + r.owner : (r.error || 'failed'));
    renderProfile();
  };
  if ($('#ownerLogin')) $('#ownerLogin').onclick = async () => {
    const r = await post('/api/auth/login', { email: $('#loginEmail').value, password: $('#loginPass').value });
    toast(r.ok ? 'Logged in.' : (r.error || 'failed'));
    renderProfile();
  };
  if ($('#ownerLogout')) $('#ownerLogout').onclick = async () => { await post('/api/auth/logout', {}); renderProfile(); };
  if ($('#acctRecord')) $('#acctRecord').onclick = async () => { const v = $('#acctRec').value.split(':'); const r = await post('/api/accounts', { action: 'record', service: v[0], identifier: v[1] || 'primary' }); toast(r.ok ? 'Recorded ' + r.account.service + ':' + r.account.identifier + ' (RECORDED — connection needs real authorization)' : (r.error || 'failed')); renderProfile(); };
  if ($('#orgCreate')) $('#orgCreate').onclick = async () => { const r = await post('/api/organisations', { action: 'create', name: $('#orgName').value }); toast(r.ok ? 'Organisation created: ' + r.org.name : (r.error || 'failed')); renderProfile(); };
  $('#main').onclick = async e => {
    const sel = e.target.closest('[data-acctsel]'); if (sel) { const a = (S.accounts || []).find(x => x.id === sel.dataset.acctsel); const r = await post('/api/accounts', { action: 'select', service: a.service, id: a.id }); toast(r.ok ? 'Active account for ' + a.service + ': ' + a.identifier : (r.error || 'failed')); return; }
    const disc = e.target.closest('[data-acctdisc]'); if (disc) { const r = await post('/api/accounts', { action: 'disconnect', id: disc.dataset.acctdisc }); toast(r.ok ? 'Disconnected — ' + r.revokedGrants.length + ' grant(s) revoked' : (r.error || 'failed')); renderProfile(); }
  };
}
async function renderStatusExtra() {} // placeholder
/* ── Avatar Studio + Arena (Diablo & Skyrim lineage) ─────────────── */
let RACES = null, studioRace = null, studioSelAvatar = null;
let arenaChampion = null, arenaRival = null, arenaBusy = false;
async function loadRaces() { if (!RACES) { const j = await api('/api/races'); if (j.ok) RACES = j.races; } return RACES || []; }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = x => Math.max(0, Math.min(255, x + amt));
  return '#' + [c(n >> 16), c(n >> 8 & 255), c(n & 255)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function avatarSVG(r, size) {
  size = size || 120;
  const L = r.look || {}, skin = r.skin, dark = shade(skin, -34), lite = shade(skin, 22);
  const eye = L.blind ? '#666' : (L.eyes || '#20202a');
  let p = '';
  if (L.glow) p += `<circle cx="60" cy="82" r="50" fill="${L.glow}" opacity="0.12"/><circle cx="60" cy="82" r="34" fill="${L.glow}" opacity="0.10"/>`;
  if (L.wings) p += `<path d="M40 70 Q14 52 20 24 Q40 42 46 62 Z" fill="${dark}" opacity=".9"/><path d="M80 70 Q106 52 100 24 Q80 42 74 62 Z" fill="${dark}" opacity=".9"/>`;
  if (L.tail) p += `<path d="M62 116 Q92 122 88 146" stroke="${dark}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  p += `<rect x="46" y="104" width="11" height="40" rx="5" fill="${dark}"/><rect x="63" y="104" width="11" height="40" rx="5" fill="${dark}"/>`;
  p += `<rect x="30" y="66" width="9" height="38" rx="4.5" fill="${dark}" transform="rotate(8 34 66)"/><rect x="81" y="66" width="9" height="38" rx="4.5" fill="${dark}" transform="rotate(-8 86 66)"/>`;
  p += `<path d="M42 64 Q60 56 78 64 L74 106 Q60 113 46 106 Z" fill="${skin}"/>`;
  p += `<circle cx="60" cy="42" r="17" fill="${lite}"/>`;
  if (L.ears === 'point') p += `<path d="M43 40 L33 34 L44 30 Z" fill="${lite}"/><path d="M77 40 L87 34 L76 30 Z" fill="${lite}"/>`;
  if (L.ears === 'cat') p += `<path d="M46 30 L42 16 L54 26 Z" fill="${skin}"/><path d="M74 30 L78 16 L66 26 Z" fill="${skin}"/>`;
  if (L.ears === 'round') p += `<circle cx="44" cy="34" r="5" fill="${lite}"/><circle cx="76" cy="34" r="5" fill="${lite}"/>`;
  if (L.ears === 'frill') p += `<path d="M44 34 Q32 30 36 44 Q42 44 45 40 Z" fill="${dark}"/><path d="M76 34 Q88 30 84 44 Q78 44 75 40 Z" fill="${dark}"/>`;
  if (L.horns === 'short') p += `<path d="M48 28 L45 18 L52 24 Z" fill="${dark}"/><path d="M72 28 L75 18 L68 24 Z" fill="${dark}"/>`;
  if (L.horns === 'ram') p += `<path d="M46 32 Q34 30 36 44 Q40 50 46 46" stroke="${dark}" stroke-width="5" fill="none"/><path d="M74 32 Q86 30 84 44 Q80 50 74 46" stroke="${dark}" stroke-width="5" fill="none"/>`;
  if (L.horns === 'goat') p += `<path d="M48 28 Q40 20 42 12" stroke="${dark}" stroke-width="5" fill="none"/><path d="M72 28 Q80 20 78 12" stroke="${dark}" stroke-width="5" fill="none"/>`;
  if (L.horns === 'antler') p += `<path d="M48 28 L44 14 M46 20 L40 16 M72 28 L76 14 M74 20 L80 16" stroke="${dark}" stroke-width="4" fill="none"/>`;
  if (L.horns === 'dragon') p += `<path d="M46 30 L40 16 L50 24 L54 12 L60 22 L66 12 L70 24 L80 16 L74 30 Z" fill="${dark}"/>`;
  if (L.horns === 'tiger') p += `<circle cx="46" cy="27" r="5" fill="${skin}"/><circle cx="74" cy="27" r="5" fill="${skin}"/><path d="M52 34 h16" stroke="${dark}" stroke-width="2"/>`;
  if (L.horns === 'crab') p += `<path d="M46 30 Q36 24 40 14 Q48 18 50 26 Z" fill="${dark}"/><path d="M74 30 Q84 24 80 14 Q72 18 70 26 Z" fill="${dark}"/>`;
  if (L.tusks) p += `<path d="M52 52 L50 58 L55 54 Z" fill="#f5f2e8"/><path d="M68 52 L70 58 L65 54 Z" fill="#f5f2e8"/>`;
  if (L.fangs) p += `<path d="M54 52 L53 56 L56 53 Z" fill="#fff"/><path d="M66 52 L67 56 L64 53 Z" fill="#fff"/>`;
  if (L.beard) p += `<path d="M50 52 Q60 64 70 52 L70 58 Q60 68 50 58 Z" fill="${dark}"/>`;
  p += `<circle cx="53" cy="40" r="2.4" fill="${eye}"/><circle cx="67" cy="40" r="2.4" fill="${eye}"/>`;
  return `<svg class="avatar-svg" width="${size}" height="${size * 1.33}" viewBox="0 0 120 160" aria-label="${esc(r.name)}">${p}</svg>`;
}
function statBar(label, v) {
  return `<div class="statbar"><span>${label}</span><div class="bar"><i style="width:${Math.min(100, v / 15 * 100)}%"></i></div><b>${v}</b></div>`;
}
/* ── v1.63: Automations (scheduler runtime), Notifications, Inventory ── */
function renderAutomations() {
  const rems = (S.reminders || []).filter(r => !r.done).sort((a, b) => a.dueTs - b.dueTs);
  const schs = (S.schedules || []).filter(r => !r.done);
  const span = r => r.everyMs >= 86400000 ? Math.round(r.everyMs / 86400000) + ' d' : r.everyMs >= 3600000 ? Math.round(r.everyMs / 3600000) + ' h' : r.everyMs >= 60000 ? Math.round(r.everyMs / 60000) + ' min' : Math.round(r.everyMs / 1000) + ' s';
  $('#main').innerHTML = head('SCHEDULER RUNTIME', 'Automations', 'Server-ticked reminders and recurring schedules — fires every 15s even with the chat closed. All events are real and audited.',
    `<span class="pill operational">RUNTIME LIVE</span>`) +
  `<div class="stat-grid">
    <div class="stat-card"><p class="stat-label">Recurring schedules</p><p class="stat-value">${schs.length}</p></div>
    <div class="stat-card"><p class="stat-label">Pending reminders</p><p class="stat-value">${rems.length}</p></div>
    <div class="stat-card"><p class="stat-label">Total fires</p><p class="stat-value">${(S.schedules || []).reduce((a, r) => a + r.fired, 0) + (S.reminders || []).filter(r => r.done).length}</p></div>
  </div>
  <div class="facet-card"><h4>Arm in plain language</h4>
    <div class="input-line"><input id="autoIn" placeholder="remind me in 20 minutes stretch  ·  every 2 hours stand up"><button class="mini-btn" id="autoAdd">Arm</button></div>
    <p class="empty-note">Same sentence works in Chat — the scheduler is a real server runtime, not a simulation.</p></div>
  <div class="facet-card"><h4>Active schedules (${schs.length})</h4>
    ${schs.length ? schs.map(r => `<div class="row-item"><span class="t">${esc(r.id)}</span><span class="d" title="next ${new Date(r.nextTs).toLocaleString()}">${esc(r.text)} <small class="muted">— every ${span(r)} · fired ${r.fired}× · next ${new Date(r.nextTs).toLocaleTimeString()}</small></span><button class="mini-btn danger" data-stop-sch="${r.id}">stop</button></div>`).join('') : '<p class="empty-note">No recurring schedules.</p>'}
  </div>
  <div class="facet-card"><h4>Pending reminders (${rems.length})</h4>
    ${rems.length ? rems.map(r => `<div class="row-item"><span class="t">${esc(r.id)}</span><span class="d">${esc(r.text)} <small class="muted">— ${new Date(r.dueTs).toLocaleString()}</small></span></div>`).join('') : '<p class="empty-note">No pending reminders.</p>'}
    ${rems.length ? '<div class="input-line"><button class="mini-btn danger" id="autoClearRem">Clear all reminders</button></div>' : ''}
  </div>`;
  $('#autoAdd').onclick = async () => {
    const t = $('#autoIn').value.trim(); if (!t) return;
    const j = await post('/api/command', { text: t });
    toast((j.reply || j.error || '').split('\n')[0].slice(0, 100));
    await refreshState(); renderAutomations();
  };
  $('#main').onclick = async e => {
    const sb = e.target.closest('[data-stop-sch]');
    if (sb) { await post('/api/command', { text: 'stop schedule ' + sb.dataset.stopSch }); toast('Schedule ' + sb.dataset.stopSch + ' stopped'); await refreshState(); renderAutomations(); return; }
    if (e.target.closest('#autoClearRem')) { await post('/api/command', { text: 'clear reminders' }); await refreshState(); renderAutomations(); }
  };
}
function renderNotifications() {
  const items = S.notifications || [];
  $('#main').innerHTML = head('EVENT FEED', 'Notifications', 'Real events from reminders, schedules and system ticks — newest first.',
    `<span class="pill ${items.length ? 'config' : 'operational'}">${items.length} EVENTS</span>`) +
  `<div class="facet-card"><h4>Feed</h4>
    ${items.length ? items.map(n => `<div class="row-item"><span class="t">${new Date(n.ts).toLocaleTimeString()}</span><span class="d"><b class="pill ${n.kind === 'schedule' ? 'simulation' : 'config'}" style="margin-right:8px">${esc(n.kind || 'event')}</b>${esc(n.text || '')}</span></div>`).join('') : '<p class="empty-note">Nothing yet — arm a reminder or schedule to see events here.</p>'}
  </div>
  <div class="truth-card"><b>TRUTH BOUNDARY</b><p>Notifications are generated by the local server scheduler only. No push service, SMS or email is connected — external delivery would be labelled CONFIGURATION REQUIRED.</p></div>`;
}
async function renderInventory() {
  const av = (S.avatars || [])[0];
  if (!av) {
    $('#main').innerHTML = head('LOOT VAULT', 'Inventory', 'Arena loot with provenance.') +
      `<div class="facet-card"><p class="empty-note">No avatar yet — forge one in Avatar Studio first.</p></div>`;
    return;
  }
  const items = av.inventory || [];
  $('#main').innerHTML = head('LOOT VAULT', 'Inventory', `${esc(av.name)} — every item has forged/battle provenance. Sell straight to the marketplace from here.`,
    `<button class="mini-btn" data-open-avatar>OPEN STUDIO</button>`) +
  `<div class="stat-grid"><div class="stat-card"><p class="stat-label">Items owned</p><p class="stat-value">${items.length}</p></div>
  <div class="stat-card"><p class="stat-label">Top rarity</p><p class="stat-value">${items.reduce((m, i) => Math.max(m, i.rlevel || 0), 0)} R</p></div>
  <div class="stat-card"><p class="stat-label">Wallet (Owner)</p><p class="stat-value">${S.ledger && S.ledger.accounts ? S.ledger.accounts['Owner'] : 0} LD</p></div></div>
  <div class="facet-card"><h4>Sell to marketplace</h4>
    ${items.length ? items.map(i => `<div class="row-item"><span class="t" style="color:${i.color}">${pieceThumb(i)}R${i.rlevel}</span><span class="d" style="color:${i.color}">${esc(i.name)} <small>(${i.slot} · ${i.rarity} · pwr ${i.power})</small></span><input class="inv-price" data-price-for="${i.id}" placeholder="LD" style="width:64px;background:rgba(6,3,10,.85);border:1px solid var(--line-hi);border-radius:8px;padding:6px 8px;color:var(--text);font-size:12px" value="100"><button class="mini-btn" data-sell="${i.id}">Sell</button></div>`).join('') : '<p class="empty-note">Empty — win battles or forge a piece.</p>'}
  </div>
  <div class="truth-card"><b>TRUTH BOUNDARY</b><p>Sales settle inside the labelled simulation ledger (100 LD = A$1.00 reference) until real payment rails pass the compliance gates.</p></div>`;
  $('#main').onclick = async e => {
    if (e.target.closest('[data-open-avatar]')) { setView('avatar'); return; }
    const b = e.target.closest('[data-sell]');
    if (b) {
      const price = (document.querySelector(`[data-price-for="${b.dataset.sell}"]`) || {}).value || '100';
      const j = await post('/api/command', { text: `sell ${b.dataset.sell} for ${price}` });
      toast((j.reply || j.error || '').slice(0, 100));
      await refreshState(); renderInventory();
    }
  };
}

async function renderAvatarStudio() {
  const [races, avs] = await Promise.all([loadRaces(), api('/api/avatars')]);
  const avatars = avs.ok ? avs.avatars : [];
  const hd = head('CHARACTER FORGE', 'Avatar Studio', '100 races from the Diablo & Skyrim lineage. Every avatar begins naked — only racial gifts.');
  if (!avatars.length) { $('#main').innerHTML = hd + wizardHTML(races); wireWizard(races); return; }
  const sel = avatars.find(a => a.id === studioSelAvatar) || avatars[0];
  studioSelAvatar = sel.id;
  const race = races.find(r => r.id === sel.raceId) || races[0];
  const groups = [
    ['Combat', ['weapon', 'shield']],
    ['Head & body', ['head', 'face', 'hair', 'eyes', 'ears', 'torso', 'belt', 'shoulder_l', 'shoulder_r']],
    ['Arms (L/R)', ['arm_upper_l', 'arm_upper_r', 'arm_lower_l', 'arm_lower_r', 'hand_l', 'hand_r']],
    ['Legs (L/R)', ['leg_upper_l', 'leg_upper_r', 'leg_lower_l', 'leg_lower_r', 'foot_l', 'foot_r']],
    ['Jewellery', ['neck', 'necklace', 'ring_l', 'ring_r', 'earring_l', 'earring_r']],
    ['Piercings', ['piercing_brow', 'piercing_nose', 'piercing_lip']],
    ['Tattoos', ['tattoo_head', 'tattoo_torso', 'tattoo_arm_l', 'tattoo_arm_r', 'tattoo_leg_l', 'tattoo_leg_r']],
    ['Extras', ['wings', 'back', 'aura', 'cloak']]
  ];
  const slotCell = sl => { const it = sel.equipment[sl]; return `<div class="kv"><span>${sl}</span><b>${it ? `${pieceThumb(it, 30)}<span style="color:${it.color}">${esc(it.name)}</span> <button class="mini-btn" data-unequip="${sl}">remove</button>` : '— empty —'}</b></div>`; };
  const equipRows = groups.map(g => `<h4 style="margin:10px 0 4px;color:var(--muted2);font-size:10px;letter-spacing:.12em">${g[0]}</h4>` + g[1].map(slotCell).join('')).join('');
  const invRows = sel.inventory.length ? sel.inventory.map(i =>
    `<div class="row-item"><span class="t" style="color:${i.color}">${pieceThumb(i)}R${i.rlevel}</span><span class="d" style="color:${i.color}">${esc(i.name)} <small>(${i.slot}, ${i.rarity}, pwr ${i.power}${i.element ? ', ' + i.element : ''})</small></span><button class="mini-btn" data-equip="${i.id}">Equip</button></div>`).join('')
    : `<p class="empty-note">No items. Victory in the Arena drops loot on a 1–100 rarity scale.</p>`;
  const petRows = (sel.pets || []).length ? sel.pets.map(pt =>
    `<div class="row-item"><span class="t" style="color:${pt.color}">${pieceThumb(pt)}R${pt.rlevel}</span><span class="d" style="color:${pt.color}">${esc(pt.name)} the ${esc(pt.species)} <small>${pt.rarity}</small></span></div>`).join('')
    : '<p class="empty-note">No companions yet.</p>';
  $('#main').innerHTML = hd + `
    <div class="chip-row">${avatars.map(a => `<button class="chip ${a.id === sel.id ? 'on' : ''}" data-pick="${a.id}">${esc(a.name)}</button>`).join('')}<button class="chip" data-pick="__new">＋ New avatar</button></div>
    <div class="avatar-grid">
      <div class="card avatar-hero">${avatarSVG(race, 170)}<h3>${esc(sel.name)}</h3><p class="muted">${esc(sel.race)} · Level ${sel.level}</p>
        <p class="muted small">W ${sel.record.wins} · L ${sel.record.losses} · D ${sel.record.draws} · XP ${sel.xp}/${sel.level * 100}</p>
        <p class="pill ${sel.loadoutComplete ? 'operational' : 'config'}">${sel.loadoutComplete ? 'LOADOUT COMPLETE' : 'NAKED — UNEQUIPPED'}</p>
        <div class="input-line"><button class="mini-btn" data-view-arena="1">⚔ Enter the Arena</button></div></div>
      <div class="avatar-side">
        <div class="facet-card"><h4>Attributes (Diablo)</h4>${statBar('STR', sel.stats.str)}${statBar('DEX', sel.stats.dex)}${statBar('INT', sel.stats.int)}${statBar('VIT', sel.stats.vit)}
          <div class="kv" style="margin-top:8px"><span>Health / Magicka / Stamina</span><b>${sel.derived.maxHP} / ${sel.derived.maxMP} / ${sel.derived.maxStam}</b></div>
          <div class="kv"><span>Dodge / Crit</span><b>${sel.derived.dodge}% / ${sel.derived.crit}%</b></div>
          <div class="kv"><span>Unarmed / Destruction</span><b>${sel.skills.unarmed.level} / ${sel.skills.destruction.level}</b></div>
          <div class="kv"><span>Resists (fire/cold/shock/poison)</span><b>${race.r.join('/')}%</b></div>
          <div class="kv"><span>Racial gift</span><b>${esc(race.fl)}</b></div></div>
        <div class="facet-card"><h4>⚒ Talents (${(sel.talents||[]).length} unlocked · ${sel.talentPoints||0} point${(sel.talentPoints||0) === 1 ? '' : 's'})</h4>
          ${(S.talentTree || []).map(t => { const has = (sel.talents||[]).includes(t.id); const gated = (sel.talents||[]).length < t.tier - 1; const nop = !(sel.talentPoints > 0);
            return `<div class="row-item"><span class="t">T${t.tier}</span><span class="d">${esc(t.name)} <small class="muted">${esc(t.desc)}</small></span>${has ? '<span class="pill operational">OWNED</span>' : gated || nop ? `<span class="pill config">${gated ? 'TIER-GATED' : 'NO POINTS'}</span>` : `<button class="mini-btn" data-unlock-talent="${t.id}">Unlock</button>`}</div>`; }).join('')}
          <p class="empty-note">1 point per level — win battles in the Arena. Chat: “unlock talent body for ${esc(sel.name.toLowerCase())}”.</p></div>
        <div class="facet-card"><h4>Equipment slots</h4>${equipRows}</div>
        <div class="facet-card"><h4>Inventory (${sel.inventory.length})</h4>${invRows}
          <div class="input-line"><button class="mini-btn" data-merge-items="1">⚒ Auto-merge best triple</button><button class="mini-btn" data-toggle-aiart="1" title="Optional Puter-painted portraits — external call, ONLY when you turn it on. Procedural sigils stay the default and the fallback.">🎨 AI art: ${AIArt.enabled() ? 'ON (Puter, external)' : 'off — sigils only'}</button></div></div>
        <div class="facet-card"><h4>Companions (${(sel.pets || []).length})</h4>${petRows}
          <div class="input-line"><button class="mini-btn" data-gen-pet="1">Generate pet</button><button class="mini-btn" data-merge-pets="1">⚒ Auto-merge pets</button></div></div>
        <div class="facet-card"><h4>⚒ Forge a unique piece (costs LD)</h4>
          <p class="empty-note">Describe it imaginatively — your prompt + identity makes every piece unique. Or say in Chat: “forge wings at legendary: …”.</p>
          <div class="input-line"><select id="forgeSlot" class="chip">${SLOT_GROUPS_FLAT.map(x => `<option>${x}</option>`).join('')}</select>
          <select id="forgeBand" class="chip">${['Common', 'Magic', 'Rare', 'Legendary', 'Set', 'Mythic'].map(b => `<option>${b}</option>`).join('')}</select></div>
          <div class="input-line"><input id="forgePrompt" placeholder="e.g. wings of storm-glass folded from a dying aurora"><button class="mini-btn" data-forge="1">Forge (LD)</button></div>
          <p class="empty-note" id="forgeCostNote"></p></div>
        <div class="facet-card"><h4>Truth</h4><p>Assets are application-managed digital records — not on-chain NFTs. Battles resolve only on the server.</p></div>
      </div></div>`;
  $('#forgeCostNote').textContent = 'Costs: ' + Object.entries(FORGE_COST_UI).map(([k, v]) => k + ' ' + v + ' LD').join(' · ');
  $('#main').onclick = async e => {
    const pk = e.target.closest('[data-pick]');
    if (pk) { if (pk.dataset.pick === '__new') { $('#main').innerHTML = hd + wizardHTML(races); wireWizard(races); } else { studioSelAvatar = pk.dataset.pick; renderAvatarStudio(); } return; }
    const eq = e.target.closest('[data-equip]');
    if (eq) { const j = await post(`/api/avatars/${sel.id}/equip`, { itemId: eq.dataset.equip }); if (j.ok) renderAvatarStudio(); return; }
    const un = e.target.closest('[data-unequip]');
    if (un) { await post(`/api/avatars/${sel.id}/unequip`, { slot: un.dataset.unequip }); renderAvatarStudio(); return; }
    if (e.target.closest('[data-view-arena]')) { setView('arena'); return; }
    const tl = e.target.closest('[data-unlock-talent]');
    if (tl) { const j = await post('/api/command', { text: 'unlock talent ' + tl.dataset.unlockTalent + ' for ' + sel.name.toLowerCase() }); toast((j.reply || j.error || '').slice(0, 100)); await refreshState(); renderAvatarStudio(); return; }
    const fb = e.target.closest('[data-forge]');
    if (fb) {
      const r = await post('/api/forge', { avatarId: sel.id, slot: $('#forgeSlot').value, band: $('#forgeBand').value, prompt: $('#forgePrompt').value });
      toast(r.ok ? 'Forged ' + r.item.name + ' (R' + r.item.rlevel + ' ' + r.item.rarity + ') for ' + r.cost + ' LD' : (r.error || 'forge failed'));
      if (r.ok) renderAvatarStudio();
      return;
    }
    if (e.target.closest('[data-gen-pet]')) { const r = await post(`/api/avatars/${sel.id}/pets`, {}); toast(r.ok ? 'Companion: ' + r.pet.name + ' the ' + r.pet.species + ' (R' + r.pet.rlevel + ')' : (r.error || 'failed')); renderAvatarStudio(); return; }
    if (e.target.closest('[data-toggle-aiart]')) { AIArt.set(!AIArt.enabled()); renderAvatarStudio(); return; }
    if (e.target.closest('[data-merge-items]')) {
      const triple = findTriple(sel.inventory, i => i.slot + '|' + i.rarity);
      if (!triple) { toast('Need 3 same-slot, same-band pieces to merge.'); return; }
      const r = await post(`/api/avatars/${sel.id}/merge`, { ids: triple });
      toast(r.ok ? 'Merged into ' + r.merged.name + ' (R' + r.merged.rlevel + ' ' + r.merged.rarity + ')' : (r.error || 'merge failed'));
      renderAvatarStudio(); return;
    }
    if (e.target.closest('[data-merge-pets]')) {
      const triple = findTriple(sel.pets || [], p => p.rarity);
      if (!triple) { toast('Need 3 same-band pets to merge.'); return; }
      const r = await post(`/api/avatars/${sel.id}/pets/merge`, { ids: triple });
      toast(r.ok ? 'Pet merged: ' + r.merged.name + ' (R' + r.merged.rlevel + ')' : (r.error || 'merge failed'));
      renderAvatarStudio(); return;
    }
  };
}
const SLOT_GROUPS_FLAT = ['weapon', 'shield', 'head', 'face', 'hair', 'eyes', 'ears', 'torso', 'belt', 'shoulder_l', 'shoulder_r', 'arm_upper_l', 'arm_upper_r', 'arm_lower_l', 'arm_lower_r', 'hand_l', 'hand_r', 'leg_upper_l', 'leg_upper_r', 'leg_lower_l', 'leg_lower_r', 'foot_l', 'foot_r', 'neck', 'necklace', 'ring_l', 'ring_r', 'earring_l', 'earring_r', 'piercing_brow', 'piercing_nose', 'piercing_lip', 'tattoo_head', 'tattoo_torso', 'tattoo_arm_l', 'tattoo_arm_r', 'tattoo_leg_l', 'tattoo_leg_r', 'wings', 'back', 'aura', 'cloak'];
const FORGE_COST_UI = { Common: 25, Magic: 60, Rare: 150, Legendary: 400, Set: 900, Mythic: 2000 };
function findTriple(list, keyFn) {
  const g = {};
  for (const x of list) { const k = keyFn(x); (g[k] = g[k] || []).push(x.id); }
  for (const k in g) if (g[k].length >= 3) return g[k].slice(0, 3);
  return null;
}
function wizardHTML(races) {
  return `<div class="wizard card"><div class="wizard-left">
    <div class="facet-card"><h4>Name your avatar</h4><div class="input-line" style="margin-top:0"><input id="avatarName" placeholder="e.g. Talvash" maxlength="24"></div></div>
    <div class="facet-card"><h4>Choose a race — ${races.length}</h4>
      <div class="input-line" style="margin-top:0"><input id="raceSearch" placeholder="Search races…"></div>
      <div class="chip-row" id="originChips">${['All', 'Skyrim', 'TES Lore', 'Diablo', 'Diablo IV'].map((o, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-origin="${o}">${o}</button>`).join('')}</div>
      <div class="race-grid" id="raceGrid"></div></div></div>
    <div class="wizard-right facet-card" id="racePreview"><h4>Preview</h4><p class="empty-note">Select a race to preview your naked base avatar.</p></div></div>`;
}
function wireWizard(races) {
  let origin = 'All', query = '';
  const paint = () => {
    const list = races.filter(r => (origin === 'All' || r.origin === origin) && (!query || r.name.toLowerCase().includes(query)));
    $('#raceGrid').innerHTML = list.map(r => `<button class="race-card ${studioRace === r.id ? 'on' : ''}" data-race="${r.id}" title="${esc(r.fl)}">${avatarSVG(r, 44)}<span>${esc(r.name)}</span><small>${esc(r.origin)}</small></button>`).join('') || '<p class="empty-note">No races match.</p>';
  };
  paint();
  $('#raceSearch').oninput = e => { query = e.target.value.toLowerCase(); paint(); };
  $('#originChips').onclick = e => { const c = e.target.closest('[data-origin]'); if (!c) return; origin = c.dataset.origin; [...$('#originChips').children].forEach(x => x.classList.toggle('on', x === c)); paint(); };
  $('#raceGrid').onclick = e => {
    const b = e.target.closest('[data-race]'); if (!b) return;
    studioRace = b.dataset.race;
    [...$('#raceGrid').children].forEach(x => x.classList.toggle('on', x.dataset.race === studioRace));
    const r = races.find(x => x.id === studioRace);
    $('#racePreview').innerHTML = `<h4>Preview</h4>${avatarSVG(r, 150)}<h3 style="margin:8px 0 2px">${esc(r.name)}</h3><p class="muted small">${esc(r.origin)} · ${esc(r.family)}</p>
      <div style="margin-top:10px">${statBar('STR', r.s[0])}${statBar('DEX', r.s[1])}${statBar('INT', r.s[2])}${statBar('VIT', r.s[3])}</div>
      <div class="kv"><span>Resists (fire/cold/shock/poison)</span><b>${r.r.join('/')}%</b></div>
      <p class="muted small" style="margin-top:8px">${esc(r.fl)}</p>
      <div class="input-line"><button class="mini-btn" id="createAvatarBtn">Forge avatar (naked start)</button></div>`;
    $('#createAvatarBtn').onclick = async () => {
      const name = ($('#avatarName') || {}).value || '';
      const j = await post('/api/avatars', { name, raceId: studioRace });
      if (j.ok) { studioSelAvatar = j.avatar.id; toast(j.avatar.name + ' enters the world with nothing but ' + j.avatar.race + ' blood.'); renderAvatarStudio(); }
      else toast(j.error || 'Creation failed');
    };
  };
}
async function renderArena() {
  const [races, avs] = await Promise.all([loadRaces(), api('/api/avatars')]);
  const avatars = avs.ok ? avs.avatars : [];
  const hd = head('PVP BRAWL PIT', 'Arena', 'Server-authoritative combat: Diablo stats, crits & loot; Skyrim resources, use-based skills & racial resists.');
  if (!avatars.length) {
    $('#main').innerHTML = hd + `<div class="facet-card"><h4>No champion</h4><p class="empty-note">Forge an avatar first — every champion starts naked.</p><div class="input-line"><button class="mini-btn" id="goStudio">Open Avatar Studio</button></div></div>`;
    $('#goStudio').onclick = () => setView('avatar');
    return;
  }
  arenaChampion = avatars.find(a => a.id === arenaChampion) || avatars[0];
  const champ = arenaChampion;
  const champRace = races.find(r => r.id === champ.raceId);
  const hist = await api('/api/arena/history');
  const histRows = (hist.ok && hist.battles.length) ? hist.battles.slice(0, 12).map(b =>
    `<div class="row-item"><span class="t">${fmtTime(b.ts)}</span><span class="d">${esc(b.aName)} vs ${esc(b.bName)} → ${b.draw ? 'DRAW' : esc(b.winnerId === b.aId ? b.aName : b.bName)} (${b.rounds}r)</span></div>`).join('')
    : '<p class="empty-note">No battles yet. The pit is quiet.</p>';
  $('#main').innerHTML = hd + `
    <div class="chip-row">${avatars.map(a => `<button class="chip ${a.id === champ.id ? 'on' : ''}" data-champ="${a.id}">${esc(a.name)}</button>`).join('')}</div>
    <div class="arena-grid">
      <div class="card fighter-card">${avatarSVG(champRace, 120)}<h3>${esc(champ.name)}</h3><p class="muted small">${esc(champ.race)} · Lv ${champ.level} · ${champ.derived.maxHP} HP</p><span class="pill operational">YOUR CHAMPION</span></div>
      <div class="arena-mid"><button class="new-chat-side" id="summonRival">☠ Summon rival</button><button class="new-chat-side fight-btn" id="fightBtn" disabled>⚔ Begin battle</button>
      <p class="muted small">Wagering: COMPLIANCE-LOCKED. Practice brawls are free; the ledger wager simulator lives in LD Coins.</p></div>
      <div class="card fighter-card" id="rivalCard"><p class="empty-note">No opponent summoned.</p></div></div>
    <div class="card battle-card"><div class="cardhead"><b>Battle log</b><span class="subhead" id="battleStatus">AWAITING COMBATANTS</span></div><div class="battle-log" id="battleLog"><p class="empty-note">Server-resolved rounds appear here.</p></div></div>
    <div class="facet-card"><h4>Recent battles</h4>${histRows}</div>`;
  $('#main').onclick = async e => {
    const ch = e.target.closest('[data-champ]');
    if (ch) { arenaChampion = ch.dataset.champ; renderArena(); return; }
    if (e.target.closest('#summonRival')) {
      const j = await api('/api/arena/opponent?for=' + encodeURIComponent(champ.id));
      if (!j.ok) return;
      arenaRival = j.rival;
      const rr = races.find(r => r.id === arenaRival.raceId);
      $('#rivalCard').innerHTML = `${avatarSVG(rr, 120)}<h3>${esc(arenaRival.name)}</h3><p class="muted small">${esc(arenaRival.race)} · Lv ${arenaRival.level} · ${arenaRival.derived.maxHP} HP</p><span class="pill disconnected">RIVAL — NAKED</span>`;
      $('#fightBtn').disabled = false;
      $('#battleStatus').textContent = 'COMBATANTS READY';
      return;
    }
    if (e.target.closest('#fightBtn') && arenaRival && !arenaBusy) runBattle(champ.id, arenaRival);
  };
}
async function runBattle(champId, rival) {
  arenaBusy = true;
  $('#fightBtn').disabled = true; $('#summonRival').disabled = true;
  $('#battleStatus').textContent = 'RESOLVING ON SERVER…';
  $('#battleLog').innerHTML = '';
  const j = await post('/api/arena/battle', { aId: champId, bId: rival.id });
  if (!j.ok) { $('#battleStatus').textContent = 'ERROR'; toast(j.error || 'Battle failed'); arenaBusy = false; return; }
  const logEl = $('#battleLog');
  for (const line of j.battle.log) {
    logEl.insertAdjacentHTML('beforeend', `<div class="log-line ${line.crit ? 'crit' : ''}"><span class="t">R${line.r}</span><span class="d">${esc(line.text)}</span></div>`);
    logEl.scrollTop = logEl.scrollHeight;
    await sleep(90);
  }
  const win = j.battle.winnerId;
  logEl.insertAdjacentHTML('beforeend', `<div class="log-line result">${win ? `☠ ${esc(win === champId ? j.avatars[0].name : j.avatars[1].name)} WINS` : '⚑ DRAW — no settlement'}</div>`);
  const rw = j.rewards && j.rewards[champId];
  if (rw) {
    let txt = `Rewards: +${rw.xp} XP` + (rw.levelUps ? `, ${rw.levelUps} level-up(s)` : '');
    if (rw.loot) txt += ` · Loot: <span style="color:${rw.loot.color}">${esc(rw.loot.name)}</span> (${rw.loot.rarity}, ${rw.loot.slot})`;
    logEl.insertAdjacentHTML('beforeend', `<div class="log-line reward">${txt}</div>`);
  }
  $('#battleStatus').textContent = win ? 'SETTLED' : 'DRAW';
  arenaRival = null; arenaBusy = false;
}

/* ── Palette ─────────────────────────────────────────────────────── */
const ACTIONS = [
  { id: 'act-new-chat', icon: '＋', label: 'New chat', hint: 'ACTION', run: async () => { const j = await post('/api/conversations', { title: 'New conversation' }); chatConvoId = j.conversation.id; setView('chat'); } },
  { id: 'act-collapse', icon: '☰', label: 'Toggle sidebar', hint: 'ACTION', run: toggleCollapse },
  { id: 'act-eco', icon: '✦', label: 'Economic self-test', hint: 'ECONOMY', run: async () => { const r = await api('/api/economy/selftest'); toast('Self-test: ' + r.result.checks.map(c => (c.pass ? '✓' : '✗')).join(' ')); } },
  { id: 'act-status', icon: '✓', label: 'Run local self-check', hint: 'SYSTEM', run: () => setView('status') }
];
let paletteSel = 0, paletteItems = [];
function paletteEntries(query) {
  const pages = MODULES.map(x => ({ id: 'page-' + x.id, icon: x.icon, label: x.label, hint: x.section, run: () => setView(x.id) }));
  const all = ACTIONS.concat(pages);
  const q = query.trim().toLowerCase();
  if (!q) return { list: all, recentCount: 0 };
  const scored = all.map(a => { const l = a.label.toLowerCase(); return { a, s: l.startsWith(q) ? 0 : l.includes(q) ? 1 : 2 }; }).filter(x => x.s < 2).sort((x, y) => x.s - y.s || x.a.label.localeCompare(y.a.label));
  return { list: scored.map(x => x.a), recentCount: 0 };
}
function openPalette() { $('#paletteOverlay').hidden = false; const i = $('#paletteInput'); i.value = ''; i.focus(); paintPalette(); }
function closePalette() { $('#paletteOverlay').hidden = true; }
function paintPalette() {
  const { list } = paletteEntries($('#paletteInput').value);
  paletteItems = list; paletteSel = 0;
  $('#paletteHint').textContent = list.length + ' results';
  $('#paletteList').innerHTML = list.map((a, i) => `<button class="palette-item ${i === 0 ? 'sel' : ''}" data-idx="${i}"><i class="navicon">${a.icon}</i><span>${esc(a.label)}</span><small>${esc(a.hint)}</small></button>`).join('') || '<div class="empty-note" style="padding:16px">No matches.</div>';
}
function runPalette(idx) { const a = paletteItems[idx]; if (!a) return; closePalette(); a.run(); }

/* ── Status strip ────────────────────────────────────────────────── */
function refreshStatus() {
  const el = $('#modeState');
  if (!navigator.onLine) { el.textContent = 'offline'; return; }
  el.textContent = window.__liamApi === 'linked' ? 'linked' : (window.__liamApi === 'failed' ? 'online' : 'checking…');
}
function probeHealth() {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = ctl ? setTimeout(() => ctl.abort(), 3000) : null;
  fetch('/api/health', ctl ? { signal: ctl.signal } : {}).then(r => r.json()).then(j => {
    clearTimeout(to); const ok = j && j.status === 'ok';
    window.__liamApi = ok ? 'linked' : 'failed';
    if (ok) { OFFLINE = false; const b = $('#offlineBanner'); if (b) b.remove(); } else enterOffline();
    refreshStatus();
  }).catch(() => { if (to) clearTimeout(to); window.__liamApi = 'failed'; enterOffline(); });
}
probeHealth(); setInterval(probeHealth, 8000);
ensureArtObserver();
window.addEventListener('online', refreshStatus);
window.addEventListener('offline', refreshStatus);

/* ── reminder/notification poller ───────────────────────── */
let lastNotifTs = Date.now();
async function pollNotifications() {
  if (OFFLINE) return;
  const j = await api('/api/notifications');
  if (!j.ok || !j.notifications) return;
  const newest = j.notifications.filter(n => n.ts > lastNotifTs);
  lastNotifTs = Math.max(lastNotifTs, ...j.notifications.map(n => n.ts), 0);
  if (newest.length === 0) return;
  newest.reverse().forEach(n => {
    toast('⏰ Reminder: ' + (n.text || '').slice(0, 80));
    const log = $('#chatLog');
    if (log) log.insertAdjacentHTML('beforeend', `<div class="msg notice"><div class="who">REMINDER</div><p>${esc(n.text || '')}</p></div>`);
  });
  if (S && $('#chatLog')) { const c = S.conversations.find(x => x.id === chatConvoId); if (c) $('#chatLog').scrollTop = $('#chatLog').scrollHeight; }
}
setInterval(pollNotifications, 10000);

/* ── Collapse / mobile ───────────────────────────────────────────── */
function toggleCollapse() {
  if (window.innerWidth <= 960) { document.body.classList.toggle('sidebar-open'); return; }
  const collapsed = !document.body.classList.contains('sidebar-collapsed');
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  try { localStorage.setItem('liam.ui', JSON.stringify({ collapsed })); } catch (e) {}
}

/* ── Global wiring ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  try { const ui = JSON.parse(localStorage.getItem('liam.ui') || '{}'); if (ui.collapsed && window.innerWidth > 960) document.body.classList.add('sidebar-collapsed'); } catch (e) {}
  $('#buildTag').textContent = 'LIAM v2.07.0 · 177-REQUIREMENT COVERAGE';
  await refreshState();
  renderNav();
  refreshStatus();
  await setView('conversations', { silent: true });

  $('#nav').addEventListener('click', e => { const b = e.target.closest('.nav'); if (b) setView(b.dataset.view); });
  $('#main').addEventListener('click', e => { const c = e.target.closest('.module-card[data-facet]'); if (c) openFacet(c.dataset.module, c.dataset.facet); });
  $('#collapseBtn').onclick = toggleCollapse;
  $('#mobileNavBtn').onclick = () => document.body.classList.toggle('sidebar-open');
  $('#newChatBtn').onclick = async () => { const j = await post('/api/conversations', { title: 'New conversation' }); chatConvoId = j.conversation.id; setView('chat'); };
  $('#searchBtn').onclick = openPalette;
  $('#avatarBtn').onclick = () => setView('profile');
  $('#facetClose').onclick = () => { $('#facetOverlay').hidden = true; };
  $('#facetOverlay').addEventListener('click', e => { if (e.target === $('#facetOverlay')) $('#facetOverlay').hidden = true; });
  $('#paletteOverlay').addEventListener('click', e => { if (e.target === $('#paletteOverlay')) closePalette(); });
  $('#paletteInput').addEventListener('input', paintPalette);
  $('#paletteList').addEventListener('click', e => { const b = e.target.closest('.palette-item'); if (b) runPalette(+b.dataset.idx); });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#paletteOverlay').hidden ? openPalette() : closePalette(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleCollapse(); }
    if (e.key === 'Escape') { closePalette(); $('#facetOverlay').hidden = true; document.body.classList.remove('sidebar-open'); }
    if (!$('#paletteOverlay').hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        paletteSel = (paletteSel + (e.key === 'ArrowDown' ? 1 : -1) + paletteItems.length) % Math.max(1, paletteItems.length);
        [...$('#paletteList').children].forEach((el, i) => el.classList.toggle('sel', i === paletteSel));
        const sel = $('#paletteList').children[paletteSel]; if (sel) sel.scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteSel); }
    }
  });
});
