import { test } from "node:test";
import assert from "node:assert/strict";
import { declutter, ringSize, sunAt } from "../src/lib/classic-map-pure.ts";

const S = { w: 1000, h: 800 };
const L = (id: string, x: number, y: number, rank: number, facing = 1) => ({ id, x, y, w: 100, h: 24, rank, facing });

test("declutter: overlapping labels move to another side, never overlap", () => {
  const out = declutter([L("a", 400, 400, 0), L("b", 402, 400, 1), L("c", 404, 402, 2)], [], S);
  const shown = out.filter((o) => o.show);
  assert.ok(shown.length >= 2);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const a = shown[i], b = shown[j];
    assert.ok(!(a.x < b.x + 100 && b.x < a.x + 100 && a.y < b.y + 24 && b.y < a.y + 24), `${a.id} overlaps ${b.id}`);
  }
  assert.equal(out[0].show, true); // the most important always wins
});

test("declutter: panels and the far side hide labels", () => {
  const out = declutter([L("a", 100, 100, 0), L("b", 500, 400, 1, -0.5)], [{ x: 0, y: 0, w: 300, h: 300 }], S);
  assert.deepEqual(out.map((o) => o.show), [false, false]);
});

test("ringSize grows with count and is capped", () => {
  assert.ok(ringSize(1, 10) < ringSize(9, 10));
  assert.equal(ringSize(50, 10), ringSize(10, 10));
});

test("sunAt: noon UTC puts the sun near lon 0", () => {
  assert.ok(Math.abs(sunAt(Date.UTC(2026, 5, 21, 12)).lon) < 0.01);
  assert.ok(sunAt(Date.UTC(2026, 5, 21, 12)).lat > 23);
});
