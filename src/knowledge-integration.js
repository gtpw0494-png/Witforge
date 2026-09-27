export class KnowledgeIntegration {
  constructor({harvester=null,autonomy=null,store=null,training=null,promotion=null,metrics=null,rollback=null,benchmark=null}={}) {
    Object.assign(this,{harvester,autonomy,store,training,promotion,metrics,rollback,benchmark});
  }
  async endToEndHarvest(limit=100) {
    if(!this.harvester||!this.autonomy||!this.store||!this.training||!this.promotion) return {state:"FAILURE",message:"Knowledge integration is not fully configured."};
    const harvest=await this.harvester.harvestAll();
    const candidates=(harvest.results||[]).flatMap(x=>x.facts||[]);
    const verification=this.autonomy.verifyFacts(candidates);
    const persisted=this.store.upsertMany(verification.facts||[]);
    const batch=this.training.buildBatch(limit);
    const benchmarkResult=this.benchmark?await this.benchmark(batch):{state:"UNAVAILABLE",score:0,reason:"No benchmark configured"};
    const evaluation=this.promotion.evaluateBatch(batch,benchmarkResult);
    const snapshot=this.rollback?this.rollback.snapshot("knowledge-pre-promotion",{batch,evaluation,benchmark:benchmarkResult}):null;
    const promotion=evaluation.eligible_for_training?this.promotion.promoteToTraining(batch.id||snapshot?.snapshot?.id||"knowledge-batch",evaluation):this.promotion.rejectBatch(batch.id||"knowledge-batch","benchmark or evidence gate failed");
    this.metrics?.record({harvested:candidates.length,verified:verification.verified||0,training_eligible:batch.count||0,rejected:Math.max(0,(verification.claims||0)-(verification.verified||0))});
    return {state:promotion.state==="SUCCESS"?"SUCCESS":"PARTIAL",harvest,verification,persisted,batch,benchmark:benchmarkResult,evaluation,snapshot,promotion};
  }
  status(){return{state:"SUCCESS",configured:Boolean(this.harvester&&this.autonomy&&this.store&&this.training&&this.promotion),components:{harvester:Boolean(this.harvester),autonomy:Boolean(this.autonomy),store:Boolean(this.store),training:Boolean(this.training),promotion:Boolean(this.promotion),metrics:Boolean(this.metrics),rollback:Boolean(this.rollback),benchmark:Boolean(this.benchmark)}}}
}
export default KnowledgeIntegration;
