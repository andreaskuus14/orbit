import { test } from "node:test";
import assert from "node:assert/strict";
import { hits, layoutChips, type ChipIn } from "../src/lib/world-chips-pure.ts";

const view = { w: 1440, h: 900 };
const chip = (id: string, x: number, y: number, prio = 1, on = true): ChipIn => ({ id, x, y, w: 120, h: 40, prio, on });
const box = (o: { x: number; y: number }) => ({ x: o.x, y: o.y, w: 120, h: 40 });

test("a lone chip sits above its anchor", () => {
  const r = layoutChips([chip("a", 400, 400)], view, []).get("a")!;
  assert.equal(r.side, "up");
  assert.ok(r.y + 40 <= 400 && Math.abs(r.x + 60 - 400) <= 1);
});

test("chips never overlap each other; the higher priority keeps the best spot", () => {
  const cs = [chip("lo", 400, 400, 1), chip("hi", 410, 405, 5), chip("mid", 405, 395, 3)];
  const r = layoutChips(cs, view, []);
  assert.equal(r.get("hi")!.side, "up");
  const shown = cs.map((c) => r.get(c.id)).filter((x): x is NonNullable<typeof x> => !!x).map(box);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) assert.ok(!hits(shown[i], shown[j]));
});

test("never covers the panel, never leaves the screen, hidden when there is no room", () => {
  const panel = { x: 1000, y: 0, w: 440, h: 900 };
  const r = layoutChips([chip("under", 1100, 400), chip("edge", 5, 5), chip("free", 600, 500), chip("back", 600, 500, 9, false)], view, [panel]);
  assert.equal(r.get("under"), null);
  assert.equal(r.get("back"), null);
  const e = r.get("edge");
  if (e) assert.ok(e.x >= 8 && e.y >= 8);
  const f = r.get("free")!;
  assert.ok(!hits(box(f), panel));
});

test("bad numbers are hidden, not thrown", () => {
  const r = layoutChips([chip("n", NaN, 3), { ...chip("z", 100, 100), w: 0 }], view, []);
  assert.equal(r.get("n"), null);
  assert.equal(r.get("z"), null);
});

test("a dimension label sits centred on its anchor; if that is taken it falls back to the usual spots", () => {
  const dim = layoutChips([{ ...chip("d", 400, 400), centre: true }], view, []).get("d")!;
  assert.equal(dim.x, 400 - 60); assert.equal(dim.y, 400 - 20);
  const two = layoutChips([{ ...chip("a", 400, 400), centre: true, prio: 9 }, { ...chip("b", 400, 400), centre: true, prio: 1 }], view, []);
  assert.ok(two.get("a")); assert.notDeepEqual(two.get("b"), two.get("a"));
});
