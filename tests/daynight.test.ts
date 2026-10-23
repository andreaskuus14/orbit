import { test } from "node:test";
import assert from "node:assert/strict";
import { dayNight, SUNRISE_ELEVATION, type DayNight } from "../src/lib/daynight-pure.ts";
import { sunPosition } from "../src/lib/sun-pure.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const valid = (s: DayNight) => {
  assert.ok(Number.isFinite(s.azimuthDeg) && s.azimuthDeg >= 0 && s.azimuthDeg < 360);
  assert.ok(Number.isFinite(s.elevationDeg) && Math.abs(s.elevationDeg) <= 90);
  assert.ok(Number.isFinite(s.lightFactor) && s.lightFactor >= 0 && s.lightFactor <= 1);
  Object.values(s.palette).forEach((c) => assert.match(c, /^#[0-9a-f]{6}$/));
};
const paletteNear = (a: DayNight, b: DayNight, tolerance = 1) => {
  for (const k of ["sky", "rim", "ambient"] as const) for (const i of [1, 3, 5])
    near(parseInt(a.palette[k].slice(i, i + 2), 16), parseInt(b.palette[k].slice(i, i + 2), 16), tolerance);
};
// Find an actual phase transition using this module, independent of dayArc's event-search implementation.
function crossing(day: string, rising: boolean, elevation = SUNRISE_ELEVATION): number {
  const start = Date.parse(`${day}T00:00:00Z`);
  for (let t = start + 60_000; t <= start + 86_400_000; t += 60_000) {
    const before = dayNight(new Date(t - 60_000)).elevationDeg, after = dayNight(new Date(t)).elevationDeg;
    if (rising ? before < elevation && after >= elevation : before >= elevation && after < elevation) {
      let lo = t - 60_000, hi = t;
      while (hi - lo > 10) {
        const mid = (lo + hi) / 2, below = dayNight(new Date(mid)).elevationDeg < elevation;
        if (below === rising) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
  }
  throw new Error(`No crossing on ${day}`);
}

// Published Tallinn 2025 local times, converted to UTC (June UTC+3, December UTC+2):
// https://www.timeanddate.de/sonne/estland/tallinn?month=6&year=2025
// https://www.timeanddate.de/sonne/estland/tallinn?month=12&year=2025
for (const ref of [
  { day: "2025-06-21", rise: "01:03", set: "19:42", noon: "10:23", elevation: 54 },
  { day: "2025-12-21", rise: "07:17", set: "13:20", noon: "10:19", elevation: 7.12 },
]) test(`Tallinn ${ref.day}: sunrise/set within 3 minutes, solstice elevation and phases`, () => {
  for (const rising of [true, false]) {
    const at = crossing(ref.day, rising), expected = Date.parse(`${ref.day}T${rising ? ref.rise : ref.set}:00Z`);
    near(at, expected, 3 * 60_000);
    assert.equal(dayNight(new Date(at - 1000)).phase, rising ? "dawn" : "day");
    assert.equal(dayNight(new Date(at + 1000)).phase, rising ? "day" : "dusk");
    paletteNear(dayNight(new Date(at - 1000)), dayNight(new Date(at + 1000)));
  }
  const noon = dayNight(new Date(`${ref.day}T${ref.noon}:00Z`));
  valid(noon); assert.equal(noon.phase, "day"); near(noon.elevationDeg, ref.elevation, 0.5);
  assert.equal(noon.timeZone, "Europe/Tallinn"); assert.equal(noon.localDate, ref.day);
});

test("light and palette remain smooth through civil twilight and palette anchors", () => {
  for (const elevation of [-12, -6, -2, SUNRISE_ELEVATION, 20]) for (const rising of [true, false]) {
    const at = crossing("2025-03-20", rising, elevation), before = dayNight(new Date(at - 10)), after = dayNight(new Date(at + 10));
    near(before.lightFactor, after.lightFactor, 0.00001); paletteNear(before, after);
  }
  for (const day of ["2025-06-21", "2025-12-21"]) {
    const start = Date.parse(`${day}T00:00:00Z`);
    let previous = dayNight(new Date(start));
    for (let i = 1; i <= 1440; i++) {
      const next = dayNight(new Date(start + i * 60_000)); valid(next);
      near(previous.lightFactor, next.lightFactor, 0.015); paletteNear(previous, next, 4);
      previous = next;
    }
  }
});

test("polar day/night and both hemispheres have finite stable lighting", () => {
  for (const latitude of [90, 89.9, 80, 0, -80, -90]) for (const day of ["2025-06-21", "2025-12-21"]) for (let hour = 0; hour < 24; hour++) {
    const s = dayNight(new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`), { latitude, longitude: 0 }); valid(s);
    if (Math.abs(latitude) === 90) {
      const summer = (latitude > 0) === (day === "2025-06-21");
      assert.equal(s.phase, summer ? "day" : "night"); assert.equal(s.lightFactor, summer ? 1 : 0);
    }
  }
});

test("timezone labels respect DST while physical lighting uses only the instant", () => {
  for (const t of ["2025-03-30T01:00:00Z", "2025-10-26T01:00:00Z"]) {
    const ms = Date.parse(t), a = dayNight(new Date(ms - 1000)), b = dayNight(new Date(ms + 1000));
    near(a.lightFactor, b.lightFactor, 0.001); paletteNear(a, b); assert.equal(a.localDate, b.localDate);
  }
  assert.deepEqual(dayNight(new Date("2025-03-30T04:00:00+03:00")), dayNight(new Date("2025-03-30T01:00:00Z")));
  const instant = new Date("2025-03-30T23:00:00Z"), tallinn = dayNight(instant), utc = dayNight(instant, { timeZone: "UTC" });
  assert.equal(tallinn.localDate, "2025-03-31"); assert.equal(utc.localDate, "2025-03-30");
  assert.equal(tallinn.lightFactor, utc.lightFactor); assert.deepEqual(tallinn.palette, utc.palette);
  const sun = sunPosition(59.437, 24.754, instant); assert.equal(tallinn.elevationDeg, sun.elevationDeg); assert.equal(tallinn.azimuthDeg, sun.azimuthDeg);
});

test("invalid dates/coordinates fall back to night; invalid zones use Tallinn", () => {
  const bad = dayNight(new Date(NaN)); valid(bad); assert.equal(bad.phase, "night"); assert.equal(bad.lightFactor, 0); assert.equal(bad.localDate, null);
  for (const options of [{ latitude: NaN }, { longitude: Infinity }, { latitude: 91 }, { longitude: -181 }]) {
    const s = dayNight(new Date("2025-06-21T10:23:00Z"), options); valid(s); assert.equal(s.phase, "night"); assert.equal(s.lightFactor, 0);
  }
  const date = new Date("2025-06-21T10:23:00Z");
  assert.deepEqual(dayNight(date, { latitude: undefined, longitude: undefined }), dayNight(date));
  assert.deepEqual(dayNight(date, { timeZone: "invalid/zone" }), dayNight(date));
  bad.palette.sky = "#ffffff"; assert.equal(dayNight(new Date(NaN)).palette.sky, "#02030b");
});

test("valid Date extremes, dateline longitudes and near-midnight azimuth stay finite", () => {
  for (const ms of [-8.64e15, 8.64e15, -1, 0]) for (const longitude of [-180, 180]) valid(dayNight(new Date(ms), { longitude }));
  const instant = new Date("2025-01-01T00:00:00Z"), original = instant.getTime(), options = Object.freeze({ latitude: 0, longitude: 0 });
  assert.deepEqual(dayNight(instant, options), dayNight(instant, options)); assert.equal(instant.getTime(), original);
  const before = dayNight(new Date("2025-06-21T22:22:59Z")), after = dayNight(new Date("2025-06-21T22:23:01Z"));
  const angle = Math.abs(before.azimuthDeg - after.azimuthDeg); assert.ok(Math.min(angle, 360 - angle) < 0.02);
});
