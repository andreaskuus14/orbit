// ORBIT motion tokens and helpers (feat/ui-motion). One set of durations and curves for CSS (src/app/motion.css reads the same
// numbers as custom properties) and for JS (the galaxy camera fly, stream pacing, countdowns). Pure; tests in tests/ui-motion.test.ts.
// References and the reasons for each number: reports/ui-motion-refs.md (enter/exit ease-out, on-screen moves ease-in-out, never
// ease-in on UI, UI under 300 ms except sheets, a camera fly ~800 ms with anticipation and a hold).

/** Durations in ms. instant: press/hover · quick: small popovers, chips · base: cards, sheets · slow: big views · fly: the camera. */
export const DUR = { instant: 120, quick: 200, base: 320, slow: 500, fly: 800 } as const;
export type DurName = keyof typeof DUR;

/** CSS cubic-bezier control points. out: enter/exit · inOut: moving on screen · drawer: sheets · settle: tiny overshoot for a "done" pop. */
export const CURVE = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
  settle: [0.34, 1.36, 0.64, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type CurveName = keyof typeof CURVE;
export const cssCurve = (n: CurveName) => `cubic-bezier(${CURVE[n].join(", ")})`;

/** Springs as (stiffness, damping, mass). gentle: alive things (the orb) · snappy: chips and marks. Bounce stays low on UI. */
export const SPRING = { gentle: { k: 120, c: 16, m: 1 }, snappy: { k: 380, c: 30, m: 1 } } as const;

/** Is the new motion on? ORBIT_UI_MOTION: unset or anything but "0"/"off"/"false" = on (default); "0" brings back the old look. */
export function motionOn(env: string | undefined | null): boolean {
  const v = (env ?? "").trim().toLowerCase();
  return !(v === "0" || v === "off" || v === "false" || v === "no");
}

/** Reduced motion is gentler, not zero: movement drops to 0 ms, fades keep a short duration. */
export function dur(name: DurName, reduced: boolean, kind: "move" | "fade" = "move"): number {
  if (!reduced) return DUR[name];
  return kind === "fade" ? Math.min(DUR[name], DUR.quick) : 0;
}

/** Cubic bezier (x1,y1,x2,y2) as y(x), solved by Newton then bisection. Same shape as the CSS curve with the same points. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    if (!(t > 0)) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) { const e = sx(u) - t, d = dx(u); if (Math.abs(e) < 1e-6) return sy(u); if (Math.abs(d) < 1e-6) break; u -= e / d; }
    let lo = 0, hi = 1; u = t;
    for (let i = 0; i < 30; i++) { const v = sx(u); if (Math.abs(v - t) < 1e-6) break; if (v < t) lo = u; else hi = u; u = (lo + hi) / 2; }
    return sy(u);
  };
}
export const ease = Object.fromEntries((Object.keys(CURVE) as CurveName[]).map((k) => [k, bezier(CURVE[k][0], CURVE[k][1], CURVE[k][2], CURVE[k][3])])) as Record<CurveName, (t: number) => number>;

/** The camera's fly curve, 0..1 over the flight. Anticipation: in the first `pull` of the time it eases back slightly
 *  (down to -dip), then an ease-in-out carries it to 1 and it holds there (the last `hold` of the time is at rest). */
export function flyEase(t: number, o: { pull?: number; dip?: number; hold?: number } = {}): number {
  const pull = o.pull ?? 0.14, dip = o.dip ?? 0.035, hold = o.hold ?? 0.1;
  if (!(t > 0)) return 0;
  if (t >= 1 - hold) return 1;
  if (t < pull) { const u = t / pull; return -dip * Math.sin(Math.PI * u * 0.5) ** 2 * (1 - u * 0.15); } // ease back, still moving out of it
  const start = -dip * Math.sin(Math.PI * 0.5) ** 2 * 0.85;
  const u = (t - pull) / (1 - pull - hold);
  return start + (1 - start) * ease.inOut(u);
}

/** One step of a damped spring toward `to` (semi-implicit Euler, dt in s, sub-stepped). Returns [x, v]. */
export function springStep(x: number, v: number, to: number, dt: number, s: { k: number; c: number; m: number } = SPRING.gentle): [number, number] {
  const steps = Math.max(1, Math.ceil(Math.min(0.1, Math.max(0, dt)) / (1 / 240)));
  const h = Math.min(0.1, Math.max(0, dt)) / steps;
  for (let i = 0; i < steps; i++) { const a = (-s.k * (x - to) - s.c * v) / s.m; v += a * h; x += v * h; }
  return [x, v];
}

/** Stream pacing: how many characters of the backlog to show this frame. The backlog is cleared within ~`catchUpMs` (bursts
 *  don't land as a wall), never slower than `minCps`, and a small backlog shows at once so short replies don't feel delayed. */
export function paceReveal(backlog: number, dtMs: number, o: { catchUpMs?: number; minCps?: number; instantBelow?: number } = {}): number {
  const catchUp = o.catchUpMs ?? 240, minCps = o.minCps ?? 320, instant = o.instantBelow ?? 3;
  if (!(backlog > 0)) return 0;
  if (backlog <= instant) return backlog;
  const dt = Math.max(0, Math.min(100, Number.isFinite(dtMs) ? dtMs : 16));
  const n = Math.max(backlog * (dt / catchUp), (minCps * dt) / 1000, 1);
  return Math.min(backlog, Math.ceil(n));
}

/** Streamed text fades in by age: 0 = just arrived (faint) … FADE_TIERS-1, then null = fully shown. ~250 ms total. */
export const FADE_TIERS = 3;
export const FADE_MS = 250;
export function fadeTier(ageMs: number): number | null {
  if (!(ageMs >= 0)) return 0;
  if (ageMs >= FADE_MS) return null;
  return Math.min(FADE_TIERS - 1, Math.floor((ageMs / FADE_MS) * FADE_TIERS));
}

/** "Time left" that counts down every second between server updates: minutes left as of `atMs`, shown at `nowMs` as m:ss
 *  (or "about N min" for long jobs). Never below 0:01 while running; null when unknown (never invented). */
export function countdown(leftMin: number | null, atMs: number, nowMs: number): { secs: number; text: string } | null {
  if (leftMin === null || !Number.isFinite(leftMin) || !Number.isFinite(atMs)) return null;
  const secs = Math.max(1, Math.round(leftMin * 60 - Math.max(0, nowMs - atMs) / 1000));
  if (secs >= 3600) return { secs, text: `${Math.round(secs / 3600)} h` };
  if (secs >= 600) return { secs, text: `${Math.round(secs / 60)} min` };
  return { secs, text: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` };
}

/** The progress ring: share done 0..1 → stroke-dashoffset for a circle of radius r. */
export function ringOffset(share: number, r: number): { len: number; offset: number } {
  const len = 2 * Math.PI * r;
  const s = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
  return { len, offset: len * (1 - s) };
}

/** Which steps changed state since the last render, so only those animate (a ✓ pops once, the new ● starts its pulse). */
export function stepChanges(prev: readonly string[], next: readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < next.length; i++) if (prev[i] !== undefined && prev[i] !== next[i]) out.push(i);
  return out;
}

/** The tokens as CSS custom properties (motion.css declares the same values; tests keep them in step). */
export function motionCssVars(): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, ms] of Object.entries(DUR)) v[`--dur-${k}`] = `${ms}ms`;
  for (const k of Object.keys(CURVE) as CurveName[]) v[`--ease-${k === "inOut" ? "in-out" : k}`] = cssCurve(k);
  return v;
}
