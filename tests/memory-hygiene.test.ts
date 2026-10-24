import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, dupCandidates, factCandidates, mergedContent, mergePlan, normText, pickWeekly, type HMem, type HProposal } from "../src/lib/memory-hygiene-pure.ts";

const mem = (id: string, content: string, o: Partial<HMem> = {}): HMem => ({ id, title: "t", content, kind: "note", tags: [], created_at: `2026-01-0${id.length}T00:00:00Z`, embedding: null, ...o });
const fact = (id: string, subject: string, statement: string, created_at: string, o = {}) => ({ id, subject, statement, status: "current" as const, confidence: 0.7, created_at, ...o });
const NOW = Date.parse("2026-10-24T12:00:00Z");

test("normText ignores case, punctuation and spacing", () => {
  assert.equal(normText("  Buy MILK!! tomorrow,"), "buy milk tomorrow");
});

test("duplicates: same text or cosine ≥ 0.93, same kind only, never a consolidated note with its member", () => {
  const v = (x: number) => [1, x, 0];
  const c = dupCandidates([
    mem("a", "Buy milk!"), mem("b", "buy milk"), // same text
    mem("cc", "x", { embedding: v(0.1) }), mem("ddd", "y", { embedding: v(0.12) }), // near duplicate
    mem("eeee", "z", { embedding: v(5) }), // far away
    mem("f", "Buy milk", { kind: "journal" }), // other kind
    mem("g", "buy milk", { tags: ["consolidated", "a"] }), // consolidated from a
  ]);
  const keys = c.map((p) => p.key).sort();
  assert.ok(keys.includes("merge:a:b") && keys.includes("merge:cc:ddd"));
  assert.ok(!keys.some((k) => k.includes("eeee") || k.includes(":f") || k.startsWith("merge:f") || k === "merge:a:g"));
  assert.equal(c.find((p) => p.key === "merge:a:b")!.why, "same text");
  assert.equal(c.find((p) => p.key === "merge:cc:ddd")!.why, "near duplicate");
});

test("merge keeps the longer memory (older on a tie) and folds in only new text", () => {
  assert.deepEqual(mergePlan(mem("a", "short"), mem("b", "much longer text")), { keep: "b", drop: "a", content: "much longer text\n\nshort" });
  assert.equal(mergePlan(mem("a", "same"), mem("bb", "same")).keep, "a");
  assert.equal(mergedContent("I like dark mode a lot.", "i like dark mode"), null);
});

test("beliefs: older same-subject fact is superseded, or contradicted when polarity flips; year-old ones are stale", () => {
  const c = factCandidates([
    fact("f1", "coffee", "I love coffee", "2026-01-01T00:00:00Z"),
    fact("f2", "Coffee", "I no longer drink coffee", "2026-09-01T00:00:00Z"),
    fact("f3", "editor", "I use vim", "2026-02-01T00:00:00Z"),
    fact("f4", "editors", "I use helix", "2026-10-01T00:00:00Z"),
    fact("f5", "tea", "I like tea", "2025-01-01T00:00:00Z"),
    fact("f6", "music", "I like jazz", "2025-01-01T00:00:00Z", { status: "superseded" }),
  ], NOW);
  const by = Object.fromEntries(c.map((p) => [p.ids[0], p.why]));
  assert.deepEqual(by, { f1: "contradicted", f3: "superseded", f5: "stale" });
});

test("pickWeekly: at most 3, best first, skips dismissed keys and items already used", () => {
  const p = (key: string, ids: string[], score: number): HProposal => ({ key, action: "merge", ids, why: "near duplicate", score, status: "pending" });
  const out = pickWeekly([p("k1", ["a", "b"], 2.5), p("k2", ["b", "c"], 2.9), p("k3", ["d", "e"], 2.1), p("k4", ["f", "g"], 2.2), p("k5", ["h", "i"], 3)], ["k5"]);
  assert.deepEqual(out.map((x) => x.key), ["k2", "k4", "k3"]);
});

test("decide: only a pending proposal; dismiss remembers the key", () => {
  const u = { week: "2026-10-19", proposals: [{ key: "retract:x", action: "retract" as const, ids: ["x"], why: "stale" as const, score: 1, status: "pending" as const }], dismissed: [] };
  const d = decide(u, "retract:x", "dismissed");
  assert.ok(typeof d !== "string");
  assert.equal(d.proposals[0].status, "dismissed");
  assert.deepEqual(d.dismissed, ["retract:x"]);
  assert.match(decide(d, "retract:x", "accepted") as string, /already/);
  assert.match(decide(u, "nope", "accepted") as string, /gone/);
  const a = decide(u, "retract:x", "accepted");
  assert.ok(typeof a !== "string" && a.dismissed.length === 0);
});
