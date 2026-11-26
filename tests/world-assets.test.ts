import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync, readFileSync } from "node:fs";
import { ASSETS, BUDGET, PER_WORLD, assetsFor, fitScale, fortPiece, useRealAssets, type AssetId, type WorldId } from "../src/lib/world-assets-pure.ts";

const size = (id: AssetId) => statSync(`public/worlds/${ASSETS[id].file}`).size;

test("every asset file exists, fits the budget, and is listed with its source in LICENSES.md", () => {
  const lic = readFileSync("public/worlds/LICENSES.md", "utf8");
  let total = 0;
  for (const id of Object.keys(ASSETS) as AssetId[]) { total += size(id); assert.ok(lic.includes(ASSETS[id].file), id); assert.ok(lic.includes(ASSETS[id].source), id); }
  assert.ok(total <= BUDGET, `total ${total}`);
  for (const w of ["gamedev", "memory", "arch", "life", "vault", "studio", "agents"] as WorldId[]) {
    const n = assetsFor(w).reduce((s, id) => s + size(id), 0); assert.ok(n <= PER_WORLD, `${w} ${n}`);
  }
});

test("low tier downloads nothing; fit and fort pieces", () => {
  assert.equal(useRealAssets(0), false); assert.equal(useRealAssets(2), true);
  assert.deepEqual(fitScale([2, 4, 2], [1, 2, 1], true), [0.5, 0.5, 0.5]);
  assert.deepEqual(fitScale([2, 4, 1], [1, 2, 3], false), [0.5, 0.5, 3]);
  assert.deepEqual(fitScale([0, 1, 1], [1, 1, 1], false), [1, 1, 1]);
  assert.match(fortPiece("tower"), /tower_round/); assert.match(fortPiece("hall"), /thick_corner/);
});

test("ARCH v7: real trees, plants, grass and house skin are in the arch set and stay under its budget", () => {
  const ids = assetsFor("arch");
  for (const id of ["tree", "shrub", "fern", "flower", "rocks", "grassD", "grassN", "cliffD", "cliffN", "woodD", "woodN", "woodR", "roofD", "roofN", "roofR", "stuccoD", "stuccoN", "stuccoR"] as AssetId[]) assert.ok(ids.includes(id), id);
  const bytes = ids.reduce((s, id) => s + size(id), 0);
  assert.ok(bytes <= PER_WORLD, `arch ${bytes}`);
  for (const id of ids) if (/^(wood|roof|stucco)/.test(id)) assert.ok(size(id) < 100_000, `${id} stays small`); // textures are 512 px webp
});
