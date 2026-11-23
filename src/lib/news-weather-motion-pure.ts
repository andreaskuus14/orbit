// News weather → briefing flythrough: the camera, the choreography and label placement. Pure; tests in tests/news-weather.test.ts.
// The renderer (src/components/news-weather/weather-draw.ts) asks restScene/stopScene/backView for every value it animates, so
// the motion test (scripts/news-weather-motion-test.mjs) and the app play the same beats. Curves come from ui-motion-pure (one motion system).
import { ease, flyEase } from "./ui-motion-pure.ts";

const RAD = Math.PI / 180;
export type View = { lon: number; lat: number; scale: number; cx: number; cy: number };
export type P3 = { x: number; y: number; z: number };

/** Orthographic projection. z = cosine of the angle from the view centre: > 0 front, 0 the globe's edge, < 0 hidden.
 *  `alt` lifts the point off the surface (0.05 = 5% of the radius), used by the flight trail. */
export function project(v: View, lon: number, lat: number, alt = 0): P3 {
  const l = (lon - v.lon) * RAD, p = lat * RAD, p0 = v.lat * RAD, k = v.scale * (1 + alt);
  const X = Math.cos(p) * Math.sin(l), Y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l);
  const z = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
  return { x: v.cx + k * X, y: v.cy - k * Y, z };
}

/** 0 at the globe's edge → 1 from `inner` inward (smoothstep on z): isobars and labels fade toward the horizon. */
export function horizonFade(z: number, inner = 0.55, edge = 0.04): number {
  const u = Math.min(1, Math.max(0, (z - edge) / (inner - edge)));
  return u * u * (3 - 2 * u);
}

const vec = (lon: number, lat: number) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
/** Point at `t` along the great circle from a to b (spherical lerp), as [lon, lat]. */
export function slerp(a: [number, number], b: [number, number], t: number): [number, number] {
  const A = vec(a[0], a[1]), B = vec(b[0], b[1]);
  const d = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])), w = Math.acos(d);
  const s = Math.sin(w);
  const fa = s < 1e-6 ? 1 - t : Math.sin((1 - t) * w) / s, fb = s < 1e-6 ? t : Math.sin(t * w) / s;
  const x = fa * A[0] + fb * B[0], y = fa * A[1] + fb * B[1], z = fa * A[2] + fb * B[2];
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0..1 progress of a beat that starts at `start` and lasts `dur` ms. */
export const beat = (t: number, start: number, dur: number) => clamp01((t - start) / dur);

/** The camera between two views. Pan leads with anticipation (flyEase eases back first, then holds); zoom follows ~12% later
 *  (overlap) and pulls out mid-flight, so the camera arcs up and over instead of sliding across the map. */
export function flyView(a: View, b: View, t: number, arc = 0.2): View {
  const pan = flyEase(clamp01(t), { pull: 0.12, dip: 0.03, hold: 0.06 });
  const zt = ease.inOut(clamp01((t - 0.12) / 0.82));
  const [lon, lat] = slerp([a.lon, a.lat], [b.lon, b.lat], pan);
  const lift = 1 - arc * Math.sin(Math.PI * clamp01(pan));
  return { lon, lat, scale: Math.exp(lerp(Math.log(a.scale), Math.log(b.scale), zt)) * lift, cx: lerp(a.cx, b.cx, zt), cy: lerp(a.cy, b.cy, zt) };
}

/** The flight trail: the last `len` of the great-circle path behind progress p, lifted in an arc (u = 0 start … 1 target). */
export function trail(a: [number, number], b: [number, number], p: number, len = 0.32, n = 28): { lon: number; lat: number; alt: number; u: number; age: number }[] {
  const hi = clamp01(p), lo = Math.max(0, hi - len);
  if (hi <= 0) return [];
  return Array.from({ length: n }, (_, i) => {
    const u = lerp(lo, hi, i / (n - 1)), [lon, lat] = slerp(a, b, u);
    return { lon, lat, alt: 0.09 * Math.sin(Math.PI * u), u, age: 1 - i / (n - 1) };
  });
}

// ---------- labels ----------
export type Rect = { x: number; y: number; w: number; h: number };
export type LabelIn = { id: string; ax: number; ay: number; w: number; h: number; prio: number };
export type LabelOut = LabelIn & { x: number; y: number };
export const overlaps = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** Greedy placement, most important first: the first offset around the anchor that hits no placed label, no blocker
 *  (HUD panels, storm cores) and stays in bounds. A label with no free spot is left out rather than overlapping. */
export function placeLabels(items: LabelIn[], blockers: Rect[], bounds: Rect | ((r: Rect) => boolean), gap = 8): LabelOut[] {
  const fits = typeof bounds === "function" ? bounds : (r: Rect) => inside(r, bounds);
  const out: LabelOut[] = [];
  for (const it of [...items].sort((a, b) => b.prio - a.prio)) {
    const d = [22, 56, 96];
    const cands = d.flatMap((r) => [
      [it.ax + r, it.ay - it.h / 2], [it.ax - r - it.w, it.ay - it.h / 2],
      [it.ax + r * 0.7, it.ay - r * 0.7 - it.h], [it.ax + r * 0.7, it.ay + r * 0.7],
      [it.ax - r * 0.7 - it.w, it.ay - r * 0.7 - it.h], [it.ax - r * 0.7 - it.w, it.ay + r * 0.7],
    ]);
    for (const [x, y] of cands) {
      const r = { x, y, w: it.w, h: it.h };
      if (!fits(r) || blockers.some((b) => overlaps(r, b, gap)) || out.some((o) => overlaps(r, o, gap))) continue;
      out.push({ ...it, x, y });
      break;
    }
  }
  return out;
}

/** Outlet chips for the beams: one row across the top, centred over the story, kept inside the frame and apart. */
export function chipRow(n: number, widths: number[], storyX: number, W: number, y: number, gap = 18, margin = 48): Rect[] {
  const total = widths.slice(0, n).reduce((s, w) => s + w, 0) + gap * Math.max(0, n - 1);
  let x = Math.min(W - margin - total, Math.max(margin, storyX - total / 2));
  return widths.slice(0, n).map((w, i) => {
    const r = { x, y: y + (i % 2) * 22 * (n > 3 ? 1 : 0), w, h: 34 };
    x += w + gap;
    return r;
  });
}

/** All four corners at least `pad` inside the globe's disk: a label never pokes past the globe's edge. */
export const inDisk = (r: Rect, cx: number, cy: number, R: number, pad = 6) =>
  [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].every(([x, y]) => Math.hypot(x - cx, y - cy) <= R - pad);

// ---------- views ----------
/** The free part of the screen (the Intelligence panel takes the right side on wide screens). */
export type Free = { x: number; y: number; w: number; h: number };
/** Resting view: centred on the coverage-weighted middle of the biggest systems, latitude kept between -10° and 40°. */
export function restView(pts: { lon: number; lat: number; reports: number }[], f: Free): View {
  const top = [...pts].sort((a, b) => b.reports - a.reports).slice(0, 6);
  let x = 0, y = 0, z = 0;
  for (const p of top) { const v = vec(p.lon, p.lat), w = Math.sqrt(p.reports); x += v[0] * w; y += v[1] * w; z += v[2] * w; }
  const lon = top.length ? Math.atan2(y, x) / RAD : 20, lat = top.length ? Math.atan2(z, Math.hypot(x, y)) / RAD : 20;
  const scale = Math.min(f.w * 0.36, f.h * 0.4);
  return { lon, lat: Math.min(40, Math.max(-10, lat)), scale, cx: f.x + f.w * 0.56, cy: f.y + f.h * 0.53 };
}
/** A story's close-up: the system sits a little above the middle, clear of the lower third. */
export function storyView(p: { lon: number; lat: number }, f: Free): View {
  const scale = Math.min(f.w, f.h) * 1.55;
  return { lon: p.lon, lat: Math.max(-80, Math.min(80, p.lat - 7)), scale, cx: f.x + f.w * 0.56, cy: f.y + f.h * 0.6 };
}

// ---------- choreography ----------
/** Beats in ms. A stop (one story, local time from the stop's start): fly (anticipation pull, arc, hold) → beams land one by one
 *  → lower third builds in (staggered, overlapping the beams) → hold with the voice. Rest → play (real time from the press):
 *  anticipation dip on the button, release with a small settle, the rest HUD leaves staggered while the camera starts. */
export const STOP = { flyDur: 2300, beams: 2240, beamStagger: 150, beamDur: 460, lower: 2560, lowerStagger: 90, lowerDur: 480, voice: 2700, lowerOut: 320 } as const;
export const PRESS = { down: 110, release: 300, hudOut: 180, hudDur: 380, hudStagger: 70, tour: 260, back: 1300 } as const;
/** The motion test: rest hold, press at 1.5 s, the tour clock starts 260 ms later, ends 7.4 s in. */
export const TEST = { press: 1500, end: 7400 } as const;

export type StopScene = { view: View; flight: number; trailP: number; trailA: number; beams: number[]; impact: number[]; focus: number; lower: number[]; prevLower: number; voice: number };
export type RestScene = { press: number; ripple: number; hud: number[] };

/** Camera arc grows with the distance flown: a short hop barely lifts, a flight across the world pulls well out. */
export const arcFor = (a: View, b: View) => 0.12 + 0.5 * Math.min(1, angDeg(a, b) / 150);
const angDeg = (a: View, b: View) => {
  const [x, y] = [vec(a.lon, a.lat), vec(b.lon, b.lat)];
  return Math.acos(Math.min(1, Math.max(-1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))) / RAD;
};

/** One story at local time `t` (ms from the stop's start), flying from `from` to `to`. `len` = the stop's length (voice bar). */
export function stopScene(t: number, from: View, to: View, nBeams: number, len: number, reduced = false): StopScene {
  const S = STOP;
  const flight = reduced ? 1 : beat(t, 0, S.flyDur);
  let view = flight <= 0 ? from : flight >= 1 ? to : flyView(from, to, flight, arcFor(from, to));
  if (!reduced && t > S.flyDur) { const k = 1 + 0.025 * ease.out(beat(t, S.flyDur, Math.max(1, len - S.flyDur))); view = { ...view, scale: view.scale * k }; } // slow push-in on the hold
  const fade = reduced ? 150 : 0;
  return {
    view, flight,
    trailP: reduced ? 0 : flyEase(flight, { pull: 0.12, dip: 0.03, hold: 0.06 }),
    trailA: reduced ? 0 : Math.min(beat(t, 150, 300), 1 - beat(t, S.flyDur - 200, 600)),
    beams: Array.from({ length: nBeams }, (_, i) => (reduced ? beat(t, 0, 150) : ease.out(beat(t, S.beams + i * S.beamStagger, S.beamDur)))),
    impact: Array.from({ length: nBeams }, (_, i) => (reduced ? 0 : beat(t, S.beams + i * S.beamStagger + S.beamDur * 0.9, 650))),
    focus: reduced ? 1 : ease.out(beat(t, S.flyDur - 350, 700)),
    lower: [0, 1, 2, 3, 4].map((i) => ease.out(beat(t, reduced ? 0 : S.lower + i * S.lowerStagger, fade || S.lowerDur))),
    prevLower: 1 - ease.out(beat(t, 0, reduced ? 150 : S.lowerOut)), // the last story's lower third leaves as the camera pulls
    voice: beat(t, S.voice, Math.max(1, len - S.voice)),
  };
}

/** The rest view's button and HUD, `t` ms after the press (negative = not pressed). `back` > 0: returning, HUD fades back in. */
export function restScene(t: number, reduced = false, back = 0): RestScene {
  const P = PRESS;
  if (back > 0) { const k = ease.out(beat(back, reduced ? 0 : P.back * 0.45, reduced ? 150 : 520)); return { press: 1, ripple: 0, hud: [k, k, k, k] }; }
  if (t < 0) return { press: 1, ripple: 0, hud: [1, 1, 1, 1] };
  const down = beat(t, 0, P.down), up = beat(t, P.down, P.release);
  const press = up <= 0 ? 1 - 0.06 * ease.out(down) : 0.94 + 0.06 * ease.settle(up);
  return { press, ripple: beat(t, P.down, 620), hud: [0, 1, 2, 3].map((i) => 1 - ease.out(beat(t, P.hudOut + i * P.hudStagger, reduced ? 150 : P.hudDur))) };
}

/** Flying home (Esc or the end): from the current story view back to the rest view over PRESS.back ms. */
export function backView(from: View, rest: View, t: number, reduced = false): View {
  if (reduced) return rest;
  const p = beat(t, 0, PRESS.back);
  return p >= 1 ? rest : flyView(from, rest, p, arcFor(from, rest) * 0.6);
}

// ---------- sunlight ----------
/** The point on Earth with the sun overhead at `ms` (UTC): declination from the day of the year, longitude from the time of day
 *  (good to about 1°, ignoring the equation of time). The globe is lit from here, so day and night are the real ones. */
export function subsolar(ms: number): { lon: number; lat: number } {
  const d = new Date(ms), y0 = Date.UTC(d.getUTCFullYear(), 0, 1), doy = (ms - y0) / 86_400_000;
  const lat = -23.44 * Math.cos(((2 * Math.PI) / 365.25) * (doy + 10));
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  let lon = -(h - 12) * 15;
  if (lon < -180) lon += 360;
  return { lon, lat };
}
/** How lit a point is: 0 night … 1 day, with a soft twilight band about 6° either side of the terminator. */
export function daylight(sun: { lon: number; lat: number }, lon: number, lat: number): number {
  const cz = Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD);
  const u = Math.min(1, Math.max(0, (cz + 0.1) / 0.2));
  return u * u * (3 - 2 * u);
}

// ---------- the free frame ----------
/** The part of the screen nothing else covers. `covered[row][col]` = a sample point is under another part of the app (the panel,
 *  the top bar, the search box, the region chips, the command bar…), sampled by the app with elementFromPoint. Columns mostly
 *  covered at the sides are cut off (the panel), then the bands at the top and bottom that hold covered points (bars, chips).
 *  If almost everything reads as covered, the sampling is wrong (an invisible full-screen layer): keep `fallback`. */
export function safeFrame(covered: boolean[][], W: number, H: number, fallback: Free, pad = 12): Free {
  const rows = covered.length, cols = covered[0]?.length ?? 0;
  if (!rows || !cols) return fallback;
  const all = covered.flat(), share = all.filter(Boolean).length / all.length;
  if (share > 0.7) return fallback;
  // a side panel covers the middle of the screen top to bottom; a phone's bottom sheet and the top bars don't (so they don't eat columns)
  const mid = covered.slice(Math.floor(rows * 0.25), Math.ceil(rows * 0.75));
  const colCov = (c: number) => mid.filter((r) => r[c]).length / mid.length;
  let l = 0, r = cols;
  while (l < cols && colCov(l) >= 0.5) l++;
  while (r > l && colCov(r - 1) >= 0.5) r--;
  const rowHit = (y: number) => covered[y].slice(l, r).some(Boolean);
  // the top band ends under the lowest covered row in the top 45%, the bottom band starts at the highest covered row in the
  // bottom 45% (bars float with gaps around them: a clear row between the command bar and the chips doesn't end the band)
  let t = 0, b = rows;
  for (let y = 0; y < Math.floor(rows * 0.45); y++) if (rowHit(y)) t = y + 1;
  for (let y = rows - 1; y >= Math.ceil(rows * 0.55); y--) if (rowHit(y)) b = y;
  while (b < rows && b > t + 1 && rowHit(b - 1)) b--; // a sheet that starts higher than that: the band ends at its top edge
  if (r - l < 2 || b - t < 2) return fallback;
  const cw = W / cols, ch = H / rows;
  const x = l ? l * cw + pad : 0, y = t ? t * ch + pad : 0, x2 = r < cols ? r * cw - pad : W, y2 = b < rows ? b * ch - pad : H;
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}
