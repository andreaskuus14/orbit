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

test("dated generated outputs never merge; re-runs and v2 become keep-newest", () => {
  const h = (id: string, title: string, created_at = "2026-10-15T08:00:00Z") => ({ id, title, content: "World news today", kind: "note", tags: [], created_at, embedding: [1, 0] });
  assert.equal(dupCandidates([h("a", "World brief · Sat 24 Oct"), h("b", "World brief · Sun 25 Oct")]).length, 0);
  const [re] = dupCandidates([h("a", "World brief · Thu 15 Oct"), h("b", "World brief · Thu 15 Oct", "2026-10-15T09:00:00Z")]);
  assert.deepEqual([re.why, re.ids], ["re-run", ["b", "a"]]);
  const [v] = dupCandidates([h("a", "YouTube ideas · Thu 15 Oct 2026 (Roblox/gaming) v2", "2026-10-16T00:00:00Z"), h("b", "YouTube ideas · Thu 15 Oct 2026 (Roblox/gaming)")]);
  assert.deepEqual([v.why, v.ids], ["version", ["a", "b"]]);
  // same date, different outputs: stricter similarity for generated content
  const g = (id: string, title: string, e: number[]) => ({ ...h(id, title), content: id, embedding: e });
  assert.equal(dupCandidates([g("a", "World brief · 15 Oct", [1, 0]), g("b", "Market brief · 15 Oct", [1, 0.3])]).length, 0);
  assert.equal(dupCandidates([g("a", "Notes on pets", [1, 0]), g("b", "Pet notes", [1, 0.3])]).length, 1);
});

test("stored merge proposals are re-judged on titles; entity check folds into the one queue", () => {
  const p = (a: string, b: string) => ({ ...merge, key: `merge:${a}:${b}`, ids: [a, b], items: [{ id: a, title: a }, { id: b, title: b }] });
  const mems = [mem("a", { title: "World brief · Sat 24 Oct" }), mem("b", { title: "World brief · Sun 25 Oct" }),
    mem("c", { title: "World brief · Thu 15 Oct" }), mem("d", { title: "World brief · Thu 15 Oct", created_at: "2026-10-02T00:00:00Z" })];
  const q = buildQueue({ proposals: [p("a", "b"), p("c", "d")], mems, facts: [] }, st, NOW);
  assert.deepEqual(q.map((i) => [i.kind, i.ids]), [["rerun", ["d", "c"]]]);
  const src = { id: "c", type: "memory" as const, title: "x", at: "2026-01-01" };
  const entities = {
    merges: [{ key: "same:0000000a", keys: ["mart", "mart tamm"], forms: ["Mart", "Mart Tamm"], kind: "person" as const, confidence: 0.88 }],
    contradictions: [{ key: "contra:0000000b", entity: "me", attr: "home" as const, options: [{ norm: "tartu", value: "Tartu", src }, { norm: "tallinn", value: "Tallinn", src: { ...src, id: "z" } }] }],
  };
  const q2 = buildQueue({ proposals: [p("c", "d")], mems, facts: [], entities }, st, NOW);
  assert.deepEqual(q2.map((i) => i.kind), ["entity-which", "entity-same"]); // the question cites c, so the re-run of c waits: one record, one item
  assert.equal(q2[1].items[0].title, "Mart · Mart Tamm");
  assert.deepEqual(q2[0].items.map((x) => x.id), ["tartu", "tallinn"]);
});
