import { test } from "node:test";
import assert from "node:assert/strict";
import { dayArc, sunDirection, sunPosition } from "../src/lib/sun-pure.ts";

const LAT = 59.437, LON = 24.754;
const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);

// Published Tallinn 2025 tables, converted to UTC (Stjerneskinn uses standard EET = UTC+2):
// https://stjerneskinn.com/sunrise-world-tallinn-new.htm
// https://web-calendar.org/en/world/europe/estonia/tallinn?menu=sun&month=12&year=2025
// Solstice noon geometric elevation = 90 - latitude ± Earth's 23.44° axial tilt.
for (const ref of [
  { day: "2025-06-21", noon: "10:23", elevation: 54.00, rise: "01:03", set: "19:42" },
  { day: "2025-12-21", noon: "10:19", elevation: 7.12, rise: "07:18", set: "13:20" },
]) {
  test(`Tallinn ${ref.day}: solstice noon and published sunrise/sunset`, () => {
    const date = (time: string) => new Date(`${ref.day}T${time}:00Z`);
    const noon = sunPosition(LAT, LON, date(ref.noon));
    near(noon.elevationDeg, ref.elevation, 0.5);
    near(noon.azimuthDeg, 180, 0.5);
    const arc = dayArc(LAT, LON, date("00:00"));
    assert.ok(arc.sunrise && arc.sunset);
    near(arc.sunrise.getTime(), date(ref.rise).getTime(), 5 * 60_000);
    near(arc.sunset.getTime(), date(ref.set).getTime(), 5 * 60_000);
    assert.deepEqual(arc.positions[0].time, arc.sunrise);
    assert.deepEqual(arc.positions.at(-1)!.time, arc.sunset);
    near(arc.positions[0].elevationDeg, -0.833, 0.001);
    near(arc.positions.at(-1)!.elevationDeg, -0.833, 0.001);
    for (let i = 1; i < arc.positions.length; i++) {
      const delta = arc.positions[i].time.getTime() - arc.positions[i - 1].time.getTime();
      assert.ok(delta > 0 && delta <= 3_600_000);
      if (i < arc.positions.length - 1) assert.equal(delta, 3_600_000);
    }
    for (const sample of arc.positions) {
      const { x, y, z } = sunDirection(LAT, LON, sample.time);
      near(Math.hypot(x, y, z), 1, 1e-12);
      near(y, Math.sin(sample.elevationDeg * Math.PI / 180), 1e-12);
      assert.ok(sample.azimuthDeg >= 0 && sample.azimuthDeg < 360);
    }
    assert.ok(sunDirection(LAT, LON, date(ref.noon)).z > 0); // south = +z
    assert.ok(sunDirection(LAT, LON, arc.sunrise).x > 0); // east = +x
    assert.ok(sunDirection(LAT, LON, arc.sunset).x < 0); // west = -x
  });
}

test("polar day/night have null events and finite, ordered daylight samples", () => {
  const summer = dayArc(90, 0, new Date("2025-06-21"));
  assert.equal(summer.sunrise, null);
  assert.equal(summer.sunset, null);
  assert.equal(summer.positions.length, 25);
  assert.ok(summer.positions.every(p => Number.isFinite(p.azimuthDeg) && p.elevationDeg > 0));
  assert.deepEqual(dayArc(90, 0, new Date("2025-12-21")), { positions: [], sunrise: null, sunset: null });
});

test("UTC date selection ignores time of day and longitude can cross UTC midnight", () => {
  assert.deepEqual(dayArc(LAT, LON, new Date("2025-06-21T23:59:00Z")), dayArc(LAT, LON, new Date("2025-06-21")));
  const east = dayArc(0, 180, new Date("2025-03-20"));
  const west = dayArc(0, -180, new Date("2025-03-20"));
  assert.ok(east.sunrise && west.sunrise);
  assert.equal(east.sunrise.toISOString().slice(0, 10), "2025-03-19");
  assert.equal(west.sunrise.toISOString().slice(0, 10), "2025-03-20");
});

test("invalid coordinates and dates are rejected by every public function", () => {
  for (const fn of [sunPosition, sunDirection, dayArc]) {
    for (const [lat, lon, date] of [
      [91, 0, new Date()], [0, -181, new Date()], [NaN, 0, new Date()],
      [0, Infinity, new Date()], [0, 0, new Date(NaN)],
    ] as const) assert.throws(() => fn(lat, lon, date), RangeError);
  }
});
