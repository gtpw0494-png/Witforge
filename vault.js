/* LIAM credential vault (v1.83.0 — extracted from platform.js). */
'use strict';
/* Secrets broker: everything sensitive-at-rest lives behind this module.
 *
 *   AES-256-GCM under keys derived from TWO independent secrets stored in
 *   two different places: <store>.vault-key beside the data (chmod 0600 —
 *   re-asserted at every boot, because sandbox/CI restore layers have
 *   normalized it before) and, when the host injects deviceFile, a
 *   device-only pepper living OUTSIDE the project folder (default
 *   ~/.witforge/device-key, minted 0600). v2 ciphertexts (record.v === 2)
 *   are sealed under HKDF-SHA256(vault-key, device-pepper), so copying the
 *   project folder — a zip, an accidental cloud-sync, a mirror clone —
 *   yields ciphertext that decrypts nothing, anywhere.
 *
 *   Honest limit (stated, never hidden): a whole-disk image of this
 *   machine still holds both halves; binding to the OS keychain stays the
 *   legitimate next step, deferred because it needs a native dependency
 *   and WitForge is zero-dependency by charter.
 *
 * The module owns no platform state: the host injects getState() / save /
 * audit, so the vault is fully dry-testable against an isolated key file.
 * Tokens are write-only — listCreds returns services + timestamps, never
 * material; decryptToken/decryptRec are the only unseals, and callers are
 * audited by the platform, not this module.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function create(deps) {
  deps = deps || {};
  const DATA_FILE = String(deps.dataFile || './data/platform.json');
  const VAULT_KEY_FILE = DATA_FILE + '.vault-key';
  const DEVICE_KEY_FILE = deps.deviceFile ? String(deps.deviceFile) : null;
  let VAULT_SECRET = null;
  let DEVICE_SECRET = null;
  const S = () => (typeof deps.getState === 'function' ? (deps.getState() || {}) : (deps.state || {}));
  const save = typeof deps.save === 'function' ? deps.save : () => {};
  const audit = typeof deps.audit === 'function' ? deps.audit : () => {};

  function vaultSecret() {
    if (VAULT_SECRET) return VAULT_SECRET;
    try {
      const v = String(fs.readFileSync(VAULT_KEY_FILE, 'utf8')).trim();
      /* v1.80.1: every access re-asserts owner-only mode — persistence
       * layers that normalized permissions (0644 observed) cannot weaken
       * the key. */
      try { fs.chmodSync(VAULT_KEY_FILE, 0o600); } catch (e) { /* best-effort */ }
      if (/^[0-9a-f]{32,128}$/.test(v)) { VAULT_SECRET = v; return VAULT_SECRET; }
    } catch (e) { /* first boot or migration — generated below */ }
    VAULT_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(VAULT_KEY_FILE, VAULT_SECRET, { mode: 0o600 });
    try { fs.chmodSync(VAULT_KEY_FILE, 0o600); } catch (e) { /* umasks and restore layers are not trusted to keep it */ }
    return VAULT_SECRET;
  }
  function credKey() { return crypto.createHash('sha256').update(vaultSecret()).digest(); }

  /* v1.85 device-binding: a second secret that never lives beside the data.
   * Same discipline as the vault key — minted 0600, mode re-asserted on
   * every read, hex shape enforced, parent dir owner-only. */
  function deviceSecret() {
    if (!DEVICE_KEY_FILE) return null;
    if (DEVICE_SECRET) return DEVICE_SECRET;
    try {
      const v = String(fs.readFileSync(DEVICE_KEY_FILE, 'utf8')).trim();
      try { fs.chmodSync(DEVICE_KEY_FILE, 0o600); } catch (e) { /* best-effort */ }
      if (/^[0-9a-f]{32,128}$/.test(v)) { DEVICE_SECRET = v; return DEVICE_SECRET; }
    } catch (e) { /* first boot — minted below */ }
    DEVICE_SECRET = crypto.randomBytes(32).toString('hex');
    try { fs.mkdirSync(path.dirname(DEVICE_KEY_FILE), { recursive: true, mode: 0o700 }); } catch (e) { /* non-fatal */ }
    fs.writeFileSync(DEVICE_KEY_FILE, DEVICE_SECRET, { mode: 0o600 });
    try { fs.chmodSync(DEVICE_KEY_FILE, 0o600); } catch (e) { /* restore layers are not trusted to keep it */ }
    return DEVICE_SECRET;
  }
  /* v2 seal: HKDF mixes the two halves — neither file alone is a key.
   * Returns null when the host configured no deviceFile, and the vault
   * then speaks the v1 scheme verbatim (dry-testable back-compat). */
  function credKey2() {
    const pepper = deviceSecret();
    if (!pepper) return null;
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(vaultSecret(), 'utf8'), Buffer.from(pepper, 'utf8'), 'witforge-vault-v2', 32));
  }
  function keyFor(rec) { return rec && rec.v === 2 ? credKey2() : credKey(); }

  /* One-shot migration from the pre-1.79 scheme, where ciphertext was keyed
   * by sha256(S.secret) inside the very same file. Anything that cannot be
   * re-keyed is reported loudly and must be RE-ENTERED — never silently
   * kept under a key that no longer exists. Also the boot-time mode
   * re-assert (v1.80.1) for stores already separated. */
  function migrateVaultKeys() {
    const marker = '__vaultSeparationV179';
    const st = S();
    if (st[marker]) {
      if (!fs.existsSync(VAULT_KEY_FILE)) {
        if (Object.keys(st.creds || {}).length || Object.keys(st.oauthApps || {}).some(id => (st.oauthApps[id] || {}).clientSecret)) {
          audit('security', 'VAULT FILE MISSING with credentials present — ciphertext is undecryptable; credentials must be RE-ENTERED (never silently rekeyed)', 'system');
        }
      } else {
        try { fs.chmodSync(VAULT_KEY_FILE, 0o600); } catch (e) { /* non-fatal */ }
      }
      migrateDeviceBinding(st);
      return;
    }
    const oldKey = crypto.createHash('sha256').update(String(st.secret)).digest();
    credKey();   // creates the independent vault file with chmod 0600
    const unsealOld = blob => { const d = crypto.createDecipheriv('aes-256-gcm', oldKey, Buffer.from(blob.iv, 'hex')); d.setAuthTag(Buffer.from(blob.tag, 'hex')); return Buffer.concat([d.update(Buffer.from(blob.data, 'hex')), d.final()]).toString('utf8'); };
    let n = 0;
    for (const svc of Object.keys(st.creds || {})) {
      try { const plain = unsealOld(st.creds[svc]); if (!plain) throw new Error('empty'); st.creds[svc] = Object.assign(encryptToken(svc, plain), { ts: st.creds[svc].ts }); n++; }
      catch (e) { audit('security', 'VAULT REKEY FAILED for ' + svc + ' — the key must be re-entered via its connect command', 'system'); delete st.creds[svc]; }
    }
    for (const pid of Object.keys(st.oauthApps || {})) {
      const app = st.oauthApps[pid];
      if (!app || !app.clientSecret) continue;
      try { const plain = unsealOld(app.clientSecret); if (!plain) throw new Error('empty'); app.clientSecret = encryptToken('oauth:' + pid, plain); n++; }
      catch (e) { audit('security', 'VAULT REKEY FAILED for oauth:' + pid + ' — the app secret must be re-registered on the Credentials page', 'system'); app.clientSecret = null; }
    }
    if (n) audit('security', 'VAULT SEPARATION v1.79: ' + n + ' credential(s)/app secret(s) re-keyed to the independent ' + VAULT_KEY_FILE, 'system');
    vaultSecret();            // ensure the file exists even with zero credentials stored
    st[marker] = true;
    save();
    migrateDeviceBinding(st);
  }

  /* v1.85 device-binding phase: re-key every remaining v1 record under
   * HKDF(vault-key, device-pepper). Runs at every boot when the host
   * configured a deviceFile, converges, and exits cheaply once nothing v1
   * remains. Records that cannot be unsealed are reported loudly and left
   * in place — never destroyed, never silently re-keyed: the credential
   * must be re-entered through its connect command. */
  function migrateDeviceBinding(st) {
    if (!DEVICE_KEY_FILE) return;
    let m = 0;
    for (const svc of Object.keys(st.creds || {})) {
      const rec = st.creds[svc];
      if (!rec || rec.v === 2) continue;
      const plain = decryptRec(rec);
      if (!plain) { audit('security', 'VAULT DEVICE-BINDING v1.85 skipped ' + svc + ' — undecryptable record left untouched; the credential must be re-entered', 'system'); continue; }
      st.creds[svc] = Object.assign(encryptToken(svc, plain), { ts: rec.ts });
      m++;
    }
    for (const pid of Object.keys(st.oauthApps || {})) {
      const app = st.oauthApps[pid];
      if (!app || !app.clientSecret || app.clientSecret.v === 2) continue;
      const plain = decryptRec(app.clientSecret);
      if (!plain) { audit('security', 'VAULT DEVICE-BINDING v1.85 skipped oauth:' + pid + ' — undecryptable secret left untouched; re-register on the Credentials page', 'system'); continue; }
      app.clientSecret = encryptToken('oauth:' + pid, plain);
      m++;
    }
    if (m) {
      audit('security', 'VAULT DEVICE-BINDING v1.85: ' + m + ' credential(s)/app secret(s) re-keyed to HKDF(vault-key, device-pepper) — copying the project folder no longer yields working credentials', 'system');
      save();
    }
    deviceSecret();           // mint the pepper even with zero records stored, so future seals are v2
  }

  function encryptToken(service, plain) {
    const iv = crypto.randomBytes(12);
    const key2 = DEVICE_KEY_FILE ? credKey2() : null;
    const c = crypto.createCipheriv('aes-256-gcm', key2 || credKey(), iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    const rec = { iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: enc.toString('hex') };
    if (key2) rec.v = 2;
    return rec;
  }
  function decryptRec(rec) {
    if (!rec || !rec.iv) return null;
    try {
      const key = keyFor(rec);
      if (!key) return null;
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'hex'));
      d.setAuthTag(Buffer.from(rec.tag, 'hex'));
      return Buffer.concat([d.update(Buffer.from(rec.data, 'hex')), d.final()]).toString('utf8');
    } catch (e) { return null; }
  }
  function decryptToken(service) {
    const rec = (S().creds || {})[service];
    return rec ? decryptRec(rec) : null;
  }
  function setCredential(service, token) {
    const svc = String(service || '').toLowerCase().slice(0, 20);
    if (!svc || !token) return { ok: false, error: 'service and token required' };
    const st = S();
    st.creds = st.creds || {};
    st.creds[svc] = Object.assign(encryptToken(svc, token), { ts: Date.now() });
    audit('security', 'CREDENTIAL STORED for ' + svc + ' (AES-256-GCM at rest; never returned by APIs)', 'user');
    save();
    return { ok: true, service: svc };
  }
  function revokeCredential(service) {
    const st = S();
    if (!st.creds || !st.creds[service]) return { ok: false, error: 'No credential for ' + service };
    delete st.creds[service];
    audit('security', 'CREDENTIAL REVOKED for ' + service, 'user');
    save();
    return { ok: true };
  }
  const listCreds = () => Object.entries(S().creds || {}).map(([k, v]) => ({ service: k, stored: v.ts }));

  /* ── v1.86: passphrase-sealed transfers (continuity without weakening v2) ──
   * v2 records are welded to this device's pepper by design — moving machines
   * means a bundle sealed under a ONE-TIME passphrase the owner types for this
   * operation only. It is never stored, never hashed, never logged; strength
   * of the bundle IS the passphrase, said plainly to the caller. Every record
   * is individually authenticated (AES-256-GCM), so a tampered record fails
   * alone instead of poisoning the restore. Wrong passphrase fails closed
   * with zero records written. */
  function sealVaultTransfer(passphrase) {
    const pass = String(passphrase || '');
    if (pass.length < 8) return { ok: false, error: 'Transfer passphrase must be ≥ 8 characters — it is the ONLY protection on the bundle; use a long random one, never a login password' };
    const st = S();
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(pass, salt, 32);
    const seal = plain => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return { iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: enc.toString('hex') }; };
    const records = [], skipped = [];
    for (const svc of Object.keys(st.creds || {})) {
      const plain = decryptRec(st.creds[svc]);
      if (!plain) { skipped.push(svc); continue; }
      records.push(Object.assign({ kind: 'cred', id: svc }, seal(plain)));
    }
    for (const pid of Object.keys(st.oauthApps || {})) {
      const app = st.oauthApps[pid];
      if (!app || !app.clientSecret) continue;
      const plain = decryptRec(app.clientSecret);
      if (!plain) { skipped.push('oauth:' + pid); continue; }
      records.push(Object.assign({ kind: 'oauth', id: pid }, seal(plain)));
    }
    audit('security', 'VAULT TRANSFER SEALED: ' + records.length + ' record(s) into a passphrase bundle (passphrase never stored; bundle strength = passphrase strength)' + (skipped.length ? ' · SKIPPED undecryptable: ' + skipped.join(', ') : ''), 'user');
    return { ok: true, sealed: records.length, skipped, bundle: { format: 'liam.vault-transfer', v: 1, sealedAt: Date.now(), kdf: { algo: 'scrypt', N: 16384, r: 8, p: 1, salt: salt.toString('hex') }, records } };
  }
  function openVaultTransfer(bundle, passphrase) {
    const pass = String(passphrase || '');
    if (!bundle || bundle.format !== 'liam.vault-transfer' || !Array.isArray(bundle.records)) return { ok: false, error: 'Not a LIAM vault-transfer bundle' };
    let key;
    try { key = crypto.scryptSync(pass, Buffer.from(String((bundle.kdf || {}).salt || ''), 'hex'), 32); } catch (e) { return { ok: false, error: 'Bundle kdf parameters unreadable' }; }
    const openOne = rec => { try { const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'hex')); d.setAuthTag(Buffer.from(rec.tag, 'hex')); return Buffer.concat([d.update(Buffer.from(rec.data, 'hex')), d.final()]).toString('utf8'); } catch (e) { return null; } };
    const st = S();
    st.creds = st.creds || {};
    let restored = 0, failed = 0;
    for (const rec of bundle.records) {
      const plain = rec && (rec.kind === 'cred' || rec.kind === 'oauth') ? openOne(rec) : null;
      if (!plain) { failed++; continue; }
      if (rec.kind === 'cred') st.creds[rec.id] = Object.assign(encryptToken(rec.id, plain), { ts: Date.now() });
      else { st.oauthApps = st.oauthApps || {}; st.oauthApps[rec.id] = Object.assign(st.oauthApps[rec.id] || {}, { clientSecret: encryptToken('oauth:' + rec.id, plain) }); }
      restored++;
    }
    if (restored) {
      audit('security', 'VAULT TRANSFER OPENED: ' + restored + ' record(s) re-sealed into this device vault' + (failed ? ' · ' + failed + ' failed (wrong passphrase or tampered record)' : ''), 'user');
      save();
    }
    if (!restored) return { ok: false, restored: 0, failed, error: 'Nothing recovered — the passphrase is wrong or every record is tampered. Nothing was written to this vault.' };
    return { ok: true, restored, failed };
  }

  /* ── v1.87: key rotation (crypto hygiene, fail-closed) ──────────────────
   * Rotating limits the useful life of stolen key material going forward —
   * the honest caveat, stated at the boundary: anything an attacker ALREADY
   * copied (state + old key halves) keeps decrypting; rotation never
   * transforms the past. It is refused entirely if any record cannot be
   * unsealed under the CURRENT keys — never rotate onto lost plaintext:
   * the named records must be re-entered first (revoke + set). */
  function rotateVaultKeys(opts) {
    opts = opts || {};
    const doVault = opts.vault !== false;
    const doDevice = !!DEVICE_KEY_FILE && opts.device !== false;
    if (!doVault && !doDevice) return { ok: false, error: 'Nothing to rotate — pass vault and/or device' };
    const st = S();
    const plains = [];
    const stuck = [];
    for (const svc of Object.keys(st.creds || {})) {
      const plain = decryptRec(st.creds[svc]);
      if (!plain) stuck.push(svc); else plains.push({ kind: 'cred', id: svc, plain, ts: st.creds[svc].ts });
    }
    for (const pid of Object.keys(st.oauthApps || {})) {
      const app = st.oauthApps[pid];
      if (!app || !app.clientSecret) continue;
      const plain = decryptRec(app.clientSecret);
      if (!plain) stuck.push('oauth:' + pid); else plains.push({ kind: 'oauth', id: pid, plain });
    }
    if (stuck.length) {
      audit('security', 'VAULT ROTATION REFUSED — undecryptable record(s): ' + stuck.join(', ') + '; re-enter them (revoke + connect) before rotating, nothing was changed', 'user');
      return { ok: false, error: 'Rotation refused: ' + stuck.join(', ') + ' cannot be unsealed under the current keys. Re-enter those credentials first — rotation onto lost plaintext is never attempted.', stuck };
    }
    if (doVault) { VAULT_SECRET = null; fs.writeFileSync(VAULT_KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 }); }
    if (doDevice) { DEVICE_SECRET = null; fs.writeFileSync(DEVICE_KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 }); }
    vaultSecret();            // read the new halves back through the normal 600-asserting path
    if (doDevice) deviceSecret();
    st.creds = st.creds || {};
    for (const r of plains) {
      if (r.kind === 'cred') st.creds[r.id] = Object.assign(encryptToken(r.id, r.plain), { ts: r.ts });
      else { st.oauthApps = st.oauthApps || {}; st.oauthApps[r.id] = Object.assign(st.oauthApps[r.id] || {}, { clientSecret: encryptToken('oauth:' + r.id, r.plain) }); }
    }
    audit('security', 'VAULT KEYS ROTATED (' + [doVault && 'vault-key', doDevice && 'device-pepper'].filter(Boolean).join(' + ') + '): ' + plains.length + ' record(s) re-sealed; pre-rotation key material no longer opens this store (previously copied material is untouched — rotation is forward-looking only)', 'user');
    save();
    return { ok: true, rotated: [doVault && 'vault', doDevice && 'device'].filter(Boolean), records: plains.length };
  }

  return { encryptToken, decryptToken, decryptRec, setCredential, revokeCredential, listCreds, migrateVaultKeys, sealVaultTransfer, openVaultTransfer, rotateVaultKeys, VAULT_KEY_FILE, DEVICE_KEY_FILE, VAULT_VERSION: DEVICE_KEY_FILE ? 2 : 1 };
}

module.exports = { create };
