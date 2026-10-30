import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueue, decideReview, SNOOZE_DAYS } from "../src/lib/memory-review-pure.ts";
import { dupCandidates } from "../src/lib/memory-hygiene-pure.ts";

const NOW = Date.parse("2026-10-30T00:00:00Z"), DAY = 86_400_000;
const mem = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, content: `text ${id}`, kind: "note", tags: [] as string[], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...extra });
const merge = { key: "merge:a:b", action: "merge" as const, ids: ["a", "b"], why: "same text" as const, score: 3, status: "pending" as const, items: [{ id: "a", title: "a" }, { id: "b", title: "b" }] };
const st = { dismissed: [] as string[] };

test("one queue: ranked, top 5, one record never in two items", () => {
  const mems = [mem("a", { confirmation: "suggested" }), mem("b"), mem("c", { source: "inferred" }), mem("old", { folder: "House", updated_at: "2025-01-01T00:00:00Z" }), mem("j", { kind: "journal", confirmation: "suggested" })];
  const facts = [{ id: "f", subject: "coffee", statement: "likes coffee", status: "current", source: "inferred", created_at: "2026-01-01" }];
  const q = buildQueue({ proposals: [merge], mems, facts }, st, NOW);
  assert.deepEqual(q.map((i) => i.key), ["merge:a:b", "belief:f", "infer:c", "stale:old"]); // a is in the merge, never twice; journal never
  assert.equal(buildQueue({ proposals: [merge], mems: [...Array(9)].map((_, i) => mem(`m${i}`, { confirmation: "suggested" })), facts: [] }, st, NOW).length, 5);
});

test("decisions leave the queue everywhere; snooze returns after a week", () => {
  const mems = [mem("c", { source: "inferred" })];
  const u0 = { week: "w", proposals: [merge], dismissed: [] };
  const acc = decideReview(u0, "merge:a:b", "corrected", NOW);
  assert.equal(acc.proposals[0].status, "accepted");
  assert.equal(buildQueue({ proposals: acc.proposals.map((p) => ({ ...p, items: merge.items })), mems: [], facts: [] }, acc, NOW).length, 0);
  const sn = decideReview(u0, "infer:c", "snoozed", NOW);
  assert.equal(buildQueue({ proposals: [], mems, facts: [] }, sn, NOW).length, 0);
  assert.equal(buildQueue({ proposals: [], mems, facts: [] }, sn, NOW + SNOOZE_DAYS * DAY + 1).length, 1);
  const dis = decideReview(sn, "infer:c", "dismissed", NOW);
  assert.ok(dis.dismissed.includes("infer:c") && !dis.snoozed?.["infer:c"]);
});

test("hygiene never proposes merging an intentional separate version", () => {
  const h = (id: string, tags: string[]) => ({ id, title: "t", content: "same", kind: "note", tags, created_at: "2026-01-01", embedding: null });
  assert.equal(dupCandidates([h("a", []), h("b", ["v:a"])]).length, 0);
  assert.equal(dupCandidates([h("a", []), h("b", [])]).length, 1);
});
