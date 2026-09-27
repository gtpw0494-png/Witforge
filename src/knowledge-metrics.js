export class KnowledgeMetrics {
  constructor() {
    this.metrics = {
      harvested: 0,
      verified: 0,
      training_eligible: 0,
      rejected: 0,
      rollbacks: 0,
      last_update: null,
    };
  }

  record({ harvested = 0, verified = 0, training_eligible = 0, rejected = 0, rollbacks = 0 } = {}) {
    this.metrics.harvested += harvested;
    this.metrics.verified += verified;
    this.metrics.training_eligible += training_eligible;
    this.metrics.rejected += rejected;
    this.metrics.rollbacks += rollbacks;
    this.metrics.last_update = new Date().toISOString();
    return { state: "SUCCESS", metrics: this.metrics };
  }

  snapshot() {
    return {
      state: "SUCCESS",
      metrics: { ...this.metrics },
    };
  }
}

export default KnowledgeMetrics;