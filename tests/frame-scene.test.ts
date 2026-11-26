import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME_BUDGET_BYTES, FRAME_IDS, SPOTS, ZOOM_FRAMES, bindSpots, coverScale, dolly, focusFor, frameUrl, hasFrame, onScreen, parallax, spotScreen } from "../src/lib/frame-scene-pure.ts";

const walk = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? walk(join(d, e.name)) : statSync(join(d, e.name)).size), 0);

test("every frame has slots inside the frame and assets on disk", () => {
    for (const id of FRAME_IDS) {
      assert.ok(SPOTS[id].length >= 7);
      for (const s of SPOTS[id]) { assert.ok(s.x > 0); assert.ok(s.x < 1); assert.ok(s.y > 0); assert.ok(s.y < 1); }
      for (const k of ["color", "depth"] as const) assert.ok(statSync(join("public", frameUrl(id, k))).size > 1000);
    }
    for (const id of ZOOM_FRAMES) assert.ok(statSync(join("public", frameUrl(id, "zoom"))).size > 1000);
    assert.equal(hasFrame("vault"), true); assert.equal(hasFrame("nova"), false);
  });
test("cover-fit keeps the frame filling the view", () => {
    assert.deepEqual(coverScale(1.6, 1.6), [1, 1]);
    assert.deepEqual(coverScale(1.6, 3.2), [1, 0.5]);
    assert.deepEqual(coverScale(1.6, 0.8), [0.5, 1]);
  });
test("parallax: near moves, mid depth stays, far moves the other way", () => {
    assert.equal(parallax([1, 0], 0.5)[0], 0);
    assert.ok(parallax([1, 0], 1)[0] > 0);
    assert.ok(parallax([1, 0], 0)[0] < 0);
  });
test("spotScreen is the identity at rest and follows the zoom about its focus", () => {
    const base = { mouse: [0, 0] as [number, number], z: 1, focus: [0.5, 0.5] as [number, number], cover: [1, 1] as [number, number] };
    assert.deepEqual(spotScreen({ x: 0.3, y: 0.7 }, base), [0.3, 0.7]);
    const p = spotScreen({ x: 0.7, y: 0.5 }, { ...base, z: 2 });
    assert.ok(Math.abs(p[0] - 0.9) < 1e-6); assert.equal(onScreen([1.5, 0.5]), false);
    assert.deepEqual(spotScreen({ x: 0.3, y: 0.3 }, { ...base, focus: [0.3, 0.3], z: 2 }), [0.3, 0.3]);
  });
test("dolly runs 1 to zMax and fades to the zoom frame late", () => {
    assert.deepEqual(dolly(0), { z: 1, fade: 0 });
    assert.ok(Math.abs(dolly(1).z - 1.9) < 1e-6); assert.equal(dolly(1).fade, 1);
    assert.equal(dolly(0.3).fade, 0);
    const f = focusFor({ x: 0.02, y: 0.99 }); assert.ok(f[0] > 0.2); assert.ok(f[1] < 0.8);
  });
test("binds the most important chips to the first slots and drops extras", () => {
    const chips = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, prio: i === 7 ? 9 : 1 }));
    const b = bindSpots("vault", chips);
    assert.equal(b.length, SPOTS.vault.length); assert.equal(b[0].chip.id, "c7"); assert.equal(b[0].spot, SPOTS.vault[0]);
  });
test("public/worlds stays inside the budget and the frames are licensed", () => {
    assert.ok(walk("public/worlds") < FRAME_BUDGET_BYTES);
    assert.match(readFileSync("public/worlds/LICENSES.md", "utf8"), /Depth Anything V2/);
  });


test("memory, agents, studio and gamedev render their frame on tier > 0 and keep the 3D as fallback", () => {
  for (const [file, id] of [["MemoryWorld", "memory"], ["AgentsStation", "agents"], ["StudioWorld", "studio"], ["DevWorld", "gamedev"]] as const) {
    const src = readFileSync(`src/components/${file}.tsx`, "utf8");
    assert.ok(src.includes(`<FrameWorld id="${id}"`), file); assert.match(src, /frameOn \? <FrameWorld|frameOn \? <FrameWorld|: frameOn \? <FrameWorld/, file);
    assert.match(src, /worldTier\(q\.bloomScale, q\.msaa\) > 0/, file); assert.ok(src.includes("<Canvas"), `${file} keeps its procedural canvas`);
  }
});
