/* LIAM — official OAuth sign-in (v1.77).
 *
 * The user logs in on the PLATFORM's own page — never here. Passwords never
 * touch WitForge (Charter art. III: human-required steps are completed by the
 * human; provider interfaces only — §130–§139). What this module builds is
 * the legitimate machinery every website/app uses: an authorization URL to
 * open, then a token-exchange request the server can run with guardedFetch.
 *
 * Truth rules (unchanged):
 *  - a provider with no registered app reports SETUP REQUIRED with the exact
 *    portal path — it is never faked as connectable;
 *  - state tokens are single-use and expire in 10 minutes (CSRF guard);
 *  - the builders below are pure and dry-testable — wire format is verified
 *    in platform-test without any network call; real verification happens
 *    only against a real registered app, on record.
 *
 * Zero dependencies. Standard Node only.
 */
'use strict';

const crypto = require('crypto');

const OAUTH_PROVIDERS = {
  x: {
    name: 'X (Twitter)',
    authorize: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    pkce: true,
    scopes: 'tweet.read tweet.write users.read offline.access',
    portal: 'console.x.com → your app → User authentication settings (set the callback URL shown, enable the scopes)'
  },
  facebook: {
    name: 'Facebook (Graph API)',
    authorize: 'https://www.facebook.com/v25.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v25.0/oauth/access_token',
    pkce: false,
    scopes: 'pages_manage_posts,pages_read_engagement,pages_show_list',
    portal: 'developers.facebook.com → your app → Facebook Login → Settings (add the redirect URI shown)'
  },
  instagram: {
    name: 'Instagram (via Meta login)',
    authorize: 'https://www.facebook.com/v25.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v25.0/oauth/access_token',
    pkce: false,
    scopes: 'instagram_basic,pages_show_list',
    portal: 'developers.facebook.com → your app → add the Instagram product (Business/Creator account linked to a Page)'
  },
  reddit: {
    name: 'Reddit',
    authorize: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    pkce: false, basic: true, duration: 'permanent',
    scopes: 'identity read submit',
    portal: 'reddit.com/prefs/apps → create app (type: script) with the redirect URI shown'
  },
  linkedin: {
    name: 'LinkedIn',
    authorize: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    pkce: false,
    scopes: 'openid profile email',
    portal: 'linkedin.com/developers → your app → Auth → add the OAuth 2.0 redirect URL shown'
  },
  tiktok: {
    name: 'TikTok',
    authorize: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    pkce: false, clientParam: 'client_key',
    scopes: 'user.info.basic',
    portal: 'developers.tiktok.com → your app → Manage apps (add the redirect URL shown)'
  }
};
const OAUTH_IDS = Object.keys(OAUTH_PROVIDERS);
const STATE_TTL_MS = 10 * 60 * 1000;

function providerOf(id) { return OAUTH_PROVIDERS[String(id || '').toLowerCase()] || null; }

function base64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/* Build everything needed to open the provider's own sign-in page.
 * Dry — no network. Returns { url, state, codeVerifier? } so the caller can
 * park the pending flow and validate the callback (state match, TTL). */
function buildAuthorize(id, opts) {
  const p = providerOf(id);
  if (!p) return { error: 'Unknown OAuth provider ' + id };
  const clientId = String(opts.clientId || '').trim();
  if (!clientId) return { error: p.name + ' SETUP REQUIRED — register your developer app first (' + p.portal + '), then save its client id here.' };
  const redirectUri = String(opts.redirectUri || '').trim();
  if (!/^https?:\/\//.test(redirectUri)) return { error: 'redirectUri required (the callback URL of this server)' };
  const state = base64url(crypto.randomBytes(16));
  const q = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: p.scopes,
    state
  });
  q.set(p.clientParam || 'client_id', clientId);
  if (p.duration) q.set('duration', p.duration);
  let codeVerifier = null;
  if (p.pkce) {
    codeVerifier = base64url(crypto.randomBytes(32));
    q.set('code_challenge', base64url(crypto.createHash('sha256').update(codeVerifier).digest()));
    q.set('code_challenge_method', 'S256');
  }
  return { ok: true, provider: p.name, url: p.authorize + '?' + q.toString(), state, codeVerifier, expiresTs: Date.now() + STATE_TTL_MS };
}

/* Build the exact token-exchange request the server will run via guardedFetch
 * — dry, so platform-test asserts the wire format without any call. */
function buildExchange(id, opts) {
  const p = providerOf(id);
  if (!p) return { error: 'Unknown OAuth provider ' + id };
  const code = String(opts.code || '').trim();
  if (!code) return { error: 'authorization code required' };
  const clientId = String(opts.clientId || '').trim();
  const clientSecret = String(opts.clientSecret || '').trim();
  const redirectUri = String(opts.redirectUri || '').trim();
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const headers = { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' };
  if (p.basic || (p.pkce && clientSecret)) {
    headers.authorization = 'Basic ' + Buffer.from(encodeURIComponent(clientId) + ':' + encodeURIComponent(clientSecret)).toString('base64');
  } else {
    form.set(p.clientParam || 'client_id', clientId);
    if (clientSecret) form.set('client_secret', clientSecret);
  }
  if (String(id).toLowerCase() === 'reddit') headers['user-agent'] = 'LIAM-oauth/1.77 (by u/doomed689)';
  if (p.pkce && opts.codeVerifier) form.set('code_verifier', String(opts.codeVerifier));
  return { ok: true, provider: p.name, url: p.tokenUrl, method: 'POST', headers, body: form.toString() };
}

/* Parse the provider's token response — truthful on any shape of failure. */
function parseTokenResponse(id, text) {
  const p = providerOf(id) || { name: id };
  let j; try { j = JSON.parse(text); } catch (e) { return { error: p.name + ' answered with non-JSON (status page or proxy error?)' }; }
  if (j.error) return { error: p.name + ' refused the exchange: ' + (j.error_description || j.error.message || j.error) };
  if (!j.access_token) return { error: p.name + ' answer carried no access_token — nothing stored (never faked)' };
  return { ok: true, accessToken: String(j.access_token), refreshToken: j.refresh_token ? String(j.refresh_token) : null, expiresIn: j.expires_in == null ? null : Number(j.expires_in), scope: j.scope ? String(j.scope) : null };
}

module.exports = { OAUTH_PROVIDERS, OAUTH_IDS, STATE_TTL_MS, providerOf, buildAuthorize, buildExchange, parseTokenResponse };
