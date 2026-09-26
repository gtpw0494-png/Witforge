/* Patch 6: app.js — surface the v1.64 specification systems truthfully. */
'use strict';
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'app.js');
let s = fs.readFileSync(f, 'utf8');
let n = 0;
function rep(old, neu, label) {
  if (!s.includes(old)) { console.error('MISS: ' + label); process.exitCode = 1; return; }
  s = s.replace(old, neu); n++;
  console.log('ok: ' + label);
}

/* ── 1. two new live workspaces: Devices and Evidence ──────────── */
rep(`  m('security', 'SECURITY', 'Security', '◉', 'operational', 'Local LIAM store', 'Emergency states, SSRF shield events, permission and approval posture.'),
  m('audit', 'SECURITY', 'Audit', '≡', 'operational', 'Local LIAM store', 'Trace of what was requested, granted, executed, verified or blocked.'),`,
`  m('device', 'CONTROL', 'Device (capability)', '◇', 'disconnected', 'Device bridge not connected', 'Capability page for the device-bridge module.'),
  m('devices', 'CONTROL', 'Devices', '◇', 'operational', 'Local device registry', 'Paired devices with trust states, per-device capabilities, replay-protected commands and checkpoints.'),
  m('security', 'SECURITY', 'Security', '◉', 'operational', 'Local LIAM store', 'Emergency states and stops, risk matrix, policy decisions, SSRF shield events, permission and approval posture.'),
  m('evidence', 'SECURITY', 'Evidence', '▤', 'operational', 'Local vault + monitors', 'Tamper-evident evidence vault, anti-fraud monitor, metrics, spans and correlation timelines.'),
  m('audit', 'SECURITY', 'Audit', '≡', 'operational', 'Local LIAM store', 'Structured records: actor, capability, decision, reason, risk, approval, result, correlation id.'),`, 'modules');

/* The old 'device' capability module is superseded by the live Devices view. */
rep(`  m('device', 'CONTROL', 'Device', '◇', 'disconnected', 'Device bridge not connected', 'Trusted device capabilities appear once a real bridge is paired.'),\n`, '', 'device dup');

rep(`const LIVE = new Set(['chat', 'conversations', 'tasks', 'projects', 'agents', 'memory', 'knowledge', 'files', 'tools', 'permissions', 'approvals', 'security', 'audit', 'ldcoins', 'status', 'settings', 'spec', 'documentation', 'profile', 'puter', 'avatar', 'arena', 'marketplace', 'automations', 'notifications', 'inventory']);`,
`const LIVE = new Set(['chat', 'conversations', 'tasks', 'projects', 'agents', 'memory', 'knowledge', 'files', 'tools', 'permissions', 'approvals', 'security', 'evidence', 'audit', 'devices', 'ldcoins', 'status', 'settings', 'spec', 'documentation', 'profile', 'puter', 'avatar', 'arena', 'marketplace', 'automations', 'notifications', 'inventory']);`, 'LIVE set');

rep(`  ({ chat: renderChat, conversations: renderConversations, tasks: renderTasks, projects: renderProjects, agents: renderAgents, memory: renderMemory, knowledge: renderKnowledge, files: renderFiles, tools: renderTools, permissions: renderPermissions, approvals: renderApprovals, security: renderSecurity, audit: renderAudit, ldcoins: renderLD, status: renderStatus, settings: renderSettings, puter: renderPuter, avatar: renderAvatarStudio, arena: renderArena, spec: renderSpec, documentation: renderDocs, profile: renderProfile, marketplace: renderMarket, automations: renderAutomations, notifications: renderNotifications, inventory: renderInventory })[id]();`,
`  ({ chat: renderChat, conversations: renderConversations, tasks: renderTasks, projects: renderProjects, agents: renderAgents, memory: renderMemory, knowledge: renderKnowledge, files: renderFiles, tools: renderTools, permissions: renderPermissions, approvals: renderApprovals, security: renderSecurity, evidence: renderEvidence, audit: renderAudit, devices: renderDevices, ldcoins: renderLD, status: renderStatus, settings: renderSettings, puter: renderPuter, avatar: renderAvatarStudio, arena: renderArena, spec: renderSpec, documentation: renderDocs, profile: renderProfile, marketplace: renderMarket, automations: renderAutomations, notifications: renderNotifications, inventory: renderInventory })[id]();`, 'render map');

/* ── 2. permissions view: §9 states + §10 levels + scopes ─────── */
rep(`function renderPermissions() {
  const caps = S.adapters.flatMap(a => a.caps.map(c => Object.assign({}, c, { adapter: a.id })));
  $('#main').innerHTML = head('AUTHORITY BOUNDARY', 'Permissions', 'Requesting a capability grants it (audited). Revocation is immediate. High-risk capabilities always require approval.') +
  \`<div class="facet-card"><h4>Capability grants</h4>\${caps.map(c => row(c.risk, \`\${esc(c.id)} — \${esc(c.desc)} <small>\${S.permissions[c.id] ? 'GRANTED via ' + S.permissions[c.id].grantedBy : 'not granted'}</small>\`, \`<button class="mini-btn" data-g="\${c.id}">Grant</button><button class="mini-btn danger" data-r="\${c.id}">Revoke</button>\`)).join('')}</div>\`;
  $('#main').onclick = async e => {
    const g = e.target.closest('[data-g]'); if (g) { await post('/api/permissions/grant', { cap: g.dataset.g }); setView('permissions', { silent: true }); return; }
    const r = e.target.closest('[data-r]'); if (r) { await post('/api/permissions/revoke', { cap: r.dataset.r }); setView('permissions', { silent: true }); }
  };
}`,
`function renderPermissions() {
  const table = S.capabilityTable || [];
  const k = S.kernel || {};
  const statePill = st => st === 'GRANTED' ? 'operational' : ['BLOCKED_BY_SECURITY', 'BLOCKED_BY_POLICY', 'DENIED', 'REVOKED'].includes(st) ? 'disconnected' : st === 'SUSPENDED' || st === 'EXPIRED' ? 'config' : 'simulation';
  $('#main').innerHTML = head('AUTHORITY BOUNDARY', 'Permissions', 'Nine permission states, five delegation levels and twelve scope dimensions. Requesting a capability grants it (audited); revocation is immediate; high risk always requires approval.') +
  \`<div class="facet-card"><h4>Permission states supported (§9)</h4><p class="empty-note">\${(k.permissionStates || []).join(' · ')}</p>
     <h4>Delegation levels (§10)</h4><p class="empty-note">\${(k.permissionLevels || []).join(' · ')} — WitForge and its agents cannot raise their own level.</p>
     <h4>Scope dimensions (§9)</h4><p class="empty-note">\${(k.scopeDimensions || []).join(' · ')}</p></div>
   <div class="facet-card"><h4>Capability register (\${table.length})</h4>\${table.map(c => row(c.risk, \`<b>\${esc(c.capability)}</b> — <span class="pill \${statePill(c.state)}">\${esc(c.state)}</span> <small>level \${esc(c.level || '—')} · risk \${esc(c.risk)}\${c.scopes && Object.keys(c.scopes).length ? ' · scope ' + esc(Object.keys(c.scopes).join(',')) : ''}\${c.expires ? ' · expires ' + fmtTime(c.expires) : ''}\${c.tokenId ? ' · token ' + esc(c.tokenId) : ''}</small>\`,
     \`<button class="mini-btn" data-g="\${c.capability}">Grant</button><button class="mini-btn" data-s="\${c.capability}">Suspend</button><button class="mini-btn" data-rs="\${c.capability}">Resume</button><button class="mini-btn danger" data-r="\${c.capability}">Revoke</button>\`)).join('')}</div>
   <div class="facet-card"><h4>Request a scoped grant</h4>
     <p class="empty-note">Scopes bind authority to a dimension — e.g. <code>scoped grant files.write purpose=project-x ttl=1h</code> in Chat. Every grant carries a signed, expiring capability token (§46).</p>
     <div class="input-line" style="margin-top:0"><input id="permCap" placeholder="capability (e.g. files.read)"><input id="permWhy" placeholder="purpose"><button class="mini-btn" id="permAsk">Request</button></div></div>\`;
  $('#permAsk').onclick = async () => { const r = await post('/api/permissions/grant', { cap: $('#permCap').value, purpose: $('#permWhy').value }); toast(r.ok ? 'Granted ' + $('#permCap').value : (r.error || 'failed')); setView('permissions', { silent: true }); };
  $('#main').onclick = async e => {
    const g = e.target.closest('[data-g]'); if (g) { await post('/api/permissions/grant', { cap: g.dataset.g }); setView('permissions', { silent: true }); return; }
    const s2 = e.target.closest('[data-s]'); if (s2) { await post('/api/command', { text: 'suspend ' + s2.dataset.s }); toast('Suspended ' + s2.dataset.s); setView('permissions', { silent: true }); return; }
    const rs = e.target.closest('[data-rs]'); if (rs) { await post('/api/command', { text: 'resume ' + rs.dataset.rs }); toast('Resumed ' + rs.dataset.rs); setView('permissions', { silent: true }); return; }
    const r = e.target.closest('[data-r]'); if (r) { await post('/api/permissions/revoke', { cap: r.dataset.r }); setView('permissions', { silent: true }); }
  };
}`, 'permissions view');

/* ── 3. security view: stops, risk matrix, policy decisions ────── */
rep(`   <div class="facet-card"><h4>Security / permission / approval events</h4>\${evts.length ? evts.map(e => row(fmtTime(e.ts), \`[\${esc(e.type)}] \${esc(e.detail)}\`)).join('') : '<p class="empty-note">No events yet.</p>'}</div>\`;`,
`   <div class="facet-card"><h4>Emergency stop scopes (§55)</h4>
     <div class="input-line" style="margin-top:0">\${(S.kernel && S.kernel.stopScopes || []).map(sc => \`<button class="mini-btn" data-stop="\${sc}">stop \${sc}</button>\`).join('')}</div>
     <div class="input-line"><button class="mini-btn danger" data-stopall="1">EMERGENCY STOP ALL</button><button class="mini-btn" data-stopclear="1">Clear all stops</button></div>
     \${(S.kernel && S.kernel.stops || []).length ? (S.kernel.stops).map(x => row(fmtTime(x.ts), 'STOPPED ' + esc(x.scope) + (x.target !== '*' ? ':' + esc(x.target) : '') + ' — ' + esc(x.reason))).join('') : '<p class="empty-note">No stops engaged. Emergency stop halts one scope without freezing audit or recovery.</p>'}</div>
   <div class="facet-card"><h4>Risk engine (§51/§52)</h4>
     <p class="empty-note">\${(S.kernel && S.kernel.riskClasses || []).join(' · ')} — PROHIBITED never executes; CRITICAL needs strong confirmation; HIGH needs approval or a scoped autonomous policy.</p>
     <div class="input-line" style="margin-top:0"><input id="riskTool" placeholder="tool id (e.g. fs.delete)"><button class="mini-btn" id="riskCheck">Assess risk</button><button class="mini-btn" id="policyCheck">Policy decision</button></div>
     <div id="riskOut" class="empty-note" style="margin-top:8px">Twelve risk factors score each action into a class before anything runs.</div></div>
   <div class="facet-card"><h4>Security / permission / approval events</h4>\${evts.length ? evts.map(e => row(fmtTime(e.ts), \`[\${esc(e.type)}] \${esc(e.detail)}\`)).join('') : '<p class="empty-note">No events yet.</p>'}</div>\`;`, 'security view');

rep(`    if (r.needsApproval) toast('Approval queued: ' + r.needsApproval + ' — approve it in Approvals or Chat.');
    else toast('Emergency state: ' + (r.state || r.error));
    setView('security', { silent: true });
  };
}`,
`    if (r.needsApproval) toast('Approval queued: ' + r.needsApproval + ' — approve it in Approvals or Chat.');
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
  $('#main').innerHTML = head('EVIDENCE & TELEMETRY', 'Evidence', 'Tamper-evident vault, anti-fraud monitor and OTLP-shaped observability. Secrets are referenced, never stored in the clear.', \`<span class="pill \${v.integrity && v.integrity.ok ? 'operational' : 'disconnected'}">\${v.integrity && v.integrity.ok ? 'VAULT VERIFIED' : 'VAULT CHECK'}</span>\`) +
  \`<div class="stat-grid">
     <div class="stat-card"><p class="stat-label">Vault records</p><p class="stat-value">\${(v.integrity || {}).entries || 0}</p></div>
     <div class="stat-card"><p class="stat-label">Fraud events</p><p class="stat-value">\${(fr.report || {}).events || 0}</p></div>
     <div class="stat-card"><p class="stat-label">Metrics</p><p class="stat-value">\${(ob.observability || {}).metrics.length}</p></div>
     <div class="stat-card"><p class="stat-label">Spans</p><p class="stat-value">\${(ob.observability || {}).spans.length}</p></div>
   </div>
   <div class="facet-card"><h4>Evidence vault (§118)</h4>\${vault.length ? vault.map(e => row(fmtTime(e.ts), \`\${esc(e.kind)} <small>\${esc(e.classification)} · \${esc(e.hash).slice(0, 16)}… \${e.resources.length ? '· resources ' + esc(e.resources.join(', ')) : ''}</small>\`)).join('') : '<p class="empty-note">No evidence recorded yet — execute something and the tool result, verification and hash land here.</p>'}</div>
   <div class="facet-card"><h4>Anti-fraud signals (§112)</h4>\${(fr.signals || []).map(x => row(x.severity, esc(x.id) + ' — ' + esc(x.note))).join('')}
     <p class="empty-note">Duplicate detection, transaction monitoring, rate limits, anomaly detection and account separation run on every ledger post and asset mint.</p></div>
   <div class="facet-card"><h4>Observability (§119)</h4>
     <p class="empty-note">\${esc((ob.observability || {}).note || '')}</p>
     <div class="input-line" style="margin-top:0"><input id="evTrace" placeholder="correlation id"><button class="mini-btn" id="evTraceBtn">Open timeline</button></div>
     <div id="evTraceOut" class="empty-note" style="margin-top:8px">Correlation ids join spans, audit events and tool evidence.</div></div>\`;
  $('#evTraceBtn').onclick = async () => { const r = await post('/api/command', { text: 'trace ' + $('#evTrace').value }); $('#evTraceOut').innerHTML = esc(r.reply || r.error || ''); };
}
/* §40/§41/§104 devices */
function renderDevices() {
  const list = S.devices || [];
  const trustPill = t => t === 'TRUSTED' ? 'operational' : t === 'PENDING' ? 'config' : 'disconnected';
  $('#main').innerHTML = head('DEVICE ECOSYSTEM', 'Devices', 'Pairing establishes identity only — capabilities are granted per capability and every command is replay-protected.', '<span class="pill operational">' + list.length + ' PAIRED</span>') +
  \`<div class="facet-card"><h4>Pair a device (§40)</h4>
     <div class="input-line" style="margin-top:0"><input id="devName" placeholder="device name"><select id="devPlatform" class="chip"><option>android</option><option>ios</option><option>ipados</option><option>macos</option><option>windows</option><option>linux</option><option>chromeos</option><option>web</option><option>server</option><option>wearable</option><option>smart-device</option></select><button class="mini-btn" id="devPair">Pair</button></div>
     <p class="empty-note">Trust states: \${(S.kernel && S.kernel.deviceTrust || ['UNKNOWN', 'PENDING', 'TRUSTED', 'RESTRICTED', 'REVOKED', 'LOCKED']).join(' · ')}. Companion bridges (ADB, Shizuku, Accessibility) remain UNAVAILABLE until a real one is connected.</p></div>
   <div class="facet-card"><h4>Paired devices (\${list.length})</h4>\${list.length ? list.map(d => row(d.platform, \`<b>\${esc(d.name)}</b> — <span class="pill \${trustPill(d.trust)}">\${esc(d.trust)}</span> <small>\${d.capabilities} cap(s) · \${d.sessions} session(s)\${d.revoked ? ' · revoked' : ''}</small>\`, \`<button class="mini-btn" data-trust="\${d.id}">Trust</button><button class="mini-btn" data-restrict="\${d.id}">Restrict</button><button class="mini-btn danger" data-revoke="\${d.id}">Revoke</button>\`)).join('') : '<p class="empty-note">No devices paired. Nothing is trusted by default.</p>'}</div>
   <div class="facet-card"><h4>Device-to-device commands (§41)</h4><p class="empty-note">Every command must carry: command ID · user ID · device ID · capability · action · scope · expiration · authorization · correlation ID. Replays, expired commands and untrusted devices are refused before execution.</p></div>\`;
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
}`, 'security extra + evidence + devices views');

/* ── 4. audit view: structured §96 columns ─────────────────────── */
rep(`    $('#auditBody').innerHTML = list.length ? list.map(e => row(fmtDate(e.ts), \`[\${esc(e.type)}] \${esc(e.detail)} <small>\${esc(e.actor)}</small>\`)).join('') : '<p class="empty-note">Empty.</p>';`,
`    $('#auditBody').innerHTML = list.length ? list.map(e => row(fmtDate(e.ts), \`[\${esc(e.type)}] \${esc(e.detail || e.action)}\` +
      \` <small>\${esc(e.actor)}\${e.capability ? ' · cap ' + esc(e.capability) : ''}\${e.decision ? ' · ' + esc(e.decision) : ''}\${e.risk ? ' · risk ' + esc(e.risk) : ''}\${e.result ? ' · ' + esc(e.result) : ''}\${e.approval ? ' · approval ' + esc(e.approval) : ''}\${e.cid ? ' · cid ' + esc(String(e.cid).slice(0, 8)) : ''}</small>\`)).join('') : '<p class="empty-note">Empty.</p>';`, 'audit rows');

/* ── 5. status view: release metadata, four-state self-test ────── */
rep(`  $('#stRun').onclick = async () => {
    const r = await api('/api/selftest');
    $('#stOut').innerHTML = r.ok ? r.result.checks.map(c => row(c.pass ? '✓' : '✗', esc(c.check))).join('') : 'selftest unavailable';
  };`,
`  $('#stRun').onclick = async () => {
    const r = await api('/api/selftest');
    if (!r.ok) { $('#stOut').innerHTML = 'selftest unavailable'; return; }
    const mark = { PASS: '✓', FAIL: '✗', WARNING: '!', NOT_TESTED: '–' };
    $('#stOut').innerHTML = \`<p class="empty-note">\${Object.entries(r.result.counts).map(([k, v]) => k + ': ' + v).join(' · ')}</p>\` +
      r.result.checks.map(c => row(mark[c.result] || '?', \`[\${esc(c.category)}] \${esc(c.check)}\${c.detail ? ' <small>' + esc(c.detail) + '</small>' : ''}\`)).join('');
  };`, 'selftest render');

rep(`  <div class="facet-card"><h4>Adapter truth table</h4>\${S.adapters.map(a => row(a.id, \`\${esc(a.name)} → <b>\${esc(a.state)}</b>\`)).join('')}</div>`,
`  <div class="facet-card"><h4>Adapter truth table</h4>\${S.adapters.map(a => row(a.id, \`\${esc(a.name)} → <b>\${esc(a.state)}</b>\`)).join('')}</div>
   <div class="facet-card"><h4>Release metadata (§129)</h4>
     \${(S.release ? [['version', S.release.version], ['build date', fmtDate(S.release.buildDate)], ['source revision', S.release.sourceRevision], ['dependency state', S.release.dependencyState], ['test status', S.release.testStatus], ['security status', S.release.securityStatus]] : [['version', S.version || '1.64.0'], ['release metadata', 'say “release” in Chat to generate it']]).map(([k, v]) => row(k, esc(String(v)))).join('')}</div>
   <div class="facet-card"><h4>Live systems (§119)</h4>
     \${row('observability', \`metrics \${(S.observability || {}).metrics || 0} · spans \${(S.observability || {}).spans || 0}\`)}
     \${row('evidence vault', S.evidenceVault ? \`\${S.evidenceVault.entries} record(s) · \${S.evidenceVault.ok ? 'VERIFIED' : 'CHECK'}\` : '—')}
     \${row('anti-fraud', S.fraud ? \`\${S.fraud.events} event(s)\` : '—')}
     \${row('devices', (S.devices || []).length + ' paired')}
     \${row('stops', ((S.kernel || {}).stops || []).length ? ((S.kernel.stops).map(x => x.scope).join(', ')) : 'none')}</div>`, 'status extras');

/* ── 6. profile view: accounts, organisations, subscription ────── */
rep(`async function renderDocs() {`,
`/* §130–§139 accounts + §113 organisations + §114 entitlements */
function renderAccountsPanel() {
  const accts = S.accounts || [];
  const subs = S.subscription || { planName: '—', entitlements: {} };
  return \`<div class="facet-card"><h4>Account inventory (§134)</h4>
    \${accts.length ? accts.map(a => row(a.connectionStatus, \`<b>\${esc(a.service)}:\${esc(a.identifier)}</b> <small>\${esc(a.securityStatus)} · \${a.capabilities.length} cap(s)\${a.expiresTs ? ' · expires ' + fmtDate(a.expiresTs) : ''}\${a.revocationState ? ' · revoked' : ''}</small>\`, \`<button class="mini-btn" data-acctsel="\${a.id}">Use</button><button class="mini-btn danger" data-acctdisc="\${a.id}">Disconnect</button>\`)).join('') : '<p class="empty-note">No accounts recorded. “record account <service>:<identifier>” in Chat. Configuration alone never counts as connected.</p>'}
    <div class="input-line" style="margin-top:8px"><input id="acctRec" placeholder="service:identifier"><button class="mini-btn" id="acctRecord">Record</button></div>
    <p class="empty-note">Multiple accounts per service stay separated; an ambiguous service fails closed rather than acting through the wrong account (§135).</p></div>
  <div class="facet-card"><h4>Subscription (§114)</h4>
    \${row('plan', \`<b>\${esc(subs.planName || '—')}</b> · \${esc(subs.planId || '')}\`)}
    \${Object.entries(subs.entitlements || {}).map(([k, v]) => row(k, esc(String(v)))).join('')}
    <p class="empty-note">Premium controls are enforced server-side. Billing stays locked until billing authority exists — the platform never creates charges it is not authorized to create.</p></div>
  <div class="facet-card"><h4>Organisations (§113)</h4>
    \${(S.orgs || []).length ? (S.orgs).map(o => row(o.name, \`\${o.members.length} member(s) · \${o.teams.length} team(s) · \${o.delegatedCapabilities.length} delegated cap(s)\`)).join('') : '<p class="empty-note">No organisations. Organisation authority never overrides individual account authority.</p>'}
    <div class="input-line" style="margin-top:8px"><input id="orgName" placeholder="organisation name"><button class="mini-btn" id="orgCreate">Create</button></div></div>\`;
}
async function renderDocs() {`, 'accounts panel');

/* profile view hosts the account/organisation/subscription panels */
rep(`  \`<div class="facet-card"><h4>Plain-language account control</h4><p>In Chat: “create owner account NAME password PASS” · “login PASS” · “logout” · “connect github with token …” · “connections” · “disconnect github”. Everything is also available here by button.</p></div>\`;`,
`  \`<div class="facet-card"><h4>Plain-language account control</h4><p>In Chat: “create owner account NAME password PASS” · “login PASS” · “logout” · “connect github with token …” · “connections” · “disconnect github”. Everything is also available here by button.</p></div>\` +
  renderAccountsPanel();`, 'profile panel');

rep(`  if ($('#ownerLogout')) $('#ownerLogout').onclick = async () => { await post('/api/auth/logout', {}); renderProfile(); };
}`,
`  if ($('#ownerLogout')) $('#ownerLogout').onclick = async () => { await post('/api/auth/logout', {}); renderProfile(); };
  if ($('#acctRecord')) $('#acctRecord').onclick = async () => { const v = $('#acctRec').value.split(':'); const r = await post('/api/accounts', { action: 'record', service: v[0], identifier: v[1] || 'primary' }); toast(r.ok ? 'Recorded ' + r.account.service + ':' + r.account.identifier + ' (RECORDED — connection needs real authorization)' : (r.error || 'failed')); renderProfile(); };
  if ($('#orgCreate')) $('#orgCreate').onclick = async () => { const r = await post('/api/organisations', { action: 'create', name: $('#orgName').value }); toast(r.ok ? 'Organisation created: ' + r.org.name : (r.error || 'failed')); renderProfile(); };
  $('#main').onclick = async e => {
    const sel = e.target.closest('[data-acctsel]'); if (sel) { const a = (S.accounts || []).find(x => x.id === sel.dataset.acctsel); const r = await post('/api/accounts', { action: 'select', service: a.service, id: a.id }); toast(r.ok ? 'Active account for ' + a.service + ': ' + a.identifier : (r.error || 'failed')); return; }
    const disc = e.target.closest('[data-acctdisc]'); if (disc) { const r = await post('/api/accounts', { action: 'disconnect', id: disc.dataset.acctdisc }); toast(r.ok ? 'Disconnected — ' + r.revokedGrants.length + ' grant(s) revoked' : (r.error || 'failed')); renderProfile(); }
  };
}`,'profile wiring');

fs.writeFileSync(f, s);
console.log(n + ' replacements applied');
