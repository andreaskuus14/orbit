// "Follow action" reframing: where a 9:16 window should sit over a wider video, from cheap motion + edge energy on tiny grey frames.
// Pure math (tested) plus one ffmpeg reader. Positions p are 0..1 of the crop's travel: 0 = left edge, 0.5 = centre, 1 = right edge.
import { spawn } from "node:child_process";

export type Key = { t: number; p: number }; // clip seconds → crop position; two keys at the same t = a hard jump (scene cut)
type Span = { start: number; end: number };

export const TRACK_FPS = 4, TRACK_W = 160, TRACK_H = 90; // ffmpeg scales to exactly this (aspect distortion doesn't matter for columns)
const NOISE = 10; // per-pixel grey difference below this is compression noise
const EDGE_W = 0.25; // edges keep a still subject (talking head) framed; motion wins whenever something moves
const CENTER_BIAS = 0.15; // a flat-ish frame prefers the middle
const CUT_MAD = 30; // mean |frame diff| (0..255) over which a frame is a new shot...
const CUT_RATIO = 2.5; // ...and also this many times the previous frame's (busy gameplay is not a cut)

/** Per sample: column energy, and whether it starts a new shot. */
export function frameEnergy(frames: Uint8Array[], w: number, h: number): { energy: Float64Array[]; cuts: boolean[] } {
  const energy: Float64Array[] = [], cuts: boolean[] = [];
  let prevMad = 0;
  frames.forEach((f, i) => {
    const e = new Float64Array(w), prev = frames[i - 1];
    let mad = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (x < w - 1) e[x] += EDGE_W * Math.abs(f[k + 1] - f[k]);
      if (prev) { const d = Math.abs(f[k] - prev[k]); mad += d; if (d > NOISE) e[x] += d; }
    }
    mad /= w * h;
    const cut = i > 0 && mad > CUT_MAD && mad > CUT_RATIO * Math.max(prevMad, 4);
    if (cut) { e.fill(0); for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) e[x] += EDGE_W * Math.abs(f[y * w + x + 1] - f[y * w + x]); } // diff across a cut is meaningless
    energy.push(e); cuts.push(cut); prevMad = mad;
  });
  return { energy, cuts };
}

/** The best window of cw columns (as a 0..1 position), or null when nothing stands out (keep the camera still). */
export function bestWindow(e: ArrayLike<number>, cw: number): number | null {
  const n = e.length, travel = n - cw;
  if (travel <= 0) return 0.5;
  const pre = [0];
  for (let i = 0; i < n; i++) pre.push(pre[i] + e[i]);
  const mean = (pre[n] * cw) / n;
  let best = -1, at = 0;
  for (let s = 0; s <= travel; s++) {
    const p = s / travel, score = (pre[s + cw] - pre[s]) * (1 - CENTER_BIAS * Math.abs(p - 0.5) * 2);
    if (score > best) { best = score; at = p; }
  }
  return best > 1.15 * mean && pre[n] > 0 ? at : null;
}

/** Camera-operator smoothing: hold inside a dead zone, then pan at most `speed` (positions/s) until on target; a cut jumps
 *  (at the midpoint between the two samples). Collinear keys are dropped, so holds and steady pans are 2 keys each. */
export function smoothPath(samples: { t: number; p: number | null; cut?: boolean }[], o = { dead: 0.12, speed: 0.35 }): Key[] {
  const keys: Key[] = [];
  let pos = 0.5, moving = false;
  samples.forEach((s, i) => {
    if (i === 0 || s.cut) {
      const tc = i ? (samples[i - 1].t + s.t) / 2 : s.t;
      if (i) keys.push({ t: tc, p: pos });
      pos = shotStart(samples, i); moving = false;
      keys.push({ t: tc, p: pos });
      if (i && tc < s.t) keys.push({ t: s.t, p: pos });
      return;
    }
    const d = (s.p ?? pos) - pos;
    if (Math.abs(d) > o.dead) moving = true; // hysteresis: start outside the dead zone, stop only on target
    if (moving) {
      const step = o.speed * (s.t - samples[i - 1].t);
      pos += Math.abs(d) <= step ? d : Math.sign(d) * step;
      if (Math.abs((s.p ?? pos) - pos) < 0.02) moving = false;
    }
    keys.push({ t: s.t, p: pos });
  });
  return simplify(keys);
}

/** Where a shot opens: the median target of its first second (one noisy sample would set off a pan), centre if none. */
function shotStart(samples: { t: number; p: number | null; cut?: boolean }[], i: number): number {
  const ps: number[] = [];
  for (let j = i; j < samples.length && samples[j].t - samples[i].t < 1 && (j === i || !samples[j].cut); j++) if (samples[j].p !== null) ps.push(samples[j].p!);
  if (!ps.length) return 0.5;
  ps.sort((a, b) => a - b);
  const m = ps.length >> 1;
  return ps.length % 2 ? ps[m] : (ps[m - 1] + ps[m]) / 2;
}

function simplify(keys: Key[], tol = 1e-4): Key[] {
  const out: Key[] = [];
  keys.forEach((k, i) => {
    const a = out[out.length - 1], b = keys[i + 1];
    if (a && b && b.t > a.t && Math.abs((k.p - a.p) * (b.t - a.t) - (b.p - a.p) * (k.t - a.t)) < tol * (b.t - a.t)) return;
    if (a && a.t === k.t && a.p === k.p) return;
    out.push(k);
  });
  return out;
}

/** Position at t (clip seconds): linear between keys, held before the first and after the last; at a jump, the later key. */
export function pathAt(keys: Key[], t: number): number {
  if (!keys.length) return 0.5;
  if (t < keys[0].t) return keys[0].p;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t < b.t) return a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t);
  }
  return keys[keys.length - 1].p;
}

/** Clip-time keys → keys on the edited timeline (optional teaser first, then the kept segments back to back, like renderFilter). */
export function remapPath(keys: Key[], segs: Span[], teaser?: Span): Key[] {
  if (!keys.length) return [];
  const out: Key[] = [];
  let off = 0;
  for (const s of teaser ? [teaser, ...segs] : segs) {
    out.push({ t: off, p: pathAt(keys, s.start) });
    for (const k of keys) if (k.t > s.start && k.t < s.end) out.push({ t: off + k.t - s.start, p: k.p });
    off += s.end - s.start;
    out.push({ t: off, p: pathAt(keys, s.end - 1e-6) });
  }
  return simplify(out);
}

const n4 = (x: number) => String(Math.round(x * 10000) / 10000);
const signed = (x: number) => (x < 0 ? `-${n4(-x)}` : `+${n4(x)}`);

/** ffmpeg expression in t for pathAt(keys, t). A flat sum of gated terms, not nested if()s: ffmpeg's parser caps nesting depth. */
export const MAX_KEYS = 300; // ~60 chars a key: keeps the filter graph well inside Windows' 32 K command line

/** At most MAX_KEYS keys: a looser simplify first (drift ≤ tol of the pan range), then plain decimation as a last resort. */
export function capKeys(keys: Key[]): Key[] {
  for (let tol = 1e-3; keys.length > MAX_KEYS && tol <= 0.05; tol *= 2) keys = simplify(keys, tol);
  if (keys.length <= MAX_KEYS) return keys;
  const step = Math.ceil(keys.length / (MAX_KEYS - 1));
  return keys.filter((_, i) => i % step === 0 || i === keys.length - 1);
}

export function pathExpr(keys: Key[]): string {
  keys = capKeys(keys);
  if (!keys.length) return "0.5";
  if (keys.length === 1) return n4(keys[0].p);
  const terms = [`lt(t,${n4(keys[0].t)})*${n4(keys[0].p)}`];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (b.t <= a.t || (a.p === 0 && b.p === 0)) continue;
    const k = (b.p - a.p) / (b.t - a.t);
    terms.push(`gte(t,${n4(a.t)})*lt(t,${n4(b.t)})*` + (Math.abs(k) < 1e-6 ? n4(a.p) : `(${n4(a.p)}${signed(k)}*(t-${n4(a.t)}))`));
  }
  const z = keys[keys.length - 1];
  terms.push(`gte(t,${n4(z.t)})*${n4(z.p)}`);
  return terms.join("+");
}

/** Raw grey frames (TRACK_W x TRACK_H, TRACK_FPS) of one clip + its source aspect → smoothed keys in clip seconds ([] = centre). */
export function analyse(buf: Uint8Array, aspect: number): Key[] {
  const frac = 9 / 16 / aspect; // crop width as a fraction of the source width
  const size = TRACK_W * TRACK_H, n = Math.floor(buf.length / size);
  if (frac >= 0.99 || n < 2) return [];
  const frames = Array.from({ length: n }, (_, i) => buf.subarray(i * size, (i + 1) * size));
  const { energy, cuts } = frameEnergy(frames, TRACK_W, TRACK_H);
  const cw = Math.max(1, Math.round(TRACK_W * frac));
  const shot: number[] = []; // shot index per sample, so the time-averaging never mixes two shots
  cuts.forEach((c, i) => shot.push(i ? shot[i - 1] + (c ? 1 : 0) : 0));
  const R = 2; // ±0.5 s of averaging: a single busy frame doesn't move the camera
  return smoothPath(energy.map((_, i) => {
    const e = new Float64Array(TRACK_W);
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) if (shot[j] === shot[i]) energy[j].forEach((v, x) => { e[x] += v; });
    return { t: i / TRACK_FPS, p: bestWindow(e, cw), cut: cuts[i] };
  }));
}

/** Runs ffmpeg with trackArgs (pure.ts) and analyses its raw output; the source aspect comes from ffmpeg's input stream line. */
export const TRACK_FAIL = "Follow action: tracking failed, used a centre crop";

export function trackAction(ff: string, args: string[], signal: AbortSignal, timeoutMs = 5 * 60_000): Promise<Key[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(ff, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal, killSignal: "SIGKILL" });
    const out: Buffer[] = [];
    let head = "", tail = ""; // head: the input stream lines (aspect), tail: the last error line
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => {
      const t = b.toString();
      if (head.length < 20_000 && !head.includes("Output #0")) head += t;
      tail = (tail + t).slice(-2000);
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const m = /Stream #0:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(head.split("Output #0")[0]);
      if (code !== 0 || !m) return reject(new Error(`tracking failed: ${tail.split("\n").filter(Boolean).pop() ?? code}`));
      resolve(analyse(Buffer.concat(out), +m[1] / +m[2]));
    });
  });
}
