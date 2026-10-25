import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, nextAngle, scorecard, wilson } from "../src/lib/outreach-score-pure.ts";
import type { Stage } from "../src/lib/business-pure.ts";

const many = (n: number, stage: Stage, template: string | null, kind = "bakery") => Array.from({ length: n }, () => ({ stage, template, kind }));

test("wilson gives a sane 95% range", () => {
  assert.deepEqual(wilson(0, 0), [0, 100]);
  assert.deepEqual(wilson(5, 10), [24, 76]);
  const [lo, hi] = wilson(0, 20);
  assert.equal(lo, 0); assert.ok(hi > 10 && hi < 20);
});

test("compare: small samples are 'few'; clear gaps are significant", () => {
  assert.equal(compare(3, 4, 0, 40), "few");
  assert.equal(compare(15, 20, 2, 20), "better");
  assert.equal(compare(2, 20, 15, 20), "worse");
  assert.equal(compare(5, 20, 6, 20), "same");
});

test("scorecard: sent = past To contact, lost counts, untagged only in segments", () => {
  const ps = [...many(3, "lead", "speed"), ...many(4, "replied", "speed"), ...many(2, "lost", "speed"), ...many(1, "paying", "free-pilot", " Salon "), ...many(2, "contacted", null, "")];
  const sc = scorecard(ps);
  assert.deepEqual(sc.angles.map((a) => [a.key, a.sent, a.replied, a.rate]), [["speed", 6, 4, 67], ["missed-leads", 0, 0, 0], ["free-pilot", 1, 1, 100]]);
  assert.deepEqual(sc.segments.map((s) => [s.key, s.sent]), [["bakery", 6], ["unknown", 2], ["salon", 1]]);
  assert.equal(sc.next?.angle, "missed-leads"); // explore the untried angle first
});

test("nextAngle: once all are tried, the highest upper bound wins", () => {
  const sc = scorecard([...many(20, "replied", "speed"), ...many(5, "contacted", "speed"), ...many(3, "replied", "missed-leads"), ...many(17, "lost", "missed-leads"), ...many(1, "replied", "free-pilot"), ...many(5, "lost", "free-pilot")]);
  assert.equal(sc.next?.angle, "speed");
  assert.match(sc.next!.why, /clearly ahead/);
  assert.equal(nextAngle([]), null);
});
