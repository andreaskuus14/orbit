// Decode type, the pure half: the scramble schedule (letters lock in left to right with a seeded stagger, cycling
// alien glyphs that turn mono just before they lock) and particle type (a text alpha mask → points, then assemble /
// disperse steps that work in place on preallocated typed arrays). No DOM, so it runs under node --test.
import { expDamp } from "./smooth-damp-pure.ts";

/** Far from locking a letter shows an alien glyph; in its last FLASH_LEAD ms it turns machine-mono. */
export const ALIEN_GLYPHS = Array.from("⟁⌖⍜⏃⏚⊑⟟⋔⌇⍀⎍⏁⟒⋏ΔΞΣΨΩ∇≡◊△▽");
export const MONO_GLYPHS = Array.from("0123456789ABCDEFX#%&*+=/<>");
export const FLASH_LEAD = 160;

/** Letters and digits decode; spaces and punctuation ("·", ".", "+") stay put so the shape of the line reads early. */
export const isDecodable = (c: string) => /^[A-Za-z0-9]$/.test(c);

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small stable string hash: the same word always decodes the same way. */
export function textSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** When (ms from the start) each of n letters locks: nothing for the first `lead` of the run (everything cycles), then
 *  one slot per letter left to right, each pulled earlier by up to `jitter` of a slot. Strictly increasing; last <= ms. */
export function lockTimes(n: number, ms: number, seed = 1, lead = 0.28, jitter = 0.7): number[] {
  const out: number[] = [];
  if (!(n > 0)) return out;
  const total = Number.isFinite(ms) && ms > 0 ? ms : 0, r = rng(seed), slot = (total * (1 - lead)) / n;
  for (let i = 0; i < n; i++) out.push(total * lead + slot * (i + 1) - slot * jitter * r());
  return out;
}

/** The glyph letter i shows on cycle `tick` with `toLock` ms left before it locks. Deterministic. */
export function glyphFor(seed: number, i: number, tick: number, toLock: number): string {
  const set = toLock < FLASH_LEAD ? MONO_GLYPHS : ALIEN_GLYPHS;
  const h = Math.imul((seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(tick + 7, 0x85ebca6b)) >>> 0, 0xc2b2ae35) >>> 0;
  return set[((h ^ (h >>> 15)) >>> 0) % set.length];
}

/* ---------- particle type ---------- */

/** Points where a text mask (canvas RGBA, w × h) is mostly opaque, on a `step` px grid with a little seeded jitter so
 *  it never reads as a grid. Thinned evenly to at most `max`. Writes x, y pairs (mask px) into `out`; returns the count. */
export function samplePoints(rgba: ArrayLike<number>, w: number, h: number, step: number, max: number, out: Float32Array, seed = 7): number {
  const s = Math.max(1, Math.floor(step) || 1), cap = Math.min(Math.floor(max) || 0, out.length >> 1);
  if (cap <= 0 || !(w > 0) || !(h > 0)) return 0;
  let total = 0;
  for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) if (rgba[(y * w + x) * 4 + 3] > 127) total++;
  const every = total > cap ? total / cap : 1, r = rng(seed);
  let n = 0, acc = every; // the first hit is kept
  for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
    if (rgba[(y * w + x) * 4 + 3] <= 127) continue;
    if ((acc += 1) < every + 1 || n >= cap) continue;
    acc -= every;
    out[n * 2] = x + (r() - 0.5) * s * 0.8; out[n * 2 + 1] = y + (r() - 0.5) * s * 0.8; n++;
  }
  return n;
}

/** One particle cloud. Every array is allocated once (max particles); n of them are live. Coordinates in CSS px. */
export type Pool = { n: number; x: Float32Array; y: Float32Array; tx: Float32Array; ty: Float32Array; jx: Float32Array; jy: Float32Array;
  delay: Float32Array; tau: Float32Array; tauY: Float32Array; a: Float32Array };
export function newPool(max: number): Pool {
  const f = () => new Float32Array(max);
  return { n: 0, x: f(), y: f(), tx: f(), ty: f(), jx: f(), jy: f(), delay: f(), tau: f(), tauY: f(), a: f() };
}

/** Arms an assembly onto the targets already in tx/ty: each particle leaves the origin (plus its own jitter) after its
 *  delay, left letters first like the decode, then glides home. Different x/y glide times bend the paths into a stream. */
export function primeAssemble(p: Pool, left: number, width: number, ox: number, oy: number, emit = 0.34, seed = 3) {
  const r = rng(seed);
  for (let i = 0; i < p.n; i++) {
    const u = width > 0 ? Math.min(1, Math.max(0, (p.tx[i] - left) / width)) : 0, ang = r() * Math.PI * 2, rad = 3 + 20 * Math.sqrt(r());
    p.delay[i] = emit * (0.6 * u + 0.4 * r());
    p.tau[i] = 0.07 + 0.07 * r(); p.tauY[i] = p.tau[i] * (0.55 + 0.9 * r());
    p.jx[i] = Math.cos(ang) * rad; p.jy[i] = Math.sin(ang) * rad;
    p.x[i] = ox + p.jx[i]; p.y[i] = oy + p.jy[i]; p.a[i] = 0;
  }
}

/** One assembly frame at t s since the start, origin (ox, oy) tracked live. Returns how many are still > 1.5 px out. */
export function stepAssemble(p: Pool, t: number, dt: number, ox: number, oy: number): number {
  let far = 0;
  for (let i = 0; i < p.n; i++) {
    if (t < p.delay[i]) { p.x[i] = ox + p.jx[i]; p.y[i] = oy + p.jy[i]; far++; continue; } // waiting at the planet
    p.x[i] = expDamp(p.x[i], p.tx[i], p.tau[i], dt); p.y[i] = expDamp(p.y[i], p.ty[i], p.tauY[i], dt);
    p.a[i] = expDamp(p.a[i], 1, 0.06, dt);
    if (Math.abs(p.x[i] - p.tx[i]) + Math.abs(p.y[i] - p.ty[i]) > 1.5) far++;
  }
  return far;
}

/** Arms a dispersal from wherever the particles are now: out from the word's centre (cx, cy), a little upward. */
export function primeDisperse(p: Pool, cx: number, cy: number, seed = 5) {
  const r = rng(seed);
  for (let i = 0; i < p.n; i++) {
    const dx = p.x[i] - cx, dy = p.y[i] - cy, d = Math.hypot(dx, dy) || 1, push = 40 + 150 * r();
    p.tx[i] = p.x[i] + (dx / d) * push + (r() - 0.5) * 70;
    p.ty[i] = p.y[i] + (dy / d) * push * 0.5 - 40 * r();
    p.delay[i] = 0.16 * r(); p.tau[i] = 0.2 + 0.15 * r(); p.tauY[i] = p.tau[i]; // alpha carries over: unlaunched ones stay unseen
  }
}

/** One dispersal frame. Returns how many particles are still visible (alpha > 0.01). */
export function stepDisperse(p: Pool, t: number, dt: number): number {
  let vis = 0;
  for (let i = 0; i < p.n; i++) {
    if (t >= p.delay[i]) {
      p.x[i] = expDamp(p.x[i], p.tx[i], p.tau[i], dt); p.y[i] = expDamp(p.y[i], p.ty[i], p.tauY[i], dt);
      p.a[i] = expDamp(p.a[i], 0, 0.15, dt);
    }
    if (p.a[i] > 0.01) vis++;
  }
  return vis;
}
