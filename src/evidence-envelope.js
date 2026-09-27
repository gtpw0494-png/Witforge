import crypto from "node:crypto";

export const SUPPORT_STATES=Object.freeze(["SUPPORTED","PARTIALLY_SUPPORTED","CONFLICTING","STALE","INFERENCE","OPINION","UNSUPPORTED"]);
const clean=x=>String(x??"").trim();
const clamp=x=>Number.isFinite(x)?Math.max(0,Math.min(1,Number(x))):null;
const canonical=v=>Array.isArray(v)?"["+v.map(canonical).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);

export function normalizeSupport(s={}){
  return {
    source_id:s.source_id||s.sourceId||null,
    document_id:s.document_id||s.documentId||null,
    document_revision:s.document_revision??s.revision??null,
    chunk_id:s.chunk_id||s.chunkId||null,
    uri:s.uri||null,
    quote:s.quote?clean(s.quote).slice(0,1200):null,
    score:Number.isFinite(Number(s.score))?Number(s.score):null,
    freshness:s.freshness||null,
    provenance:s.provenance&&typeof s.provenance==="object"?s.provenance:{}
  };
}
export function normalizeClaim(c={}){
  const status=SUPPORT_STATES.includes(c.status)?c.status:"UNSUPPORTED";
  return {
    claim:clean(c.claim),
    support:Array.isArray(c.support)?c.support.map(normalizeSupport):[],
    status,
    confidence:clamp(c.confidence),
    contradictions:Array.isArray(c.contradictions)?c.contradictions.map(x=>clean(x)).filter(Boolean):[]
  };
}
export function evidenceDigest(value={}){
  const cleanValue={...value};delete cleanValue.integrity;
  return crypto.createHash("sha256").update(canonical(cleanValue)).digest("hex");
}
export function verifyEvidenceEnvelope(value={}){
  const digest=value?.integrity?.digest;
  if(!digest)return {state:"UNAVAILABLE",verified:false,reason:"Evidence envelope has no integrity digest."};
  const actual=evidenceDigest(value),verified=digest===actual;
  return {state:verified?"SUCCESS":"DENIED",verified,digest,actual};
}
export class EvidenceEnvelope{
  constructor({responseId=null,answer="",model=null,promptVersion="onechat-v1",retrievalRun=null,claims=[],toolCalls=[],freshness=null,metadata={}}={}){
    this.schema_version="uai.evidence.v1";
    this.id="evidence-"+crypto.randomUUID();
    this.response_id=responseId||null;
    this.answer=String(answer||"");
    this.model=model&&typeof model==="object"?model:null;
    this.prompt_version=promptVersion;
    this.retrieval_run=retrievalRun||null;
    this.claims=(claims||[]).map(normalizeClaim);
    this.tool_calls=Array.isArray(toolCalls)?toolCalls:[];
    this.freshness=freshness||null;
    this.metadata=metadata&&typeof metadata==="object"?metadata:{};
    this.created_at=new Date().toISOString();
    this.integrity={algorithm:"sha256",digest:evidenceDigest(this)};
  }
  summary(){
    const support=Object.fromEntries(SUPPORT_STATES.map(x=>[x,0]));
    for(const c of this.claims)support[c.status]=(support[c.status]||0)+1;
    return {id:this.id,response_id:this.response_id,claims:this.claims.length,support,model:this.model,retrieval_run:this.retrieval_run,created_at:this.created_at,integrity:this.integrity};
  }
  verify(){return verifyEvidenceEnvelope(this);}
}
