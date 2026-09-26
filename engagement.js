/* WitForge engagement systems — events, lotto, sign-in gifts, daily/weekly
 * tasks and the LD market.
 *
 * Design rules this module obeys:
 *   1. Nothing here mints value silently (§164). Every LD movement is a
 *      balanced double-entry post executed by the caller-supplied business
 *      hooks; this module computes *what* should move, never moves it itself.
 *   2. Simulation is the only permitted live mode (§88). Real-money LD sales
 *      are a compliance-locked path, not a feature flag to flip casually.
 *   3. Chance is verifiable, not promised. The lotto uses commit → reveal, so
 *      the outcome can be re-derived independently from published data.
 *   4. Rewards are deterministic per window (day/week), so two players with the
 *      same activity see the same quests, and nobody can reroll for a better board.
 */
'use strict';
const crypto = require('crypto');

const now = () => Date.now();
const sha = x => crypto.createHash('sha256').update(String(x)).digest('hex');
const rint = (seedHex, offset, max) => {
  const h = sha(seedHex + '#' + offset);
  return parseInt(h.slice(0, 12), 16) % max;
};

/* ══ LD market (§87–§92) ══════════════════════════════════════════════
 * The reference rate is 100 LD = A$1.00 (LD_AUD_VALUE = 0.01). The app both
 * sells LD (AUD → LD) and buys it back (LD → AUD) with a disclosed spread.
 * In simulation nothing is charged and nothing is paid out; the ledger simply
 * records the LD side so the economy stays balanced and auditable. */
const LD_AUD_VALUE = 0.01;
const SELL_SPREAD = 0.05;                                   // 5% disclosed spread
const LD_MARKET = {
  buyRateAudPerLD: LD_AUD_VALUE,                            // A$0.01 per LD
  sellRateAudPerLD: Number((LD_AUD_VALUE * (1 - SELL_SPREAD)).toFixed(4)),
  minOrderLD: 100,
  maxOrderLD: 100000,
  roundToLD: 10,
  note: 'Reference rate 100 LD = A$1.00. Selling back carries a 5% disclosed spread. Simulation mode charges nothing and pays nothing; real money stays COMPLIANCE-LOCKED.'
};
function ldOrderQuote(ld, side) {
  const amount = Math.floor(Number(ld) || 0);
  if (amount < LD_MARKET.minOrderLD) return { ok: false, error: 'Minimum order is ' + LD_MARKET.minOrderLD + ' LD' };
  if (amount > LD_MARKET.maxOrderLD) return { ok: false, error: 'Maximum order is ' + LD_MARKET.maxOrderLD + ' LD' };
  if (amount % LD_MARKET.roundToLD !== 0) return { ok: false, error: 'Orders are in multiples of ' + LD_MARKET.roundToLD + ' LD' };
  const rate = side === 'sell' ? LD_MARKET.sellRateAudPerLD : LD_MARKET.buyRateAudPerLD;
  return { ok: true, side, ld: amount, rateAudPerLD: rate, aud: Number((amount * rate).toFixed(2)), spreadPct: side === 'sell' ? SELL_SPREAD * 100 : 0 };
}
/* The LD movements for an order. The caller posts them (ledger authority
 * stays in platform.js) — this function only states the truth of the trade. */
function ldOrderEntries(quote, owner, opts) {
  opts = opts || {};
  if (quote.side === 'buy') {
    return [{ account: 'LD Issuance', delta: -quote.ld }, { account: owner, delta: quote.ld }];
  }
  /* Selling returns LD to issuance and pays AUD outside the LD ledger. */
  return [{ account: owner, delta: -quote.ld }, { account: 'LD Issuance', delta: quote.ld }];
}

/* ══ Avatars, pieces and pets cost LD ═════════════════════════════════
 * One canonical price table, used by forging, provisioning, pets, merging and
 * the marketplace so a piece costs the same everywhere. */
const PIECE_COST = { Common: 25, Magic: 60, Rare: 150, Legendary: 400, Set: 900, Mythic: 2000 };
const PET_COST = 40;
const MERGE_COST = { Common: 30, Magic: 75, Rare: 180, Legendary: 500, Set: 1100, Mythic: 2400 };
const PIECE_RULES = {
  bands: Object.keys(PIECE_COST),
  forge: 'Forging a piece costs the band price of the piece being made.',
  provision: 'Filling an empty required slot costs the Common band price; the piece is real engine loot with a real fingerprint.',
  pet: 'Summoning a pet costs ' + PET_COST + ' LD.',
  merge: 'Merging three pieces of a band costs the merge price for that band (higher than the forge price of the result).',
  market: 'Player-to-player trades settle in LD through the marketplace escrow.',
  drops: 'Battle drops are found, not forged — a drop is a gameplay reward and carries no LD cost. Only creation and trades cost LD.',
  treasury: 'Every player-to-player settlement routes 1% to the Treasury (§90).'
};
function pieceCost(band) { return PIECE_COST[band] === undefined ? PIECE_COST.Common : PIECE_COST[band]; }

/* ══ Events ══════════════════════════════════════════════════════════ */
const EVENT_TYPES = [
  { id: 'seasonal', name: 'Seasonal event', blurb: 'Timed event with a themed reward track.' },
  { id: 'arena-tournament', name: 'Arena tournament', blurb: 'Bracketed battles with an entry fee and a prize pool.' },
  { id: 'forge-festival', name: 'Forge festival', blurb: 'Reduced forge prices for the event window.' },
  { id: 'market-fair', name: 'Marketplace fair', blurb: 'Zero listing fee window; settlement still routes 1% to Treasury.' },
  { id: 'lotto-draw', name: 'Lotto draw night', blurb: 'Scheduled draw with a boosted jackpot contribution.' },
  { id: 'community-goal', name: 'Community goal', blurb: 'Collective objective; rewards unlock when the goal is met.' },
  { id: 'security-drill', name: 'Security drill', blurb: 'Owner-initiated verification drill; rewards for completing it.' },
  { id: 'launch', name: 'Launch event', blurb: 'One-off celebration event created by the Owner.' }
];
/* Seeded board: real events the platform can run today, each with truthful
 * dates and an explicit reward. Events are data, not promises about the future. */
function seedEvents() {
  const day = 86400000;
  const t = now();
  const mk = (id, type, title, startsIn, days, entryLD, rewards, blurb) => ({
    id, type, title, blurb,
    startsTs: t + startsIn * day, endsTs: t + (startsIn + days) * day,
    entryLD, rewards, state: 'SCHEDULED', participants: [], winner: null, results: null
  });
  return [
    mk('evt-signin-week', 'seasonal', 'Sign-in week', 0, 7, 0, { ld: 250, piece: 'Common' },
      'Sign in every day for seven days and collect the week bonus.'),
    mk('evt-forge-festival', 'forge-festival', 'Forge festival', 0, 5, 0, { ld: 150, forgeDiscountPct: 25 },
      'A quarter off every forge for the duration of the festival.'),
    mk('evt-market-fair', 'market-fair', 'Marketplace fair', 0, 4, 0, { ld: 100, listingFeeWaived: true },
      'List and trade freely; settlements still route the 1% Treasury rule.'),
    mk('evt-arena-cup', 'arena-tournament', 'Arena cup', 1, 3, 100, { ld: 500, piece: 'Rare' },
      'Entry 100 LD. The bracket winner takes the prize pool less the 1% Treasury rule.'),
    mk('evt-lotto-night', 'lotto-draw', 'Lotto draw night', 2, 1, 0, { boostedJackpotPct: 10 },
      'The jackpot contribution is raised for this draw only.'),
    mk('evt-community-1000', 'community-goal', 'Community goal: 1,000 pieces forged', 0, 14, 0, { ld: 300 },
      'Collective objective — rewards unlock for every participant when the goal is met.'),
    mk('evt-security-drill', 'security-drill', 'Owner security drill', 0, 30, 0, { ld: 200, badge: 'Guardian' },
      'Run the owner-protection drill: second factor, session review, backup check.')
  ];
}
function eventFor(state, id) { return (state.events || []).find(e => e.id === id) || null; }
function listEvents(state, filter) {
  const list = (state.events || []).slice();
  const f = filter && filter.state;
  return (f ? list.filter(e => e.state === f) : list)
    .map(e => Object.assign({}, e, {
      entries: e.participants.length,
      opensIn: Math.max(0, e.startsTs - now()),
      closesIn: Math.max(0, e.endsTs - now()),
      joinable: e.state !== 'CLOSED' && now() >= e.startsTs - 86400000 && now() < e.endsTs
    }))
    .sort((a, b) => a.startsTs - b.startsTs);
}
function joinEvent(state, id, who, opts) {
  opts = opts || {};
  const e = eventFor(state, id);
  if (!e) return { ok: false, error: 'Unknown event ' + id, available: (state.events || []).map(x => x.id) };
  if (e.state === 'CLOSED') return { ok: false, error: 'Event is closed' };
  if (now() > e.endsTs) { e.state = 'CLOSED'; return { ok: false, error: 'Event window has ended' }; }
  if (e.participants.some(p => p.who === who)) return { ok: false, error: who + ' is already entered in ' + e.title };
  const entry = { who, ts: now(), progress: {}, completed: false, claimed: false };
  e.participants.push(entry);
  e.state = 'RUNNING';
  return { ok: true, event: e, entry, cost: e.entryLD, payment: e.entryLD > 0 ? { account: who, delta: -e.entryLD, destination: 'Events Pool' } : null };
}
function eventPrize(state, e, winner) {
  /* Tournament prize: pool of entry fees, less the 1% Treasury rule (§90). */
  const pool = e.entryLD * e.participants.length;
  const treasury = Math.round(pool * 0.01);
  return { pool, treasury, payout: pool - treasury, winner };
}
function closeEvent(state, id, opts) {
  opts = opts || {};
  const e = eventFor(state, id);
  if (!e) return { ok: false, error: 'Unknown event ' + id };
  if (e.state === 'CLOSED') return { ok: false, error: 'Event already closed' };
  const completed = e.participants.filter(p => p.completed);
  if (opts.winner && e.type === 'arena-tournament') {
    const w = e.participants.find(p => p.who === opts.winner);
    if (!w) return { ok: false, error: 'Winner is not a participant' };
    const prize = eventPrize(state, e, opts.winner);
    e.winner = opts.winner;
    e.results = Object.assign({}, prize, { mode: 'SIMULATION', note: 'Entry-fee pool settled less the 1% Treasury rule.' });
    e.state = 'CLOSED';
    return { ok: true, event: e, settlement: { entries: [{ account: 'Events Pool', delta: -prize.payout }, { account: opts.winner, delta: prize.payout }], treasury: prize.treasury, prize } };
  }
  e.state = 'CLOSED';
  e.results = { completed: completed.length, participants: e.participants.length, note: 'Closed without a tournament settlement.' };
  return { ok: true, event: e, settle: false };
}

/* ══ Lotto — commit → reveal ═════════════════════════════════════════
 * Round lifecycle:
 *   OPEN    tickets sold; the server seed's hash is published as the commitment
 *   CLOSED  sales stop; the seed is revealed
 *   DRAWN   numbers derived from hash(seed + roundId) and prizes settled
 * Anyone can re-derive the numbers and every ticket's own numbers from the
 * published values, so the outcome cannot be changed after sales. */
const LOTTO_RULES = {
  numbersPerLine: 6,
  maxNumber: 49,
  ticketLD: 5,
  split: { tiers: 0.50, jackpot: 0.30, community: 0.15, treasury: 0.05 },
  tiers: [
    { match: 6, name: 'Jackpot', share: 1.00 },
    { match: 5, name: 'Tier 2', share: 0.60 },
    { match: 4, name: 'Tier 3', share: 0.30 },
    { match: 3, name: 'Tier 4', share: 0.10 }
  ],
  settlement: 'Ticket sales split 50% prize tiers, 30% jackpot, 15% community pool and the remainder (5%) to Treasury. Splits are fixed and disclosed. An unwon jackpot AND any tier prize that no ticket won both roll into the next round — unclaimed LD never disappears and is never kept.',
  fairness: 'The server commits to sha256(seed) when the round opens and reveals the seed at the draw, so the numbers cannot change after tickets are sold. Verification recomputes everything from the published values.',
  realMoney: 'Tickets are bought with LD only. Real-money participation is COMPLIANCE-LOCKED (§88/§92).'
};
function ticketNumbers(lineSeed) {
  const nums = [];
  let offset = 0;
  while (nums.length < LOTTO_RULES.numbersPerLine) {
    const n = 1 + rint(lineSeed, offset++, LOTTO_RULES.maxNumber);
    if (!nums.includes(n)) nums.push(n);
  }
  return nums.sort((a, b) => a - b);
}
function openRound(state, opts) {
  opts = opts || {};
  state.lottoRounds = state.lottoRounds || [];
  const open = state.lottoRounds.find(r => r.state === 'OPEN');
  if (open && !opts.force) return { ok: false, error: 'Round ' + open.id + ' is still open — close it before opening another', round: open };
  if (open && opts.force) open.state = 'CLOSED';
  const seed = crypto.randomBytes(32).toString('hex');
  const round = {
    id: 'lt' + (state.lottoRounds.length + 1) + '-' + sha(seed).slice(0, 6),
    state: 'OPEN', openedTs: now(), closedTs: null, drawnTs: null,
    ticketLD: LOTTO_RULES.ticketLD,
    commitHash: sha(seed),                 // published commitment
    serverSeed: seed,                      // revealed at the draw
    revealedSeed: null,
    tickets: [], drawn: null, prizes: null,
    rolloverIn: opts.rolloverIn || 0,
    note: 'Commitment published at open; seed revealed at the draw for independent verification.'
  };
  state.lottoRounds.unshift(round);
  if (state.lottoRounds.length > 24) state.lottoRounds.length = 24;
  return { ok: true, round };
}
function openRoundOf(state) { return (state.lottoRounds || []).find(r => r.state === 'OPEN') || null; }
function buyTickets(state, opts) {
  opts = opts || {};
  const owner = opts.owner || 'Owner';
  const count = Math.max(1, Math.min(50, Math.floor(Number(opts.count) || 1)));
  const r = openRoundOf(state);
  if (!r) return { ok: false, error: 'No lotto round is open. Say “open lotto round”.' };
  const cost = count * r.ticketLD;
  const tickets = [];
  for (let i = 0; i < count; i++) {
    const lineSeed = sha((opts.lineSeed || 'line') + '|' + owner + '|' + r.id + '|' + (r.tickets.length + i));
    tickets.push({ id: 'tk' + sha(lineSeed).slice(0, 8), owner, ts: now(), lineSeed, numbers: ticketNumbers(lineSeed) });
  }
  r.tickets.push(...tickets);
  return { ok: true, round: r, tickets, cost, entries: [{ account: owner, delta: -cost, destination: 'Lotto Pool' }], numbers: tickets.map(t => t.numbers) };
}
function drawNumbers(seed, roundId) { return ticketNumbers(sha('draw|' + seed + '|' + roundId)); }
function closeSales(state, roundId) {
  const r = roundId ? (state.lottoRounds || []).find(x => x.id === roundId) : openRoundOf(state);
  if (!r) return { ok: false, error: 'Unknown or missing round' };
  if (r.state === 'DRAWN') return { ok: false, error: 'Round already drawn' };
  if (!r.tickets.length) return { ok: false, error: 'No tickets sold — a draw with no participants would create value from nothing' };
  r.state = 'CLOSED';
  r.closedTs = now();
  r.revealedSeed = r.serverSeed;
  return { ok: true, round: r, commitmentMatches: sha(r.revealedSeed) === r.commitHash };
}
function drawRound(state, roundId, opts) {
  opts = opts || {};
  if (opts.confirmed !== true) return { ok: false, needsConfirmation: true, error: 'Drawing a round settles LD. Confirm with “draw lotto confirm”.' };
  const closed = closeSales(state, roundId);
  if (!closed.ok) return closed;
  const r = closed.round;
  if (!closed.commitmentMatches) return { ok: false, error: 'Commitment mismatch — the seed does not match the published hash; the round was not drawn' };
  const numbers = drawNumbers(r.revealedSeed, r.id);
  const gross = r.tickets.length * r.ticketLD;
  const split = LOTTO_RULES.split;
  const carryIn = r.rolloverIn || 0;
  /* The Treasury cut comes out of THIS round's sales; the carry-in is previous
   * rounds' money and is never re-taxed. */
  const jackpotContribution = Math.floor(gross * split.jackpot);
  const jackpotPool = jackpotContribution + carryIn;
  const tierPool = Math.floor(gross * split.tiers);
  const community = Math.floor(gross * split.community);
  const treasury = gross - jackpotContribution - tierPool - community;   // remainder keeps the post balanced

  const winners = { 6: [], 5: [], 4: [], 3: [] };
  for (const t of r.tickets) {
    const match = t.numbers.filter(n => numbers.includes(n)).length;
    if (winners[match]) winners[match].push(t);
  }
  const payouts = [];
  const shareOf = (tier, count) => Math.floor(tier / Math.max(1, count));
  let jackpotPaid = 0;
  if (winners[6].length) {
    const each = shareOf(jackpotPool, winners[6].length);
    jackpotPaid = each * winners[6].length;
    winners[6].forEach(t => payouts.push({ ticket: t.id, owner: t.owner, match: 6, tier: 'Jackpot', ld: each, numbers: t.numbers }));
  }
  const tierDefs = [{ match: 5, pct: 0.60 }, { match: 4, pct: 0.30 }, { match: 3, pct: 0.10 }];
  let tierPaid = 0;
  for (const def of tierDefs) {
    if (!winners[def.match].length) continue;
    const each = shareOf(Math.floor(tierPool * def.pct), winners[def.match].length);
    tierPaid += each * winners[def.match].length;
    winners[def.match].forEach(t => payouts.push({ ticket: t.id, owner: t.owner, match: def.match, tier: LOTTO_RULES.tiers.find(x => x.match === def.match).name, ld: each, numbers: t.numbers }));
  }
  const paid = jackpotPaid + tierPaid;
  const jackpotWon = winners[6].length > 0;
  const unclaimedTier = tierPool - tierPaid;                 // nobody matched 3/4/5 this round
  /* Jackpot Rollover moves: the carry-in leaves it when the jackpot is won;
   * the new contribution stays in it when it is not; unclaimed tiers join it. */
  const rolloverOut = jackpotWon ? unclaimedTier : jackpotContribution + unclaimedTier;
  const jackpotRolloverDelta = (jackpotWon ? 0 : jackpotContribution) - (jackpotWon ? carryIn : 0) + unclaimedTier;
  r.state = 'DRAWN';
  r.drawnTs = now();
  r.drawn = { numbers, seed: r.revealedSeed, commitHash: r.commitHash };
  r.rolloverOut = rolloverOut;
  r.prizes = {
    gross, jackpotContribution, carryIn, jackpotPool, tierPool, community, treasury, paid, payouts, rolloverOut, unclaimedTier, jackpotWon,
    winnersByTier: { 6: winners[6].length, 5: winners[5].length, 4: winners[4].length, 3: winners[3].length }
  };

  /* Balanced settlement: every LD that left a player returns somewhere. */
  const credits = new Map();
  for (const p of payouts) credits.set(p.owner, (credits.get(p.owner) || 0) + p.ld);
  const entries = [{ account: 'Lotto Pool', delta: -gross }];
  entries.push({ account: 'Community Pool', delta: community });
  entries.push({ account: 'Treasury', delta: treasury });
  if (jackpotRolloverDelta !== 0) entries.push({ account: 'Jackpot Rollover', delta: jackpotRolloverDelta });
  for (const [who, ld] of credits) entries.push({ account: who, delta: ld });
  const balanced = entries.reduce((sum, e) => sum + e.delta, 0);
  if (balanced !== 0) {
    /* A draw that does not add up is not a draw: put the round back and say so. */
    r.state = 'CLOSED'; r.drawn = null; r.drawnTs = null; r.prizes = null; r.rolloverOut = null;
    return { ok: false, error: 'Refusing to settle: allocation does not balance (differs by ' + balanced + ' LD). Nothing was paid and the round is left closed, not drawn.', round: r };
  }
  return { ok: true, round: r, numbers, entries, payouts, prize: r.prizes, rolledOver: !jackpotWon };
}
function verifyRound(round) {
  if (!round || !round.drawn) return { ok: false, error: 'Round is not drawn yet' };
  const recomputed = drawNumbers(round.revealedSeed, round.id);
  const commitOk = sha(round.revealedSeed) === round.commitHash;
  const ticketsOk = round.tickets.every(t => JSON.stringify(ticketNumbers(t.lineSeed)) === JSON.stringify(t.numbers));
  const totalOk = round.prizes.gross === round.tickets.length * round.ticketLD;
  const alloc = round.prizes.community + round.prizes.treasury + round.prizes.rolloverOut + round.prizes.paid;
  const allocOk = alloc === round.prizes.gross;              // sum of every allocation equals sales
  return {
    ok: commitOk && ticketsOk && totalOk && allocOk && JSON.stringify(recomputed) === JSON.stringify(round.drawn.numbers),
    commitOk, ticketsOk, totalOk, allocOk,
    allocation: { sales: round.prizes.gross, community: round.prizes.community, treasury: round.prizes.treasury, rollover: round.prizes.rolloverOut, paid: round.prizes.paid },
    numbers: recomputed,
    note: 'Recomputed from the revealed seed. Commit → reveal means the house cannot change numbers after tickets are sold.'
  };
}

/* ══ Sign-in gifts ═══════════════════════════════════════════════════ */
const DAY = 86400000;
const SIGN_IN_REWARDS = [
  { day: 1, ld: 10, blurb: 'Welcome back.' },
  { day: 2, ld: 20, blurb: 'Two in a row.' },
  { day: 3, ld: 35, blurb: 'Three days — small piece voucher.' },
  { day: 4, ld: 50, blurb: 'Streak holding.' },
  { day: 5, ld: 75, blurb: 'Five days.' },
  { day: 6, ld: 110, blurb: 'Almost a full week.' },
  { day: 7, ld: 200, bonus: 'piece:Rare', blurb: 'Full week — Rare piece voucher.' }
];
function signInStatus(state, who) {
  const rec = (state.signIns || []).find(s => s.who === who);
  if (!rec) return { who, streak: 0, claimedToday: false, nextInMs: 0, nextReward: SIGN_IN_REWARDS[0], cycle: SIGN_IN_REWARDS };
  const since = now() - rec.lastTs;
  return {
    who, streak: rec.streak, totalClaims: rec.claims, lastTs: rec.lastTs,
    claimedToday: since < DAY,
    nextInMs: Math.max(0, DAY - since),
    nextReward: SIGN_IN_REWARDS[rec.streak % SIGN_IN_REWARDS.length],
    cycle: SIGN_IN_REWARDS,
    streakBroken: since > 2 * DAY
  };
}
function claimSignIn(state, who) {
  state.signIns = state.signIns || [];
  let rec = state.signIns.find(s => s.who === who);
  const ts = now();
  if (rec && ts - rec.lastTs < DAY) {
    return { ok: false, error: 'Already claimed today. Next gift in ' + Math.ceil((DAY - (ts - rec.lastTs)) / 3600000) + 'h.', status: signInStatus(state, who) };
  }
  if (!rec) { rec = { who, streak: 0, claims: 0, lastTs: 0, history: [] }; state.signIns.push(rec); }
  const continued = ts - rec.lastTs <= 2 * DAY;                 // a missed day here or there keeps the streak
  rec.streak = continued && rec.lastTs ? rec.streak + 1 : 1;
  const reward = SIGN_IN_REWARDS[(rec.streak - 1) % SIGN_IN_REWARDS.length];
  rec.claims++;
  rec.lastTs = ts;
  rec.history.unshift({ ts, day: ((rec.streak - 1) % 7) + 1, ld: reward.ld, bonus: reward.bonus || null });
  if (rec.history.length > 60) rec.history.length = 60;
  return {
    ok: true, day: ((rec.streak - 1) % 7) + 1, streak: rec.streak, ld: reward.ld, bonus: reward.bonus || null,
    earnedBonus: reward.bonus ? 7 : 0,
    entries: [{ account: 'Rewards Pool', delta: -reward.ld }, { account: who, delta: reward.ld }],
    note: 'Sign-in gifts are funded from the Rewards Pool, never minted silently (§164).'
  };
}

/* ══ Daily and weekly tasks ══════════════════════════════════════════ */
const DAILY_TASKS = [
  { id: 'd-signin', metric: 'signin.claim', target: 1, ld: 10, title: 'Sign in' },
  { id: 'd-tools', metric: 'tool.run', target: 5, ld: 25, title: 'Run five actions' },
  { id: 'd-armoury', metric: 'piece.create', target: 1, ld: 40, title: 'Forge or provision one piece' },
  { id: 'd-battle', metric: 'battle.fight', target: 1, ld: 30, title: 'Fight one battle' },
  { id: 'd-market', metric: 'market.trade', target: 1, ld: 30, title: 'Buy or sell on the marketplace' },
  { id: 'd-vault', metric: 'security.check', target: 1, ld: 20, title: 'Run a security check' },
  { id: 'd-lotto', metric: 'lotto.ticket', target: 1, ld: 15, title: 'Buy a lotto ticket' },
  { id: 'd-event', metric: 'event.progress', target: 1, ld: 20, title: 'Make progress in an event' }
];
const WEEKLY_TASKS = [
  { id: 'w-weekly-streak', metric: 'signin.claim', target: 5, ld: 200, title: 'Sign in five days this week' },
  { id: 'w-forge', metric: 'piece.create', target: 7, ld: 300, title: 'Create seven pieces' },
  { id: 'w-arena', metric: 'battle.fight', target: 5, ld: 250, title: 'Fight five battles' },
  { id: 'w-trade', metric: 'market.trade', target: 3, ld: 220, title: 'Complete three trades' },
  { id: 'w-lotto', metric: 'lotto.ticket', target: 5, ld: 150, title: 'Buy five lotto tickets' },
  { id: 'w-guardian', metric: 'security.check', target: 3, ld: 180, title: 'Run three security checks' },
  { id: 'w-events', metric: 'event.progress', target: 3, ld: 200, title: 'Progress three event objectives' },
  { id: 'w-tasks', metric: 'quest.claim', target: 5, ld: 250, title: 'Claim five daily tasks' }
];
function dayKey(ts) { const d = new Date(ts === undefined ? now() : ts); return d.toISOString().slice(0, 10); }
function weekKey(ts) {
  const d = new Date(ts === undefined ? now() : ts);
  const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - onejan) / DAY) + onejan.getUTCDay() + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}
/* Deterministic board: the day/week key seeds the choice, so everybody gets
 * the same tasks for that window and nobody can reroll for a better board. */
function pick(list, key, n) {
  const seed = sha('board|' + key);
  const out = [];
  const pool = list.slice();
  let i = 0;
  while (out.length < Math.min(n, list.length)) {
    const pickIdx = rint(seed, i++, pool.length);
    out.push(pool.splice(pickIdx, 1)[0]);
  }
  return out;
}
function questBoard(state) {
  state.quests = state.quests || {};
  const day = dayKey(), week = weekKey();
  if (!state.quests.day || state.quests.day !== day) {
    state.quests.day = day;
    state.quests.daily = pick(DAILY_TASKS, day, 4).map(t => Object.assign({}, t, { progress: 0, claimed: false }));
  }
  if (!state.quests.week || state.quests.week !== week) {
    state.quests.week = week;
    state.quests.weekly = pick(WEEKLY_TASKS, week, 4).map(t => Object.assign({}, t, { progress: 0, claimed: false }));
  }
  return state.quests;
}
function progressQuest(state, metric, amount) {
  const board = questBoard(state);
  const advanced = [];
  for (const list of [board.daily, board.weekly]) {
    for (const q of list) {
      if (q.metric !== metric || q.claimed) continue;
      const before = q.progress;
      q.progress = Math.min(q.target, q.progress + (amount === undefined ? 1 : Math.max(1, Number(amount) || 1)));
      if (q.progress !== before) advanced.push({ id: q.id, window: list === board.daily ? 'daily' : 'weekly', progress: q.progress, target: q.target, complete: q.progress >= q.target, title: q.title });
    }
  }
  return advanced;
}
function claimQuest(state, id, who) {
  const board = questBoard(state);
  const list = board.daily.concat(board.weekly);
  const q = list.find(x => x.id === id);
  if (!q) return { ok: false, error: 'No task ' + id + ' on this board', available: list.map(x => x.id) };
  if (q.claimed) return { ok: false, error: 'Task already claimed in this window' };
  if (q.progress < q.target) return { ok: false, error: `Task not complete (${q.progress}/${q.target})`, quest: q };
  q.claimed = true;
  q.claimedTs = now();
  q.claimedBy = who;
  return {
    ok: true, quest: q, ld: q.ld, window: board.daily.includes(q) ? 'daily' : 'weekly',
    entries: [{ account: 'Rewards Pool', delta: -q.ld }, { account: who, delta: q.ld }],
    note: 'Task rewards are funded from the Rewards Pool, never minted silently (§164).'
  };
}
function questSummary(state) {
  const board = questBoard(state);
  const fmt = (q, window) => Object.assign({}, q, { window, complete: q.progress >= q.target, claimable: q.progress >= q.target && !q.claimed });
  return {
    day: board.day, week: board.week,
    daily: board.daily.map(q => fmt(q, 'daily')),
    weekly: board.weekly.map(q => fmt(q, 'weekly')),
    claimable: board.daily.concat(board.weekly).filter(q => q.progress >= q.target && !q.claimed).length
  };
}

/* ══ Extension manifest (documented in the report and registry) ══════ */
const EXTENSION_IDS = [
  'ENG-EVENTS', 'ENG-LOTTO', 'ENG-FAIRNESS', 'ENG-SIGNIN', 'ENG-DAILYTASKS', 'ENG-WEEKLYTASKS',
  'ECO-LD-MARKET', 'ECO-PIECE-COSTS', 'ECO-PET-COSTS', 'ECO-MERGE-COSTS'
];

module.exports = {
  LD_MARKET, ldOrderQuote, ldOrderEntries,
  PIECE_COST, PET_COST, MERGE_COST, PIECE_RULES, pieceCost,
  EVENT_TYPES, seedEvents, listEvents, eventFor, joinEvent, closeEvent, eventPrize,
  LOTTO_RULES, openRound, openRoundOf, buyTickets, closeSales, drawRound, verifyRound, ticketNumbers, drawNumbers,
  SIGN_IN_REWARDS, claimSignIn, signInStatus,
  DAILY_TASKS, WEEKLY_TASKS, questBoard, progressQuest, claimQuest, questSummary, dayKey, weekKey,
  EXTENSION_IDS
};
