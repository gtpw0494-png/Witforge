import crypto from "node:crypto";

function recordId(fact){
  return fact.fact_id||crypto.createHash("sha256").update([fact.subject,fact.claim,fact.source_id,fact.source_url].join("|")).digest("hex");
}
function rowFor(fact){
  return {
    cloud_record_id:recordId(fact),
    subject:String(fact.subject||""),
    claim:String(fact.claim||""),
    source_id:String(fact.source_id||""),
    source_url:String(fact.source_url||""),
    claim_hash:fact.claim_hash||null,
    corroboration:Number(fact.corroboration||0),
    supporting_sources:Array.isArray(fact.supporting_sources)?fact.supporting_sources:[],
    verification:fact.verification&&typeof fact.verification==="object"?fact.verification:{},
    training_eligible:fact.training_eligible===true,
    metadata:fact.metadata&&typeof fact.metadata==="object"?fact.metadata:{},
    observed_at:fact.observed_at||null,
    content_hash:fact.content_hash||null,
    source_trust:Number(fact.source_trust||0),
    stored_at:fact.stored_at||new Date().toISOString()
  };
}

export class CloudKnowledgeStore {
  constructor({endpoint=process.env.IUV_KNOWLEDGE_CLOUD_URL||"",apiKey=process.env.IUV_KNOWLEDGE_CLOUD_KEY||"",table=process.env.IUV_KNOWLEDGE_CLOUD_TABLE||"uai_verified_knowledge",fetchImpl=globalThis.fetch}={}) {
    this.endpoint=String(endpoint||"").replace(/\/$/,"");this.apiKey=String(apiKey||"");this.table=String(table||"uai_verified_knowledge");this.fetch=fetchImpl;
  }
  status(){return{state:this.endpoint&&this.apiKey?"CONFIGURED":"UNAVAILABLE",configured:Boolean(this.endpoint&&this.apiKey),provider:"postgres-rest-compatible",table:this.table,required:["IUV_KNOWLEDGE_CLOUD_URL","IUV_KNOWLEDGE_CLOUD_KEY"],truth:"CONFIGURED does not mean CONNECTED. SUCCESS is returned only after a live provider request succeeds."}}
  headers(extra={}){return{"content-type":"application/json","apikey":this.apiKey,"authorization":`Bearer ${this.apiKey}`,...extra}}
  async putMany(facts=[]){
    if(!this.status().configured)return{state:"UNAVAILABLE",written:0,message:"Cloud knowledge store is not configured."};
    const rows=facts.filter(x=>x?.verification?.verified===true&&x?.verification?.training_rights_verified===true&&x?.training_eligible===true).map(rowFor);
    if(!rows.length)return{state:"SUCCESS",written:0};
    try{
      const r=await this.fetch(`${this.endpoint}/rest/v1/${encodeURIComponent(this.table)}?on_conflict=cloud_record_id`,{method:"POST",headers:this.headers({prefer:"resolution=merge-duplicates,return=minimal"}),body:JSON.stringify(rows)});
      return r.ok?{state:"SUCCESS",connected:true,written:rows.length,httpStatus:r.status}:{state:"FAILURE",connected:false,written:0,httpStatus:r.status,message:"Cloud write rejected."};
    }catch(e){return{state:"UNAVAILABLE",connected:false,written:0,message:String(e?.message||e)}}
  }
  async list(limit=100){
    if(!this.status().configured)return{state:"UNAVAILABLE",records:[],message:"Cloud knowledge store is not configured."};
    const n=Math.max(1,Math.min(1000,Number(limit)||100));
    try{
      const r=await this.fetch(`${this.endpoint}/rest/v1/${encodeURIComponent(this.table)}?select=*&training_eligible=eq.true&order=stored_at.desc&limit=${n}`,{headers:this.headers()});
      if(!r.ok)return{state:"FAILURE",connected:false,records:[],httpStatus:r.status};
      const rows=await r.json();
      return{state:"SUCCESS",connected:true,records:Array.isArray(rows)?rows:[],httpStatus:r.status};
    }catch(e){return{state:"UNAVAILABLE",connected:false,records:[],message:String(e?.message||e)}}
  }
}
export default CloudKnowledgeStore;
