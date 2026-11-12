import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPLORE, kindStats, learnPlan, outcomes, rng, sampleBeta, whyLine, type Outcome, type TaskEvent } from "../src/lib/night-learn-pure.ts";
import { NIGHT_DEFAULTS, patchNightSettings, planNight, type NightKind, type PlanInput } from "../src/lib/night-pure.ts";

const DAY = 86_400_000, NOW = Date.parse("2026-10-26T06:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
// A synthetic history: `y` good and `n - y` bad results for a kind, one a night going back.
const hist = (kind: NightKind, y: number, n: number, from = 1): Outcome[] => Array.from({ length: n }, (_, i) => ({ kind, at: ago(from + i), ok: i < y }));

test("outcomes: only done results count as used; approval/failed/skipped say nothing", () => {
  const ev: TaskEvent[] = [
    { at: ago(20), kind: "deals", status: "done" },
    { at: ago(20), kind: "business", status: "approval" },
    { at: ago(5), kind: "clips", status: "failed" },
    { at: ago(5), kind: "personas", status: "skipped" },
  ];
  assert.deepEqual(outcomes(ev).map((o) => `${o.kind}:${o.ok}`), ["deals:true"]);
});

test("kindStats: recency-weighted Beta and raw last-10 counts", () => {
  const s = kindStats([...hist("business", 8, 9), ...hist("clips", 0, 3, 100), { kind: "niche", at: ago(200), ok: true }], NOW);
  const b = s.find((x) => x.kind === "business")!, c = s.find((x) => x.kind === "clips")!, n = s.find((x) => x.kind === "niche")!;
  assert.deepEqual([b.y, b.n], [8, 9]);
  assert.ok(b.a > 7 && b.a < 9 && b.b > 1.5 && b.b < 2);
  assert.ok(c.b > 1 && c.b < 1.2, "100-day-old rejections barely count"); // 0.5^(100/21) ≈ 0.04 each
  assert.deepEqual([n.a, n.b, n.n], [1, 1, 0], "older than MAX_AGE is forgotten");
  assert.equal(s.some((x) => x.kind === ("research" as NightKind)), false, "his own asks are never learned");
});

test("sampling is seeded, Beta means are right", () => {
  const a = rng("2026-10-26"), b = rng("2026-10-26");
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const r = rng("beta");
  const mean = Array.from({ length: 4000 }, () => sampleBeta(9, 2, r)).reduce((x, y) => x + y, 0) / 4000;
  assert.ok(Math.abs(mean - 9 / 11) < 0.02, `mean ${mean}`);
});

test("learnPlan: liked kinds lead, rejected kinds fade but still get an exploration share, new kinds always run, pins win", () => {
  const stats = kindStats([...hist("business", 9, 10), ...hist("clips", 0, 10)], NOW); // goal/niche/deals/personas: no history yet
  let clipsOut = 0, newOut = 0, bizFirst = 0;
  const nights = 600;
  for (let i = 0; i < nights; i++) {
    const l = learnPlan(stats, {}, `night-${i}`);
    if (l.drop.includes("clips")) clipsOut++;
    if (l.drop.some((k) => ["goal", "niche", "deals", "personas"].includes(k))) newOut++;
    if (l.drop.includes("business")) assert.fail("a kind he approves 9 of 10 never fades");
    if ((l.weight.business ?? 0) > (l.weight.clips ?? 0)) bizFirst++;
  }
  assert.equal(newOut, 0, "kinds without history are always tried");
  assert.ok(clipsOut / nights > 0.8 && clipsOut / nights <= 1 - EXPLORE + 0.04, `clips dropped ${clipsOut}/${nights}`); // floor: ~EXPLORE of nights still try it
  assert.ok(bizFirst / nights > 0.97);
  assert.deepEqual(learnPlan(stats, {}, "x"), learnPlan(stats, {}, "x"), "same night, same plan");
  const pinned = learnPlan(stats, { clips: "on", business: "off" }, "x");
  assert.equal(pinned.weight.clips, Infinity);
  assert.ok(pinned.drop.includes("business") && !pinned.drop.includes("clips"));
});

test("allocation: under a tight budget the high-value kind gets it; dropped kinds and autonomy-off never run", () => {
  const l = learnPlan(kindStats([...hist("business", 8, 9), ...hist("clips", 2, 9)], NOW), {}, "seed-a");
  const i: PlanInput = { tonight: [], goals: [], followups: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }], drafted: {}, nicheDue: false, handled: [], now: NOW, today: "2026-10-26",
    off: [...l.drop], boost: l.weight };
  const s = { ...NIGHT_DEFAULTS, maxCalls: 6 };
  const q = planNight(i, s, { calls: 0, ms: 0 }).queue.map((t) => t.kind);
  assert.deepEqual(q.slice(0, 3), ["hygiene", "business", "business"]);
  assert.equal(q.includes("clips"), false); // clips (6 calls) no longer fits after the drafts, or faded
  assert.deepEqual(planNight({ ...i, off: ["business"] }, s, { calls: 0, ms: 0 }).queue.map((t) => t.kind), ["hygiene", "clips"], "autonomy off beats the learning");
});

test("whyLine: the liked kind in tonight's queue and the faded one, in his numbers", () => {
  const l = learnPlan(kindStats([...hist("business", 8, 9), ...hist("niche", 1, 6)], NOW), {}, "s");
  assert.equal(whyLine({ ...l, drop: ["niche"] }, ["hygiene", "business"]), "More business drafts: you approved 8 of the last 9. Fewer niche scouts: you passed on 5 of the last 6");
  assert.equal(whyLine({ ...l, drop: [] }, ["hygiene"]), "", "nothing stands out when the liked kind isn't planned");
  assert.equal(whyLine({ ...l, drop: [] }, ["business"], { business: "on" }), "", "a pinned kind isn't the learning's doing");
});

test("night settings: pin kinds on/off, auto hands back", () => {
  const a = patchNightSettings({ pin: { clips: "off", business: "on" } }, NIGHT_DEFAULTS) as typeof NIGHT_DEFAULTS;
  assert.deepEqual(a.pin, { clips: "off", business: "on" });
  assert.deepEqual(NIGHT_DEFAULTS.pin, {}, "defaults untouched");
  assert.deepEqual((patchNightSettings({ pin: { clips: "auto" } }, a) as typeof a).pin, { business: "on" });
  assert.match(patchNightSettings({ pin: { rockets: "on" } }, a) as string, /pin/);
  assert.match(patchNightSettings({ pin: { clips: "maybe" } }, a) as string, /pin/);
});
