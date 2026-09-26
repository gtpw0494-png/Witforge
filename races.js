/* LIAM Arena — race registry.
 * 100 selectable races inspired by Skyrim, every Diablo version and the wider
 * Elder Scrolls / Diablo lore. Informational flavor only; mechanics are the
 * base stats (str, dex, int, vit), elemental resistances (fire, cold,
 * lightning, poison) and one innate perk. All avatars start UNEQUIPPED.
 */
'use strict';

// R(id, name, origin, family, skin, look, [str,dex,int,vit], [fire,cold,light,poison], [perkKey,perkVal], flavor)
function R(id, name, origin, family, skin, look, s, r, pk, fl) {
  return { id, name, origin, family, skin, look: look || {}, s, r, pk, fl };
}

const RACES = [
  /* ── Skyrim playable ten ─────────────────────────────── */
  R('nord', 'Nord', 'Skyrim', 'human', '#e8c39e', {}, [9, 6, 4, 9], [0, 50, 0, 0], ['frost', 15], 'Atmoran-descended warriors of the pale. Frost resistance 50, as in Skyrim.'),
  R('imperial', 'Imperial', 'Skyrim', 'human', '#dfb491', {}, [7, 7, 6, 7], [0, 0, 0, 0], ['stalwart', 8], 'Diplomats and legionnaires of Cyrodiil. Steady and fortunate.'),
  R('breton', 'Breton', 'Skyrim', 'human', '#e9c8a8', {}, [5, 6, 10, 6], [0, 0, 25, 0], ['mystic', 15], 'Mage-bloods of High Rock with innate magicka and shock resist.'),
  R('redguard', 'Redguard', 'Skyrim', 'human', '#8d5a3b', {}, [8, 9, 4, 8], [0, 0, 0, 25], ['swift', 8], 'Sword-singers of Hammerfell, swift and poison-hardened.'),
  R('altmer', 'High Elf (Altmer)', 'Skyrim', 'elf', '#d9c58f', { ears: 'point' }, [4, 6, 11, 5], [0, 0, 20, 0], ['arcana', 12], 'Altmer of the Summerset Isles, born with magicka to spare.'),
  R('bosmer', 'Wood Elf (Bosmer)', 'Skyrim', 'elf', '#c9a97e', { ears: 'point' }, [5, 11, 5, 6], [0, 0, 0, 25], ['deadly', 10], 'Valenwood archers of the Green Pact. Keen-eyed and lethal.'),
  R('dunmer', 'Dark Elf (Dunmer)', 'Skyrim', 'elf', '#9aa7b8', { ears: 'point', eyes: '#c33' }, [6, 7, 7, 7], [50, 0, 0, 0], ['ember', 12], 'Ashlanders of Morrowind. Ancestor-guarded, fire-resistant 50.'),
  R('orsimer', 'Orc (Orsimer)', 'Skyrim', 'orc', '#7fa06a', { tusks: true }, [11, 5, 4, 10], [0, 0, 0, 0], ['fury', 15], 'Forge-born of the strongholds. Berserker rage doubles the blow.'),
  R('argonian', 'Argonian', 'Skyrim', 'lizard', '#7d9464', { tail: true, ears: 'frill' }, [6, 7, 6, 8], [0, 20, 0, 50], ['regenerate', 3], 'Tree-born of Black Marsh. Disease and poison barely touch them.'),
  R('khajiit', 'Khajiit', 'Skyrim', 'cat', '#c8a06a', { ears: 'cat', tail: true }, [6, 10, 5, 6], [0, 0, 0, 0], ['swift', 12], 'Cat-people of Elsweyr. Claws count as unarmed weapons.'),

  /* ── Elder Scrolls lore (all versions) ───────────────── */
  R('maormer', 'Maormer', 'TES Lore', 'elf', '#a9c6b4', { ears: 'point' }, [5, 8, 7, 6], [0, 10, 20, 0], ['storm', 10], 'Sea elves of Pyandonea, storm-tamers of the southern ocean.'),
  R('ayleid', 'Ayleid', 'TES Lore', 'elf', '#cfd8e6', { ears: 'point', glow: '#9ff' }, [4, 6, 11, 6], [0, 0, 30, 0], ['arcana', 15], 'Star-elves of the first empire, wielders of light magic.'),
  R('aldmer', 'Aldmer', 'TES Lore', 'elf', '#d6c9a3', { ears: 'point' }, [5, 6, 10, 6], [0, 0, 20, 0], ['mystic', 12], 'The elder folk from whom all mer descend.'),
  R('chimer', 'Chimer', 'TES Lore', 'elf', '#c4b59a', { ears: 'point', eyes: '#da3' }, [6, 6, 8, 7], [10, 0, 0, 0], ['drain', 8], 'The changed folk of Veloth, before the curse of ash.'),
  R('dwemer', 'Dwemer', 'TES Lore', 'elf', '#b0876a', { ears: 'point', beard: true }, [9, 5, 8, 9], [20, 0, 0, 20], ['fury', 10], 'Deep elves of brass and tone. Their machines still hum below.'),
  R('falmer', 'Falmer', 'TES Lore', 'elf', '#b9c2cf', { ears: 'point', blind: true }, [7, 9, 4, 7], [0, 20, 0, 20], ['deadly', 12], 'Blinded snow elves of the deep places. They hear every step.'),
  R('tsaesci', 'Tsaesci', 'TES Lore', 'lizard', '#7d8fa8', { tail: true }, [6, 8, 7, 7], [0, 10, 0, 30], ['drain', 12], 'Snake vampires of Akavir who drank the dragons dry.'),
  R('kamal', 'Kamal', 'TES Lore', 'demon', '#9fb8d8', { horns: 'short' }, [8, 6, 6, 8], [0, 40, 0, 0], ['frost', 15], 'Snow demons of Akavir, riders of the freezing wind.'),
  R('tangmo', 'Tang Mo', 'TES Lore', 'beast', '#a8a06a', { ears: 'round' }, [7, 8, 5, 8], [0, 0, 0, 20], ['swift', 10], 'Monkey folk of the island kingdoms, quick and curious.'),
  R('kapotun', "Ka Po' Tun", 'TES Lore', 'dragon', '#e0a53f', { horns: 'tiger' }, [10, 8, 6, 9], [0, 0, 10, 0], ['fury', 12], 'Tiger-dragons of Akavir. Their toven-khu breathes fire.'),
  R('sload', 'Sload', 'TES Lore', 'lizard', '#8f9a5a', { tail: true }, [5, 4, 9, 9], [0, 0, 0, 50], ['venom', 15], 'Bloated schemers of Thras, plague-bearers of the abyss.'),
  R('dreugh', 'Dreugh', 'TES Lore', 'beast', '#7a6a4f', { horns: 'crab' }, [10, 5, 5, 10], [0, 20, 0, 30], ['fury', 10], 'Crustacean tyrants of the Lyth, cruel and ancient.'),
  R('histkin', 'Hist-Kin', 'TES Lore', 'lizard', '#6f8a5f', { tail: true, glow: '#7f6' }, [6, 6, 8, 8], [0, 0, 0, 30], ['regenerate', 4], 'Sap-touched descendants of the sentient trees of Black Marsh.'),
  R('frosgiant', 'Frost Giant', 'TES Lore', 'giant', '#b9c6d8', { horns: 'short' }, [12, 4, 3, 12], [0, 50, 0, 0], ['stalwart', 15], 'Atmoran giants of the frost fields. Their clubs fell mammoths.'),
  R('goblin', 'Goblin', 'TES Lore', 'beast', '#7fa050', { ears: 'point', tusks: true }, [6, 7, 4, 6], [0, 0, 0, 10], ['swift', 8], 'Swarming tribe-folk of every coast and cave.'),
  R('ogre', 'Ogre', 'TES Lore', 'giant', '#98a06a', { tusks: true }, [11, 4, 3, 10], [0, 0, 0, 0], ['fury', 12], 'Hulking mercenaries with appetites to match.'),
  R('harpy', 'Harpy', 'TES Lore', 'beast', '#b09a7a', { wings: true }, [5, 10, 4, 6], [0, 0, 10, 0], ['swift', 12], 'Winged scavengers of the cliffs, shrieking thieves of the air.'),
  R('dremora', 'Dremora', 'TES Lore', 'daedra', '#5a4a52', { horns: 'ram' }, [9, 7, 6, 8], [30, 0, 0, 0], ['fury', 12], 'Bound knights of the Daedric courts, honor-bound to the pact.'),
  R('flameatronach', 'Flame Atronach', 'TES Lore', 'construct', '#d86a3a', { glow: '#f80' }, [7, 5, 8, 8], [75, -25, 0, 0], ['ember', 20], 'Conjured fire made flesh. Cold is its undoing.'),
  R('frostatronach', 'Frost Atronach', 'TES Lore', 'construct', '#9fc8e8', { glow: '#6cf' }, [8, 4, 8, 8], [-25, 75, 0, 0], ['frost', 20], 'Conjured ice with a beating core of winter.'),
  R('stormatronach', 'Storm Atronach', 'TES Lore', 'construct', '#8f8fd8', { glow: '#ff6' }, [7, 6, 9, 8], [0, 0, 75, 0], ['storm', 20], 'Conjured thunder, crackling with borrowed lightning.'),
  R('werebear', 'Werebear', 'TES Lore', 'beast', '#7a5a3f', { ears: 'round' }, [12, 5, 3, 11], [0, 20, 0, 0], ['stalwart', 12], 'Lycanthropes of the ice coasts, rarer and fiercer than wolves.'),
  R('werelion', 'Werelion', 'TES Lore', 'beast', '#c8a050', { ears: 'cat' }, [10, 8, 3, 9], [0, 0, 0, 0], ['fury', 12], 'Pride-lycanthropes of the southern plains.'),
  R('werecrocodile', 'Werecrocodile', 'TES Lore', 'lizard', '#6f8a52', { tail: true }, [10, 6, 3, 10], [0, 0, 0, 30], ['drain', 10], 'Scaled lycanthropes of the marshes, patient and sudden.'),
  R('imga', 'Imga', 'TES Lore', 'beast', '#a89a6a', { ears: 'round' }, [5, 7, 6, 6], [0, 0, 0, 10], ['arcana', 8], 'Ape-folk of Valenwood who shave and gild themselves to mimic mer.'),
  R('vampirelord', 'Vampire Lord', 'TES Lore', 'undead', '#cfd4de', { eyes: '#c33', fangs: true }, [8, 8, 9, 6], [25, 25, 0, 25], ['drain', 15], 'Blooded nobility of Molag Bal. The sun is their only master.'),
  R('dragonborn', 'Dragonborn (Dovahkin)', 'TES Lore', 'dragon', '#d8b48f', { glow: '#fc6' }, [8, 7, 8, 8], [10, 10, 0, 0], ['fury', 10], 'Mortal flesh with a dragon soul. The Thu’um sleeps in the throat.'),
  R('feralwerewolf', 'Feral Werewolf', 'TES Lore', 'beast', '#6a6a72', { ears: 'cat', fangs: true }, [10, 9, 3, 9], [0, 10, 0, 0], ['swift', 10], 'Hircine’s hunt made flesh under the moon.'),
  R('clannfear', 'Clannfear', 'TES Lore', 'daedra', '#7a8a50', { horns: 'crab', tail: true }, [8, 8, 3, 8], [20, 0, 0, 20], ['fury', 10], 'Lizard-daedra of the Deadlands, fast and vicious.'),
  R('wingedtwilight', 'Winged Twilight', 'TES Lore', 'daedra', '#7a6ad8', { wings: true }, [6, 9, 6, 7], [0, 0, 20, 0], ['swift', 12], 'Harpy-daedra of Oblivion’s dusk, shrieking messengers.'),
  R('spiderdaedra', 'Spider Daedra', 'TES Lore', 'daedra', '#5a6a5f', { eyes: '#f33' }, [7, 8, 6, 7], [0, 0, 0, 40], ['venom', 15], 'Weavers of the void, mothers of schemes.'),
  R('goldensaint', 'Golden Saint', 'TES Lore', 'daedra', '#d8b450', { glow: '#fd6' }, [8, 7, 7, 8], [20, 0, 20, 0], ['arcana', 10], 'Aureal wardens of shining order.'),
  R('hunger', 'Hunger', 'TES Lore', 'daedra', '#506a8a', { horns: 'short' }, [9, 6, 6, 8], [0, 0, 20, 0], ['drain', 12], 'Starved daedra of blue flesh and endless appetite.'),
  R('dovah', 'Dragon (Dovah)', 'Skyrim', 'dragon', '#8a9a6a', { wings: true, horns: 'dragon' }, [11, 6, 9, 10], [25, 25, 0, 0], ['storm', 15], 'Fragments of Akatosh. Words are their weapons.'),
  R('hagraven', 'Hagraven-Kin', 'Skyrim', 'beast', '#5f5a68', { wings: true }, [6, 6, 9, 7], [0, 0, 0, 20], ['arcana', 12], 'Witch-corvids of the covens, traders in flesh and charm.'),
  R('riekling', 'Riekling', 'Skyrim', 'beast', '#7f9ab0', { tusks: true }, [6, 7, 4, 6], [0, 30, 0, 0], ['swift', 8], 'Blue-skinned scavengers of Solstheim, spear-sharp and stubborn.'),
  R('icewraithkin', 'Ice Wraith-Kin', 'Skyrim', 'undead', '#bcd8e8', { glow: '#9ef', tail: true }, [5, 9, 7, 6], [0, 50, 0, 0], ['frost', 15], 'Spectral serpent-kin of the frozen pools, shimmering with cold light.'),
  R('suthay', 'Suthay-raht', 'TES Lore', 'cat', '#b98f5f', { ears: 'cat', tail: true }, [5, 10, 6, 6], [0, 0, 0, 0], ['swift', 12], 'Agile khajiit breed, twin-mooned dancers of the ja-Kha’jay.'),
  R('ohmes', 'Ohmes-raht', 'TES Lore', 'cat', '#d8b48f', { ears: 'cat' }, [5, 8, 7, 6], [0, 0, 0, 0], ['arcana', 8], 'Khajiit breed closest to mer in form, tattoed and courtly.'),
  R('dagi', 'Dagi-raht', 'TES Lore', 'cat', '#c89a6a', { ears: 'cat', tail: true }, [4, 11, 6, 5], [0, 0, 0, 0], ['swift', 14], 'Small tree-dwelling khajiit breed, quick as thought.'),
  R('senche', 'Senche-raht', 'TES Lore', 'cat', '#a87f4f', { ears: 'cat' }, [10, 6, 5, 10], [0, 0, 0, 0], ['stalwart', 12], 'Great leopard-khajiit, mounts of the lunar lattice.'),
  R('skaafven', 'Skaafven', 'TES Lore', 'cat', '#8a7a6a', { ears: 'cat', fangs: true }, [7, 9, 4, 7], [0, 0, 0, 0], ['deadly', 10], 'Werecats of the shadowed paths, silent as snowfall.'),
  R('wereboar', 'Wereboar', 'TES Lore', 'beast', '#8a6a5a', { tusks: true }, [11, 5, 3, 10], [0, 0, 0, 10], ['stalwart', 12], 'Tusked lycanthropes, unstoppable on the charge.'),
  R('werevulture', 'Werevulture', 'TES Lore', 'beast', '#6a6258', { wings: true }, [6, 9, 4, 7], [0, 0, 0, 10], ['swift', 10], 'Carrion lycanthropes of the high crags.'),

  /* ── Diablo bloodlines (classes of every version) ────── */
  R('d1warrior', 'Warrior (Diablo I)', 'Diablo', 'human', '#dfb491', {}, [11, 6, 4, 10], [0, 0, 0, 0], ['fury', 12], 'The last knight of Tristram. Strength is the only argument.'),
  R('d1rogue', 'Rogue (Diablo I)', 'Diablo', 'human', '#e0c0a0', {}, [6, 11, 5, 7], [0, 0, 0, 0], ['deadly', 12], 'Sister of the Sightless Eye. Every arrow finds its mark.'),
  R('d1sorcerer', 'Sorcerer (Diablo I)', 'Diablo', 'human', '#e6cba6', { glow: '#69f' }, [4, 6, 12, 5], [10, 10, 10, 0], ['arcana', 18], 'Vizjeri student of the pure elements. Glass, but glorious.'),
  R('barbarian', 'Barbarian', 'Diablo', 'human', '#d8a878', { beard: true }, [12, 6, 3, 11], [0, 10, 0, 0], ['fury', 15], 'Arreat’s mountain sons. Wrath made flesh.'),
  R('paladin', 'Paladin', 'Diablo', 'human', '#e2c09a', { glow: '#fd9' }, [9, 6, 8, 9], [10, 0, 20, 0], ['stalwart', 12], 'Zakarum’s crusading light, shield and zeal.'),
  R('amazon', 'Amazon', 'Diablo', 'human', '#c99a6a', {}, [7, 11, 5, 8], [0, 0, 0, 0], ['deadly', 12], 'Skovos spear-daughters, trained since first breath.'),
  R('necromancer', 'Necromancer', 'Diablo', 'human', '#d9cdb8', { glow: '#9c6' }, [5, 6, 11, 6], [0, 20, 0, 25], ['drain', 12], 'Rathma’s priests of the balance, readers of bone.'),
  R('sorceress', 'Sorceress', 'Diablo', 'human', '#e8cba8', { glow: '#6cf' }, [3, 7, 12, 5], [15, 15, 15, 0], ['arcana', 18], 'Elemental prodigy of the sisterhood. Blink, burn, be gone.'),
  R('druid', 'Druid', 'Diablo', 'human', '#cfae83', { horns: 'antler' }, [8, 6, 9, 8], [10, 10, 0, 10], ['regenerate', 4], 'Fiacla-Gear’s storm-tenders, friends to beast and gale.'),
  R('assassin', 'Assassin', 'Diablo', 'human', '#d8b896', {}, [6, 12, 6, 7], [0, 0, 10, 0], ['deadly', 15], 'Viz-Jaq’tar shadow-walkers. The trap is already set.'),
  R('wizard', 'Wizard', 'Diablo', 'human', '#e4c6a4', { glow: '#c6f' }, [4, 7, 12, 6], [10, 10, 10, 0], ['arcana', 16], 'Caldeum’s arcane theorists, bending reality by formula.'),
  R('witchdoctor', 'Witch Doctor', 'Diablo', 'human', '#9a7a52', { glow: '#7d5' }, [5, 6, 11, 7], [0, 0, 0, 30], ['venom', 15], 'Umbaru spirit-speakers of the unformed land.'),
  R('monk', 'Monk', 'Diablo', 'human', '#d3a87e', {}, [8, 10, 7, 8], [0, 0, 20, 0], ['swift', 12], 'Ivgorode’s faithful fists, each strike a prayer.'),
  R('crusader', 'Crusader', 'Diablo', 'human', '#e0bf9c', { glow: '#fe9' }, [10, 5, 8, 10], [0, 0, 25, 0], ['stalwart', 15], 'Akkhan’s armored evangelists, law given weight.'),
  R('demonhunter', 'Demon Hunter', 'Diablo', 'human', '#d6b294', {}, [6, 12, 6, 7], [10, 0, 0, 0], ['deadly', 14], 'Vengeance disciplined. Hatred, aimed.'),
  R('spiritborn', 'Spiritborn', 'Diablo IV', 'human', '#b98f66', { glow: '#9f6' }, [8, 9, 7, 8], [0, 0, 0, 20], ['swift', 14], 'Nahantu’s vessel of guardian spirits, striking as four.'),
  R('nephalem', 'Nephalem', 'Diablo', 'human', '#e8d3ae', { glow: '#fff' }, [10, 9, 10, 9], [10, 10, 10, 10], ['arcana', 12], 'First children of angel and demon. Power that frightened heaven and hell alike.'),

  /* ── Diablo creatures ────────────────────────────────── */
  R('fallen', 'Fallen', 'Diablo', 'demon', '#c96a3a', { eyes: '#f60' }, [5, 8, 3, 5], [30, 0, 0, 0], ['swift', 8], 'Shrieking devilkin. They flee; they swarm; they return.'),
  R('carver', 'Carver', 'Diablo', 'demon', '#d87848', { eyes: '#f60' }, [6, 8, 3, 6], [30, 0, 0, 0], ['fury', 8], 'Fallen-kin with crude blades and crueler intent.'),
  R('goatman', 'Goatman', 'Diablo', 'beast', '#8a6a4f', { horns: 'goat' }, [9, 7, 4, 8], [10, 0, 0, 0], ['fury', 10], 'Horned brutes of the foothills, ritual-scared and strong.'),
  R('gargoyle', 'Gargoyle', 'Diablo', 'demon', '#7a7f8a', { wings: true }, [8, 7, 4, 8], [20, 0, 0, 0], ['stalwart', 10], 'Stone-skinned swoopers of the cathedral dark.'),
  R('grotesque', 'Grotesque', 'Diablo', 'demon', '#b08a7a', {}, [8, 5, 3, 9], [0, 0, 0, 30], ['drain', 10], 'Bloated brood-mothers, poisonous to the last.'),
  R('balrog', 'Balrog', 'Diablo', 'demon', '#8a3a2f', { wings: true, horns: 'ram' }, [11, 6, 7, 10], [50, 0, 0, 0], ['ember', 18], 'Hell’s armored incendiaries, wrath in plate.'),
  R('pitlord', 'Pit Lord', 'Diablo', 'demon', '#a04a3a', { horns: 'ram', tusks: true }, [12, 5, 6, 11], [40, 0, 0, 0], ['fury', 15], 'Overlords of the pit, generals of the burn.'),
  R('overlord', 'Overlord (Diablo I)', 'Diablo', 'demon', '#7a4a52', { horns: 'short' }, [11, 5, 5, 10], [30, 0, 10, 0], ['stalwart', 12], 'Cathedral tyrants of the first descent.'),
  R('advocate', 'Advocate', 'Diablo', 'demon', '#8a5a6a', { horns: 'short' }, [8, 6, 8, 8], [20, 0, 20, 0], ['arcana', 10], 'Cold counselors of the hellish court.'),
  R('restlessdead', 'Restless Dead', 'Diablo', 'undead', '#cfd4d8', { eyes: '#6f9' }, [7, 5, 4, 8], [0, 20, 0, 50], ['stalwart', 10], 'Skeleton legion of the catacombs. They do not tire.'),
  R('risen', 'Risen', 'Diablo', 'undead', '#9aa88a', { fangs: true }, [8, 4, 3, 9], [0, 10, 0, 50], ['drain', 8], 'Shambling flesh of the fallen fields.'),
  R('succubus', 'Succubus', 'Diablo', 'demon', '#c86a8a', { wings: true, horns: 'short' }, [5, 9, 9, 6], [30, 0, 0, 0], ['drain', 12], 'Hell’s tempters, lashing flame and will.'),
  R('nightmarauder', 'Night Marauder', 'Diablo', 'demon', '#5a4a68', { eyes: '#f0f' }, [6, 9, 7, 6], [0, 0, 20, 0], ['swift', 10], 'Veiled stalkers of the dreamless dark.'),
  R('serpentmagus', 'Serpent Magus', 'Diablo', 'lizard', '#6a8a6a', { tail: true }, [5, 6, 11, 7], [0, 0, 0, 40], ['venom', 15], 'Coiled spell-ducks of the jungle ziggurats.'),
  R('cathedralknight', 'Cathedral Knight', 'Diablo', 'undead', '#8a929a', { glow: '#9cf' }, [10, 6, 5, 10], [0, 10, 10, 0], ['stalwart', 12], 'Oath-bound dead of the drowned cathedral.'),
  R('reaver', 'Reaver', 'Diablo', 'demon', '#a05a4a', { tusks: true }, [10, 8, 4, 9], [20, 0, 0, 0], ['fury', 12], 'Hell’s skirmishers, blades of the blood road.'),
  R('quillfiend', 'Quill Fiend', 'Diablo', 'beast', '#b08a5a', {}, [6, 8, 3, 7], [0, 0, 0, 30], ['venom', 10], 'Porcupine devils that loose a storm of quills.'),
  R('sandleaper', 'Sand Leaper', 'Diablo', 'beast', '#c8a878', {}, [6, 10, 3, 6], [10, 0, 0, 10], ['swift', 12], 'Skittering desert scavengers, quick as heat-shimmer.'),
  R('vulturedemon', 'Vulture Demon', 'Diablo', 'beast', '#7a6a5a', { wings: true }, [6, 9, 4, 6], [10, 0, 0, 0], ['swift', 10], 'Carrion wings over the wastes, diving talons.'),
  R('fleshhound', 'Flesh Hound', 'Diablo', 'demon', '#8a5a5a', { fangs: true }, [8, 9, 3, 8], [20, 0, 0, 0], ['drain', 10], 'Hell’s tracking beasts, nosing out fear.'),
  R('cannibal', 'Cannibal', 'Diablo IV', 'beast', '#b09078', { fangs: true }, [9, 7, 3, 9], [0, 0, 0, 20], ['fury', 10], 'Feral cult-flesh of the scarred coast, hungry always.'),
  R('golemforged', 'Golem-Forged', 'Diablo', 'construct', '#9a8a7a', { glow: '#f96' }, [11, 4, 6, 11], [20, 20, 0, 50], ['stalwart', 15], 'Clay and bone given purpose by Rathma’s art.'),
  R('lich', 'Lich', 'Diablo', 'undead', '#c8ccd4', { glow: '#6f9', eyes: '#6f9' }, [5, 5, 12, 7], [0, 30, 0, 50], ['drain', 15], 'Bone-throned masters of the corpse road.'),

  /* ── Planar & transformed ────────────────────────────── */
  R('angel', 'Angel of the High Heavens', 'Diablo', 'angel', '#e8e2d0', { wings: true, glow: '#fff' }, [9, 8, 10, 9], [25, 0, 25, 0], ['arcana', 12], 'Light incarnate, armored in conviction.'),
  R('demon', 'Demon of the Burning Hells', 'Diablo', 'demon', '#a03a2f', { horns: 'ram', tail: true }, [10, 7, 8, 9], [50, 0, 0, 20], ['ember', 15], 'Hatred’s foot-soldier, smoke and spite.'),
  R('lichking', 'Death-Crowned Lich', 'Diablo', 'undead', '#b8c4d0', { glow: '#6cf', eyes: '#6cf' }, [7, 5, 12, 8], [0, 40, 0, 50], ['frost', 15], 'A crown, a curse, a court of the dead.'),
  R('irongolem', 'Iron Golem-Born', 'Diablo', 'construct', '#8a8f96', {}, [12, 4, 5, 11], [10, 10, 10, 10], ['stalwart', 14], 'Born of a summoned frame; the forge is its memory.'),
  R('bloodknight', 'Blood Knight of the Coven', 'TES Lore', 'undead', '#d0c8d4', { fangs: true, eyes: '#c33' }, [9, 7, 8, 7], [20, 0, 0, 20], ['drain', 12], 'Sworn vampiric duelists of the hidden courts.'),
  R('moonsinger', 'Moon-Singer of the Twin Choir', 'TES Lore', 'elf', '#cfd4e2', { ears: 'point', glow: '#ccf' }, [5, 7, 11, 6], [0, 20, 20, 0], ['mystic', 15], 'Night-elves who hymn the moons and borrow their light.')
];

module.exports = { RACES };
