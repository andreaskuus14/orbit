// S02: an Approve click carries a fingerprint of the exact pending actions the owner was shown (tool + full input, key order
// ignored). The server recomputes it from the stored task and refuses when anything changed, including after a restart, since both
// sides read the persisted pending list. Runs in the browser and on the server (no node:crypto). Tests: tests/approval-bind.test.ts.
type Act = { tool: string; input: Record<string, unknown>; status: string };

const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;

/** 64-bit FNV-1a (two lanes) over the canonical JSON of the actions still waiting. Detects edits, not adversarial collisions. */
export function pendingSeen(pending: readonly Act[]): string {
  const s = JSON.stringify(pending.filter((p) => p.status === "pending").map((p) => [p.tool, canon(p.input)]));
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x01000193 + 2 * i) >>> 0; }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** "" if this approval may run: no fingerprint sent (older callers) or it matches what is stored now. */
export function seenProblem(stored: readonly Act[], seen: unknown): string {
  if (seen === undefined) return "";
  return typeof seen === "string" && seen === pendingSeen(stored) ? "" : "The actions changed since you looked. Nothing was run: reload and check them again.";
}
