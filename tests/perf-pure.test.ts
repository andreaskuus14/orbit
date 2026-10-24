import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameRing, frameStats, sceneOf, cleanWindow, rollupScenes, corePath, coreStats, type SceneWindow } from "../src/lib/perf-pure.ts";

test("frame ring percentiles and fps", () => {
  const r = new FrameRing(256), scratch = new Float32Array(256);
  assert.equal(frameStats(r, scratch), null);
  for (let i = 0; i < 99; i++) r.push(10);
  r.push(100);
  const s = frameStats(r, scratch)!;
  assert.equal(s.n, 100);
  assert.equal(s.p50, 10);
  assert.equal(s.p95, 10);
  assert.equal(s.p99, 10);
  assert.equal(s.fps, Math.round((1000 * 100) / 1090 * 10) / 10);
  assert.equal(r.buf[0], 10); // stats never reorder the ring itself
  r.reset();
  for (let i = 1; i <= 300; i++) r.push(i); // wraps: keeps the newest 256 (45..300)
  const w = frameStats(r, scratch)!;
  assert.equal(w.n, 256);
  assert.equal(w.p50, 172);
  assert.equal(w.p99, 298);
});

test("the per-frame path costs well under 0.05 ms", () => {
  const r = new FrameRing(4096), ctx = { level: 2, paused: false, selected: null };
  const N = 200_000, t = performance.now();
  for (let i = 0; i < N; i++) { if (sceneOf(ctx) === "x") break; r.push(16.6); }
  assert.ok((performance.now() - t) / N < 0.05);
});

test("scene bucketing", () => {
  assert.equal(sceneOf({}), "galaxy");
  assert.equal(sceneOf({ selected: "memory", paused: false }), "galaxy"); // a drawer over the galaxy
  assert.equal(sceneOf({ selected: "studio", paused: true }), "studio");
  assert.equal(sceneOf({ selected: "studio", paused: true, dive: "studio" }), "dive");
});

test("posted windows are validated", () => {
  const ok = { scene: "galaxy", n: 600, p50: 16.7, p95: 20, p99: 33, fps: 59, dpr: 2, cw: 3000, level: 3, vis: "visible" };
  assert.deepEqual(cleanWindow(ok, 5), { ...ok, rx: 5 });
  assert.equal(cleanWindow({ ...ok, scene: "<b>" }, 5), null);
  assert.equal(cleanWindow({ ...ok, fps: NaN }, 5), null);
  assert.equal(cleanWindow({ ...ok, cw: "1" }, 5), null);
  assert.equal(cleanWindow(null, 5), null);
});

test("rollup: exact fps across windows, drops old windows", () => {
  const w = (scene: string, n: number, fps: number, p95: number, rx: number): SceneWindow => ({ scene, n, fps, p50: 1000 / fps, p95, p99: p95 * 2, dpr: 1, cw: 100, level: 1, vis: "visible", rx });
  const now = 10_000_000;
  const out = rollupScenes([w("galaxy", 600, 60, 20, now), w("galaxy", 300, 30, 40, now), w("galaxy", 300, 30, 90, now), w("studio", 10, 10, 5, now - 31 * 60_000)], now);
  assert.deepEqual(Object.keys(out), ["galaxy"]);
  assert.equal(out.galaxy.frames, 1200);
  assert.equal(out.galaxy.fps, 40); // 1200 frames in 30 s
  assert.equal(out.galaxy.p95, 40);
  assert.equal(out.galaxy.p99, 180);
});

test("CORE path and per-path stage percentiles", () => {
  assert.equal(corePath("reflex:clock", []), "reflex");
  assert.equal(corePath("smart", ["search_memory", "think"]), "memory");
  assert.equal(corePath("fast", ["search_memory", "think", "web_search", "think"]), "tool");
  const turns = Array.from({ length: 20 }, (_, i) => ({ path: "memory" as const, at: i, ms: { first_token: (i + 1) * 100, total: (i + 1) * 200 } }));
  const s = coreStats([...turns, { path: "reflex", at: 0, ms: { total: 5 } }]);
  assert.equal(s.memory!.n, 20);
  assert.deepEqual(s.memory!.stages.first_token, { p50: 1000, p95: 1900 });
  assert.deepEqual(s.reflex!.stages, { total: { p50: 5, p95: 5 } });
  assert.equal(s.tool, undefined);
});
