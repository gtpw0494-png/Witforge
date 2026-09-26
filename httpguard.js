/* LIAM HTTP & sandbox guard (v1.81.0 — extracted from platform.js).
 */
'use strict';
/* THE single egress point of the platform: every connector, LLM call,
 * OAuth exchange, webhook and tool HTTP request flows through guardedFetch
 * — never a raw fetch anywhere else. The module is configured ONCE by the
 * host (create({ audit, userFiles })); network edges stay injectable for
 * tests (fetchImpl). Rules, copied from the spec sections they enforce:
 *
 *   SSRF      protocol http/https only; private/loopback/link-local/CGNAT
 *             ranges and metadata names (localhost, *.local,
 *             metadata.google.internal) refused; hostnames DNS-resolved
 *             first and re-validated (no rebinding); redirects NEVER
 *             followed (the 3xx status travels back truthfully);
 *             8s timeout; bodies capped (20KB default, opts.maxBytes).
 *   SANDBOX   safePath() confines every file tool to <userFiles> —
 *             traversal outside the sandbox returns null, never an error
 *             that leaks structure (§35), and never a silent read.
 *
 * Zero dependencies. Standard Node only.
 */

const dns = require('dns');
const net = require('net');
const path = require('path');

const HTTP_TIMEOUT_MS = 8000;
const BODY_CAP = 20000;
const USER_AGENT = 'LIAM-guarded-http/1.55';

function publicIP(ip) {
  const v4 = net.isIP(ip) === 4;
  const parts = ip.split('.').map(Number);
  if (v4) {
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
  } else {
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return false;
  }
  return true;
}

function ssrfSafe(hostname) {
  const h = hostname.replace(/[\[\]]/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h === 'metadata.google.internal') return false;
  if (net.isIP(h)) return publicIP(h);
  return null; // needs DNS resolution
}

/* Bind the pure checks plus platform integ points. audit is the platform's
 * signed audit writer; blocks are recorded there, on record, as 'system'. */
function create(cfg) {
  cfg = cfg || {};
  const audit = typeof cfg.audit === 'function' ? cfg.audit : () => {};
  const userFiles = path.resolve(String(cfg.userFiles || './data/userfiles'));
  const fetchImpl = cfg.fetchImpl || fetch;

  async function guardedFetch(url, headers, opts) {
    opts = opts || {};
    let u;
    try { u = new URL(url); } catch (e) { return { ok: false, error: 'Invalid URL' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Only http/https allowed', blocked: 'protocol' };
    const literal = ssrfSafe(u.hostname);
    if (literal === false) { audit('security', 'SSRF BLOCKED ' + u.hostname, 'system'); return { ok: false, error: 'Private/loopback/metadata address blocked', blocked: 'ssrf' }; }
    if (literal === null) {
      let addr;
      try { addr = (await dns.promises.lookup(u.hostname)).address; } catch (e) { return { ok: false, error: 'DNS resolution failed' }; }
      if (!publicIP(addr)) { audit('security', 'SSRF BLOCKED (dns) ' + u.hostname + ' → ' + addr, 'system'); return { ok: false, error: 'Resolved to private address — blocked', blocked: 'ssrf' }; }
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
    try {
      const r = await fetchImpl(u, { signal: ctl.signal, redirect: 'manual', method: opts.method || 'GET', body: opts.body || undefined, headers: Object.assign({ 'user-agent': USER_AGENT }, headers || {}) });
      /* v1.78.0: redirects are still never followed, but they are no longer
       * confused with genuine 4xx/5xx answers — the status travels back so the
       * caller can tell the user the truth (“HTTP 404”, not “HTTP undefined”).
       * opts.maxBytes raises the body cap for connectors whose valid JSON
       * responses exceed it (GitHub Contents listings are tens of KB). */
      if (r.status >= 300 && r.status < 400) return { ok: false, status: r.status, error: 'HTTP ' + r.status + ' redirect (redirects are never followed)' };
      if (r.status >= 400) return { ok: false, status: r.status, error: 'HTTP ' + r.status + ' from ' + u.hostname };
      const text = (await r.text()).slice(0, opts.maxBytes || BODY_CAP);
      return { ok: true, status: r.status, type: r.headers.get('content-type'), bytes: text.length, text };
    } catch (e) {
      return { ok: false, error: 'Request failed: ' + (e.name === 'AbortError' ? 'timeout (' + (HTTP_TIMEOUT_MS / 1000) + 's)' : e.message) };
    } finally { clearTimeout(t); }
  }

  function safePath(p) {
    const resolved = path.normalize(path.join(userFiles, String(p || '')));
    if (resolved !== userFiles && !resolved.startsWith(userFiles + path.sep)) return null;
    return resolved;
  }

  return { guardedFetch, safePath, ssrfSafe, publicIP, USER_AGENT, HTTP_TIMEOUT_MS, BODY_CAP };
}

module.exports = { create, ssrfSafe, publicIP, USER_AGENT, HTTP_TIMEOUT_MS, BODY_CAP };
