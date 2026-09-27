export class KnowledgeLearningPipeline {
  constructor({trainingJob,promotion,jobStore,audit=null}={}) {
    Object.assign(this,{trainingJob,promotion,jobStore,audit});
  }

  status() {
    return {
      state:"SUCCESS",
      configured:Boolean(this.trainingJob&&this.promotion&&this.jobStore),
      jobs:this.jobStore?.list?.(20)||[]
    };
  }

  async trainCandidate(batch,options={}) {
    if(!this.trainingJob||!this.jobStore)return{state:"FAILURE",message:"Knowledge training pipeline is not configured."};
    const result=await this.trainingJob.execute(batch,options);
    const job=this.jobStore.record({
      id:result.job_id||undefined,
      job_id:result.job_id||undefined,
      kind:"forgelm-knowledge-training",
      phase:result.state==="SUCCESS"?"CANDIDATE_READY":"TRAINING_FAILED",
      state:result.state,
      batch_count:result.batch_count||0,
      dataset:result.dataset||null,
      dataset_manifest:result.dataset_manifest||null,
      candidate_checkpoint:result.candidate_checkpoint||null,
      candidate_sha256:result.candidate_sha256||null,
      trained:Boolean(result.trained),
      promoted:false,
      production_eligible:false
    });
    this.audit?.append?.({type:"knowledge.training.candidate",jobId:job.id,state:job.state,candidateSha256:job.candidate_sha256||null,batchCount:job.batch_count});
    return {...result,job};
  }

  async evaluateCandidate(jobId,{maxRelativeRegression=0.02}={}) {
    const job=this.jobStore?.get?.(jobId);
    if(!job)return{state:"UNAVAILABLE",message:"Knowledge training job not found."};
    if(job.phase!=="CANDIDATE_READY"&&job.phase!=="EVALUATED")return{state:"BLOCKED",message:"Job has no candidate ready for evaluation.",job};
    const evaluation=await this.promotion.evaluate({
      candidate:job.candidate_checkpoint,
      dataset:job.dataset,
      maxRelativeRegression
    });
    const updated=this.jobStore.update(jobId,{
      phase:evaluation.eligible?"EVALUATED":"REJECTED",
      evaluation,
      production_eligible:false,
      rejection_reason:evaluation.eligible?null:"checkpoint regression gate failed"
    });
    this.audit?.append?.({type:"knowledge.training.evaluated",jobId,state:evaluation.state,eligible:evaluation.eligible,candidateSha256:evaluation.candidate_sha256||null});
    return{state:evaluation.state,evaluation,job:updated.job||job};
  }

  promoteCandidate(jobId,{approvalId,approved=false}={}) {
    const job=this.jobStore?.get?.(jobId);
    if(!job)return{state:"UNAVAILABLE",message:"Knowledge training job not found."};
    if(!job.evaluation?.eligible)return{state:"BLOCKED",message:"Candidate has not passed evaluation.",job};
    const result=this.promotion.promote({
      candidate:job.candidate_checkpoint,
      evaluation:job.evaluation,
      approved,
      approvalId
    });
    const phase=result.state==="SUCCESS"?"PROMOTED":result.state==="WAITING_APPROVAL"?"WAITING_APPROVAL":"BLOCKED";
    const updated=this.jobStore.update(jobId,{
      phase,
      promotion:result,
      promoted:result.state==="SUCCESS",
      production_eligible:result.state==="SUCCESS"
    });
    return{...result,job:updated.job||job};
  }

  rollbackPromotion(jobId,{reason="model regression"}={}) {
    const job=this.jobStore?.get?.(jobId);
    if(!job)return{state:"UNAVAILABLE",message:"Knowledge training job not found."};
    const rollbackId=job?.promotion?.previous?.id;
    if(!rollbackId)return{state:"BLOCKED",message:"Job has no promoted rollback snapshot.",job};
    const result=this.promotion.rollback(rollbackId,{reason});
    const updated=this.jobStore.update(jobId,{
      phase:result.state==="SUCCESS"?"ROLLED_BACK":"ROLLBACK_FAILED",
      rollback:result,
      production_eligible:false
    });
    return{...result,job:updated.job||job};
  }
}
export default KnowledgeLearningPipeline;
