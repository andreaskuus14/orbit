// CORE thinking orb (WebGL look, feat/ui-motion): what each pose looks like as shader numbers, and how the orb moves between
// poses. Every value is a function of time, so a frame at time t is always the same (the motion test steps a fixed clock).
// Principles: each channel eases in/out on its own clock with a small stagger (overlap); entering "thinking" pulls back a
// little first (anticipation) and overshoots slightly (follow-through); tool / done / error play short one-shots on top.
// Pure; tests in tests/orb-motion.test.ts. The shader lives in components/motion/orb-shader.ts.
import type { CorePhase } from "./core-phase-pure.ts";

/** Smooth channels (each eases from where it is to the pose's value). */
export type OrbTargets = {
  swirlSpeed: number; // rad/s the liquid turns
  flowSpeed: number; // how fast the liquid's pattern changes
  core: number; // 0 loose swirl … 1 tight bright core
  threads: number; // 0 a few threads … 1 dense web
  sparks: number; // share of threads carrying a spark
  sparkSpeed: number; // how fast sparks travel
  glow: number; // rim + bloom strength
  leanX: number; leanY: number; // swirl centre offset (sphere radii; y up, the input is below)
  breathAmp: number; breathRate: number; // size breathing (fraction, Hz)
  ringSpeed: number; ringGlow: number; // orbit ring turn (rad/s) and brightness
};
export const ORB_CHANNELS = ["swirlSpeed", "flowSpeed", "core", "threads", "sparks", "sparkSpeed", "glow", "leanX", "leanY", "breathAmp", "breathRate", "ringSpeed", "ringGlow"] as const satisfies readonly (keyof OrbTargets)[];
export type OrbChannel = (typeof ORB_CHANNELS)[number];

const IDLE: OrbTargets = { swirlSpeed: 0.12, flowSpeed: 0.05, core: 0.22, threads: 0.25, sparks: 0.12, sparkSpeed: 0.12, glow: 0.55, leanX: 0, leanY: 0, breathAmp: 0.012, breathRate: 0.16, ringSpeed: 0.05, ringGlow: 0.35 };

/** The pose targets. idle calm · listening leans toward the input and breathes · thinking tight bright core, dense web, fast
 *  sparks (combo-think) · tool busy, ring lit · writing steady flow · done/error calm like idle (their one-shots do the rest). */
export const ORB_TARGETS: Record<CorePhase, OrbTargets> = {
  idle: IDLE,
  listening: { ...IDLE, swirlSpeed: 0.2, flowSpeed: 0.08, core: 0.34, threads: 0.38, sparks: 0.22, sparkSpeed: 0.22, glow: 0.72, leanY: -0.16, breathAmp: 0.028, breathRate: 0.45, ringGlow: 0.45 },
  thinking: { ...IDLE, swirlSpeed: 0.6, flowSpeed: 0.2, core: 1, threads: 1, sparks: 0.9, sparkSpeed: 0.95, glow: 0.92, breathAmp: 0.01, breathRate: 0.55, ringSpeed: 0.14, ringGlow: 0.6 },
  tool: { ...IDLE, swirlSpeed: 0.42, flowSpeed: 0.15, core: 0.78, threads: 0.82, sparks: 0.6, sparkSpeed: 0.6, glow: 0.86, breathAmp: 0.01, breathRate: 0.4, ringSpeed: 0.14, ringGlow: 0.85 },
  writing: { ...IDLE, swirlSpeed: 0.34, flowSpeed: 0.17, core: 0.6, threads: 0.66, sparks: 0.5, sparkSpeed: 0.5, glow: 0.8, breathAmp: 0.008, breathRate: 0.3, ringSpeed: 0.09, ringGlow: 0.5 },
  done: { ...IDLE, swirlSpeed: 0.14, core: 0.32, threads: 0.32, sparks: 0.14, glow: 0.62, breathRate: 0.18 },
  error: { ...IDLE, swirlSpeed: 0.1, sparks: 0.05, glow: 0.5 },
};

/** Stagger per channel (ms): the core leads, the web follows, sparks come last (overlapping action). */
export const ORB_DELAY: Record<OrbChannel, number> = { core: 0, glow: 0, swirlSpeed: 60, flowSpeed: 60, leanX: 0, leanY: 0, breathAmp: 80, breathRate: 80, threads: 140, ringSpeed: 100, ringGlow: 100, sparks: 220, sparkSpeed: 220 };

/** How long a move into `to` takes (ms). Speeding up is quicker than calming down; settling home is slow. */
export function orbDuration(to: CorePhase): number {
  switch (to) {
    case "thinking": return 760;
    case "tool": return 420;
    case "writing": return 520;
    case "listening": return 560;
    case "done": return 900;
    case "error": return 300;
    case "idle": return 1400;
  }
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeInOutCubic = (t: number) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
/** In-out with a small pull back at the start (anticipation) and a small overshoot at the end (follow-through). s = how much. */
export function easeAnticipate(t: number, s = 1.1): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c = s * 1.525;
  return t < 0.5 ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2 : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
}

/** Channels that anticipate when the orb starts thinking (the core gathers itself before it tightens). */
const ANTICIPATE: ReadonlySet<OrbChannel> = new Set(["core", "glow", "swirlSpeed"]);

export type OrbMotion = { phase: CorePhase; start: number; from: OrbTargets; to: OrbTargets; since: number; beatAt: number };

export const orbMotionInit = (phase: CorePhase = "idle", now = 0): OrbMotion => ({ phase, start: now, from: ORB_TARGETS[phase], to: ORB_TARGETS[phase], since: now, beatAt: -1e9 });

/** Eased progress of one channel at `now` (0…1, may briefly leave 0…1 when anticipating). */
export function channelProgress(m: OrbMotion, ch: OrbChannel, now: number): number {
  const t = (now - m.start - ORB_DELAY[ch]) / orbDuration(m.phase);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return m.phase === "thinking" && ANTICIPATE.has(ch) ? easeAnticipate(t) : easeInOutCubic(t);
}

/** Smooth channel values at `now`. */
export function orbValues(m: OrbMotion, now: number): OrbTargets {
  const out = {} as OrbTargets;
  for (const ch of ORB_CHANNELS) out[ch] = m.from[ch] + (m.to[ch] - m.from[ch]) * channelProgress(m, ch, now);
  return out;
}

/** A new pose: start from wherever every channel is right now (an interrupted move continues without a jump). */
export function orbRetarget(m: OrbMotion, phase: CorePhase, now: number): OrbMotion {
  if (phase === m.phase) return m;
  return { phase, start: now, from: orbValues(m, now), to: ORB_TARGETS[phase], since: now, beatAt: m.beatAt };
}

/** A text chunk arrived (writing): the threads pulse. Chunks closer than BEAT_MIN_MS merge into one beat (no strobe). */
export const BEAT_MIN_MS = 90;
export const BEAT_DECAY_MS = 240;
export function orbBeat(m: OrbMotion, now: number): OrbMotion {
  return now - m.beatAt < BEAT_MIN_MS ? m : { ...m, beatAt: now };
}
export const beatLevel = (m: OrbMotion, now: number) => (now < m.beatAt ? 0 : Math.exp(-(now - m.beatAt) / BEAT_DECAY_MS));

/** One-shot timings (ms after the pose starts). */
export const TOOL_PULSE_MS = 950; // a bright pulse travels from the core out past the rim
export const RING_BOOST_MS = 1300; // the ring spins up briefly, then coasts back
export const EXHALE_MS = 1100; // done: glow swells, then lets go
export const SHAKE_MS = 480; // error: small shake
export const DESAT_MS = 1500; // error: colour drains, then comes back

/** Up fast, down slow: 0 → 1 at `rise`, back to 0 at `end`. */
export function envelope(t: number, rise: number, end: number): number {
  if (t <= 0 || t >= end) return 0;
  if (t < rise) return easeOutCubic(t / rise);
  return 1 - easeInOutCubic((t - rise) / (end - rise));
}

export type OrbShots = { pulse: number; ringBoost: number; exhale: number; shakeX: number; shakeY: number; desat: number };
export const NO_SHOTS: OrbShots = { pulse: -1, ringBoost: 0, exhale: 0, shakeX: 0, shakeY: 0, desat: 0 };

/** The pose's one-shot at `tp` ms after it started. pulse: -1 = none, else 0…1 travel. shake in sphere radii. */
export function orbShots(phase: CorePhase, tp: number): OrbShots {
  if (tp < 0) return NO_SHOTS;
  switch (phase) {
    case "tool": return { ...NO_SHOTS, pulse: tp < TOOL_PULSE_MS ? tp / TOOL_PULSE_MS : -1, ringBoost: envelope(tp, 160, RING_BOOST_MS) };
    case "done": return { ...NO_SHOTS, exhale: envelope(tp, 260, EXHALE_MS) };
    case "error": {
      const k = tp < SHAKE_MS ? Math.exp(-tp / 150) * (1 - tp / SHAKE_MS) : 0;
      return { ...NO_SHOTS, shakeX: 0.035 * k * Math.sin(tp * 0.058), shakeY: 0.012 * k * Math.sin(tp * 0.041 + 1), desat: 0.85 * envelope(tp, 90, DESAT_MS) };
    }
    default: return NO_SHOTS;
  }
}

/** Integrated clocks (so a speed change never makes the pattern jump). */
export type OrbClock = { swirl: number; flow: number; spark: number; ring: number; breath: number };
export const orbClock0 = (): OrbClock => ({ swirl: 0, flow: 0, spark: 0, ring: 0, breath: 0 });
export const RING_BOOST_SPEED = 3.2; // extra rad/s at the top of the tool spin

/** Everything the shader needs for one frame. */
export type OrbUniforms = {
  swirl: number; flow: number; spark: number; ring: number;
  core: number; threads: number; sparks: number; glow: number; sat: number; beat: number; pulse: number; ringGlow: number;
  scale: number; leanX: number; leanY: number; shakeX: number; shakeY: number;
};

/** Advance the clocks by dt seconds and build the frame at `now` (ms). Deterministic for a fixed step. */
export function orbFrame(m: OrbMotion, clock: OrbClock, now: number, dt: number): { u: OrbUniforms; clock: OrbClock } {
  const v = orbValues(m, now);
  const s = orbShots(m.phase, now - m.since);
  const beat = beatLevel(m, now);
  const c: OrbClock = {
    swirl: clock.swirl + v.swirlSpeed * (1 + 0.25 * beat) * dt,
    flow: clock.flow + v.flowSpeed * dt,
    spark: clock.spark + v.sparkSpeed * dt,
    ring: clock.ring + (v.ringSpeed + RING_BOOST_SPEED * s.ringBoost) * dt,
    breath: (clock.breath + 2 * Math.PI * v.breathRate * dt) % (2 * Math.PI * 1000),
  };
  const exhaleScale = 0.035 * s.exhale;
  return {
    clock: c,
    u: {
      swirl: c.swirl, flow: c.flow, spark: c.spark, ring: c.ring,
      core: v.core, threads: clamp01(v.threads + 0.35 * beat), sparks: v.sparks, glow: v.glow + 0.4 * s.exhale + 0.18 * beat + 0.25 * s.ringBoost,
      sat: 1 - s.desat, beat, pulse: s.pulse, ringGlow: v.ringGlow + 0.6 * s.ringBoost,
      scale: 1 + v.breathAmp * Math.sin(c.breath) + exhaleScale, leanX: v.leanX, leanY: v.leanY, shakeX: s.shakeX, shakeY: s.shakeY,
    },
  };
}

/** Reduced motion: the pose as one still frame (no clocks, no one-shots). The component cross-fades between stills. */
export function orbStill(phase: CorePhase): OrbUniforms {
  const v = ORB_TARGETS[phase];
  return { swirl: 0.6, flow: 1.3, spark: 0.4, ring: 0.8, core: v.core, threads: v.threads, sparks: v.sparks, glow: v.glow, sat: 1, beat: 0, pulse: -1, ringGlow: v.ringGlow, scale: 1, leanX: v.leanX, leanY: v.leanY, shakeX: 0, shakeY: 0 };
}

/** Is the motion still changing (a move or one-shot in flight)? Lets a caller drop to a calmer frame rate when settled. */
export function orbSettled(m: OrbMotion, now: number): boolean {
  const maxDelay = Math.max(...ORB_CHANNELS.map((c) => ORB_DELAY[c]));
  const shotEnd = m.phase === "tool" ? RING_BOOST_MS : m.phase === "done" ? EXHALE_MS : m.phase === "error" ? DESAT_MS : 0;
  return now - m.start >= orbDuration(m.phase) + maxDelay && now - m.since >= shotEnd && beatLevel(m, now) < 0.01;
}

/** Quality tier for an orb drawn `px` CSS pixels wide (the sphere itself): 0 = small chat orb (2 noise octaves, one coarse web
 *  layer, no fibres or sheen), 1 = mid (3 octaves, fibres + sheen), 2 = 96 px and up (4 octaves, fine web layer too). */
export const ORB_TIER_MID_PX = 64;
export const ORB_TIER_FULL_PX = 96;
export const orbTier = (px: number): 0 | 1 | 2 => (px >= ORB_TIER_FULL_PX ? 2 : px >= ORB_TIER_MID_PX ? 1 : 0);

/** What to draw after `down` automatic step-downs: first drop tiers, then render fewer pixels (the canvas is upscaled). */
export const ORB_MAX_STEPS = 4;
export function orbQuality(sizeTier: number, down: number): { tier: number; dprScale: number } {
  const t = sizeTier - Math.max(0, down);
  return t >= 0 ? { tier: t, dprScale: 1 } : { tier: 0, dprScale: t === -1 ? 0.75 : 0.5 };
}

/** Automatic step-down when the orb costs too much. Samples are GPU time per frame (EXT_disjoint_timer_query) when the
 *  browser has it, otherwise the gap between animation frames compared with the fastest gap seen (the display's refresh).
 *  If most of the last window is over budget, step down once, then wait a cooldown before judging again. Never steps up by
 *  itself (a remount starts fresh), so the orb can't flicker between tiers. */
export const ORB_GPU_BUDGET_MS = 2.5; // a decoration: a small slice of a 16.7 ms frame
export const ORB_PERF_WINDOW = 30;
export const ORB_PERF_OVER = 20; // of the window
export const ORB_PERF_COOLDOWN_MS = 2500;
export type OrbPerf = { down: number; over: number; n: number; refreshMs: number; coolUntil: number };
export const orbPerfInit = (): OrbPerf => ({ down: 0, over: 0, n: 0, refreshMs: Infinity, coolUntil: 0 });
export function orbPerfSample(p: OrbPerf, s: { gpuMs?: number; frameMs?: number }, now: number): OrbPerf {
  if (now < p.coolUntil || p.down >= ORB_MAX_STEPS) return p;
  let over: boolean, refreshMs = p.refreshMs;
  if (s.gpuMs !== undefined && Number.isFinite(s.gpuMs)) over = s.gpuMs > ORB_GPU_BUDGET_MS;
  else if (s.frameMs !== undefined && s.frameMs > 0 && s.frameMs < 250) { // longer gaps: tab switch / debugger, not cost
    refreshMs = Math.min(refreshMs, Math.max(s.frameMs, 4));
    over = s.frameMs > refreshMs * 1.5 + 2;
  } else return p;
  const n = p.n + 1, o = p.over + (over ? 1 : 0);
  if (o >= ORB_PERF_OVER) return { down: p.down + 1, over: 0, n: 0, refreshMs, coolUntil: now + ORB_PERF_COOLDOWN_MS };
  if (n >= ORB_PERF_WINDOW) return { ...p, over: 0, n: 0, refreshMs };
  return { ...p, over: o, n, refreshMs };
}
/** Device pixel ratio used for the canvas (never above 2: cost grows with the square). */
export const orbDpr = (dpr: number | undefined) => Math.max(1, Math.min(2, dpr || 1));
