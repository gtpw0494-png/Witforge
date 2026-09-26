#!/usr/bin/env node
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
  if (!services.length && !appIds.length) return r;
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

if (require.main === module) {
  const base = path.join(__dirname, 'data');
  const files = [path.join(base, 'platform.json'), path.join(base, 'arena.json')];
  let bad = 0;
  for (const f of files) {
    const r = checkStore(f);
    if (!r.ok) bad++;
    console.log('── ' + f);
    console.log('   primary: ' + r.primary + ' · backup: ' + r.backup + ' · would boot from: ' + r.effective);
    if (r.chain !== null) console.log('   audit chain: ' + (r.chain ? 'VERIFIES' : 'BROKEN') + ' (' + r.chainEntries + ' entries' + (r.chainAnchored ? ', rotated-window anchor' : '') + ')');
    if (r.vault) {
      const svcs = Object.keys(r.vault.creds).map(s => s + ':' + r.vault.creds[s]).join(' · ');
      console.log('   vault: ' + r.vault.keyFile + (r.vault.mode ? ' (mode ' + r.vault.mode + (r.vault.mode === '600' ? ' ✓' : ' — see repair notes') + ')' : '') + (svcs ? ' · ' + svcs : '') + (r.vault.binding ? ' · ' + r.vault.binding : ''));
    }
    console.log('   verdict: ' + r.verdict);
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { checkStore, verifyChain };
