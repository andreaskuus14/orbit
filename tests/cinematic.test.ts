import { test } from "node:test";
import assert from "node:assert/strict";
import { aberrationFor, catmullRom, cullLabels, damp, easeInOutCubic, easeInOutQuint, fmtCoord, framePose, HOME_POS, idleDrift, introLabelAlpha, introPose, scramble, smoothDamp, stepStop, stepZoom, wheelGate, wheelKick, wheelStep } from "../src/lib/cinematic-pure.ts";

test("damp approaches the target and is frame-rate independent", () => {
  assert.equal(damp(0, 10, 5, 0), 0);
  const one = damp(0, 10, 5, 0.1);
  const two = damp(damp(0, 10, 5, 0.05), 10, 5, 0.05);
  assert.ok(Math.abs(one - two) < 1e-9);
  assert.ok(damp(0, 10, 5, 10) > 9.999);
});

test("wheel kicks normalise modes and cap flings", () => {
  assert.ok(wheelKick(100) > 0 && wheelKick(-100) < 0);
  assert.equal(wheelKick(1, 1), wheelKick(16));
  assert.equal(wheelKick(100000), wheelKick(160));
  assert.equal(wheelKick(NaN), 0);
});

test("zoom inertia eases to rest and stops at the limits", () => {
  let s = { dist: 40, vel: 1 };
  for (let i = 0; i < 120; i++) s = stepZoom(s.dist, s.vel, 1 / 60, 4, 80);
  assert.equal(s.vel, 0);
  assert.ok(s.dist > 40 && s.dist < 80);
  const hit = stepZoom(79, 5, 0.1, 4, 80);
  assert.deepEqual(hit, { dist: 80, vel: 0 });
  const hitch = stepZoom(40, 1, 5, 4, 80); // a 5 s hitch is clamped to 0.1 s
  assert.ok(hitch.dist < 40 * Math.exp(0.11));
});

test("idle drift waits, then eases in to its max", () => {
  assert.equal(idleDrift(3), 0);
  assert.equal(idleDrift(8), 0);
  assert.ok(idleDrift(9) > 0 && idleDrift(9) < idleDrift(11));
  assert.equal(idleDrift(60), 0.18);
});

test("aberration is zero at rest and saturates on fast moves", () => {
  assert.equal(aberrationFor(0), 0);
  assert.equal(aberrationFor(0.03), 0);
  assert.equal(aberrationFor(NaN), 0);
  assert.ok(aberrationFor(0.5) > 0);
  assert.ok(aberrationFor(100) <= 0.0022 && aberrationFor(100) > 0.0021);
  assert.equal(aberrationFor(0.14), 0); // following an inner planet: no fringe
});

test("scramble is deterministic, keeps spaces and resolves to the text", () => {
  const t = "// ORBIT OS";
  assert.equal(scramble(t, 1), t);
  assert.equal(scramble(t, 0, 7), scramble(t, 0, 7));
  assert.notEqual(scramble("ABCDEFGHIJ", 0, 1), scramble("ABCDEFGHIJ", 0, 2));
  const s = scramble(t, 0, 3);
  assert.equal(s.length, t.length);
  assert.equal(s.slice(0, 3), "// "); // punctuation and spaces stay put
  assert.equal(scramble("MEMORY", 0.5, 4).slice(0, 3), "MEM");
});

test("coordinates are fixed width with a sign", () => {
  assert.equal(fmtCoord(4.213), "+004.21");
  assert.equal(fmtCoord(-12), "-012.00");
  assert.equal(fmtCoord(NaN), "+000.00");
});

test("easings run 0 → 1, symmetric, clamped", () => {
  for (const f of [easeInOutCubic, easeInOutQuint]) {
    assert.equal(f(0), 0); assert.equal(f(1), 1); assert.ok(Math.abs(f(0.5) - 0.5) < 1e-12);
    assert.equal(f(-3), 0); assert.equal(f(9), 1); assert.equal(f(NaN), 0);
  }
});

test("smoothDamp settles in ~1.1 s the same at 30 and 60 fps, and keeps velocity", () => {
  const settle = (fps: number) => {
    const vel = [0];
    let x = 0, t = 0;
    while (Math.abs(10 - x) > 0.05 && t < 5) { x = smoothDamp(x, 10, vel, 0, 0.32, 1 / fps); t += 1 / fps; }
    return t;
  };
  const a = settle(30), b = settle(60);
  assert.ok(a > 0.8 && a < 1.5 && Math.abs(a - b) < 0.1, `${a} ${b}`);
  const vel = [5];
  assert.ok(smoothDamp(0, 0, vel, 0, 0.3, 1 / 60) > 0); // retarget onto itself: momentum carries on, no snap
});

test("catmull-rom passes through its keyframes", () => {
  const pts = [0, 0, 0, 1, 2, 3, 4, 4, 4], out = [0, 0, 0];
  catmullRom(pts, 0, out); assert.deepEqual(out, [0, 0, 0]);
  catmullRom(pts, 0.5, out); assert.deepEqual(out, [1, 2, 3]);
  catmullRom(pts, 1, out); assert.deepEqual(out, [4, 4, 4]);
});

test("intro starts low by the CORE and ends exactly on the overview looking at the origin", () => {
  const o = [0, 0, 0, 0, 0, 0];
  introPose(0, o);
  assert.ok(o[1] < 2 && Math.hypot(o[0], o[2]) < 7);
  introPose(1, o);
  assert.deepEqual(o.map((v) => Math.round(v * 1e9) / 1e9), [...HOME_POS, 0, 0, 0]);
  assert.equal(introLabelAlpha(0.5, 0, 12), 0);
  assert.equal(introLabelAlpha(1, 11, 12), 1);
  assert.ok(introLabelAlpha(0.8, 0, 12) > introLabelAlpha(0.8, 6, 12)); // staggered
});

test("framing puts the camera outside the planet, low, with the planet right of centre", () => {
  const o = [0, 0, 0, 0, 0, 0];
  framePose(10, 0, 0.75, 16 / 9, 50, o);
  assert.ok(o[0] > 10 && o[1] > 0 && o[1] < 2);
  // looking down -x: screen-right is -z, so the look target sits at +z (left) and the planet lands on the right
  assert.ok(o[5] > 0.5 && o[3] === 10);
  framePose(0, 0, 0.75, 1, 50, o); // degenerate position stays finite
  assert.ok(o.every(Number.isFinite));
});

test("one flick = one stop: threshold, inertia tail locked, held wheel steps after the glide", () => {
  const g = wheelGate();
  assert.equal(wheelStep(g, 30, 0, 0), 0);
  assert.equal(wheelStep(g, 40, 0, 16), 1);
  let extra = 0; // trackpad inertia: decaying deltas every 16 ms for 1.5 s
  for (let t = 32, d = 40; t < 1500; t += 16, d *= 0.95) extra += Math.abs(wheelStep(g, d, 0, t));
  assert.equal(extra, 0);
  assert.equal(wheelStep(g, -100, 0, 1800), -1); // after a pause: a new flick back
  const m = wheelGate(); // mouse wheel held: a 100 px notch every 50 ms
  let steps = 0;
  for (let t = 0; t < 2600; t += 50) steps += wheelStep(m, 100, 0, t);
  assert.equal(steps, 3);
  assert.equal(wheelStep(wheelGate(), 3, 1, 0), 1); // line mode: one Firefox notch = 3 lines = 48 px
  assert.equal(wheelStep(wheelGate(), NaN, 0, 0), 0);
  assert.equal(stepStop(0, -1, 11), -1); assert.equal(stepStop(-1, -1, 11), -1); assert.equal(stepStop(10, 1, 11), 10);
});

test("label culling keeps the higher-priority label of an overlapping pair", () => {
  const x = [100, 120, 400, 0], y = [100, 105, 100, 0], w = [80, 80, 80, 80], prio = [1, 5, 2, -1];
  const vis = [0, 0, 0, 0], order = [0, 0, 0, 0];
  cullLabels(x, y, w, 20, prio, vis, order);
  assert.deepEqual(vis, [0, 1, 1, 0]);
  cullLabels(x, [100, 140, 100, 0], w, 20, prio, vis, order); // apart vertically: both shown
  assert.deepEqual(vis, [1, 1, 1, 0]);
});

test("framing lands the planet's centre at the asked screen height (level with the title)", async () => {
  const THREE = await import("three");
  for (const [aspect, yNdc] of [[16 / 9, 0.3], [2.8, 0.25], [1, -0.2], [2.8, 0]] as const) {
    const o = [0, 0, 0, 0, 0, 0];
    framePose(12, 5, 0.9, aspect, 44, o, yNdc);
    const cam = new THREE.PerspectiveCamera(44, aspect, 0.1, 500);
    cam.position.set(o[0], o[1], o[2]); cam.lookAt(o[3], o[4], o[5]); cam.updateMatrixWorld();
    const p = new THREE.Vector3(12, 0, 5).project(cam);
    assert.ok(Math.abs(p.y - yNdc) < 0.08, `aspect ${aspect}: planet at y ${p.y.toFixed(2)}, wanted ${yNdc}`);
    assert.ok(p.x > 0.2 && p.x < 0.9, `aspect ${aspect}: planet at x ${p.x.toFixed(2)} should be on the right`);
  }
});
