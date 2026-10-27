import { test } from "node:test";
import assert from "node:assert/strict";
import { julianDay, moonSky } from "../src/lib/moon-pure.ts";

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);

// Meeus, Astronomical Algorithms (2nd ed.), Example 47.a / 48.a: 1992 April 12, 0h TD (JDE 2448724.5).
// λ = 133.162655°, β = −3.229126° (before nutation); apparent α = 134.688470°, δ = 13.768368°; illuminated k = 0.6786.
const EX = new Date("1992-04-12T00:00:00Z");

test("Meeus example 47.a: ecliptic position", () => {
  near(julianDay(EX), 2448724.5, 1e-9);
  const m = moonSky(59.437, 24.754, EX);
  near(m.lonDeg, 133.162655, 0.05);
  near(m.latDeg, -3.229126, 0.02);
});

test("Meeus example 48.a: illuminated fraction, waxing gibbous", () => {
  const m = moonSky(59.437, 24.754, EX);
  near(m.illumination, 0.6786, 0.01);
  assert.equal(m.waxing, true);
});

test("horizontal coordinates: on the meridian the moon stands due south at 90° − |φ − δ|", () => {
  const gmst = 280.46061837 + 360.98564736629 * (2448724.5 - 2451545);
  const lon = ((134.688470 - gmst) % 360 + 540) % 360 - 180; // the longitude where it transits at that instant
  const m = moonSky(59.437, lon, EX);
  near(m.elevationDeg, 90 - (59.437 - 13.768368), 0.1);
  near(m.azimuthDeg, 180, 0.2);
});

// USNO, Phases of the Moon 2024 (https://aa.usno.navy.mil/data/MoonPhases): new 8 Apr 18:21, first quarter 15 Apr 19:13,
// full 23 Apr 23:49 UTC.
test("USNO 2024 phase times", () => {
  const at = (iso: string) => moonSky(59.437, 24.754, new Date(iso));
  near(at("2024-04-08T18:21:00Z").illumination, 0, 0.01);
  const q = at("2024-04-15T19:13:00Z");
  near(q.illumination, 0.5, 0.03);
  assert.equal(q.waxing, true);
  near(at("2024-04-23T23:49:00Z").illumination, 1, 0.01);
  assert.equal(at("2024-04-27T00:00:00Z").waxing, false);
});

test("rejects bad input", () => {
  assert.throws(() => moonSky(91, 0, EX), RangeError);
  assert.throws(() => moonSky(0, 0, new Date(NaN)), RangeError);
});
