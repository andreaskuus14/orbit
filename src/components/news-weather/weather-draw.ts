// News weather renderer (Canvas 2D, orthographic globe). No React here: the app (NewsWeatherLayer.tsx) and the motion test
// (scripts/news-weather-motion-test.mjs) both call draw() with the values from news-weather-motion-pure, so they show the same
// thing. Everything on the globe is clipped to its disk and fades toward the horizon; labels only go where they fit inside it.
// The still part (stars, ocean, land, isobars) is cached and only redrawn when the camera moves.
import world from "world-atlas/countries-110m.json";
import { decodeCountries } from "@/lib/topo";
import type { Stop, WxFront, WxSystem } from "@/lib/news-weather-pure";
import { shortTitle, wrapLines } from "@/lib/news-weather-pure";
import { chipRow, horizonFade, inDisk, placeLabels, project, slerp, trail, type Free, type Rect, type RestScene, type StopScene, type View } from "@/lib/news-weather-motion-pure";
import type { WX_TEXT } from "@/lib/news-weather-text-pure";

type Text = (typeof WX_TEXT)[keyof typeof WX_TEXT];
export type Fonts = { sans: string; mono: string; display: string };
export type WxModel = {
  systems: WxSystem[]; fronts: WxFront[]; isobars: { level: number; lines: [number, number][][] }[];
  title: string; forecast: string; since: string[]; playSub: string; canPlay: boolean; text: Text;
};
export type TourFrame = {
  stop: Stop; prev: Stop | null; scene: StopScene; idx: number; n: number; from: [number, number];
  paused: boolean; peaks: number[]; voiced: boolean;
};
export type WxFrame = {
  W: number; H: number; dpr: number; free: Free; view: View; now: number; reduced: boolean;
  rest: RestScene; tour: TourFrame | null; hover?: string | null;
};

const C = { bg: "#02050b", ocean: "#030a14", land: "#0a1a2b", border: "rgba(94,200,255,0.16)", cyan: "#5ec8ff", amber: "#ffb347", green: "#4ade80", text: "#e6f4ff", mute: "rgba(200,225,255,0.58)" };
const hex = (h: string, a: number) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`; };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

let LAND: [number, number][][] | null = null;
const land = () => (LAND ??= decodeCountries(world as unknown as Parameters<typeof decodeCountries>[0]).flatMap((c) => c.rings));
let GRAT: [number, number][][] | null = null;
const graticule = () => (GRAT ??= [
  ...Array.from({ length: 24 }, (_, i) => Array.from({ length: 33 }, (_, k) => [i * 15 - 180, -80 + k * 5] as [number, number])),
  ...Array.from({ length: 11 }, (_, i) => Array.from({ length: 73 }, (_, k) => [k * 5 - 180, -75 + i * 15] as [number, number])),
]);

/** A polygon ring on the visible hemisphere: cut where it crosses the horizon and closed along the rim. */
function ringPath(g: CanvasRenderingContext2D, v: View, ring: [number, number][]) {
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
    let prevB = -1;
    let px = 0, py = 0;
    for (const [lon, lat] of l) {
      const p = project(v, lon, lat), a = horizonFade(p.z, 0.62, 0.02);
      const b = a <= 0 ? -1 : Math.min(buckets - 1, Math.floor(a * buckets));
      if (b >= 0 && prevB >= 0) { const path = out[Math.min(b, prevB)]; path.moveTo(px, py); path.lineTo(p.x, p.y); }
      prevB = b; px = p.x; py = p.y;
    }
  }
  return out;
}

function glass(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 18, a = 1) {
  g.fillStyle = `rgba(8,18,32,${0.74 * a})`; g.strokeStyle = `rgba(94,200,255,${0.18 * a})`; g.lineWidth = 1;
  g.beginPath(); g.roundRect(x + 0.5, y + 0.5, w, h, r); g.fill(); g.stroke();
}
function haloText(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.save(); g.lineJoin = "round"; g.lineWidth = 4; g.strokeStyle = "rgba(2,5,11,0.82)"; g.strokeText(s, x, y); g.restore(); g.fillText(s, x, y);
}
function fitText(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.measureText(`${s.slice(0, m)}…`).width <= max) lo = m; else hi = m - 1; }
  return `${s.slice(0, lo).replace(/[\s,;:–—-]+$/, "")}…`;
}

export type WeatherDraw = { draw: (m: WxModel, f: WxFrame) => void; playRect: () => Rect | null; hit: (x: number, y: number) => string | null };

export function createWeatherDraw(canvas: HTMLCanvasElement, fonts: Fonts): WeatherDraw {
  const g = canvas.getContext("2d")!;
  const base = document.createElement("canvas"), bg = base.getContext("2d")!;
  let baseKey = "", labelKey = "", labelsCache: { id: string; x: number; y: number; w: number; h: number; ax: number; ay: number; s: WxSystem }[] = [];
  let play: Rect | null = null, cores: { key: string; x: number; y: number; r: number }[] = [];
  const F = (w: number, px: number, fam: keyof Fonts) => `${w} ${px}px ${fonts[fam]}`;

  function drawBase(m: WxModel, f: WxFrame) {
    const { W, H, dpr, view: v } = f;
    if (base.width !== W * dpr || base.height !== H * dpr) { base.width = W * dpr; base.height = H * dpr; }
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grd = bg.createRadialGradient(v.cx, v.cy, 40, v.cx, v.cy, Math.max(W, H) * 0.85);
    grd.addColorStop(0, "#06111f"); grd.addColorStop(1, C.bg);
    bg.fillStyle = grd; bg.fillRect(0, 0, W, H);
    let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < (W * H) / 3400; i++) { bg.fillStyle = `rgba(200,225,255,${(0.08 + rnd() * 0.32).toFixed(2)})`; const big = rnd() < 0.1; bg.fillRect(rnd() * W, rnd() * H, big ? 1.6 : 0.9, big ? 1.6 : 0.9); }
    const r = v.scale;
    const halo = bg.createRadialGradient(v.cx, v.cy, r * 0.96, v.cx, v.cy, r * 1.2);
    halo.addColorStop(0, "rgba(94,200,255,0.2)"); halo.addColorStop(1, "rgba(94,200,255,0)");
    bg.fillStyle = halo; bg.beginPath(); bg.arc(v.cx, v.cy, r * 1.2, 0, 7); bg.fill();
    bg.save(); bg.beginPath(); bg.arc(v.cx, v.cy, r, 0, 7); bg.clip();
    bg.fillStyle = C.ocean; bg.fillRect(v.cx - r, v.cy - r, 2 * r, 2 * r);
    bg.strokeStyle = "rgba(94,200,255,0.06)"; bg.lineWidth = 1;
    for (const p of linesByFade(v, graticule(), 1)) bg.stroke(p);
    bg.beginPath(); for (const ring of land()) ringPath(bg, v, ring);
    bg.fillStyle = C.land; bg.fill(); bg.strokeStyle = C.border; bg.lineWidth = 0.7; bg.stroke();
    // Isobars: the top two levels amber (the busy cores), the outermost dashed; every line fades toward the horizon.
    const n = m.isobars.length;
    m.isobars.forEach((iso, i) => {
      const hot = i >= n - 2, paths = linesByFade(v, iso.lines);
      bg.lineWidth = hot ? 1.5 : 1; bg.setLineDash(i === 0 ? [2, 5] : []);
      paths.forEach((p, b) => { const a = ((b + 1) / paths.length) * (hot ? 0.38 : 0.16 + i * 0.045); bg.strokeStyle = hex(hot ? C.amber : C.cyan, a); bg.stroke(p); });
    });
    bg.setLineDash([]);
    const rim = bg.createRadialGradient(v.cx, v.cy, r * 0.7, v.cx, v.cy, r);
    rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, "rgba(94,200,255,0.10)");
    bg.fillStyle = rim; bg.fillRect(v.cx - r, v.cy - r, 2 * r, 2 * r);
    bg.restore();
  }

  function front(fr: WxFront, systems: Map<string, WxSystem>, v: View, now: number, reduced: boolean, alpha: number) {
    const a = systems.get(fr.from), b = systems.get(fr.to);
    if (!a || !b || alpha <= 0) return;
    const N = 64, pts = Array.from({ length: N + 1 }, (_, i) => { const [lon, lat] = slerp([a.lon, a.lat], [b.lon, b.lat], i / N); return project(v, lon, lat); });
    g.lineWidth = 2; g.lineCap = "round";
    for (let i = 1; i <= N; i++) {
      const p = pts[i - 1], q = pts[i], k = Math.min(horizonFade(p.z, 0.4, 0.02), horizonFade(q.z, 0.4, 0.02));
      if (k <= 0) continue;
      g.strokeStyle = hex(fr.color, 0.9 * k * alpha); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
    }
    // Triangles on the leading side, leaning the way the story travels (from → to); they drift slowly along the line.
    const drift = reduced ? 0 : ((now / 1000) * 0.6) % 6;
    for (let s = 4 + drift; s < N - 3; s += 6) {
      const i = Math.floor(s), p = pts[i], q = pts[i + 2];
      const k = Math.min(horizonFade(p.z, 0.4, 0.02), horizonFade(q.z, 0.4, 0.02));
      if (k <= 0) continue;
      // fixed screen size whatever the zoom (the line's samples spread far apart when the camera is close)
      const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, zk = Math.min(1.6, Math.sqrt(v.scale / 320));
      const base = Math.min(L, 16 * zk), h = 7 * zk;
      g.fillStyle = hex(fr.color, 0.95 * k * alpha);
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + ux * base, p.y + uy * base); g.lineTo(p.x + ux * base * 0.72 - uy * h, p.y + uy * base * 0.72 + ux * h); g.closePath(); g.fill();
    }
  }

  function system(s: WxSystem, v: View, now: number, reduced: boolean, focus: number, dim: number) {
    const p = project(v, s.lon, s.lat), fade = horizonFade(p.z, 0.3, 0.03) * dim;
    if (fade <= 0) return;
    const zoom = Math.min(2.4, Math.max(0.8, Math.sqrt(v.scale / 320)));
    g.save(); g.translate(p.x, p.y);
    const rad = Math.atan2(p.y - v.cy, p.x - v.cx); g.rotate(rad); g.scale(Math.max(0.3, p.z), 1); g.rotate(-rad); // foreshorten toward the edge
    g.globalAlpha = fade;
    if (s.kind === "storm") {
      const R = (14 + Math.sqrt(s.reports) * 3.6) * zoom;
      const haze = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.9); haze.addColorStop(0, hex(s.color, 0.22)); haze.addColorStop(1, hex(s.color, 0));
      g.fillStyle = haze; g.beginPath(); g.arc(0, 0, R * 1.9, 0, 7); g.fill();
      const dir = s.lat >= 0 ? -1 : 1, spin = reduced ? s.lon * 0.05 : s.lon * 0.05 + (now / 1000) * 0.35; // cyclones turn anticlockwise in the north
      for (const [lw, al] of [[7, 0.18], [1.8, 0.95]] as const) for (let arm = 0; arm < 4; arm++) {
        g.beginPath();
        for (let k = 0; k < 96; k++) { const a = dir * (spin + arm * 1.571 + k * 0.065), rr = R * (0.18 + k / 72); const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.86; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.6); gr.addColorStop(0, hex(s.color, al)); gr.addColorStop(1, hex(s.color, 0));
        g.strokeStyle = gr; g.lineWidth = lw; g.lineCap = "round"; g.stroke();
      }
      const core = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.7); core.addColorStop(0, "rgba(255,255,255,0.95)"); core.addColorStop(0.25, hex(s.color, 0.8)); core.addColorStop(1, hex(s.color, 0));
      g.fillStyle = core; g.beginPath(); g.arc(0, 0, R * 0.7, 0, 7); g.fill();
      g.fillStyle = C.bg; g.beginPath(); g.arc(0, 0, 2.6, 0, 7); g.fill();
      cores.push({ key: s.key, x: p.x, y: p.y, r: R * 0.8 });
    } else {
      const breathe = reduced ? 1 : 1 + 0.06 * Math.sin(now / 900 + s.lon);
      const R = (4 + Math.sqrt(s.reports) * 1.6) * zoom * breathe;
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 2.2); gr.addColorStop(0, hex(s.color, 0.75)); gr.addColorStop(1, hex(s.color, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 2.2, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(0, 0, 1.8 * Math.min(1.6, zoom), 0, 7); g.fill();
      cores.push({ key: s.key, x: p.x, y: p.y, r: R * 1.4 });
    }
    if (focus > 0) { // the story the tour is on: soft rings breathing outward
      for (let i = 4; i > 0; i--) {
        const ph = reduced ? 0 : ((now / 2400) % 1) * 0.25;
        g.strokeStyle = hex(s.color, 0.13 * i * focus); g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(0, 0, 22 * (i + ph) * focus * 1.1, 14 * (i + ph) * focus * 1.1, -0.15, 0, 7); g.stroke();
      }
    }
    g.restore();
  }

  function draw(m: WxModel, f: WxFrame) {
    const { W, H, dpr, view: v, now, reduced, free, rest, tour } = f;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    const key = [W, H, dpr, v.lon.toFixed(3), v.lat.toFixed(3), v.scale.toFixed(2), v.cx.toFixed(1), v.cy.toFixed(1), m.isobars.length, m.systems.length].join("|");
    if (key !== baseKey) { drawBase(m, f); baseKey = key; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const byKey = new Map(m.systems.map((s) => [s.key, s]));
    const tourA = tour ? 1 - rest.hud[0] : 0, restLabels = rest.hud[3];

    // ---- on the globe (clipped to its disk) ----
    g.save(); g.beginPath(); g.arc(v.cx, v.cy, v.scale, 0, 7); g.clip();
    const frontA = tour ? 0.35 + 0.65 * rest.hud[1] : 1;
    for (const fr of m.fronts) front(fr, byKey, v, now, reduced, frontA);
    cores = [];
    const focusKey = tour?.stop.system.key;
    for (const s of [...m.systems].reverse()) system(s, v, now, reduced, s.key === focusKey ? tour!.scene.focus : 0, tour && s.key !== focusKey ? 0.55 + 0.45 * rest.hud[1] : 1);
    if (tour && tour.scene.trailA > 0) { // the flight trail: a short arc of dots behind the camera, lifted off the surface
      const to = tour.stop.system;
      for (const d of trail(tour.from, [to.lon, to.lat], tour.scene.trailP)) {
        const p = project(v, d.lon, d.lat, d.alt);
        if (p.z <= 0.02) continue;
        g.fillStyle = hex(C.cyan, (0.15 + 0.7 * (1 - d.age)) * tour.scene.trailA * horizonFade(p.z, 0.3, 0.02));
        g.beginPath(); g.arc(p.x, p.y, 1.5 + 2.5 * (1 - d.age), 0, 7); g.fill();
      }
    }
    g.restore();

    // ---- labels at rest: placed without overlaps, inside the disk, clear of storm cores and the HUD ----
    const hudRects = restHud(m, f, true);
    if (restLabels > 0.01) {
      const lk = `${baseKey}|${m.since.length}`;
      if (lk !== labelKey) {
        labelKey = lk;
        g.font = F(600, 13, "sans");
        const seenTitle = new Set<string>();
        const items = m.systems.flatMap((s) => { // one label per story: a front already links the countries that share it
          const tk = shortTitle(s.title, 30).toLowerCase();
          if (seenTitle.has(tk)) return [];
          const p = project(v, s.lon, s.lat);
          if (horizonFade(p.z, 0.3, 0.03) < 0.5) return [];
          seenTitle.add(tk);
          const t1 = shortTitle(s.title, 30), t2 = `${s.label} · ${s.outlets} ${s.outlets === 1 ? m.text.outlet : m.text.outlets} · ${s.reports} ${m.text.reports}`;
          g.font = F(600, 13, "sans"); const w1 = g.measureText(t1).width; g.font = F(400, 12, "sans"); const w2 = g.measureText(t2).width;
          return [{ id: s.key, ax: p.x, ay: p.y, w: Math.ceil(Math.max(w1, w2)) + 4, h: 34, prio: (s.kind === "storm" ? 1000 : 0) + s.outlets * 10 + Math.min(9, s.reports / 20) }];
        });
        const blockers = [...hudRects, ...cores.map((c) => ({ x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r }))];
        labelsCache = placeLabels(items, blockers, (r) => inDisk(r, v.cx, v.cy, v.scale, 8)).map((l) => ({ ...l, s: byKey.get(l.id)! }));
      }
      g.globalAlpha = restLabels;
      for (const l of labelsCache) {
        const near = l.x > l.ax ? l.x - 3 : l.x + l.w + 3, ny = l.y + l.h / 2 - 2;
        g.strokeStyle = "rgba(200,225,255,0.25)"; g.lineWidth = 1; g.beginPath(); g.moveTo(l.ax, l.ay); g.lineTo(near, ny); g.stroke();
        const on = f.hover === l.id;
        g.textAlign = "left"; g.font = F(600, 13, "sans"); g.fillStyle = l.s.kind === "storm" || on ? C.text : l.s.color;
        haloText(g, shortTitle(l.s.title, 30), l.x, l.y + 13);
        g.font = F(400, 12, "sans"); g.fillStyle = on ? C.text : C.mute;
        haloText(g, `${l.s.label} · ${l.s.outlets} ${l.s.outlets === 1 ? m.text.outlet : m.text.outlets} · ${l.s.reports} ${m.text.reports}`, l.x, l.y + 29);
      }
      g.globalAlpha = 1;
    }
    restHud(m, f, false);
    if (tour && tourA > 0) tourHud(m, f, tour, tourA);
  }

  /** The rest HUD: title + forecast, legend, play button, "since you last looked". measure=true only returns the rects. */
  function restHud(m: WxModel, f: WxFrame, measure: boolean): Rect[] {
    const { free, H, rest } = f, x0 = free.x + 40, right = free.x + free.w - 40;
    const rects: Rect[] = [{ x: x0, y: free.y + 30, w: Math.min(520, free.w - 80), h: 100 }, { x: x0, y: H - 40 - 142, w: 318, h: 142 }, { x: right - 268, y: H - 40 - 60, w: 268, h: 60 }];
    const sinceH = m.since.length ? 52 + m.since.length * 28 : 0;
    if (sinceH) rects.push({ x: right - 380, y: free.y + 36, w: 380, h: sinceH });
    play = rects[2];
    if (measure) return rects;
    const lift = (i: number) => (1 - rest.hud[i]) * -10;
    // title + forecast
    if (rest.hud[0] > 0) {
      g.save(); g.globalAlpha = rest.hud[0]; g.translate(0, lift(0));
      g.font = F(700, 14, "display"); g.fillStyle = C.cyan; g.letterSpacing = "6px"; g.fillText(m.text.kicker, x0, free.y + 52); g.letterSpacing = "0px";
      g.font = F(600, 28, "sans"); g.fillStyle = C.text; g.fillText(m.title, x0, free.y + 90);
      g.font = F(400, 15, "sans"); g.fillStyle = C.mute; g.fillText(fitText(g, m.forecast, free.w - 80), x0, free.y + 116);
      g.restore();
    }
    // legend, with a tiny glyph for each mark
    if (rest.hud[1] > 0) {
      const [lx, ly] = [rects[1].x, rects[1].y];
      g.save(); g.globalAlpha = rest.hud[1]; g.translate(0, -lift(1));
      glass(g, lx, ly, 318, 142);
      g.font = F(500, 11, "mono"); g.fillStyle = C.mute; g.letterSpacing = "2px"; g.fillText(m.text.howTo, lx + 20, ly + 28); g.letterSpacing = "0px";
      const rows: [string, string][] = [[m.text.storm, m.text.stormIs], [m.text.cell, m.text.cellIs], [m.text.front, m.text.frontIs], [m.text.isobars, m.text.isobarsIs]];
      rows.forEach(([k, t], i) => {
        const y = ly + 54 + i * 23, gx = lx + 28;
        g.strokeStyle = C.amber; g.fillStyle = C.amber; g.lineWidth = 1.4;
        if (i === 0) { g.beginPath(); for (let a = 0; a < 9; a += 0.25) { const r = 0.9 * a; const px = gx + Math.cos(-a) * r, py = y - 4 + Math.sin(-a) * r * 0.86; if (a) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); }
        if (i === 1) { g.beginPath(); g.arc(gx, y - 4, 3, 0, 7); g.fill(); }
        if (i === 2) { g.strokeStyle = C.green; g.fillStyle = C.green; g.beginPath(); g.moveTo(gx - 9, y - 3); g.lineTo(gx + 9, y - 3); g.stroke(); g.beginPath(); g.moveTo(gx - 4, y - 3); g.lineTo(gx + 2, y - 3); g.lineTo(gx + 1, y - 9); g.closePath(); g.fill(); }
        if (i === 3) { g.strokeStyle = hex(C.cyan, 0.7); g.setLineDash([2, 3]); g.beginPath(); g.ellipse(gx, y - 4, 9, 5, 0, 0, 7); g.stroke(); g.setLineDash([]); }
        g.font = F(600, 13, "sans"); g.fillStyle = C.text; g.fillText(k, lx + 48, y);
        g.font = F(400, 13, "sans"); g.fillStyle = C.mute; g.fillText(fitText(g, t, 318 - 120), lx + 112, y);
      });
      g.restore();
    }
    // play button: anticipation dip on press, settle back, a ripple from the icon
    if (rest.hud[2] > 0) {
      const r = rects[2], cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      g.save(); g.globalAlpha = rest.hud[2] * (m.canPlay ? 1 : 0.55); g.translate(0, -lift(2));
      g.translate(cx, cy); g.scale(rest.press, rest.press); g.translate(-cx, -cy);
      glass(g, r.x, r.y, r.w, r.h, r.h / 2);
      const ix = r.x + 31, iy = cy;
      if (rest.ripple > 0 && rest.ripple < 1) { g.strokeStyle = hex(C.cyan, 0.6 * (1 - rest.ripple)); g.lineWidth = 2; g.beginPath(); g.arc(ix, iy, 19 + rest.ripple * 46, 0, 7); g.stroke(); }
      g.fillStyle = m.canPlay ? C.cyan : C.mute; g.beginPath(); g.arc(ix, iy, 18, 0, 7); g.fill();
      g.fillStyle = C.bg; g.beginPath(); g.moveTo(ix - 5, iy - 9); g.lineTo(ix - 5, iy + 9); g.lineTo(ix + 9, iy); g.closePath(); g.fill();
      g.font = F(600, 15, "sans"); g.fillStyle = C.text; g.fillText(fitText(g, m.canPlay ? m.text.play : m.text.noBriefing, r.w - 70), r.x + 60, cy - 3);
      g.font = F(400, 12, "sans"); g.fillStyle = C.mute; g.fillText(m.playSub, r.x + 60, cy + 15);
      g.restore();
    }
    if (sinceH && rest.hud[3] > 0) {
      const r = rects[3];
      g.save(); g.globalAlpha = rest.hud[3]; g.translate(0, lift(3));
      glass(g, r.x, r.y, r.w, r.h, 18);
      g.font = F(500, 11, "mono"); g.fillStyle = C.mute; g.letterSpacing = "2px"; g.fillText(m.text.since, r.x + 26, r.y + 32); g.letterSpacing = "0px";
      m.since.forEach((t, i) => {
        g.fillStyle = /weak|nõrg/i.test(t) ? C.mute : C.amber; g.beginPath(); g.arc(r.x + 14, r.y + 61 + i * 28, 3, 0, 7); g.fill();
        g.font = F(400, 14, "sans"); g.fillStyle = C.text; g.fillText(fitText(g, t, r.w - 50), r.x + 26, r.y + 66 + i * 28);
      });
      g.restore();
    }
    return rects;
  }

  function lowerThird(m: WxModel, f: WxFrame, st: Stop, lower: number[], alpha: number, dy: number, voice: number, peaks: number[], voiced: boolean, paused: boolean) {
    const { free, H } = f, w = Math.min(660, free.w - 80), h = 196, x = free.x + 40, y = H - 40 - h + dy;
    const el = (i: number) => lower[i] * alpha;
    if (el(0) <= 0) return;
    g.save();
    g.globalAlpha = el(0); g.translate(0, (1 - lower[0]) * 14); glass(g, x, y, w, h, 20); g.translate(0, -(1 - lower[0]) * 14);
    const slide = (i: number) => (1 - lower[i]) * 10;
    const n = st.system.outlets;
    g.globalAlpha = el(1); g.font = F(600, 12, "mono"); g.letterSpacing = "1px"; g.fillStyle = st.confirmed ? C.green : C.amber;
    g.fillText(`${st.confirmed ? m.text.confirmed : m.text.single} · ${n} ${(n === 1 ? m.text.outlet : m.text.outlets).toUpperCase()}`, x + 28, y + 36 + slide(1)); g.letterSpacing = "0px";
    if (st.beams.some((b) => b.fetched)) { // what a bright beam means, said once where the eye already is
      g.font = F(400, 12, "sans"); g.fillStyle = C.mute; g.textAlign = "right"; g.fillText(m.text.bright, x + w - 28, y + 36 + slide(1)); g.textAlign = "left";
    }
    g.globalAlpha = el(2); g.font = F(600, 26, "sans"); g.fillStyle = C.text; g.fillText(fitText(g, st.headline, w - 56), x + 28, y + 74 + slide(2));
    g.globalAlpha = el(3); g.font = F(400, 15, "sans"); g.fillStyle = "rgba(220,235,255,0.84)";
    st.lines.forEach((l, i) => g.fillText(fitText(g, l, w - 56), x + 28, y + 106 + i * 23 + slide(3)));
    g.globalAlpha = el(4);
    const bars = 46, bx = x + 28, by = y + h - 30 + slide(4);
    for (let i = 0; i < bars; i++) {
      const p = peaks[i] ?? 0.3, bh = 4 + p * 20;
      g.fillStyle = !voiced ? "rgba(200,225,255,0.18)" : i / bars < voice ? C.cyan : "rgba(200,225,255,0.25)";
      g.beginPath(); g.roundRect(bx + i * 6, by - bh / 2, 3, bh, 1.5); g.fill();
    }
    g.font = F(400, 12, "sans"); g.fillStyle = C.mute;
    g.fillText(fitText(g, paused ? `${m.text.paused} · ${m.text.keys}` : voiced ? m.text.keys : `${m.text.noVoice} · ${m.text.keys}`, w - 56 - bars * 6 - 18), bx + bars * 6 + 16, by + 4);
    g.restore();
  }

  function tourHud(m: WxModel, f: WxFrame, t: TourFrame, a: number) {
    const { free, view: v } = f, sc = t.scene, st = t.stop, x0 = free.x + 40;
    // progress segments + "2 / 6 · WORLD"
    g.save(); g.globalAlpha = a;
    const seg = Math.min(86, (Math.min(560, free.w * 0.45) - (t.n - 1) * 8) / t.n);
    for (let i = 0; i < t.n; i++) {
      g.fillStyle = "rgba(200,225,255,0.18)"; g.beginPath(); g.roundRect(x0 + i * (seg + 8), free.y + 44, seg, 4, 2); g.fill();
      const p = i < t.idx ? 1 : i === t.idx ? Math.max(0.04, sc.voice) : 0;
      if (p > 0) { g.fillStyle = i < t.idx ? C.cyan : "rgba(94,200,255,0.75)"; g.beginPath(); g.roundRect(x0 + i * (seg + 8), free.y + 44, seg * p, 4, 2); g.fill(); }
    }
    g.font = F(500, 12, "mono"); g.fillStyle = C.mute; g.letterSpacing = "1px";
    g.fillText(`${t.idx + 1} / ${t.n}${st.section ? ` · ${st.section.toUpperCase()}` : ""}`, x0, free.y + 72); g.letterSpacing = "0px";
    g.restore();

    const sp = project(v, st.system.lon, st.system.lat);
    // "Next: …" while flying, near where the camera is going (only if it fits on the globe)
    const nextA = a * Math.min(clamp01((sc.flight - 0.2) / 0.2), 1 - sc.focus);
    if (nextA > 0 && sp.z > 0.2) {
      g.save(); g.globalAlpha = nextA;
      g.font = F(600, 14, "sans"); const t1 = `${m.text.next}: ${shortTitle(st.headline, 44)}`; const w1 = g.measureText(t1).width;
      const r = { x: sp.x + 22, y: sp.y - 18, w: w1 + 4, h: 36 };
      if (inDisk(r, v.cx, v.cy, v.scale, 8)) {
        g.fillStyle = C.text; haloText(g, t1, r.x, r.y + 13);
        g.font = F(400, 12, "sans"); g.fillStyle = C.mute; haloText(g, `${st.system.label} · ${st.system.outlets} ${m.text.outlets}`, r.x, r.y + 30);
      }
      g.restore();
    }
    // beams from the outlets' chips down to the story; bright = ORBIT read that article in full
    const nb = st.beams.length;
    if (nb && sc.beams.some((b) => b > 0)) {
      g.font = F(600, 12, "sans");
      const widths = st.beams.map((b) => Math.ceil(g.measureText(b.source).width) + 40);
      const chips = chipRow(nb, widths, sp.x - free.x, free.w, free.y + 96).map((r) => ({ ...r, x: r.x + free.x }));
      chips.forEach((c, i) => {
        const b = sc.beams[i], bm = st.beams[i];
        if (b <= 0) return;
        const x0b = c.x + c.w / 2, y0b = c.y + c.h, qx = (x0b + sp.x) / 2, qy = Math.min(y0b, sp.y) - 40;
        const at = (u: number) => [(1 - u) ** 2 * x0b + 2 * (1 - u) * u * qx + u * u * sp.x, (1 - u) ** 2 * y0b + 2 * (1 - u) * u * qy + u * u * sp.y];
        const gr = g.createLinearGradient(x0b, y0b, sp.x, sp.y);
        gr.addColorStop(0, hex(C.cyan, (bm.fetched ? 0.95 : 0.5) * a)); gr.addColorStop(1, hex(st.system.color, (bm.fetched ? 0.95 : 0.55) * a));
        const path = new Path2D(); path.moveTo(x0b, y0b);
        for (let k = 1; k <= 28; k++) { const [px, py] = at((k / 28) * b); path.lineTo(px, py); }
        if (bm.fetched) { g.strokeStyle = hex(C.cyan, 0.16 * a); g.lineWidth = 8; g.stroke(path); }
        g.strokeStyle = gr; g.lineWidth = bm.fetched ? 2.4 : 1.3; g.lineCap = "round"; g.stroke(path);
        if (b < 1) { const [hx, hy] = at(b); g.fillStyle = hex("#ffffff", 0.9 * a); g.beginPath(); g.arc(hx, hy, bm.fetched ? 3 : 2, 0, 7); g.fill(); }
        const im = sc.impact[i];
        if (im > 0 && im < 1) { g.strokeStyle = hex(bm.fetched ? "#ffffff" : st.system.color, (1 - im) * 0.7 * a); g.lineWidth = bm.fetched ? 2 : 1.2; g.beginPath(); g.ellipse(sp.x, sp.y, 6 + im * 42, (6 + im * 42) * 0.62, 0, 0, 7); g.stroke(); }
        g.save(); g.globalAlpha = a * clamp01(b * 2.5); g.translate(0, (1 - clamp01(b * 2.5)) * -8);
        glass(g, c.x, c.y, c.w, c.h, c.h / 2);
        g.fillStyle = bm.fetched ? C.cyan : C.mute; g.beginPath(); g.arc(c.x + 16, c.y + c.h / 2, 3, 0, 7); g.fill();
        g.fillStyle = C.text; g.textAlign = "left"; g.fillText(st.beams[i].source, c.x + 26, c.y + c.h / 2 + 4);
        g.restore();
      });
    }
    // the place, beside the storm, once the camera has arrived
    if (sc.focus > 0 && sp.z > 0.2) {
      g.save(); g.globalAlpha = a * sc.focus; g.font = F(600, 13, "mono"); g.fillStyle = st.system.color;
      const tx = sp.x + 36, ty = sp.y + 46; // below the "Next" line it replaces, so the two never overlap while they cross-fade
      if (inDisk({ x: tx, y: ty - 14, w: 220, h: 34 }, v.cx, v.cy, v.scale, 8)) {
        haloText(g, st.system.label, tx, ty); g.font = F(400, 12, "sans"); g.fillStyle = C.mute; haloText(g, `${st.system.reports} ${m.text.reports}`, tx, ty + 16);
      }
      g.restore();
    }
    if (t.prev && sc.prevLower > 0) lowerThird(m, f, t.prev, [1, 1, 1, 1, 1], a * sc.prevLower, (1 - sc.prevLower) * 12, 1, t.peaks, t.voiced, false);
    lowerThird(m, f, st, sc.lower, a, 0, sc.voice, t.peaks, t.voiced, t.paused);
  }

  return {
    draw,
    playRect: () => play,
    hit: (x, y) => cores.find((c) => Math.hypot(c.x - x, c.y - y) <= Math.max(10, c.r))?.key ?? null,
  };
}

/** Voice-bar heights (0..1) from decoded audio between two times, or a calm made-up shape when there is no audio. */
export function peaksOf(data: Float32Array | null, rate: number, fromS: number, toS: number, n = 46): number[] {
  if (!data || !(toS > fromS)) return Array.from({ length: n }, (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.37)));
  const a = Math.floor(fromS * rate), b = Math.min(data.length, Math.floor(toS * rate)), step = Math.max(1, Math.floor((b - a) / n));
  const out = Array.from({ length: n }, (_, i) => { let m = 0; for (let k = a + i * step; k < Math.min(b, a + (i + 1) * step); k += 8) m = Math.max(m, Math.abs(data[k])); return m; });
  const top = Math.max(1e-6, ...out);
  return out.map((v) => Math.min(1, v / top));
}
export { wrapLines };
