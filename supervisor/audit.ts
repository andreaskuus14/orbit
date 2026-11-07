// Append-only audit trail: one JSON line per event, each carrying the hash of the line before it, so an edited,
// removed or reordered line breaks verification. Tamper-evident, not tamper-proof: the file's ACL (supervisor
// account only, see README.md) is what keeps the builder and the app from writing it at all.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

export type AuditEntry = { seq: number; ts: string; event: string; data: Record<string, unknown>; prev: string; hash: string };

const GENESIS = "0".repeat(64);
const digest = (e: Omit<AuditEntry, "hash">) => createHash("sha256").update(JSON.stringify([e.seq, e.ts, e.event, e.data, e.prev])).digest("hex");

export function readAudit(file: string): AuditEntry[] {
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
}

/** First broken line (1-based) or 0 when the chain is intact. */
export function verifyAudit(entries: AuditEntry[]): number {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i + 1 || e.prev !== prev || digest(e) !== e.hash) return i + 1;
    prev = e.hash;
  }
  return 0;
}

export function appendAudit(file: string, event: string, data: Record<string, unknown>, now = new Date()): AuditEntry {
  const all = readAudit(file);
  const broken = verifyAudit(all);
  // Keep writing (an audit gap is worse than a flagged one) but record that the chain was already broken.
  if (broken) data = { ...data, auditChainBrokenAt: broken };
  const last = all.at(-1);
  const base = { seq: all.length + 1, ts: now.toISOString(), event, data, prev: last?.hash ?? GENESIS };
  const entry = { ...base, hash: digest(base) };
  appendFileSync(file, JSON.stringify(entry) + "\n");
  return entry;
}
