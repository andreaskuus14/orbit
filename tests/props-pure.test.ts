import { test } from "node:test";
import assert from "node:assert/strict";
import { PROPS, propCount, scatter } from "../src/lib/props-pure.ts";
import { towns } from "../src/lib/landmarks-pure.ts";

test("scatter: deterministic, themed, off the poles, clear of the landmark towns", () => {
  const p = scatter("life", 12, 700);
  assert.equal(p.length, 700);
  assert.deepEqual(scatter("life", 12, 700), p);
  const kinds = new Set(p.map((x) => x.kind));
  assert.deepEqual([...kinds].sort(), ["bush", "conifer", "tree"]);
  const t = [towns(12, 3, 4), towns(12, 5, 6), towns(12, 7, 7)].flat().map((b) => b.d);
  for (const x of p) {
    assert.ok(Math.abs(Math.hypot(...x.d) - 1) < 1e-9 && Math.abs(x.d[1]) <= Math.sin((70 * Math.PI) / 180) + 1e-9);
    assert.ok(t.every((d) => d[0] * x.d[0] + d[1] * x.d[1] + d[2] * x.d[2] <= Math.cos((6 * Math.PI) / 180)), "not inside a town");
    assert.ok(x.scale >= 0.5 && x.scale <= 1.5);
  }
});

test("gas giants and unknown worlds get nothing; counts grow with quality", () => {
  assert.deepEqual(scatter("analytics", 3, 500), []);
  assert.deepEqual(scatter("arch", 3, 500), []);
  assert.ok(propCount(0) < propCount(1) && propCount(1) < propCount(2));
  for (const k of Object.values(PROPS)) assert.ok(Math.abs(k.reduce((s, [, w]) => s + w, 0) - 1) < 1e-9, "shares add up to 1");
});
