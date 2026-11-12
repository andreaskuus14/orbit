import { test } from "node:test";
import assert from "node:assert/strict";
import { admit, allowed, CAP, COALESCE_MS, DURATION, effectFor, MAX_BOOST, newPool, progress } from "../src/lib/living-events-pure.ts";

test("effectFor maps the four living events and ignores the rest", () => {
  assert.deepEqual(effectFor("agent.completed", "agents"), { kind: "comet", at: "agents" });
  assert.deepEqual(effectFor("agent.completed", ""), { kind: "comet", at: "agents" });
  assert.deepEqual(effectFor("clip.published", "studio"), { kind: "aurora", at: "studio" });
  assert.deepEqual(effectFor("deal.found", "markets"), { kind: "flare", at: "business" });
  assert.deepEqual(effectFor("night.end", "core"), { kind: "sunrise", at: "core" });
  for (const t of ["agent.failed", "agent.started", "core.completed", "night.start", "memory.saved"]) assert.equal(effectFor(t, "core"), null);
});

test("a burst of the same event coalesces into one brighter effect", () => {
  const pool = newPool();
  assert.equal(admit(pool, { kind: "flare", at: "business" }, 0), "added");
  for (let i = 1; i <= 5; i++) assert.equal(admit(pool, { kind: "flare", at: "business" }, i * 100), "coalesced");
  assert.equal(pool.filter((s) => s.kind).length, 1);
  assert.equal(pool.find((s) => s.kind)!.boost, MAX_BOOST);
  assert.equal(admit(pool, { kind: "flare", at: "business" }, COALESCE_MS + 1), "added"); // past the window: a fresh one
  assert.equal(admit(pool, { kind: "comet", at: "agents" }, COALESCE_MS + 2), "added"); // different effects never merge
});

test("the pool caps concurrent effects, drops overflow and frees finished slots", () => {
  const pool = newPool();
  for (let i = 0; i < CAP; i++) assert.equal(admit(pool, { kind: "comet", at: `p${i}` }, 0), "added");
  assert.equal(admit(pool, { kind: "comet", at: "late" }, 10), "dropped");
  assert.equal(pool.length, CAP);
  assert.equal(admit(pool, { kind: "comet", at: "late" }, DURATION.comet), "added"); // the first ones finished
});

test("progress runs 0..1 and frees the slot at the end", () => {
  const pool = newPool(1);
  admit(pool, { kind: "sunrise", at: "core" }, 1000);
  assert.equal(progress(pool[0], 1000), 0);
  assert.equal(progress(pool[0], 1000 + DURATION.sunrise / 2), 0.5);
  assert.equal(progress(pool[0], 1000 + DURATION.sunrise), -1);
  assert.equal(pool[0].kind, null);
});

test("allowed: nothing under reduced motion, a hidden tab, the lowest level or slow frames", () => {
  const ok = { reduced: false, hidden: false, level: 2, frameMs: 16.7 };
  assert.equal(allowed(ok), true);
  assert.equal(allowed({ ...ok, reduced: true }), false);
  assert.equal(allowed({ ...ok, hidden: true }), false);
  assert.equal(allowed({ ...ok, level: 0 }), false);
  assert.equal(allowed({ ...ok, frameMs: 30 }), false);
});
