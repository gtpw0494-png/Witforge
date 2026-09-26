/* Patch 5: server.js — v1.64 API surface for the new specification systems. */
'use strict';
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'server.js');
let s = fs.readFileSync(f, 'utf8');
let n = 0;
function rep(old, neu, label) {
  if (!s.includes(old)) { console.error('MISS: ' + label); process.exitCode = 1; return; }
  s = s.replace(old, neu); n++;
  console.log('ok: ' + label);
}

rep(`const arena = require('./arena-engine.js');
const P = require('./platform.js');`,
`const arena = require('./arena-engine.js');
const P = require('./platform.js');
const kernel = P.kernel, caps = P.caps, taskEngine = P.taskEngine, services = P.services;
const VERSION = P.VERSION;`, 'requires');

/* /api/state carries the new systems so the UI can render them truthfully. */
rep(`      creds: P.listCreds(), owner: !!P.state.owner, authed, autonomous: P.state.autonomous
    });`,
`      creds: P.listCreds(), owner: !!P.state.owner, authed, autonomous: P.state.autonomous,
      /* v1.64 specification systems */
      kernel: {
        permissionStates: kernel.PERMISSION_STATES,
        permissionLevels: kernel.PERMISSION_LEVELS,
        scopeDimensions: kernel.SCOPE_DIMENSIONS,
        riskClasses: kernel.RISK_CLASSES,
        policyDecisions: kernel.POLICY_DECISIONS,
        stopScopes: kernel.STOP_SCOPES,
        stops: kernel.stopReport(s),
        authorityOrder: kernel.AUTHORITY_ORDER
      },
      capabilityTable: P.capabilityTable(),
      devices: services.isolationReport(s),
      accounts: services.accountInventory(s),
      orgs: s.orgs,
      subscription: services.currentSubscription(s),
      assets: (s.assets || []).slice(0, 40),
      taskRecords: (s.taskRecords || []).slice(0, 20),
      playbooks: Object.entries(taskEngine.PLAYBOOKS).map(([k, v]) => ({ id: k, section: v.section, title: v.title, steps: v.steps.length })),
      observability: { metrics: (s.metrics || []).length, spans: (s.spans || []).length },
      evidenceVault: kernel.vaultVerify(s),
      fraud: services.fraudReport(s),
      release: s.release,
      adapters: P.adaptersLive().map(a => ({ id: a.id, name: a.name, state: a.state, caps: a.caps })),
      version: VERSION
    });`, 'state');

rep(`  if (p === '/api/spec/compliance') return json(res, 200, { ok: true, coverage: P.compliance() });
  if (p === '/api/selftest') return json(res, 200, { ok: true, result: P.selftestAll() });`,
`  if (p === '/api/spec/compliance') return json(res, 200, { ok: true, coverage: P.compliance() });
  if (p === '/api/selftest') return json(res, 200, { ok: true, result: P.selftestAll() });
  if (p === '/api/version') return json(res, 200, { ok: true, release: P.releaseInfo() });
  if (p === '/api/observability') return json(res, 200, { ok: true, observability: P.observability() });
  if (p === '/api/evidence') return json(res, 200, { ok: true, vault: kernel.vaultList(P.state), integrity: kernel.vaultVerify(P.state) });
  if (p === '/api/risk/classes') return json(res, 200, { ok: true, classes: kernel.RISK_CLASSES, matrix: kernel.RISK_CLASSES.map(c => ({ class: c, ...kernel.approvalMatrix(c) })), factors: kernel.RISK_FACTORS });
  if (p === '/api/policy') return json(res, 200, { ok: true, decisions: kernel.POLICY_DECISIONS, policies: kernel.POLICIES.map(x => ({ id: x.id, sections: x.sections, decision: x.decision })) });
  if (p === '/api/policy/evaluate' && req.method === 'POST') { const b = await body(req); return json(res, 200, { ok: true, result: kernel.evaluatePolicy(b.ctx || b) }); }
  if (p === '/api/capabilities/catalogue') return json(res, 200, { ok: true, catalogue: caps.CAPABILITY_CATALOGUE, domains: caps.CAPS_BY_DOMAIN, adapterContract: caps.ADAPTER_CONTRACT, mockAdapters: caps.MOCK_ADAPTERS.map(a => a.getStatus()) });
  if (p === '/api/task-states') return json(res, 200, { ok: true, states: taskEngine.TASK_STATES, transitions: taskEngine.TASK_TRANSITIONS, resultStates: taskEngine.RESULT_STATES, failureClasses: taskEngine.FAILURE_CLASSES, playbooks: Object.keys(taskEngine.PLAYBOOKS) });

  /* ── §55 emergency stop scopes ── */
  if (p === '/api/stops' && req.method === 'POST') { const b = await body(req); return json(res, 200, b.clear ? P.resumeScope(String(b.scope || ''), b.target || null) : P.stopScope(String(b.scope || ''), b.target || null, b.reason)); }
  /* ── §40/§41/§104 devices ── */
  if (p === '/api/devices' && req.method === 'POST') {
    const b = await body(req);
    if (b.action === 'pair') return json(res, 200, P.pairDeviceCmd(b));
    if (b.action === 'trust') return json(res, 200, P.setDeviceTrustCmd(b.id, String(b.trust || 'TRUSTED'), { reason: b.reason }));
    if (b.action === 'command') return json(res, 200, P.deviceCommand(b.command));
    if (b.action === 'grant') return json(res, 200, services.grantDeviceCapability(P.state, b.id, b.capability, b.scope));
    if (b.action === 'revoke') return json(res, 200, services.revokeDeviceCapability(P.state, b.id, b.capability));
    return json(res, 200, { ok: false, error: 'Unknown device action' });
  }
  /* ── §130–§139 accounts ── */
  if (p === '/api/accounts' && req.method === 'POST') {
    const b = await body(req);
    if (b.action === 'record') return json(res, 200, P.addAccountCmd(b));
    if (b.action === 'select') return json(res, 200, services.selectAccount(P.state, b.service, b.id));
    if (b.action === 'disconnect') return json(res, 200, P.disconnectAccountCmd(b.id));
    if (b.action === 'delete') return json(res, 200, P.deleteAccountCmd(b.id, b.confirmed === true));
    if (b.action === 'boundary') return json(res, 200, P.accountBoundaryCheck(b.request || {}));
    return json(res, 200, { ok: false, error: 'Unknown account action' });
  }
  /* ── §113/§114 organisations + entitlements ── */
  if (p === '/api/organisations' && req.method === 'POST') {
    const b = await body(req);
    if (b.action === 'create') return json(res, 200, P.createOrgCmd(b));
    if (b.action === 'member') return json(res, 200, services.addOrgMember(P.state, b.orgId, b));
    if (b.action === 'team') return json(res, 200, services.addOrgTeam(P.state, b.orgId, b.name));
    if (b.action === 'delegate') return json(res, 200, services.delegateOrgCapability(P.state, b.orgId, b.capability, b));
    return json(res, 200, { ok: false, error: 'Unknown organisation action' });
  }
  if (p === '/api/subscription' && req.method === 'POST') { const b = await body(req); return json(res, 200, b.plan ? P.subscribeCmd(String(b.plan)) : { ok: false, error: 'plan required' }); }
  if (p === '/api/subscription/entitlement') return json(res, 200, { ok: true, result: services.requireEntitlement(P.state, String(url.searchParams.get('key') || 'agents.max'), Number(url.searchParams.get('amount') || 1)) });
  /* ── §110/§112 assets + anti-fraud ── */
  if (p === '/api/assets' && req.method === 'POST') {
    const b = await body(req);
    if (b.action === 'transfer') return json(res, 200, P.transferAssetCmd(b.assetId, b.to, b.reason));
    if (b.action === 'provenance') return json(res, 200, { ok: true, provenance: services.provenanceReport(P.state, b.assetId) });
    return json(res, 200, P.registerAssetCmd(b));
  }
  if (p === '/api/fraud') return json(res, 200, { ok: true, report: services.fraudReport(P.state), signals: services.FRAUD_SIGNALS.map(x => ({ id: x.id, severity: x.severity, note: x.note })) });
  /* ── §107 offline queue ── */
  if (p === '/api/offline' && req.method === 'POST') {
    const b = await body(req);
    if (b.action === 'flush') return json(res, 200, services.flushOffline(P.state, { online: b.online === true }));
    return json(res, 200, services.queueOffline(P.state, b));
  }
  /* ── §102–§160 playbooks ── */
  if (p === '/api/playbooks') return json(res, 200, { ok: true, playbooks: Object.entries(taskEngine.PLAYBOOKS).map(([k, v]) => ({ id: k, section: v.section, title: v.title, steps: v.steps.map(s2 => ({ id: s2.id, capability: s2.capability, risk: s2.riskClass, mode: s2.mode, verification: s2.verification })) })) });
  if (p === '/api/playbooks/run' && req.method === 'POST') { const b = await body(req); return json(res, 200, await P.runPlaybookLocal(String(b.playbook || ''), { params: b.params || {} })); }
  /* ── §12 autonomous policies + §11 delegation ── */
  if (p === '/api/autonomous/policy' && req.method === 'POST') {
    const b = await body(req);
    if (b.action === 'disable') return json(res, 200, P.disableAutonomousPolicies());
    return json(res, 200, P.enableAutonomousPolicy(b));
  }
  if (p === '/api/delegation' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.addDelegation(b)); }
`, 'endpoints');

/* §65: the memory endpoint accepts a memory class and keeps the guard. */
rep(`  if (p === '/api/memory' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.text || '').trim()) return json(res, 200, { ok: false, error: 'text required' });
    P.state.memory.unshift({ id: P.nid('m'), text: String(b.text).slice(0, 240), ts: Date.now(), source: 'user-statement' });
    P.save(); P.audit('memory', 'Memory recorded');
    return json(res, 200, { ok: true });
  }`,
`  if (p === '/api/memory' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.text || '').trim()) return json(res, 200, { ok: false, error: 'text required' });
    /* §65: typed memory; ordinary memory can never rewrite authority. */
    return json(res, 200, P.rememberTyped(b.text, b.class || 'conversation'));
  }`, 'memory class');

/* §64: projects created through the API carry the full record shape. */
rep(`  if (p === '/api/projects' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.name || '').trim()) return json(res, 200, { ok: false, error: 'name required' });
    P.state.projects.unshift({ id: P.nid('p'), name: String(b.name).slice(0, 80), created: Date.now() });
    P.save(); P.audit('project', 'Created project: ' + b.name);
    return json(res, 200, { ok: true });
  }`,
`  if (p === '/api/projects' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.name || '').trim()) return json(res, 200, { ok: false, error: 'name required' });
    return json(res, 200, P.createProjectFull(b));
  }`, 'project full');

fs.writeFileSync(f, s);
console.log(n + ' replacements applied');
