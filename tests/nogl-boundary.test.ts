// No WebGL (laptop without a GPU): a planet's own 3D <Canvas> must sit inside a quiet PlanetBoundary, so the scene drops out and
// the panel keeps working. GAME DEV, AGENTS, STUDIO and ARCH mounted their own Canvas outside PlanetWorld's boundary and the
// whole planet showed the crash card. Text scan: each world file's Canvas opens inside `<PlanetBoundary ... quiet>`.
// The live check is scripts/qa-shots.mjs with QA_NOGL=1 (fails if any planet shows a crash card).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WORLDS = ["DevWorld", "AgentsStation", "StudioWorld", "ArchWorld", "PlanetWorld"];

for (const w of WORLDS) test(`${w}: 3D canvas is inside a quiet boundary`, () => {
  const src = readFileSync(`src/components/${w}.tsx`, "utf8");
  const opens = [...src.matchAll(/<Canvas\b/g)];
  assert.ok(opens.length > 0, `${w} has no <Canvas>`);
  for (const m of opens) {
    const before = src.slice(Math.max(0, m.index! - 200), m.index);
    assert.match(before, /<PlanetBoundary [^>]*quiet>\s*$/, `${w}: <Canvas> at ${m.index} is not wrapped in <PlanetBoundary quiet>`);
  }
});

test("ArchStudy survives a reply without its lists", () => {
  const src = readFileSync("src/components/ArchStudy.tsx", "utf8");
  assert.doesNotMatch(src, /\}\)\)\.books\)/, "books read without a fallback");
  assert.match(src, /\?\.books \?\? \[\]/);
  assert.match(src, /r\?\.quiz\?\.length/);
});
