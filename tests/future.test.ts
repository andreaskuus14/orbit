import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFuture, fit, futureScript, futureWindow, goalPace, hasData, oneThing, pace, project, streak, weekly, type FutureIn } from "../src/lib/future-pure.ts";

const NOW = Date.parse("2026-10-26T18:00:00Z"), DAY = 86_400_000;
/** One event per entry in `perWeek` (oldest week first), mid-week. */
const evts = (perWeek: number[]) => perWeek.flatMap((n, i) => Array.from({ length: n }, (_, j) => new Date(NOW - (perWeek.length - 1 - i) * 7 * DAY - (1 + j * 0.3) * DAY).toISOString()));

export const SAMPLE: FutureIn = {
  now: NOW,
  events: {
    shorts: evts([3, 4, 5, 4, 5, 4, 3, 4, 4, 3, 4, 3]),
    roblox: evts([3, 3, 4, 3, 2, 2, 1, 1, 1, 1, 0, 1]),
    business: evts([0, 0, 2, 0, 1, 0, 0, 3, 0, 0, 2, 0]),
    arch: evts([2, 2, 1, 2, 2, 3, 2, 2, 3, 2, 2, 3]),
  },
  goals: [{ title: "1000 YouTube subscribers", target: 1000, samples: [0, 14, 28, 42, 56].map((d, i) => ({ at: new Date(NOW - (56 - d) * DAY).toISOString(), value: 380 + i * 30 })) }],
  lessons: ["He usually approves clips with a number in the first second"],
};

test("weekly buckets: oldest first, last window ends now, old and future events dropped", () => {
  assert.deepEqual(weekly(evts([1, 0, 2]), NOW, 3), [1, 0, 2]);
  assert.deepEqual(weekly([new Date(NOW + DAY).toISOString(), new Date(NOW - 30 * 7 * DAY).toISOString()], NOW, 3), [0, 0, 0]);
});

test("fit: exact line", () => {
  const f = fit([1, 3, 5, 7]);
  assert.equal(f.slope, 2); assert.equal(f.intercept, 1);
  assert.equal(fit([4]).slope, 0);
});

test("pace: last 4 weeks carried for 52, range contains it, steady data is surer than noisy", () => {
  const steady = pace("arch", [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  assert.equal(steady.year, 104); assert.equal(steady.low, 104); assert.equal(steady.high, 104); assert.equal(steady.confidence, "high");
  const noisy = pace("business", [0, 0, 2, 0, 1, 0, 0, 3, 0, 0, 2, 0]);
  assert.ok(noisy.low <= noisy.year && noisy.year <= noisy.high && noisy.low >= 0);
  assert.equal(noisy.confidence, "low");
  const down = pace("roblox", [3, 3, 4, 3, 2, 2, 1, 1, 1, 1, 0, 1]);
  assert.equal(down.trend, "down"); assert.equal(down.best, 3.25); assert.equal(down.rate, 0.75);
});

test("the one thing: the biggest slip from his own best; else the most on-and-off area; else none", () => {
  const p = project(SAMPLE);
  assert.equal(p.fix?.area, "roblox"); assert.equal(p.fix?.why, "slipped"); assert.equal(p.fix?.to, 3.25);
  assert.ok(p.fix!.gain > 0);
  const even = oneThing([pace("business", [0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2]), pace("arch", [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])]);
  assert.equal(even?.area, "business"); assert.equal(even?.why, "uneven"); assert.equal(even?.to, 2);
  assert.equal(oneThing([pace("arch", [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])]), null);
});

test("goal pace: trend line to target; flat goal has no ETA; too-short history is skipped", () => {
  const g = goalPace(SAMPLE.goals[0], NOW)!;
  assert.equal(g.perWeek, 15); assert.equal(g.now, 500); assert.equal(g.etaWeeks, 34); assert.equal(g.done, false);
  assert.equal(goalPace({ title: "x", target: 10, samples: [{ at: new Date(NOW - 20 * DAY).toISOString(), value: 3 }, { at: new Date(NOW).toISOString(), value: 3 }] }, NOW)?.etaWeeks, null);
  assert.equal(goalPace({ title: "x", target: 10, samples: [{ at: new Date(NOW - DAY).toISOString(), value: 3 }, { at: new Date(NOW).toISOString(), value: 4 }] }, NOW), null);
  assert.equal(goalPace({ title: "x", samples: [] }, NOW), null);
});

test("streak: current run and longest run of active weeks", () => {
  assert.deepEqual(streak([pace("arch", [1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1])]), { now: 2, longest: 4 });
});

test("script: framed as a projection, both parts, ends on a question, and every number is computed", () => {
  const p = project(SAMPLE), s = futureScript(p);
  console.log(`\n--- example future-self call (synthetic data) ---\n${s}\n`);
  assert.match(s, /projection .*not a promise/);
  assert.match(s, /If you keep this pace/); assert.match(s, /The one thing: Roblox sessions/);
  assert.match(s, /\?$/);
  assert.equal(cleanFuture(s, p, s), s); // the draft passes its own check
  const empty = project({ now: NOW, events: { shorts: [], roblox: [], business: [], arch: [] }, goals: [], lessons: [] });
  assert.equal(hasData(empty), false);
  assert.match(futureScript(empty), /can't see much/);
});

test("cleanFuture: invented numbers, no projection framing, or no closing question fall back to the draft", () => {
  const p = project(SAMPLE), draft = futureScript(p);
  const good = `Hey, it's me, you in a year. This is a projection, not a promise. Keep this pace and it's about ${p.paces[0].year} Shorts. The one thing is Roblox: you did 3.3 a week at your best. Get back there and it's about ${p.fix!.year} sessions. What's in the way?`;
  assert.equal(cleanFuture(good, p, draft), good);
  assert.equal(cleanFuture(good.replace(String(p.fix!.year), "9999"), p, draft), draft);
  assert.equal(cleanFuture(good.replace("This is a projection, not a promise. ", ""), p, draft), draft);
  assert.equal(cleanFuture(good.replace(/\?$/, "."), p, draft), draft);
  assert.equal(cleanFuture("**" + good, p, draft), draft);
});

test("monthly window: evenings 18-21, once per month", () => {
  assert.equal(futureWindow("", "2026-10-26", 19), true);
  assert.equal(futureWindow("2026-10", "2026-10-26", 19), false);
  assert.equal(futureWindow("2026-09", "2026-10-26", 17), false);
  assert.equal(futureWindow("2026-09", "2026-10-26", 21), false);
});
