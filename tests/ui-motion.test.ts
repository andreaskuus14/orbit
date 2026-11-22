import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bezier, countdown, CURVE, cssCurve, DUR, dur, ease, fadeTier, FADE_MS, flyEase, motionCssVars, motionOn, paceReveal, ringOffset, springStep, stepChanges } from "../src/lib/ui-motion-pure.ts";
import { HOLD, idlePhase, nextTickIn, phaseLabel, phaseReduce, phaseTick, SETTLE, type PhaseEvent, type PhaseState } from "../src/lib/core-phase-pure.ts";
import { followHome, followMove, followPlanet, followStored, fromHisRequest, newJobs, openDelay, QUIET_MS, REQUEST_WINDOW_MS, type FollowCtx } from "../src/lib/follow-pure.ts";

test("ORBIT_UI_MOTION: on by default, 0/off/false restore the old look", () => {
  for (const v of [undefined, null, "", "1", "on", "yes"]) assert.equal(motionOn(v), true, String(v));
  for (const v of ["0", "off", "false", " OFF ", "no"]) assert.equal(motionOn(v), false, v);
});

test("tokens: the four UI durations from the brief, and motion.css declares the same values", () => {
  assert.deepEqual([DUR.instant, DUR.quick, DUR.base, DUR.slow], [120, 200, 320, 500]);
  assert.ok(DUR.fly >= 700 && DUR.fly <= 900);
  const css = readFileSync(new URL("../src/app/motion.css", import.meta.url), "utf8");
  for (const [k, v] of Object.entries(motionCssVars())) assert.ok(css.includes(`${k}: ${v}`), `${k}: ${v} in motion.css`);
});

test("tokens: reduced motion drops movement but keeps short fades", () => {
  assert.equal(dur("slow", false), 500);
  assert.equal(dur("slow", true), 0);
  assert.equal(dur("slow", true, "fade"), DUR.quick);
  assert.equal(dur("instant", true, "fade"), DUR.instant);
});

test("bezier matches the curve's ends and is monotonic for the UI curves", () => {
  for (const name of ["out", "inOut", "drawer"] as const) {
    const f = ease[name];
    assert.equal(f(0), 0); assert.equal(f(1), 1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) { const y = f(i / 100); assert.ok(y >= prev - 1e-9, `${name} monotonic at ${i}`); prev = y; }
  }
  assert.ok(Math.abs(bezier(0.25, 0.25, 0.75, 0.75)(0.37) - 0.37) < 1e-4, "a straight bezier is linear");
  assert.ok(ease.out(0.2) > 0.5, "ease-out front-loads the motion");
  assert.ok(ease.inOut(0.1) < 0.1 && ease.inOut(0.9) > 0.9, "ease-in-out is slow at both ends");
  assert.equal(cssCurve("out"), `cubic-bezier(${CURVE.out.join(", ")})`);
});

test("flyEase: anticipation (a small pull back), then ease-in-out, then a hold at 1", () => {
  assert.equal(flyEase(0), 0);
  const early = flyEase(0.08);
  assert.ok(early < 0 && early > -0.05, `pulls back a little first (${early})`);
  assert.equal(flyEase(0.95), 1, "holds at the end");
  assert.equal(flyEase(1), 1);
  assert.ok(flyEase(0.5) > 0.2 && flyEase(0.5) < 0.8);
  let prev = flyEase(0.14);
  for (let t = 0.15; t <= 0.9; t += 0.01) { const y = flyEase(t); assert.ok(y >= prev - 1e-9, `moves only forward after the pull at ${t.toFixed(2)}`); prev = y; }
  assert.ok(Math.abs(flyEase(0.1399) - flyEase(0.1401)) < 0.01, "no jump where anticipation hands over");
});

test("springStep settles on the target without exploding, whatever the frame time", () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 20, 0.5]) {
    let x = 0, v = 0;
    for (let i = 0; i < 400; i++) [x, v] = springStep(x, v, 1, dt);
    assert.ok(Math.abs(x - 1) < 1e-3 && Math.abs(v) < 1e-2, `settled at dt=${dt}`);
  }
  assert.deepEqual(springStep(0.3, 0, 0.3, 1 / 60), [0.3, 0]);
});

test("paceReveal: bursts spread over ~240 ms, small backlogs show at once, never more than the backlog", () => {
  assert.equal(paceReveal(0, 16), 0);
  assert.equal(paceReveal(3, 16), 3);
  const n = paceReveal(1200, 16);
  assert.ok(n > 3 && n < 1200, `a 1200-char burst is spread (${n} this frame)`);
  let left = 1200, frames = 0;
  while (left > 0 && frames < 200) { left -= paceReveal(left, 16); frames++; }
  assert.ok(frames >= 8 && frames <= 60, `cleared in ${frames} frames`);
  assert.equal(paceReveal(10, 1e9), 10);
  assert.ok(paceReveal(50, NaN) >= 1);
});

test("fadeTier: faint, then clearer, then fully shown after FADE_MS", () => {
  assert.equal(fadeTier(0), 0);
  assert.ok((fadeTier(FADE_MS * 0.5) ?? -1) >= 1);
  assert.equal(fadeTier(FADE_MS - 1), 2);
  assert.equal(fadeTier(FADE_MS), null);
  assert.equal(fadeTier(-5), 0);
});

test("countdown ticks every second between updates and never invents a time", () => {
  const at = 1_000_000;
  assert.deepEqual(countdown(3, at, at), { secs: 180, text: "3:00" });
  assert.equal(countdown(3, at, at + 61_000)?.text, "1:59");
  assert.equal(countdown(1, at, at + 120_000)?.secs, 1, "never below 0:01 while running");
  assert.equal(countdown(null, at, at), null);
  assert.equal(countdown(45, at, at)?.text, "45 min");
  assert.equal(countdown(180, at, at)?.text, "3 h");
});

test("ringOffset and stepChanges", () => {
  const r = ringOffset(0.25, 48);
  assert.ok(Math.abs(r.len - 2 * Math.PI * 48) < 1e-9);
  assert.ok(Math.abs(r.offset - r.len * 0.75) < 1e-9);
  assert.equal(ringOffset(2, 48).offset, 0);
  assert.equal(ringOffset(NaN, 48).offset, ringOffset(0, 48).len);
  assert.deepEqual(stepChanges(["done", "now", "next"], ["done", "done", "now"]), [1, 2]);
  assert.deepEqual(stepChanges([], ["now"]), [], "first render: nothing pops");
});

// ---- CORE phase machine ----
const run = (events: [number, PhaseEvent | "tick"][]): PhaseState => events.reduce((s, [t, e]) => (e === "tick" ? phaseTick(s, t) : phaseReduce(s, e, t)), idlePhase(0));

test("phases: submit → thinking → tool (named) → writing → done → idle", () => {
  let s = phaseReduce(idlePhase(0), { type: "submit" }, 0);
  assert.equal(s.phase, "thinking");
  s = phaseReduce(s, { type: "tool", tool: "web_search" }, 600);
  assert.equal(s.phase, "tool"); assert.equal(s.tool, "web_search");
  assert.equal(phaseLabel(s, "en"), "Searching the web");
  assert.equal(phaseLabel(s, "et"), "Otsin veebist");
  s = phaseReduce(s, { type: "delta" }, 1300);
  assert.equal(s.phase, "writing");
  s = phaseReduce(s, { type: "done" }, 2000);
  assert.equal(s.phase, "done");
  s = phaseTick(s, 2000 + (SETTLE.done ?? 0));
  assert.equal(s.phase, "idle");
});

test("phases: a pose is held long enough to read; quick changes wait and the latest wins", () => {
  let s = phaseReduce(idlePhase(0), { type: "submit" }, 0);
  s = phaseReduce(s, { type: "tool", tool: "search_memory" }, 50); // too soon
  assert.equal(s.phase, "thinking"); assert.equal(s.next?.phase, "tool");
  s = phaseReduce(s, { type: "delta" }, 80);
  assert.equal(s.next?.phase, "writing", "the latest change replaces the waiting one");
  assert.equal(nextTickIn(s, 80), HOLD.thinking - 80);
  s = phaseTick(s, HOLD.thinking);
  assert.equal(s.phase, "writing"); assert.equal(s.next, null);
});

test("phases: errors and resets never wait; stray events are ignored", () => {
  let s = phaseReduce(idlePhase(0), { type: "submit" }, 0);
  s = phaseReduce(s, { type: "error" }, 10);
  assert.equal(s.phase, "error");
  assert.equal(phaseTick(s, 10 + (SETTLE.error ?? 0)).phase, "idle");
  const idle = idlePhase(0);
  assert.equal(phaseReduce(idle, { type: "delta" }, 5), idle, "a delta with no turn does nothing");
  assert.equal(phaseReduce(idle, { type: "tool", tool: "x" }, 5), idle);
  assert.equal(phaseReduce(idle, { type: "done" }, 5), idle);
  assert.equal(run([[0, { type: "submit" }], [5, { type: "reset" }]]).phase, "idle");
});

test("phases: listening comes from idle only and returns to idle", () => {
  let s = phaseReduce(idlePhase(0), { type: "listen" }, 0);
  assert.equal(s.phase, "listening");
  assert.equal(phaseLabel(s, "en"), "Listening");
  s = phaseReduce(s, { type: "listen_end" }, 100);
  assert.equal(s.phase, "idle");
  const busy = phaseReduce(idlePhase(0), { type: "submit" }, 0);
  assert.equal(phaseReduce(busy, { type: "listen" }, 900).phase, "thinking", "the mic doesn't interrupt a turn's pose");
  assert.equal(phaseLabel({ phase: "tool", tool: "mystery_tool" }, "en"), "Using a tool", "unknown tools get plain words, not their name");
  assert.equal(nextTickIn(idlePhase(0), 0), null, "idle sleeps");
});

// ---- Follow rules ----
const ctx = (o: Partial<FollowCtx> = {}): FollowCtx => ({ follow: true, typing: false, lastInputMs: 0, lastScrollMs: 0, nowMs: 100_000, onHome: true, canFly: true, ...o });

test("follow: flies on home, opens directly without 3D, and never moves him while busy", () => {
  assert.equal(followMove(ctx()), "fly");
  assert.equal(followMove(ctx({ canFly: false })), "open");
  assert.equal(followMove(ctx({ follow: false })), "pill");
  assert.equal(followMove(ctx({ typing: true })), "pill");
  assert.equal(followMove(ctx({ onHome: false })), "pill", "inside a world or panel: only the pill");
  assert.equal(followMove(ctx({ lastInputMs: 100_000 - 1000 })), "pill", "typed a second ago");
  assert.equal(followMove(ctx({ lastScrollMs: 100_000 - (QUIET_MS - 1) })), "pill", "still reading");
  assert.equal(followMove(ctx({ lastScrollMs: 100_000 - QUIET_MS })), "fly", "quiet long enough");
});

test("follow: only his own requests, only new jobs, the view overlaps the fly's end", () => {
  assert.equal(followStored(null), true);
  assert.equal(followStored("0"), false);
  assert.equal(fromHisRequest(0, 5000), false, "no request yet: a scheduled job never pulls the view");
  assert.equal(fromHisRequest(1000, 1000 + REQUEST_WINDOW_MS - 1), true);
  assert.equal(fromHisRequest(1000, 1000 + REQUEST_WINDOW_MS), false);
  assert.deepEqual(newJobs(new Set(["a"]), ["a", "b", "c"]), ["b", "c"]);
  assert.ok(openDelay("fly") > 0 && openDelay("fly") < DUR.fly, "the view starts before the camera lands");
  assert.equal(openDelay("open"), 0);
  assert.equal(followPlanet({ title: "Make 3 Shorts from my last video", agent: "nova", request: null }), "studio");
  assert.equal(followPlanet({ title: "Fix the pet follow lag", agent: "forge", request: "roblox game" }), "creation");
});

test("follow: the CORE chat over the galaxy counts as home; a world, another drawer or a busy view does not", () => {
  const h = (o: Partial<Parameters<typeof followHome>[0]> = {}) => followHome({ shown: null, panel: null, behind: null, busy: false, ...o });
  assert.equal(h(), true);
  assert.equal(h({ panel: "core" }), true, "a job CORE starts from the chat flies like the demo");
  assert.equal(h({ panel: "core", behind: "arch" }), false, "CORE opened over a world: pill only");
  assert.equal(h({ panel: "settings" }), false);
  assert.equal(h({ shown: "studio" }), false);
  assert.equal(h({ busy: true }), false);
});
