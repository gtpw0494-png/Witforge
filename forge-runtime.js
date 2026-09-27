/* ForgeLM/UAI v2 model-runtime abstraction and truthful routing. */
'use strict';
const C = require('./forge-contracts.js');

function normalizeAvailability(a) {
  a = a || {};
  return {
    registered: a.registered === true,
    reachable: a.reachable === true,
    authenticated: a.authenticated !== false,
    compatible: a.compatible === true,
    loaded: a.loaded === true,
    verifiedAt: a.verifiedAt || null,
    errorCode: a.errorCode || null
  };
}
function compatible(model, req) {
  req=req||{};
  const caps=new Set(model.capabilities || []);
  if ((model.contextTokens || 0) < (req.minimumContextTokens || 0)) return false;
  if (req.structuredOutput && !caps.has('structured_output')) return false;
  if (req.toolCalling && !caps.has('tool_proposal')) return false;
  if (req.vision && !caps.has('vision')) return false;
  if (req.audio && !caps.has('audio')) return false;
  if (req.embeddings && !caps.has('embeddings')) return false;
  if (req.localOnly && model.local !== true) return false;
  return C.modelAvailable(normalizeAvailability(model.availability));
}
function route(models, req) {
  const candidates=(models||[]).filter(m => compatible(m, req));
  candidates.sort((a,b) => {
    const aq=Number(a.quality||0), bq=Number(b.quality||0);
    if (bq !== aq) return bq-aq;
    const al=Number(a.latencyMs||Infinity), bl=Number(b.latencyMs||Infinity);
    if (al !== bl) return al-bl;
    return String(a.id).localeCompare(String(b.id));
  });
  return candidates.length ? { ok:true, model:candidates[0], candidates } : { ok:false, error:'MODEL_UNAVAILABLE', candidates:[] };
}
function descriptorFromProvider(p, availability) {
  return {
    id: p.id,
    providerId: p.id,
    local: p.id === 'ollama' || p.id === 'forge-native',
    contextTokens: Number(p.contextTokens || 4096),
    capabilities: Array.isArray(p.capabilities) ? p.capabilities.slice() : ['text_generation'],
    availability: normalizeAvailability(availability),
    quality: Number(p.quality || 0),
    latencyMs: Number(p.latencyMs || Infinity)
  };
}
module.exports = { normalizeAvailability, compatible, route, descriptorFromProvider, MODEL_PROFILES:C.MODEL_PROFILES };
