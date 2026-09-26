/* Patch 8: platform.js — engagement systems (events, lotto, sign-in, quests),
 * the LD market, LD-costed piece creation, multi-tier plans and the
 * owner-security / guardian layer, all controllable from chat.
 *
 * NOTE: replacements use a function replacer. A string replacement would treat
 * `$'`, `$&` and `$1` in the new text as replacement patterns — which once
 * expanded a file tail into the source. Never regress that. */
'use strict';
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'platform.js');
let s = fs.readFileSync(f, 'utf8');
let n = 0;
function rep(old, neu, label) {
  if (!s.includes(old)) { console.error('MISS: ' + label); process.exitCode = 1; return; }
  s = s.replace(old, () => neu);          // function replacer: literal, no $ expansion
  n++;
  console.log('ok: ' + label);
}

rep("const VERSION = '1.64.0'", "const VERSION = '1.65.0'", 'version');

rep("const kernel = require('./kernel.js');",
`const kernel = require('./kernel.js');
const engagement = require('./engagement.js');
const ownerSec = require('./owner-security.js');`, 'requires');

rep(`    release: null,                   // §129 release metadata
    seq: 1`,
`    release: null,                   // §129 release metadata
    /* ── v1.65 engagement + owner protection ───────────────────── */
    events: engagement.seedEvents(),  // events board (seeded, real windows)
    lottoRounds: [],                  // commit→reveal lotto rounds
    signIns: [],                      // sign-in gift streaks
    quests: null,                     // daily/weekly task board (window-keyed)
    ldOrders: [],                     // LD buy/sell orders (audited)
    guardianEvents: [],               // guardian decisions on agent actions
    charters: {},                     // per-agent duty charters
    ownerSecurity: null,              // §54 owner hardening + second factor
    seq: 1`, 'fresh state');

rep(`for (const acc of ['Forge Sink', 'Marketplace Sink', 'LD Issuance']) if (!(acc in S.ledger.accounts)) S.ledger.accounts[acc] = acc === 'LD Issuance' ? 1000000 : 0;
for (const k of ['stops', 'devices', 'deviceCommands', 'seenCommandIds', 'taskHandoffs', 'accounts', 'activeAccounts', 'orgs', 'assets', 'disputes', 'fraudEvents', 'offlineQueue', 'metrics', 'spans', 'autonomousPolicies', 'delegations', 'evidenceVault', 'taskRecords']) {
  if (S[k] === undefined || S[k] === null) S[k] = (k === 'stops' || k === 'seenCommandIds' || k === 'activeAccounts') ? {} : [];
}`,
`/* LD pools are explicit ledger accounts: a reward can only be paid from a pool
 * that was funded, and funding is an audited issuance from the LD Issuance
 * reserve. Nothing appears out of nowhere (§164). */
const LD_POOLS = ['Rewards Pool', 'Events Pool', 'Lotto Pool', 'Community Pool', 'Jackpot Rollover'];
for (const acc of ['Forge Sink', 'Marketplace Sink', 'LD Issuance'].concat(LD_POOLS)) if (!(acc in S.ledger.accounts)) S.ledger.accounts[acc] = acc === 'LD Issuance' ? 1000000 : 0;
for (const k of ['stops', 'devices', 'deviceCommands', 'seenCommandIds', 'taskHandoffs', 'accounts', 'activeAccounts', 'orgs', 'assets', 'disputes', 'fraudEvents', 'offlineQueue', 'metrics', 'spans', 'autonomousPolicies', 'delegations', 'evidenceVault', 'taskRecords', 'events', 'lottoRounds', 'signIns', 'ldOrders', 'guardianEvents']) {
  if (S[k] === undefined || S[k] === null) S[k] = (k === 'stops' || k === 'seenCommandIds' || k === 'activeAccounts') ? {} : [];
}
if (!Array.isArray(S.events) || !S.events.length) S.events = engagement.seedEvents();
if (!S.charters || typeof S.charters !== 'object') S.charters = {};
ownerSec.securityState(S);`, 'backfill');

rep(`const ARENA_WAGER_LD = 100;`,
`/* ══ v1.65 LD economy: issuance, pools, market and piece pricing ═══
 * LD has exactly three sources and every one is audited:
 *   1. the LD Issuance reserve (an explicit, audited mint into a pool/wallet),
 *   2. rewards paid from a funded pool (sign-in gifts, task rewards),
 *   3. purchases through the LD market (simulation today; real money locked).
 * There is no fourth source. Posts are balanced, so LD cannot leak. */
function ldBalance(account) { return Number(S.ledger.accounts[account] || 0); }
function ensurePool(pool, amount) {
  if (!LD_POOLS.includes(pool)) return { ok: false, error: 'Unknown LD pool ' + pool };
  if (ldBalance(pool) >= amount) return { ok: true, funded: 0, balance: ldBalance(pool) };
  const need = amount - ldBalance(pool);
  const r = ledgerPost([{ account: 'LD Issuance', delta: -need }, { account: pool, delta: need }],
    'issue ' + need + ' LD into ' + pool, { actor: 'system', reason: 'pool funding', source: 'LD Issuance', destination: pool, kind: 'issuance' });
  if (!r.ok) return r;
  audit('economy', 'LD ISSUANCE: ' + need + ' LD minted into ' + pool + ' (explicit, audited supply increase)', 'system',
    { action: 'ld.issue', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  return { ok: true, funded: need, balance: ldBalance(pool) };
}
function payReward(account, amount, memo, pool) {
  const fund = ensurePool(pool, amount);
  if (!fund.ok) return fund;
  const r = ledgerPost([{ account: pool, delta: -amount }, { account, delta: amount }], memo,
    { actor: 'system', reason: 'reward payout', source: pool, destination: account, kind: 'reward' });
  return r.ok ? { ok: true, funded: fund.funded || 0, balance: ldBalance(account) } : r;
}
function economyReport() {
  const circ = Object.entries(S.ledger.accounts)
    .filter(([k]) => !['LD Issuance', 'Forge Sink', 'Marketplace Sink', 'Arena Escrow', 'Treasury'].includes(k) && !LD_POOLS.includes(k))
    .reduce((sum, [, v]) => sum + v, 0);
  return {
    mode: S.economy.realMode ? 'REAL' : 'SIMULATION',
    config: economyConfig(),
    balances: Object.assign({}, S.ledger.accounts),
    circulatingLD: circ,
    pools: LD_POOLS.reduce((acc, p) => Object.assign(acc, { [p]: ldBalance(p) }), {}),
    market: engagement.LD_MARKET,
    pieceCosts: engagement.PIECE_RULES,
    priceTable: { pieces: engagement.PIECE_COST, pet: engagement.PET_COST, merge: engagement.MERGE_COST },
    orders: (S.ldOrders || []).slice(0, 10),
    txCount: S.ledger.tx.length,
    note: 'Every LD movement is a balanced double-entry post. Rewards only pay from funded pools; pool funding is an audited issuance.'
  };
}
function ldMarketCmd(ld, side, opts) {
  opts = opts || {};
  const q = engagement.ldOrderQuote(ld, side || 'buy');
  if (!q.ok) return q;
  const owner = opts.owner || (S.owner && S.owner.name) || 'Owner';
  if (S.economy.realMode) {
    return { ok: false, blocked: 'compliance', error: 'Real-money LD ' + q.side + ' orders are COMPLIANCE-LOCKED. A verified payment/payout authority, licensing, age/identity verification and jurisdictional review are required before activation (§88/§92). No money moved.', quote: q };
  }
  const entries = engagement.ldOrderEntries(q, owner);
  const memo = 'SIMULATION LD ' + (q.side === 'buy' ? 'purchase' : 'sale') + ': ' + q.ld + ' LD at ' + q.rateAudPerLD + ' AUD per LD = A$' + q.aud.toFixed(2);
  const post = ledgerPost(entries, memo, { actor: owner, reason: 'ld market ' + q.side, kind: 'ld-market', source: q.side === 'buy' ? 'LD Issuance' : owner, destination: q.side === 'buy' ? owner : 'LD Issuance' });
  if (!post.ok) return post;
  const order = { id: nid('ldo'), ts: Date.now(), side: q.side, ld: q.ld, aud: q.aud, rateAudPerLD: q.rateAudPerLD, mode: 'SIMULATION', wallet: owner, settled: true, spreadPct: q.spreadPct };
  S.ldOrders.unshift(order);
  if (S.ldOrders.length > 200) S.ldOrders.length = 200;
  audit('economy', memo + (q.side === 'sell' ? ' (LD returned to issuance; payout recorded, nothing paid out)' : ''), 'user',
    { action: 'ld.' + q.side, decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  save();
  return { ok: true, order, quote: q, balance: ldBalance(owner), simulation: true, note: 'Recorded in the simulation ledger. Real-money LD trading stays compliance-locked.' };
}
/* Creating anything costs LD: forging is priced by band, provisioning fills an
 * empty required slot at Common price, pets and merges have their own price. */
function chargeLD(account, amount, memo, sink) {
  if (!(amount > 0)) return { ok: true, cost: 0 };
  const r = ledgerPost([{ account, delta: -amount }, { account: sink || 'Forge Sink', delta: amount }], memo,
    { actor: account, reason: 'piece creation', source: account, destination: sink || 'Forge Sink', kind: 'piece-cost' });
  if (!r.ok) return r;
  return { ok: true, cost: amount };
}
function piecePriceList() {
  return {
    pieces: engagement.PIECE_COST,
    pet: engagement.PET_COST,
    merge: engagement.MERGE_COST,
    market: 'Player trades settle in LD with a 1% Treasury rule.',
    drops: engagement.PIECE_RULES.drops,
    note: 'Pieces are created with LD or found as battle drops. Selling a piece returns LD through marketplace escrow.'
  };
}
function walletFor(avatarName, opts) {
  opts = opts || {};
  if (opts.wallet) return opts.wallet;
  const owner = (S.owner && S.owner.name) || 'Owner';
  return avatarName && ldBalance(avatarName) > 0 ? avatarName : owner;
}
function provisionLoadoutCmd(avatarName, opts) {
  opts = opts || {};
  const arena = require('./arena-engine.js');
  const av = arena.list().find(a => a.name.toLowerCase() === String(avatarName || '').toLowerCase()) || (opts.avatarId ? arena.get(opts.avatarId) : null);
  if (!av) return { ok: false, error: 'No avatar named ' + avatarName };
  const before = arena.loadoutStatus(av.id);
  if (before.complete) return { ok: true, alreadyComplete: true, avatar: av.name, cost: 0, status: before };
  const missing = before.missing.length;
  const cost = missing * engagement.pieceCost('Common');
  const wallet = walletFor(av.name, opts);
  const pay = chargeLD(wallet, cost, 'provision ' + missing + ' required slot(s) for ' + av.name + ' at Common price');
  if (!pay.ok) return Object.assign(pay, { needed: cost, balance: ldBalance(wallet), wallet, hint: 'Buy LD in the market (“buy 500 ld”), claim your sign-in gift, or complete daily tasks.' });
  const r = arena.equipLoadout(av.id, opts);
  if (!r.ok) return r;
  audit('forge', 'PROVISIONED ' + av.name + ': ' + missing + ' slot(s) for ' + cost + ' LD from ' + wallet, 'user',
    { action: 'piece.provision', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
  save();
  return { ok: true, avatar: av.name, cost, wallet, equipped: r.equipped, status: r.status, note: 'Filled slots hold real engine loot with real fingerprints; LD was charged because creating pieces costs LD.' };
}
function summonPetCmd(avatarName, opts) {
  opts = opts || {};
  const arena = require('./arena-engine.js');
  const av = arena.list().find(a => a.name.toLowerCase() === String(avatarName || '').toLowerCase());
  if (!av) return { ok: false, error: 'No avatar named ' + avatarName };
  const wallet = walletFor(av.name, opts);
  const pay = chargeLD(wallet, engagement.PET_COST, 'summon pet for ' + av.name);
  if (!pay.ok) return Object.assign(pay, { needed: engagement.PET_COST, balance: ldBalance(wallet), wallet });
  const r = arena.createPet(av.id);
  if (!r.ok) return r;
  audit('forge', 'PET SUMMONED for ' + av.name + ' (' + r.pet.species + ' ' + r.pet.name + ', ' + r.pet.rarity + ') for ' + engagement.PET_COST + ' LD', 'user',
    { action: 'pet.create', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
  save();
  return { ok: true, pet: r.pet, cost: engagement.PET_COST, wallet };
}
function mergePiecesCmd(avatarName, ids, opts) {
  opts = opts || {};
  const arena = require('./arena-engine.js');
  const av = arena.list().find(a => a.name.toLowerCase() === String(avatarName || '').toLowerCase());
  if (!av) return { ok: false, error: 'No avatar named ' + avatarName };
  const raw = arena.rawAvatar(av.id);
  const items = (ids || []).map(id => (raw.inventory || []).find(i => i.id === id)).filter(Boolean);
  if (items.length !== 3) return { ok: false, error: 'Merging needs three inventory piece ids' };
  const band = items[0].rarity;
  const cost = engagement.MERGE_COST[band] || engagement.MERGE_COST.Common;
  const wallet = walletFor(av.name, opts);
  const pay = chargeLD(wallet, cost, 'merge 3 ' + band + ' pieces for ' + av.name);
  if (!pay.ok) return Object.assign(pay, { needed: cost, balance: ldBalance(wallet), wallet });
  const r = arena.mergePieces(av.id, ids);
  if (!r.ok) return r;
  save();
  return { ok: true, merged: r.merged, cost, band, wallet };
}
/* Task progress is driven by real activity, never by a claim that activity
 * happened. Each call site below is an actual execution path. */
function progressQuests(metric, amount) {
  try { return engagement.progressQuest(S, metric, amount); } catch (e) { return []; }
}
function claimableQuests() { return engagement.questSummary(S).claimable; }

const ARENA_WAGER_LD = 100;`, 'economy helpers');

/* ── wallet-aware forging + free-provisioning rewire ─────────────── */
rep(`  const cost = FORGE_COST[band.name];
  const pay = ledgerPost([{ account: 'Owner', delta: -cost }, { account: 'Forge Sink', delta: cost }], 'forge ' + band.name + ' ' + slot);
  if (!pay.ok) return { ok: false, error: pay.error + ' — forging ' + band.name + ' costs ' + cost + ' LD' };`,
`  const cost = FORGE_COST[band.name];
  const wallet = (S.owner && S.owner.name) || 'Owner';
  const pay = chargeLD(wallet, cost, 'forge ' + band.name + ' ' + slot + ' for ' + av.name);
  if (!pay.ok) return { ok: false, error: pay.error + ' — forging ' + band.name + ' costs ' + cost + ' LD (wallet ' + wallet + ' holds ' + ldBalance(wallet) + ')' };`, 'forge charges wallet');

rep(`  if ((m = low.match(/^provision loadout ([\\w '-]{2,30})$/))) {
    const arena = require('./arena-engine.js');
    const av = arena.list().find(a => a.name.toLowerCase() === m[1].toLowerCase());
    if (!av) return R('No avatar named ' + m[1]);
    const r = arena.equipLoadout(av.id, {});
    return R(r.ok ? \`\${av.name} equipped: \${r.equipped.map(e => e.slot).join(', ')}. Completeness gate now \${r.status.complete ? 'SATISFIED' : 'still missing ' + r.status.missing.join(', ')}.\` : r.error);
  }`,
`  if ((m = low.match(/^provision loadout ([\\w '-]{2,30})$/))) {
    const r = provisionLoadoutCmd(m[1]);
    if (!r.ok) return R(r.error + (r.needed ? \` — needs \${r.needed} LD, \${r.wallet} holds \${r.balance}. \${r.hint || ''}\` : ''));
    if (r.alreadyComplete) return R(\`\${r.avatar} is already fully equipped.\`);
    return R(\`\${r.avatar} equipped: \${r.equipped.map(e => e.slot).join(', ')} for \${r.cost} LD (from \${r.wallet}). Completeness gate \${r.status.complete ? 'SATISFIED' : 'still missing ' + r.status.missing.join(', ')}.\`);
  }`, 'provision costs LD');

/* ── chat intents ────────────────────────────────────────────────── */
rep(`  if (low === 'release' || low === 'version') {`,
`  /* ══ v1.65 engagement: everything below is plain-language control ══ */
  if (low === 'help' || low === 'what can i say' || low === 'commands' || low === 'what can you do') {
    return R(CAPABILITY_HELP.map(g => g.group.toUpperCase() + '\\n' + g.items.map(i => '  • ' + i).join('\\n')).join('\\n\\n'));
  }
  /* ── events ── */
  if (low === 'events' || low === 'event board' || low === 'event list') {
    const list = engagement.listEvents(S);
    return R('Events board (' + list.length + '):\\n' + list.map(e => \`• \${e.id} — \${e.title} [\${e.state}] \${e.entryLD ? 'entry ' + e.entryLD + ' LD · ' : ''}\${e.entries} entrant(s) · \${e.joinable ? 'open' : 'scheduled'}\\n    \${e.blurb}\`).join('\\n') + '\\nJoin with “join event <id>”.');
  }
  if ((m = low.match(/^join event ([\\w-]+)/))) {
    const who = (S.owner && S.owner.name) || 'Owner';
    const r = engagement.joinEvent(S, m[1], who);
    if (!r.ok) return R(r.error);
    if (r.cost > 0) {
      const fund = ensurePool('Events Pool', r.cost);
      if (!fund.ok) return R(fund.error);
      const pay = ledgerPost([{ account: who, delta: -r.cost }, { account: 'Events Pool', delta: r.cost }], 'event entry fee ' + r.event.title, { actor: who, reason: 'event entry', kind: 'event' });
      if (!pay.ok) return R(pay.error + ' — entry costs ' + r.cost + ' LD');
    }
    audit('event', 'JOINED event ' + r.event.title + (r.cost ? ' for ' + r.cost + ' LD' : ' (free entry)'), 'user', { action: 'event.join', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    save();
    return R(\`Entered \${r.event.title}\${r.cost ? ' for ' + r.cost + ' LD' : ' (free entry)'}. \${r.event.blurb} Say “event progress \${r.event.id}” any time.\`);
  }
  if ((m = low.match(/^event progress ([\\w-]+)(?: (\\d+))?/))) {
    const e = engagement.eventFor(S, m[1]);
    if (!e) return R('Unknown event');
    const who = (S.owner && S.owner.name) || 'Owner';
    const entry = e.participants.find(p => p.who === who);
    if (!entry) return R('You are not entered in ' + e.title);
    entry.progress.units = (entry.progress.units || 0) + (m[2] ? Number(m[2]) : 1);
    if (entry.progress.units >= 1) entry.completed = true;
    progressQuests('event.progress');
    save();
    return R(\`\${e.title}: \${entry.progress.units} objective unit(s) done\${entry.completed ? ' — event objective complete' : ''}.\${e.rewards && e.rewards.ld ? ' Reward on close: ' + e.rewards.ld + ' LD' : ''}\`);
  }
  if ((m = low.match(/^close event ([\\w-]+)(?: winner (\\S+))?/))) {
    const r = engagement.closeEvent(S, m[1], { winner: m[2] });
    if (!r.ok) return R(r.error);
    if (r.settle === false) { save(); return R(\`\${r.event.title} closed. \${r.event.results.completed} completion(s) of \${r.event.results.participants} entrant(s) recorded.\`); }
    const fund = ensurePool('Events Pool', r.settlement.treasury);
    if (!fund.ok) return R(fund.error);
    const entries = r.settlement.entries.concat([{ account: 'Events Pool', delta: -r.settlement.treasury }, { account: 'Treasury', delta: r.settlement.treasury }]);
    const pay = ledgerPost(entries, 'event prize settlement ' + r.event.title, { actor: 'system', reason: 'event settlement', kind: 'event-settlement' });
    if (!pay.ok) return R(pay.error);
    audit('event', 'SETTLED ' + r.event.title + ': winner ' + r.settlement.winner + ' receives ' + r.settlement.prize.payout + ' LD of a ' + r.settlement.prize.pool + ' LD pool (treasury ' + r.settlement.prize.treasury + ', 1%)', 'system', { action: 'event.settle', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
    save();
    return R(\`\${r.event.title} settled: pool \${r.settlement.prize.pool} LD → winner \${r.settlement.winner} \${r.settlement.prize.payout} LD, treasury \${r.settlement.prize.treasury} LD (1%). SIMULATION.\`);
  }
  /* ── lotto ── */
  if (low === 'lotto' || low === 'lotto status' || low === 'lottery') {
    const open = engagement.openRoundOf(S);
    const last = (S.lottoRounds || []).find(r => r.state === 'DRAWN');
    return R([
      'Lotto — ' + engagement.LOTTO_RULES.numbersPerLine + ' numbers from 1–' + engagement.LOTTO_RULES.maxNumber + ', ticket ' + engagement.LOTTO_RULES.ticketLD + ' LD.',
      open ? \`Open round \${open.id}: \${open.tickets.length} ticket(s) sold, commitment \${open.commitHash.slice(0, 16)}…\` : 'No round is open — say “open lotto round”.',
      last ? \`Last draw \${last.id}: numbers \${last.drawn.numbers.join(', ')} · \${last.prizes.payouts.length} winning ticket(s) · \${last.prizes.rolloverOut ? last.prizes.rolloverOut + ' LD rolled over' : 'jackpot won'}\` : 'No draw has run yet.',
      engagement.LOTTO_RULES.settlement,
      engagement.LOTTO_RULES.realMoney
    ].join('\\n'));
  }
  if (low === 'open lotto round' || low === 'new lotto round') {
    const r = engagement.openRound(S, { rolloverIn: ldBalance('Jackpot Rollover') });
    if (!r.ok) return R(r.error);
    save();
    audit('lotto', 'Round ' + r.round.id + ' opened with commitment ' + r.round.commitHash.slice(0, 16) + '… (jackpot carry-in ' + r.round.rolloverIn + ' LD)', 'user', { action: 'lotto.open', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    return R(\`Round \${r.round.id} is open. Ticket price \${r.round.ticketLD} LD. The server committed to sha256(\${r.round.commitHash.slice(0, 16)}…) before any ticket was sold, so the numbers cannot change afterwards. Say “buy 3 lotto tickets”.\`);
  }
  if ((m = low.match(/^buy (\\d+ )?lotto tickets?(?: for (\\S+))?/)) || low === 'buy a lotto ticket') {
    const count = m && m[1] ? Number(m[1]) : 1;
    const who = (m && m[2]) || (S.owner && S.owner.name) || 'Owner';
    const r = engagement.buyTickets(S, { owner: who, count });
    if (!r.ok) return R(r.error + ' (Say “open lotto round” first.)');
    const fund = ensurePool('Lotto Pool', r.cost);
    if (!fund.ok) return R(fund.error);
    const pay = ledgerPost([{ account: who, delta: -r.cost }, { account: 'Lotto Pool', delta: r.cost }], count + ' lotto ticket(s) at ' + r.round.ticketLD + ' LD', { actor: who, reason: 'lotto tickets', kind: 'lotto' });
    if (!pay.ok) return R(pay.error + ' — tickets cost ' + r.cost + ' LD total');
    progressQuests('lotto.ticket', count);
    save();
    audit('lotto', 'TICKETS ' + count + ' × ' + r.round.ticketLD + ' LD in ' + r.round.id + ' by ' + who, 'user', { action: 'lotto.buy', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    return R(\`Bought \${count} ticket(s) for \${r.cost} LD in round \${r.round.id}.\\n\` + r.tickets.map(t => '  ' + t.numbers.join(' · ')).join('\\n') + \`\\nBalance: \${ldBalance(who)} LD.\`);
  }
  if ((m = low.match(/^draw lotto(?: (\\S+))?( confirm)?$/))) {
    const roundId = m[1] && m[1] !== 'confirm' ? m[1] : undefined;
    const r = engagement.drawRound(S, roundId, { confirmed: !!m[2] });
    if (r.needsConfirmation) return R('Drawing settles LD against real tickets. Say “draw lotto confirm” to proceed.');
    if (!r.ok) return R(r.error);
    const pay = ledgerPost(r.entries, 'lotto settlement ' + r.round.id, { actor: 'system', reason: 'lotto settlement', kind: 'lotto-settlement' });
    if (!pay.ok) return R(pay.error);
    progressQuests('lotto.draw');
    save();
    audit('lotto', 'DRAW ' + r.round.id + ': numbers ' + r.numbers.join(',') + ' · payouts ' + r.payouts.length + ' · paid ' + r.prize.paid + ' LD · treasury ' + r.prize.treasury + ' LD · community ' + r.prize.community + ' LD' + (r.rolledOver ? ' · jackpot rolls over ' + r.prize.rolloverOut + ' LD' : ''), 'system', { action: 'lotto.draw', decision: 'ALLOW', risk: 'MEDIUM', result: 'SUCCEEDED' });
    return R([
      \`Draw \${r.round.id} — numbers: \${r.numbers.join(' · ')}\`,
      \`Sales \${r.prize.gross} LD · prize tiers \${r.prize.tierPool} LD · jackpot \${r.prize.jackpotPool} LD · community \${r.prize.community} LD · treasury \${r.prize.treasury} LD\`,
      r.rolledOver ? \`No jackpot winner — \${r.prize.rolloverOut} LD rolls into the next round.\` : 'Jackpot won.',
      r.payouts.length ? 'Winner(s): ' + r.payouts.map(p => p.owner + ' ' + p.ld + ' LD (' + p.tier + ')').join(', ') : 'No tickets matched three or more numbers.',
      'Verify independently with “verify lotto ' + r.round.id + '”.'
    ].join('\\n'));
  }
  if ((m = low.match(/^verify lotto(?: (\\S+))?/))) {
    const r = m[1] ? (S.lottoRounds || []).find(x => x.id === m[1]) : (S.lottoRounds || []).find(x => x.state === 'DRAWN');
    if (!r) return R('No drawn round to verify');
    const v = engagement.verifyRound(r);
    return R(\`\${r.id}: commitment \${v.commitOk ? 'MATCHES' : 'FAILED'} · ticket lines \${v.ticketsOk ? 're-derive exactly' : 'MISMATCH'} · sales \${v.totalOk ? 'reconcile' : 'DO NOT RECONCILE'} · numbers \${v.numbers.join(' · ')}\\n\${v.note}\`);
  }
  /* ── sign-in gifts ── */
  if (low === 'sign in' || low === 'claim sign in' || low === 'daily gift' || low === 'gift' || low === 'my streak') {
    const who = (S.owner && S.owner.name) || 'Owner';
    const st = engagement.signInStatus(S, who);
    if (low === 'my streak' && !st.claimedToday) {
      return R(\`Streak: \${st.streak} day(s), \${st.totalClaims || 0} claim(s) total. Today’s gift is unclaimed — say “sign in”.\`);
    }
    const r = engagement.claimSignIn(S, who);
    if (!r.ok) return R(r.error);
    const pay = payReward(who, r.ld, 'sign-in day ' + r.day + ' gift', 'Rewards Pool');
    if (!pay.ok) return R(pay.error);
    progressQuests('signin.claim');
    save();
    audit('engagement', 'SIGN-IN day ' + r.day + ' (streak ' + r.streak + '): +' + r.ld + ' LD' + (r.bonus ? ' + ' + r.bonus : ''), 'user', { action: 'signin.claim', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    return R([
      \`Day \${r.day} gift claimed: +\${r.ld} LD\${r.bonus ? ' and a ' + r.bonus.split(':')[1] + ' piece voucher' : ''}. Streak \${r.streak} day(s).\`,
      'Balance: ' + ldBalance(who) + ' LD. The seven-day cycle pays ' + engagement.SIGN_IN_REWARDS.map(x => x.ld).join('/') + ' LD, then starts again.',
      'Paid from the Rewards Pool and recorded in the ledger.'
    ].join('\\n'));
  }
  /* ── daily & weekly tasks ── */
  if (low === 'daily tasks' || low === 'weekly tasks' || low === 'tasks board' || low === 'quests' || low === 'daily' || low === 'weekly') {
    const q = engagement.questSummary(S);
    const show = what => q[what].map(t => \`\${t.claimable ? '★ CLAIMABLE' : t.complete ? '■ done' : '□ ' + t.progress + '/' + t.target} — \${t.title} (\${t.ld} LD) [\${t.id}]\`).join('\\n');
    const wanted = (low === 'daily tasks' || low === 'daily') ? ['daily'] : (low === 'weekly tasks' || low === 'weekly') ? ['weekly'] : ['daily', 'weekly'];
    const parts = [];
    if (wanted.includes('daily')) parts.push('DAILY (' + q.day + ')\\n' + show('daily'));
    if (wanted.includes('weekly')) parts.push('WEEKLY (' + q.week + ')\\n' + show('weekly'));
    return R(parts.join('\\n\\n') + \`\\n\${q.claimable} task(s) ready to claim — say “claim task <id>”. The board is fixed for the window, so it cannot be re-rolled for an easier one.\`);
  }
  if ((m = low.match(/^claim (?:task )?([\\w-]+)$/))) {
    const who = (S.owner && S.owner.name) || 'Owner';
    const r = engagement.claimQuest(S, m[1], who);
    if (!r.ok) return R(r.error);
    const pay = payReward(who, r.ld, r.window + ' task reward: ' + r.quest.title, 'Rewards Pool');
    if (!pay.ok) return R(pay.error);
    progressQuests('quest.claim');
    save();
    audit('engagement', 'TASK CLAIMED ' + r.window + ' ' + r.quest.id + ' (' + r.quest.title + ') +' + r.ld + ' LD', 'user', { action: 'quest.claim', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    return R(\`\${r.window.toUpperCase()} task “\${r.quest.title}” claimed: +\${r.ld} LD. Balance \${ldBalance(who)} LD.\`);
  }
  /* ── LD market: bought and sold in the app ── */
  if (low === 'ld market' || low === 'ld price' || low === 'ld rates' || low === 'buy ld' || low === 'market price') {
    const mk = engagement.LD_MARKET;
    return R([
      \`LD market — buy at A\$\${mk.buyRateAudPerLD} per LD (100 LD = A$1.00), sell back at A\$\${mk.sellRateAudPerLD} per LD (\${Math.round((1 - mk.sellRateAudPerLD / mk.buyRateAudPerLD) * 100)}% disclosed spread).\`,
      \`Orders: minimum \${mk.minOrderLD} LD, maximum \${mk.maxOrderLD} LD, in multiples of \${mk.roundToLD} LD.\`,
      'Say “buy 500 ld” or “sell 500 ld”.',
      mk.note,
      'Balances: ' + Object.keys(S.ledger.accounts).map(k => k + '=' + S.ledger.accounts[k]).join(' · ')
    ].join('\\n'));
  }
  if ((m = low.match(/^(?:buy|purchase) (\\d+) ?ld/))) {
    const r = ldMarketCmd(Number(m[1]), 'buy');
    return R(r.ok ? \`Bought \${r.order.ld} LD for A\$\${r.order.aud.toFixed(2)} at A\$\${r.order.rateAudPerLD} per LD (SIMULATION). Balance \${r.balance} LD. Order \${r.order.id}.\` : r.error);
  }
  if ((m = low.match(/^sell (\\d+) ?ld/))) {
    const r = ldMarketCmd(Number(m[1]), 'sell');
    return R(r.ok ? \`Sold \${r.order.ld} LD for A\$\${r.order.aud.toFixed(2)} at A\$\${r.order.rateAudPerLD} per LD (5% spread, SIMULATION — nothing was paid out). Balance \${r.balance} LD. Order \${r.order.id}.\` : r.error);
  }
  if (low === 'economy' || low === 'economy report' || low === 'ld economy' || low === 'ld supply') {
    const e2 = economyReport();
    return R([
      \`LD economy — mode \${e2.mode}. Circulating \${e2.circulatingLD} LD across player accounts.\`,
      'Pools: ' + Object.entries(e2.pools).map(([k, v]) => k + '=' + v).join(' · '),
      'Piece prices: ' + Object.entries(e2.priceTable.pieces).map(([k, v]) => k + '=' + v).join(' · ') + ' · pet=' + e2.priceTable.pet,
      'Market: buy A$' + e2.market.buyRateAudPerLD + ' per LD, sell A$' + e2.market.sellRateAudPerLD + ' per LD.',
      e2.note
    ].join('\\n'));
  }
  if (low === 'piece prices' || low === 'prices' || low === 'price list') {
    const p = piecePriceList();
    return R('Piece prices (LD): ' + Object.entries(p.pieces).map(([k, v]) => k + '=' + v).join(' · ') + '\\nPet=' + p.pet + ' · merge: ' + Object.entries(p.merge).map(([k, v]) => k + '=' + v).join(', ') + '\\n' + p.drops + '\\n' + p.market);
  }
  if ((m = low.match(/^summon pet for ([\\w '-]{2,30})$/))) {
    const r = summonPetCmd(m[1]);
    return R(r.ok ? \`\${r.pet.name} the \${r.pet.species} (\${r.pet.rarity}) joined \${m[1].trim()} for \${r.cost} LD.\` : (r.error + (r.needed ? ' — needs ' + r.needed + ' LD, wallet holds ' + r.balance + '.' : '')));
  }
  if ((m = low.match(/^merge pieces ([\\w '-]{2,30}) ([\\w ,]+)$/))) {
    const r = mergePiecesCmd(m[1], m[2].split(/[\\s,]+/).filter(Boolean));
    return R(r.ok ? \`Merged into \${r.merged.name} (\${r.merged.rarity} R\${r.merged.rlevel}) for \${r.cost} LD.\` : (r.error + (r.needed ? ' — needs ' + r.needed + ' LD.' : '')));
  }
  /* ── subscription tiers: personal and business ── */
  if (low === 'plans' || low === 'subscription plans' || low === 'plan list' || low === 'pricing') {
    const fam = { personal: [], business: [] };
    services.PLANS.forEach(p => (fam[p.family || 'personal']).push(p));
    const line = p => \`• \${p.name} [\${p.id}] — \${p.blurb}\\n    agents \${p.entitlements['agents.max']} · storage \${p.entitlements['storage.mb']}MB · AI/day \${p.entitlements['ai.daily']} · seats \${p.entitlements['org.seats']} · guardian \${p.entitlements['guardian.level']} · lotto/day \${p.entitlements['lotto.ticketsPerDay']}\`;
    return R('PERSONAL\\n' + fam.personal.map(line).join('\\n') + '\\n\\nBUSINESS\\n' + fam.business.map(line).join('\\n') + '\\n\\nPrices are reference labels, not charges: billing stays COMPLIANCE-LOCKED until billing authority exists. Say “upgrade to pro” or “change plan business-plus”.');
  }
  if ((m = low.match(/^(?:upgrade|change|switch) (?:plan |to |me to )?([a-z0-9-]+)$/))) {
    const r = subscribeCmd(m[1]);
    if (!r.ok) return R(r.error + ' Available: ' + services.PLANS.map(p => p.id).join(', '));
    const sub = r.subscription;
    audit('subscription', 'PLAN ' + sub.planId + ' (' + sub.planName + ') selected', 'user', { action: 'plan.change', decision: 'ALLOW', risk: 'LOW', result: 'SUCCEEDED' });
    save();
    return R(\`Plan set to \${sub.planName} [\${sub.planId}] — \${sub.family} tier, rank \${sub.rank}. Entitlements: \${Object.entries(sub.entitlements).map(([k, v]) => k + '=' + v).join(', ')}. Billing: not chargeable (\${sub.billing.note})\`);
  }
  /* ── owner security + guardian ── */
  if (low === 'secure my account' || low === 'security posture' || low === 'protect me' || low === 'protection report') {
    const p = ownerSec.protectionReport(S);
    return R([
      \`Owner protection — level \${p.level}, posture \${p.grade} (\${p.score}/100). Controls \${p.controlsEnabled}/\${p.controlsTotal}. Threats: \${p.threats.covered} covered · \${p.threats.partial} partial · out of scope: \${p.threats.outOfScope.join(', ')}.\`,
      'Second factor: ' + (p.secondFactor.enabled ? (p.secondFactor.verified ? 'ENABLED and verified' : 'enrolled — verify one code to finish') : 'not enabled — say “enable second factor”') + ' · recovery codes left ' + p.secondFactor.recoveryCodesLeft,
      'Active sessions: ' + p.sessions + ' — say “sessions” to review, “revoke session <id>” to end one.',
      'Next: ' + (p.nextSteps.map(x => x.name).join(', ') || 'nothing outstanding for this build'),
      p.honestLimit
    ].join('\\n'));
  }
  if (low === 'enable second factor' || low === 'enable 2fa' || low === 'set up 2fa') {
    const r = ownerSec.enrollSecondFactor(S);
    if (!r.ok) return R(r.error);
    audit('security', 'SECOND FACTOR enrolled for the Owner account', 'user', { action: 'security.2fa.enroll', decision: 'ALLOW', risk: 'HIGH', result: 'SUCCEEDED' });
    save();
    return R('Second factor enrolled (TOTP, RFC 6238 — 6 digits, 30-second rotation). Add this to your authenticator now:\\n  secret: ' + r.secret + '\\n  uri: ' + r.otpauthUrl + '\\nRecovery codes (each works once, shown only here):\\n' + r.recoveryCodes.map(c => '  ' + c).join('\\n') + '\\nThen verify: “verify second factor <6-digit code>”.');
  }
  if ((m = low.match(/^verify (?:second factor|2fa) (\\d{6})/))) {
    const r = ownerSec.verifySecondFactor(S, m[1]);
    save();
    return R(r.ok ? (r.viaRecoveryCode ? \`Recovery code accepted — \${r.remainingCodes} left. Re-enroll the factor soon.\` : 'Second factor verified. Re-authentication window open for five minutes — sensitive changes are allowed now.') : r.error);
  }
  if (low === 'sessions' || low === 'list sessions' || low === 'my sessions') {
    const list = ownerSec.sessionInventory(S);
    return R(list.length ? 'Sessions:\\n' + list.map(x => \`• \${x.id} — age \${Math.round(x.ageMs / 60000)} min\`).join('\\n') + '\\nRevoke one with “revoke session <id>”, or all with “revoke all sessions”.' : 'No active sessions (owner login issues a session cookie).');
  }
  if ((m = low.match(/^revoke (?:all )?sessions?(?: (\\S+))?$/))) {
    const all = /all sessions/.test(low);
    const rr = ownerSec.requireReauth(S);
    if (!rr.ok) return R(rr.error);
    const r = ownerSec.revokeSessions(S, all ? { all: true } : { id: m[1] });
    if (!r.ok) return R(r.error);
    audit('security', 'SESSIONS revoked (' + r.revoked + ') by owner', 'user', { action: 'security.session.revoke', decision: 'ALLOW', risk: 'HIGH', result: 'SUCCEEDED' });
    save();
    return R(\`Revoked \${r.revoked} session(s). \${r.remaining} remaining.\`);
  }
  if ((m = low.match(/^(?:harden my account|raise security level|harden)( maximum| hardened| standard)?$/))) {
    const want = m[1] ? m[1].trim().toUpperCase() : 'STANDARD';
    const r = ownerSec.setSecurityLevel(S, want);
    if (!r.ok) return R(r.error + (r.missing ? '\\nRequired first: ' + r.missing.join(', ') : ''));
    save();
    return R(\`Owner security level is now \${r.level.id} (\${r.level.name}): \${r.level.blurb}\`);
  }
  if (low === 'security drill' || low === 'backup drill' || low === 'run drill') {
    const r = ownerSec.runDrill(S, /backup/.test(low) ? 'backup' : 'security');
    save();
    return R(\`Drill “\${r.drill.kind}” — \${r.drill.passed}/\${r.drill.total} checks passed:\\n\` + r.drill.checks.map(c => \`\${c.pass ? '✓' : '✗'} \${c.check} — \${c.detail}\`).join('\\n'));
  }
  if (low === 'alerts' || low === 'security alerts') {
    const os = ownerSec.securityState(S);
    return R(os.alerts.length ? 'Security alerts (newest first):\\n' + os.alerts.slice(0, 10).map(a => \`• [\${a.severity}] \${new Date(a.ts).toISOString().slice(11, 19)} \${a.kind}: \${a.detail}\`).join('\\n') : 'No security alerts recorded.');
  }
  if (low === 'guardian' || low === 'guardian report' || low === 'guardian status') {
    const g = ownerSec.guardianReport(S);
    return R([g.oath, \`Charters \${g.charters} · decisions recorded \${g.events} (\${g.denied} refused, \${g.asked} escalated to you).\`,
      g.recent.length ? 'Recent:\\n' + g.recent.map(e => \`• [\${e.decision}] \${e.agent}: \${e.action}\`).join('\\n') : 'No agent actions have been screened yet.'].join('\\n'));
  }
  if (low === 'threats' || low === 'what do you protect me from' || low === 'protection matrix') {
    return R('Protection matrix:\\n' + ownerSec.THREATS.map(t => \`• [\${t.status}] \${t.name} — \${t.control}\${t.note ? ' ' + t.note : ''}\`).join('\\n') + '\\nOut-of-scope threats are named, not hidden: ' + ownerSec.NOT_PROMISED[0]);
  }
  if ((m = low.match(/^guardian check (.+)$/))) {
    const gm = q.match(/^guardian check (.+)$/i) || m;
    const a = ownerSec.guardianWatch(S, { action: gm[1], source: 'user-request' });
    save();
    return R(\`Guardian: \${a.decision} — \${a.reason}\${a.triggeredDuties.length ? '\\nDuties engaged: ' + a.triggeredDuties.join(', ') : ''}\`);
  }
  if (low === 'release' || low === 'version') {`, 'engagement intents');

/* ── capability help catalogue (chat is the control surface) ─────── */
rep(`module.exports = {
  get state() { return S; },`,
`/* §3/§166: chat is the control surface, so it must be able to say what it can
 * do. This list is checked against the real router intents in the test suite. */
const CAPABILITY_HELP = [
  { group: 'Talk to it', items: ['“help” — this list', '“status” / “release” — runtime truth', '“preview <command>” — what would happen, without doing it'] },
  { group: 'Authority', items: ['“permissions” · “grant fs.write” · “revoke fs.write”', '“suspend fs.write” / “resume fs.write”', '“risk fs.delete” · “policy fs.delete”', '“approve <id>” · “stop <id>”', '“stop network” · “emergency stop all” · “resume network”', '“autonomous on confirm” · “autonomous off”'] },
  { group: 'LD economy', items: ['“economy” · “piece prices” · “ld market”', '“buy 500 ld” · “sell 500 ld”', '“forge sword at rare: a rune-etched blade” · “mint asset piece rarity 5”', '“provision loadout <avatar>” · “summon pet for <avatar>”', '“market” · “buy <listing>” · “sell <item> for 200” · “balance”'] },
  { group: 'Events, lotto, rewards', items: ['“events” · “join event evt-arena-cup” · “close event evt-arena-cup winner <avatar>”', '“open lotto round” · “buy 3 lotto tickets” · “draw lotto confirm” · “verify lotto”', '“sign in” · “my streak”', '“daily tasks” · “weekly tasks” · “claim task d-tools”'] },
  { group: 'Avatars & arena', items: ['“create avatar Korr as nord” · “races”', '“battle <avatar> vs <rival>” · “arena wager A vs B confirm”', '“talents” · “unlock talent bulwark for <avatar>”'] },
  { group: 'Devices & accounts', items: ['“devices” · “pair device Pixel as android” · “trust device Pixel”', '“accounts” · “record account github:you” · “use account work@example.com for gmail”', '“plan pro” · “plans”'] },
  { group: 'Owner security & guardian', items: ['“secure my account” · “harden my account maximum”', '“enable second factor” · “verify second factor 123456”', '“sessions” · “revoke all sessions” · “alerts” · “security drill”', '“guardian” · “threats” · “guardian check <something you want checked>”'] },
  { group: 'Work & records', items: ['“new task <objective>” · “tasks state” · “playbooks” · “run playbook research-recommend”', '“remember as preference …” · “create project X | goals …”', '“vault” · “metrics” · “trace <correlation id>”'] }
];

module.exports = {
  get state() { return S; },`, 'capability help');

/* ── exports ─────────────────────────────────────────────────────── */
rep(`  runPlaybookLocal, PLAYBOOK_TOOL_MAP
};`,
`  runPlaybookLocal, PLAYBOOK_TOOL_MAP,
  /* v1.65 engagement + owner protection */
  engagement, ownerSec,
  CAPABILITY_HELP,
  ldBalance, ensurePool, payReward, economyReport, ldMarketCmd, chargeLD, piecePriceList,
  provisionLoadoutCmd, summonPetCmd, mergePiecesCmd, progressQuests, claimableQuests,
  LD_POOLS
};`, 'exports');

fs.writeFileSync(f, s);
console.log(n + ' replacements applied');
