/* build.js — the documented `npm run build` step.
 *
 * WitForge ships no bundler and no runtime dependencies: the browser surface is
 * loaded as plain modules over HTTP by the local server. A "build" therefore
 * means what it should mean here — prove that every shipped source file is
 * syntactically valid, that the version identifiers agree across the tree, and
 * that the required product surfaces exist. It fails loudly rather than
 * pretending to compile something that was never compiled.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const CODE = ['server.js', 'platform.js', 'storage.js', 'recovery.js', 'kernel.js', 'capabilities.js', 'task-engine.js', 'platform-services.js', 'arena-engine.js', 'races.js', 'spec-coverage.js', 'app.js', 'llm.js', 'oauth.js', 'httpguard.js', 'oauth-server.js', 'vault.js', 'connectors.js', 'brain.js', 'piece-art.js', 'overseer.js', 'action-fabric.js', 'device-adapters.js'];
const TESTS = ['spec-test.js', 'storage-test.js', 'adversarial-test.js', 'platform-test.js', 'arena-test.js', 'engagement-test.js', 'smoke-test.js'];
const REQUIRED = ['index.html', 'styles.css', 'README.md', 'STATUS.md', 'INSTALL.md', 'package.json', 'spec-coverage.js'];

let problems = 0;
const step = (name, fn) => {
  const before = problems;
  try { fn(); } catch (e) { console.error('  ✗ ' + name + ': ' + e.message); problems++; }
  if (problems === before) console.log('  ✓ ' + name);
};

console.log('WitForge build — validation pass (no bundler, zero dependencies)');

step('every source file parses under this Node runtime', () => {
  for (const f of CODE.concat(TESTS)) {
    if (!fs.existsSync(path.join(ROOT, f))) throw new Error('missing source file ' + f);
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(f + ' failed syntax check: ' + (r.stderr || '').split('\n')[0]);
  }
});

step('required product surfaces are present', () => {
  const missing = REQUIRED.filter(f => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) throw new Error('missing ' + missing.join(', '));
});

step('version identifiers agree across the tree', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const platform = /VERSION\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'platform.js'), 'utf8'));
  const coverage = /version:\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'spec-coverage.js'), 'utf8'));
  if (!platform) throw new Error('platform.js declares no VERSION');
  if (platform[1] !== pkg.version) throw new Error('package.json ' + pkg.version + ' ≠ platform.js ' + platform[1]);
  if (coverage && coverage[1] !== pkg.version) throw new Error('spec-coverage.js ' + coverage[1] + ' ≠ package.json ' + pkg.version);
});

step('the specification registry covers the 168 master sections + 9 additive platform requirements', () => {
  delete require.cache[require.resolve(path.join(ROOT, 'spec-coverage.js'))];
  const cov = require(path.join(ROOT, 'spec-coverage.js'));
  const rows = cov.SECTIONS || cov;
  if (rows.length !== 177) throw new Error('registry has ' + rows.length + ' sections, expected 177');
  const bad = rows.filter(r => !['LIVE', 'PARTIAL', 'EXTERNAL', 'LOCKED', 'POLICY'].includes(r.status));
  if (bad.length) throw new Error('unknown status on §' + bad.map(b => b.n).join(', §'));
});

step('no shipping file contains an obvious placeholder stub', () => {
  const suspects = [];
  for (const f of CODE) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/\b(TODO|FIXME|not implemented yet|coming soon)\b/i.test(src.replace(/§\s?/g, ''))) suspects.push(f);
  }
  if (suspects.length) throw new Error('placeholder text found in ' + suspects.join(', '));
});

console.log(problems === 0 ? '\nbuild passed' : '\nbuild FAILED with ' + problems + ' problem(s)');
process.exit(problems === 0 ? 0 : 1);
