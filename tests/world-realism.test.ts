import { test } from "node:test";
import assert from "node:assert/strict";
import { worldTier, REALISM, surfaceFor, surfaceKey } from "../src/lib/world-realism-pure.ts";
import { QUALITY, worldQuality } from "../src/lib/quality-pure.ts";

test("low preset keeps the old look (tier 0), medium and high step up", () => {
  const t = (m: "low" | "auto" | "high") => { const q = worldQuality(m); return worldTier(q.bloom, q.msaa); };
  assert.equal(t("low"), 0); assert.equal(t("auto"), 1); assert.equal(t("high"), 2);
  assert.equal(worldTier(NaN, 4), 0);
  assert.equal(REALISM[0].env, false); assert.equal(REALISM[0].shadow, 0); assert.equal(REALISM[0].glass, false);
  assert.ok(REALISM.length === 3 && QUALITY.length >= 3);
});

test("surfaces: stone, brushed metal, foliage, glass left alone", () => {
  assert.equal(surfaceFor({ metalness: 0.8, roughness: 0.3 })!.streak, 1);
  const stone = surfaceFor({ metalness: 0, roughness: 0.95 })!;
  assert.ok(stone.bump > 0.05 && stone.vary > 0.2);
  assert.ok(surfaceFor({ metalness: 0, roughness: 0.9, foliage: true })!.vary > stone.vary);
  assert.equal(surfaceFor({ metalness: 0, roughness: 0.1, transparent: true }), null);
  assert.equal(surfaceFor({ metalness: 0, roughness: 0.9, wireframe: true }), null);
  assert.equal(surfaceFor({ metalness: 0, roughness: 0.9 }, null), null);
  assert.equal(surfaceFor({ metalness: 0, roughness: 0.9 }, { bump: 0 })!.bump, 0);
  assert.notEqual(surfaceKey(stone), surfaceKey(surfaceFor({ metalness: 1, roughness: 0.2 })!));
});
