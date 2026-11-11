import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { hasLandmark, LANDMARKS, spots, towns } from "../src/lib/landmarks-pure.ts";

test("spots: deterministic, on the unit sphere, off the poles, spread apart", () => {
  const a = spots(3, 4), b = spots(3, 4);
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  for (const d of a) { assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9); assert.ok(Math.abs(d[1]) <= Math.sin((55 * Math.PI) / 180) + 1e-9); }
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(a[i][0] * a[j][0] + a[i][1] * a[j][1] + a[i][2] * a[j][2] < Math.cos((38 * Math.PI) / 180));
  assert.notDeepEqual(spots(4, 4), a, "each world its own layout");
});

test("every landmark world ships its model, small enough for the galaxy", () => {
  for (const id of LANDMARKS) {
    const f = `public/planets/landmarks/${id}.glb`;
    assert.ok(existsSync(f), f);
    assert.ok(statSync(f).size < 700_000, `${f} stays under 700 KB`);
  }
  assert.ok(hasLandmark("vault") && !hasLandmark("arch"));
});

test("towns: many buildings in clusters, one centrepiece per town, all on the sphere", () => {
  const b = towns(5);
  assert.equal(b.length, 30);
  assert.deepEqual(towns(5), b, "deterministic");
  for (const x of b) { assert.ok(Math.abs(Math.hypot(...x.d) - 1) < 1e-9); assert.ok(x.scale > 0 && x.scale <= 1); }
  assert.equal(b.filter((x) => x.scale === 1).length, 5, "one big building per town");
  const c = b[0].d, near = b.slice(1, 6).every((x) => x.d[0] * c[0] + x.d[1] * c[1] + x.d[2] * c[2] > Math.cos((10 * Math.PI) / 180));
  assert.ok(near, "a town's buildings stay close to its centre");
});
