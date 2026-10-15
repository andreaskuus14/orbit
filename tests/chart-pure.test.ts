import { test } from "node:test";
import assert from "node:assert/strict";
import { areaPath, compact, delta, linePath, mmss, niceTicks, toPoints, type Box } from "../src/lib/chart-pure.ts";

const BOX: Box = { x0: 40, x1: 600, y0: 10, y1: 200 };
const ys = (path: string) => [...path.matchAll(/(-?[\d.e+]+|NaN|Infinity),(-?[\d.e+]+|NaN|Infinity)/g)].map((m) => Number(m[2]));

test("niceTicks: 0-based, nice steps, covers max, never negative", () => {
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(NaN), [0, 1]);
  assert.deepEqual(niceTicks(-5), [0, 1]);
  assert.deepEqual(niceTicks(4), [0, 2, 4]);
  assert.deepEqual(niceTicks(870), [0, 500, 1000]);
  assert.deepEqual(niceTicks(1200), [0, 500, 1000, 1500]);
  assert.deepEqual(niceTicks(0.9), [0, 0.5, 1]);
  assert.deepEqual(niceTicks(1, 3, true), [0, 1]);
  assert.deepEqual(niceTicks(7, 3, true), [0, 5, 10]);
  for (const m of [1, 3, 17, 99, 101, 1234, 9e6, 3.3e12]) {
    const t = niceTicks(m);
    assert.ok(t.length >= 2 && t.length <= 4, `${m}: ${t}`);
    assert.ok(t[t.length - 1] >= m && t[0] === 0 && t.every((x) => x >= 0 && Number.isFinite(x)));
  }
});

test("path builder: every y is finite and inside the box for any input", () => {
  const cases: number[][] = [
    [], [5], [0], [0, 0, 0], [0, 0, 1000, 0, 0], [1e15, 0, 1e15], [NaN, 3, Infinity, -Infinity, -7, 2],
    [10, 0, 0, 0, 10], Array.from({ length: 365 }, (_, i) => (i % 7 === 0 ? 900 : 1)),
  ];
  for (const vals of cases) for (const max of [Math.max(0, ...vals.filter(Number.isFinite)), 0, NaN, 1]) {
    const pts = toPoints(vals, BOX, max);
    for (const p of [linePath(pts, BOX), areaPath(pts, BOX)]) {
      assert.ok(!/NaN|Infinity/.test(p), `${vals} → ${p}`);
      for (const y of ys(p)) assert.ok(y >= BOX.y0 && y <= BOX.y1, `y=${y} outside for ${vals}`);
    }
  }
  assert.equal(linePath([], BOX), "");
  assert.equal(areaPath([], BOX), "");
});

test("monotone curve does not dip below a zero baseline between a spike and zeros", () => {
  const pts = toPoints([0, 0, 50, 0, 0, 3], BOX, 50);
  for (const y of ys(linePath(pts, BOX))) assert.ok(y <= BOX.y1);
  // flat zero run stays exactly on the baseline (no smoothing wobble)
  const flat = linePath(toPoints([0, 0, 0, 0], BOX, 10), BOX);
  assert.ok(ys(flat).every((y) => y === BOX.y1));
});

test("single point draws a flat line across the box", () => {
  const p = linePath(toPoints([5], BOX, 10), BOX);
  assert.equal(p, "M40,105H600");
});

test("delta: arrows + text, prev=0 handled", () => {
  assert.deepEqual(delta(120, 100), { dir: 1, text: "▲ 20%" });
  assert.deepEqual(delta(95, 100), { dir: -1, text: "▼ 5.0%" });
  assert.deepEqual(delta(5, 0), { dir: 1, text: "new" });
  assert.deepEqual(delta(0, 0), { dir: 0, text: "—" });
  assert.deepEqual(delta(-2, 0), { dir: -1, text: "▼ from 0" });
  assert.deepEqual(delta(100, 100), { dir: 0, text: "0%" });
  assert.deepEqual(delta(2, -2), { dir: 1, text: "▲ 200%" }, "negative prev (net subs) still reads as up");
  assert.deepEqual(delta(NaN, NaN), { dir: 0, text: "—" });
});

test("mmss and compact", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(65), "1:05");
  assert.equal(mmss(59.6), "1:00");
  assert.equal(mmss(3725), "1:02:05");
  assert.equal(mmss(NaN), "0:00");
  assert.equal(mmss(-3), "0:00");
  assert.equal(compact(1284), "1.3K");
  assert.equal(compact(NaN), "0");
});
