export class KnowledgePromotion {
  constructor({ benchmarkThreshold = 0.75, rollbackOnFailure = true } = {}) {
    this.benchmarkThreshold = benchmarkThreshold;
    this.rollbackOnFailure = rollbackOnFailure;
  }

  evaluateBatch(batch = {}, benchmarkResult = {}) {
    const batchScore = Number(batch.training_eligible) / Math.max(1, Number(batch.count));
    const benchmarkScore = Number(benchmarkResult.score || 0);
    const passedBenchmark = benchmarkScore >= this.benchmarkThreshold;

    return {
      state: "SUCCESS",
      batch_quality: batchScore,
      benchmark_score: benchmarkScore,
      benchmark_pass: passedBenchmark,
      eligible_for_training: passedBenchmark && batchScore >= 0.8,
      recommendation: passedBenchmark ? "PROMOTE" : "REJECT",
    };
  }

  promoteToTraining(batchId, evaluation = {}) {
    if (!evaluation.eligible_for_training) {
      return {
        state: "BLOCKED",
        message: "Batch does not meet training eligibility criteria",
        batch_id: batchId,
      };
    }

    return {
      state: "SUCCESS",
      promoted: true,
      batch_id: batchId,
      promotion_time: new Date().toISOString(),
      training_eligible: true,
    };
  }

  rejectBatch(batchId, reason = "benchmark failure") {
    return {
      state: "SUCCESS",
      rejected: true,
      batch_id: batchId,
      reason,
      recommendation: "ROLLBACK",
    };
  }
}

export default KnowledgePromotion;