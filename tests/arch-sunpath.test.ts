import { test } from "node:test";
import assert from "node:assert/strict";
import { domeArc, domeArcs, domePoint, hourSegments } from "../src/lib/arch-sunpath-pure.ts";
import { dayArc, sunDirection } from "../src/lib/sun-pure.ts";

const LAT = 59.437, LON = 24.754, R = 20;
const elev = (p: number[]) => Math.asin(p[1] / R) * 180 / Math.PI;

test("winter-solstice noon in Tallinn is about 7° high (90 - 59.4 - 23.4)", () => {
  const winter = domeArcs(LAT, LON, 2025, R).find((a) => a.key === "winter")!.points;
  const top = Math.max(...winter.map(elev));
  assert.ok(Math.abs(top - 7.1) < 0.5, `${top}`);
  const summer = domeArcs(LAT, LON, 2025, R).find((a) => a.key === "summer")!.points;
  assert.ok(Math.abs(Math.max(...summer.map(elev)) - 54) < 0.5);
});

test("dome points match sunDirection and contain every dayArc sample", () => {
  const day = new Date("2025-03-20T12:00Z"), arc = dayArc(LAT, LON, day), pts = domeArc(LAT, LON, day, R);
  for (const s of arc.positions) {
    const d = sunDirection(LAT, LON, s.time), want = [d.x * R, d.y * R, d.z * R];
    assert.ok(pts.some((p) => p.every((v, i) => Math.abs(v - want[i]) < 1e-9)), s.time.toISOString());
  }
  assert.deepEqual(pts[0], domePoint(arc.positions[0], R));
  assert.deepEqual(pts.at(-1), domePoint(arc.positions.at(-1)!, R));
  for (const p of pts) assert.ok(Math.abs(Math.hypot(...p) - R) < 1e-9);
});

test("equinox noon is due south; polar night has no winter arc; hour lines above ground in pairs", () => {
  const eq = domeArcs(LAT, LON, 2025, R)[1].points, noon = eq.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.ok(noon[2] > 0 && Math.abs(noon[0]) < 1); // +z = south; 15-min samples sit within ~2° of the meridian
  assert.equal(domeArcs(78, 15, 2025, R)[2].points.length, 0);
  const segs = hourSegments(LAT, LON, 2025, R);
  assert.ok(segs.length > 0 && segs.length % 2 === 0);
  for (const p of segs) assert.ok(p[1] >= 0);
});
