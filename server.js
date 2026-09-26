/* LIAM — AI Control Centre · zero-dependency local server
 * Static hosting + truthful health + arena + full platform API.
 * The server is authoritative: state, permissions, approvals, execution,
 * audit and the ledger live here; the browser is a control surface.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const arena = require('./arena-engine.js');
const P = require('./platform.js');
const kernel = P.kernel, caps = P.caps, taskEngine = P.taskEngine, services = P.services;
const engagement = P.engagement, ownerSec = P.ownerSec;
const VERSION = P.VERSION;

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);

/* v1.98 security-audit finding #1 → SHIPPED FIX: the API binds 0.0.0.0 (the
 * preview sandbox needs it), so any host that can reach the port could drive
 * /api/* — including commands that create REAL charges. LIAM_API_TOKEN (env)
 * gates every POST /api/* behind a bearer token. OFF by default for the
 * single-owner localhost UX; ON it anywhere you distrust the LAN:
 * LIAM_API_TOKEN=<…> node server.js  (front-end sends it automatically when
 * you 'll connect' through the authenticated console of this same server.) */
const API_TOKEN = process.env.LIAM_API_TOKEN || null;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw = (raw + c).slice(0, 1e6); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
  });
}

const RL = new Map();
function rateLimited(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const e = RL.get(ip);
  if (!e || now - e.t > 60000) { RL.set(ip, { t: now, n: 1 }); return false; }
  e.n++;
  return e.n > 120;
}
function cookie(req, name) {
  const h = req.headers.cookie || '';
  const m = h.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

const server = http.createServer(async (req, res) => {
  if (API_TOKEN && req.method === 'POST' && req.url.startsWith('/api/')) {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + API_TOKEN) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="liam"' });
      return res.end(JSON.stringify({ ok: false, error: 'unauthorized — LIAM_API_TOKEN bearer required (set on the server with the LIAM_API_TOKEN env var)' }));
    }
  }
  // §57 application security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://js.puter.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://js.puter.com https://api.open-meteo.com https://geocoding-api.open-meteo.com https://api.github.com");
  if (req.method !== 'GET' && rateLimited(req)) {
    return json(res, 429, { ok: false, error: 'Rate limited (120 req/min)' });
  }
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  let m;
  // §58 owner session enforcement once an owner exists
  const authed = P.sessionValid(cookie(req, 'liam_session'));
  if (P.state.owner && !authed && req.method !== 'GET' && !p.startsWith('/api/auth')) {
    return json(res, 401, { ok: false, error: 'auth-required' });
  }

  /* ── platform: state & command router ── */
  if (p === '/api/audit' && req.method === 'POST') {
    const b = await body(req);
    P.audit(String(b.type || 'nav'), String(b.detail || '').slice(0, 200), 'user');
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/clear' && req.method === 'POST') {
    const b = await body(req);
    if (b.confirm !== 'WIPE') return json(res, 200, { ok: false, error: 'Confirmation word required (WIPE)' });
    P.state.conversations = []; P.state.tasks = []; P.state.projects = []; P.state.agents = [];
    P.state.memory = []; P.state.knowledge = []; P.state.approvals = []; P.state.permissions = {};
    P.state.emergency = 'NORMAL';
    P.audit('data', 'PLATFORM RESET by user with explicit confirmation', 'user');
    return json(res, 200, { ok: true });
  }
  if (p === '/api/state') {
    const s = P.state;
    return json(res, 200, {
      ok: true,
      conversations: s.conversations, tasks: s.tasks, projects: s.projects, agents: s.agents,
      memory: s.memory, knowledge: s.knowledge, audit: s.audit, permissions: s.permissions,
      approvals: s.approvals, humanSteps: (s.humanSteps || []).slice(0, 50), proposals: (s.proposals || []).slice(0, 30), emergency: s.emergency, ledger: s.ledger,
      reminders: s.reminders, schedules: s.schedules, notifications: s.notifications.slice(0, 30),
      avatars: arena.list(), talentTree: arena.TALENTS,
      adapters: P.adaptersLive().map(a => ({ id: a.id, name: a.name, state: a.state, caps: a.caps })),
      creds: P.listCreds(), owner: !!P.state.owner, authed, autonomous: P.state.autonomous,
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
      /* v1.65 engagement + owner protection */
      engagement: {
        events: P.state.events.map(e => ({ id: e.id, title: e.title, type: e.type, state: e.state, entryLD: e.entryLD, participants: e.participants.length, rewards: e.rewards, blurb: e.blurb, startsTs: e.startsTs, endsTs: e.endsTs })),
        lotto: (() => {
          const open = engagement.openRoundOf(P.state);
          const drawn = (P.state.lottoRounds || []).filter(r => r.state === 'DRAWN').slice(0, 5);
          return {
            rules: engagement.LOTTO_RULES,
            open: open ? { id: open.id, commitHash: open.commitHash, tickets: open.tickets.length, openedTs: open.openedTs } : null,
            recent: drawn.map(r => ({ id: r.id, numbers: r.drawn.numbers, paid: r.prizes.paid, treasury: r.prizes.treasury, rollover: r.prizes.rolloverOut, winners: r.prizes.payouts.length }))
          };
        })(),
        signIn: engagement.signInStatus(P.state, (P.state.owner && P.state.owner.name) || 'Owner'),
        quests: engagement.questSummary(P.state),
        plan: services.currentSubscription(P.state),
        ld: { balances: P.state.ledger.accounts, market: engagement.LD_MARKET, prices: { pieces: engagement.PIECE_COST, pet: engagement.PET_COST, merge: engagement.MERGE_COST }, orders: (P.state.ldOrders || []).slice(0, 8) },
        guardian: ownerSec.guardianReport(P.state),
        protection: ownerSec.protectionReport(P.state)
      },
      version: VERSION
    });
  }
  if (p === '/api/command' && req.method === 'POST') {
    const b = await body(req);
    const r = await P.withCid(() => P.command(b.text));
    if (r) return json(res, 200, r);
    /* Nothing matched. The AI brain (if connected) answers, labelled;
     * otherwise the honest setup guidance. Chat never dead-ends. */
    const fb = await P.chatFallback(b.text);
    if (fb) return json(res, 200, fb);
    return json(res, 200, {
      ok: false, unhandled: true, text: b.text,
      reply: 'I do not have an intent for “' + String(b.text || '').slice(0, 80) + '”. Say “help” for everything I can do, “preview <command>” to see what a command would do, or rephrase it as an action (“create task …”, “forge …”, “buy 500 ld”, “open lotto round”, “plans”, “protect me”).'
    });
  }
  if (p === '/api/auth/status') return json(res, 200, { ok: true, owner: !!P.state.owner, authed });
  if (p === '/api/auth/owner' && req.method === 'POST') {
    const b = await body(req);
    return json(res, 200, P.createOwner(b.name, b.password));
  }
  if (p === '/api/auth/login' && req.method === 'POST') {
    const b = await body(req);
    const r = P.login(b.password);
    if (r.ok) { res.setHeader('Set-Cookie', `liam_session=${r.token}; HttpOnly; SameSite=Strict; Path=/`); delete r.token; }
    return json(res, 200, r);
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    const r = P.logout(cookie(req, 'liam_session'));
    res.setHeader('Set-Cookie', 'liam_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, r);
  }
  if (p === '/api/legal') return json(res, 200, { ok: true, docs: P.state.legal });
  if (p === '/api/spec/compliance') return json(res, 200, { ok: true, coverage: P.compliance() });
  if (p === '/api/selftest') return json(res, 200, { ok: true, result: P.selftestAll() });
  if (p === '/api/version') return json(res, 200, { ok: true, release: P.releaseInfo() });

  /* ── v1.65 engagement: events, lotto, sign-in, tasks, LD market ── */
  if (p === '/api/engagement') return json(res, 200, {
    ok: true,
    events: engagement.listEvents(P.state),
    lotto: { rules: engagement.LOTTO_RULES, open: engagement.openRoundOf(P.state), rounds: (P.state.lottoRounds || []).slice(0, 5) },
    signIn: engagement.signInStatus(P.state, (P.state.owner && P.state.owner.name) || 'Owner'),
    quests: engagement.questSummary(P.state),
    economy: P.economyReport(),
    plan: services.currentSubscription(P.state),
    guardian: ownerSec.guardianReport(P.state),
    protection: ownerSec.protectionReport(P.state)
  });
  if (p === '/api/events' && req.method === 'POST') {
    const b = await body(req);
    const who = (P.state.owner && P.state.owner.name) || 'Owner';
    if (b.action === 'join') return json(res, 200, await P.command('join event ' + b.id));
    if (b.action === 'progress') return json(res, 200, await P.command('event progress ' + b.id + (b.units ? ' ' + b.units : '')));
    if (b.action === 'close') return json(res, 200, await P.command('close event ' + b.id + (b.winner ? ' winner ' + b.winner : '')));
    if (b.action === 'create') {
      const e = { id: 'evt-' + P.nid(''), ts: Date.now(), type: b.type || 'launch', title: String(b.title || 'Owner event').slice(0, 80), blurb: String(b.blurb || '').slice(0, 200), startsTs: Date.now(), endsTs: Date.now() + (Number(b.days) || 1) * 86400000, entryLD: Number(b.entryLD) || 0, rewards: b.rewards || { ld: Number(b.rewardLD) || 0 }, state: 'SCHEDULED', participants: [], winner: null, results: null };
      P.state.events.unshift(e); P.save();
      P.audit('event', 'EVENT created by owner: ' + e.title + ' (' + e.type + ')', 'user');
      return json(res, 200, { ok: true, event: e });
    }
    return json(res, 200, { ok: false, error: 'Unknown event action' });
  }
  if (p === '/api/lotto' && req.method === 'POST') {
    const b = await body(req);
    if (b.action === 'open') return json(res, 200, await P.command('open lotto round'));
    if (b.action === 'buy') return json(res, 200, await P.command('buy ' + (Number(b.count) || 1) + ' lotto tickets'));
    if (b.action === 'draw') return json(res, 200, await P.command('draw lotto confirm'));
    if (b.action === 'verify') {
      const r = b.id ? (P.state.lottoRounds || []).find(x => x.id === b.id) : (P.state.lottoRounds || []).find(x => x.state === 'DRAWN');
      return json(res, 200, r ? engagement.verifyRound(r) : { ok: false, error: 'No drawn round' });
    }
    return json(res, 200, { ok: false, error: 'Unknown lotto action' });
  }
  if (p === '/api/signin' && req.method === 'POST') return json(res, 200, await P.command('sign in'));
  if (p === '/api/quests') {
    if (req.method === 'GET') return json(res, 200, { ok: true, quests: engagement.questSummary(P.state) });
    const b = await body(req);
    if (b.action === 'claim') return json(res, 200, await P.command('claim task ' + String(b.id || '')));
    return json(res, 200, { ok: false, error: 'Unknown quest action' });
  }
  if (p === '/api/ld-packages') return json(res, 200, Object.assign({ ok: true }, P.ldPackagesList()));
  if (p === '/api/ldmarket') {
    if (req.method === 'GET') return json(res, 200, { ok: true, market: engagement.LD_MARKET, economy: P.economyReport(), prices: P.piecePriceList() });
    const b = await body(req);
    const r = P.ldMarketCmd(Number(b.ld), b.side === 'sell' ? 'sell' : 'buy');
    return json(res, 200, r);
  }
  /* ── v1.76: credentials surface — the same audited, AES-256-GCM store the
   * chat “connect <id> with token …” command uses, now with a control surface.
   * Tokens are write-only: they are never returned by any API response. */
  if (p === '/api/credentials') {
    const CRED_SERVICES = ['groq', 'gemini', 'openrouter', 'deepseek', 'mistral', 'github', 'stripe', 'x', 'facebook', 'reddit', 'instagram', 'linkedin', 'tiktok'];
    if (req.method === 'GET') return json(res, 200, { ok: true, credentials: P.listCreds(), adapters: P.adaptersLive().map(a => ({ id: a.id, name: a.name, state: a.state })) });
    const b = await body(req);
    const id = String(b.id || '').toLowerCase().slice(0, 24);
    if (!CRED_SERVICES.includes(id)) return json(res, 200, { ok: false, error: 'Unknown credential service “' + id + '”. Accepted: ' + CRED_SERVICES.join(', ') });
    if (b.revoke) return json(res, 200, P.revokeCredential(id));
    const r = P.setCredential(id, String(b.token || '').trim());
    return json(res, 200, Object.assign(r, r.ok ? { reply: 'Credential for ' + id + ' stored encrypted. Verify it to prove it works — configuration alone never counts as connected.' } : {}));
  }
  /* ── v1.77: official OAuth sign-in — the user authenticates on the
   * platform's own page; the callback hands the code back to this server,
   * which exchanges it server-side (client secrets never leave). */
  const oauthBase = rq => {
    const h = rq.headers.host || ('127.0.0.1:' + PORT);
    const proto = rq.headers['x-forwarded-proto'] || (/^(localhost|127\.|\[::1\])/.test(h) ? 'http' : 'https');
    return proto + '://' + h;
  };
  if (p === '/api/oauth') {
    if (req.method === 'GET') return json(res, 200, { ok: true, providers: P.oauthStatusList(), callbackUrl: oauthBase(req) + '/api/oauth/callback' });
    const b = await body(req);
    const id = String(b.id || '').toLowerCase().slice(0, 24);
    if (b.action === 'register') return json(res, 200, P.oauthSetApp(id, b.clientId, b.clientSecret));
    if (b.action === 'forget') return json(res, 200, P.oauthForgetApp(id));
    if (b.action === 'start') return json(res, 200, P.oauthStart(id, oauthBase(req) + '/api/oauth/callback'));
    if (b.action === 'exchange') return json(res, 200, await P.oauthExchange(id, { code: b.code, state: b.state || null, redirectUri: oauthBase(req) + '/api/oauth/callback' }));
    return json(res, 200, { ok: false, error: 'action required: register | forget | start | exchange' });
  }
  if (p === '/api/oauth/callback' && req.method === 'GET') {
    const q2 = Object.fromEntries(url.searchParams);
    const r = await P.oauthExchange(String(q2.id || q2.provider || ''), { code: q2.code || '', state: q2.state || null });
    res.writeHead(r.ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><meta charset="utf-8"><title>WitForge — official sign-in</title><body style="font-family:system-ui;background:#0b0e14;color:#e6e9f0;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:520px;padding:24px;border:1px solid #2a3142;border-radius:12px">'
      + '<h2 style="margin:0 0 8px">' + (r.ok ? '✓ Sign-in complete' : '✗ Sign-in failed') + '</h2>'
      + '<p style="color:#9aa3b7;line-height:1.5">' + (r.ok ? '<b style="color:#f5bf6b">AUTHORISED · NOT CONNECTED</b> — ' + String(r.name || '') + ' account token is stored (AES-256-GCM). Back in WitForge, press <b>Verify</b> on the Credentials card (or say “verify ' + String(r.provider || '') + '”) for a real round trip with recorded evidence; only then is it CONNECTED · VERIFIED. Your password never touched WitForge — it stayed on the platform\u2019s page, exactly as designed.' : String(r.error || 'unknown error')) + '</p>'
      + '<p style="color:#5b6478;font-size:13px">You can close this tab.</p></div></body>');
  }
  if (p === '/api/plans') {
    if (req.method === 'GET') return json(res, 200, { ok: true, plans: services.PLANS, current: services.currentSubscription(P.state) });
    const b = await body(req);
    const r = services.comparePlans(services.currentSubscription(P.state).planId, b.plan) && b.compare ? services.comparePlans(services.currentSubscription(P.state).planId, b.plan) : P.subscribeCmd(String(b.plan || ''));
    if (r.ok && b.compare) return json(res, 200, r);
    P.save();
    return json(res, 200, r);
  }
  /* ── owner security + guardian ── */
  if (p === '/api/security/owner') {
    if (req.method === 'GET') return json(res, 200, { ok: true, protection: ownerSec.protectionReport(P.state), controls: ownerSec.protectionControls(P.state), sessions: ownerSec.sessionInventory(P.state), alerts: ownerSec.securityState(P.state).alerts.slice(0, 20), levels: ownerSec.SECURITY_LEVELS });
    const b = await body(req);
    if (b.action === 'enroll') return json(res, 200, ownerSec.enrollSecondFactor(P.state));
    if (b.action === 'verify') return json(res, 200, ownerSec.verifySecondFactor(P.state, b.code));
    if (b.action === 'level') return json(res, 200, ownerSec.setSecurityLevel(P.state, b.level));
    if (b.action === 'revoke') return json(res, 200, ownerSec.revokeSessions(P.state, b.all ? { all: true } : { id: b.id }));
    if (b.action === 'drill') return json(res, 200, ownerSec.runDrill(P.state, b.kind));
    return json(res, 200, { ok: false, error: 'Unknown owner-security action' });
  }
  if (p === '/api/guardian') {
    if (req.method === 'GET') return json(res, 200, { ok: true, guardian: ownerSec.guardianReport(P.state), duties: ownerSec.AGENT_DUTIES, threats: ownerSec.THREATS, assurances: ownerSec.OWNER_ASSURANCES, notPromised: ownerSec.NOT_PROMISED });
    const b = await body(req);
    const a = ownerSec.guardianWatch(P.state, { action: b.text, agent: b.agent || 'assistant', source: b.source || 'user-request', untrusted: b.untrusted === true, content: b.content });
    P.save();
    return json(res, 200, a);
  }
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


  /* ── conversations ── */
  if (p === '/api/conversations' && req.method === 'POST') {
    const b = await body(req);
    const c = { id: P.nid('c'), title: P.scrubSecrets(b.title || 'New conversation').text.slice(0, 60), created: Date.now(), updated: Date.now(), messages: [] };
    P.state.conversations.unshift(c); P.save(); P.audit('chat', 'Conversation created: ' + c.title);
    return json(res, 200, { ok: true, conversation: c });
  }
  if ((m = p.match(/^\/api\/conversations\/([^/]+)\/message$/)) && req.method === 'POST') {
    const c = P.state.conversations.find(x => x.id === m[1]);
    if (!c) return json(res, 404, { ok: false, error: 'Not found' });
    const b = await body(req);
    const scrubbed = P.scrubSecrets(b.text);   // v1.88: secrets never persist through the chat path
    c.messages.push({ role: b.role || 'local', text: scrubbed.text.slice(0, 4000), ts: Date.now() });
    c.updated = Date.now();
    if (b.role === 'user' && c.messages.filter(x => x.role === 'user').length === 1) c.title = scrubbed.text.slice(0, 42);
    if (scrubbed.redactions) P.audit('security', 'SECRET SCRUBBED from a chat message before persistence (' + scrubbed.redactions + ' item(s)) — secrets live only in the encrypted vault', 'user');
    P.save();
    return json(res, 200, { ok: true, conversation: c });
  }
  if ((m = p.match(/^\/api\/conversations\/([^/]+)$/)) && req.method === 'DELETE') {
    P.state.conversations = P.state.conversations.filter(x => x.id !== m[1]);
    P.save(); P.audit('data', 'Conversation deleted');
    return json(res, 200, { ok: true });
  }

  /* ── tasks / projects / agents / memory / knowledge ── */
  if (p === '/api/tasks' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.text || '').trim()) return json(res, 200, { ok: false, error: 'text required' });
    P.state.tasks.unshift({ id: P.nid('t'), text: String(b.text).slice(0, 140), done: false, created: Date.now() });
    P.save(); P.audit('task', 'Created task: ' + b.text);
    return json(res, 200, { ok: true });
  }
  if ((m = p.match(/^\/api\/tasks\/([^/]+)$/)) && req.method === 'POST') {
    const t = P.state.tasks.find(x => x.id === m[1]); if (!t) return json(res, 404, { ok: false });
    const b = await body(req);
    if (b.action === 'delete') P.state.tasks = P.state.tasks.filter(x => x.id !== t.id);
    else t.done = b.action === 'done';
    P.save(); P.audit('task', (b.action === 'done' ? 'Completed' : b.action === 'reopen' ? 'Reopened' : 'Deleted') + ' task: ' + t.text);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/projects' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.name || '').trim()) return json(res, 200, { ok: false, error: 'name required' });
    return json(res, 200, P.createProjectFull(b));
  }
  if ((m = p.match(/^\/api\/projects\/([^/]+)$/)) && req.method === 'DELETE') {
    P.state.projects = P.state.projects.filter(x => x.id !== m[1]); P.save();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/agents' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.name || '').trim()) return json(res, 200, { ok: false, error: 'name required' });
    P.state.agents.unshift({ id: P.nid('ag'), name: String(b.name).slice(0, 60), scope: 'local', status: 'active', delegations: 0, created: Date.now() });
    P.save(); P.audit('agent', 'Created agent: ' + b.name);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/memory' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.text || '').trim()) return json(res, 200, { ok: false, error: 'text required' });
    /* §65: typed memory; ordinary memory can never rewrite authority. */
    return json(res, 200, P.rememberTyped(b.text, b.class || 'conversation'));
  }
  if ((m = p.match(/^\/api\/memory\/([^/]+)$/)) && req.method === 'DELETE') {
    P.state.memory = P.state.memory.filter(x => x.id !== m[1]); P.save();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/knowledge' && req.method === 'POST') {
    const b = await body(req);
    if (!String(b.text || '').trim()) return json(res, 200, { ok: false, error: 'text required' });
    P.state.knowledge.unshift({ id: P.nid('k'), title: String(b.text).slice(0, 60), text: String(b.text).slice(0, 500), ts: Date.now(), source: 'user', trusted: false });
    P.save(); P.audit('knowledge', 'Knowledge record added (untrusted)');
    return json(res, 200, { ok: true });
  }

  /* ── security / permissions / approvals ── */
  if (p === '/api/security/emergency' && req.method === 'POST') {
    const b = await body(req);
    return json(res, 200, P.setEmergency(String(b.state || ''), b.confirmed === true));
  }
  if (p === '/api/permissions/grant' && req.method === 'POST') {
    const b = await body(req); P.grant(String(b.cap || ''), 'user-request');
    return json(res, 200, { ok: true, permissions: P.state.permissions });
  }
  if (p === '/api/permissions/revoke' && req.method === 'POST') {
    const b = await body(req); P.revoke(String(b.cap || ''));
    return json(res, 200, { ok: true, permissions: P.state.permissions });
  }
  if ((m = p.match(/^\/api\/approvals\/([^/]+)$/)) && req.method === 'POST') {
    const b = await body(req);
    return json(res, 200, P.decideApproval(m[1], b.decision));
  }
  if ((m = p.match(/^\/api\/human-steps\/([^/]+)\/(resolve|cancel)$/)) && req.method === 'POST') {
    const b = await body(req);
    return json(res, 200, m[2] === 'resolve' ? P.resolveHumanStep(m[1], b.data, 'api') : P.cancelHumanStep(m[1]));
  }

  /* ── tools & economy ── */
  if (p === '/api/tools/run' && req.method === 'POST') {
    const b = await body(req);
    const r = await P.runTool(String(b.tool || ''), b.args || {}, { confirmed: b.confirmed === true });
    return json(res, 200, r);
  }
  if (p === '/api/economy') return json(res, 200, { ok: true, ledger: P.state.ledger, mode: P.state.economy.realMode ? 'REAL' : 'SIMULATION', realMode: P.state.economy.realMode, stripe: P.state.economy.stripeAccount });
  if (p === '/api/forge' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.forgePiece(b.avatarId, b.slot, b.prompt, b.band, b.flavor)); }
  if (p === '/api/capabilities') return json(res, 200, { ok: true, adapters: P.adaptersLive() });
  if (p === '/api/notifications') { P.tickReminders(); P.tickSchedules(); return json(res, 200, { ok: true, notifications: P.state.notifications.slice(0, 20), reminders: P.state.reminders.filter(r => !r.done) }); }
  if (p === '/api/export') return json(res, 200, { ok: true, manifest: P.exportManifest() });
  if (p === '/api/import' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.importManifest(b.manifest, !!b.confirm)); }
  if (p === '/api/vault/seal' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.sealVaultTransfer(b.passphrase)); }
  if (p === '/api/vault/open' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.openVaultTransfer(b.bundle, b.passphrase)); }
  if (p === '/api/vault/rotate' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.rotateVaultKeys(b)); }
  if (p === '/api/market') { P.seedMarket(); return json(res, 200, { ok: true, listings: P.marketList() }); }
  if (p === '/api/market/list' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.listItem(b.avatarId, b.itemId, b.price)); }
  if (p === '/api/market/delist' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.delist(b.listingId)); }
  if (p === '/api/market/buy' && req.method === 'POST') { const b = await body(req); return json(res, 200, P.buy(b.listingId, b.avatarId)); }
  if (p === '/api/economy/selftest') return json(res, 200, { ok: true, result: P.economySelfTest() });

  /* ── arena (unchanged) ── */
  if (p === '/api/races') return json(res, 200, { ok: true, races: arena.RACES });
  if (p === '/api/avatars' && req.method === 'GET') return json(res, 200, { ok: true, avatars: arena.list() });
  if (p === '/api/avatars' && req.method === 'POST') { const b = await body(req); return json(res, 200, arena.createAvatar(b.name, b.raceId)); }
  if (p === '/api/arena/history') return json(res, 200, { ok: true, battles: arena.history() });
  if (p === '/api/arena/opponent') return json(res, 200, arena.makeRival(url.searchParams.get('for')));
  if (p === '/api/arena/battle' && req.method === 'POST') { const b = await body(req); return json(res, 200, arena.battle(b.aId, b.bId, b.seed)); }
  if ((m = p.match(/^\/api\/avatars\/([^/]+)$/))) return json(res, 200, { ok: true, avatar: arena.get(m[1]) });
  if ((m = p.match(/^\/api\/avatars\/([^/]+)\/merge$/)) && req.method === 'POST') { const b = await body(req); return json(res, 200, arena.mergePieces(m[1], b.ids)); }
  if ((m = p.match(/^\/api\/avatars\/([^/]+)\/pets$/)) && req.method === 'POST') { return json(res, 200, arena.createPet(m[1])); }
  if ((m = p.match(/^\/api\/avatars\/([^/]+)\/pets\/merge$/)) && req.method === 'POST') { const b = await body(req); return json(res, 200, arena.mergePets(m[1], b.ids)); }
  if ((m = p.match(/^\/api\/avatars\/([^/]+)\/equip$/)) && req.method === 'POST') { const b = await body(req); return json(res, 200, arena.equip(m[1], b.itemId)); }
  if ((m = p.match(/^\/api\/avatars\/([^/]+)\/unequip$/)) && req.method === 'POST') { const b = await body(req); return json(res, 200, arena.unequip(m[1], b.slot)); }

  if (p === '/api/health') {
    return json(res, 200, { status: 'ok', product: 'LIAM', version: VERSION, mode: 'local', time: new Date().toISOString() });
  }

  /* ── static files ── */
  const file = p === '/' ? '/index.html' : p;
  const resolved = path.normalize(path.join(ROOT, file));
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(resolved, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

setInterval(() => { try { P.tickReminders(); P.tickSchedules(); } catch (e) {} }, 15000);

/* v1.98: the overseer's transport layer gets a live loopback probe once the
 * server is up; unbound is reported as WARN, never silently green. */
P.overseer.bindProbe(async () => new Promise(resolve => {
  http.get({ host: '127.0.0.1', port: PORT, path: '/' }, res => { res.resume(); resolve({ status: res.statusCode, headers: res.headers }); })
    .on('error', () => resolve({ status: 0, headers: {} }));
}));

server.listen(PORT, '0.0.0.0', () => console.log(`LIAM control centre listening on http://0.0.0.0:${PORT}`));
