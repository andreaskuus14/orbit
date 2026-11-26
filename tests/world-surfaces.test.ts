import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { crystalCluster, fallPath, mountainHeight, sampleHeight } from "../src/lib/world-surfaces-pure.ts";
import { ASSETS } from "../src/lib/world-assets-pure.ts";

test("waterfall path starts at the lip, falls the full drop, and moves outwards", () => {
  const p = fallPath([1, 0, 5], 0.8, 4, 10);
  assert.equal(p.length, 11); assert.deepEqual(p[0], [1, 0, 5]);
  assert.ok(Math.abs(p[10][1] + 4) < 1e-9); assert.ok(p[10][2] > 5.8);
  for (let i = 1; i < p.length; i++) { assert.ok(p[i][1] < p[i - 1][1]); assert.ok(p[i][2] >= p[i - 1][2]); }
});

test("crystal clusters keep the main crystal and add smaller leaning ones", () => {
  const c = { at: [0, 1, 0] as [number, number, number], h: 2, color: "#fff" };
  const k = crystalCluster(c, 4, 3);
  assert.equal(k.length, 4); assert.equal(k[0], c);
  for (const s of k.slice(1)) { assert.ok(s.h < c.h); assert.ok(s.tilt && Math.hypot(...s.tilt) > 0.3); }
  assert.deepEqual(crystalCluster(c, 4, 3), k);
});

test("heightmap sampling and mountain height", () => {
  const d = [0, 1, 0, 1]; // 2 × 2
  assert.equal(sampleHeight(d, 2, 0, 0), 0); assert.ok(Math.abs(sampleHeight(d, 2, 0.5, 0) - 0.5) < 1e-9);
  assert.equal(mountainHeight(1, 0, 0.5), 0); assert.equal(mountainHeight(1, 1, 0.5), 0);
  assert.ok(mountainHeight(1, 0.5, 0.5) > mountainHeight(1, 0.5, 0.1));
  assert.ok(mountainHeight(0, 0.3, 0.5) >= 0);
});

test("every file under public/worlds is in the asset list (no stray bytes)", () => {
  const listed = new Set(Object.values(ASSETS).map((a) => a.file));
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
  for (const f of walk("public/worlds")) { const rel = f.slice("public/worlds/".length); if (rel !== "LICENSES.md") assert.ok(listed.has(rel), rel); }
});
