// Pure chart helpers for the STUDIO stats dashboard (hand-written SVG, no chart lib). Tested in tests/chart-pure.test.ts.

export type Box = { x0: number; x1: number; y0: number; y1: number }; // y0 = top, y1 = bottom (SVG coords)
export type Pt = { x: number; y: number };

const fin = (x: number, d = 0) => (Number.isFinite(x) ? x : d);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 0-based ticks (`integer` for counts like subscribers) with a 1/2/2.5/5×10ⁿ step, covering max in ≤ count steps. Never negative; [0, 1] for empty data. */
export function niceTicks(max: number, count = 3, integer = false): number[] {
  const m = fin(max);
  if (!(m > 0)) return [0, 1];
  if (integer && m <= count) return Array.from({ length: Math.ceil(m) + 1 }, (_, i) => i);
  const raw = m / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = (integer && p < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).map((k) => k * p).find((s) => s * count >= m) ?? 10 * p;
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const t = +(i * step).toPrecision(12);
    out.push(t);
    if (t >= m) break;
  }
  return out;
}

/** Values → points spread evenly across the box; y is clamped inside the box for any input (NaN, huge, negative). */
export function toPoints(values: number[], box: Box, max: number, min = 0): Pt[] {
  const lo = fin(min), hi = fin(max) > lo ? fin(max) : lo + 1;
  const n = values.length;
  return values.map((v, i) => ({
    x: n > 1 ? box.x0 + ((box.x1 - box.x0) * i) / (n - 1) : (box.x0 + box.x1) / 2,
    y: clamp(box.y1 - ((clamp(fin(v, lo), lo, hi) - lo) / (hi - lo)) * (box.y1 - box.y0), box.y0, box.y1),
  }));
}

const f = (x: number) => +x.toFixed(2);

/**
 * Smooth line through the points with monotone cubic interpolation (Fritsch–Carlson): each segment stays between
 * its two endpoints' y values, so the curve never overshoots below the baseline (unlike Catmull-Rom/bezier smoothing).
 * One point draws a flat line across the box; no points → "".
 */
export function linePath(pts: Pt[], box: Box): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${f(box.x0)},${f(pts[0].y)}H${f(box.x1)}`;
  const n = pts.length, d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    d.push(dx > 0 ? (pts[i + 1].y - pts[i].y) / dx : 0);
  }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const cy = (y: number) => clamp(y, box.y0, box.y1); // belt and braces: rounding can't leave the box
  let p = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b = pts[i + 1], h = (b.x - a.x) / 3;
    p += `C${f(a.x + h)},${f(cy(a.y + m[i] * h))} ${f(b.x - h)},${f(cy(b.y - m[i + 1] * h))} ${f(b.x)},${f(b.y)}`;
  }
  return p;
}

/** The line closed down to the box bottom, for the gradient fill. */
export function areaPath(pts: Pt[], box: Box): string {
  const line = linePath(pts, box);
  if (!line) return "";
  const first = pts.length === 1 ? box.x0 : pts[0].x, last = pts.length === 1 ? box.x1 : pts[pts.length - 1].x;
  return `${line}L${f(last)},${f(box.y1)}L${f(first)},${f(box.y1)}Z`;
}

/** Change vs the previous period: arrow + text so colour is never the only signal. */
export function delta(cur: number, prev: number): { dir: 1 | 0 | -1; text: string } {
  const c = fin(cur), p = fin(prev);
  if (p === 0) return c === 0 ? { dir: 0, text: "—" } : { dir: c > 0 ? 1 : -1, text: c > 0 ? "new" : "▼ from 0" };
  const pct = ((c - p) / Math.abs(p)) * 100;
  if (Math.abs(pct) < 0.5) return { dir: 0, text: "0%" };
  const abs = Math.abs(pct);
  return { dir: pct > 0 ? 1 : -1, text: `${pct > 0 ? "▲" : "▼"} ${abs >= 10 ? Math.round(abs) : abs.toFixed(1)}%` };
}

/** Seconds → m:ss (h:mm:ss from an hour up). */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(fin(sec)));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

const cf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
/** 1284 → "1.3K"; NaN → "0". */
export const compact = (x: number) => cf.format(fin(x));
