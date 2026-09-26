/* WitForge durable platform-state storage.
 *
 * Modern Node runtimes use the built-in node:sqlite module with WAL and
 * FULL synchronous commits. Older runtimes retain the proven atomic JSON
 * store. No package, native add-on or external database service is required.
 *
 * The SQLite shape is deliberately a transactional state envelope rather
 * than a pretend relational model: platform.js remains the one authority for
 * state semantics, while this module owns crash-safe persistence, hashes,
 * revisions, last-good recovery and one-time legacy JSON import.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_MODES = Object.freeze(['auto', 'sqlite', 'json']);
const sha256 = text => crypto.createHash('sha256').update(String(text)).digest('hex');

class StorageIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageIntegrityError';
    this.code = 'WITFORGE_STORAGE_INTEGRITY';
  }
}

function sqliteSupport() {
  try {
    const api = require('node:sqlite');
    return typeof api.DatabaseSync === 'function'
      ? { available: true, DatabaseSync: api.DatabaseSync, reason: null }
      : { available: false, DatabaseSync: null, reason: 'node:sqlite has no DatabaseSync API' };
  } catch (e) {
    return { available: false, DatabaseSync: null, reason: 'node:sqlite is unavailable on Node ' + process.versions.node };
  }
}

function ensureObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StorageIntegrityError('platform state must be a JSON object');
  return value;
}

function readJsonCopy(file) {
  if (!fs.existsSync(file)) return { status: 'MISSING', state: null, text: null, error: null };
  try {
    const text = fs.readFileSync(file, 'utf8');
    const state = ensureObject(JSON.parse(text));
    return { status: 'VALID', state, text, error: null };
  } catch (e) {
    return { status: 'CORRUPT', state: null, text: null, error: String(e.message || e) };
  }
}

function legacyState(file) {
  const primary = readJsonCopy(file);
  const backup = readJsonCopy(file + '.bak');
  if (primary.status === 'VALID') return { state: primary.state, source: 'primary', primary, backup };
  if (backup.status === 'VALID') return { state: backup.state, source: 'backup', primary, backup };
  return { state: null, source: null, primary, backup };
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch (e) { /* some restored filesystems normalize modes */ }
}

function ownerOnly(files) {
  for (const file of files) {
    try { if (fs.existsSync(file)) fs.chmodSync(file, 0o600); } catch (e) { /* mode is best-effort on normalized filesystems */ }
  }
}

function createJsonStore(opts) {
  const file = path.resolve(opts.jsonFile);
  let lastSource = 'not-loaded';
  let recovered = false;
  let revision = 0;

  function load() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const found = legacyState(file);
    if (found.state) {
      lastSource = found.source;
      recovered = found.source === 'backup';
      if (found.source === 'primary') {
        try { fs.copyFileSync(file, file + '.bak'); ownerOnly([file, file + '.bak']); } catch (e) { /* a snapshot failure must not hide a valid primary */ }
      }
      return { state: found.state, source: found.source, recovered };
    }
    if (found.primary.status === 'CORRUPT' || found.backup.status === 'CORRUPT') {
      throw new StorageIntegrityError('JSON platform store and its last-good snapshot are unreadable: ' + file);
    }
    lastSource = 'none';
    recovered = false;
    return { state: null, source: 'none', recovered: false };
  }

  function save(state) {
    const payload = JSON.stringify(ensureObject(state));
    const current = readJsonCopy(file);
    if (current.status === 'VALID') {
      try { fs.copyFileSync(file, file + '.bak'); ownerOnly([file + '.bak']); } catch (e) { /* the atomic primary commit remains authoritative */ }
    }
    atomicWrite(file, payload);
    const verify = readJsonCopy(file);
    if (verify.status !== 'VALID' || sha256(verify.text) !== sha256(payload)) throw new StorageIntegrityError('JSON platform store failed its post-write verification');
    revision++;
    lastSource = 'primary';
    recovered = false;
    return { ok: true, engine: 'json', revision, sha256: sha256(payload) };
  }

  function integrity() {
    const found = legacyState(file);
    const usable = !!found.state;
    return {
      ok: usable || (found.primary.status === 'MISSING' && found.backup.status === 'MISSING'),
      engine: 'json', primary: found.primary.status, backup: found.backup.status,
      effective: found.source || 'none', recovered: found.source === 'backup'
    };
  }

  return {
    engine: 'json', file, legacyFile: file, vaultBase: file,
    load, save, integrity, close() {},
    info() {
      return { engine: 'json', requested: opts.requested, file, legacyFile: file, journalMode: null, revision, lastSource, recovered, migrated: false, fallbackReason: opts.fallbackReason || null };
    }
  };
}

function decodeSqliteRow(row) {
  if (!row) return { ok: false, missing: true, state: null, reason: 'missing' };
  if (sha256(row.payload) !== row.payload_sha256) return { ok: false, missing: false, state: null, reason: 'sha256 mismatch' };
  try {
    return { ok: true, missing: false, state: ensureObject(JSON.parse(row.payload)), reason: null };
  } catch (e) {
    return { ok: false, missing: false, state: null, reason: String(e.message || e) };
  }
}

function createSqliteStore(opts, support) {
  const file = path.resolve(opts.sqliteFile);
  const legacyFile = path.resolve(opts.jsonFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new support.DatabaseSync(file);
  let closed = false;
  let migrated = false;
  let migrationSource = null;
  let lastSource = 'not-loaded';
  let recovered = false;
  let revision = 0;

  db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA wal_autocheckpoint=100; PRAGMA journal_size_limit=4194304');
  const journal = db.prepare('PRAGMA journal_mode=WAL').get();
  const journalMode = String((journal && (journal.journal_mode || journal.journalMode)) || '').toLowerCase();
  if (journalMode !== 'wal') {
    db.close();
    throw new Error('SQLite opened but WAL could not be enabled for ' + file);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_state_backup (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      updated_at TEXT NOT NULL
    );
  `);
  ownerOnly([file, file + '-wal', file + '-shm']);
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
    .run(1, 'sqlite-wal-state-envelope', new Date().toISOString());

  const selectPrimary = db.prepare('SELECT payload,payload_sha256,revision,updated_at FROM platform_state WHERE id=1');
  const selectBackup = db.prepare('SELECT payload,payload_sha256,revision,updated_at FROM platform_state_backup WHERE id=1');
  const upsertPrimary = db.prepare(`
    INSERT INTO platform_state(id,payload,payload_sha256,revision,updated_at) VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,payload_sha256=excluded.payload_sha256,revision=excluded.revision,updated_at=excluded.updated_at
  `);
  const upsertBackup = db.prepare(`
    INSERT INTO platform_state_backup(id,payload,payload_sha256,revision,updated_at) VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,payload_sha256=excluded.payload_sha256,revision=excluded.revision,updated_at=excluded.updated_at
  `);

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (rollbackError) { /* retain the original error */ }
      throw e;
    }
  }

  function importLegacy() {
    const found = legacyState(legacyFile);
    if (!found.state) {
      if (found.primary.status === 'CORRUPT' || found.backup.status === 'CORRUPT') {
        throw new StorageIntegrityError('Legacy JSON exists but no valid copy can be imported: ' + legacyFile);
      }
      return null;
    }
    const payload = JSON.stringify(found.state);
    const imported = transaction(() => {
      const already = selectPrimary.get();
      if (already) return false;
      const now = new Date().toISOString();
      upsertPrimary.run(payload, sha256(payload), 1, now);
      upsertBackup.run(payload, sha256(payload), 1, now);
      db.prepare('INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
        .run(2, 'legacy-json-import', now);
      return true;
    });
    migrated = imported;
    migrationSource = imported ? found.source : null;
    ownerOnly([file, file + '-wal', file + '-shm']);
    return imported ? { state: found.state, source: 'legacy-' + found.source, recovered: found.source === 'backup' } : null;
  }

  function load() {
    let row = selectPrimary.get();
    if (!row) {
      const imported = importLegacy();
      if (imported) {
        revision = 1;
        lastSource = imported.source;
        recovered = imported.recovered;
        return imported;
      }
      row = selectPrimary.get();
    }
    if (!row) {
      lastSource = 'none';
      recovered = false;
      return { state: null, source: 'none', recovered: false };
    }
    const primary = decodeSqliteRow(row);
    if (primary.ok) {
      revision = Number(row.revision) || 0;
      lastSource = 'primary';
      recovered = false;
      return { state: primary.state, source: 'primary', recovered: false };
    }
    const backupRow = selectBackup.get();
    const backup = decodeSqliteRow(backupRow);
    if (backup.ok) {
      revision = Number(backupRow.revision) || 0;
      lastSource = 'backup';
      recovered = true;
      return { state: backup.state, source: 'backup', recovered: true };
    }
    throw new StorageIntegrityError('SQLite primary and last-good state envelopes are unreadable: ' + file);
  }

  function save(state) {
    const payload = JSON.stringify(ensureObject(state));
    const digest = sha256(payload);
    const nextRevision = transaction(() => {
      const current = selectPrimary.get();
      const backup = selectBackup.get();
      const validCurrent = decodeSqliteRow(current);
      if (validCurrent.ok) upsertBackup.run(current.payload, current.payload_sha256, Number(current.revision), current.updated_at);
      const baseRevision = Math.max(Number(current && current.revision) || 0, Number(backup && backup.revision) || 0);
      const next = baseRevision + 1;
      const now = new Date().toISOString();
      upsertPrimary.run(payload, digest, next, now);
      if (!current && !backup) upsertBackup.run(payload, digest, next, now);
      return next;
    });
    const verify = selectPrimary.get();
    if (!decodeSqliteRow(verify).ok || verify.payload_sha256 !== digest) throw new StorageIntegrityError('SQLite platform store failed its post-commit verification');
    ownerOnly([file, file + '-wal', file + '-shm']);
    revision = nextRevision;
    lastSource = 'primary';
    recovered = false;
    return { ok: true, engine: 'sqlite', revision, sha256: digest, journalMode };
  }

  function integrity() {
    let quick = null;
    try {
      const row = db.prepare('PRAGMA quick_check').get();
      quick = row && String(Object.values(row)[0]);
    } catch (e) { quick = String(e.message || e); }
    const primaryRow = selectPrimary.get();
    const backupRow = selectBackup.get();
    const primary = decodeSqliteRow(primaryRow);
    const backup = decodeSqliteRow(backupRow);
    const empty = primary.missing && backup.missing;
    return {
      ok: quick === 'ok' && (primary.ok || backup.ok || empty), engine: 'sqlite',
      sqlite: quick, journalMode,
      primary: primary.ok ? 'VALID' : (primary.missing ? 'MISSING' : 'CORRUPT'),
      backup: backup.ok ? 'VALID' : (backup.missing ? 'MISSING' : 'CORRUPT'),
      effective: primary.ok ? 'primary' : (backup.ok ? 'backup' : 'none'),
      recovered: !primary.ok && backup.ok
    };
  }

  function info() {
    const migrations = db.prepare('SELECT version,name,applied_at FROM schema_migrations ORDER BY version').all();
    return { engine: 'sqlite', requested: opts.requested, file, legacyFile, journalMode, revision, lastSource, recovered, migrated, migrationSource, migrations, fallbackReason: null };
  }

  return {
    engine: 'sqlite', file, legacyFile, vaultBase: legacyFile,
    load, save, integrity, info,
    close() { if (!closed) { db.close(); closed = true; } }
  };
}

function storageDecision(opts) {
  const requested = String(opts.requested || 'auto').trim().toLowerCase();
  if (!STORAGE_MODES.includes(requested)) throw new Error('WITFORGE_STORAGE must be auto, sqlite or json');
  if (requested === 'json' || (requested === 'auto' && opts.explicitJson)) return { engine: 'json', fallbackReason: null };
  if (requested === 'sqlite' && !opts.sqliteAvailable) {
    throw new Error('WITFORGE_STORAGE=sqlite requires a Node runtime with node:sqlite (Node 22.5 or newer). ' + opts.reason);
  }
  if (opts.sqliteAvailable) return { engine: 'sqlite', fallbackReason: null };
  if (opts.sqliteExists) {
    throw new Error('An existing SQLite platform store cannot be opened on Node ' + process.versions.node + '. Refusing stale JSON fallback; use Node 22.5 or newer, or explicitly select a separately backed-up JSON store.');
  }
  return { engine: 'json', fallbackReason: opts.reason };
}

function createPlatformStore(opts) {
  opts = opts || {};
  const root = path.resolve(opts.root || __dirname);
  const explicitJson = opts.preferJson !== undefined ? !!opts.preferJson : !!process.env.PLATFORM_DATA;
  const jsonFile = path.resolve(opts.jsonFile || process.env.PLATFORM_DATA || path.join(root, 'data', 'platform.json'));
  const sqliteFile = path.resolve(opts.sqliteFile || process.env.WITFORGE_SQLITE_PATH || path.join(path.dirname(jsonFile), path.basename(jsonFile, path.extname(jsonFile)) + '.db'));
  const requested = String(opts.mode || process.env.WITFORGE_STORAGE || 'auto').trim().toLowerCase();
  const support = sqliteSupport();
  const decision = storageDecision({ requested, explicitJson, sqliteAvailable: support.available, sqliteExists: fs.existsSync(sqliteFile), reason: support.reason });
  if (decision.engine === 'sqlite') return createSqliteStore({ sqliteFile, jsonFile, requested }, support);
  return createJsonStore({ jsonFile, requested, fallbackReason: decision.fallbackReason });
}

module.exports = {
  STORAGE_MODES, StorageIntegrityError, createPlatformStore, sqliteSupport,
  storageDecision, readJsonCopy, legacyState, decodeSqliteRow, sha256
};
