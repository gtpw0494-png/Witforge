/* Patch 4: conversational control of the v1.64 specification systems. */
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

rep(`  if ((m = low.match(/^grant ([\\w.]+)/)) ) { grant(m[1]); return R('Permission granted: ' + m[1] + ' (granted by your request, audited).'); }
  if ((m = low.match(/^revoke ([\\w.]+)/))) { revoke(m[1]); return R('Permission revoked: ' + m[1]); }`,
`  if ((m = low.match(/^grant ([\\w.]+)/)) ) { grant(m[1]); return R('Permission granted: ' + m[1] + ' (granted by your request, audited).'); }
  if ((m = low.match(/^revoke ([\\w.]+)/))) { revoke(m[1]); return R('Permission revoked: ' + m[1]); }
  /* §9/§10: inspect or change the authority model itself. */
  if (low === 'permissions' || low === 'capability states' || low === 'capabilities table') {
    const t = capabilityTable().filter(c => c.state !== 'NOT_REQUESTED');
    return R(t.length ? 'Capability states (state · level · risk):\\n' + t.map(c => \`• \${c.capability} — \${c.state} · \${c.level || '—'} · \${c.risk}\${c.scopes && Object.keys(c.scopes).length ? ' · scopes ' + Object.keys(c.scopes).join(',') : ''}\`).join('\\n') : 'No capability has been requested yet. Asking for something grants it; high risk requires approval.');
  }
  if ((m = low.match(/^(suspend|resume|deny|expire) ([\\w.]+)$/))) {
    const map = { suspend: suspend, resume: resumeCapability, deny: deny, expire: expire };
    const r = map[m[1]](m[2]);
    return R(r.ok ? \`\${m[2]} → \${r.state} (audited state change on the §9 permission machine).\` : r.error);
  }
  if ((m = low.match(/^(?:risk|assess) ([\\w.]+)$/))) {
    const tool = TOOLS[m[1]];
    if (!tool) return R('Unknown tool: ' + m[1]);
    const a = assessAction(m[1], {});
    return R(\`\${m[1]}: risk \${a.class} (score \${a.score}) — \${a.explanation}. Approval: \${JSON.stringify(kernel.approvalMatrix(a.class))}\`);
  }
  if ((m = low.match(/^policy ([\\w.]+)$/))) {
    const tool = TOOLS[m[1]];
    if (!tool) return R('Unknown tool: ' + m[1]);
    const p = actionPolicy(m[1], {}, {});
    return R(\`Policy for \${m[1]}: \${p.decision.decision} via \${p.decision.policyId} — \${p.decision.reason} (risk \${p.assessment.class}, capability \${p.cap} is \${capabilityState(p.cap)})\`);
  }
  /* §102–§160: workflow playbooks. */
  if (low === 'playbooks' || low === 'workflows') {
    return R('Workflow playbooks (spec worked examples):\\n' + Object.entries(taskEngine.PLAYBOOKS).map(([k, v]) => \`• \${k} \${v.section} — \${v.title} (\${v.steps.length} steps)\`).join('\\n') + '\\nRun one with “run playbook <key>”. Steps with no connected legitimate interface are reported WAITING_FOR_CAPABILITY — never faked.');
  }
  if ((m = low.match(/^run playbook ([\\w-]+)/))) {
    const r = await runPlaybookLocal(m[1], { params: {} });
    if (!r.ok && r.error) return R(r.error + ' Available: ' + (r.available || []).join(', '));
    return R(\`PLAYBOOK \${r.playbook} \${r.section} → \${r.state}\\n\` + r.steps.map(x => \`• \${x.id}: \${x.state}\${x.failureClass ? ' (' + x.failureClass + ')' : ''}\${x.capability ? ' [' + x.capability + ']' : ''}\`).join('\\n') + \`\\n\${r.performed} performed · \${r.waitingForCapability} waiting for capability · \${r.failed} failed\`);
  }
  /* §151 task state machine. */
  if ((m = low.match(/^new task (.+)$/))) {
    const t = taskEngine.createTask(m[1]);
    taskEngine.advance(t, 'UNDERSTANDING'); taskEngine.advance(t, 'PROBLEM_SOLVING'); taskEngine.advance(t, 'PLANNING');
    S.taskRecords.unshift(t); save();
    audit('task', 'TASK created: ' + t.objective.slice(0, 80), 'user', { action: 'task.create', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    return R(\`Task \${t.id} created and advanced to \${t.state}. Objective: “\${t.objective}”. It moves through the durable state machine (CREATED → UNDERSTANDING → PROBLEM_SOLVING → PLANNING → …).\`);
  }
  if (low === 'tasks state' || low === 'task states') {
    const t = S.taskRecords.slice(0, 8);
    return R(t.length ? 'Durable tasks:\\n' + t.map(x => \`• \${x.id} — \${x.state} — \${x.objective.slice(0, 60)}\`).join('\\n') : 'No durable tasks yet. Say “new task <objective>”.');
  }
  /* §118/§119/§129 inspection. */
  if (low === 'vault' || low === 'evidence vault') {
    const v = kernel.vaultVerify(S);
    return R(\`Evidence vault: \${v.entries} record(s), integrity \${v.ok ? 'VERIFIED' : 'BROKEN'}.\` + (S.evidenceVault.slice(0, 5).map(e => '\\n• ' + e.kind + ' ' + e.hash.slice(0, 12) + '…').join('')));
  }
  if (low === 'metrics' || low === 'observability') {
    const o = observability();
    return R(\`Observability: \${o.metrics.length} metric point(s), \${o.spans.length} span(s), correlation ids join them into task timelines. OpenTelemetry-shaped export available at /api/observability.\`);
  }
  if ((m = low.match(/^trace (\\S+)/))) {
    const t = services.traceTimeline(S, m[1]);
    return R(\`Timeline for \${m[1]}: \${t.spans.length} span(s), \${t.audit.length} audit event(s).\` + t.audit.slice(0, 5).map(a => '\\n• ' + a.action).join(''));
  }
  if (low === 'release' || low === 'version') {
    const r = releaseInfo();
    return R(\`\${r.version} · built \${new Date(r.buildDate).toISOString()} · revision \${r.sourceRevision} · dependencies: \${r.dependencyState} · tests: \${r.testStatus} · security: \${r.securityStatus}\`);
  }
  /* §40/§41/§104 devices. */
  if (low === 'devices') {
    const list = services.isolationReport(S);
    return R(list.length ? 'Paired devices:\\n' + list.map(d => \`• \${d.name} (\${d.platform}) — trust \${d.trust} · caps \${d.capabilities} · sessions \${d.sessions}\`).join('\\n') + '\\nPairing establishes identity only; it grants no capabilities.' : 'No devices paired. Say “pair device <name> as android” — pairing needs the code your device issues and grants no capabilities by itself.');
  }
  if ((m = low.match(/^pair device ([\\w '-]{2,30}?)(?: as (android|ios|ipados|macos|windows|linux|chromeos|web|server|wearable|smart-device))?$/))) {
    const r = pairDeviceCmd({ name: m[1], platform: m[2] || 'unknown', method: 'user-initiated' });
    return R(r.ok ? \`Device “\${r.device.name}” paired — trust state PENDING. Trust it with “trust device \${r.device.name}” once you accept it.\` : r.error);
  }
  if ((m = low.match(/^trust device ([\\w '-]{2,30})$/))) {
    const d = S.devices.find(x => x.name.toLowerCase() === m[1].toLowerCase());
    if (!d) return R('No paired device named ' + m[1]);
    const r = setDeviceTrustCmd(d.id, 'TRUSTED');
    return R(r.ok ? \`\${d.name} is now TRUSTED. Capabilities are still granted per capability, never in bulk.\` : r.error);
  }
  if ((m = low.match(/^(?:revoke|untrust) device ([\\w '-]{2,30})$/))) {
    const d = S.devices.find(x => x.name.toLowerCase() === m[1].toLowerCase());
    if (!d) return R('No paired device named ' + m[1]);
    const r = setDeviceTrustCmd(d.id, 'REVOKED', { reason: 'revoked by user via chat' });
    return R(r.ok ? \`\${d.name} REVOKED — sessions cleared, capabilities dropped, audit preserved.\` : r.error);
  }
  /* §130–§139 accounts. */
  if (low === 'accounts' || low === 'account inventory') {
    const inv = services.accountInventory(S);
    return R(inv.length ? 'Account inventory:\\n' + inv.map(a => \`• \${a.service}:\${a.identifier} — \${a.connectionStatus} · \${a.securityStatus}\${a.capabilities.length ? ' · ' + a.capabilities.length + ' caps' : ''}\`).join('\\n') : 'No accounts recorded. “record account <service>:<identifier>” adds one; connections require the provider’s own authorization.');
  }
  if ((m = low.match(/^use account (\\S+) for ([a-z0-9-]+)$/))) {
    const list = services.accountsFor(S, m[2]);
    const acct = list.find(a => a.identifier === m[1] || a.id === m[1]);
    if (!acct) return R('No account ' + m[1] + ' for ' + m[2]);
    const r = services.selectAccount(S, m[2], acct.id);
    if (r.ok) audit('account', 'ACTIVE ACCOUNT set: ' + m[2] + ' → ' + acct.identifier, 'user', { action: 'account.select', decision: 'ALLOW', risk: 'MEDIUM' });
    save();
    return R(r.ok ? \`Active account for \${m[2]} is now \${acct.identifier}. WitForge never picks an account by guessing.\` : r.error);
  }
  if ((m = low.match(/^record account ([a-z0-9.-]+):(\\S+)$/))) {
    const r = addAccountCmd({ service: m[1], identifier: m[2] });
    return R(r.ok ? \`Recorded \${m[1]}:\${m[2]} (connection status RECORDED). Connecting it requires the service’s real authorization flow — configuration alone never counts as connected.\` : r.error);
  }
  if ((m = low.match(/^disconnect account (\\S+)/))) {
    const list = S.accounts.filter(a => a.id === m[1] || a.identifier === m[1] || a.service === m[1]);
    if (!list.length) return R('No matching account');
    const results = list.map(a => disconnectAccountCmd(a.id));
    return R(results.map(r => \`Disconnected \${r.account}; revoked \${r.revokedGrants.length} grant(s)\${r.credentialRevoked ? ', destroyed the credential' : ''}; audit preserved.\`).join('\\n'));
  }
  if ((m = low.match(/^delete account (\\S+)( confirm)?$/))) {
    const a = S.accounts.find(x => x.id === m[1] || x.identifier === m[1]);
    if (!a) return R('No matching account');
    const r = deleteAccountCmd(a.id, !!m[2]);
    return R(r.ok ? 'Account record deleted, affected data reported and verified.' : (r.needsConfirmation ? 'Deletion affects: ' + r.affectedData.join(', ') + '. ' + r.warning + ' Say “delete account ' + m[1] + ' confirm”.' : r.error));
  }
  if ((m = low.match(/^account boundary (.+)/))) {
    const req = {};
    String(m[1]).split(/\\s+/).forEach(k => { if (k) req[k] = true; });
    const r = accountBoundaryCheck(req);
    return R(r.ok ? 'No boundary violation detected for that request shape.' : 'REFUSED by account boundaries: ' + r.violations.join('; ') + '. WitForge stops at human-required boundaries and asks you to complete them.');
  }
  /* §113/§114 organisations and entitlements. */
  if ((m = low.match(/^create org(?:anisation)? (.+)$/))) {
    const r = createOrgCmd({ name: m[1] });
    return R(r.ok ? \`Organisation “\${r.org.name}” created. Organisation authority never overrides individual account authority.\` : r.error);
  }
  if (low === 'orgs' || low === 'organisations') {
    return R(S.orgs.length ? 'Organisations:\\n' + S.orgs.map(o => \`• \${o.name} — \${o.members.length} member(s), \${o.teams.length} team(s), \${o.delegatedCapabilities.length} delegated cap(s)\`).join('\\n') : 'No organisations. Say “create org <name>”.');
  }
  if ((m = low.match(/^plan (free|plus|pro|business|enterprise)$/))) {
    const r = subscribeCmd(m[1]);
    const e = r.subscription.entitlements;
    return R(\`Plan set to \${r.subscription.planName}. Entitlements: \${Object.entries(e).map(([k, v]) => k + '=' + v).join(', ')}. Premium controls are enforced server-side; billing stays locked until billing authority exists.\`);
  }
  if (low === 'subscription' || low === 'entitlements') {
    const s2 = services.currentSubscription(S);
    return R(\`Plan \${s2.planName} (\${s2.planId}) — status \${s2.status}. Entitlements: \${Object.entries(s2.entitlements).map(([k, v]) => k + '=' + v).join(', ')}. Billing chargeable: \${s2.billing.chargeable} (\${s2.billing.note})\`);
  }
  /* §110/§112 assets + anti-fraud. */
  if (low === 'assets') {
    return R(S.assets.length ? 'Asset registry:\\n' + S.assets.slice(0, 10).map(a => \`• \${a.assetId} \${a.type} R\${a.rarity} owner=\${a.owner} status=\${a.status} identity=\${a.identity.slice(0, 12)}…\`).join('\\n') : 'No assets registered. Assets are minted by the arena engine (loot, forge, pets); say “mint asset piece rarity 5”.');
  }
  if ((m = low.match(/^mint asset (\\w+)(?: rarity (\\d{1,3}))?(?: owner (\\S+))?/))) {
    const r = registerAssetCmd({ type: m[1], rarity: m[2] ? Number(m[2]) : 1, owner: m[3] || 'Owner', creator: m[3] || 'Owner' });
    return R(r.ok ? \`Asset \${r.asset.assetId} registered (R\${r.asset.rarity}, identity \${r.asset.identity.slice(0, 12)}…). Anti-duplication and provenance records applied.\` : (r.reason === 'rarity-100-needs-approval' ? 'Rarity 100 is a controlled state: it needs an approval record, full provenance and a uniqueness check before creation.' : r.reason));
  }
  if ((m = low.match(/^asset provenance (\\S+)/))) {
    const r = services.provenanceReport(S, m[1]);
    return R(r ? \`\${r.assetId}: \${r.type} R\${r.rarity} · creator \${r.creator} · owner \${r.currentOwner} · source \${r.source} · parents \${r.parentAssets.join(',') || 'none'} · transfers \${r.transfers.length} · merges \${r.mergeHistory.length}\` : 'Unknown asset');
  }
  if ((m = low.match(/^transfer asset (\\S+) to (\\S+)/))) {
    const r = transferAssetCmd(m[1], m[2], 'user transfer');
    return R(r.ok ? \`Transferred \${m[1]} → \${m[2]} (transfer history now \${r.history} record(s)).\` : r.error);
  }
  if (low === 'fraud') {
    const r = services.fraudReport(S);
    return R(\`Anti-fraud monitor: \${r.events} event(s). By severity: \${Object.entries(r.bySeverity).map(([k, v]) => k + '=' + v).join(', ') || 'none'}. Duplicate detection, transaction monitoring, rate limits, anomaly detection and account separation are active.\`);
  }
  /* §85/§86 Arena wager matches. */
  if ((m = low.match(/^provision loadout ([\\w '-]{2,30})$/))) {
    const arena = require('./arena-engine.js');
    const av = arena.list().find(a => a.name.toLowerCase() === m[1].toLowerCase());
    if (!av) return R('No avatar named ' + m[1]);
    const r = arena.equipLoadout(av.id, {});
    return R(r.ok ? \`\${av.name} equipped: \${r.equipped.map(e => e.slot).join(', ')}. Completeness gate now \${r.status.complete ? 'SATISFIED' : 'still missing ' + r.status.missing.join(', ')}.\` : r.error);
  }
  if ((m = low.match(/^arena wager ([\\w '-]{2,30}?) vs ([\\w '-]{2,30}?)(?: seed (\\d+))?( confirm)?$/))) {
    const arena = require('./arena-engine.js');
    const A = arena.list().find(x => x.name.toLowerCase() === m[1].toLowerCase());
    const B = arena.list().find(x => x.name.toLowerCase() === m[2].toLowerCase());
    if (!A || !B) return R('Both avatars must exist');
    const r = arenaWagerMatch({ a: A.id, b: B.id, confirmed: !!m[4], seed: m[3] ? Number(m[3]) : undefined });
    if (r.needsLoadout) return R('Loadout gate: ' + r.error);
    if (r.needsConfirmation) return R('Wager terms: ' + JSON.stringify(r.terms) + '. Real-money wagering stays compliance-locked. Say “arena wager ' + m[1] + ' vs ' + m[2] + ' confirm”.');
    if (r.drew) return R('The match ended in a true draw — nothing settles and both stakes are returned (no treasury allocation on a draw).');
    return R(r.ok ? \`SIMULATION wager settled: pool \${r.pool} LD → winner \${r.winner} LD, treasury \${r.treasury} LD (1%) to \${r.winnerAvatar}. Deterministic seed \${r.seed}, \${r.rounds} rounds, \${r.decision}. Real money: LOCKED.\` : r.error);
  }
  /* §65 memory classes + §64 project records. */
  if (low === 'memory classes') return R('Memory classes: ' + MEMORY_CLASSES.join(', ') + '. Ordinary memory is information, never authority — it cannot rewrite policy or permissions.');
  if ((m = low.match(/^remember as (\\w[\\w-]*) (.+)$/))) {
    const r = rememberTyped(m[2], m[1]);
    return R(r.ok ? \`Stored in memory class “\${r.record.class}”.\${r.escalationIgnored ? ' (The text mentions authority-shaped words — no authority was granted.)' : ''}\` : r.error);
  }
  if ((m = low.match(/^create project ([^|]+?)(?: \\| goals? (.+))?$/))) {
    const r = createProjectFull({ name: m[1].trim(), goals: m[2] ? m[2].split(';').map(x => x.trim()) : [] });
    return R(r.ok ? \`Project “\${r.project.name}” created with goals/tasks/agents/files/integrations/permissions/memory/assets/audit records.\` : r.error);
  }`, 'authority+systems intents');

fs.writeFileSync(f, s);
console.log(n + ' replacements applied');
