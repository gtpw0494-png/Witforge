/* v2.07 storage release checks: JSON compatibility plus SQLite/WAL migration,
 * restart durability, idempotency, hash recovery and external inspection. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('./storage.js');
const recovery = require('./recovery.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'witforge-storage-'));
let checks = 0, fails = 0;
const ok = (condition, label) => {
  checks++;
  if (!condition) { fails++; console.error('  ✗ FAIL: ' + label); }
};

try {
  const jsonFile = path.join(tmp, 'compat', 'platform.json');
  const json = storage.createPlatformStore({ mode: 'json', jsonFile, sqliteFile: path.join(tmp, 'compat', 'platform.db') });
  ok(json.info().engine === 'json', 'explicit JSON mode remains available');
  ok(json.load().state === null, 'a missing JSON store is reported as new, not corrupt');
  json.save({ marker: 'first', audit: [], metadata: { training: ['a', 'b'] } });
  json.save({ marker: 'second', audit: [], metadata: { training: ['a', 'b', 'c'] } });
  ok(json.load().state.marker === 'second', 'atomic JSON saves round-trip exactly');
  fs.writeFileSync(jsonFile, 'GARBAGE{{{');
  const jsonRecovered = json.load();
  ok(jsonRecovered.recovered === true && jsonRecovered.state.marker === 'second', 'JSON corruption recovers the last-good snapshot');
  ok(json.integrity().ok === true && json.integrity().effective === 'backup', 'JSON integrity reports the effective backup honestly');
  json.close();

  let invalidMode = false;
  try { storage.createPlatformStore({ mode: 'invented', jsonFile: path.join(tmp, 'invalid.json') }); } catch (e) { invalidMode = /auto, sqlite or json/.test(e.message); }
  ok(invalidMode, 'unknown storage modes fail closed');

  const support = storage.sqliteSupport();
  let staleFallbackRefused = false;
  try { storage.storageDecision({ requested: 'auto', explicitJson: false, sqliteAvailable: false, sqliteExists: true, reason: 'test runtime' }); } catch (e) { staleFallbackRefused = /Refusing stale JSON fallback/.test(e.message); }
  ok(typeof support.available === 'boolean' && staleFallbackRefused, 'SQLite support is explicit and an existing database can never fall back to stale JSON');

  if (support.available) {
    const legacyFile = path.join(tmp, 'sqlite', 'platform.json');
    const sqliteFile = path.join(tmp, 'sqlite', 'platform.db');
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    const legacyState = {
      marker: 'legacy', audit: [],
      knowledge: [{ id: 'k1', text: 'verified knowledge', provenance: { source: 'owner' } }],
      training: { examples: [{ input: 'hello', output: 'world', verified: true }], epochs: 3 }
    };
    fs.writeFileSync(legacyFile, JSON.stringify(legacyState));

    const sqlite = storage.createPlatformStore({ mode: 'auto', preferJson: false, jsonFile: legacyFile, sqliteFile });
    ok(sqlite.info().engine === 'sqlite', 'auto mode selects built-in SQLite when the runtime supports it');
    const imported = sqlite.load();
    ok(imported.source === 'legacy-primary' && imported.state.marker === 'legacy', 'legacy JSON imports once into an empty SQLite store');
    ok(JSON.stringify(imported.state.training) === JSON.stringify(legacyState.training) && imported.state.knowledge[0].provenance.source === 'owner', 'migration preserves nested training and provenance metadata');
    ok(sqlite.info().journalMode === 'wal' && (fs.statSync(sqliteFile).mode & 0o777) === 0o600, 'SQLite runs in WAL mode with an owner-only database file');
    ok(fs.existsSync(legacyFile), 'legacy JSON is retained as a non-destructive migration source');
    ok(sqlite.info().migrations.filter(m => m.name === 'legacy-json-import').length === 1, 'migration ledger records one legacy import');

    imported.state.marker = 'sqlite-updated';
    imported.state.training.epochs = 4;
    const committed = sqlite.save(imported.state);
    ok(committed.revision === 2 && committed.journalMode === 'wal', 'SQLite commit advances a durable revision');
    sqlite.close();

    fs.writeFileSync(legacyFile, JSON.stringify({ marker: 'changed-legacy', audit: [] }));
    const reopened = storage.createPlatformStore({ mode: 'sqlite', jsonFile: legacyFile, sqliteFile });
    const afterRestart = reopened.load();
    ok(afterRestart.state.marker === 'sqlite-updated' && afterRestart.state.training.epochs === 4, 'restart reads committed SQLite state, not a changed legacy source');
    ok(reopened.info().migrations.filter(m => m.name === 'legacy-json-import').length === 1, 'reopening is idempotent and never duplicates migration');
    reopened.close();

    const db = new support.DatabaseSync(sqliteFile);
    db.prepare('UPDATE platform_state SET payload=? WHERE id=1').run('{broken');
    db.close();
    const external = recovery.checkSqliteStore(sqliteFile, { vaultBase: legacyFile });
    ok(external.primary === 'CORRUPT' && external.backup === 'VALID' && external.effective === 'BACKUP', 'read-only recovery detects a damaged primary and valid last-good envelope');

    const repairing = storage.createPlatformStore({ mode: 'sqlite', jsonFile: legacyFile, sqliteFile });
    const recovered = repairing.load();
    ok(recovered.recovered === true && recovered.state.marker === 'legacy', 'SQLite load falls back to the hashed last-good envelope');
    repairing.save(recovered.state);
    const integrity = repairing.integrity();
    ok(integrity.ok === true && integrity.primary === 'VALID' && integrity.journalMode === 'wal', 'a recovered state can be recommitted and passes SQLite integrity');
    repairing.close();
  } else {
    const fallback = storage.createPlatformStore({ mode: 'auto', preferJson: false, jsonFile: path.join(tmp, 'fallback.json'), sqliteFile: path.join(tmp, 'fallback.db') });
    ok(fallback.info().engine === 'json' && !!fallback.info().fallbackReason, 'auto mode falls back honestly when node:sqlite is unavailable');
    fallback.close();
    let refused = false;
    try { storage.createPlatformStore({ mode: 'sqlite', jsonFile: path.join(tmp, 'forced.json'), sqliteFile: path.join(tmp, 'forced.db') }); } catch (e) { refused = /requires a Node runtime with node:sqlite/.test(e.message); }
    ok(refused, 'explicit SQLite mode refuses an unsupported runtime');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(checks + ' storage checks completed, ' + fails + ' failures.');
process.exit(fails === 0 ? 0 : 1);
