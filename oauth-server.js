/* LIAM OAuth server glue (v1.82.0 — extracted from platform.js). */
'use strict';
/* The official sign-in journey, run against oauth.js's pure wire builders:
 * register a developer app (client id + AES-256-GCM secret), build the
 * authorize URL, then exchange the code on the platform's own callback.
 * The module owns NO state — the host platform injects every touchpoint,
 * so the module stays fully dry-testable:
 *   getState()                  live state (oauthApps / oauthPending /
 *                               creds / social.verified)
 *   save / audit                platform persistence + signed audit record
 *   encryptToken(service, plain) vault encryption
 *   decryptRec(rec)              vault decryption (host keeps the key chain)
 *   setCredential(id, token)     write account token into the creds store
 *   guardedFetch(url, hdrs, o)   the single egress point (httpguard.js)
 *
 * Truth rules (unchanged from oauth.js): SETUP REQUIRED is honest, states
 * are single-use 10-minute, tokens stay write-only — and the journey's
 * status is a stage machine, never a flat “unverified” (v1.80).
 */
const oauth = require('./oauth.js');

function create(deps) {
  deps = deps || {};
  const S = () => deps.getState ? (deps.getState() || {}) : (deps.state || {});
  const save = typeof deps.save === 'function' ? deps.save : () => {};
  const audit = typeof deps.audit === 'function' ? deps.audit : () => {};
  const encryptToken = deps.encryptToken;
  const decryptRec = deps.decryptRec || (() => null);
  const setCredential = deps.setCredential;
  const guardedFetch = deps.guardedFetch || (async () => ({ ok: false, error: 'guardedFetch not injected' }));

  function oauthSetApp(id, clientId, clientSecret) {
    const pid = String(id || '').toLowerCase().slice(0, 20);
    const prov = oauth.providerOf(pid);
    /* validate semantics before capabilities: an unknown provider is refused
     * regardless of wiring state (this is what makes the module dry-testable
     * without any injected vault). */
    if (!prov) return { ok: false, error: 'Unknown OAuth provider “' + pid + '”. Supported: ' + oauth.OAUTH_IDS.join(', ') };
    if (!encryptToken) return { ok: false, error: 'vault not wired (encryptToken not injected)' };
    clientId = String(clientId || '').trim().slice(0, 160);
    if (!clientId) return { ok: false, error: 'client id required — register the app first (' + prov.portal + ')' };
    S().oauthApps[pid] = { clientId, clientSecret: clientSecret ? encryptToken('oauth:' + pid, String(clientSecret).trim().slice(0, 256)) : null, updatedTs: Date.now() };
    audit('security', 'OAUTH APP REGISTERED for ' + pid + ' (client id stored; secret ' + (clientSecret ? 'AES-256-GCM at rest' : 'none — public client') + ')', 'user');
    save();
    return { ok: true, provider: pid, name: prov.name };
  }
  function oauthForgetApp(id) {
    const pid = String(id || '').toLowerCase();
    if (!S().oauthApps[pid]) return { ok: false, error: 'No OAuth app registered for ' + pid };
    delete S().oauthApps[pid];
    audit('security', 'OAUTH APP REMOVED for ' + pid, 'user'); save();
    return { ok: true };
  }
  function oauthAppSecret(pid) { const a = S().oauthApps[pid]; return a && a.clientSecret ? decryptRec(a.clientSecret) : null; }
  function oauthStatusList() {
    const st = S();
    const apps = st.oauthApps || {}, creds = st.creds || {}, verifiedMap = (st.social && st.social.verified) || {};
    return oauth.OAUTH_IDS.map(id => {
      const p = oauth.providerOf(id);
      const configured = !!apps[id];
      const hasToken = !!creds[id];
      const verified = !!verifiedMap[id];
      const stage = !configured ? 'setup-required'
        : !hasToken ? 'registered-not-authorised'
        : !verified ? 'authorised-not-connected'
        : 'connected-verified';
      return {
        id, name: p.name, portal: p.portal,
        configured, hasSecret: !!(apps[id] && apps[id].clientSecret),
        hasToken, authorised: hasToken, verified, connected: verified,
        verifiedTs: verified ? verifiedMap[id].ts : null,
        stage
      };
    });
  }
  function oauthStart(id, redirectUri) {
    const pid = String(id || '').toLowerCase();
    const st = S();
    const app = (st.oauthApps || {})[pid];
    const r = oauth.buildAuthorize(pid, { clientId: app && app.clientId, redirectUri });
    if (r.error) return r;
    st.oauthPending = st.oauthPending || {};
    for (const k of Object.keys(st.oauthPending)) { if ((st.oauthPending[k].expiresTs || 0) < Date.now()) delete st.oauthPending[k]; }
    st.oauthPending[r.state] = { id: pid, verifier: r.codeVerifier || null, redirectUri, expiresTs: r.expiresTs };
    save();
    audit('security', 'OAUTH SIGN-IN STARTED for ' + pid + ' (state single-use, 10-minute TTL)', 'user');
    return { ok: true, provider: r.provider, url: r.url, state: r.state };
  }
  async function oauthExchange(id, args) {
    if (!setCredential) return { ok: false, error: 'credential store not wired (setCredential not injected)' };
    const pid = String(id || '').toLowerCase();
    const prov = oauth.providerOf(pid);
    if (!prov) return { ok: false, error: 'Unknown OAuth provider ' + pid };
    const st = S();
    const app = (st.oauthApps || {})[pid];
    if (!app) return { ok: false, error: prov.name + ' SETUP REQUIRED — register your developer app first (' + prov.portal + ').' };
    args = args || {};
    st.oauthPending = st.oauthPending || {};
    let pend = null;
    if (args.state) {
      pend = st.oauthPending[args.state];
      if (!pend) return { ok: false, error: 'Unknown or expired sign-in state — start the sign-in again (states are single-use, 10 minutes)', truthful: true };
      if (pend.id !== pid || (pend.expiresTs || 0) < Date.now()) { delete st.oauthPending[args.state]; save(); return { ok: false, error: 'Sign-in state expired or mismatched — start again (never silently widened)', truthful: true }; }
      delete st.oauthPending[args.state];   /* consumed — single-use, whatever happens next */
    }
    const req = oauth.buildExchange(pid, { code: args.code, redirectUri: args.redirectUri || (pend && pend.redirectUri), clientId: app.clientId, clientSecret: oauthAppSecret(pid), codeVerifier: pend && pend.verifier });
    if (req.error) return { ok: false, error: req.error };
    const res = await guardedFetch(req.url, req.headers, { method: 'POST', body: req.body, maxBytes: 60000 });
    if (!res.ok) return { ok: false, error: prov.name + ' token exchange failed — ' + (res.error || ('HTTP ' + res.status)), truthful: true };
    const parsed = oauth.parseTokenResponse(pid, res.text);
    if (parsed.error) return { ok: false, error: parsed.error };
    setCredential(pid, parsed.accessToken);
    audit('security', 'OAUTH SIGN-IN COMPLETED for ' + pid + ' — account token stored (scope: ' + (parsed.scope || 'default') + ')', 'system', { result: 'SUCCEEDED' });
    save();
    return { ok: true, provider: pid, name: prov.name, scope: parsed.scope, note: 'Account token stored encrypted. Say “verify ' + pid + '” to prove it with a real API call.' };
  }

  return { oauthSetApp, oauthForgetApp, oauthAppSecret, oauthStatusList, oauthStart, oauthExchange };
}

module.exports = { create };
