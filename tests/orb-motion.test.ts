import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEAT_DECAY_MS, BEAT_MIN_MS, DESAT_MS, EXHALE_MS, ORB_CHANNELS, ORB_DELAY, ORB_TARGETS, RING_BOOST_MS, SHAKE_MS, TOOL_PULSE_MS,
  beatLevel, channelProgress, easeAnticipate, easeInOutCubic, envelope, orbBeat, orbClock0, orbDpr, orbDuration, orbFrame,
  orbMotionInit, orbRetarget, orbSettled, orbShots, orbStill, orbValues,
  ORB_GPU_BUDGET_MS, ORB_MAX_STEPS, ORB_PERF_COOLDOWN_MS, ORB_PERF_OVER, ORB_PERF_WINDOW, orbPerfInit, orbPerfSample, orbQuality, orbTier, type OrbPerf,
} from "../src/lib/orb-motion-pure.ts";
import type { CorePhase } from "../src/lib/core-phase-pure.ts";
import { ORB_FRAG, ORB_R } from "../src/components/motion/orb-shader.ts";

const PHASES: CorePhase[] = ["idle", "listening", "thinking", "tool", "writing", "done", "error"];
const settleAt = (p: CorePhase) => orbDuration(p) + Math.max(...ORB_CHANNELS.map((c) => ORB_DELAY[c]));
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test("orb targets: every pose is in range; thinking is the tightest, densest, fastest; listening leans toward the input", () => {
  for (const p of PHASES) {
    const t = ORB_TARGETS[p];
    for (const k of ["core", "threads", "sparks", "glow"] as const) assert.ok(t[k] >= 0 && t[k] <= 1, `${p}.${k}`);
    assert.ok(t.swirlSpeed > 0 && t.swirlSpeed < 1.5, `${p} swirl`);
  }
  const th = ORB_TARGETS.thinking;
  for (const p of PHASES.filter((x) => x !== "thinking")) {
    for (const k of ["core", "threads", "sparkSpeed", "swirlSpeed"] as const) assert.ok(th[k] >= ORB_TARGETS[p][k], `thinking.${k} ≥ ${p}`);
  }
  assert.ok(ORB_TARGETS.listening.leanY < 0, "leans down toward the input");
  assert.ok(ORB_TARGETS.listening.breathAmp > ORB_TARGETS.idle.breathAmp, "listening breathes");
  for (const p of ["idle", "thinking", "tool", "writing", "done", "error"] as const) assert.equal(ORB_TARGETS[p].leanY, 0);
  assert.ok(ORB_TARGETS.idle.threads < 0.4 && ORB_TARGETS.idle.swirlSpeed < 0.2, "idle is calm with few threads");
});

test("easing: endpoints exact, in-out symmetric, anticipation pulls back first and overshoots before landing", () => {
  for (const f of [easeInOutCubic, (t: number) => easeAnticipate(t)]) { assert.equal(f(0), 0); assert.equal(f(1), 1); }
  assert.ok(near(easeInOutCubic(0.5), 0.5));
  assert.ok(near(easeInOutCubic(0.3) + easeInOutCubic(0.7), 1, 1e-12));
  assert.ok(easeAnticipate(0.15) < 0, "pulls back");
  assert.ok(easeAnticipate(0.85) > 1, "overshoots");
  assert.ok(Math.min(...Array.from({ length: 101 }, (_, i) => easeAnticipate(i / 100))) > -0.2, "small pull, not a jerk");
});

test("transitions: start where it was, land exactly on the pose, and channels overlap (core leads, sparks follow)", () => {
  const m = orbRetarget(orbMotionInit("idle", 0), "writing", 1000);
  assert.deepEqual(orbValues(m, 1000), ORB_TARGETS.idle);
  assert.deepEqual(orbValues(m, 1000 + settleAt("writing")), ORB_TARGETS.writing);
  const early = 1000 + ORB_DELAY.sparks - 10;
  assert.ok(channelProgress(m, "core", early) > 0.05, "core already moving");
  assert.equal(channelProgress(m, "sparks", early), 0, "sparks still waiting");
  // eased: slow at both ends
  const d = orbDuration("writing");
  const p = (t: number) => channelProgress(m, "core", 1000 + t * d);
  assert.ok(p(0.1) < 0.1 && p(0.9) > 0.9);
});

test("transitions: entering thinking anticipates on the core (dips, then overshoots, then settles exactly)", () => {
  const m = orbRetarget(orbMotionInit("idle", 0), "thinking", 0);
  const d = orbDuration("thinking");
  const core = (t: number) => orbValues(m, t * d).core;
  assert.ok(core(0.15) < ORB_TARGETS.idle.core, "gathers itself first");
  assert.ok(core(0.85) > ORB_TARGETS.thinking.core, "follows through");
  assert.equal(orbValues(m, settleAt("thinking")).core, ORB_TARGETS.thinking.core);
  // other channels don't anticipate
  const thr = orbValues(m, 0.15 * d + ORB_DELAY.threads).threads;
  assert.ok(thr >= ORB_TARGETS.idle.threads);
});

test("transitions: an interrupted move continues from where it is (no jump), and the same pose is a no-op", () => {
  let m = orbRetarget(orbMotionInit("idle", 0), "thinking", 0);
  const before = orbValues(m, 300);
  m = orbRetarget(m, "tool", 300);
  const after = orbValues(m, 300);
  for (const ch of ORB_CHANNELS) assert.ok(near(before[ch], after[ch], 1e-12), ch);
  assert.equal(orbRetarget(m, "tool", 500), m);
});

test("durations: speeding up is quicker than calming down; settling home is the slowest", () => {
  assert.ok(orbDuration("tool") < orbDuration("thinking"));
  assert.ok(orbDuration("idle") > orbDuration("done") && orbDuration("done") > orbDuration("writing"));
  for (const p of PHASES) assert.ok(orbDuration(p) >= 250 && orbDuration(p) <= 1500, p);
});

test("one-shots: tool pulse travels out and leaves; the ring spins up then coasts back", () => {
  assert.equal(orbShots("tool", 0).pulse, 0);
  assert.ok(near(orbShots("tool", TOOL_PULSE_MS / 2).pulse, 0.5));
  assert.equal(orbShots("tool", TOOL_PULSE_MS + 1).pulse, -1);
  assert.ok(orbShots("tool", 160).ringBoost > 0.99);
  assert.equal(orbShots("tool", RING_BOOST_MS).ringBoost, 0);
  for (const p of ["idle", "thinking", "writing", "listening"] as const) assert.deepEqual(orbShots(p, 200), orbShots(p, 9999));
});

test("one-shots: done exhales once; error shakes briefly and its colour comes back", () => {
  const ex = [0, 100, 260, 600, EXHALE_MS].map((t) => orbShots("done", t).exhale);
  assert.equal(ex[0], 0); assert.ok(ex[2] > 0.99); assert.ok(ex[3] < ex[2]); assert.equal(ex[4], 0);
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(orbShots("error", i * 8).shakeX)));
  assert.ok(peak > 0.01 && peak <= 0.035, "small shake");
  assert.equal(orbShots("error", SHAKE_MS).shakeX, 0);
  assert.ok(orbShots("error", 300).desat > 0.5);
  assert.equal(orbShots("error", DESAT_MS).desat, 0);
  assert.equal(envelope(-1, 10, 20), 0);
});

test("writing beats: one pulse per text chunk, close chunks merge (no strobe), each beat fades", () => {
  let m = orbMotionInit("writing", 0);
  assert.ok(beatLevel(m, 0) < 1e-6);
  m = orbBeat(m, 1000);
  assert.equal(beatLevel(m, 1000), 1);
  const same = orbBeat(m, 1000 + BEAT_MIN_MS - 1);
  assert.equal(same, m, "merged");
  assert.ok(near(beatLevel(m, 1000 + BEAT_DECAY_MS), Math.exp(-1)));
  assert.equal(orbBeat(m, 1000 + BEAT_MIN_MS).beatAt, 1000 + BEAT_MIN_MS);
});

test("frames: deterministic for fixed steps; clocks integrate speed so a pose change never jumps the pattern", () => {
  const run = () => {
    let m = orbMotionInit("idle", 0), c = orbClock0();
    const out: number[] = [];
    for (let i = 0; i < 240; i++) {
      const now = (i * 1000) / 60;
      if (i === 60) m = orbRetarget(m, "thinking", now);
      if (i === 150) m = orbRetarget(m, "tool", now);
      const f = orbFrame(m, c, now, i ? 1 / 60 : 0);
      c = f.clock; out.push(f.u.swirl, f.u.spark, f.u.ring, f.u.core, f.u.scale);
    }
    return out;
  };
  const a = run();
  assert.deepEqual(a, run());
  const sw = a.filter((_, i) => i % 5 === 0);
  for (let i = 1; i < sw.length; i++) {
    const step = sw[i] - sw[i - 1];
    assert.ok(step >= 0 && step < 0.03, `swirl step ${i}: ${step}`);
  }
});

test("frames: uniforms stay in range across a whole scene", () => {
  let m = orbMotionInit("idle", 0), c = orbClock0();
  const plan: [number, CorePhase][] = [[500, "listening"], [1500, "thinking"], [2500, "tool"], [3300, "writing"], [4500, "done"], [5600, "error"], [7000, "idle"]];
  for (let i = 0; i < 600; i++) {
    const now = (i * 1000) / 60;
    for (const [t, p] of plan) if (Math.abs(t - now) < 1000 / 120) m = orbRetarget(m, p, now);
    if (m.phase === "writing" && i % 7 === 0) m = orbBeat(m, now);
    const { u, clock } = orbFrame(m, c, now, 1 / 60);
    c = clock;
    assert.ok(u.threads >= 0 && u.threads <= 1 && u.sat >= 0 && u.sat <= 1, `t=${now}`);
    assert.ok(u.scale > 0.95 && u.scale < 1.06, `scale ${u.scale}`);
    assert.ok(u.glow >= 0 && u.glow < 2, `glow ${u.glow}`);
    assert.ok(u.pulse === -1 || (u.pulse >= 0 && u.pulse < 1));
  }
});

test("reduced motion: a still per pose (no pulse, no shake, no breathing); settled detection", () => {
  for (const p of PHASES) {
    const u = orbStill(p);
    assert.equal(u.pulse, -1); assert.equal(u.scale, 1); assert.equal(u.shakeX, 0); assert.equal(u.core, ORB_TARGETS[p].core);
  }
  const m = orbRetarget(orbMotionInit("idle", 0), "tool", 0);
  assert.equal(orbSettled(m, 100), false);
  assert.equal(orbSettled(m, Math.max(settleAt("tool"), RING_BOOST_MS)), true);
  assert.equal(orbSettled(orbBeat(m, 5000), 5010), false, "a beat is motion");
});

test("cost guards: canvas dpr never above 2; the 40 px chat orb is tier 0, the 96 px home orb gets full detail", () => {
  assert.equal(orbDpr(3), 2); assert.equal(orbDpr(1.25), 1.25); assert.equal(orbDpr(undefined), 1); assert.equal(orbDpr(0.5), 1);
  assert.equal(orbTier(40), 0); assert.equal(orbTier(63), 0); assert.equal(orbTier(64), 1); assert.equal(orbTier(95), 1);
  assert.equal(orbTier(96), 2); assert.equal(orbTier(648), 2);
});

test("adaptive quality: step-downs drop tiers first, then pixels; never below half resolution", () => {
  assert.deepEqual(orbQuality(2, 0), { tier: 2, dprScale: 1 });
  assert.deepEqual(orbQuality(2, 2), { tier: 0, dprScale: 1 });
  assert.deepEqual(orbQuality(2, 3), { tier: 0, dprScale: 0.75 });
  assert.deepEqual(orbQuality(0, 1), { tier: 0, dprScale: 0.75 }, "chat orb goes straight to fewer pixels");
  assert.deepEqual(orbQuality(0, ORB_MAX_STEPS), { tier: 0, dprScale: 0.5 });
  assert.deepEqual(orbQuality(1, -3), { tier: 1, dprScale: 1 });
});

const feed = (p: OrbPerf, n: number, s: { gpuMs?: number; frameMs?: number }, t0: number, step = 16) => {
  for (let i = 0; i < n; i++) p = orbPerfSample(p, s, t0 + i * step);
  return p;
};

test("adaptive quality: GPU time over budget for most of a window steps down once, then waits a cooldown", () => {
  let p = feed(orbPerfInit(), ORB_PERF_WINDOW * 3, { gpuMs: ORB_GPU_BUDGET_MS * 0.6 }, 0);
  assert.equal(p.down, 0, "cheap frames never step down");
  p = feed(p, ORB_PERF_OVER - 1, { gpuMs: ORB_GPU_BUDGET_MS * 2 }, 10_000);
  assert.equal(p.down, 0);
  p = orbPerfSample(p, { gpuMs: ORB_GPU_BUDGET_MS * 2 }, 11_000);
  assert.equal(p.down, 1);
  const cooling = feed(p, ORB_PERF_WINDOW, { gpuMs: 99 }, 11_016, 1);
  assert.equal(cooling.down, 1, "no second step during the cooldown");
  const later = feed(p, ORB_PERF_OVER, { gpuMs: 99 }, 11_000 + ORB_PERF_COOLDOWN_MS);
  assert.equal(later.down, 2);
  assert.equal(feed(orbPerfInit(), 500, { gpuMs: 99 }, 0, 3000).down, ORB_MAX_STEPS, "stops at the floor");
});

test("adaptive quality: a few slow frames in a window are tolerated (no flicker)", () => {
  let p = orbPerfInit();
  for (let i = 0; i < ORB_PERF_WINDOW * 6; i++) p = orbPerfSample(p, { gpuMs: i % 3 === 0 ? 9 : 1 }, i * 16);
  assert.equal(p.down, 0);
});

test("adaptive quality: without a GPU timer, frame gaps are judged against the display's own refresh", () => {
  // 120 Hz display running smoothly, then dropping to ~40 fps
  let p = feed(orbPerfInit(), 60, { frameMs: 8.3 }, 0, 8.3);
  assert.equal(p.down, 0); assert.ok(Math.abs(p.refreshMs - 8.3) < 1e-9);
  p = feed(p, ORB_PERF_OVER, { frameMs: 25 }, 1000, 25);
  assert.equal(p.down, 1);
  // a 60 Hz display at a steady 16.7 ms is fine
  assert.equal(feed(orbPerfInit(), 200, { frameMs: 16.7 }, 0, 16.7).down, 0);
  // long gaps (tab away, debugger) and missing samples are ignored
  const q = orbPerfSample(orbPerfInit(), { frameMs: 2000 }, 0);
  assert.deepEqual(q, orbPerfInit());
  assert.deepEqual(orbPerfSample(orbPerfInit(), {}, 0), orbPerfInit());
});

test("shader + renderer agree on uniforms; CSS keeps the old orb as the fallback", () => {
  const gl = readFileSync(new URL("../src/components/motion/orb-gl.ts", import.meta.url), "utf8");
  const names = [...gl.matchAll(/"(u[A-Z]\w*)"/g)].map((x) => x[1]);
  assert.ok(names.length >= 15);
  for (const n of names) assert.match(ORB_FRAG, new RegExp(`\\b${n}\\b`), n);
  assert.match(ORB_FRAG, /^#version 300 es/);
  assert.match(gl, /EXT_disjoint_timer_query_webgl2/, "GPU timer for the automatic step-down");
  assert.match(ORB_FRAG, /uniform float[^;]*\buTier\b/);
  // tier gates: fine web layer only at full detail; noise octaves follow the tier
  assert.match(ORB_FRAG, /if \(tier == 2 && ppc2 > 5\.0\)/);
  assert.match(ORB_FRAG, /int oct = 2 \+ tier;/);
  assert.ok(ORB_R > 0.5 && ORB_R < 0.75, "room for ring + bloom");
  const css = readFileSync(new URL("../src/app/motion.css", import.meta.url), "utf8");
  assert.match(css, /\.core-orb\[data-gl="on"\] > :not\(canvas\) \{ display: none; \}/);
  assert.match(css, /\.orb-core \{/, "CSS orb still there");
  assert.match(css, /calc\(var\(--orb\) \/ 0\.6\)/, "canvas matches ORB_R");
});
