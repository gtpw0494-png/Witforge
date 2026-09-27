import fs from "node:fs";
import path from "node:path";

export class KnowledgeRollback {
  constructor({ stateRoot = path.resolve("state") } = {}) {
    this.stateRoot = stateRoot;
    this.dir = path.join(this.stateRoot, "knowledge-rollbacks");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  snapshot(label = "knowledge-snapshot", payload = {}) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const file = path.join(this.dir, `${id}.json`);
    const entry = {
      id,
      label,
      created_at: new Date().toISOString(),
      payload,
    };
    fs.writeFileSync(file, JSON.stringify(entry, null, 2), "utf8");
    return { state: "SUCCESS", snapshot: entry };
  }

  list() {
    if (!fs.existsSync(this.dir)) return { state: "SUCCESS", snapshots: [] };
    const snapshots = fs.readdirSync(this.dir)
      .filter(x => x.endsWith(".json"))
      .map(file => JSON.parse(fs.readFileSync(path.join(this.dir, file), "utf8")))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { state: "SUCCESS", snapshots };
  }

  rollback(snapshotId, reason = "user-requested rollback") {
    const snapshots = this.list().snapshots;
    const snapshot = snapshots.find(item => item.id === snapshotId);
    if (!snapshot) {
      return { state: "FAILURE", message: "Snapshot not found" };
    }
    return {
      state: "SUCCESS",
      rolled_back: true,
      snapshot_id: snapshotId,
      reason,
      snapshot,
    };
  }
}

export default KnowledgeRollback;