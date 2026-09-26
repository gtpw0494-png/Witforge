/* Patch 9: platform-services.js — multi-tiered plans for personal and business,
 * with the engagement entitlements the v1.65 surface consumes.
 * Uses a function replacer (never a string replacement) so `$` is literal. */
'use strict';
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'platform-services.js');
let s = fs.readFileSync(f, 'utf8');
let n = 0;
function rep(old, neu, label) {
  if (!s.includes(old)) { console.error('MISS: ' + label); process.exitCode = 1; return; }
  s = s.replace(old, () => neu);
  n++;
  console.log('ok: ' + label);
}

rep(`const PLANS = [
  { id: 'free', name: 'Free', entitlements: { 'agents.max': 1, 'storage.mb': 50, 'ai.daily': 25, 'tools.max': 6, 'org.seats': 1, 'marketplace.list': 1, 'api.access': false } },
  { id: 'plus', name: 'Plus', entitlements: { 'agents.max': 5, 'storage.mb': 500, 'ai.daily': 250, 'tools.max': 12, 'org.seats': 3, 'marketplace.list': 5, 'api.access': false } },
  { id: 'pro', name: 'Pro', entitlements: { 'agents.max': 20, 'storage.mb': 5000, 'ai.daily': 2000, 'tools.max': 24, 'org.seats': 10, 'marketplace.list': 25, 'api.access': true } },
  { id: 'business', name: 'Business', entitlements: { 'agents.max': 100, 'storage.mb': 25000, 'ai.daily': 10000, 'tools.max': 40, 'org.seats': 100, 'marketplace.list': 200, 'api.access': true } },
  { id: 'enterprise', name: 'Enterprise', entitlements: { 'agents.max': 1000, 'storage.mb': 250000, 'ai.daily': 100000, 'tools.max': 60, 'org.seats': 1000, 'marketplace.list': 5000, 'api.access': true } }
];`,
`/* §114: subscription levels are multi-tiered across two families. Prices are
 * reference labels only — no charge is created until billing authority exists
 * (see bill()). Entitlements are enforced server-side by requireEntitlement(). */
const PLANS = [
  /* ── personal ───────────────────────────────────────────────────── */
  { id: 'free', name: 'Free', family: 'personal', rank: 0, priceAudMonth: 0, blurb: 'Everything the platform is, for one person, with no charge.',
    entitlements: { 'agents.max': 1, 'storage.mb': 50, 'ai.daily': 25, 'tools.max': 6, 'org.seats': 1, 'marketplace.list': 1, 'api.access': false, 'guardian.level': 'BASIC', 'lotto.ticketsPerDay': 5, 'events.access': 'standard', 'signin.bonusPct': 0, 'support': 'community', 'audit.export': false } },
  { id: 'plus', name: 'Plus', family: 'personal', rank: 1, priceAudMonth: 9, blurb: 'More agents, more storage, the guardian on Standard.',
    entitlements: { 'agents.max': 3, 'storage.mb': 500, 'ai.daily': 200, 'tools.max': 10, 'org.seats': 1, 'marketplace.list': 5, 'api.access': false, 'guardian.level': 'STANDARD', 'lotto.ticketsPerDay': 20, 'events.access': 'standard', 'signin.bonusPct': 5, 'support': 'email', 'audit.export': false } },
  { id: 'pro', name: 'Pro', family: 'personal', rank: 2, priceAudMonth: 29, blurb: 'For one person running real work: hardened guardian, API access, priority events.',
    entitlements: { 'agents.max': 10, 'storage.mb': 5000, 'ai.daily': 1000, 'tools.max': 20, 'org.seats': 3, 'marketplace.list': 25, 'api.access': true, 'guardian.level': 'HARDENED', 'lotto.ticketsPerDay': 50, 'events.access': 'priority', 'signin.bonusPct': 10, 'support': 'priority', 'audit.export': true } },
  { id: 'elite', name: 'Elite', family: 'personal', rank: 3, priceAudMonth: 79, blurb: 'Maximum seat: maximum guardian posture, largest personal allowances.',
    entitlements: { 'agents.max': 25, 'storage.mb': 25000, 'ai.daily': 5000, 'tools.max': 32, 'org.seats': 5, 'marketplace.list': 100, 'api.access': true, 'guardian.level': 'MAXIMUM', 'lotto.ticketsPerDay': 200, 'events.access': 'priority', 'signin.bonusPct': 20, 'support': 'priority', 'audit.export': true } },
  /* ── business ───────────────────────────────────────────────────── */
  { id: 'business', name: 'Business', family: 'business', rank: 1, priceAudMonth: 49, blurb: 'One organisation, several operators, shared entitlements.',
    entitlements: { 'agents.max': 50, 'storage.mb': 25000, 'ai.daily': 4000, 'tools.max': 32, 'org.seats': 25, 'marketplace.list': 200, 'api.access': true, 'guardian.level': 'HARDENED', 'lotto.ticketsPerDay': 100, 'events.access': 'priority', 'signin.bonusPct': 10, 'support': 'business', 'audit.export': true } },
  { id: 'business-plus', name: 'Business Plus', family: 'business', rank: 2, priceAudMonth: 149, blurb: 'Departments, delegated administration and a bigger audit trail.',
    entitlements: { 'agents.max': 200, 'storage.mb': 100000, 'ai.daily': 20000, 'tools.max': 40, 'org.seats': 100, 'marketplace.list': 1000, 'api.access': true, 'guardian.level': 'MAXIMUM', 'lotto.ticketsPerDay': 500, 'events.access': 'priority', 'signin.bonusPct': 15, 'support': 'business', 'audit.export': true } },
  { id: 'enterprise', name: 'Enterprise', family: 'business', rank: 3, priceAudMonth: 499, blurb: 'Whole-company operation with segregation and evidence export.',
    entitlements: { 'agents.max': 1000, 'storage.mb': 500000, 'ai.daily': 100000, 'tools.max': 60, 'org.seats': 500, 'marketplace.list': 5000, 'api.access': true, 'guardian.level': 'MAXIMUM', 'lotto.ticketsPerDay': 2000, 'events.access': 'sponsored', 'signin.bonusPct': 20, 'support': 'dedicated', 'audit.export': true } },
  { id: 'enterprise-max', name: 'Enterprise Max', family: 'business', rank: 4, priceAudMonth: 1999, blurb: 'Largest allowances this build can express, with a dedicated support path.',
    entitlements: { 'agents.max': 5000, 'storage.mb': 2000000, 'ai.daily': 250000, 'tools.max': 60, 'org.seats': 5000, 'marketplace.list': 50000, 'api.access': true, 'guardian.level': 'MAXIMUM', 'lotto.ticketsPerDay': 10000, 'events.access': 'sponsored', 'signin.bonusPct': 25, 'support': 'dedicated', 'audit.export': true } }
];
function plansFor(family) { return PLANS.filter(p => p.family === family); }
function planById(id) { return PLANS.find(p => p.id === String(id || '').toLowerCase()) || null; }
function planRank(id) { const p = planById(id); return p ? p.rank : 0; }
function upgradePathFrom(id) {
  const p = planById(id);
  if (!p) return plansFor('personal');
  return PLANS.filter(x => x.family === p.family && x.rank > p.rank);
}
function comparePlans(a, b) {
  const A = planById(a), B = planById(b);
  if (!A || !B) return { ok: false, error: 'Unknown plan' };
  const keys = Array.from(new Set(Object.keys(A.entitlements).concat(Object.keys(B.entitlements))));
  return {
    ok: true, from: A.id, to: B.id, family: B.family, sameFamily: A.family === B.family,
    priceDeltaAud: B.priceAudMonth - A.priceAudMonth,
    changes: keys.filter(k => A.entitlements[k] !== B.entitlements[k]).map(k => ({ key: k, from: A.entitlements[k], to: B.entitlements[k] }))
  };
}`, 'plans');

rep(`function subscribe(state, opts) {
  opts = opts || {};
  const p = plan(opts.plan || 'free');
  state.subscription = {
    planId: p.id, planName: p.name, since: now(),
    entitlements: p.entitlements,
    usage: {},
    status: 'ACTIVE',
    billing: { invoices: [], chargeable: false, note: 'Billing actions require explicit authority (§114). Real money stays compliance-locked until legal review.' }
  };
  return { ok: true, subscription: state.subscription };
}`,
`function subscribe(state, opts) {
  opts = opts || {};
  const p = planById(opts.plan) || plan(opts.plan || 'free');
  state.subscription = {
    planId: p.id, planName: p.name, family: p.family || 'personal', rank: p.rank === undefined ? 0 : p.rank,
    priceAudMonth: p.priceAudMonth === undefined ? 0 : p.priceAudMonth,
    blurb: p.blurb || '', since: now(),
    entitlements: p.entitlements,
    usage: {},
    status: 'ACTIVE',
    billing: { invoices: [], chargeable: false, note: 'Billing actions require explicit authority (§114). Real money stays compliance-locked until legal review.' }
  };
  return { ok: true, subscription: state.subscription };
}`, 'subscribe');

rep(`function currentSubscription(state) { return state.subscription || (state.subscription = subscribe(state, { plan: 'free' }).subscription); }`,
`function currentSubscription(state) {
  const s = state.subscription || (state.subscription = subscribe(state, { plan: 'free' }).subscription);
  if (!s.family) {                                   // older local records gain the tier fields
    const p = planById(s.planId) || plan('free');
    s.family = p.family || 'personal';
    s.rank = p.rank === undefined ? 0 : p.rank;
    s.priceAudMonth = p.priceAudMonth === undefined ? 0 : p.priceAudMonth;
    s.blurb = p.blurb || '';
  }
  return s;
}`, 'currentSubscription');

rep(`  ACCOUNT_CAPABILITIES,`, `  ACCOUNT_CAPABILITIES, PLANS, plansFor, planById, planRank, upgradePathFrom, comparePlans,`, 'exports');

fs.writeFileSync(f, s);
console.log(n + ' replacements applied');
