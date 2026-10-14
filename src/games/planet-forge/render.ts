// Planet Forge renderer: procedural 2D canvas drawing of a GameState. Reads state, never changes it.
// Planets are drawn as lit spheres whose surface features (craters, forests, factories, cracks) rotate with the planet
// and appear or grow from the planet's state, so every development choice is visible.
import {
  WORLD, PLANETS, MINE_RANGE, GATE_RANGE, planetPos, planetStatus, gateProgress, targetPoint,
  type GameState, type PlanetId, type Resource, type GameEvent,
} from "./rules";

export const RES_COLOR: Record<Resource, string> = { ore: "#f59e0b", crystal: "#22d3ee", energy: "#a3e635" };
export const STATUS_COLOR = { untouched: "#94a3b8", industrialized: "#fb923c", restored: "#4ade80", unstable: "#f43f5e" } as const;

const PALETTE: Record<PlanetId, { light: string; mid: string; dark: string; patch: string; land: string }> = {
  ferros: { light: "#f6b48c", mid: "#b5532f", dark: "#3a120a", patch: "rgba(90,28,12,0.55)", land: "rgba(220,140,90,0.35)" },
  glacia: { light: "#f5fcff", mid: "#8ccfee", dark: "#173e66", patch: "rgba(255,255,255,0.7)", land: "rgba(120,190,230,0.45)" },
  verdan: { light: "#86e6da", mid: "#1d7e9b", dark: "#06243a", patch: "rgba(215,190,130,0.85)", land: "rgba(215,190,130,0.85)" },
};

// ---------- deterministic surface features ----------
type Feat = { lon: number; lat: number; size: number };
type Crack = { pts: { lon: number; lat: number }[] };
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const feats = (r: () => number, n: number, lo: number, hi: number, latMax = 1.2): Feat[] =>
  Array.from({ length: n }, () => ({ lon: r() * Math.PI * 2, lat: (r() * 2 - 1) * latMax, size: lo + r() * (hi - lo) }));
const SURF: Record<PlanetId, { patches: Feat[]; craters: Feat[]; veg: Feat[]; factories: Feat[]; cracks: Crack[] }> = Object.fromEntries(
  PLANETS.map((p, i) => {
    const r = rng(1000 + i * 77);
    const cracks: Crack[] = Array.from({ length: 6 }, () => {
      let lon = r() * Math.PI * 2, lat = (r() * 2 - 1) * 0.9;
      const pts = [{ lon, lat }];
      for (let k = 0; k < 5; k++) { lon += (r() - 0.3) * 0.35; lat += (r() - 0.5) * 0.3; pts.push({ lon, lat }); }
      return { pts };
    });
    return [p.id, { patches: feats(r, 9, 0.18, 0.38, 1.1), craters: feats(r, 16, 0.07, 0.16, 1.2), veg: feats(r, 24, 0.1, 0.22, 1.15), factories: feats(r, 12, 0.07, 0.09, 0.9), cracks }];
  }),
) as never;

function project(f: { lon: number; lat: number }, spin: number, R: number) {
  const l = f.lon + spin;
  const z = Math.cos(l) * Math.cos(f.lat);
  return { x: Math.sin(l) * Math.cos(f.lat) * R, y: Math.sin(f.lat) * R, z };
}

// ---------- effects (particles, popups), owned by the component ----------
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; kind: "chunk" | "smoke" | "spark" };
export type Popup = { x: number; y: number; text: string; color: string; life: number };
export type Fx = { particles: Particle[]; popups: Popup[]; veg: Record<PlanetId, number>; fac: Record<PlanetId, number>; beam: number; shake: number; flash: number };
export const createFx = (s: GameState): Fx => ({
  particles: [], popups: [], beam: 0, shake: 0, flash: 0,
  veg: Object.fromEntries(s.planets.map((p) => [p.id, p.restoration])) as Record<PlanetId, number>,
  fac: Object.fromEntries(s.planets.map((p) => [p.id, p.industry])) as Record<PlanetId, number>,
});

/** Turns game events into visual effects. */
export function fxEvents(fx: Fx, s: GameState, events: GameEvent[], reduced: boolean) {
  for (const e of events) {
    if (e.type === "mined") {
      fx.beam = 0.25;
      const def = PLANETS.find((p) => p.id === e.planet)!;
      const a = Math.atan2(s.ship.y - e.y, s.ship.x - e.x);
      const sx = e.x + Math.cos(a) * def.radius, sy = e.y + Math.sin(a) * def.radius;
      const n = reduced ? 2 : 7;
      for (const r of ["ore", "crystal", "energy"] as Resource[]) {
        if (e.gains[r] <= 0.01) continue;
        for (let i = 0; i < n; i++) {
          const spread = (Math.random() - 0.5) * 1.6;
          const sp = 60 + Math.random() * 90;
          fx.particles.push({ x: sx, y: sy, vx: Math.cos(a + spread) * sp, vy: Math.sin(a + spread) * sp, life: 0, max: 0.6 + Math.random() * 0.4, color: RES_COLOR[r], size: 2 + Math.random() * 2.5, kind: "chunk" });
        }
      }
      const parts = (["ore", "crystal", "energy"] as Resource[]).filter((r) => e.gains[r] >= 0.05);
      parts.forEach((r, i) => fx.popups.push({ x: s.ship.x + 14, y: s.ship.y - 18 - i * 18, text: `+${fmtAmt(e.gains[r])} ${r}`, color: RES_COLOR[r], life: 0 }));
    }
    if (e.type === "status" && e.to === "unstable" && !reduced) fx.shake = 0.6;
    if (e.type === "gate" || e.type === "won") fx.flash = 1;
  }
}
export const fmtAmt = (n: number) => (n >= 10 || Number.isInteger(n) ? Math.round(n).toString() : n.toFixed(1));

export function updateFx(fx: Fx, s: GameState, dt: number, reduced: boolean) {
  for (const p of fx.particles) {
    p.life += dt;
    if (p.kind === "chunk") { // drawn toward the ship like a tractor beam
      const dx = s.ship.x - p.x, dy = s.ship.y - p.y, d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * 900 * dt; p.vy += (dy / d) * 900 * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      if (d < 10) p.life = p.max;
    } else { p.vx *= 0.98; p.vy *= 0.98; }
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  fx.particles = fx.particles.filter((p) => p.life < p.max).slice(-400);
  for (const p of fx.popups) { p.life += dt; p.y -= 26 * dt; }
  fx.popups = fx.popups.filter((p) => p.life < 1.1).slice(-24);
  fx.beam = Math.max(0, fx.beam - dt);
  fx.shake = Math.max(0, fx.shake - dt);
  fx.flash = Math.max(0, fx.flash - dt * 0.8);
  // Forests and factories grow in over a couple of seconds instead of popping in.
  for (const p of s.planets) {
    fx.veg[p.id] += Math.sign(p.restoration - fx.veg[p.id]) * Math.min(Math.abs(p.restoration - fx.veg[p.id]), dt * 0.6);
    fx.fac[p.id] += Math.sign(p.industry - fx.fac[p.id]) * Math.min(Math.abs(p.industry - fx.fac[p.id]), dt * 0.8);
    // Factory smoke and unstable debris.
    if (!reduced && p.industry > 0 && Math.random() < dt * 4 * p.industry) {
      const def = PLANETS.find((d) => d.id === p.id)!;
      const pos = planetPos(def, s.time);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      fx.particles.push({ x: pos.x + Math.cos(a) * def.radius * 0.9, y: pos.y + Math.sin(a) * def.radius * 0.9, vx: Math.cos(a) * 12, vy: Math.sin(a) * 12 - 8, life: 0, max: 2.2, color: "rgba(150,140,130,", size: 4 + Math.random() * 4, kind: "smoke" });
    }
    if (!reduced && p.unstable && Math.random() < dt * 3) {
      const def = PLANETS.find((d) => d.id === p.id)!;
      const pos = planetPos(def, s.time), a = Math.random() * Math.PI * 2;
      fx.particles.push({ x: pos.x + Math.cos(a) * def.radius, y: pos.y + Math.sin(a) * def.radius, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 0, max: 0.9, color: "#fb7185", size: 2, kind: "spark" });
    }
  }
}

// ---------- scene ----------
export type View = { scale: number; ox: number; oy: number; dpr: number; w: number; h: number };
// The part of the world worth framing (orbits, gate and labels); the rest is starfield margin.
const CAM = { x: 0, y: 125, w: WORLD.w, h: 795 };
/** Fits the world between the HUD's top bar and bottom panel (insets in CSS px). */
export function fitView(cssW: number, cssH: number, dpr: number, top = 0, bottom = 0): View {
  const availH = Math.max(100, cssH - top - bottom);
  const scale = Math.min(cssW / CAM.w, availH / CAM.h);
  return { scale, ox: (cssW - CAM.w * scale) / 2 - CAM.x * scale, oy: top + (availH - CAM.h * scale) / 2 - CAM.y * scale, dpr, w: cssW, h: cssH };
}
export const toWorld = (v: View, x: number, y: number) => ({ x: (x - v.ox) / v.scale, y: (y - v.oy) / v.scale });

const STARS = (() => {
  const r = rng(42);
  return Array.from({ length: 260 }, () => ({ x: r() * WORLD.w * 1.4 - WORLD.w * 0.2, y: r() * WORLD.h * 1.4 - WORLD.h * 0.2, s: r() * 1.6 + 0.3, t: r() * 6 }));
})();

export type DrawOpts = { reduced: boolean; mining: PlanetId | null; thrust: boolean; hover: PlanetId | "gate" | null };

export function draw(ctx: CanvasRenderingContext2D, v: View, s: GameState, fx: Fx, o: DrawOpts) {
  const { dpr } = v;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#03040d";
  ctx.fillRect(0, 0, v.w, v.h);
  const shakeAmt = fx.shake > 0 ? fx.shake * 6 : 0;
  const sx = shakeAmt ? (Math.random() - 0.5) * shakeAmt : 0, sy = shakeAmt ? (Math.random() - 0.5) * shakeAmt : 0;
  ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * (v.ox + sx), dpr * (v.oy + sy));
  const px = 1 / v.scale; // one screen pixel in world units
  const t = s.time;

  // Nebula and stars
  const neb = ctx.createRadialGradient(1150, 260, 40, 1150, 260, 700);
  neb.addColorStop(0, "rgba(139,92,246,0.10)"); neb.addColorStop(0.5, "rgba(34,211,238,0.04)"); neb.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = neb; ctx.fillRect(-400, -400, WORLD.w + 800, WORLD.h + 800);
  for (const st of STARS) {
    const tw = o.reduced ? 0.7 : 0.55 + 0.45 * Math.sin(t * 1.3 + st.t);
    ctx.fillStyle = `rgba(220,230,255,${0.35 * tw + 0.1})`;
    ctx.fillRect(st.x, st.y, st.s * px * 1.4, st.s * px * 1.4);
  }

  // Orbits
  ctx.lineWidth = px;
  for (const def of PLANETS) {
    ctx.strokeStyle = s.selected === def.id ? "rgba(125,211,252,0.35)" : "rgba(140,160,255,0.13)";
    ctx.beginPath(); ctx.ellipse(WORLD.sun.x, WORLD.sun.y, def.orbit, def.orbit * WORLD.squash, 0, 0, Math.PI * 2); ctx.stroke();
  }

  // Sun
  const pulse = o.reduced ? 1 : 1 + 0.04 * Math.sin(t * 1.7);
  const sun = WORLD.sun;
  const corona = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.6, sun.x, sun.y, sun.r * 3.4 * pulse);
  corona.addColorStop(0, "rgba(255,200,90,0.55)"); corona.addColorStop(0.35, "rgba(255,140,40,0.16)"); corona.addColorStop(1, "rgba(255,120,30,0)");
  ctx.fillStyle = corona; ctx.beginPath(); ctx.arc(sun.x, sun.y, sun.r * 3.4 * pulse, 0, Math.PI * 2); ctx.fill();
  const core = ctx.createRadialGradient(sun.x - sun.r * 0.3, sun.y - sun.r * 0.3, 2, sun.x, sun.y, sun.r);
  core.addColorStop(0, "#fffbe8"); core.addColorStop(0.5, "#ffd56b"); core.addColorStop(1, "#ff9a2e");
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2); ctx.fill();

  drawGate(ctx, s, fx, o, px);
  for (const def of PLANETS) drawPlanet(ctx, s, fx, def.id, o, px);

  // Autopilot target marker
  const tp = targetPoint(s);
  if (tp && s.target && !("planet" in s.target)) {
    ctx.strokeStyle = "rgba(125,211,252,0.6)"; ctx.lineWidth = 1.5 * px; ctx.setLineDash([4 * px, 4 * px]);
    ctx.beginPath(); ctx.arc(tp.x, tp.y, 10, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }

  // Mining beam
  if (o.mining && fx.beam > 0) {
    const def = PLANETS.find((p) => p.id === o.mining)!;
    const pp = planetPos(def, t);
    const a = Math.atan2(s.ship.y - pp.y, s.ship.x - pp.x);
    const ex = pp.x + Math.cos(a) * def.radius * 0.92, ey = pp.y + Math.sin(a) * def.radius * 0.92;
    const flicker = o.reduced ? 1 : 0.75 + Math.random() * 0.25;
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(244,114,182,${0.28 * flicker})`; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(s.ship.x, s.ship.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = `rgba(255,220,240,${0.9 * flicker})`; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(s.ship.x, s.ship.y); ctx.lineTo(ex, ey); ctx.stroke();
    const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, 16);
    glow.addColorStop(0, "rgba(255,230,200,0.9)"); glow.addColorStop(1, "rgba(255,120,80,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ex, ey, 16, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = "butt";
  }

  // Particles
  for (const p of fx.particles) {
    const k = 1 - p.life / p.max;
    if (p.kind === "smoke") {
      ctx.fillStyle = `${p.color}${(0.28 * k).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - k), 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawShip(ctx, s, o, t);

  // Popups
  ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  for (const p of fx.popups) {
    ctx.globalAlpha = Math.max(0, 1 - p.life / 1.1);
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(p.text, p.x + 1, p.y + 1);
    ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  if (fx.flash > 0) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgba(190,240,255,${0.35 * fx.flash})`;
    ctx.fillRect(0, 0, v.w, v.h);
  }
}

function drawPlanet(ctx: CanvasRenderingContext2D, s: GameState, fx: Fx, id: PlanetId, o: DrawOpts, px: number) {
  const def = PLANETS.find((p) => p.id === id)!;
  const st = s.planets.find((p) => p.id === id)!;
  const pal = PALETTE[id];
  const status = planetStatus(st);
  let { x, y } = planetPos(def, s.time);
  if (st.unstable && !o.reduced) { x += (Math.random() - 0.5) * 1.6; y += (Math.random() - 0.5) * 1.6; }
  const R = def.radius;
  const spin = s.time * (o.reduced ? 0.05 : 0.12) * (id === "glacia" ? -1 : 1);
  const surf = SURF[id];
  const veg = fx.veg[id], fac = fx.fac[id];

  // Selection / range rings
  if (s.selected === id || o.hover === id) {
    ctx.strokeStyle = s.selected === id ? "rgba(125,211,252,0.75)" : "rgba(125,211,252,0.35)";
    ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 5 * px]);
    ctx.beginPath(); ctx.arc(x, y, R + 12, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  if (s.selected === id) {
    ctx.strokeStyle = "rgba(125,211,252,0.12)"; ctx.lineWidth = px;
    ctx.beginPath(); ctx.arc(x, y, R + MINE_RANGE, 0, Math.PI * 2); ctx.stroke();
  }

  // Atmosphere: green when restored, brown haze when industrial, red when unstable
  const atm = status === "restored" ? `rgba(110,240,170,${0.18 + 0.1 * veg})` : status === "industrialized" ? `rgba(170,130,90,${0.14 + 0.08 * fac})` : status === "unstable" ? "rgba(255,80,80,0.28)" : "rgba(140,190,255,0.14)";
  const ag = ctx.createRadialGradient(x, y, R * 0.9, x, y, R * 1.45);
  ag.addColorStop(0, atm); ag.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(x, y, R * 1.45, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
  // Base sphere
  const base = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R);
  const grey = Math.min(1, fac / 3) * 0.55; // industry desaturates the surface
  base.addColorStop(0, mix(pal.light, "#9a9a9a", grey)); base.addColorStop(0.55, mix(pal.mid, "#5d5a57", grey)); base.addColorStop(1, mix(pal.dark, "#1e1d1c", grey));
  ctx.fillStyle = base; ctx.fillRect(x - R, y - R, R * 2, R * 2);

  // Continents / ice / iron patches
  for (const f of surf.patches) blob(ctx, x, y, R, f, spin, pal.patch);
  // Vegetation spreads over land as restoration grows
  const vegCount = Math.round((surf.veg.length * veg) / 3);
  for (let i = 0; i < vegCount; i++) blob(ctx, x, y, R, surf.veg[i], spin, i % 3 ? "rgba(60,190,90,0.85)" : "rgba(30,140,70,0.9)");
  // Craters from cumulative mining (fade as ecosystems regrow)
  const craterCount = Math.min(surf.craters.length, Math.floor(st.mined / 10));
  const craterAlpha = 1 - Math.min(0.7, veg * 0.22);
  for (let i = 0; i < craterCount; i++) {
    const c = project(surf.craters[i], spin, R);
    if (c.z <= 0.05) continue;
    const r = surf.craters[i].size * R;
    ctx.fillStyle = `rgba(20,10,8,${0.55 * craterAlpha})`;
    ctx.beginPath(); ctx.ellipse(x + c.x, y + c.y, r * Math.max(0.25, c.z), r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,220,190,${0.25 * craterAlpha})`; ctx.lineWidth = Math.max(px, r * 0.18);
    ctx.beginPath(); ctx.ellipse(x + c.x + r * 0.12, y + c.y + r * 0.12, r * Math.max(0.25, c.z), r, 0, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
  }
  // Factories: grey blocks with lit windows
  const facCount = Math.round(fac * 4);
  for (let i = 0; i < facCount; i++) {
    const f = surf.factories[i], c = project(f, spin, R);
    if (c.z <= 0.1) continue;
    const w = f.size * R * 1.4 * Math.max(0.3, c.z), h = f.size * R;
    ctx.fillStyle = "#3b3f46"; ctx.fillRect(x + c.x - w / 2, y + c.y - h / 2, w, h);
    ctx.fillStyle = "#525861"; ctx.fillRect(x + c.x + w * 0.15, y + c.y - h * 1.1, w * 0.18, h * 0.7);
    ctx.fillStyle = "rgba(255,190,90,0.9)"; ctx.fillRect(x + c.x - w * 0.3, y + c.y - h * 0.1, w * 0.18, h * 0.25);
  }
  // Pollution haze
  if (fac > 0) { ctx.fillStyle = `rgba(120,100,80,${0.12 * fac})`; ctx.fillRect(x - R, y - R, R * 2, R * 2); }
  // Glowing fault lines when stability is low
  const crackK = st.unstable ? 1 : st.stability < 50 ? (50 - st.stability) / 50 : 0;
  if (crackK > 0) {
    const glow = o.reduced ? 0.8 : 0.6 + 0.4 * Math.sin(s.time * 6);
    ctx.strokeStyle = st.unstable ? `rgba(255,90,60,${0.9 * glow})` : `rgba(255,150,90,${0.55 * crackK})`;
    ctx.lineWidth = st.unstable ? 2.4 : 1.4;
    const n = st.unstable ? surf.cracks.length : Math.ceil(surf.cracks.length * crackK);
    for (let i = 0; i < n; i++) {
      const pts = surf.cracks[i].pts.map((pt) => project(pt, spin, R));
      if (pts.some((p) => p.z <= 0)) continue;
      ctx.beginPath(); ctx.moveTo(x + pts[0].x, y + pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(x + p.x, y + p.y);
      ctx.stroke();
    }
  }
  // Night side: shade away from the sun
  const a = Math.atan2(WORLD.sun.y - y, WORLD.sun.x - x);
  const shade = ctx.createLinearGradient(x + Math.cos(a) * R, y + Math.sin(a) * R, x - Math.cos(a) * R, y - Math.sin(a) * R);
  shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(0.55, "rgba(0,0,8,0.25)"); shade.addColorStop(1, "rgba(0,0,10,0.82)");
  ctx.fillStyle = shade; ctx.fillRect(x - R, y - R, R * 2, R * 2);
  // City lights on the night side of industrial worlds
  for (let i = 0; i < facCount; i++) {
    const c = project(surf.factories[i], spin, R);
    if (c.z <= 0.1) continue;
    const dot = (c.x * -Math.cos(a) + c.y * -Math.sin(a)) / R;
    if (dot > 0.2) { ctx.fillStyle = `rgba(255,200,110,${Math.min(0.9, dot)})`; ctx.fillRect(x + c.x - 1, y + c.y - 1, 2.4, 2.4); }
  }
  ctx.restore();

  // Rim light
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = px;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();

  // Label
  ctx.textAlign = "center";
  ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(230,236,255,0.92)";
  ctx.fillText(def.name.toUpperCase(), x, y + R + 24);
  ctx.font = "13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = STATUS_COLOR[status];
  ctx.fillText(`${status} · ${Math.round(st.stability)}%`, x, y + R + 41);
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, f: Feat, spin: number, color: string) {
  const c = project(f, spin, R);
  if (c.z <= 0) return;
  const r = f.size * R;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x + c.x, y + c.y, r * Math.max(0.2, c.z), r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
}

function drawGate(ctx: CanvasRenderingContext2D, s: GameState, fx: Fx, o: DrawOpts, px: number) {
  const g = WORLD.gate, prog = gateProgress(s), segs = 12, lit = s.gateBuilt ? segs : Math.floor(prog * segs);
  const rot = o.reduced ? 0 : s.time * (s.gateBuilt ? 0.8 : 0.1);
  if (o.hover === "gate" || (s.target && "gate" in s.target)) {
    ctx.strokeStyle = "rgba(125,211,252,0.12)"; ctx.lineWidth = px;
    ctx.beginPath(); ctx.arc(g.x, g.y, GATE_RANGE, 0, Math.PI * 2); ctx.stroke();
  }
  if (s.gateBuilt) {
    const swirl = ctx.createRadialGradient(g.x, g.y, 2, g.x, g.y, g.r);
    swirl.addColorStop(0, "rgba(220,250,255,0.95)"); swirl.addColorStop(0.5, "rgba(34,211,238,0.45)"); swirl.addColorStop(1, "rgba(139,92,246,0.1)");
    ctx.fillStyle = swirl; ctx.beginPath(); ctx.arc(g.x, g.y, g.r - 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 7;
  for (let i = 0; i < segs; i++) {
    const a0 = rot + (i / segs) * Math.PI * 2 + 0.05, a1 = rot + ((i + 1) / segs) * Math.PI * 2 - 0.05;
    ctx.strokeStyle = i < lit ? (s.gateBuilt ? "#7dd3fc" : "#a78bfa") : "rgba(140,160,255,0.16)";
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, a0, a1); ctx.stroke();
  }
  ctx.textAlign = "center"; ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(230,236,255,0.85)";
  ctx.fillText(s.gateBuilt ? "JUMP GATE · ONLINE" : `JUMP GATE · ${Math.floor(prog * 100)}%`, g.x, g.y + g.r + 24);
}

function drawShip(ctx: CanvasRenderingContext2D, s: GameState, o: DrawOpts, t: number) {
  const { x, y, angle } = s.ship;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  if (o.thrust) {
    const len = 14 + (o.reduced ? 0 : Math.random() * 8);
    const fl = ctx.createLinearGradient(-8, 0, -8 - len, 0);
    fl.addColorStop(0, "rgba(125,211,252,0.95)"); fl.addColorStop(1, "rgba(139,92,246,0)");
    ctx.fillStyle = fl;
    ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(-8 - len, 0); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill();
  }
  const hull = ctx.createLinearGradient(-10, -10, 14, 10);
  hull.addColorStop(0, "#c7d2fe"); hull.addColorStop(1, "#6366f1");
  ctx.fillStyle = hull; ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-9, -10); ctx.lineTo(-5, 0); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = `rgba(34,211,238,${o.reduced ? 0.9 : 0.7 + 0.3 * Math.sin(t * 5)})`;
  ctx.beginPath(); ctx.ellipse(4, 0, 4, 2.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function mix(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

