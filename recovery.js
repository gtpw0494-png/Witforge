#!/usr/bin/env node
'use strict';
/* LIAM recovery console (v1.80.0) — read-only health check for every
 * persisted store. A health checker must be side-effect-free: this module
 * never boots the platform, never writes a byte. It verifies what the
 * platform itself verifies, from the outside:
 *
 *   primary store:  VALID | CORRUPT | MISSING
 *   .bak snapshot:  VALID | CORRUPT | MISSING
 *   effective:      which copy the platform would boot from (a store that
 *                   was never created says so — that is not damage)
 *   audit chain:    tamper-evident verification incl. v1.79.1 chain anchors
 *   vault:          key file presence + perms (octal, reported as data —
 *                   sandboxed hosts may normalize modes on restore; a note
 *                   is issued, not a false alarm); each stored credential
 *                   decrypt tested and reported ONLY as DECRYPTS / FAIL —
 *                   secrets are never printed, logged or returned.
 *
 * CLI:      node recovery.js            (checks the default data/ stores)
 * Library:  require('./recovery.js').checkStore(file)
 *
 * Zero dependencies. Standard Node only.
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function readJson(file) {
  try { return { json: JSON.parse(fs.readFileSync(file, 'utf8')), state: 'VALID' }; }
  catch (e) { return { json: null, state: fs.existsSync(file) ? 'CORRUPT' : 'MISSING', error: String(e.message || e) }; }
}

/* Mirror of platform.js verifyAudit() — same fields, same anchors, no state. */
function verifyChain(audit) {
  if (!Array.isArray(audit)) return { ok: false, reason: 'not an array' };
  const oldest = audit.length - 1;
  let prev = (oldest >= 0 && audit[oldest].chainAnchor) ? audit[oldest].chainAnchor : 'GENESIS';
  for (let i = oldest; i >= 0; i--) {
    const e = audit[i];
    if (sha(prev + '|' + e.ts + '|' + e.type + '|' + e.detail + '|' + e.actor) !== e.hash) return { ok: false, brokenAt: e.ts, index: i };
    prev = e.hash;
  }
  return { ok: true, entries: audit.length, anchored: oldest >= 0 && !!audit[oldest].chainAnchor };
}

/* Decrypt every stored credential with the separated vault key — reporting
 * outcomes only. A credential that cannot decrypt is reported FAIL, never
 * "probably fine", and never even partially revealed. */
function checkVault(file, state) {
  const r = { keyFile: 'MISSING', mode: null, creds: {}, appSecrets: {} };
  const creds = (state && state.creds) || {};
  const apps = (state && state.oauthApps) || {};
  const services = Object.keys(creds);
  const appIds = Object.keys(apps).filter(id => apps[id] && apps[id].clientSecret);
  if (!services.length && !appIds.length) {
    try {
      if (fs.existsSync(file + '.vault-key')) {
        r.keyFile = 'PRESENT';
        r.mode = (fs.statSync(file + '.vault-key').mode & 0o777).toString(8);
      } else r.keyFile = 'NOT-NEEDED';
    } catch (e) { r.keyFile = 'NOT-NEEDED'; }
    return r;
  }
  let secret;
  try {
    secret = String(fs.readFileSync(file + '.vault-key', 'utf8')).trim();
    r.keyFile = 'PRESENT';
    /* truth in octal: the mode is REPORTED, not assumed. On sandboxed hosts
     * whose persistence layer normalizes permissions (observed: 0600 raised
     * to 0644 on restore), the number is data — not a fault of the store. */
    r.mode = (fs.statSync(file + '.vault-key').mode & 0o777).toString(8);
  } catch (e) { return r; }
  const keyV1 = Buffer.from(sha(secret), 'hex');
  /* v1.85 device-binding: v2 records are sealed under HKDF(vault, pepper)
   * where the pepper lives outside the project folder. The console reads
   * it from the same device path (overridable for tests) and says plainly
   * which binding each store uses. */
  const DEVICE_FILE = process.env.WITFORGE_DEVICE_KEY ? path.resolve(process.env.WITFORGE_DEVICE_KEY) : path.join(os.homedir(), '.witforge', 'device-key');
  let pepper;
  const keyV2 = () => {
    if (pepper === undefined) { try { pepper = String(fs.readFileSync(DEVICE_FILE, 'utf8')).trim(); } catch (e) { pepper = ''; } }
    return pepper ? Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(pepper, 'utf8'), 'witforge-vault-v2', 32)) : null;
  };
  const tryUnseal = blob => {
    const key = blob && blob.v === 2 ? keyV2() : keyV1;
    if (!key) return 'FAIL — device pepper missing (' + DEVICE_FILE + ')';
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
      d.setAuthTag(Buffer.from(blob.tag, 'hex'));
      d.update(Buffer.from(blob.data, 'hex')); d.final();
      return 'DECRYPTS';
    } catch (e) { return 'FAIL — must be re-entered'; }
  };
  for (const svc of services) r.creds[svc] = tryUnseal(creds[svc]);
  for (const id of appIds) r.appSecrets[id] = tryUnseal(apps[id].clientSecret);
  r.binding = [].concat(services.map(s => creds[s]), appIds.map(id => apps[id].clientSecret)).some(b => b && b.v === 2) ? 'device-bound v2 (folder copies decrypt nothing)' : 'v1 (folder-copyable)';
  return r;
}

function checkStore(file) {
  const f = path.resolve(file);
  const p = readJson(f);
  const b = readJson(f + '.bak');
  const sample = p.json || b.json;
  const chain = sample && sample.audit ? verifyChain(sample.audit) : null;
  const vault = sample ? checkVault(f, sample) : null;
  if (p.state === 'MISSING' && b.state === 'MISSING') {
    /* a store that was never created (e.g. arena before the first avatar on
     * a fresh install) is not damage — call it what it is. */
    return { file: f, primary: p.state, backup: b.state, effective: 'NONE-CREATED-YET', chain: null, chainEntries: 0, chainAnchored: null, vault, needsRepair: false, decryptFails: 0, ok: true, notCreated: true, verdict: 'NOT CREATED YET — minted on first real use' };
  }
  if (!sample) {
    return { file: f, primary: p.state, backup: b.state, effective: 'NONE', chain: null, chainEntries: 0, chainAnchored: null, vault, needsRepair: true, decryptFails: 0, ok: false, repairNotes: ['both primary and snapshot are unreadable — restore from an external backup, or accept a fresh state'], verdict: 'ACTION REQUIRED — nothing bootable survives' };
  }
  const effective = p.json ? 'PRIMARY' : 'BACKUP';
  const decryptFails = vault ? [].concat(Object.values(vault.creds), Object.values(vault.appSecrets)).filter(v => v !== 'DECRYPTS').length : 0;
  const notes = [];
  if (p.state === 'CORRUPT') notes.push('replace the damaged primary from the snapshot');
  if (p.json && chain && !chain.ok) notes.push('audit chain BROKEN at an entry — investigate tamper before trusting history');
  if (vault && vault.keyFile === 'PRESENT' && vault.mode !== '600') notes.push('vault key mode is ' + (vault.mode || '?') + ' — owner-only (600) is required on multi-user systems: chmod 600 "' + f + '.vault-key"');
  if (vault && vault.keyFile === 'MISSING') notes.push('vault key file MISSING — stored credentials are undecryptable and must be re-entered');
  if (decryptFails) notes.push(decryptFails + ' credential(s) failed to decrypt — re-enter via their connect commands');
  return {
    file: f, primary: p.state, backup: b.state, effective,
    chain: chain ? chain.ok : null, chainEntries: chain ? chain.entries : 0, chainAnchored: chain ? !!chain.anchored : null,
    vault, needsRepair: notes.length > 0, repairNotes: notes, decryptFails,
    ok: true,
    verdict: notes.length ? 'HEALTHY — repair notes: ' + notes.join('; ') : 'HEALTHY',
  };
}

/* v2.07 SQLite/WAL recovery is read-only too. Each envelope carries its own
 * SHA-256, and SQLite's quick_check independently grades the database pages.
 * The previous valid envelope remains in platform_state_backup. */
function sqliteApi() {
  try {
    const api = require('node:sqlite');
    return typeof api.DatabaseSync === 'function' ? api : null;
  } catch (e) { return null; }
}

function sqliteEnvelope(row) {
  if (!row) return { state: 'MISSING', json: null, reason: null };
  if (sha(row.payload) !== row.payload_sha256) return { state: 'CORRUPT', json: null, reason: 'payload SHA-256 mismatch' };
  try {
    const json = JSON.parse(row.payload);
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('state is not an object');
    return { state: 'VALID', json, reason: null };
  } catch (e) { return { state: 'CORRUPT', json: null, reason: String(e.message || e) }; }
}

function checkSqliteStore(file, opts) {
  opts = opts || {};
  const f = path.resolve(file);
  if (!fs.existsSync(f)) {
    return { file: f, kind: 'sqlite', primary: 'MISSING', backup: 'MISSING', effective: 'NONE-CREATED-YET', chain: null, chainEntries: 0, chainAnchored: null, vault: null, sqlite: 'MISSING', journalMode: null, needsRepair: false, decryptFails: 0, ok: true, notCreated: true, verdict: 'NOT CREATED YET — minted on first real use' };
  }
  const api = sqliteApi();
  if (!api) {
    return { file: f, kind: 'sqlite', primary: 'UNSUPPORTED', backup: 'UNKNOWN', effective: 'NONE', chain: null, chainEntries: 0, chainAnchored: null, vault: null, sqlite: 'NOT CHECKED', journalMode: null, needsRepair: true, decryptFails: 0, ok: false, repairNotes: ['use Node 22.5 or newer to inspect the built-in SQLite store'], verdict: 'ACTION REQUIRED — this Node runtime has no node:sqlite' };
  }
  let db;
  try {
    db = new api.DatabaseSync(f, { readOnly: true });
    const quickRow = db.prepare('PRAGMA quick_check').get();
    const quick = quickRow && String(Object.values(quickRow)[0]);
    const journalRow = db.prepare('PRAGMA journal_mode').get();
    const journalMode = String((journalRow && Object.values(journalRow)[0]) || '').toLowerCase();
    const modes = {};
    for (const candidate of [f, f + '-wal', f + '-shm']) {
      if (fs.existsSync(candidate)) modes[path.basename(candidate)] = (fs.statSync(candidate).mode & 0o777).toString(8);
    }
    const primaryRow = db.prepare('SELECT payload,payload_sha256,revision,updated_at FROM platform_state WHERE id=1').get();
    const backupRow = db.prepare('SELECT payload,payload_sha256,revision,updated_at FROM platform_state_backup WHERE id=1').get();
    const p = sqliteEnvelope(primaryRow);
    const b = sqliteEnvelope(backupRow);
    const sample = p.json || b.json;
    const chain = sample && sample.audit ? verifyChain(sample.audit) : null;
    const vaultBase = path.resolve(opts.vaultBase || f);
    const vault = sample ? checkVault(vaultBase, sample) : null;
    const decryptFails = vault ? [].concat(Object.values(vault.creds), Object.values(vault.appSecrets)).filter(v => v !== 'DECRYPTS').length : 0;
    const notes = [];
    if (quick !== 'ok') notes.push('SQLite quick_check failed: ' + quick);
    if (journalMode !== 'wal') notes.push('journal mode is ' + journalMode + ', expected wal');
    const broadModes = Object.entries(modes).filter(([, mode]) => mode !== '600');
    if (broadModes.length) notes.push('SQLite files are not owner-only: ' + broadModes.map(([name, mode]) => name + '=' + mode).join(', ') + ' (expected 600)');
    if (p.state === 'CORRUPT' && b.state === 'VALID') notes.push('primary envelope is damaged; rewrite it from the last-good envelope');
    if (p.state !== 'VALID' && b.state !== 'VALID') notes.push('no valid state envelope survives — restore an external backup');
    if (p.json && chain && !chain.ok) notes.push('audit chain BROKEN at an entry — investigate tamper before trusting history');
    if (vault && vault.keyFile === 'PRESENT' && vault.mode !== '600') notes.push('vault key mode is ' + (vault.mode || '?') + ' — owner-only (600) is required on multi-user systems: chmod 600 "' + vaultBase + '.vault-key"');
    if (vault && vault.keyFile === 'MISSING') notes.push('vault key file MISSING — stored credentials are undecryptable and must be re-entered');
    if (decryptFails) notes.push(decryptFails + ' credential(s) failed to decrypt — re-enter via their connect commands');
    const usable = p.state === 'VALID' || b.state === 'VALID';
    return {
      file: f, kind: 'sqlite', primary: p.state, backup: b.state,
      effective: p.state === 'VALID' ? 'PRIMARY' : (b.state === 'VALID' ? 'BACKUP' : 'NONE'),
      revision: Number((p.state === 'VALID' ? primaryRow : backupRow || {}).revision) || 0,
      chain: chain ? chain.ok : null, chainEntries: chain ? chain.entries : 0, chainAnchored: chain ? !!chain.anchored : null,
      vault, sqlite: quick, journalMode, modes, needsRepair: notes.length > 0, repairNotes: notes, decryptFails,
      ok: quick === 'ok' && usable,
      verdict: quick === 'ok' && usable ? (notes.length ? 'HEALTHY — repair notes: ' + notes.join('; ') : 'HEALTHY') : 'ACTION REQUIRED — ' + notes.join('; ')
    };
  } catch (e) {
    return { file: f, kind: 'sqlite', primary: 'CORRUPT', backup: 'UNKNOWN', effective: 'NONE', chain: null, chainEntries: 0, chainAnchored: null, vault: null, sqlite: 'FAIL', journalMode: null, needsRepair: true, decryptFails: 0, ok: false, repairNotes: [String(e.message || e)], verdict: 'ACTION REQUIRED — SQLite store could not be read: ' + String(e.message || e) };
  } finally {
    if (db) try { db.close(); } catch (e) { /* read-only checker: nothing to recover on close */ }
  }
}

if (require.main === module) {
  const base = path.join(__dirname, 'data');
  const platformDb = path.join(base, 'platform.db');
  const files = [
    fs.existsSync(platformDb)
      ? { file: platformDb, check: () => checkSqliteStore(platformDb, { vaultBase: path.join(base, 'platform.json') }) }
      : { file: path.join(base, 'platform.json'), check: () => checkStore(path.join(base, 'platform.json')) },
    { file: path.join(base, 'arena.json'), check: () => checkStore(path.join(base, 'arena.json')) }
  ];
  let bad = 0;
  for (const target of files) {
    const r = target.check();
    if (!r.ok) bad++;
    console.log('── ' + target.file);
    console.log('   primary: ' + r.primary + ' · backup: ' + r.backup + ' · would boot from: ' + r.effective);
    if (r.kind === 'sqlite') console.log('   sqlite: ' + r.sqlite + ' · journal: ' + (r.journalMode || 'unknown') + ' · revision: ' + (r.revision || 0) + ' · modes: ' + JSON.stringify(r.modes || {}));
    if (r.chain !== null) console.log('   audit chain: ' + (r.chain ? 'VERIFIES' : 'BROKEN') + ' (' + r.chainEntries + ' entries' + (r.chainAnchored ? ', rotated-window anchor' : '') + ')');
    if (r.vault) {
      const svcs = Object.keys(r.vault.creds).map(s => s + ':' + r.vault.creds[s]).join(' · ');
      console.log('   vault: ' + r.vault.keyFile + (r.vault.mode ? ' (mode ' + r.vault.mode + (r.vault.mode === '600' ? ' ✓' : ' — see repair notes') + ')' : '') + (svcs ? ' · ' + svcs : '') + (r.vault.binding ? ' · ' + r.vault.binding : ''));
    }
    console.log('   verdict: ' + r.verdict);
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { checkStore, checkSqliteStore, verifyChain };
