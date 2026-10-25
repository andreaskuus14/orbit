import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, dist, formatLength, parseLength, pickK, pickSplat, readMeasureNote, withMeasures, type V3 } from "../src/lib/arch-measure-pure.ts";

// A scanned wall (z = 0) in unknown scan units: 1 m = 0.73 units, splats every ~1.5 cm with 1 cm noise, a faint floater in
// front and an opaque splat behind the wall.
const S = 0.73;
function wall() {
  const pos: number[] = [], op: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01 * S;
  for (let x = -1.5; x <= 1.5; x += 0.015) for (let y = 0; y <= 2.6; y += 0.015) { pos.push(x * S + rnd(), y * S + rnd(), rnd()); op.push(0.8); }
  pos.push(0, 1 * S, 1.5 * S); op.push(0.1); // floater, almost transparent
  pos.push(0, 1 * S, -0.5 * S); op.push(1); // behind the wall
  return { pos: new Float32Array(pos), op: new Float32Array(op) };
}
const cam: V3 = [0.3 * S, 1.4 * S, 4 * S];
const unit = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
/** Click at a real-world point (metres), off by `px` pixels on a 1000 px tall 45° view. */
function click(c: ReturnType<typeof wall>, x: number, y: number, px = 0) {
  const k = pickK(45, 1000, 10), off = (pickK(45, 1000, px) * 4 * S);
  return pickSplat(c.pos, c.op, cam, unit([x * S + off - cam[0], y * S + off - cam[1], -cam[2]]), k);
}

test("pick: lands on the wall under the cursor, not the floater or what's behind", () => {
  const c = wall();
  const p = click(c, 0, 1)!;
  assert.ok(Math.abs(p[2]) < 0.02 * S, `z=${p[2]}`);
  assert.ok(Math.abs(p[1] - S) < 0.02 * S);
  assert.equal(pickSplat(c.pos, c.op, cam, unit([0, 1, 0]), pickK(45, 1000)), null); // pointing at the sky
});

test("calibrate on a 2.0 m door, then a 1.2 m width measures within 3%", () => {
  const c = wall();
  const s = calibrate(dist(click(c, -1, 0, 3)!, click(c, -1, 2, -3)!), 2.0)!;
  const w = dist(click(c, 0.2, 0.5, 2)!, click(c, 1.4, 0.5, -2)!) * s;
  assert.ok(Math.abs(w - 1.2) / 1.2 < 0.03, `measured ${w}`);
  assert.equal(calibrate(0, 2), null);
  assert.equal(calibrate(1, -2), null);
});

test("lengths: parse and format", () => {
  assert.equal(parseLength("2"), 2);
  assert.equal(parseLength("2,05 m"), 2.05);
  assert.equal(parseLength("200 cm"), 2);
  assert.equal(parseLength("2000mm"), 2);
  assert.equal(parseLength("abc"), null);
  assert.equal(parseLength("0"), null);
  assert.equal(formatLength(0.853), "85 cm");
  assert.equal(formatLength(2.4321), "2.43 m");
  assert.equal(formatLength(12.34), "12.3 m");
});

test("note: measurements round-trip and replace the old lines", () => {
  const base = "Gaussian-splat scan imported into ARCH from a.ply (ply).\nvault: a.splat";
  const n = { scale: 1.37, ref: 2, list: [{ a: [0, 0, 0] as V3, b: [0, 1.4599, 0] as V3 }] };
  const t = withMeasures(base, n);
  assert.match(t, /^vault: a\.splat$/m);
  assert.match(t, /^measure: 2\.00 m \| 0 0 0 \| 0 1\.4599 0$/m);
  assert.deepEqual(readMeasureNote(t), n);
  const again = withMeasures(t, { scale: null, ref: null, list: [] });
  assert.equal(again, base);
  assert.deepEqual(readMeasureNote(base), { scale: null, ref: null, list: [] });
});
