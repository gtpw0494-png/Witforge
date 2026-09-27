export class KnowledgeTraining {
  constructor({ store = null } = {}) {
    this.store = store;
  }

  buildBatch(limit = 100) {
    const items = this.store && typeof this.store.filterTrainingEligible === "function"
      ? this.store.filterTrainingEligible(limit)
      : [];

    return {
      state: "SUCCESS",
      count: items.length,
      batch: items,
      training_eligible: items.length,
    };
  }
}

export default KnowledgeTraining;
