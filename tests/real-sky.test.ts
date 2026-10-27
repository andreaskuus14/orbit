import { test } from "node:test";
import assert from "node:assert/strict";
import { darkHours, realSky, SKY_BG } from "../src/lib/real-sky-pure.ts";

const lum = (hex: string) => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0);
const warmth = (hex: string) => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(5, 7), 16);

test("Tallinn: deep at midnight, lifted at noon, warm haze at dusk", () => {
  const night = realSky(new Date("2025-12-21T22:00:00Z")), noon = realSky(new Date("2025-06-21T10:23:00Z"));
  const dusk = realSky(new Date("2025-12-21T13:40:00Z")); // sun ~3° below after the 13:20 UTC sunset
  assert.equal(night.bg, SKY_BG);
  assert.equal(night.sun.intensity, 0);
  assert.ok(lum(noon.bg) > lum(night.bg));
  assert.ok(noon.sun.intensity > 0.15 && noon.sun.dir.y > 0.75); // 54° up
  assert.ok(warmth(dusk.fog) > 10, dusk.fog);
  assert.ok(warmth(dusk.fog) > warmth(night.fog));
});

test("sun direction: due south (+z, since −z is north) at solar noon, unit length", () => {
  const s = realSky(new Date("2025-06-21T10:23:00Z")).sun.dir;
  assert.ok(s.z > 0.5 && Math.abs(s.x) < 0.02);
  assert.ok(Math.abs(Math.hypot(s.x, s.y, s.z) - 1) < 1e-9);
});

test("seasonal stars: Tallinn white nights thin them, winter fills them, never above 1", () => {
  assert.ok(darkHours(59.437, 24.754, new Date("2025-06-21T12:00:00Z")) <= 2);
  assert.ok(darkHours(59.437, 24.754, new Date("2025-12-21T12:00:00Z")) >= 14);
  const summer = realSky(new Date("2025-06-21T12:00:00Z")).stars, winter = realSky(new Date("2025-12-21T12:00:00Z")).stars;
  assert.ok(summer < 0.6 && winter > 0.9 && winter <= 1);
  assert.equal(darkHours(-85, 0, new Date("2025-06-21T12:00:00Z")), 24); // polar night
});

test("moon: full and up, new and dim; bad coordinates fall back to Tallinn", () => {
  const full = realSky(new Date("2024-04-23T23:49:00Z"));
  assert.ok(full.moon.illumination > 0.99);
  assert.ok(realSky(new Date("2024-04-08T18:21:00Z")).moon.illumination < 0.01);
  assert.deepEqual(realSky(new Date("2024-04-23T23:49:00Z"), NaN, 999), full);
});
