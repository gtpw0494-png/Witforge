/* lint.js — the documented `npm run lint` step.
 *
 * WitForge has no runtime dependencies, so it also has no ESLint toolchain;
 * installing one just to lint would add the supply-chain surface the project
 * deliberately avoids. This is a small, deterministic checker for the rules
 * that actually matter in this codebase:
 *
 *   1. strict mode in every module;
 *   2. no dynamic evaluation (eval / new Function) anywhere;
 *   3. no shell interpolation into child_process (exec/execSync banned);
 *   4. no secret-looking literals committed to source;
 *   5. no localStorage use in server-side modules (authority must stay a
 *      server-side concern — the browser may only keep a local mirror);
 *   6. balanced module.exports and no stray debug logging in shipped files.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SERVER_FILES = ['server.js', 'llm.js', 'oauth.js', 'httpguard.js', 'oauth-server.js', 'vault.js', 'connectors.js', 'brain.js', 'piece-art.js', 'overseer.js', 'action-fabric.js', 'device-adapters.js', 'platform.js', 'kernel.js', 'capabilities.js', 'task-engine.js', 'platform-services.js', 'arena-engine.js', 'races.js', 'spec-coverage.js', 'engagement.js', 'owner-security.js'];
const ALL_FILES = SERVER_FILES.concat(['app.js', 'build.js', 'lint.js', 'spec-test.js', 'adversarial-test.js', 'platform-test.js', 'arena-test.js', 'engagement-test.js', 'smoke-test.js']);

const findings = [];
const add = (file, line, rule, detail) => findings.push({ file, line, rule, detail });

for (const f of ALL_FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const lines = src.split('\n');
  const isTest = /-test\.js$/.test(f);          // tests deliberately contain hostile payloads
  const isLint = f === 'lint.js';
  const isServer = SERVER_FILES.includes(f);

  const head = src.split('\n').slice(0, 20).join('\n');
  if (!/['"]use strict['"];/.test(head)) add(f, 1, 'strict-mode', 'module does not declare strict mode near the top');

  lines.forEach((ln, i) => {
    const n = i + 1;
    if (!isLint && !isTest && /\beval\s*\(|new\s+Function\s*\(/.test(ln)) add(f, n, 'no-eval', 'dynamic code evaluation is banned');
    if (!isTest && !isLint && /child_process[^\n]*\.(exec|execSync)\b/.test(ln)) add(f, n, 'no-shell-interpolation', 'use execFile/spawn with an argument array; never a shell string');
    if (isServer && /localStorage/.test(ln) && !/local mirror/i.test(ln)) add(f, n, 'server-authority', 'server-side modules must not read browser storage');
    if (!isTest && /(sk_live_[A-Za-z0-9]{6,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,})/.test(ln)) add(f, n, 'no-committed-secrets', 'a live-looking credential literal is present');
    const serverEntryLog = f === 'server.js' && n > src.split('\n').length - 5;   // the startup banner is the server's own log
    if (!isTest && !isLint && f !== 'build.js' && !serverEntryLog && !/^\s*\*/.test(ln) && /console\.log\(/.test(ln)) add(f, n, 'no-stray-logging', 'shipped modules log to stdout only through the server');
  });

  /* server.js is the entry point and legitimately exports nothing. */
  if (isServer && f !== 'server.js' && !/module\.exports/.test(src)) add(f, 1, 'module-surface', 'server module exports nothing');
}

if (findings.length) {
  console.error('WitForge lint — ' + findings.length + ' finding(s):');
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.detail}`);
  process.exit(1);
}
console.log('WitForge lint — clean across ' + ALL_FILES.length + ' files (' + SERVER_FILES.length + ' server modules, ' + (ALL_FILES.length - SERVER_FILES.length) + ' client/test files).');
console.log('Rules: strict-mode · no-eval · no-shell-interpolation · server-authority · no-committed-secrets · no-stray-logging · module-surface');
