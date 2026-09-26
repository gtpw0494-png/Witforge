/* Integration smoke test: boots the real server on a test port with isolated
 * data dirs, loads app.js against a DOM stub whose fetch hits that server,
 * and exercises every view, chat commands, tools, permissions, approvals. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 5199;
const BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liam-smoke-'));

function makeEl() {
  return {
    innerHTML: '', textContent: '', hidden: false, value: '', disabled: false,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    dataset: {}, children: [],
    addEventListener() {}, onclick: null, onchange: null, oninput: null,
    scrollIntoView() {}, focus() {}, appendChild() {}, remove() {}, click() {},
    insertAdjacentHTML() {}, style: {}
  };
}
const els = {};
const q = s => (els[s] = els[s] || makeEl());
let domReady = null;
global.document = {
  querySelector: q,
  addEventListener: (t, f) => { if (t === 'DOMContentLoaded') domReady = f; },
  createElement: () => makeEl(),
  head: makeEl(), body: makeEl()
};
global.window = { addEventListener() {}, innerWidth: 1280, scrollTo() {} };
/* Node 21+ exposes navigator as a getter-only global. Define the test stub
 * explicitly so the smoke harness remains portable across supported Node
 * runtimes without requiring --no-experimental-global-navigator. */
Object.defineProperty(global, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true
});
global.localStorage = { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } };
global.location = { reload() {} };

const realFetch = global.fetch;
global.fetch = (p, opts) => realFetch(String(p).startsWith('http') ? p : BASE + p, opts);

const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: Object.assign({}, process.env, { PORT: String(PORT), PLATFORM_DATA: path.join(tmp, 'p.json'), ARENA_DATA: path.join(tmp, 'a.json'), WITFORGE_DEVICE_KEY: path.join(tmp, 'device-key'), WITFORGE_OWNER_EMAIL: 'smoke-owner@example.com' })
});

const driver = `
;(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // wait for server health
  for (let i = 0; i < 40; i++) { try { const r = await fetch('/api/health'); if (r.ok) break; } catch (e) {} await sleep(250); }
  domReady();
  await sleep(300);
  let checks = 0, fails = 0;
  const ok = (c, l) => { checks++; if (!c) { fails++; console.error('FAIL: ' + l); } else console.log('ok  : ' + l); };

  for (const mod of MODULES) {
    await setView(mod.id, { silent: true });
    await sleep(60);
    ok($('#main').innerHTML.includes(mod.label), 'view renders: ' + mod.id);
  }
  // facets on a non-live module
  setView('research', { silent: true }); await sleep(60);
  openFacet('research', 'overview'); ok($('#facetBody').innerHTML.length > 0, 'facet research/overview');

  // chat: UI intent
  await setView('chat', { silent: true });
  $('#chatInput').value = 'open tasks'; sendChat(); await sleep(500);
  ok(currentView === 'tasks', 'chat UI intent navigates');

  // chat: platform command creates a task
  await setView('chat', { silent: true });
  $('#chatInput').value = 'create task smoke-task'; sendChat(); await sleep(400);
  const st1 = await (await fetch('/api/state')).json();
  ok(st1.tasks.some(t => t.text === 'smoke-task'), 'chat platform command creates task');

  // chat: tool execution grants permission by request
  $('#chatInput').value = 'run date'; sendChat(); await sleep(400);
  const st2 = await (await fetch('/api/state')).json();
  ok(st2.permissions['exec.run'], 'request grants medium-risk permission (audited)');

  // chat: lockdown queues approval; approving engages it; then reset
  $('#chatInput').value = 'lockdown'; sendChat(); await sleep(400);
  const st3 = await (await fetch('/api/state')).json();
  const pend = st3.approvals.find(a => a.status === 'pending' && a.cap === 'security.emergency');
  ok(!!pend, 'lockdown without confirmation queues approval');
  if (pend) {
    $('#chatInput').value = 'approve ' + pend.id; sendChat(); await sleep(300);
    $('#chatInput').value = 'lockdown confirm'; sendChat(); await sleep(300);
    const st4 = await (await fetch('/api/state')).json();
    ok(st4.emergency === 'LOCKDOWN', 'explicit confirmation engages LOCKDOWN');
    // execution blocked during lockdown
    const blocked = await (await fetch('/api/tools/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'exec.run', args: { op: 'date' } }) })).json();
    ok(blocked.blocked === 'lockdown', 'LOCKDOWN blocks medium-risk execution');
    $('#chatInput').value = 'set emergency NORMAL'; sendChat(); await sleep(300);
  }

  // SSRF guard
  const ssrf = await (await fetch('/api/tools/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'http.get', args: { url: 'http://127.0.0.1:9999/' } }) })).json();
  ok(ssrf.evidence && ssrf.evidence.blocked === 'ssrf', 'SSRF: loopback blocked');

  // economy selftest via chat
  $('#chatInput').value = 'economy selftest'; sendChat(); await sleep(400);
  const st5 = await (await fetch('/api/state')).json();
  ok(st5.ledger.tx.length > 0, 'economy ledger has simulation transactions');

  // v1.66 regression: the chat route must await the async command — a missing
  // await serialized the Promise as {} and ate every reply over HTTP.
  const chatReply = await (await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'human steps' }) })).json();
  ok(chatReply.ok === true && typeof chatReply.reply === 'string' && chatReply.reply.length > 0, 'chat over HTTP returns a real reply (awaited command), not {}');
  const hitlRun = await (await fetch('/api/tools/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'mock.echo', args: { behaviour: 'needs-human' } }) })).json();
  ok(hitlRun.state === 'WAITING_FOR_HUMAN' && hitlRun.needsHuman, 'HTTP tool run pauses at a human gate');
  const hitlRes = await (await fetch('/api/human-steps/' + hitlRun.needsHuman + '/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'zz7' }) })).json();
  ok(hitlRes.ok === true, 'HTTP human-step resolve works');
  const hitlRun2 = await (await fetch('/api/tools/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'mock.echo', args: { behaviour: 'needs-human' } }) })).json();
  ok(hitlRun2.state === 'SUCCEEDED' && hitlRun2.result && hitlRun2.result.humanProvided === 'zz7', 'resolved answer is consumed exactly once over HTTP');

  // v2.04 security perimeter: source, state and vault material are never
  // static assets; once an Owner exists, private reads require its session.
  const sourceLeak = await fetch('/server.js');
  ok(sourceLeak.status === 404, 'static perimeter denies server source');
  const dataLeak = await fetch('/data/p.json');
  ok(dataLeak.status === 404, 'static perimeter denies platform state');
  const keyLeak = await fetch('/data/p.json.vault-key');
  ok(keyLeak.status === 404, 'static perimeter denies vault key material');
  const ownerCreate = await (await fetch('/api/auth/owner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Smoke Owner', email: 'smoke-owner@example.com', password: 'smoke-owner-password' }) })).json();
  ok(ownerCreate.ok === true, 'first Owner is created locally with configured email binding');
  const privateState = await fetch('/api/state');
  ok(privateState.status === 401, 'private GET state requires an authenticated Owner session');
  const publicHealth = await fetch('/api/health');
  ok(publicHealth.status === 200, 'public health remains available without a session');

  // palette
  openPalette(); $('#paletteInput').value = 'sec'; paintPalette();
  ok(paletteItems.some(i => i.label === 'Security'), 'palette ranks Security');

  console.log(checks + ' checks completed, ' + fails + ' failures.');
  process.exit(fails ? 1 : 0);
})();
`;

eval(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8') + driver);

process.on('exit', () => { server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
