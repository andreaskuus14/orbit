// News weather renderer (Canvas 2D, orthographic globe). No React here: the app (NewsWeatherLayer.tsx) and the motion test
// (scripts/news-weather-motion-test.mjs) both call draw() with the values from news-weather-motion-pure, so they show the same
// thing. The look follows surface-pressure analysis charts (Met Office / DWD / NOAA) and editorial news graphics: a natural-colour
// globe (Natural Earth relief), thin off-white isobars numbered in hPa on the line, H/L centres, standard front symbols, serif
// headlines, sentence-case labels on leader lines, hairline rules instead of boxes, colour only where it means something. No glow.
// The still part (desk, globe texture, isobars, highs, light) is cached and only redrawn when the camera moves.
import world from "world-atlas/countries-110m.json";
import { decodeCountries } from "@/lib/topo";
import type { FrontType, Isobar, Stop, WxFront, WxSystem } from "@/lib/news-weather-pure";
import { frontType, highs, shortTitle, wrapLines } from "@/lib/news-weather-pure";
import { chipRow, daylight, horizonFade, inDisk, overlaps, placeLabels, project, slerp, STOP, trail, type Free, type Rect, type RestScene, type StopScene, type View } from "@/lib/news-weather-motion-pure";
import type { WX_TEXT } from "@/lib/news-weather-text-pure";

type Text = (typeof WX_TEXT)[keyof typeof WX_TEXT];
export type Fonts = { sans: string; serif: string };
/** `samples`: a fixed size for the globe picture (the motion test, so frames don't depend on timing); unset = adapts to the machine. */
export type DrawOpts = { samples?: number };
export type WxModel = {
  systems: WxSystem[]; fronts: WxFront[]; isobars: Isobar[]; /** hPa under each L (system key) and H ("H:" + region) */ hpa: Record<string, number>;
  title: string; forecast: string; since: string[]; playSub: string; canPlay: boolean; text: Text;
};
export type TourFrame = {
  stop: Stop; prev: Stop | null; scene: StopScene; idx: number; n: number; from: [number, number];
  paused: boolean; voiced: boolean; /** this story's length in ms */ dur: number;
  /** the whole tour: one chapter per story (ms on the tour clock) and where the clock is now */
  chapters: { title: string; start: number; end: number }[]; clock: number;
};
export type WxFrame = {
  W: number; H: number; dpr: number; free: Free; view: View; now: number; reduced: boolean;
  rest: RestScene; tour: TourFrame | null; hover?: string | null;
  /** where the sun is overhead right now (subsolar()); the globe shows the real day and night. Missing = all day. */
  sun?: { lon: number; lat: number };
};

// A dark desk, a natural-colour globe (Natural Earth relief baked by scripts/news-weather-bake-globe.py), off-white chart ink.
// Fronts are the only strong colour (WMO symbol colours); one warm accent marks the story the tour is on.
const P = {
  desk: "#18191b", desk2: "#0f1011", ocean: "#0f2234", landFallback: "#5d5a43",
  ink: "#f1ece1", inkMute: "rgba(241,236,225,0.66)", inkLine: "rgba(241,236,225,0.5)", halo: "rgba(10,12,14,0.72)",
  accent: "#f0662a", red: "#d42a20", track: "rgba(241,236,225,0.28)",
};
const FRONT: Record<FrontType, string> = { cold: "#2f86e0", warm: "#e5482e", occluded: "#a066d3" };
const rgba = (h: string, a: number) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`; };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const RAD = Math.PI / 180;

let LAND: [number, number][][] | null = null;
const land = () => (LAND ??= decodeCountries(world as unknown as Parameters<typeof decodeCountries>[0]).flatMap((c) => c.rings));

type PathLike = CanvasRenderingContext2D | Path2D;
/** A polygon ring on the visible hemisphere: cut where it crosses the horizon and closed along the rim. */
function ringPath(g: PathLike, v: View, ring: [number, number][]) {
  const pts = ring.map(([lon, lat]) => project(v, lon, lat));
  const start = pts.findIndex((p) => p.z > 0);
  if (start < 0) return;
  if (pts.every((p) => p.z > 0)) { g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); return; }
  const n = pts.length, rim = (x: number, y: number) => Math.atan2(y - v.cy, x - v.cx);
  let exitA: number | null = null;
  g.moveTo(pts[start].x, pts[start].y);
  for (let k = 1; k <= n; k++) {
    const a = pts[(start + k - 1) % n], b = pts[(start + k) % n];
    if (a.z > 0 && b.z > 0) { g.lineTo(b.x, b.y); continue; }
    if (a.z <= 0 && b.z <= 0) continue;
    const f = a.z / (a.z - b.z), x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, ang = rim(x, y);
    if (a.z > 0) { g.lineTo(v.cx + Math.cos(ang) * v.scale, v.cy + Math.sin(ang) * v.scale); exitA = ang; }
    else {
      if (exitA !== null) { let d = ang - exitA; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; g.arc(v.cx, v.cy, v.scale, exitA, exitA + d, d < 0); }
      g.lineTo(b.x, b.y);
    }
  }
  g.closePath();
}

/** Polylines on the globe, broken where they go behind it; `bucket` splits them by horizon fade so each alpha is one stroke. */
function linesByFade(v: View, lines: [number, number][][], buckets = 5): Path2D[] {
  const out = Array.from({ length: buckets }, () => new Path2D());
  for (const l of lines) {
    let prevB = -1, px = 0, py = 0;
    for (const [lon, lat] of l) {
      const p = project(v, lon, lat), a = horizonFade(p.z, 0.62, 0.02);
      const b = a <= 0 ? -1 : Math.min(buckets - 1, Math.floor(a * buckets));
      if (b >= 0 && prevB >= 0) { const path = out[Math.min(b, prevB)]; path.moveTo(px, py); path.lineTo(p.x, p.y); }
      prevB = b; px = p.x; py = p.y;
    }
  }
  return out;
}

/** Isobars come off a 2° grid; two rounds of Chaikin corner-cutting make them read as drawn curves when the camera is close. */
const smoothCache = new WeakMap<object, [number, number][][]>();
function smooth(lines: [number, number][][]): [number, number][][] {
  let out = smoothCache.get(lines);
  if (out) return out;
  out = lines.map((l) => {
    let p = l;
    for (let r = 0; r < 2; r++) {
      if (p.length < 3) break;
      const closed = p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1], q: [number, number][] = closed ? [] : [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const [a, b] = [p[i], p[i + 1]];
        if (Math.abs(a[0] - b[0]) > 180) { q.push(a, b); continue; } // the dateline seam: leave as is
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      if (closed) q.push(q[0]); else q.push(p[p.length - 1]);
      p = q;
    }
    return p;
  });
  smoothCache.set(lines, out);
  return out;
}

/** Text with a soft dark shadow under it (legible over terrain without a box). */
function shadowText(g: CanvasRenderingContext2D, s: string, x: number, y: number, blur = 6) {
  g.save(); g.shadowColor = "rgba(0,0,0,0.85)"; g.shadowBlur = blur; g.fillText(s, x, y); g.restore(); g.fillText(s, x, y);
}
function fitText(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.measureText(`${s.slice(0, m)}…`).width <= max) lo = m; else hi = m - 1; }
  return `${s.slice(0, lo).replace(/[\s,;:–—-]+$/, "")}…`;
}
const hair = (g: CanvasRenderingContext2D, x: number, y: number, w: number, c = "rgba(241,236,225,0.5)") => { g.fillStyle = c; g.fillRect(x, Math.round(y), w, 1); };
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fmtHpa = (n: number) => String(n);
/** Inside the free frame (not under the panel, bars or chips), with a small margin. */
const inFree = (fr: Free, r: Rect, pad = 8) => r.x >= fr.x + pad && r.y >= fr.y + pad && r.x + r.w <= fr.x + fr.w - pad && r.y + r.h <= fr.y + fr.h - pad;

/** Front symbols along a screen polyline, every few px, on the left of travel: ▲ cold, ◗ warm, both alternating = occluded. */
function frontSymbols(g: CanvasRenderingContext2D, pts: { x: number; y: number; k: number }[], type: FrontType, color: string, size: number, offset: number, alpha: number) {
  const gap = size * 3.1;
  let acc = 0, next = gap * 0.6 + (offset % 1) * gap, n = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6) continue;
    while (next <= acc + L) {
      const u = (next - acc) / L, x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, k = Math.min(a.k, b.k);
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, nx = uy, ny = -ux; // left of travel
      const tri = type === "cold" || (type === "occluded" && n % 2 === 0);
      if (k > 0.05) {
        g.fillStyle = rgba(color, alpha * k); g.beginPath();
        if (tri) { g.moveTo(x - ux * size * 0.62, y - uy * size * 0.62); g.lineTo(x + ux * size * 0.62, y + uy * size * 0.62); g.lineTo(x + nx * size * 1.0, y + ny * size * 1.0); }
        else { const ang = Math.atan2(uy, ux); g.arc(x, y, size * 0.6, ang, ang + Math.PI, true); }
        g.closePath(); g.fill();
      }
      n++; next += gap;
    }
    acc += L;
  }
}

type Img = CanvasImageSource & { width: number; height: number };
export type TextureKind = "day" | "night" | "clouds";
/** The globe's pictures: public/ui/relief/globe-4096.jpg (day), night-2048.jpg (city lights), clouds-2048.jpg. */
export const TEXTURES: Record<TextureKind, string> = { day: "/ui/relief/globe-4096.jpg", night: "/ui/relief/night-2048.jpg", clouds: "/ui/relief/clouds-2048.jpg" };
export type WeatherDraw = { draw: (m: WxModel, f: WxFrame) => void; playRect: () => Rect | null; hit: (x: number, y: number) => string | null; setTexture: (kind: TextureKind, img: Img) => void };

export function createWeatherDraw(canvas: HTMLCanvasElement, fonts: Fonts, opts: DrawOpts = {}): WeatherDraw {
  const g = canvas.getContext("2d")!;
  const base = document.createElement("canvas"), bg = base.getContext("2d")!;
  const iso = document.createElement("canvas"), ig = iso.getContext("2d")!;
  const rl = document.createElement("canvas"), rg = rl.getContext("2d")!;
  type Tex = { d: Uint8ClampedArray; w: number; h: number };
  let tex: Tex | null = null, night: Tex | null = null, clouds: Tex | null = null;
  let baseKey = "", labelKey = "", labelsCache: { id: string; x: number; y: number; w: number; h: number; ax: number; ay: number; s: WxSystem }[] = [];
  let isoTags: Rect[] = [];
  let play: Rect | null = null, cores: { key: string; x: number; y: number; r: number }[] = [];
  const F = (w: number, px: number, fam: keyof Fonts) => `${w} ${px}px ${fonts[fam]}`;

  // How many points of the globe picture to work out per redraw: shrinks when a redraw takes over 12 ms, grows back under 6 ms.
  let budget = opts.samples ?? 160_000;
  /** The globe texture reprojected onto the disk (orthographic, bilinear) at a reduced resolution (`budget` samples). */
  function drawTexture(v: View, W: number, H: number, dpr: number, sun: { lon: number; lat: number } | undefined): boolean {
    if (!tex) return false;
    const r = v.scale, x0 = Math.max(0, v.cx - r), x1 = Math.min(W, v.cx + r), y0 = Math.max(0, v.cy - r), y1 = Math.min(H, v.cy + r);
    if (x1 <= x0 || y1 <= y0) return true;
    const t0 = performance.now(), step = Math.max(1, Math.sqrt(((x1 - x0) * (y1 - y0) * dpr * dpr) / budget));
    const cols = Math.ceil(((x1 - x0) * dpr) / step), rows = Math.ceil(((y1 - y0) * dpr) / step);
    if (rl.width !== cols || rl.height !== rows) { rl.width = cols; rl.height = rows; }
    const img = rg.createImageData(cols, rows), o = img.data, { d, w, h } = tex;
    const sp0 = Math.sin(v.lat * RAD), cp0 = Math.cos(v.lat * RAD), cs = step / dpr;
    for (let j = 0; j < rows; j++) {
      const Y = -(y0 + (j + 0.5) * cs - v.cy) / r;
      for (let i = 0; i < cols; i++) {
        const X = (x0 + (i + 0.5) * cs - v.cx) / r, q = X * X + Y * Y;
        if (q >= 1.0004) continue;
        const z = Math.sqrt(Math.max(0, 1 - q)), lat = Math.asin(Math.max(-1, Math.min(1, z * sp0 + Y * cp0))) / RAD;
        let lon = v.lon + Math.atan2(X, z * cp0 - Y * sp0) / RAD;
        lon = (((lon + 180) % 360) + 360) % 360;
        const fu = (lon / 360) * w - 0.5, fv = Math.max(0, Math.min(h - 1.001, ((90 - lat) / 180) * h - 0.5));
        const u0 = Math.floor(fu), v0 = Math.floor(fv), du = fu - u0, dv = fv - v0;
        const ua = ((u0 % w) + w) % w, ub = (ua + 1) % w, a00 = (v0 * w + ua) * 4, a01 = (v0 * w + ub) * 4, a10 = a00 + w * 4, a11 = a01 + w * 4;
        const k = (j * cols + i) * 4, lonW = lon - 180; // lon here runs 0..360 from the dateline
        const lit = sun ? daylight(sun, lonW, lat) : 1, dayK = 0.16 + 0.84 * lit;
        let cr = 0, cg = 0, cb = 0;
        if (clouds) { const c = sampleGrey(clouds, lon, lat) / 255; cr = cg = cb = Math.min(1, c * 1.1) * 0.42; } // light: a fixed picture, not today's weather
        const lights = night && lit < 1 ? (sampleGrey(night, lon, lat) / 255) * (1 - lit) * (1 - cr) : 0;
        const w00 = (1 - du) * (1 - dv), w01 = du * (1 - dv), w10 = (1 - du) * dv, w11 = du * dv;
        const b0 = d[a00] * w00 + d[a01] * w01 + d[a10] * w10 + d[a11] * w11;
        const b1 = d[a00 + 1] * w00 + d[a01 + 1] * w01 + d[a10 + 1] * w10 + d[a11 + 1] * w11;
        const b2 = d[a00 + 2] * w00 + d[a01 + 2] * w01 + d[a10 + 2] * w10 + d[a11 + 2] * w11;
        const cloudLit = 225 * (0.12 + 0.88 * lit);
        o[k] = b0 * dayK * (1 - cr) + cloudLit * cr + lights * 255;
        o[k + 1] = b1 * dayK * (1 - cg) + cloudLit * cg + lights * 190;
        o[k + 2] = b2 * dayK * (1 - cb) + (cloudLit + 8) * cb + lights * 110;
        o[k + 3] = 255;
      }
    }
    rg.putImageData(img, 0, 0);
    bg.imageSmoothingEnabled = true; bg.imageSmoothingQuality = "high";
    bg.drawImage(rl, x0, y0, cols * cs, rows * cs);
    if (opts.samples == null) { const ms = performance.now() - t0; budget = ms > 12 ? Math.max(50_000, budget * 0.75) : ms < 6 ? Math.min(300_000, budget * 1.15) : budget; }
    return true;
  }

  /** Bilinear grey lookup in the night / cloud pictures. lon 0..360 from the dateline. */
  function sampleGrey(t: Tex, lon: number, lat: number): number {
    const fu = (lon / 360) * t.w - 0.5, fv = Math.max(0, Math.min(t.h - 1.001, ((90 - lat) / 180) * t.h - 0.5));
    const u0 = Math.floor(fu), v0 = Math.floor(fv), du = fu - u0, dv = fv - v0, ua = ((u0 % t.w) + t.w) % t.w, ub = (ua + 1) % t.w, r0 = v0 * t.w, r1 = r0 + t.w, d = t.d;
    return (d[(r0 + ua) * 4] * (1 - du) + d[(r0 + ub) * 4] * du) * (1 - dv) + (d[(r1 + ua) * 4] * (1 - du) + d[(r1 + ub) * 4] * du) * dv;
  }

  function drawBase(m: WxModel, f: WxFrame) {
    const { W, H, dpr, view: v } = f;
    for (const c of [base, iso]) if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const desk = bg.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, Math.max(W, H) * 0.9);
    desk.addColorStop(0, P.desk); desk.addColorStop(1, P.desk2);
    bg.fillStyle = desk; bg.fillRect(0, 0, W, H);
    const r = v.scale;
    bg.save(); bg.beginPath(); bg.arc(v.cx, v.cy, r, 0, 7); bg.clip();
    bg.fillStyle = P.ocean; bg.fillRect(v.cx - r, v.cy - r, 2 * r, 2 * r);
    const landPath = new Path2D(); for (const ring of land()) ringPath(landPath, v, ring);
    if (!drawTexture(v, W, H, dpr, f.sun)) { bg.fillStyle = P.landFallback; bg.fill(landPath); } // texture still loading: flat land
    bg.strokeStyle = "rgba(241,236,225,0.13)"; bg.lineWidth = 0.5; bg.stroke(landPath); // country borders, barely there

    // Isobars on their own layer so each number sits in a real gap in its line, as on a printed chart.
    ig.setTransform(1, 0, 0, 1, 0, 0); ig.clearRect(0, 0, iso.width, iso.height); ig.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = m.isobars.length, tags: { x: number; y: number; s: string; a: number }[] = [];
    m.isobars.forEach((lv, i) => {
      const lines = smooth(lv.lines), paths = linesByFade(v, lines);
      ig.lineWidth = i >= n - 2 ? 1.15 : 0.85; ig.lineJoin = "round";
      paths.forEach((p, b) => { ig.strokeStyle = rgba(P.ink, ((b + 1) / paths.length) * 0.6); ig.stroke(p); });
      for (const l of lines) { // one number per line where it faces us most, kept apart from the others and from the lows
        let best: { x: number; y: number; z: number } | null = null;
        for (let k = 0; k < l.length; k += 2) {
          const p = project(v, l[k][0], l[k][1]);
          if (p.z < 0.4 || (best && p.z <= best.z) || p.x < 20 || p.y < 20 || p.x > W - 20 || p.y > H - 20) continue;
          if (tags.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 64)) continue;
          if (m.systems.some((s) => { if (s.kind !== "storm") return false; const q = project(v, s.lon, s.lat); return Math.hypot(q.x - p.x, q.y - p.y) < 40; })) continue;
          best = { x: p.x, y: p.y, z: p.z };
        }
        if (best) tags.push({ x: best.x, y: best.y, s: fmtHpa(lv.hpa), a: horizonFade(best.z, 0.62, 0.02) });
      }
    });
    isoTags = tags.map((t) => ({ x: t.x - 18, y: t.y - 9, w: 36, h: 18 }));
    ig.font = F(400, 12, "serif"); ig.globalCompositeOperation = "destination-out";
    for (const t of tags) { const w = ig.measureText(t.s).width + 10; ig.fillRect(t.x - w / 2, t.y - 8, w, 16); }
    ig.globalCompositeOperation = "source-over";
    bg.setTransform(1, 0, 0, 1, 0, 0); bg.drawImage(iso, 0, 0); bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg.font = F(400, 12, "serif"); bg.textAlign = "center"; bg.textBaseline = "middle";
    for (const t of tags) { bg.fillStyle = rgba(P.ink, 0.85 * t.a); shadowTextOn(bg, t.s, t.x, t.y + 0.5, 4); }
    // Highs: calm regions, "H" over its number, as on a pressure chart
    for (const h of highs(m.systems)) {
      const p = project(v, h.lon, h.lat), a = horizonFade(p.z, 0.4, 0.05);
      if (a <= 0) continue;
      bg.fillStyle = rgba(P.ink, 0.92 * a);
      bg.font = F(600, 34, "serif"); shadowTextOn(bg, "H", p.x, p.y - 6, 8);
      const hp = m.hpa[`H:${h.region}`]; if (hp) { bg.font = F(400, 14, "serif"); shadowTextOn(bg, fmtHpa(hp), p.x, p.y + 18, 5); }
    }
    bg.textAlign = "left"; bg.textBaseline = "alphabetic";
    // The real terminator is in the texture (sun); here only limb darkening, so the globe reads round. No glow outside the disk.
    const limb = bg.createRadialGradient(v.cx, v.cy, r * 0.8, v.cx, v.cy, r);
    limb.addColorStop(0, "rgba(4,6,10,0)"); limb.addColorStop(1, "rgba(4,6,10,0.5)");
    bg.fillStyle = limb; bg.fillRect(v.cx - r, v.cy - r, 2 * r, 2 * r);
    bg.restore();
  }
  function shadowTextOn(c: CanvasRenderingContext2D, s: string, x: number, y: number, blur: number) {
    c.save(); c.shadowColor = "rgba(0,0,0,0.9)"; c.shadowBlur = blur; c.fillText(s, x, y); c.restore(); c.fillText(s, x, y);
  }

  function front(fr: WxFront, systems: WxSystem[], byKey: Map<string, WxSystem>, v: View, now: number, reduced: boolean, alpha: number) {
    const a = byKey.get(fr.from), b = byKey.get(fr.to);
    if (!a || !b || alpha <= 0) return;
    const type = frontType(fr, systems), color = FRONT[type];
    const N = 72, pts = Array.from({ length: N + 1 }, (_, i) => { const [lon, lat] = slerp([a.lon, a.lat], [b.lon, b.lat], i / N); const p = project(v, lon, lat); return { x: p.x, y: p.y, k: horizonFade(p.z, 0.4, 0.02) }; });
    g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round";
    for (let i = 1; i <= N; i++) {
      const p = pts[i - 1], q = pts[i], k = Math.min(p.k, q.k);
      if (k <= 0) continue;
      g.strokeStyle = rgba(color, 0.95 * k * alpha); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
    }
    // symbols keep one screen size whatever the zoom, and creep slowly the way the story travels (from → to)
    const size = 8.5 * Math.min(1.5, Math.max(0.9, Math.sqrt(v.scale / 380)));
    frontSymbols(g, pts, type, color, size, reduced ? 0 : (now / 1000) * 0.12, alpha);
  }

  function system(m: WxModel, s: WxSystem, v: View, focus: number, dim: number, hover: boolean, now: number, reduced: boolean) {
    const p = project(v, s.lon, s.lat), fade = horizonFade(p.z, 0.3, 0.03) * dim;
    if (fade <= 0) return;
    const zoom = Math.min(1.4, Math.max(0.9, Math.sqrt(v.scale / 380)));
    g.save(); g.globalAlpha = fade; g.translate(p.x, p.y);
    if (focus > 0) { // the story the tour is on: a warm dot with thin rings settling out from it (one accent, no glow)
      const ph = reduced ? 0.5 : (now / 2600) % 1;
      for (let i = 0; i < 3; i++) {
        const u = (i + ph) / 3, R = (10 + u * 46) * focus;
        g.fillStyle = rgba(P.accent, 0.16 * (1 - u) * focus); g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
        g.strokeStyle = rgba(P.accent, 0.55 * (1 - u) * focus); g.lineWidth = 1; g.stroke();
      }
      g.fillStyle = P.accent; g.beginPath(); g.arc(0, 0, 7 * focus, 0, 7); g.fill();
      g.strokeStyle = rgba("#ffffff", 0.85 * focus); g.lineWidth = 1.2; g.stroke();
      cores.push({ key: s.key, x: p.x, y: p.y, r: 14 });
      g.restore(); return;
    }
    g.textAlign = "center"; g.fillStyle = P.ink; g.strokeStyle = P.ink;
    if (s.kind === "storm") { // "L" over its number, a soft shade behind so it reads over terrain
      const sz = (30 + Math.min(10, (s.outlets - 5) * 2.5)) * zoom;
      const sh = g.createRadialGradient(0, 0, 0, 0, 0, sz * 1.25); sh.addColorStop(0, "rgba(8,10,14,0.5)"); sh.addColorStop(1, "rgba(8,10,14,0)");
      g.fillStyle = sh; g.beginPath(); g.arc(0, 0, sz * 1.25, 0, 7); g.fill();
      g.fillStyle = P.ink; g.font = F(600, sz, "serif"); g.textBaseline = "alphabetic"; shadowText(g, "L", 0, sz * 0.12, 6);
      const hp = m.hpa[s.key]; if (hp) { g.font = F(400, 13 * zoom, "serif"); g.textBaseline = "top"; shadowText(g, fmtHpa(hp), 0, sz * 0.24, 4); }
      if (hover) { g.lineWidth = 1; g.beginPath(); g.arc(0, 0, sz * 1.1, 0, 7); g.stroke(); }
      cores.push({ key: s.key, x: p.x, y: p.y, r: sz * 0.9 });
    } else { // a cell: a small open circle with a cross, still forming
      const rr = 4 * zoom; g.lineWidth = 1.3;
      g.fillStyle = "rgba(8,10,14,0.55)"; g.beginPath(); g.arc(0, 0, rr, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-rr * 0.6, 0); g.lineTo(rr * 0.6, 0); g.moveTo(0, -rr * 0.6); g.lineTo(0, rr * 0.6); g.stroke();
      if (hover) { g.beginPath(); g.arc(0, 0, rr * 2.6, 0, 7); g.stroke(); }
      cores.push({ key: s.key, x: p.x, y: p.y, r: 10 * zoom });
    }
    g.restore();
  }

  function draw(m: WxModel, f: WxFrame) {
    const { W, H, dpr, view: v, now, reduced, rest, tour } = f;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    const key = [W, H, dpr, v.lon.toFixed(3), v.lat.toFixed(3), v.scale.toFixed(2), v.cx.toFixed(1), v.cy.toFixed(1), m.isobars.length, m.systems.length, [tex, night, clouds].map((t) => (t ? 1 : 0)).join(""), f.sun ? `${f.sun.lon.toFixed(1)},${f.sun.lat.toFixed(1)}` : "-"].join("|");
    if (key !== baseKey) { drawBase(m, f); baseKey = key; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const byKey = new Map(m.systems.map((s) => [s.key, s]));
    const tourA = tour ? 1 - rest.hud[0] : 0, restLabels = rest.hud[3];

    // ---- on the globe (clipped to its disk) ----
    g.save(); g.beginPath(); g.arc(v.cx, v.cy, v.scale, 0, 7); g.clip();
    const frontA = tour ? 0.35 + 0.65 * rest.hud[1] : 1;
    for (const fr of m.fronts) front(fr, m.systems, byKey, v, now, reduced, frontA);
    if (tour && tour.scene.trailA > 0) { // the flight path: a thin off-white arc drawn behind the camera, older part fading
      const to = tour.stop.system, d = trail(tour.from, [to.lon, to.lat], tour.scene.trailP);
      g.lineWidth = 1.5; g.lineCap = "round";
      for (let i = 1; i < d.length; i++) {
        const p = project(v, d[i - 1].lon, d[i - 1].lat, d[i - 1].alt), q = project(v, d[i].lon, d[i].lat, d[i].alt);
        if (p.z <= 0.02 || q.z <= 0.02) continue;
        g.strokeStyle = rgba(P.ink, 0.85 * (1 - d[i].age) * tour.scene.trailA * horizonFade(q.z, 0.3, 0.02));
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
      }
    }
    cores = [];
    const focusKey = tour?.stop.system.key;
    for (const s of [...m.systems].reverse()) {
      const on = s.key === focusKey;
      system(m, s, v, on ? tour!.scene.focus : 0, tour && !on ? 0.4 + 0.6 * rest.hud[1] : 1, f.hover === s.key, now, reduced);
    }
    g.restore();

    // ---- labels at rest: placed without overlaps, inside the disk, clear of the lows and the HUD; joined by leader lines ----
    const hudRects = restHud(m, f, true);
    if (restLabels > 0.01) {
      const lk = `${baseKey}|${m.since.length}`;
      if (lk !== labelKey) {
        labelKey = lk;
        const seenTitle = new Set<string>();
        const items = m.systems.flatMap((s) => { // one label per story: a front already links the countries that share it
          const tk = shortTitle(s.title, 30).toLowerCase();
          if (seenTitle.has(tk)) return [];
          const p = project(v, s.lon, s.lat);
          if (horizonFade(p.z, 0.3, 0.03) < 0.5) return [];
          seenTitle.add(tk);
          g.font = F(600, 15, "serif"); const w1 = g.measureText(shortTitle(s.title, 30)).width; g.font = F(400, 12, "sans"); const w2 = g.measureText(meta(m, s)).width;
          return [{ id: s.key, ax: p.x, ay: p.y, w: Math.ceil(Math.max(w1, w2)) + 4, h: 36, prio: (s.kind === "storm" ? 1000 : 0) + s.outlets * 10 + Math.min(9, s.reports / 20) }];
        });
        const blockers = [...hudRects, ...isoTags, ...cores.map((c) => ({ x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r }))];
        labelsCache = placeLabels(items, blockers, (r) => inDisk(r, v.cx, v.cy, v.scale, 10) && inFree(f.free, r)).map((l) => ({ ...l, s: byKey.get(l.id)! }));
      }
      g.globalAlpha = restLabels;
      for (const l of labelsCache) {
        const left = l.x > l.ax, nx = left ? l.x - 5 : l.x + l.w + 5, ny = l.y + 10, on = f.hover === l.id;
        const ux = nx - l.ax, uy = ny - l.ay, L = Math.hypot(ux, uy) || 1, gap = l.s.kind === "storm" ? 26 : 8;
        g.strokeStyle = rgba(P.ink, on ? 0.95 : 0.6); g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(l.ax + (ux / L) * gap, l.ay + (uy / L) * gap); g.lineTo(nx, ny); g.stroke();
        g.textAlign = "left"; g.textBaseline = "alphabetic"; g.font = F(600, 15, "serif"); g.fillStyle = P.ink;
        shadowText(g, shortTitle(l.s.title, 30), l.x, l.y + 14);
        g.font = F(400, 12, "sans"); g.fillStyle = on ? P.ink : P.inkMute;
        shadowText(g, meta(m, l.s), l.x, l.y + 31, 4);
      }
      g.globalAlpha = 1;
    }
    restHud(m, f, false);
    if (tour && tourA > 0) tourHud(m, f, tour, tourA);
  }
  const meta = (m: WxModel, s: WxSystem) => `${s.label} · ${s.outlets} ${s.outlets === 1 ? m.text.outlet : m.text.outlets} · ${s.reports} ${m.text.reports}`;

  /** The rest HUD, typeset like a newspaper map: serif title between rules, the map key, play, "since you last looked".
   *  Everything sits inside `free` (the part of the screen the panel, bars and chips leave), and gets compact when that is small. */
  function restHud(m: WxModel, f: WxFrame, measure: boolean): Rect[] {
    const { free, rest } = f, compact = free.w < 900 || free.h < 600, M = compact ? 20 : 40;
    const x0 = free.x + M, right = free.x + free.w - M, bottom = free.y + free.h - M * 0.6;
    const T = m.text, titlePx = compact ? 32 : 48;
    const tw = Math.min(compact ? 440 : 640, free.w - 2 * M), TH = compact ? 84 : 116;
    const rows = legendRows(m);
    const LW = compact ? 300 : 330, LH = compact ? 34 + Math.ceil(rows.length / 2) * 22 : 42 + rows.length * 25;
    const PW = compact ? 230 : 280, PH = 56;
    const sideBySide = free.w - 2 * M >= LW + PW + 24;
    const rects: Rect[] = [{ x: x0, y: free.y + 20, w: tw, h: TH }, { x: x0, y: bottom - LH, w: LW, h: LH },
      sideBySide ? { x: right - PW, y: bottom - PH, w: PW, h: PH } : { x: x0, y: bottom - LH - PH - 16, w: PW, h: PH }];
    // "since you last looked": top right when there's room beside the title, else under it when there's height, else left out
    const SW = compact ? 280 : 330, sinceH = m.since.length ? 40 + m.since.length * 24 : 0;
    if (sinceH) {
      if (free.w - 2 * M >= tw + SW + 32) rects.push({ x: right - SW, y: free.y + 20, w: SW, h: sinceH });
      else if (rects[0].y + TH + 16 + sinceH < Math.min(rects[1].y, rects[2].y) - 120) rects.push({ x: x0, y: rects[0].y + TH + 16, w: Math.min(SW, free.w - 2 * M), h: sinceH });
    }
    play = rects[2];
    if (measure) return rects;
    const lift = (i: number) => (1 - rest.hud[i]) * -10;
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    if (rest.hud[0] > 0) {
      const t = rects[0];
      g.save(); g.globalAlpha = rest.hud[0]; g.translate(0, lift(0));
      hair(g, t.x, t.y, Math.min(t.w, 380));
      g.font = F(600, titlePx, "serif"); g.fillStyle = P.ink; shadowText(g, fitText(g, m.title, t.w), t.x - 2, t.y + titlePx * 1.15, 10);
      g.font = F(400, compact ? 14 : 17, "sans"); g.fillStyle = "rgba(241,236,225,0.86)"; shadowText(g, fitText(g, m.forecast, t.w), t.x, t.y + TH - 24, 6);
      hair(g, t.x, t.y + TH - 4, Math.min(t.w, 380));
      g.restore();
    }
    if (rest.hud[1] > 0) {
      const { x: lx, y: ly } = rects[1];
      g.save(); g.globalAlpha = rest.hud[1]; g.translate(0, -lift(1));
      hair(g, lx, ly, 160); g.font = F(400, compact ? 17 : 21, "serif"); g.fillStyle = P.ink; shadowText(g, T.howTo, lx, ly + (compact ? 24 : 30), 6);
      rows.forEach(([k, t, glyph], i) => {
        if (compact) { // two columns, names only
          const cx = lx + (i % 2) * (LW / 2), y = ly + 50 + Math.floor(i / 2) * 22;
          glyph(cx + 14, y); g.font = F(400, 13, "sans"); g.fillStyle = P.ink; shadowText(g, fitText(g, k, LW / 2 - 44), cx + 38, y, 4);
          return;
        }
        const y = ly + 62 + i * 25;
        glyph(lx + 14, y);
        g.font = F(400, 14, "sans"); g.fillStyle = P.ink; shadowText(g, k, lx + 42, y, 4);
        const kw = g.measureText(k).width;
        g.fillStyle = P.inkMute; g.font = F(400, 13, "sans"); shadowText(g, fitText(g, `· ${t}`, LW - 52 - kw), lx + 48 + kw, y, 4);
      });
      g.restore();
    }
    if (rest.hud[2] > 0) { // play: anticipation dip on press, settle back, one hairline ring from the icon
      const r = rects[2], cy = r.y + 30, ix = r.x + 20;
      g.save(); g.globalAlpha = rest.hud[2] * (m.canPlay ? 1 : 0.55); g.translate(0, -lift(2));
      g.translate(ix, cy); g.scale(rest.press, rest.press); g.translate(-ix, -cy);
      hair(g, r.x, r.y, r.w);
      if (rest.ripple > 0 && rest.ripple < 1) { g.strokeStyle = rgba(P.ink, 0.55 * (1 - rest.ripple)); g.lineWidth = 1; g.beginPath(); g.arc(ix, cy, 19 + rest.ripple * 30, 0, 7); g.stroke(); }
      g.fillStyle = P.ink; g.beginPath(); g.arc(ix, cy, 19, 0, 7); g.fill();
      g.fillStyle = P.desk; g.beginPath(); g.moveTo(ix - 5, cy - 8); g.lineTo(ix - 5, cy + 8); g.lineTo(ix + 9, cy); g.closePath(); g.fill();
      g.font = F(600, compact ? 16 : 18, "serif"); g.fillStyle = P.ink; shadowText(g, fitText(g, m.canPlay ? T.play : T.noBriefing, r.w - 56), r.x + 52, cy - 3, 6);
      g.font = F(400, 13, "sans"); g.fillStyle = P.inkMute; shadowText(g, fitText(g, m.playSub, r.w - 56), r.x + 52, cy + 16, 4);
      g.restore();
    }
    if (rects[3] && rest.hud[3] > 0) {
      const r = rects[3];
      g.save(); g.globalAlpha = rest.hud[3]; g.translate(0, lift(3));
      hair(g, r.x, r.y, r.w); g.font = F(400, compact ? 16 : 19, "serif"); g.fillStyle = P.ink; shadowText(g, T.since, r.x, r.y + 26, 6);
      m.since.forEach((t, i) => {
        const weak = /weak|nõrg/i.test(t), y = r.y + 52 + i * 24;
        g.fillStyle = weak ? P.inkMute : P.red; g.fillRect(r.x, y - 6, 12, 3);
        g.fillStyle = weak ? P.inkMute : P.ink; g.font = F(400, compact ? 13 : 15, "sans"); shadowText(g, fitText(g, t, r.w - 22), r.x + 22, y, 4);
      });
      g.restore();
    }
    // credit for the night lights and clouds (CC BY 4.0), small, under the globe's corner of the frame
    if (rest.hud[2] > 0 && !compact) {
      g.save(); g.globalAlpha = rest.hud[2] * 0.7; g.font = F(400, 10, "sans"); g.fillStyle = P.inkMute; g.textAlign = "right";
      g.fillText(T.credit, right, Math.min(free.y + free.h - 4, rects[2].y + PH + 18)); g.restore();
    }
    return rects;
  }
  function legendRows(m: WxModel): [string, string, (x: number, y: number) => void][] {
    const T = m.text;
    const serifGlyph = (ch: string) => (x: number, y: number) => { g.font = F(600, 20, "serif"); g.fillStyle = P.ink; g.textAlign = "center"; shadowText(g, ch, x, y + 3, 4); g.textAlign = "left"; };
    return [
      [T.isobars, T.isobarsIs, (x, y) => { g.strokeStyle = P.ink; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x - 13, y - 3); g.bezierCurveTo(x - 5, y - 8, x + 5, y + 2, x + 13, y - 3); g.stroke(); }],
      [T.storm, T.stormIs, serifGlyph("L")],
      [T.cell, T.cellIs, (x, y) => { g.strokeStyle = P.ink; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y - 4, 4, 0, 7); g.moveTo(x - 2.4, y - 4); g.lineTo(x + 2.4, y - 4); g.moveTo(x, y - 6.4); g.lineTo(x, y - 1.6); g.stroke(); }],
      [T.high, T.highIs, serifGlyph("H")],
      [T.cold, T.coldIs, (x, y) => legendFront(x, y, "cold")],
      [T.warm, T.warmIs, (x, y) => legendFront(x, y, "warm")],
      [T.occluded, T.occludedIs, (x, y) => legendFront(x, y, "occluded")],
    ];
  }
  function legendFront(x: number, y: number, type: FrontType) {
    const c = FRONT[type], pts = [{ x: x - 14, y: y - 2, k: 1 }, { x: x + 14, y: y - 2, k: 1 }];
    g.strokeStyle = c; g.lineWidth = 2.4; g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo(pts[1].x, pts[1].y); g.stroke();
    frontSymbols(g, pts, type, c, 6.5, 0.1, 1);
  }

  /** The lower third: no box, a dark scrim rising from the bottom, a red kicker bar, a serif headline, two lines, the real audio
   *  progress across the whole tour (chapter ticks, knob, 0:12 / 1:10) and the chapters underneath, one per story. */
  function scrim(f: WxFrame, a: number) {
    if (a <= 0) return;
    // to the bottom of the canvas and across its whole width, so it never ends in a hard line through the globe
    const { free } = f, H = f.H, top = free.y + free.h * 0.42;
    const gr = g.createLinearGradient(0, top, 0, H);
    gr.addColorStop(0, "rgba(10,11,13,0)"); gr.addColorStop(0.45, `rgba(10,11,13,${(0.7 * a).toFixed(3)})`); gr.addColorStop(1, `rgba(10,11,13,${(0.92 * a).toFixed(3)})`);
    g.fillStyle = gr; g.fillRect(0, top, f.W, H - top);
  }
  /** Progress + chapters: drawn once per frame (not per strap), so they stay put while one story's text hands over to the next. */
  function timeline(m: WxModel, f: WxFrame, t: TourFrame, a: number, paused: boolean) {
    if (a <= 0 || !t.chapters.length) return;
    const { free } = f, compact = free.w < 900 || free.h < 600, M = compact ? 20 : 44, x = free.x + M, w = free.w - 2 * M, by = free.y + free.h - (compact ? 10 : 22);
    const total = t.chapters[t.chapters.length - 1].end || 1, clock = Math.max(0, Math.min(total, t.clock));
    g.save(); g.globalAlpha = a; g.textAlign = "left"; g.textBaseline = "alphabetic";
    const py = by - (compact ? 40 : 66);
    g.fillStyle = P.ink;
    if (paused) { g.beginPath(); g.moveTo(x, py - 8); g.lineTo(x, py + 8); g.lineTo(x + 13, py); g.closePath(); g.fill(); }
    else { g.fillRect(x, py - 8, 4.5, 16); g.fillRect(x + 8.5, py - 8, 4.5, 16); }
    const time = `${mmss(clock)} / ${mmss(total)}`;
    g.font = F(400, 17, "serif"); const tw = g.measureText(time).width;
    g.fillText(time, x + 30, py + 6);
    const tx0 = x + 30 + tw + 22, tx1 = x + w, tl = Math.max(0, tx1 - tx0), at = (ms: number) => tx0 + tl * (ms / total), kx = at(clock);
    g.fillStyle = P.track; g.fillRect(tx0, py - 1.5, tl, 3);
    g.fillStyle = P.red; g.fillRect(tx0, py - 1.5, kx - tx0, 3);
    for (const c of t.chapters.slice(1)) { g.fillStyle = c.start <= clock ? P.red : "rgba(241,236,225,0.55)"; g.fillRect(at(c.start) - 1, py - 5, 2, 10); }
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(kx, py, 7, 0, 7); g.fill();
    // chapters: number, short title, time range; the current one bright with a red rule over it
    // each chapter sits under its own stretch of the progress line, so the labels line up with the ticks above them
    const times = !compact, ty = times ? by - 20 : by - 2;
    t.chapters.forEach((c, i) => {
      const cx = i ? at(c.start) + 8 : x, cx2 = i + 1 < t.chapters.length ? at(t.chapters[i + 1].start) - 8 : x + w, cw = cx2 - cx, on = i === t.idx;
      if (cw < 24) return;
      if (on) { g.fillStyle = P.red; g.fillRect(cx, ty - 24, cw, 2); }
      g.font = F(600, 13, "sans"); g.fillStyle = on ? P.ink : "rgba(241,236,225,0.5)"; g.fillText(String(i + 1), cx, ty);
      g.font = F(on ? 600 : 400, 13, "sans"); g.fillText(fitText(g, c.title, cw - 20), cx + 16, ty);
      if (times) { g.font = F(400, 11, "sans"); g.fillStyle = on ? P.inkMute : "rgba(241,236,225,0.38)"; g.fillText(fitText(g, `${mmss(c.start)}–${mmss(c.end)}`, cw - 20), cx + 16, by - 4); }
    });
    g.restore();
  }
  function strap(m: WxModel, f: WxFrame, t: TourFrame, st: Stop, lower: number[], alpha: number, dy: number) {
    const { free } = f, compact = free.w < 900 || free.h < 600, M = compact ? 20 : 44, x = free.x + M, w = free.w - 2 * M;
    const by = free.y + free.h - (compact ? 10 : 22) + dy, K = compact ? 0.7 : 1;
    const el = (i: number) => lower[i] * alpha;
    if (el(0) <= 0) return;
    g.save(); g.textAlign = "left"; g.textBaseline = "alphabetic";
    const slide = (i: number) => (1 - lower[i]) * 10;
    const n = st.system.outlets;
    // kicker: the red bar grows from the left first (anticipation for the line), then the words
    const ky = by - (compact ? 150 : 232) + slide(1);
    g.globalAlpha = el(0);
    if (st.confirmed) { g.fillStyle = P.red; g.fillRect(x, ky - 11, 54 * lower[0], 11); }
    else { g.strokeStyle = P.red; g.lineWidth = 1.5; g.strokeRect(x + 0.75, ky - 10.25, 52.5 * lower[0], 9.5); }
    g.globalAlpha = el(1); g.font = F(400, 19, "serif"); g.fillStyle = P.ink;
    g.fillText(st.confirmed ? `${m.text.confirmed} ${n} ${n === 1 ? m.text.outlet : m.text.outlets}` : m.text.single, x + 70, ky);
    g.textAlign = "right"; g.font = F(400, 12, "sans"); g.fillStyle = P.inkMute;
    const kick = st.confirmed ? `${m.text.confirmed} ${n} ${n === 1 ? m.text.outlet : m.text.outlets}` : m.text.single;
    g.font = F(400, 19, "serif"); const kickW = g.measureText(kick).width; g.font = F(400, 12, "sans");
    g.fillText(fitText(g, t.paused ? `${m.text.paused} · ${m.text.keys}` : t.voiced ? m.text.keys : `${m.text.noVoice} · ${m.text.keys}`, Math.max(0, w - kickW - 100)), x + w, ky); g.textAlign = "left";
    g.globalAlpha = el(2); g.font = F(600, Math.round(50 * K), "serif"); g.fillStyle = P.ink; g.fillText(fitText(g, st.headline, w), x - 2, by - (compact ? 110 : 176) + slide(2));
    g.globalAlpha = el(3); g.font = F(400, compact ? 15 : 19, "serif"); g.fillStyle = "rgba(241,236,225,0.9)";
    st.lines.slice(0, compact ? 1 : 2).forEach((l, i) => g.fillText(fitText(g, l, w), x, by - (compact ? 84 : 140) + i * 26 + slide(3)));
    g.restore();
  }

  function tourHud(m: WxModel, f: WxFrame, t: TourFrame, a: number) {
    const { free, view: v } = f, sc = t.scene, st = t.stop;
    const sp = project(v, st.system.lon, st.system.lat);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    // Sources, top right: only as many rows as fit above the kicker / keys hint line (with a gap)
    const cmp = free.w < 900 || free.h < 600, hintTop = free.y + free.h - (cmp ? 10 : 22) - (cmp ? 150 : 232) - 30;
    const srcRows = Math.max(0, Math.min(st.beams.length, Math.floor((hintTop - (free.y + 112) - 52 + 24) / 34) + 0));
    const telemetryRect: Rect | null = srcRows && free.w >= 980 ? { x: free.x + free.w - 44 - 230, y: free.y + 112, w: 230, h: 52 + srcRows * 34 } : null;
    // "Next: …" while flying, beside where the camera is going (only if it fits on the globe)
    const nextA = a * Math.min(clamp01((sc.flight - 0.2) / 0.2), 1 - sc.focus);
    if (nextA > 0 && sp.z > 0.2) {
      g.save(); g.globalAlpha = nextA;
      g.font = F(600, 17, "serif"); const t1 = `${m.text.next}: ${shortTitle(st.headline, 44)}`; const w1 = g.measureText(t1).width;
      const r = { x: sp.x + 28, y: sp.y - 20, w: w1 + 4, h: 38 };
      if (inDisk(r, v.cx, v.cy, v.scale, 8) && inFree(free, r)) {
        g.strokeStyle = rgba(P.ink, 0.7); g.lineWidth = 0.9; g.beginPath(); g.moveTo(sp.x + 6, sp.y - 2); g.lineTo(r.x - 5, r.y + 10); g.stroke();
        g.fillStyle = P.ink; shadowText(g, t1, r.x, r.y + 15);
        g.font = F(400, 12, "sans"); g.fillStyle = P.inkMute; shadowText(g, `${st.system.label} · ${st.system.outlets} ${m.text.outlets}`, r.x, r.y + 33, 4);
      }
      g.restore();
    }
    // outlets named across the top in serif, each joined to the story by a thin leader line; bold + solid = read in full
    const nb = st.beams.length;
    if (nb && sc.beams.some((b) => b > 0)) {
      // the names in one row across the top; smaller when the frame is narrow, so all of them fit
      let px = 21, widths: number[] = [], gapX = 64;
      for (; px >= 13; px -= 2) {
        widths = st.beams.map((b) => { g.font = F(b.fetched ? 700 : 400, px, "serif"); return Math.ceil(g.measureText(b.source).width) + 8; });
        gapX = px >= 19 ? 64 : 24;
        if (widths.reduce((a, w) => a + w, 0) + gapX * (nb - 1) <= free.w - 40) break;
      }
      px = Math.max(13, px);
      const chips = chipRow(nb, widths, sp.x - free.x, free.w, free.y + 40, gapX, 20).map((r) => ({ ...r, x: r.x + free.x }));
      chips.forEach((c, i) => {
        const b = sc.beams[i], bm = st.beams[i];
        if (b <= 0) return;
        const x0 = c.x + c.w / 2, y0 = c.y + 28, ex = sp.x, ey = sp.y;
        g.strokeStyle = rgba(bm.fetched ? "#ffffff" : P.ink, (bm.fetched ? 0.95 : 0.6) * a); g.lineWidth = bm.fetched ? 1.8 : 1.1;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (ex - x0) * b, y0 + (ey - y0) * b); g.stroke();
        const im = sc.impact[i];
        if (im > 0 && im < 1) { g.strokeStyle = rgba(P.accent, (1 - im) * 0.7 * a); g.lineWidth = 1.1; g.beginPath(); g.arc(ex, ey, 8 + im * 30, 0, 7); g.stroke(); }
      });
      chips.forEach((c, i) => {
        const b = sc.beams[i], bm = st.beams[i];
        if (b <= 0) return;
        const k = clamp01(b * 2.5);
        g.save(); g.globalAlpha = a * k; g.translate(0, (1 - k) * -6);
        g.font = F(bm.fetched ? 700 : 400, px, "serif"); g.fillStyle = bm.fetched ? "#ffffff" : P.ink; g.textAlign = "center";
        shadowText(g, bm.source, c.x + c.w / 2, c.y + 18, 8);
        g.restore();
      });
    }
    // the place, letter-spaced, beside the story once the camera has arrived
    if (sc.focus > 0 && sp.z > 0.2) {
      g.save(); g.globalAlpha = a * sc.focus;
      g.font = F(400, 24, "serif"); g.letterSpacing = "11px";
      const label = st.system.label.toUpperCase(), lw = g.measureText(label).width;
      const ty = sp.y - 58, right = { x: sp.x + 96, y: ty - 24, w: lw, h: 30 }, left = { ...right, x: sp.x - 96 - lw };
      const clash = (r: Rect) => (!!telemetryRect && overlaps(r, telemetryRect, 12)) || !inFree(f.free, r);
      const r = !clash(right) && inDisk(right, v.cx, v.cy, v.scale, 8) ? right : !clash(left) && inDisk(left, v.cx, v.cy, v.scale, 8) ? left : null;
      if (r) { g.fillStyle = P.ink; shadowText(g, label, r.x, ty, 10); }
      g.letterSpacing = "0px";
      g.restore();
    }
    // reticle: thin corner brackets close in on the story as the camera arrives, with where ORBIT places it (the country's point)
    if (sc.focus > 0 && sp.z > 0.2) {
      const k = sc.focus, R = 30 + (1 - k) * 26, L = 9;
      g.save(); g.globalAlpha = a * k; g.strokeStyle = rgba(P.ink, 0.9); g.lineWidth = 1.2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.beginPath(); g.moveTo(sp.x + sx * R, sp.y + sy * (R - L)); g.lineTo(sp.x + sx * R, sp.y + sy * R); g.lineTo(sp.x + sx * (R - L), sp.y + sy * R); g.stroke();
      }
      g.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(sp.x + dx * (R + 4), sp.y + dy * (R + 4)); g.lineTo(sp.x + dx * (R + 14), sp.y + dy * (R + 14)); } g.stroke();
      const la = st.system.lat, lo = st.system.lon;
      const coord = `${Math.abs(la).toFixed(1)}° ${la >= 0 ? "N" : "S"}   ${Math.abs(lo).toFixed(1)}° ${lo >= 0 ? "E" : "W"}`;
      g.font = F(400, 15, "serif"); g.fillStyle = P.ink; g.textAlign = "left";
      const cx = sp.x + R + 22, cy = sp.y + R + 22;
      const strapTop = free.y + free.h - (free.w < 900 || free.h < 600 ? 180 : 262); // the kicker line and above stay clear
      if (cy + 22 < strapTop && inDisk({ x: cx, y: cy - 14, w: 170, h: 40 }, v.cx, v.cy, v.scale, 8) && inFree(free, { x: cx, y: cy - 14, w: 170, h: 40 }) && !(telemetryRect && overlaps({ x: cx, y: cy - 14, w: 170, h: 40 }, telemetryRect, 12))) {
        g.fillRect(cx, cy - 18, 1, 26); shadowText(g, coord, cx + 10, cy, 6);
        g.font = F(400, 12, "sans"); g.fillStyle = P.inkMute; shadowText(g, `${st.system.reports} ${m.text.reports}`, cx + 10, cy + 17, 4);
      }
      g.restore();
    }
    // telemetry, top right: each outlet with a thin bar, full = ORBIT read the article in full, short = headline only
    const tk = a * Math.max(0, Math.min(1, ...sc.beams.slice(0, 1)));
    if (telemetryRect && tk > 0) {
      const x1 = free.x + free.w - 44, tw = 230, x0 = x1 - tw, y0 = free.y + 112;
      g.save(); g.globalAlpha = tk; g.textAlign = "left";
      hair(g, x0, y0, tw); g.font = F(400, 17, "serif"); g.fillStyle = P.ink; shadowText(g, m.text.sources, x0, y0 + 24, 6);
      st.beams.slice(0, srcRows).forEach((bm, i) => {
        const y = y0 + 52 + i * 34, k = clamp01(sc.beams[i] ?? 0);
        g.font = F(400, 13, "sans"); g.fillStyle = P.ink; shadowText(g, fitText(g, bm.source, tw - 90), x0, y, 4);
        g.textAlign = "right"; g.fillStyle = P.inkMute; g.font = F(400, 11, "sans"); shadowText(g, bm.fetched ? m.text.readFull : m.text.headlineOnly, x1, y, 4); g.textAlign = "left";
        g.fillStyle = P.track; g.fillRect(x0, y + 8, tw, 2);
        g.fillStyle = bm.fetched ? P.ink : "rgba(241,236,225,0.6)"; g.fillRect(x0, y + 8, tw * (bm.fetched ? 1 : 0.3) * k, 2);
      });
      g.restore();
    }
    const scrimA = a * Math.max(sc.lower[0], t.prev ? sc.prevLower : 0);
    scrim(f, scrimA);
    if (t.prev && sc.prevLower > 0) strap(m, f, t, t.prev, [1, 1, 1, 1, 1], a * sc.prevLower, (1 - sc.prevLower) * 12);
    strap(m, f, t, st, sc.lower, a, 0);
    timeline(m, f, t, a * Math.max(sc.lower[4], t.prev ? 1 : 0), t.paused);
  }

  return {
    draw,
    playRect: () => play,
    hit: (x, y) => cores.find((c) => Math.hypot(c.x - x, c.y - y) <= Math.max(10, c.r))?.key ?? null,
    setTexture: (kind, img) => {
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const cg = c.getContext("2d", { willReadFrequently: true })!; cg.drawImage(img, 0, 0);
      const t = { d: cg.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
      if (kind === "day") tex = t; else if (kind === "night") night = t; else clouds = t;
      baseKey = ""; labelKey = "";
    },
  };
}

export { wrapLines };
