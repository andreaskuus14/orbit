import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRadius, microStage, rankCount, structureBudget } from "../src/components/alien/micro-pure.ts";

test("micro: nothing at the overview, everything close, budgets grow with quality", () => {
  const far = microStage(0.03, 3), mid = microStage(0.17, 3), close = microStage(0.74, 3);
  assert.equal(far.show, 0); assert.equal(far.city, 0); assert.equal(far.orbit, 0);
  assert.ok(mid.show > 0 && mid.show < 0.2 && mid.orbit === 1); // an opened world: only the biggest structures
  assert.ok(close.show > 1); assert.equal(close.traffic, 1);
  assert.equal(microStage(0.74, 0).show, 0); assert.ok(microStage(0.74, 1).show < 1); assert.equal(microStage(0.74, 1).traffic, 0);
  assert.equal(microStage(NaN, 3).show, 0);
  const out = microStage(0.5, 3); assert.equal(microStage(1, 3, out), out); assert.equal(out.traffic, 1); // reuses `out`
  assert.equal(structureBudget(0), 0);
  assert.ok(structureBudget(1) < structureBudget(2) && structureBudget(2) <= structureBudget(9));
});

test("micro: rank count is a binary search over sorted ranks", () => {
  const r = [0.1, 0.2, 0.2, 0.5, 0.9];
  assert.equal(rankCount(r, 0), 0); assert.equal(rankCount(r, 0.2), 1); assert.equal(rankCount(r, 0.3), 3); assert.equal(rankCount(r, 2), 5);
});

test("micro: lens radius is finite and clamped", () => {
  assert.equal(lensRadius(0), 0.75); assert.equal(lensRadius(10000), 0.05); assert.ok(Math.abs(lensRadius(240) - 0.5) < 1e-9);
  assert.equal(lensRadius(NaN), 0.75);
});

test("micro: famSite (JS twin of the shader) is finite, bounded, and keeps banded worlds off the poles", async () => {
  const { famSite } = await import("../src/components/alien/micro-pure.ts");
  for (const fam of [-1, 0, 1, 2, 3]) for (let i = 0; i < 200; i++) {
    const z = Math.cos(i * 1.3), a = i * 2.39996, q = Math.sqrt(1 - z * z);
    const v = famSite([q * Math.cos(a), z, q * Math.sin(a)], fam, [1.37, 2.71, 0.61]);
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1.2, `fam ${fam}: ${v}`);
  }
  assert.equal(famSite([0, 1, 0], 0, [1, 1, 1]), 0);
});
