import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function sha256(data) { return crypto.createHash("sha256").update(data).digest("hex"); }

export class WorkspaceManager {
  constructor(root, stateRoot, audit) {
    this.root = path.resolve(root);
    this.stateRoot = stateRoot;
    this.audit = audit;
    this.snapshotRoot = path.join(stateRoot, "snapshots");
    fs.mkdirSync(this.snapshotRoot, { recursive: true });
  }
  resolveSafe(rel) {
    const normalized = String(rel || "").replaceAll("\\", "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("\0")) throw new Error("Invalid path");
    const absolute = path.resolve(this.root, normalized);
    if (absolute !== this.root && !absolute.startsWith(this.root + path.sep)) throw new Error("Path escapes workspace");
    if (normalized.startsWith("data/") || normalized.startsWith("state/")) throw new Error("Runtime state paths are not source-mutation targets");
    return { normalized, absolute };
  }
  inspect(rel) {
    const { normalized, absolute } = this.resolveSafe(rel);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return { path: normalized, exists: false };
    const content = fs.readFileSync(absolute, "utf8");
    return { path: normalized, exists: true, hash: sha256(content), bytes: Buffer.byteLength(content), content };
  }
  snapshot(rel) {
    const before = this.inspect(rel);
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const dir = path.join(this.snapshotRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id, at: new Date().toISOString(), before }, null, 2));
    if (before.exists) fs.writeFileSync(path.join(dir, "content.txt"), before.content);
    this.audit?.append({ type: "workspace.snapshot", snapshotId: id, path: before.path, hash: before.hash || null });
    return { id, before };
  }
  apply({ path: rel, content, expectedHash = null, approval = false, reason = "" }) {
    if (approval !== true) return { state: "DENIED", message: "Explicit approval=true is required for source mutation." };
    const target = this.inspect(rel);
    if (expectedHash && target.hash !== expectedHash) return { state: "BLOCKED", message: "Source changed since proposal; expectedHash mismatch.", currentHash: target.hash || null };
    const next = String(content ?? "");
    if (!next.trim()) return { state: "BLOCKED", message: "Empty source writes are blocked by additive-first policy." };
    const snap = this.snapshot(rel);
    const { absolute, normalized } = this.resolveSafe(rel);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const tmp = absolute + `.tmp-${process.pid}`;
    fs.writeFileSync(tmp, next);
    fs.renameSync(tmp, absolute);
    const after = this.inspect(normalized);
    this.audit?.append({ type: "workspace.mutation", path: normalized, beforeHash: target.hash || null, afterHash: after.hash, snapshotId: snap.id, reason });
    return { state: "SUCCESS", message: "Source write applied and snapshotted.", path: normalized, beforeHash: target.hash || null, afterHash: after.hash, snapshotId: snap.id };
  }
  rollback(snapshotId, approval = false) {
    if (approval !== true) return { state: "DENIED", message: "Explicit approval=true is required for rollback." };
    const dir = path.join(this.snapshotRoot, String(snapshotId));
    const metaFile = path.join(dir, "meta.json");
    if (!fs.existsSync(metaFile)) return { state: "FAILURE", message: "Snapshot not found." };
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    const { absolute, normalized } = this.resolveSafe(meta.before.path);
    if (!meta.before.exists) {
      return { state: "BLOCKED", message: "Additive-first policy does not automatically delete files created after a snapshot.", path: normalized };
    }
    fs.writeFileSync(absolute, fs.readFileSync(path.join(dir, "content.txt")));
    const after = this.inspect(normalized);
    this.audit?.append({ type: "workspace.rollback", path: normalized, snapshotId, afterHash: after.hash });
    return { state: "SUCCESS", message: "Previous source restored from snapshot.", path: normalized, afterHash: after.hash };
  }
}
