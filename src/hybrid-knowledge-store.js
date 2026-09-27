export class HybridKnowledgeStore {
  constructor({local,cloud=null,audit=null}={}){this.local=local;this.cloud=cloud;this.audit=audit}
  filterTrainingEligible(limit=100){return this.local.filterTrainingEligible(limit)}
  snapshot(){return{state:"SUCCESS",local:this.local.snapshot(),cloud:this.cloud?.status?.()||{state:"UNAVAILABLE",configured:false}}}
  async upsertMany(facts=[]){
    const local=this.local.upsertMany(facts);
    const accepted=(Array.isArray(facts)?facts:[]).filter(x=>x?.training_eligible===true&&x?.verification?.verified===true&&x?.verification?.training_rights_verified===true);
    const cloud=this.cloud?await this.cloud.putMany(accepted):{state:"UNAVAILABLE",written:0};
    this.audit?.append?.({type:"knowledge.persist",local_written:local.written,cloud_state:cloud.state,cloud_written:cloud.written||0});
    return{state:local.state,local,cloud,durability:cloud.state==="SUCCESS"?"LOCAL_AND_CLOUD":"LOCAL_ONLY"};
  }
  async syncCloud({limit=500}={}){
    if(!this.cloud||typeof this.cloud.putMany!=="function")return{state:"UNAVAILABLE",attempted:0,written:0,message:"Cloud knowledge adapter is unavailable."};
    const facts=this.local.filterTrainingEligible(Math.max(1,Math.min(10000,Number(limit)||500)));
    if(!facts.length)return{state:"SUCCESS",attempted:0,written:0,message:"No locally verified knowledge requires reconciliation."};
    const cloud=await this.cloud.putMany(facts);
    const out={state:cloud.state,attempted:facts.length,written:cloud.written||0,cloud};
    this.audit?.append?.({type:"knowledge.cloud.sync",state:out.state,attempted:out.attempted,written:out.written});
    return out;
  }

  async recoverFromCloud({verifier,limit=1000}={}){
    if(!this.cloud||typeof this.cloud.list!=="function")return{state:"UNAVAILABLE",recovered:0,message:"Cloud knowledge adapter is unavailable."};
    if(!verifier||typeof verifier.verifyFacts!=="function")return{state:"BLOCKED",recovered:0,message:"A local verifier is required before cloud recovery."};
    const remote=await this.cloud.list(limit);
    if(remote.state!=="SUCCESS")return{...remote,recovered:0};
    const candidates=[];
    for(const row of remote.records||[]){
      for(const source of Array.isArray(row.supporting_sources)?row.supporting_sources:[]){
        candidates.push({
          subject:row.subject,
          claim:row.claim,
          source_id:source.source_id,
          source_url:source.source_url,
          content_hash:source.content_hash||row.content_hash||null,
          observed_at:row.observed_at||null,
          metadata:source.metadata&&typeof source.metadata==="object"?source.metadata:{}
        });
      }
    }
    const verification=verifier.verifyFacts(candidates);
    const local=this.local.upsertMany(verification.facts||[]);
    const out={state:"SUCCESS",remote_records:(remote.records||[]).length,candidates:candidates.length,reverified:verification.verified||0,training_eligible:verification.training_eligible||0,recovered:local.written||0,local};
    this.audit?.append?.({type:"knowledge.cloud.recovery",remoteRecords:out.remote_records,candidates:out.candidates,reverified:out.reverified,recovered:out.recovered});
    return out;
  }
}
export default HybridKnowledgeStore;
