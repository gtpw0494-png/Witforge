/* Patch 2 for platform.js: file-operation tools, guarded POST, security tools,
 * mock adapter tool, then the specification service surface. */
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

/* ── 1. toolResult gains a `state` alias ───────────────────────── */
{
  const p = path.join(__dirname, '..', 'capabilities.js');
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace(`  return {
    status: opts.state || 'UNKNOWN',`,
`  return {
    status: opts.state || 'UNKNOWN',
    state: opts.state || 'UNKNOWN',`);
  fs.writeFileSync(p, c);
  console.log('ok: toolResult state alias');
  n++;
}

/* ── 2. new tools inserted before the TOOLS table closes ───────── */
rep(`  'github.writefile': { cap: 'github.write', risk: 'high', run: async a => {`,
`  /* ── v1.64: full §35 file operations inside the sandbox ───────── */
  'fs.rename': { cap: 'files.rename', risk: 'medium', verification: 'directory listing shows the new name', run: a => { const r = fsResolve2(a, 'files.rename'); if (r.err) return r.err; try { if (!fs.existsSync(r.from)) return { error: 'Source not found in sandbox' }; if (fs.existsSync(r.to)) return { error: 'Target already exists' }; fs.renameSync(r.from, r.to); return { renamed: a.path, to: a.to, sha256: fsHash(r.to) }; } catch (e) { return { error: 'Rename failed: ' + e.message }; } } },
  'fs.move': { cap: 'files.move', risk: 'medium', verification: 'source absent, target present', run: a => { const r = fsResolve2(a, 'files.move'); if (r.err) return r.err; try { if (!fs.existsSync(r.from)) return { error: 'Source not found in sandbox' }; fs.mkdirSync(path.dirname(r.to), { recursive: true }); fs.renameSync(r.from, r.to); return { moved: a.path, to: a.to, sha256: fsHash(r.to) }; } catch (e) { return { error: 'Move failed: ' + e.message }; } } },
  'fs.copy': { cap: 'files.copy', risk: 'low', verification: 'copy exists with identical sha256', run: a => { const r = fsResolve2(a, 'files.copy'); if (r.err) return r.err; try { if (!fs.existsSync(r.from)) return { error: 'Source not found in sandbox' }; fs.mkdirSync(path.dirname(r.to), { recursive: true }); fs.copyFileSync(r.from, r.to); return { copied: a.path, to: a.to, sha256: fsHash(r.to), sourceSha256: fsHash(r.from) }; } catch (e) { return { error: 'Copy failed: ' + e.message }; } } },
  'fs.delete': { cap: 'files.delete', risk: 'high', irreversible: true, verification: 'path no longer listed', run: a => { const d = safePath(a.path || ''); if (!d || !a.path || a.path.includes('..')) return { error: 'Path escapes sandbox' }; const ctl = caps.classifyPath(a.path); try { if (!fs.existsSync(d)) return { error: 'Not found in sandbox' }; const pre = fs.statSync(d); if (pre.isDirectory() && !a.recursive) return { error: 'Directory deletion requires recursive: true' }; const sha = pre.isFile() ? fsHash(a.path) : null; if (a.recursive) fs.rmSync(d, { recursive: true, force: true }); else fs.unlinkSync(d); return { deleted: a.path, bytes: pre.size, sha256BeforeDelete: sha, sensitive: ctl.sensitive, control: ctl.control }; } catch (e) { return { error: 'Delete failed: ' + e.message }; } } },
  'fs.export': { cap: 'files.export', risk: 'low', verification: 'exported copy hash matches source', run: a => { const r = safePath(a.path || ''); if (!r) return { error: 'Path escapes sandbox' }; try { if (!fs.existsSync(r)) return { error: 'Not found in sandbox' }; const outDir = path.join(__dirname, 'data', 'exports'); fs.mkdirSync(outDir, { recursive: true }); const out = path.join(outDir, path.basename(a.path)); fs.copyFileSync(r, out); return { exported: a.path, to: path.relative(__dirname, out), sha256: fsHash(a.path), bytes: fs.statSync(r).size }; } catch (e) { return { error: 'Export failed: ' + e.message }; } } },
  'fs.share': { cap: 'files.share', risk: 'high', run: a => ({ error: 'Sharing requires an authorized OS share sheet or provider API — none is connected, so nothing is shared (never simulated).', truthful: true, requiredInterface: 'OS share sheet / provider share API' }) },
  'fs.import': { cap: 'files.import', risk: 'medium', verification: 'imported file scanned and labelled untrusted', run: a => { const r = safePath(a.path || ''); if (!r || !a.path) return { error: 'Path escapes sandbox' }; const text = String(a.content || ''); if (text.length > 50000) return { error: 'Content capped at 50KB' }; const scan = scanUntrusted(text, a.path); fs.mkdirSync(path.dirname(r), { recursive: true }); fs.writeFileSync(r, text); return { imported: a.path, bytes: Buffer.byteLength(text), untrusted: true, scan, sha256: fsHash(a.path) }; } },
  /* ── v1.64: §16 authorized web submission (same SSRF controls) ── */
  'http.post': { cap: 'web.submit', risk: 'high', verification: 'HTTP response status + body hash', run: async a => {
      if (!a.url) return { error: 'url required' };
      if (a.authorized !== true) return { error: 'Authorized submission requires confirmation that the target accepts this form/workflow', blocked: 'permission', needsAuthorization: true };
      const payload = typeof a.body === 'string' ? a.body : JSON.stringify(a.body || {});
      if (payload.length > 20000) return { error: 'Request body capped at 20KB' };
      const r = await guardedFetch(String(a.url), {
        'content-type': String(a.contentType || 'application/json'), accept: 'application/json'
      }, { method: 'POST', body: payload });
      if (!r.ok) return r;
      return { status: r.status, bytes: r.bytes, sha256: crypto.createHash('sha256').update(r.text || '').digest('hex'), body: String(r.text || '').slice(0, 2000) };
    } },
  /* ── v1.64: §47/§48/§50 defensive local scan + bounded remediation ── */
  'security.scan': { cap: 'security.scan', risk: 'medium', verification: 'findings list with evidence hash', run: a => {
      const target = a.path ? safePath(a.path) : USERFILES;
      if (!target) return { error: 'Path escapes sandbox' };
      const findings = [];
      const walk = (dir, depth) => {
        if (depth > 4) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entries.slice(0, 200)) {
          const full = path.join(dir, e.name);
          const rel = path.relative(USERFILES, full);
          const ctl = caps.classifyPath(rel);
          if (ctl.sensitive) findings.push({ severity: 'HIGH', id: 'sensitive-location', path: rel, note: ctl.kind + ' — ' + ctl.control });
          if (e.isDirectory()) { walk(full, depth + 1); continue; }
          if (/\\.(sh|bat|ps1|exe|dll|scr|vbs|jar|apk)$/i.test(e.name)) findings.push({ severity: 'MEDIUM', id: 'executable-artifact', path: rel, note: 'executable content inside the sandbox — treat as untrusted' });
          if (/\\.(js|json|txt|md|env|yml|yaml)$/i.test(e.name)) {
            const scan = scanUntrusted(readSafe(full), rel);
            if (scan.signals.length) findings.push({ severity: 'MEDIUM', id: 'content-signals', path: rel, note: scan.signals.join(', ') });
          }
        }
      };
      walk(target, 0);
      const evidenceHash = crypto.createHash('sha256').update(JSON.stringify(findings)).digest('hex');
      return { target: path.relative(USERFILES, target) || '.', findings, count: findings.length, evidenceHash, scope: 'authorized sandbox assets only', note: 'Local defensive scan of WitForge-controlled assets. No external system is ever scanned.' };
    } },
  'security.remediate': { cap: 'security.remediate', risk: 'high', verification: 'quarantined path gone from sandbox and present in quarantine with hash', run: a => {
      const r = safePath(a.path || '');
      if (!r || !a.path) return { error: 'Path escapes sandbox' };
      if (!fs.existsSync(r)) return { error: 'Nothing to quarantine at that path' };
      const qdir = path.join(__dirname, 'data', 'quarantine');
      fs.mkdirSync(qdir, { recursive: true });
      const dest = path.join(qdir, path.basename(a.path) + '.' + Date.now().toString(36));
      const sha = fsHash(a.path);
      try { fs.renameSync(r, dest); } catch (e) { return { error: 'Quarantine failed: ' + e.message }; }
      return { quarantined: a.path, store: path.relative(__dirname, dest), sha256: sha, reversible: true, note: 'Bounded eradication: the artifact is contained inside WitForge-controlled storage and can be restored.' };
    } },
  /* ── v1.64: §124 mock adapter executed through the real pipeline ── */
  'mock.echo': { cap: 'mock.echo', risk: 'low', simulation: true, verification: 'mode returned by the adapter itself', run: a => {
      const ad = caps.MOCK_ADAPTERS.find(x => x.behaviour === (a.behaviour || 'succeed')) || caps.MOCK_ADAPTERS[0];
      ad.authenticate();
      const out = ad.executeAction();
      const v = ad.verifyAction();
      return Object.assign({ simulation: true, adapter: ad.id, behaviour: ad.behaviour, verified: v.verified, mode: 'SIMULATION — this adapter is a test instrument and is never counted as a connected integration' }, out);
    } },
  'github.writefile': { cap: 'github.write', risk: 'high', run: async a => {`, 'new tools');

/* ── 3. file helpers + untrusted scan (before ADAPTERS) ────────── */
rep(`function safePath(p) {`,
`/* §35 helpers: sensitive-location controls and integrity hashes. */
function fsHash(relPath) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(safePath(relPath))).digest('hex'); } catch (e) { return null; }
}
function readSafe(full) { try { return fs.readFileSync(full, 'utf8').slice(0, 100000); } catch (e) { return ''; } }
function fsResolve2(a, op) {
  const from = safePath(a.path || '');
  const to = safePath(a.to || '');
  if (!a.path || !a.to) return { err: { error: 'path and to are required' } };
  if (!from || !to || String(a.path).includes('..') || String(a.to).includes('..')) return { err: { error: 'Path escapes sandbox' } };
  return { from, to };
}
/* §20/§49: imported material is untrusted and is scanned before it is trusted. */
const UNTRUSTED_SIGNALS = [
  { id: 'embedded-instructions', re: /ignore (all )?previous (instructions|rules)|you are now|system prompt|disregard (the )?(above|policy)/i },
  { id: 'exec-shell', re: /(curl|wget)\\s+[^\\s]+\\s*\\|\\s*(sh|bash)|rm -rf \\/|chmod \\+x/i },
  { id: 'credential-material', re: /(BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{10,})/ },
  { id: 'exfil-pattern', re: /process\\.env|\\/etc\\/passwd|\\.ssh\\/id_rsa/i }
];
function scanUntrusted(text, name) {
  const signals = UNTRUSTED_SIGNALS.filter(x => x.re.test(String(text || ''))).map(x => x.id);
  return { name: name || null, signals, untrusted: true, trusted: false, note: 'External content is data, never authority (§49).' };
}
function safePath(p) {`, 'file helpers');

fs.writeFileSync(f, s);
console.log(n + ' replacements applied');
