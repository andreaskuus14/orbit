import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_KINDS, MAX_CARDS, cardKey, kindWeights, morningCandidates, rankCards, type Candidate, type Thumb } from "../src/lib/morning-rank-pure.ts";

const NOW = Date.parse("2026-10-23T07:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const c = (kind: Candidate["kind"], key: string, base: number): Candidate => ({ kind, key, title: key, base, open: { panel: "agents" } });
const ALL = [c("task", "t1", 0.9), c("task", "t2", 0.85), c("task", "t3", 0.8), c("goal", "g1", 0.4), c("news", "n1", 0.5), c("business", "b1", 0.3), c("idea", "i1", 0.2)];

test("no thumbs: one card per kind, top task first, exactly 5", () => {
  const r = rankCards(ALL, [], NOW);
  assert.equal(r.length, MAX_CARDS);
  assert.deepEqual(r.map((x) => x.key), ["t1", "n1", "g1", "b1", "i1"]);
});

test("missing kinds are filled with the next best items", () => {
  const r = rankCards(ALL.filter((x) => x.kind === "task" || x.kind === "news"), [], NOW);
  assert.deepEqual(r.map((x) => x.key), ["t1", "t2", "t3", "n1"]);
});

test("👎 on an exact item hides it for a week, then it can return", () => {
  const down: Thumb = { kind: "task", key: "t1", up: false, at: ago(1) };
  assert.equal(rankCards(ALL, [down], NOW).some((x) => x.key === "t1"), false);
  assert.equal(rankCards(ALL, [{ ...down, at: ago(8) }], NOW).some((x) => x.key === "t1"), true);
  // a newer 👍 on the same key wins over the older 👎
  assert.equal(rankCards(ALL, [down, { ...down, up: true, at: ago(0.5) }], NOW)[0].key, "t1");
});

test("kind weights learn from thumbs, decay with age and stay in (0.5, 1.5)", () => {
  const ups = Array.from({ length: 4 }, (_, i): Thumb => ({ kind: "idea", key: `x${i}`, up: true, at: ago(1) }));
  const w = kindWeights(ups, NOW);
  assert.ok(w.idea > 1.4 && w.idea < 1.5);
  assert.equal(w.task, 1);
  assert.ok(kindWeights(ups.map((t) => ({ ...t, at: ago(60) })), NOW).idea < w.idea);
  const many = Array.from({ length: 100 }, (_, i): Thumb => ({ kind: "news", key: `y${i}`, up: false, at: ago(0) }));
  assert.ok(kindWeights(many, NOW).news >= 0.5);
  // future-dated and unknown kinds are ignored
  assert.deepEqual(kindWeights([{ kind: "life", key: "k", up: true, at: ago(1) }, { kind: "idea", key: "k", up: true, at: ago(-1) }], NOW), Object.fromEntries(CARD_KINDS.map((k) => [k, 1])));
});

test("liked kinds rise; a disliked kind loses its reserved slot", () => {
  const likeGoals = Array.from({ length: 6 }, (_, i): Thumb => ({ kind: "goal", key: `old${i}`, up: true, at: ago(1) }));
  const r = rankCards(ALL, likeGoals, NOW), base = rankCards(ALL, [], NOW), at = (xs: { key: string }[], k: string) => xs.findIndex((x) => x.key === k);
  assert.ok(at(base, "g1") > at(base, "n1") && at(r, "g1") < at(r, "n1"));
  const hateBiz = Array.from({ length: 4 }, (_, i): Thumb => ({ kind: "business", key: `old${i}`, up: false, at: ago(1) }));
  const r2 = rankCards(ALL, hateBiz, NOW);
  assert.equal(r2.some((x) => x.key === "b1"), false);
  assert.equal(r2.length, MAX_CARDS);
});

test("duplicate keys collapse and order is deterministic", () => {
  const r = rankCards([c("news", "n1", 0.5), c("news", "n1", 0.9), c("goal", "g", 0.5)], [], NOW);
  assert.deepEqual(r.map((x) => [x.key, x.score]), [["g", 0.5], ["n1", 0.5]]); // first copy kept; ties go by kind order
});

test("morningCandidates maps every source to a kind with ledger-safe keys", () => {
  const item = { kind: "task" as const, id: "a1", title: "Ship it", status: "awaiting_approval", detail: "d", action: "Approve" };
  const cs = morningCandidates({
    work: { items: [item, { ...item, kind: "goal", id: "g1", status: "running" }] }, studioReady: 2, proposals: ["p"],
    headlines: ["H".repeat(300)], alerts: ["AAPL above 200"], followups: [{ id: "p1", name: "Cafe" }],
    recall: [{ id: "m1", title: "Old note", label: "a year ago" }], ideas: [{ id: "i1", title: "Idea", next: "Try it", score: 80 }],
  });
  assert.deepEqual([...new Set(cs.map((x) => x.kind))].sort(), [...CARD_KINDS].sort());
  assert.ok(cs.every((x) => x.key.length <= 128 && x.base >= 0 && x.base <= 1));
  assert.equal(cs.find((x) => x.kind === "task")!.base, 0.9);
  assert.deepEqual(cs.find((x) => x.kind === "goal")!.open, { work: { ...item, kind: "goal", id: "g1", status: "running" } });
  assert.equal(cardKey("news", "  a   b "), "news:a b");
});
