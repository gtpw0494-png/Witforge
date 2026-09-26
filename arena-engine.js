/* LIAM Arena — server-authoritative battle & avatar engine.
 * Mechanics fuse Diablo (primary stats, elemental damage, crits, loot
 * rarities) with Skyrim (Health/Magicka/Stamina resources, use-based skills,
 * racial resistances). The client never decides damage, winners or loot.
 * Every avatar starts UNEQUIPPED — a naked base of its chosen race.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { RACES } = require('./races.js');

const DATA = process.env.ARENA_DATA ? path.resolve(process.env.ARENA_DATA) : path.join(__dirname, 'data', 'arena.json');
const REQUIRED_LOADOUT = ['weapon', 'head', 'torso', 'hand_l', 'hand_r', 'foot_l', 'foot_r'];
const SLOTS = [
  'head', 'face', 'hair', 'eyes', 'ears',
  'arm_upper_l', 'arm_upper_r', 'arm_lower_l', 'arm_lower_r', 'hand_l', 'hand_r',
  'leg_upper_l', 'leg_upper_r', 'leg_lower_l', 'leg_lower_r', 'foot_l', 'foot_r',
  'shoulder_l', 'shoulder_r', 'belt', 'torso',
  'neck', 'necklace', 'ring_l', 'ring_r', 'earring_l', 'earring_r',
  'piercing_brow', 'piercing_nose', 'piercing_lip',
  'tattoo_head', 'tattoo_torso', 'tattoo_arm_l', 'tattoo_arm_r', 'tattoo_leg_l', 'tattoo_leg_r',
  'wings', 'back', 'aura', 'cloak', 'weapon', 'shield'
];
const COMBAT_SLOTS = ['weapon', 'head', 'torso', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'shield', 'arm_upper_l', 'arm_upper_r', 'leg_upper_l', 'leg_upper_r'];

const pieceArt = require('./piece-art.js').create();
let db = { avatars: [], battles: [] };
/* v1.79: same durability contract as the platform store — atomic writes
 * (tmp + rename) and a last-good .bak snapshot for corruption recovery. */
try {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (fs.existsSync(DATA)) {
    try {
      db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      try { fs.copyFileSync(DATA, DATA + '.bak'); } catch (e) { /* snapshot best-effort */ }
    } catch (e) {
      try { db = JSON.parse(fs.readFileSync(DATA + '.bak', 'utf8')); console.error('LIAM arena: primary store unreadable — recovered from .bak'); } catch (e2) { /* fresh db */ }
    }
  }
} catch (e) { /* fresh db */ }
function save() {
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DATA);
}

const raceOf = a => RACES.find(r => r.id === a.raceId);

/* deterministic RNG */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Avatar lifecycle ─────────────────────────────────── */
function createAvatar(name, raceId) {
  const race = RACES.find(r => r.id === raceId);
  if (!race) return { ok: false, error: 'Unknown race' };
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) return { ok: false, error: 'A name is required' };
  const a = {
    id: 'av' + Date.now().toString(36) + Math.floor(Math.random() * 999),
    name: clean, raceId, level: 1, xp: 0,
    stats: { str: race.s[0], dex: race.s[1], int: race.s[2], vit: race.s[3] },
    skills: { unarmed: { level: 1, uses: 0 }, destruction: { level: 1, uses: 0 } },
    equipment: {},           // naked start: zero equipped pieces
    inventory: [],           // nothing owned
    record: { wins: 0, losses: 0, draws: 0 },
    npc: false, created: Date.now()
  };
  db.avatars.push(a); save();
  return { ok: true, avatar: publicAvatar(a) };
}

/* v1.91: hang a deterministic procedural sigil portrait on every piece at
 * read time (piece-art.js; identity-keyed, never persisted). */
function publicAvatar(a) {
  const race = raceOf(a);
  const d = derived(a);
  a = pieceArt.attachDeep(a);
  return Object.assign({}, a, {
    race: race ? race.name : a.raceId,
    derived: { maxHP: d.maxHP, maxMP: d.maxMP, maxStam: d.maxStam, dodge: Math.round(d.dodge), crit: Math.round(d.crit), melee: d.melee, spell: d.spell, element: d.element, defense: d.defense, resists: d.res },
    loadoutComplete: REQUIRED_LOADOUT.every(s => a.equipment[s]),
    talents: talentList(a).slice(), talentPoints: talentPoints(a),
    pets: a.pets || []
  });
}

/* ── v1.62: talent trees (level-up points → passive passives) ──── */
const TALENTS = [
  { id: 'body',      tier: 1, name: 'Hardened Body',  effect: { str: 2, vit: 2 },  desc: '+2 STR, +2 VIT' },
  { id: 'mind',      tier: 1, name: 'Sharpened Mind', effect: { int: 3 },          desc: '+3 INT' },
  { id: 'fleet',     tier: 1, name: 'Fleetfoot',      effect: { dex: 3 },          desc: '+3 DEX' },
  { id: 'bulwark',   tier: 2, name: 'Bulwark',        effect: { hpFlat: 20 },      desc: '+20 max HP' },
  { id: 'wellspring',tier: 2, name: 'Wellspring',     effect: { mpFlat: 12 },      desc: '+12 max MP' },
  { id: 'hawk',      tier: 2, name: 'Hawk Eye',       effect: { critBoost: 6 },    desc: '+6 crit chance' },
  { id: 'warlord',   tier: 3, name: 'Warlord',        effect: { str: 2, vit: 2, dex: 2 }, desc: '+2 STR, VIT, DEX' },
  { id: 'sage',      tier: 3, name: 'Sage',           effect: { int: 2, mpFlat: 16 },   desc: '+2 INT, +16 MP' },
  { id: 'phoenix',   tier: 3, name: 'Phoenix',        effect: { hpFlat: 30 },      desc: '+30 max HP' }
];
function talentList(a) { a.talents = a.talents || []; return a.talents; }
function talentPoints(a) { return Math.max(0, (a.level - 1) - talentList(a).length); }
function talentMods(a) {
  const m = { str: 0, vit: 0, int: 0, dex: 0, hpFlat: 0, mpFlat: 0, critBoost: 0 };
  for (const id of talentList(a)) {
    const t = TALENTS.find(x => x.id === id); if (!t) continue;
    for (const k in t.effect) m[k] = (m[k] || 0) + t.effect[k];
  }
  return m;
}
function unlockTalent(avatarId, token) {
  const a = db.avatars.find(x => x.id === avatarId);
  if (!a) return { ok: false, error: 'Avatar not found' };
  const t = TALENTS.find(x => x.id === token || x.name.toLowerCase() === String(token || '').toLowerCase());
  if (!t) return { ok: false, error: 'Unknown talent — say “talents” for the tree' };
  if (talentList(a).includes(t.id)) return { ok: false, error: 'Talent already unlocked' };
  if (talentList(a).length < t.tier - 1) return { ok: false, error: 'Tier ' + t.tier + ' requires ' + (t.tier - 1) + ' earlier talent(s) first' };
  if (talentPoints(a) < 1) return { ok: false, error: 'No talent points — win battles to level up' };
  a.talents.push(t.id); save();
  return { ok: true, talent: t.name, pointsLeft: talentPoints(a) };
}
function derived(a) {
  const race = raceOf(a);
  const s = Object.assign({}, a.stats); // cloned: derived() itself applies talent/level mods without mutating
  const eq = a.equipment;
  let defense = Math.floor(s.vit * 0.4);
  const res = { fire: race.r[0], cold: race.r[1], light: race.r[2], poison: race.r[3] };
  let block = 0, wdmg = 0, welem = 'physical';
  for (const slot of COMBAT_SLOTS) {
    const it = eq[slot]; if (!it) continue;
    if (it.kind === 'weapon') { wdmg += it.power; if (it.element) welem = it.element; }
    else if (it.kind === 'shield') { block += Math.min(25, it.power); }
    else { defense += it.power; }
    if (it.resists) for (const k in it.resists) res[k] = Math.min(75, (res[k] || 0) + it.resists[k]);
  }
  const tm = talentMods(a);
  s.str += tm.str; s.vit += tm.vit; s.int += tm.int; s.dex += tm.dex;
  const maxHP = 30 + s.vit * 5 + s.str + a.level * 6 + tm.hpFlat;
  const maxMP = 12 + s.int * 4 + a.level * 3 + tm.mpFlat;
  const maxStam = 20 + s.dex * 2 + s.vit * 2;
  const dodge = 4 + s.dex * 0.8 + perkVal(race, 'swift');
  const crit = 5 + s.dex * 0.6 + perkVal(race, 'deadly') + tm.critBoost;
  const melee = 3 + Math.floor(s.str * 0.9) + a.skills.unarmed.level + wdmg;
  const spell = 2 + Math.floor(s.int * 0.8) + a.skills.destruction.level;
  const element = welem !== 'physical' ? welem : raceElement(race);
  return { maxHP, maxMP, maxStam, dodge, crit, melee, spell, element, defense, res, block };
}
function perkVal(race, key) { return race.pk[0] === key ? race.pk[1] : 0; }
function raceElement(race) {
  return { ember: 'fire', frost: 'cold', storm: 'lightning', venom: 'poison' }[race.pk[0]] || 'physical';
}

/* ── Loot (Diablo rarities) ───────────────────────────── */
const RARITY_LEVELS = 100; // spec §73: exactly 100 configurable rarity levels
const BANDS = [
  { min: 1, name: 'Common', color: '#c8c8c8' },
  { min: 60, name: 'Magic', color: '#6f8fff' },
  { min: 85, name: 'Rare', color: '#f2c879' },
  { min: 95, name: 'Legendary', color: '#c98bff' },
  { min: 99, name: 'Set', color: '#5de2ad' },
  { min: 100, name: 'Mythic', color: '#ff6cf0' }
];
const bandFor = l => [...BANDS].reverse().find(b => l >= b.min);
const nextBand = l => BANDS[BANDS.findIndex(b => b === bandFor(l)) + 1] || null;
const RARITIES = [
  { name: 'Common', color: '#c8c8c8', w: 60, mod: 0 },
  { name: 'Magic', color: '#6f8fff', w: 25, mod: 2 },
  { name: 'Rare', color: '#f2c879', w: 10, mod: 4 },
  { name: 'Legendary', color: '#c98bff', w: 4, mod: 7 },
  { name: 'Set', color: '#5de2ad', w: 1, mod: 6 }
];
const PREFIX = ['Stout', 'Keen', 'Ravaged', 'Blessed', 'Howling', 'Ember', 'Frostbound', 'Stormcharged', 'Viper', 'Ancient'];
const SUFFIX = ['of the Bear', 'of the Fox', 'of the Whale', 'of Flames', 'of the Glacier', 'of Thunder', 'of Vipers', 'of the Dragon', 'of Whispers', 'of Atmora'];
const LEGENDARY_NAMES = ["Tyrael's Mercy", 'Shard of Atmora', 'Fang of the First Hunt', "Rathma's Etching", 'Star of Azura', 'Ashen Crown', "Hircine's Tooth", 'The Pale Contract'];
const SET_NAMES = 'Vestments of the Twin Moons;Battlegear of the Last Dragonborn;Regalia of the Vizjeri;Trappings of the Black Marsh;Panoply of the Crimson Monastery'.split(';');
const BASES = {
  weapon: ['Claws', 'Gauntlet-Blade', 'War-Fists', 'Bone-Club'], head: ['Helm', 'Hood', 'Circlet', 'Skull-Cap'],
  torso: ['Cuirass', 'Robe', 'Hide-Shirt', 'Hauberk'], shield: ['Buckler', 'Ward', 'Aegis', 'Kite-Shield'],
  hand_l: ['Grip', 'Gauntlet', 'Wrap'], hand_r: ['Grip', 'Gauntlet', 'Wrap'],
  foot_l: ['Boot', 'Greave', 'Sandal'], foot_r: ['Boot', 'Greave', 'Sandal'],
  arm_upper_l: ['Vambrace', 'Sleeve', 'Plate'], arm_upper_r: ['Vambrace', 'Sleeve', 'Plate'],
  arm_lower_l: ['Bracer', 'Wrap', 'Guard'], arm_lower_r: ['Bracer', 'Wrap', 'Guard'],
  leg_upper_l: ['Thigh-Plate', 'Chausses', 'Wrap'], leg_upper_r: ['Thigh-Plate', 'Chausses', 'Wrap'],
  leg_lower_l: ['Shin-Guard', 'Greave', 'Wrap'], leg_lower_r: ['Shin-Guard', 'Greave', 'Wrap'],
  shoulder_l: ['Pauldron', 'Spaulder', 'Mantle'], shoulder_r: ['Pauldron', 'Spaulder', 'Mantle'],
  neck: ['Collar', 'Gorget', 'Chain'], necklace: ['Pendant', 'Talisman', 'Amulet'],
  ring_l: ['Band', 'Signet', 'Loop'], ring_r: ['Band', 'Signet', 'Loop'],
  earring_l: ['Stud', 'Hoop', 'Drop'], earring_r: ['Stud', 'Hoop', 'Drop'],
  piercing_brow: ['Barbell', 'Ring'], piercing_nose: ['Stud', 'Septum'], piercing_lip: ['Labret', 'Ring'],
  tattoo_head: ['Ink of the Crown', 'Face-Marking', 'Rune-Script'], tattoo_torso: ['Chest-Ink', 'Back-Piece', 'Rune-Script'],
  tattoo_arm_l: ['Sleeve-Ink', 'Forearm-Rune'], tattoo_arm_r: ['Sleeve-Ink', 'Forearm-Rune'],
  tattoo_leg_l: ['Leg-Ink', 'Shin-Rune'], tattoo_leg_r: ['Leg-Ink', 'Shin-Rune'],
  wings: ['Feathered Wings', 'Membrane Wings', 'Energy Wings'], back: ['Cloak-Clasp', 'Quiver-Strap', 'Banner'],
  aura: ['Ember Aura', 'Frost Aura', 'Storm Aura'], cloak: ['Shroud', 'Mantle', 'War-Cloak'],
  belt: ['Girdle', 'Sash', 'War-Belt'], face: ['Visor', 'Mask', 'Veil'], hair: ['Crest', 'Braids', 'Plume'],
  eyes: ['Lens', 'Glow-Band', 'Sight-Stone'], ears: ['Ear-Cuff', 'Frill-Guard']
};
const SLOT_KIND = slot => slot === 'weapon' ? 'weapon' : slot === 'shield' ? 'shield' : (slot.startsWith('tattoo_') || slot === 'aura') ? 'cosmetic' : 'armor';
const ELEMENTS = ['physical', 'fire', 'cold', 'lightning', 'poison'];

function rollRLevel(rnd) { return Math.max(1, Math.min(100, Math.floor(100 * Math.pow(rnd(), 2.4)) + 1)); }
function fingerprint(payload) {
  const p = Object.assign({}, payload); delete p.fp;
  return require('crypto').createHash('sha256').update(JSON.stringify(p)).digest('hex');
}
function rollLoot(rnd, level) {
  const rlevel = rollRLevel(rnd);
  const band = bandFor(rlevel);
  const slot = COMBAT_SLOTS[Math.floor(rnd() * COMBAT_SLOTS.length)];
  const base = BASES[slot][Math.floor(rnd() * BASES[slot].length)];
  let name = base;
  if (band.name === 'Magic') name = PREFIX[Math.floor(rnd() * PREFIX.length)] + ' ' + base;
  if (band.name === 'Rare') name = PREFIX[Math.floor(rnd() * PREFIX.length)] + ' ' + base + ' ' + SUFFIX[Math.floor(rnd() * SUFFIX.length)];
  if (band.name === 'Legendary') name = LEGENDARY_NAMES[Math.floor(rnd() * LEGENDARY_NAMES.length)];
  if (band.name === 'Set') name = SET_NAMES[Math.floor(rnd() * SET_NAMES.length)] + ' — ' + base;
  if (band.name === 'Mythic') name = 'MYTHIC ' + LEGENDARY_NAMES[Math.floor(rnd() * LEGENDARY_NAMES.length)];
  const power = Math.max(1, level * 2 + Math.floor(rlevel / 8) + Math.floor(rnd() * 4));
  const item = { id: 'it' + Math.floor(rnd() * 1e9).toString(36) + Date.now().toString(36), slot, kind: SLOT_KIND(slot), name, rarity: band.name, color: band.color, rlevel, power };
  if (slot === 'weapon') item.element = ELEMENTS[Math.floor(rnd() * ELEMENTS.length)];
  if (slot !== 'weapon' && slot !== 'shield' && rnd() < 0.5) {
    const el = ['fire', 'cold', 'lightning', 'poison'][Math.floor(rnd() * 4)];
    item.resists = { [el]: 5 + Math.floor(rlevel / 10) };
  }
  item.fp = fingerprint(item); // cryptographic asset identity (§71)
  return item;
}

/* §75-77 piece merging: 3 same-slot same-band pieces -> one higher piece */
function mergePieces(avatarId, ids) {
  const a = db.avatars.find(x => x.id === avatarId); if (!a) return { ok: false, error: 'Avatar not found' };
  const items = (ids || []).map(id => a.inventory.find(i => i.id === id)).filter(Boolean);
  if (items.length !== 3 || new Set(items.map(i => i.id)).size !== 3) return { ok: false, error: 'Exactly 3 distinct owned pieces required' };
  if (new Set(items.map(i => i.slot)).size !== 1) return { ok: false, error: 'Pieces must share a slot' };
  if (new Set(items.map(i => i.rlevel)).size !== 1 && new Set(items.map(i => bandFor(i.rlevel).name)).size !== 1) return { ok: false, error: 'Pieces must share a rarity band' };
  const maxR = Math.max(...items.map(i => i.rlevel));
  const nb = nextBand(maxR);
  const rlevel = Math.min(100, nb ? nb.min + Math.floor(Math.random() * 3) : 100);
  if (rlevel <= maxR && nb) return { ok: false, error: 'Merge cannot advance rarity' };
  const rnd = mulberry32((Date.now() ^ 0x51ed) >>> 0);
  const out = rollLoot(rnd, a.level);
  out.slot = items[0].slot; out.kind = items[0].kind; out.rlevel = Math.max(rlevel, maxR + 1 > 100 ? 100 : Math.max(rlevel, maxR + 1));
  const b2 = bandFor(out.rlevel); out.rarity = b2.name; out.color = b2.color; out.power = Math.max(...items.map(i => i.power)) + 2;
  out.fp = fingerprint(out);
  if (allFingerprints(a).includes(out.fp)) return { ok: false, error: 'Anti-duplication: identical asset exists' };
  a.inventory = a.inventory.filter(i => !ids.includes(i.id)); // consume atomically
  a.inventory.push(out);
  save();
  return { ok: true, merged: out, consumed: ids };
}
function allFingerprints(a) {
  return a.inventory.map(i => i.fp).concat(Object.values(a.equipment).map(i => i.fp)).concat((a.pets || []).map(p => p.fp));
}

/* §79-81 pets */
const PET_SPECIES = ['Sabre Cat', 'Mudcrab', 'Clannfear Pup', 'Bone Hound', 'Wisp', 'Spriggan Sapling', 'Husky Wolf', 'Guar', 'Nix-Hound', 'Frost Sprite', 'Ember Whelp', 'Shadow Fox'];
function createPet(avatarId) {
  const a = db.avatars.find(x => x.id === avatarId); if (!a) return { ok: false, error: 'Avatar not found' };
  a.pets = a.pets || [];
  const rnd = mulberry32((Date.now() ^ 0xbeef) >>> 0);
  const pet = { id: 'pet' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36), species: PET_SPECIES[Math.floor(rnd() * PET_SPECIES.length)], name: PET_NAMES[Math.floor(rnd() * PET_NAMES.length)], rlevel: rollRLevel(rnd) };
  const b = bandFor(pet.rlevel); pet.rarity = b.name; pet.color = b.color;
  pet.fp = fingerprint(pet);
  a.pets.push(pet); save();
  return { ok: true, pet };
}
const PET_NAMES = ['Ash', 'Bristle', 'Cinder', 'Dusk', 'Ember', 'Fang', 'Gloom', 'Howl', 'Ick', 'Jinx', 'Krag', 'Lumen', 'Moss', 'Nib', 'Onyx', 'Prick', 'Quill', 'Runt', 'Snarl', 'Thorn'];
function mergePets(avatarId, ids) {
  const a = db.avatars.find(x => x.id === avatarId); if (!a) return { ok: false, error: 'Avatar not found' };
  a.pets = a.pets || [];
  const pets = (ids || []).map(id => a.pets.find(p => p.id === id)).filter(Boolean);
  if (pets.length !== 3 || new Set(pets.map(p => p.id)).size !== 3) return { ok: false, error: 'Exactly 3 distinct pets required' };
  if (new Set(pets.map(p => bandFor(p.rlevel).name)).size !== 1) return { ok: false, error: 'Pets must share a rarity band' };
  const maxR = Math.max(...pets.map(p => p.rlevel));
  const nb = nextBand(maxR);
  const rlevel = Math.min(100, Math.max(maxR + 1, nb ? nb.min : 100));
  const rnd = mulberry32((Date.now() ^ 0xfeed) >>> 0);
  const out = { id: 'pet' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36), species: pets[0].species, name: pets[0].name + ' Elder', rlevel };
  const b = bandFor(rlevel); out.rarity = b.name; out.color = b.color; out.fp = fingerprint(out);
  if (allFingerprints(a).includes(out.fp)) return { ok: false, error: 'Anti-duplication: identical pet exists' };
  a.pets = a.pets.filter(p => !ids.includes(p.id));
  a.pets.push(out); save();
  return { ok: true, merged: out };
}

/* ── Battle ───────────────────────────────────────────── */
/* §86: wager matches need a determinate, auditable result. Practice brawls
 * keep the plain 30-round cap with explicit draws; a wager match may opt into
 * the decision rule, where the higher remaining health fraction wins when no
 * knockout occurs. Exactly equal health is still a true draw (no settlement). */
function battle(aId, bId, seed, opts) {
  opts = opts || {};
  const a = db.avatars.find(x => x.id === aId);
  const b = db.avatars.find(x => x.id === bId);
  if (!a || !b) return { ok: false, error: 'Combatant not found' };
  if (aId === bId) return { ok: false, error: 'Cannot fight yourself' };
  const rnd = mulberry32(seed || (Date.now() ^ 0x9e3779b9) >>> 0);
  const ra = raceOf(a), rb = raceOf(b);
  const da = derived(a), dbx = derived(b);
  const st = {
    a: { hp: da.maxHP, mp: da.maxMP, stam: da.maxStam },
    b: { hp: dbx.maxHP, mp: dbx.maxMP, stam: dbx.maxStam }
  };
  const log = [];
  let rounds = 0, winnerId = null;

  const entry = (r, actor, text, extra) => log.push(Object.assign({ r, actor, text }, extra || {}));

  while (rounds < 30 && st.a.hp > 0 && st.b.hp > 0) {
    rounds++;
    const order = a.stats.dex + rnd() * 4 >= b.stats.dex + rnd() * 4 ? [['a', a, da, ra, st.a], ['b', b, dbx, rb, st.b]] : [['b', b, dbx, rb, st.b], ['a', a, da, ra, st.a]];
    for (const [key, av, dv, rv, sv] of order) {
      if (st.a.hp <= 0 || st.b.hp <= 0) break;
      const [okey, ov, odv, orv, osv] = key === 'a' ? ['b', b, dbx, rb, st.b] : ['a', a, da, ra, st.a];
      // regen perks
      const reg = perkVal(rv, 'regenerate');
      if (reg) sv.hp = Math.min(dv.maxHP, sv.hp + reg);
      sv.mp = Math.min(dv.maxMP, sv.mp + 4);
      sv.stam = Math.min(dv.maxStam, sv.stam + 5);

      const wantsSpell = dv.spell > dv.melee && sv.mp >= 8;
      const heavy = !wantsSpell && sv.stam >= 10 && rnd() < 0.3;
      let dmg, text, elem = 'physical';
      if (wantsSpell) {
        sv.mp -= 8;
        elem = dv.element === 'physical' ? 'magic' : dv.element;
        dmg = dv.spell + Math.floor(rnd() * 4);
        dmg = Math.round(dmg * (1 + perkVal(rv, 'arcana') / 100));
        av.skills.destruction.uses++;
        text = `${av.name} casts innate ${spellName(elem)} (${elem})`;
      } else {
        if (heavy) sv.stam -= 10;
        elem = dv.element;
        dmg = dv.melee + Math.floor(rnd() * 4);
        dmg = Math.round(dmg * (1 + (perkVal(rv, 'fury') + (heavy ? 50 : 0)) / 100));
        av.skills.unarmed.uses++;
        text = `${av.name} ${av.equipment.weapon ? 'strikes' : 'attacks unarmed'}${heavy ? ' with a heavy blow' : ''}`;
      }
      // dodge
      if (rnd() * 100 < odv.dodge) { entry(rounds, av.name, `${ov.name} dodges the attack.`); continue; }
      // block
      if (odv.block && rnd() * 100 < odv.block) { dmg = Math.max(1, Math.floor(dmg / 3)); entry(rounds, ov.name, `${ov.name} blocks! Damage reduced.`); }
      // crit
      let crit = false;
      if (rnd() * 100 < dv.crit) { dmg *= 2; crit = true; }
      // resist + defense
      const resist = elem === 'physical' || elem === 'magic' ? 0 : (odv.res[elem] || 0);
      dmg = Math.max(1, Math.round(dmg * (1 - resist / 100)) - Math.floor(odv.defense / 3));
      osv.hp -= dmg;
      // drain / venom perks
      if (perkVal(rv, 'drain')) sv.hp = Math.min(dv.maxHP, sv.hp + Math.ceil(dmg * perkVal(rv, 'drain') / 100));
      entry(rounds, av.name, `${text} — ${crit ? 'CRITICAL! ' : ''}${dmg} damage${resist ? ` (${resist}% resisted)` : ''}. ${ov.name} at ${Math.max(0, osv.hp)}/${odv.maxHP}.`, { dmg, crit, elem });
    }
  }
  let decision = null;
  if (st.a.hp > 0 && st.b.hp <= 0) winnerId = a.id;
  else if (st.b.hp > 0 && st.a.hp <= 0) winnerId = b.id;
  else if (st.a.hp <= 0 && st.b.hp <= 0) winnerId = null;
  else if (opts.decisionRule === true) {
    const fa = st.a.hp / da.maxHP, fb = st.b.hp / dbx.maxHP;
    if (Math.abs(fa - fb) > 1e-9) {
      winnerId = fa > fb ? a.id : b.id;
      decision = 'decision on remaining health';
      entry(rounds, 'arena', `Round cap reached — ${winnerId === a.id ? a.name : b.name} wins on remaining health (${(Math.max(fa, fb) * 100).toFixed(1)}% vs ${(Math.min(fa, fb) * 100).toFixed(1)}%).`, { decision: true });
    }
  }
  else if (rounds >= 30) winnerId = null; // draw: no settlement

  // skill growth (Skyrim use-based)
  for (const av of [a, b]) for (const sk of ['unarmed', 'destruction']) {
    const s = av.skills[sk];
    while (s.uses >= s.level * 5 && s.level < 100) { s.uses -= s.level * 5; s.level++; }
  }

  // rewards
  const rewards = {};
  if (winnerId) {
    const w = winnerId === a.id ? a : b, l = winnerId === a.id ? b : a;
    const gain = 40 + l.level * 15;
    w.xp += gain; l.record.losses++; w.record.wins++;
    l.xp += 10; // consolation: losses still teach (use-based skills already grew)
    rewards[winnerId] = { xp: gain, levelUps: 0, loot: null };
    while (w.xp >= w.level * 100) {
      w.xp -= w.level * 100; w.level++;
      const top = Object.entries(w.stats).sort((x, y) => y[1] - x[1])[0][0];
      for (const k in w.stats) w.stats[k] += k === top ? 2 : 1;
      rewards[winnerId].levelUps++;
    }
    if (rnd() < 0.6) {
      const loot = rollLoot(rnd, w.level);
      w.inventory.push(loot);
      rewards[winnerId].loot = loot;
    }
  } else { a.record.draws++; b.record.draws++; }

  const record = { id: 'bt' + Date.now().toString(36), ts: Date.now(), aId, bId, aName: a.name, bName: b.name, winnerId, draw: !winnerId, rounds, decision, log };
  db.battles.unshift(record);
  if (db.battles.length > 60) db.battles.length = 60;
  save();
  return { ok: true, battle: record, rewards, avatars: [publicAvatar(a), publicAvatar(b)] };
}
function spellName(elem) {
  return { fire: 'Flames', cold: 'Frostbite', lightning: 'Sparks', poison: 'Venom Spit', magic: 'Magicka Bolt', physical: 'Shock' }[elem] || 'Bolt';
}

/* ── Opponents & equipment ────────────────────────────── */
function makeRival(forId) {
  const me = db.avatars.find(x => x.id === forId);
  const race = RACES[Math.floor(Math.random() * RACES.length)];
  const names = ['Ashwalker', 'Bonepicker', 'Duskbane', 'Emberveil', 'Frosthowl', 'Grimward', 'Hexmaw', 'Ironvein', 'Khazid', 'Lorendil', 'Mothrah', 'Nightsong', 'Oathbreaker', 'Pyrelord', 'Quillback', 'Runebrand', 'Stormcrown', 'Thornheart', 'Umbra', 'Vexley', 'Wyrmbane', 'Ysolde', 'Zareth'];
  const level = Math.max(1, (me ? me.level : 1) + (Math.floor(Math.random() * 3) - 1));
  const a = {
    id: 'npc' + Date.now().toString(36) + Math.floor(Math.random() * 999),
    name: names[Math.floor(Math.random() * names.length)], raceId: race.id,
    level, xp: 0,
    stats: { str: race.s[0] + Math.floor(level / 2), dex: race.s[1] + Math.floor(level / 2), int: race.s[2] + Math.floor(level / 2), vit: race.s[3] + Math.floor(level / 2) },
    skills: { unarmed: { level: Math.min(20, level), uses: 0 }, destruction: { level: Math.min(20, level), uses: 0 } },
    equipment: {}, inventory: [],
    record: { wins: 0, losses: 0, draws: 0 }, npc: true, created: Date.now()
  };
  db.avatars.push(a); save();
  return { ok: true, rival: publicAvatar(a) };
}

function equip(avatarId, itemId) {
  const a = db.avatars.find(x => x.id === avatarId); if (!a) return { ok: false, error: 'Avatar not found' };
  const idx = a.inventory.findIndex(i => i.id === itemId); if (idx < 0) return { ok: false, error: 'Item not owned' };
  const item = a.inventory.splice(idx, 1)[0];
  const prev = a.equipment[item.slot];
  a.equipment[item.slot] = item;
  if (prev) a.inventory.push(prev);
  save();
  return { ok: true, avatar: publicAvatar(a) };
}
/* §86 Arena security: a wager match requires a verified, complete loadout.
 * This gate is the one the master spec describes (weapon, head, torso, both
 * hands, both feet) — practice brawls remain open for naked starts. */
function loadoutStatus(avatarId) {
  const a = db.avatars.find(x => x.id === avatarId); if (!a) return { ok: false, error: 'Avatar not found' };
  const missing = REQUIRED_LOADOUT.filter(slot => !a.equipment[slot]);
  return { ok: true, avatar: publicAvatar(a), required: REQUIRED_LOADOUT.slice(), missing, complete: missing.length === 0 };
}
/* Provision the missing required slots from the engine's own loot table.
 * Items are real engine items with real fingerprints — nothing is fabricated;
 * this only fills empty slots so a wager match can satisfy the gate. */
function equipLoadout(avatarId, opts) {
  opts = opts || {};
  const a = db.avatars.find(x => x.id === avatarId); if (!a) return { ok: false, error: 'Avatar not found' };
  const level = Number(opts.level) || 1;
  let seed = Number(opts.seed) || ((Date.now() ^ 0x9e37) >>> 0);
  const rnd = mulberry32(seed);
  const equipped = [];
  for (const slot of REQUIRED_LOADOUT) {
    if (a.equipment[slot]) continue;
    let item = rollLoot(rnd, level);
    let guard = 0;
    while (item.slot !== slot && guard++ < 200) item = rollLoot(rnd, level);
    if (item.slot !== slot) item = Object.assign({}, item, { slot, kind: SLOT_KIND(slot) });
    if (opts.maxRLevel) item.rlevel = Math.min(item.rlevel, opts.maxRLevel);
    a.equipment[slot] = item;
    equipped.push({ slot, item: item.name, rlevel: item.rlevel, fp: item.fp });
  }
  save();
  return { ok: true, avatar: publicAvatar(a), equipped, status: loadoutStatus(avatarId) };
}

function unequip(avatarId, slot) {
  const a = db.avatars.find(x => x.id === avatarId); if (!a) return { ok: false, error: 'Avatar not found' };
  const item = a.equipment[slot]; if (!item) return { ok: false, error: 'Slot empty' };
  delete a.equipment[slot];
  a.inventory.push(item);
  save();
  return { ok: true, avatar: publicAvatar(a) };
}

module.exports = {
  RACES, REQUIRED_LOADOUT, SLOTS, RARITY_LEVELS, bandFor, BANDS, BASES,
  TALENTS, unlockTalent, talentPoints,
  rawAvatar: id => db.avatars.find(x => x.id === id) || null,
  persist: save, rollLoot,
  list: () => db.avatars.filter(a => !a.npc).map(publicAvatar),
  get: id => { const a = db.avatars.find(x => x.id === id); return a ? publicAvatar(a) : null; },
  createAvatar, battle, makeRival, equip, unequip,
  mergePieces, createPet, mergePets,
  loadoutStatus, equipLoadout,
  history: () => db.battles.slice(0, 30)
};
