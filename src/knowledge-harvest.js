import https from "node:https";
import http from "node:http";

export class KnowledgeHarvester {
  constructor({ sources = [], timeout = 10000 } = {}) {
    this.sources = sources || [];
    this.timeout = timeout;
  }

  approvedSources() {
    return this.sources.filter(s => s.allowed);
  }

  async fetchUrl(url, timeoutMs = this.timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ state: "TIMEOUT", url }), timeoutMs);
      const client = url.startsWith("https") ? https : http;
      const req = client.get(url, { timeout: timeoutMs }, (res) => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({
            state: "SUCCESS",
            url,
            status: res.statusCode,
            headers: res.headers,
            body: data.slice(0, 50000),
          });
        });
      }).on("error", () => {
        clearTimeout(timer);
        resolve({ state: "FAILURE", url, message: "Network error" });
      });
      req.end();
    });
  }

  extractMetadata(html = "") {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const keywordsMatch = html.match(/<meta\s+name=["']keywords["'][^>]*content=["']([^"']+)["'][^>]*>/i);

    return {
      title: titleMatch ? titleMatch[1].trim() : null,
      description: descMatch ? descMatch[1].trim() : null,
      keywords: keywordsMatch ? keywordsMatch[1].split(",").map(k => k.trim()) : [],
    };
  }

  async harvestSource(source = {}) {
    if (!source.allowed) {
      return { state: "BLOCKED", message: "Source not approved", source_id: source.id };
    }

    const url = `https://${source.domain}`;
    const result = await this.fetchUrl(url);

    if (result.state !== "SUCCESS") {
      return { state: result.state, source_id: source.id, url, reason: result.message };
    }

    const metadata = this.extractMetadata(result.body);
    const facts = [];

    if (metadata.title) {
      facts.push({
        subject: source.name,
        claim: metadata.title,
        source_id: source.id,
        source_url: url,
        trust: source.trust || 0.85,
        kind: "metadata",
        metadata: { type: "title" },
      });
    }

    if (metadata.description) {
      facts.push({
        subject: source.name,
        claim: metadata.description,
        source_id: source.id,
        source_url: url,
        trust: source.trust || 0.85,
        kind: "metadata",
        metadata: { type: "description" },
      });
    }

    return {
      state: "SUCCESS",
      source_id: source.id,
      url,
      harvested: facts.length,
      facts,
    };
  }

  async harvestAll() {
    const approved = this.approvedSources();
    const results = [];
    let totalFacts = 0;

    for (const source of approved) {
      const result = await this.harvestSource(source);
      results.push(result);
      if (result.state === "SUCCESS") {
        totalFacts += result.harvested;
      }
    }

    return {
      state: "SUCCESS",
      sources_harvested: approved.length,
      total_facts: totalFacts,
      results,
    };
  }
}

export default KnowledgeHarvester;