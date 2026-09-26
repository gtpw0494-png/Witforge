/* LIAM piece art (v1.91.0) — a deterministic picture for every piece. */
'use strict';
/* Every avatar piece carries a cryptographic identity (fp, §71); its picture
 * is derived from that same identity, so art is PER-SPEC: same piece → same
 * image forever, everywhere it renders; distinct pieces → distinct sigils.
 * Honest labelling, stated where the code lives: these are procedural sigil
 * portraits (zero dependency, works offline, nothing leaves the machine) —
 * not AI-painted art. Provider-generated art stays an available upgrade via
 * Puter when connectivity allows (spec C(69)); the product never passes
 * procedural sigils off as AI paintings.
 *
 * Art is computed at read time and NEVER persisted — state stores the piece;
 * the picture derives. attach() returns a copy; the database record is
 * untouched.
 */

function create() {
  /* ── tiny deterministic pipeline ── */
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [168, 148, 255];
  }
  function rgb(c, f) {
    return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v * f)))).map(v => v.toString(16).padStart(2, '0')).join('');
  }

  const BAND_RANK = { Normal: 1, Magic: 2, Rare: 3, Legendary: 4, Set: 5, Mythic: 6, Common: 1, Uncommon: 2, Epic: 4 };

  /* ── motif families: one sigil shape per slot family, drawn in strokes ── */
  function motifPath(slot) {
    switch (String(slot || '')) {
      case 'weapon': return '<path d="M60 20 L68 28 L36 60 L44 68 L76 36 L84 44 L56 76 L48 84 L40 76 L20 56 L28 48 Z"/><rect x="52" y="46" width="30" height="7" rx="3" transform="rotate(-45 52 46)"/>';
      case 'shield': return '<path d="M48 14 L78 24 V50 C78 68 66 80 48 86 C30 80 18 68 18 50 V24 Z"/><path d="M48 22 L70 29 V49 C70 61 61 71 48 77 C35 71 26 61 26 49 V29 Z" fill-opacity="0.35"/>';
      case 'head': return '<path d="M28 74 V52 C28 33 36 20 48 20 C60 20 68 33 68 52 V74 Z"/><rect x="28" y="60" width="40" height="7" rx="3" fill-opacity="0.4"/><circle cx="48" cy="42" r="6" fill-opacity="0.5"/>';
      case 'torso': return '<path d="M32 22 L44 16 H52 L64 22 L74 34 L66 40 V78 H30 V40 L22 34 Z"/><path d="M48 22 V78" stroke-opacity="0.45" stroke-width="3" fill="none"/>';
      case 'hand_l': case 'hand_r': return '<path d="M34 70 C30 56 30 40 38 30 L42 38 C37 46 37 58 40 68 Z M46 72 C42 56 42 34 50 26 L54 34 C49 44 49 60 52 70 Z M58 70 C55 56 56 38 62 30 L66 38 C62 46 62 58 64 66 Z"/><rect x="30" y="66" width="38" height="10" rx="5"/>';
      case 'foot_l': case 'foot_r': return '<path d="M40 20 H58 V56 L70 66 C74 69 72 76 66 76 H34 C28 76 26 70 30 66 L40 56 Z"/><rect x="40" y="28" width="18" height="6" rx="3" fill-opacity="0.45"/>';
      case 'arm_upper_l': case 'arm_upper_r': return '<path d="M34 26 H62 L58 42 H38 Z M38 46 H58 L54 62 H42 Z M42 66 H54 L50 78 H46 Z"/>';
      case 'leg_upper_l': case 'leg_upper_r': return '<path d="M38 20 H58 L62 40 H34 Z M34 44 H62 L58 62 H38 Z M38 66 H58 L54 80 H42 Z"/>';
      case 'pet': return '<circle cx="48" cy="54" r="18"/><circle cx="34" cy="34" r="7"/><circle cx="48" cy="28" r="7"/><circle cx="62" cy="34" r="7"/><circle cx="43" cy="50" r="3" fill-opacity="0.4"/><circle cx="53" cy="50" r="3" fill-opacity="0.4"/>';
      case 'aura': case 'cosmetic': default: return '<circle cx="48" cy="48" r="26" fill-opacity="0.25"/><circle cx="48" cy="48" r="18" fill-opacity="0.5"/><circle cx="48" cy="48" r="9"/>';
    }
  }

  /* ── the portrait ── */
  function artFor(piece) {
    piece = piece || {};
    const seedStr = String(piece.fp || piece.id || ((piece.slot || '?') + ':' + (piece.rarity || '?') + ':' + (piece.name || '?')));
    const seed = fnv1a(seedStr);
    const rnd = mulberry(seed);
    const base = hexToRgb(piece.color);
    const accent = rgb(base, 1.15);
    const glow = rgb(base, 0.5);
    const dark = '#120a1c';
    const plaque = '#1d1230';
    const motif = motifPath(piece.slot === 'pet' || piece.species ? 'pet' : piece.slot);
    const tier = BAND_RANK[piece.rarity] || Math.max(1, Math.min(6, Math.ceil((Number(piece.rlevel) || 1) / 16)));
    /* sparkles: deterministic positions from the identity */
    let spark = '';
    for (let i = 0; i < tier + 2; i++) {
      const x = 12 + Math.floor(rnd() * 72), y = 10 + Math.floor(rnd() * 26), r = 0.8 + rnd() * 1.4;
      spark += '<circle cx="' + x + '" cy="' + y + '" r="' + (Math.round(r * 10) / 10) + '" fill="' + accent + '" opacity="' + (0.35 + Math.round(rnd() * 45) / 100) + '"/>';
    }
    let pips = '';
    for (let i = 0; i < tier; i++) pips += '<rect x="' + (48 - tier * 6 + i * 12) + '" y="86" width="9" height="4" rx="2" fill="' + accent + '"/>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="' +
      String(piece.name || piece.slot || 'piece').replace(/[&<>"]/g, '') + '">' +
      '<defs><radialGradient id="g" cx="50%" cy="38%" r="75%"><stop offset="0%" stop-color="' + plaque + '"/><stop offset="100%" stop-color="' + dark + '"/></radialGradient>' +
      '<filter id="f" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter></defs>' +
      '<rect width="96" height="96" rx="14" fill="url(#g)"/>' +
      '<rect x="2.5" y="2.5" width="91" height="91" rx="12" fill="none" stroke="' + accent + '" stroke-opacity="0.65" stroke-width="2.5"/>' +
      '<g fill="' + accent + '">' + motif + '</g>' +
      '<g fill="' + glow + '" filter="url(#f)" opacity="0.8">' + motif + '</g>' + spark + pips +
      '</svg>';
    return { svg, dataUri: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), band: piece.rarity || null, tier, accent, seed: seed.toString(36) };
  }

  /* attach() → shallow copy with .art; input (the db record) never mutated */
  function attach(item) {
    if (!item || typeof item !== 'object') return item;
    return Object.assign({}, item, { art: artFor(item) });
  }
  function attachDeep(avatar) {
    if (!avatar || typeof avatar !== 'object') return avatar;
    const out = Object.assign({}, avatar);
    if (Array.isArray(out.inventory)) out.inventory = out.inventory.map(attach);
    if (out.equipment && typeof out.equipment === 'object') {
      const eq = {};
      for (const slot of Object.keys(out.equipment)) eq[slot] = out.equipment[slot] ? attach(out.equipment[slot]) : out.equipment[slot];
      out.equipment = eq;
    }
    if (Array.isArray(out.pets)) out.pets = out.pets.map(p => attach(Object.assign({ slot: 'pet' }, p)));
    return out;
  }

  return { artFor, attach, attachDeep, BAND_RANK };
}

module.exports = { create };
