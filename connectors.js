/* LIAM connector & adapter registries (v1.84.0 — extracted from platform.js). */
'use strict';
/* The declarative catalogue of what the platform can touch and what is
 * truthfully stateable about each: postable vs verify-only social APIs with
 * their honest reasons, and the adapter registry whose `state` strings are
 * the exact words the UI shows ("FREE KEY", "DEVELOPER KEY", "NO PUBLIC
 * API"…). Rule kept from capabilities.js (§108/§165): declaring a
 * capability never means it works — states here are the truth, not wishes.
 *
 * Pure data + one state.sampler: no I/O, no globals (the TERMUX entry reads
 * the env once at load, exactly as it always did). */
const SOCIALS = [
  { id: 'x', name: 'X (Twitter)', verifyUrl: 'https://api.twitter.com/2/users/me', postable: true,
    signup: 'developer.x.com app + bearer token (tweet.read/write)', postUrl: 'https://api.twitter.com/2/tweets', cap: 280 },
  { id: 'facebook', name: 'Facebook', verifyUrl: 'https://graph.facebook.com/v21.0/me', postable: true,
    signup: 'developers.facebook.com app + Page access token (pages_manage_posts)', postUrl: 'https://graph.facebook.com/v21.0/me/feed', cap: 5000 },
  { id: 'reddit', name: 'Reddit', verifyUrl: 'https://oauth.reddit.com/api/v1/me', postable: true,
    signup: 'reddit.com/prefs/apps OAuth app', postUrl: 'https://oauth.reddit.com/api/submit', cap: 40000 },
  { id: 'instagram', name: 'Instagram (Business)', verifyUrl: 'https://graph.facebook.com/v21.0/me', postable: false,
    signup: 'Instagram Business account + Graph API token', reason: 'posting is a two-step media/publish flow tied to a Business account — connect + verify works today; posting lands after the Business account is attached' },
  { id: 'linkedin', name: 'LinkedIn', verifyUrl: 'https://api.linkedin.com/v2/userinfo', postable: false,
    signup: 'linkedin.com/developers app (openid profile, w_member_social)', reason: 'posting requires an approved community-marketing access tier on the developer app — verify works today' },
  { id: 'tiktok', name: 'TikTok', verifyUrl: 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', postable: false,
    signup: 'developers.tiktok.com app (User Info basics)', reason: 'the Content Posting API posts videos, not text — verify works today; video upload is a separate audited tool if you want it' }
];
const SOCIAL_POSTABLE = SOCIALS.filter(x => x.postable).map(x => x.id);
function socialEntry(id) { return SOCIALS.find(x => x.id === String(id || '').toLowerCase()); }

const ADAPTERS = [
  { id: 'sys', name: 'System Inspector', caps: [{ id: 'sys.read', risk: 'low', desc: 'OS/runtime/interface facts from the host process' }], state: 'AVAILABLE' },
  { id: 'fs', name: 'Scoped Filesystem', caps: [{ id: 'fs.read', risk: 'low', desc: 'List/read files inside the LIAM userfiles sandbox' }, { id: 'fs.write', risk: 'medium', desc: 'Write/delete files inside the sandbox only' }], state: 'AVAILABLE' },
  { id: 'http', name: 'Guarded HTTP', caps: [{ id: 'http.get', risk: 'medium', desc: 'Real outbound GET with SSRF/private-address/metadata blocking' }], state: 'AVAILABLE' },
  { id: 'weather', name: 'Open-Meteo Weather', caps: [{ id: 'weather.get', risk: 'medium', desc: 'Real geocoding + forecast via Open-Meteo (no key required)' }], state: 'AVAILABLE' },
  { id: 'groq', name: 'Groq AI (free tier, forever)', caps: [{ id: 'llm.chat', risk: 'medium', desc: 'LLM chat via Groq — free key, no card' }], state: 'FREE KEY — say “connect groq with token <key>”' },
  { id: 'gemini', name: 'Google AI Studio (Gemini, free tier)', caps: [{ id: 'llm.chat', risk: 'medium', desc: 'LLM chat via Gemini — free key, no card' }], state: 'FREE KEY — say “connect gemini with token <key>”' },
  { id: 'openrouter', name: 'OpenRouter (aggregator, “:free” models)', caps: [{ id: 'llm.chat', risk: 'medium', desc: 'LLM chat via OpenRouter free models' }], state: 'FREE KEY — say “connect openrouter with token <key>”' },
  { id: 'deepseek', name: 'DeepSeek (free grant on signup)', caps: [{ id: 'llm.chat', risk: 'medium', desc: 'LLM chat via DeepSeek' }], state: 'FREE KEY — say “connect deepseek with token <key>”' },
  { id: 'mistral', name: 'Mistral (free tier)', caps: [{ id: 'llm.chat', risk: 'medium', desc: 'LLM chat via Mistral' }], state: 'FREE KEY — say “connect mistral with token <key>”' },
  { id: 'nvidia-nim', name: 'NVIDIA NIM (free developer credits)', caps: [{ id: 'llm.chat', risk: 'medium', desc: 'LLM chat via NVIDIA NIM — free developer key with starter credits' }], state: 'FREE KEY — build.nvidia.com, then “connect nvidia-nim with token <key>”' },
  { id: 'together-ai', name: 'Together AI (free starter tier)', caps: [{ id: 'llm.chat', risk: 'medium', desc: 'LLM chat via Together AI open models' }], state: 'FREE KEY — together.ai console, then “connect together-ai with token <key>”' },
  { id: 'ollama', name: 'Ollama (local open-source models)', caps: [{ id: 'llm.chat', risk: 'medium', desc: 'Runs on this machine at 127.0.0.1:11434 — no key, nothing leaves' }], state: 'LOCAL — install Ollama, “ollama pull llama3.2”' },
  { id: 'x', name: 'X (Twitter) — official API', caps: [{ id: 'social.post', risk: 'high', desc: 'Post via your own developer bearer token' }], state: 'DEVELOPER KEY — developer.x.com, then “connect x with token <t>”' },
  { id: 'facebook', name: 'Facebook — Graph API', caps: [{ id: 'social.post', risk: 'high', desc: 'Page post via your Page access token' }], state: 'DEVELOPER KEY — developers.facebook.com, then “connect facebook with token <t>”' },
  { id: 'reddit', name: 'Reddit — official API', caps: [{ id: 'social.post', risk: 'high', desc: 'Submit via your OAuth app' }], state: 'DEVELOPER KEY — reddit.com/prefs/apps, then “connect reddit with token <t>”' },
  { id: 'instagram', name: 'Instagram Business — Graph API', caps: [{ id: 'social.verify', risk: 'medium', desc: 'Verify your Business account identity' }], state: 'DEVELOPER KEY — Business account + token, then “connect instagram with token <t>”' },
  { id: 'linkedin', name: 'LinkedIn — official API', caps: [{ id: 'social.verify', risk: 'medium', desc: 'Verify your member identity' }], state: 'DEVELOPER KEY — linkedin.com/developers, then “connect linkedin with token <t>”' },
  { id: 'tiktok', name: 'TikTok — official API', caps: [{ id: 'social.verify', risk: 'medium', desc: 'Verify your user identity' }], state: 'DEVELOPER KEY — developers.tiktok.com, then “connect tiktok with token <t>”' },
  { id: 'exec', name: 'Allowlisted Executor', caps: [{ id: 'exec.run', risk: 'medium', desc: 'Bounded, shell:false allowlisted operations with timeouts and output caps' }], state: 'AVAILABLE' },
  { id: 'economy', name: 'LD Ledger (simulation)', caps: [{ id: 'economy.manage', risk: 'medium', desc: 'Double-entry simulation ledger; 100 LD = A$1.00 reference' }], state: 'AVAILABLE' },
  { id: 'arena', name: 'Arena Engine', caps: [{ id: 'arena.fight', risk: 'low', desc: 'Server-authoritative battles' }], state: 'AVAILABLE' },
  { id: 'github', name: 'GitHub REST', caps: [{ id: 'github.read', risk: 'medium', desc: 'Real GitHub API reads when a token is configured' }, { id: 'github.write', risk: 'high', desc: 'Real repo file create/update via Contents API (approval-gated)' }], state: 'UNAVAILABLE' },
  { id: 'hackernews', name: 'Hacker News Official API', caps: [{ id: 'hn.read', risk: 'low', desc: 'Real top stories via the official Firebase-backed HN API (no key required)' }], state: 'AVAILABLE' },
  { id: 'countries', name: 'Countries (countries.dev)', caps: [{ id: 'country.read', risk: 'low', desc: 'Real country facts via countries.dev (keyless; REST Countries v3.1 deprecated in 2026, v5 needs a paid-tier key)' }], state: 'AVAILABLE' },
  { id: 'puter', name: 'Puter.js Bridge', caps: [{ id: 'puter.ai', risk: 'medium', desc: 'Live model discovery/chat in the browser when Puter.js loads' }], state: 'EXTERNAL (browser-reported)' },
  { id: 'stripe', name: 'Stripe Payments', caps: [{ id: 'stripe.manage', risk: 'medium', desc: 'Real Stripe account verification, checkout sessions and paid-status evidence' }], state: 'UNAVAILABLE' },
  { id: 'proton', name: 'Proton Wallet', caps: [{ id: 'proton.pay', risk: 'high', desc: 'Proton publishes no public payment/wallet merchant API' }], state: 'NO PUBLIC API' },
  { id: 'google', name: 'Google Workspace', caps: [{ id: 'google.api', risk: 'high', desc: 'Gmail/Calendar via OAuth when configured' }], state: 'UNAVAILABLE' },
  { id: 'termux', name: 'Termux Runtime', caps: [{ id: 'termux.run', risk: 'high', desc: 'Real only when a Termux runtime is detected' }], state: process.env.TERMUX ? 'CONFIGURED_UNVERIFIED' : 'UNAVAILABLE' },
  { id: 'device', name: 'Device Bridges', caps: [{ id: 'device.bridge', risk: 'high', desc: 'ADB/Shizuku/Companion bridges require real pairing' }], state: 'UNAVAILABLE' },
  { id: 'fx', name: 'Frankfurter FX', caps: [{ id: 'fx.get', risk: 'low', desc: 'Real currency conversion via Frankfurter/ECB rates (no key required)' }], state: 'AVAILABLE' },
  { id: 'wikipedia', name: 'Wikipedia Research', caps: [{ id: 'wiki.read', risk: 'low', desc: 'Real article summaries via Wikipedia REST API (no key required)' }], state: 'AVAILABLE' },
  { id: 'dns', name: 'DNS over HTTPS', caps: [{ id: 'dns.resolve', risk: 'low', desc: 'Real DNS resolution via Cloudflare DoH (no key required)' }], state: 'AVAILABLE' },
  { id: 'utils', name: 'Local Utilities', caps: [{ id: 'util.run', risk: 'low', desc: 'Offline utilities: hash, uuid, base64, time — deterministic, no network' }], state: 'AVAILABLE' }
];

/* Live-state sampler: the static registry, overlaid with operational truth
 * derived from the platform state handed in by the caller (credential
 * presence, verification evidence, Stripe account record). */
function adaptersLive(state) {
  const S = state || {};
  return ADAPTERS.map(a => {
    if (a.id === 'stripe') {
      const st = !((S.creds || {}).stripe) ? 'UNAVAILABLE' : (S.economy && S.economy.stripeAccount ? 'VERIFIED' : 'CONFIGURED_UNVERIFIED');
      return Object.assign({}, a, { state: st });
    }
    if (a.id === 'github') {
      const has = (S.creds && S.creds.github) || process.env.GITHUB_TOKEN;
      const st = !has ? 'UNAVAILABLE' : ((S.verifiedConnectors && S.verifiedConnectors.github) ? 'VERIFIED (' + (S.verifiedConnectors.github.user || '') + ')' : 'CONFIGURED_UNVERIFIED');
      return Object.assign({}, a, { state: st });
    }
    return a;
  });
}

module.exports = { SOCIALS, SOCIAL_POSTABLE, socialEntry, ADAPTERS, adaptersLive };
