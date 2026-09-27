export class KnowledgeEligibility {
  constructor({ minTrust = 0.8, minCorroboration = 1 } = {}) {
    this.minTrust = minTrust;
    this.minCorroboration = minCorroboration;
  }

  normalizeFact(item = {}) {
    const trust = Number(item.trust ?? item.confidence ?? 0);
    return {
      ...item,
      trust,
      subject: String(item.subject || "").trim(),
      claim: String(item.claim || "").trim(),
      source_id: String(item.source_id || item.sourceId || "unknown"),
      source_url: String(item.source_url || item.sourceUrl || "https://example.invalid"),
      training_eligible: Boolean(item.training_eligible || (trust >= this.minTrust && Number(item.corroboration || 0) >= this.minCorroboration)),
      corroboration: Number(item.corroboration || 0),
    };
  }

  gate(items = []) {
    const normalized = (Array.isArray(items) ? items : []).map(item => this.normalizeFact(item));
    const eligible = normalized.filter(item => item.training_eligible || (item.trust >= this.minTrust && item.corroboration >= this.minCorroboration));
    const rejected = normalized.filter(item => !eligible.some(e => e.source_id === item.source_id && e.claim === item.claim));
    return {
      state: "SUCCESS",
      total: normalized.length,
      eligible: eligible.length,
      rejected: rejected.length,
      items: normalized,
      eligible_items: eligible,
      rejected_items: rejected,
    };
  }
}

export default KnowledgeEligibility;
