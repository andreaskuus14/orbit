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

test("BUS08 conversion: decided steps with sample sizes, windows, lost reasons, stalls and a grounded next experiment", async () => {
  const { conversion, lostReasons, nextExperiment, reached, stalled, windowed } = await import("../src/lib/outreach-score-pure.ts");
  const NOW = Date.parse("2026-10-30T12:00:00Z"), ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
  let n = 0;
  const p = (stage: Stage, o: { days?: number; events?: { at: string; kind: string; text?: string }[]; lost?: string; template?: string } = {}) =>
    ({ id: `p${n++}`, name: `B${n}`, kind: "bakery", stage, template: o.template ?? "speed", updated_at: ago(o.days ?? 1), crm: { events: o.events ?? [], ...(o.lost && { lost: { reason: o.lost } }) }, touch: null });
  const lostAfterReply = (reason?: string) => p("lost", { events: [{ at: ago(5), kind: "stage", text: "replied" }, { at: ago(4), kind: "stage", text: "lost" }], lost: reason });
  const ps = [
    ...Array.from({ length: 6 }, () => p("replied", { days: 2 })), // open replies
    ...Array.from({ length: 4 }, () => lostAfterReply("price")), lostAfterReply(),
    p("pilot", { days: 3 }), p("paying"), p("contacted", { days: 20 }), p("contacted", { days: 1 }), p("lead"),
    p("contacted", { days: 200, events: [{ at: ago(200), kind: "sent" }] }),
  ];
  assert.equal(reached(ps[6]), 2); // lost, but it had replied
  assert.equal(reached(p("lost")), 1); // lost counts as sent
  const steps = conversion(ps, NOW);
  // sent → replied: 13 reached replied of 15 decided (the fresh contacted one is still open)
  assert.deepEqual(steps.map((s) => [s.from, s.n, s.k, s.open]), [["contacted", 15, 13, 1], ["replied", 7, 2, 6], ["pilot", 1, 1, 1]]);
  assert.deepEqual(stalled(ps, NOW).map((s) => [s.stage, s.days]), [["contacted", 200], ["contacted", 20]]);
  assert.deepEqual(lostReasons(ps).map((l) => [l.reason, l.n, l.after.replied]), [["price", 4, 4], ["unknown", 1, 1]]);
  const e = nextExperiment(ps, NOW)!;
  assert.equal(e.kind, "price"); assert.equal(e.step!.from, "replied"); assert.equal(e.reasonN, 4);
  assert.equal(windowed(ps, 30, NOW).length, ps.length - 2); // the lead (never sent) and the 200-day-old send fall out
  const few = nextExperiment([p("contacted", { days: 1 }), p("replied")], NOW)!;
  assert.equal(few.kind, "few"); assert.ok(few.angle);
});
