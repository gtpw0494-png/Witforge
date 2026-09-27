import crypto from "node:crypto";
import zlib from "node:zlib";

const MAGIC = Buffer.from("IUB1");

function canonical(value) {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(v=>v===undefined?"null":canonical(v)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  const encoded=JSON.stringify(value);
  return encoded===undefined?"null":encoded;
}

export function encodeIU(record) {
  const normalized = {
    format: "intraultuniversalion-binary",
    version: 1,
    createdAt: record.createdAt || new Date().toISOString(),
    ...record
  };
  const raw = Buffer.from(canonical(normalized), "utf8");
  const body = zlib.brotliCompressSync(raw);
  const digest = crypto.createHash("sha256").update(body).digest();
  const size = Buffer.alloc(4); size.writeUInt32BE(body.length);
  return Buffer.concat([MAGIC, size, digest, body]);
}

export function decodeIU(buffer) {
  if (!buffer.subarray(0, 4).equals(MAGIC)) throw new Error("Invalid IUB1 magic");
  const size = buffer.readUInt32BE(4);
  const digest = buffer.subarray(8, 40);
  const body = buffer.subarray(40, 40 + size);
  const actual = crypto.createHash("sha256").update(body).digest();
  if (!crypto.timingSafeEqual(digest, actual)) throw new Error("Integrity verification failed");
  return JSON.parse(zlib.brotliDecompressSync(body).toString("utf8"));
}
