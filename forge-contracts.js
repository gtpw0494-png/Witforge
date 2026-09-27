/* WitForge ForgeLM/UAI v2 contracts — zero dependency, immutable enums.
 * The model proposes; governance authorizes; execution and verification remain separate.
 */
'use strict';

const TRUST_CLASSES = Object.freeze([
  'UAI_ROOT','PLATFORM','DEVELOPER','USER_INSTRUCTION','USER_DATA',
  'MEMORY','RETRIEVAL','TOOL_RESULT','MODEL_OUTPUT'
]);

const AUTHORITIES = Object.freeze([
  'CONTROL','INSTRUCTION','INFORMATION','UNTRUSTED_INFORMATION'
]);

const POLICY_DECISIONS = Object.freeze(['ALLOW','DENY','ASK','ESCALATE','BLOCK']);

const ACTION_STATES = Object.freeze([
  'PROPOSED','VALIDATED','POLICY_EVALUATED','APPROVAL_PENDING','AUTHORIZED',
  'EXECUTING','EXECUTED','VERIFYING','VERIFIED','PARTIAL','FAILED',
  'RECOVERY_PENDING','RECOVERING','RECOVERED','CLOSED'
]);

const TASK_STATES = Object.freeze([
  'NEW','UNDERSTANDING','PLANNING','WAITING_APPROVAL','AUTHORIZED','EXECUTING',
  'VERIFYING','CORRECTING','CONTINUING','RECOVERING','COMPLETED',
  'FAILED','CANCELLED','DENIED','BLOCKED','TIMEOUT','UNKNOWN'
]);

const MEMORY_TYPES = Object.freeze([
  'EPISODIC','SEMANTIC','PROCEDURAL','PROJECT','RELATIONSHIP','CAPABILITY','EVIDENCE'
]);

const MEMORY_STATUS = Object.freeze(['ACTIVE','SUPERSEDED','DISPUTED','EXPIRED','DELETED']);

const PRIVACY_CLASSES = Object.freeze(['PUBLIC','INTERNAL','PERSONAL','SENSITIVE','SECRET']);

const MODEL_PROFILES = Object.freeze({
  'forgelm-nano': Object.freeze({
    id: 'forgelm-nano', vocabSize: 32768, contextLength: 2048,
    hiddenSize: 384, layers: 8, queryHeads: 6, kvHeads: 2,
    headDimension: 64, intermediateSize: 1024,
    attention: 'gqa', positionEncoding: 'rope', normalization: 'rmsnorm',
    activation: 'swiglu', ropeTheta: 10000, rmsNormEpsilon: 1e-5,
    tieEmbeddings: true, attentionBias: false, mlpBias: false, dropout: 0
  }),
  'forgelm-micro': Object.freeze({
    id: 'forgelm-micro', vocabSize: 32768, contextLength: 4096,
    hiddenSize: 512, layers: 12, queryHeads: 8, kvHeads: 4,
    headDimension: 64, intermediateSize: 1376,
    attention: 'gqa', positionEncoding: 'rope', normalization: 'rmsnorm',
    activation: 'swiglu', ropeTheta: 10000, rmsNormEpsilon: 1e-5,
    tieEmbeddings: true, attentionBias: false, mlpBias: false, dropout: 0
  })
});

function validateProfile(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'profile required' };
  if (!Number.isInteger(p.hiddenSize) || !Number.isInteger(p.queryHeads) || p.hiddenSize % p.queryHeads !== 0) {
    return { ok: false, error: 'hiddenSize must be divisible by queryHeads' };
  }
  if (!Number.isInteger(p.kvHeads) || p.queryHeads % p.kvHeads !== 0) {
    return { ok: false, error: 'queryHeads must be divisible by kvHeads' };
  }
  if ((p.hiddenSize / p.queryHeads) !== p.headDimension) {
    return { ok: false, error: 'headDimension must equal hiddenSize/queryHeads' };
  }
  return { ok: true };
}

function modelAvailable(a) {
  if (!a || typeof a !== 'object') return false;
  return !!(a.registered && a.reachable && a.compatible && (a.authenticated !== false));
}

module.exports = {
  TRUST_CLASSES, AUTHORITIES, POLICY_DECISIONS, ACTION_STATES, TASK_STATES,
  MEMORY_TYPES, MEMORY_STATUS, PRIVACY_CLASSES, MODEL_PROFILES,
  validateProfile, modelAvailable
};
