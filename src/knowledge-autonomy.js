import crypto from "node:crypto";
import { KnowledgeVerifier } from "./knowledge-verifier.js";

export class KnowledgeAutonomy {
  constructor({ registry = [], minTrust = 0.8, minIndependentSources = 2 } = {}) {
    this.registry=Array.isArray(registry)?registry:[];
    this.verifier=new KnowledgeVerifier({registry:this.registry,minTrust,minIndependentSources});
  }
  loadSources(sourceList=[]) {
    this.registry=Array.isArray(sourceList)?sourceList:[];
    this.verifier=new KnowledgeVerifier({registry:this.registry,minTrust:this.verifier.minTrust,minIndependentSources:this.verifier.minIndependentSources});
    return {state:"SUCCESS",count:this.registry.length};
  }
  hashFact(fact) {
    return crypto.createHash("sha256").update([fact.subject,fact.claim,fact.source_id,fact.source_url].join("|")).digest("hex");
  }
  verifyFacts(facts=[]) {
    const result=this.verifier.verifyGroup(Array.isArray(facts)?facts:[]);
    return {...result,facts:result.facts.map(f=>({...f,fact_id:this.hashFact(f)}))};
  }
  filterEligible(facts=[]) {
    return this.verifyFacts(facts).facts.filter(f=>f.training_eligible===true);
  }
  status() {
    return {state:"SUCCESS",local_only:true,network_required:false,sources:this.registry.length,approved_sources:this.registry.filter(x=>x.allowed).length,verification:"independent-approved-source-corroboration",min_independent_sources:this.verifier.minIndependentSources,capabilities:["knowledge-ingest","source-validation","corroboration","training-filter"]};
  }
}
export default KnowledgeAutonomy;
