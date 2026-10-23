import { test } from "node:test";
import assert from "node:assert/strict";
import { daily, fmtRate, forecast, theilSen, type Sample } from "../src/lib/forecast-pure.ts";

const DAY = 86_400_000, T0 = Date.parse("2026-10-01T12:00:00Z");
const series = (vals: number[], start = T0): Sample[] => vals.map((value, i) => ({ at: new Date(start + i * DAY).toISOString(), value }));
const NOW = T0 + 9 * DAY; // the day of the 10th reading

test("daily: keeps the last reading per day, drops junk, sorts", () => {
  const d = daily([{ at: "2026-10-02T10:00:00Z", value: 5 }, { at: "2026-10-01T09:00:00Z", value: 1 }, { at: "2026-10-01T20:00:00Z", value: 2 }, { at: "bad", value: 9 }, { at: "2026-10-03T00:00:00Z", value: NaN }]);
  assert.deepEqual(d.map((p) => p.v), [2, 5]);
});

test("theilSen: ignores one wild outlier", () => {
  const pts = daily(series([0, 2, 4, 500, 8, 10, 12]));
  assert.equal(theilSen(pts), 2);
});

test("too few readings: not enough data", () => {
  for (const s of [[], series([1]), series([1, 2]), [{ at: "2026-10-01T01:00:00Z", value: 1 }, { at: "2026-10-01T05:00:00Z", value: 2 }, { at: "2026-10-01T09:00:00Z", value: 3 }]]) {
    const f = forecast(s, 100, "2026-12-31", NOW);
    assert.match(f.summary, /^Not enough data yet/);
    assert.equal(f.onTrack, false);
    assert.equal(f.projected, null);
  }
});

test("already reached (up and down goals)", () => {
  const up = forecast(series([900, 950, 1010]), 1000, "2026-12-31", NOW);
  assert.equal(up.onTrack, true);
  assert.match(up.summary, /Target reached: 1,010 of 1,000/);
  const down = forecast(series([80, 75, 69]), 70, undefined, NOW);
  assert.equal(down.onTrack, true);
  assert.match(down.summary, /Target reached/);
  assert.equal(forecast(series([5]), 5, undefined, NOW).onTrack, true); // even one reading
});

test("behind pace: honest sentence with needed vs current rate", () => {
  const vals = Array.from({ length: 10 }, (_, i) => 200 + i * 7);
  const f = forecast(series(vals), 1000, "2026-12-31", NOW);
  assert.equal(f.currentPerDay, 7);
  assert.equal(f.onTrack, false);
  assert.ok(f.projected!.p50 > 800 && f.projected!.p50 < 900, String(f.projected!.p50));
  assert.ok(f.neededPerDay! > 7);
  assert.match(f.summary, /^At your current pace you reach ~\d[\d,]* of 1,000 by Dec 31; you'd need \+[\d.]+\/day, you're doing \+7\/day\.$/);
  assert.ok(f.etaDate && f.etaDate > "2026-12-31");
});

test("on track: says so and gives an ETA before the deadline", () => {
  const f = forecast(series(Array.from({ length: 10 }, (_, i) => i * 20)), 1000, "2026-12-31", NOW);
  assert.equal(f.onTrack, true);
  assert.equal(f.etaDate, "2026-11-20"); // 180 at Oct 10, +20/day → 41 days
  assert.match(f.summary, /^On track: .*reach ~[\d,]+ of 1,000 by Dec 31 \(target around Nov 20\)/);
});

test("fan: ordered, widens with noise, deterministic", () => {
  const noisy = series([0, 15, 12, 30, 28, 50, 44, 70, 61, 90]);
  const a = forecast(noisy, 1000, "2026-12-31", NOW), b = forecast(noisy, 1000, "2026-12-31", NOW);
  assert.deepEqual(a, b);
  const p = a.projected!;
  assert.ok(p.p10 < p.p50 && p.p50 < p.p90, JSON.stringify(p));
  const smooth = forecast(series(Array.from({ length: 10 }, (_, i) => i * 10)), 1000, "2026-12-31", NOW).projected!;
  assert.equal(smooth.p10, smooth.p90); // no noise, no spread
});

test("down goal: p10 is the pessimistic (higher) side", () => {
  const f = forecast(series([100, 99, 97, 96, 95, 93, 92, 90]), 50, "2026-11-30", NOW);
  assert.ok(f.projected!.p10 >= f.projected!.p90);
  assert.ok(f.neededPerDay! < 0);
});

test("flat and negative trends", () => {
  const flat = forecast(series([50, 50, 50, 50]), 100, "2026-12-31", NOW);
  assert.equal(flat.onTrack, false);
  assert.equal(flat.etaDate, undefined);
  assert.match(flat.summary, /you're doing ±0\/day/);
  const neg = forecast(series([50, 48, 46, 44]), 100, undefined, NOW);
  assert.equal(neg.onTrack, false);
  assert.match(neg.summary, /No progress toward 100 lately \(-2\/day\)/);
});

test("no deadline: ETA sentence; no target: trend only; passed deadline", () => {
  const f = forecast(series([0, 10, 20, 30]), 100, undefined, NOW);
  assert.equal(f.projected, null);
  assert.equal(f.onTrack, true);
  assert.equal(f.etaDate, "2026-10-11");
  assert.match(f.summary, /At \+10\/day you reach 100 around Oct 11\./);
  assert.match(forecast(series([0, 10, 20]), undefined, "2026-12-31", NOW).summary, /Trend \+10\/day; set a target/);
  const past = forecast(series([0, 10, 20]), 100, "2026-10-05", NOW);
  assert.equal(past.onTrack, false);
  assert.match(past.summary, /deadline \(Oct 5\) has passed at 20 of 100/);
});

test("fmtRate rounds small and big numbers", () => {
  assert.equal(fmtRate(0.25), "+0.3/day");
  assert.equal(fmtRate(-1234.4), "-1,234/day");
  assert.equal(fmtRate(0), "±0/day");
});
