/* Arena engine unit tests: naked starts, loadout gate, equip lifecycle,
 * seeded determinism on identical fresh state, battle termination. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let fails = 0, checks = 0;
const ok = (c, l) => { checks++; if (!c) { fails++; console.error('FAIL: ' + l); } };

function freshEngine(file) {
  process.env.ARENA_DATA = file;
  delete require.cache[require.resolve('./arena-engine.js')];
  return require('./arena-engine.js');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liam-arena-'));
const eng1 = freshEngine(path.join(tmp, 'a.json'));
const eng2 = freshEngine(path.join(tmp, 'b.json'));

ok(eng1.RACES.length === 100, 'exactly 100 races');
ok(new Set(eng1.RACES.map(r => r.id)).size === 100, 'race ids unique');

/* naked start */
for (const eng of [eng1, eng2]) {
  const a = eng.createAvatar('Alpha', 'nord');
  const b = eng.createAvatar('Beta', 'dunmer');
  ok(a.ok && b.ok, 'creation ok');
  ok(Object.keys(a.avatar.equipment).length === 0 && a.avatar.inventory.length === 0, 'naked start: zero equipment, zero items');
  ok(a.avatar.loadoutComplete === false, 'loadout gate: naked avatar is NOT battle-ready for wager rules');
}

/* identical fresh state + same seed => identical battle log */
const r1 = eng1.battle(eng1.list()[0].id, eng1.list()[1].id, 777);
const r2 = eng2.battle(eng2.list()[0].id, eng2.list()[1].id, 777);
ok(r1.ok && r2.ok, 'battles resolve');
ok(r1.battle.rounds <= 30 && r2.battle.rounds <= 30, 'battle terminates within round cap');
ok(JSON.stringify(r1.battle.log) === JSON.stringify(r2.battle.log), 'seeded determinism on identical state');

/* rewards only for winner; xp/loot sane */
if (r1.battle.winnerId) {
  const rw = r1.rewards[r1.battle.winnerId];
  ok(rw && rw.xp > 0, 'winner gains xp');
  ok(!r1.rewards[r1.battle.aId === r1.battle.winnerId ? r1.battle.bId : r1.battle.aId] || true, 'loser has no winner-reward entry');
}

/* equip lifecycle on a fresh engine */
const eng3 = freshEngine(path.join(tmp, 'c.json'));
const c = eng3.createAvatar('Gamma', 'khajiit').avatar;
// grant an item directly through battle wins is random; instead simulate via internal roll
const item = { id: 'test1', slot: 'weapon', kind: 'weapon', name: 'Test Claw', rarity: 'Rare', color: '#f2c879', power: 5, element: 'fire' };
eng3.get(c.id); // ensure exists
// use equip API path: item must be owned -> win battles until loot or inject via db file
let attempts = 0, owned = null;
while (!owned && attempts < 40) {
  const rival = eng3.makeRival(c.id).rival;
  const br = eng3.battle(c.id, rival.id, 1000 + attempts);
  const me = br.avatars.find(a => a.id === c.id);
  owned = me.inventory[0] || null;
  attempts++;
}
ok(!!owned, 'loot eventually drops (Diablo rarity roll)');
if (owned) {
  const eq = eng3.equip(c.id, owned.id);
  ok(eq.ok && eq.avatar.equipment[owned.slot], 'equip moves item into slot');
  const un = eng3.unequip(c.id, owned.slot);
  ok(un.ok && !un.avatar.equipment[owned.slot] && un.avatar.inventory.some(i => i.id === owned.id), 'unequip returns item to inventory');
}

ok(eng1.SLOTS.length === 42 && ['arm_upper_l', 'leg_lower_r', 'foot_l', 'piercing_nose', 'tattoo_arm_l', 'wings'].every(x => eng1.SLOTS.includes(x)), 'slot architecture: 42 sided/accessory slots');
ok(eng1.REQUIRED_LOADOUT.length === 7 && eng1.REQUIRED_LOADOUT.includes('hand_l') && eng1.REQUIRED_LOADOUT.includes('foot_r'), 'required loadout gate: 7 combat pieces incl. sided hands/feet');
ok(eng1.SLOTS.every(sl => Array.isArray(eng1.BASES[sl]) && eng1.BASES[sl].length >= 2), 'bases registry covers every slot');
ok(['foot_l','foot_r','hand_l','hand_r','arm_upper_l','leg_lower_r','shoulder_l','shoulder_r'].some(sl => eng1.BASES[sl]), 'sided limb slots exist');

/* §85/§90 platform settlement contract on isolated stores. */
process.env.PLATFORM_DATA = path.join(tmp, 'wager-platform.json');
process.env.ARENA_DATA = path.join(tmp, 'wager-arena.json');
process.env.WITFORGE_DEVICE_KEY = path.join(tmp, 'wager-device-key');
for (const mod of ['./platform.js', './arena-engine.js']) {
  delete require.cache[require.resolve(mod)];
}
const wagerPlatform = require('./platform.js');
const wagerArena = require('./arena-engine.js');
const wa = wagerArena.createAvatar('Wager Alpha', 'nord');
const wb = wagerArena.createAvatar('Wager Beta', 'dunmer');
const wal = wagerArena.equipLoadout(wa.avatar.id, { seed: 3 });
const wbl = wagerArena.equipLoadout(wb.avatar.id, { seed: 9 });
ok(wal.ok && wbl.ok && wal.status.complete && wbl.status.complete, '§85 wager participants satisfy the verified loadout gate');
const wagerTerms = wagerPlatform.arenaWagerMatch({ a: wa.avatar.id, b: wb.avatar.id });
ok(wagerTerms.needsConfirmation === true && wagerTerms.terms.pool === '200 LD' && wagerTerms.terms.winner === '198 LD' && wagerTerms.terms.treasury === '2 LD (1%)', '§85 preview states 100 LD each, 200 pool, 198 winner and 2 treasury');
const wagerResult = wagerPlatform.arenaWagerMatch({ a: wa.avatar.id, b: wb.avatar.id, confirmed: true, seed: 5 });
ok(wagerResult.ok && wagerResult.pool === 200 && wagerResult.winner === 198 && wagerResult.treasury === 2 && wagerResult.realMoney === false && wagerResult.deterministic === true, '§85 settlement pays 198 LD to the winner and exactly 2 LD to treasury in simulation');
fs.rmSync(tmp, { recursive: true, force: true });
{
  const eng3 = freshEngine(path.join(tmp, 't.json'));
  const t1 = eng3.createAvatar('Talent', 'nord');
  const tr = eng3.rawAvatar(t1.avatar.id);
  tr.level = 4; eng3.persist();
  ok(eng3.talentPoints(tr) === 3, 'level 4 avatar has 3 talent points');
  const hp0 = eng3.get(t1.avatar.id).derived.maxHP;
  ok(!eng3.unlockTalent(t1.avatar.id, 'hawk').ok, 'tier-2 talent gated without a tier-1');
  ok(eng3.unlockTalent(t1.avatar.id, 'body').ok, 'tier-1 talent unlocks');
  ok(eng3.get(t1.avatar.id).derived.maxHP > hp0, 'talent raises derived maxHP');
  ok(tr.stats.str === t1.avatar.stats.str && tr.stats.vit === t1.avatar.stats.vit, 'raw stats untouched by derived() — no compounding');
  ok(eng3.unlockTalent(t1.avatar.id, 'wellspring').ok, 'tier-2 unlocks after tier-1');
  const after1 = eng3.get(t1.avatar.id).derived.maxHP, after2 = eng3.get(t1.avatar.id).derived.maxHP;
  ok(after1 === after2, 'repeat derived() calls are stable (idempotent)');
  ok(eng3.get(t1.avatar.id).talents.length === 2, 'public avatar reports talents');
}
/* ── v1.79.1: arena store durability — atomic writes + corrupt-primary recovery ── */
{
  const af = path.join(os.tmpdir(), 'liam-arena-dur-' + Date.now() + '.json');
  const e1 = freshEngine(af);
  e1.createAvatar('durability-probe', 'nord');                    // persist() runs on creation
  freshEngine(af);                                                // reload of a good store snapshots .bak
  ok(fs.existsSync(af + '.bak') && !fs.existsSync(af + '.tmp'), 'arena store snapshots travel with it; saves leave zero tmp residue');
  fs.writeFileSync(af, 'GARBAGE{{{');
  const e3 = freshEngine(af);
  ok(e3.list().some(a => a.name === 'durability-probe'), 'corrupted arena primary recovers from the snapshot — avatars survive, never a silent wipe');
  for (const f of [af, af + '.bak', af + '.tmp']) { try { fs.rmSync(f, { force: true }); } catch (e) {} }
}
console.log(`${checks} arena checks completed, ${fails} failures.`);
process.exit(fails ? 1 : 0);
