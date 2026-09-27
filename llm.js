/* LIAM — multi-provider LLM chat layer (v1.67).
 *
 * Truth rules:
 *  - a provider without a stored credential reports UNAVAILABLE with the
 *    exact connect command — it is never faked;
 *  - a reply is always labelled with the provider and model that produced
 *    it — the rule engine and the AI brain are never confused;
 *  - keys travel in headers (never in URLs) and are masked in audit;
 *  - Ollama is the only local provider and the only one allowed to talk to
 *    loopback — validated here, never through the general HTTP tools.
 *
 * Zero dependencies. Standard Node only. The network edge is injected
 * (deps.remoteFetch / deps.localFetch) so tests exercise everything dry.
 */
'use strict';

/* Local Ollama port. Pinned to 11434 in normal operation; the env override
 * exists so the test suite can bind its scripted fake on another loopback
 * port without weakening validation (loopback-only either way). */
const OLLAMA_PORT = Number(process.env.LIAM_OLLAMA_PORT) || 11434;
const FORGE_NATIVE_PORT = Number(process.env.WITFORGE_FORGELM_PORT) || 11435;

const PROVIDERS = [
  {
    id: 'groq', name: 'Groq (free tier)', shape: 'openai', requiresKey: true,
    keyHint: 'provider dashboard', endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    free: 'free forever, no card — about 30 req/min, 14,400 req/day',
    connect: 'connect groq with token <your-free-key>'
  },
  {
    id: 'nvidia-nim', name: 'NVIDIA NIM (free developer credits)', shape: 'openai', requiresKey: true,
    keyHint: 'NVIDIA build console (build.nvidia.com)', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    defaultModel: 'meta/llama-3.1-8b-instruct',
    free: 'free developer key with starter credits — about 40 req/min (advisory)',
    connect: 'connect nvidia-nim with token <your-nvapi-key>'
  },
  {
    id: 'together-ai', name: 'Together AI (free starter tier)', shape: 'openai', requiresKey: true,
    keyHint: 'Together AI console', endpoint: 'https://api.together.xyz/v1/chat/completions',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    free: 'free key with starter credit — open-model endpoints; current model names live in the Together console',
    connect: 'connect together-ai with token <your-key>'
  },
  {
    id: 'gemini', name: 'Google AI Studio (Gemini, free tier)', shape: 'gemini', requiresKey: true,
    keyHint: 'Google AI Studio', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    /* v1.76.1: default repaired — gemini-2.0-flash was retired upstream, and
     * even 2.5-flash now answers new keys with 404 “no longer available to new
     * users, use gemini-3.6-flash”. 3.6-flash is Google's current default tier. */
    defaultModel: 'gemini-3.6-flash',
    free: 'free key, no card — rate-limited per model (roughly 15 req/min)',
    connect: 'connect gemini with token <your-free-key>'
  },
  {
    id: 'openrouter', name: 'OpenRouter (aggregator, free + paid models)', shape: 'openai', requiresKey: true,
    keyHint: 'openrouter.ai/keys', endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    /* v1.73.1: default repaired — the old meta-llama/llama-3.3-70b-instruct:free
     * slug was retired upstream (OpenRouter 404 "unavailable for free").
     * gpt-4o is paid per token; ask for a ":free"-tagged model to spend nothing. */
    defaultModel: 'openai/gpt-4o',
    free: 'free key; models tagged ":free" cost nothing, paid models (default gpt-4o) bill per token',
    connect: 'connect openrouter with token <your-key>'
  },
  {
    id: 'deepseek', name: 'DeepSeek (free credit on signup)', shape: 'openai', requiresKey: true,
    keyHint: 'platform.deepseek.com', endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    free: 'free token grant on signup, then pay-as-you-go',
    connect: 'connect deepseek with token <your-key>'
  },
  {
    id: 'mistral', name: 'Mistral (free tier)', shape: 'openai', requiresKey: true,
    keyHint: '…', endpoint: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-small-latest',
    free: 'free tier on the "experiment" plan',
    connect: 'connect mistral with token <your-key>'
  },
  {
    id: 'forge-native', name: 'ForgeLM Native (WitForge local model)', shape: 'forge-native', requiresKey: false,
    keyHint: null, endpoint: 'http://127.0.0.1:' + FORGE_NATIVE_PORT,
    defaultModel: 'forgelm-nano',
    free: 'fully local ForgeLM checkpoint served by WitForge; no key and no cloud',
    connect: 'start "python -m model.forgelm.server --checkpoint state/models/forgelm-nano", then "verify forge-native"',
    local: true,
    capabilities: ['text_generation'],
    contextTokens: 2048
  },
  {
    id: 'ollama', name: 'Ollama (your machine, open-source models)', shape: 'ollama', requiresKey: false,
    keyHint: null, endpoint: 'http://127.0.0.1:' + OLLAMA_PORT,
    defaultModel: 'llama3.2',
    free: 'fully local and free — you own the model; nothing leaves the machine',
    connect: 'install Ollama and "ollama pull llama3.2" — no key needed'
  }
];
const PROVIDER_IDS = PROVIDERS.map(p => p.id);
/* Deterministic default order: cloud free tiers first, local last. */
const DEFAULT_ORDER = ['groq', 'gemini', 'openrouter', 'nvidia-nim', 'together-ai', 'deepseek', 'mistral', 'ollama', 'forge-native'];

/* v2.02 advisory free-tier rate baselines (public console documentation,
 * shifts upstream — advisory labels, the enforcement below is recorded truth,
 * not a promise): RPM requests/min, TPD requests/day where published. */
const RATE_RPM = { groq: 30, gemini: 15, openrouter: 8, 'nvidia-nim': 40, 'together-ai': 60, deepseek: 60, mistral: 6, ollama: 60, 'forge-native': 60 };
const RATE_TPD = { groq: 14400, openrouter: 50, 'nvidia-nim': 5000, 'together-ai': 500 };

const SYSTEM_PROMPT =
  'You are LIAM\u2019s assistant inside WitForge, a local-first platform whose rule-based ' +
  'command router executes real actions (forge/marketplace/LD economy, tasks, playbooks, ' +
  'approvals, devices, connectors). Truth rules: never claim you performed an action — ' +
  'suggest the closest chat command and say the user must run it; never invent features; ' +
  'be concise and practical. High-risk actions are approval-gated and that is by design. ' +
  'When the user asks for something a WitForge command could do, you may end your reply with a final ' +
  'line "SUGGEST: <exact chat command>" — the platform shows it as a proposal the user must explicitly run. ' +
  /* v1.78: ground the model in the real command forms so every SUGGEST parses
   * in the audited router — proposals with invented syntax were failing. */
  'Use ONLY these exact command forms in SUGGEST lines, nothing else: ' +
  '"help" · "briefing" · "weather <city>" · "tasks" · "create task <text>" · "plans" · "ld packages" · ' +
  '"open lotto round" · "buy a lotto ticket" · "connections" · "verify <service>" · "github list" · ' +
  '"github read <file>" · "ask about <url>" · "local models" · "protect me" · "update check" · ' +
  '"ask all <question>" · "ask consensus <question>".';

function providerById(id) { return PROVIDERS.find(p => p.id === id) || null; }


/* Build the exact request a provider would receive — exported and used dry
 * by the tests, so the wire format is checked without any network call. */
function dryRun(providerId, args) {
  args = args || {};
  const p = providerById(args.provider || providerId);
  if (!p) return { error: 'Unknown provider ' + (args.provider || providerId) };
  const model = String(args.model || p.defaultModel).slice(0, 80);
  const maxTokens = Math.min(2000, Math.max(16, Number(args.maxTokens) || 400));
  const temperature = Math.min(2, Math.max(0, Number(args.temperature) == null ? 0.4 : Number(args.temperature)));
  const msgs = normaliseMessages(args);
  if (msgs.error) return { error: msgs.error };
  /* v1.90: callers with a real plan (the agentic brain) may carry their own
   * system brief; the default persona stays the floor for everyone else. */
  const systemPrompt = String(args.system ? args.system.slice(0, 6000) : SYSTEM_PROMPT);
  if (p.shape === 'openai') {
    return {
      provider: p.id, url: p.endpoint, method: 'POST',
      headers: { authorization: 'Bearer <redacted-key>', 'content-type': 'application/json' },
      body: { model, messages: [{ role: 'system', content: systemPrompt }].concat(msgs.messages), max_tokens: maxTokens, temperature }
    };
  }
  if (p.shape === 'gemini') {
    /* v1.76.1: model travels top-level too — the wire body has no model field
     * on this shape, which left every Gemini reply labelled “gemini · undefined”. */
    return {
      provider: p.id, model, url: p.endpoint + '/' + encodeURIComponent(model) + ':generateContent', method: 'POST',
      headers: { 'x-goog-api-key': '<redacted-key>', 'content-type': 'application/json' },
      body: {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: msgs.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, temperature }
      }
    };
  }
  if (p.shape === 'forge-native') {
    return {
      provider: p.id, model, url: p.endpoint + '/v1/chat/completions', method: 'POST', local: true,
      headers: { 'content-type': 'application/json' },
      body: {
        model,
        messages: [{ role: 'system', content: systemPrompt }].concat(msgs.messages),
        max_tokens: maxTokens,
        temperature,
        top_p: 0.95,
        stream: false
      }
    };
  }
  return {
    provider: p.id, url: p.endpoint + '/api/chat', method: 'POST', local: true,
    headers: { 'content-type': 'application/json' },
    body: { model, messages: [{ role: 'system', content: systemPrompt }].concat(msgs.messages), stream: false }
  };
}

function normaliseMessages(args) {
  if (Array.isArray(args.messages) && args.messages.length) {
    const clean = args.messages.slice(-12).map(m => ({
      role: ['user', 'assistant'].includes(String(m.role)) ? String(m.role) : 'user',
      content: String(m.content || '').slice(0, 6000)
    })).filter(m => m.content);
    if (!clean.length) return { error: 'messages array carried no usable content' };
    if (clean[clean.length - 1].role !== 'user') return { error: 'the last message must be from the user' };
    return { messages: clean };
  }
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return { error: 'prompt (or messages) required' };
  return { messages: [{ role: 'user', content: prompt.slice(0, 6000) }] };
}

/* Parse one provider reply into { content, usage } — throws on empties so
 * the caller can report failure truthfully. */
function parseReply(shape, payload) {
  if (shape === 'gemini') {
    const cand = payload && payload.candidates && payload.candidates[0];
    const parts = cand && cand.content && cand.content.parts || [];
    const content = parts.map(x => x.text || '').join('').trim();
    if (!content) throw new Error('Gemini returned no content' + (payload && payload.promptFeedback && payload.promptFeedback.blockReason ? ' (blocked: ' + payload.promptFeedback.blockReason + ')' : ''));
    return { content: content.slice(0, 8000), usage: payload.usageMetadata || null };
  }
  if (shape === 'ollama') {
    const content = payload && payload.message && String(payload.message.content || '').trim();
    if (!content) throw new Error('Ollama returned no content');
    return { content: content.slice(0, 8000), usage: payload.eval_count != null ? { eval_count: payload.eval_count } : null };
  }
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && String(payload.choices[0].message.content || '').trim();
  if (!content) throw new Error('Provider returned no content' + (payload && payload.error && payload.error.message ? ': ' + payload.error.message : ''));
  return { content: content.slice(0, 8000), usage: (payload.usage) || null };
}

/* Ollama is the ONLY local provider. This validator deliberately accepts
 * nothing but loopback on the Ollama port — it is not a general SSRF hole. */
function validateLocalUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return { error: 'Invalid URL' }; }
  if (u.protocol !== 'http:') return { error: 'Local model endpoint must be http on loopback' };
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) return { error: 'Local model endpoint must be 127.0.0.1/localhost' };
  const port = u.port;
  if (port === String(OLLAMA_PORT)) {
    if (!/^\/api\/(?:chat|tags|pull|delete)$/.test(u.pathname)) return { error: 'Ollama path is not allowlisted' };
    return { ok: true, url: u, provider: 'ollama' };
  }
  if (port === String(FORGE_NATIVE_PORT)) {
    if (!['/health', '/v1/models', '/v1/chat/completions'].includes(u.pathname)) return { error: 'ForgeNative path is not allowlisted' };
    return { ok: true, url: u, provider: 'forge-native' };
  }
  return { error: 'Only configured local-model ports ' + OLLAMA_PORT + ' and ' + FORGE_NATIVE_PORT + ' are allowed' };
}

async function chat(providerId, args, deps) {
  deps = deps || {};
  const remoteFetch = deps.remoteFetch;
  const localFetch = deps.localFetch;
  const started = Date.now();
  const req = dryRun(providerId, args);
  if (req.error) return { ok: false, error: req.error };
  const p = providerById(req.provider);
  /* v1.68: local models — if the requested model isn't installed, answer
   * with the first one that is (named in the response), never a fake. */
  if (p.shape === 'ollama' && deps.localFetch) {
    const installed = await ollamaModels({ localFetch: deps.localFetch });
    if (installed && installed.length) {
      const want = String(req.body.model);
      if (!installed.includes(want) && !installed.includes(want + ':latest')) req.body.model = installed[0];
    }
  }
  let res;
  if (p.shape === 'ollama') {
    if (!localFetch) return { ok: false, error: 'Local fetch unavailable in this runtime' };
    res = await localFetch(req.url, req.headers, { method: 'POST', body: JSON.stringify(req.body), timeoutMs: 120000 });
  } else {
    if (!remoteFetch) return { ok: false, error: 'Remote fetch unavailable in this runtime' };
    const headers = Object.assign({}, req.headers);
    if (p.shape === 'gemini') headers['x-goog-api-key'] = deps.apiKey;
    else headers.authorization = 'Bearer ' + deps.apiKey;
    res = await remoteFetch(req.url, headers, { method: 'POST', body: JSON.stringify(req.body), timeoutMs: 30000 });
  }
  const latencyMs = Date.now() - started;
  if (!res.ok) return { ok: false, provider: p.id, model: req.model || req.body.model, latencyMs, error: (res.text || res.error || 'request failed').slice(0, 300) };
  let payload;
  try { payload = JSON.parse(res.text); } catch (e) { return { ok: false, provider: p.id, model: req.model || req.body.model, latencyMs, error: 'Non-JSON response from provider' }; }
  try {
    const out = parseReply(p.shape, payload);
    return Object.assign({ ok: true, provider: p.id, model: req.model || req.body.model, latencyMs }, out);
  } catch (e) {
    return { ok: false, provider: p.id, model: req.model || req.body.model, latencyMs, error: e.message };
  }
}

/* GET {model list} from a local Ollama — used by llm.status, dry unless a
 * live localFetch is wired. */
async function ollamaModels(deps) {
  if (!deps || !deps.localFetch) return null;
  const res = await deps.localFetch('http://127.0.0.1:' + OLLAMA_PORT + '/api/tags', {}, { method: 'GET', timeoutMs: 3000 });
  if (!res.ok) return null;
  try { const j = JSON.parse(res.text); return (j.models || []).map(m => m.name); } catch (e) { return null; }
}

async function forgeNativeStatus(deps) {
  if (!deps || !deps.localFetch) return null;
  const res = await deps.localFetch('http://127.0.0.1:' + FORGE_NATIVE_PORT + '/health', {}, { method: 'GET', timeoutMs: 3000 });
  if (!res.ok) return null;
  try {
    const j = JSON.parse(res.text);
    return j && j.ok === true && j.loaded === true ? j : null;
  } catch (e) { return null; }
}

/* v1.68: fan one question out to several providers at once ("ask all").
 * deps.apiKey may be a function of provider id so each cloud provider is
 * keyed with its own credential. One provider failing never sinks the
 * rest — answers and failures come back separately, both labelled. */
async function ensemble(providerIds, args, deps) {
  const ids = (providerIds || []).filter(id => providerById(id));
  const results = await Promise.allSettled(ids.map(id => chat(id, args, deps)));
  const answers = [], failures = [];
  results.forEach((r, i) => {
    const id = ids[i];
    if (r.status === 'fulfilled' && r.value.ok) answers.push(r.value);
    else failures.push({ provider: id, error: String(r.status === 'fulfilled' ? (r.value.error || 'failed') : ((r.value && r.value.message) || 'threw')).slice(0, 200) });
  });
  return { answers, failures };
}

module.exports = {
  RATE_RPM, RATE_TPD, PROVIDERS, PROVIDER_IDS, DEFAULT_ORDER, SYSTEM_PROMPT, providerById, dryRun, parseReply, validateLocalUrl, chat, ollamaModels, forgeNativeStatus, ensemble,
  OLLAMA_PORT: () => OLLAMA_PORT, FORGE_NATIVE_PORT: () => FORGE_NATIVE_PORT };
