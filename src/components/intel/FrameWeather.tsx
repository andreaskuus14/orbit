"use client";
// The live news weather drawn over the world plate: cyclone swirls where the plate has no painted storm (the owner's storm photos, turning), typed fronts with chevrons that
// run from origin to destination, isobars and H/L centres. Positions come from earthWeather(hotspots) through the plate's own mapping.
// The plate's baked weather (tint fields, three painted cyclones) stays: it is the picture; this layer is the data.
import { useEffect, useMemo, useRef } from "react";
import type { Hotspot } from "@/lib/geo";
import { earthWeather } from "@/lib/earth-data-pure";
import { nearPainted, onPlate, PLATE, platePoint } from "@/lib/frame-map-pure";

const FRONT = { cold: "#4f9bff", warm: "#ff5a4f", occluded: "#b57aff" } as const;
const P = (lon: number, lat: number) => platePoint(lon, lat, "world");

export default function FrameWeather({ hotspots, reduced, ui = 1 }: { hotspots: Hotspot[]; reduced: boolean; /** plate px per screen px: the H/L badges keep their screen size when the plate is scaled up */ ui?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = useMemo(() => earthWeather(hotspots), [hotspots]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = PLATE.w * dpr; cv.height = PLATE.h * dpr;
    const imgs: Record<string, HTMLImageElement> = {};
    for (const k of ["purple", "red", "blue"]) { const i = new Image(); i.src = `/ui/storms/${k}.png`; imgs[k] = i; }
    let raf = 0, dead = false;
    const draw = (now: number) => {
      if (dead) return;
      const t = now / 1000; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, PLATE.w, PLATE.h);
      // isobars
      ctx.strokeStyle = "rgba(219,231,245,.2)"; ctx.lineWidth = 1;
      for (const lv of w.isobars) for (const line of lv.lines) {
        ctx.beginPath(); let prev: { x: number; y: number } | null = null;
        for (const [lo, la] of line) { const p = P(lo, la), ok = onPlate(p, "world"); if (ok && prev) ctx.lineTo(p.x, p.y); else if (ok) ctx.moveTo(p.x, p.y); prev = ok ? p : null; }
        ctx.stroke();
      }
      // fronts: line, teeth on the left of the way, chevrons running from origin to destination
      for (const f of w.fronts) {
        const a = P(f.from.lon, f.from.lat), b = P(f.to.lon, f.to.lat); if (!onPlate(a, "world") || !onPlate(b, "world")) continue;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); if (len < 30) continue;
        const nx = -dy / len, ny = dx / len, bow = len * 0.12, cx = (a.x + b.x) / 2 + nx * bow, cy = (a.y + b.y) / 2 + ny * bow;
        const at = (u: number) => { const m = 1 - u; return { x: m * m * a.x + 2 * m * u * cx + u * u * b.x, y: m * m * a.y + 2 * m * u * cy + u * u * b.y }; };
        const col = FRONT[f.type]; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 2.1; ctx.shadowColor = col; ctx.shadowBlur = 5;
        ctx.beginPath(); for (let i = 0; i <= 40; i++) { const p = at(i / 40); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); } ctx.stroke();
        const n = Math.max(3, Math.floor(len / 26));
        for (let i = 1; i < n; i++) {
          const u = i / n, p = at(u), q = at(Math.min(1, u + 0.01)), tx = q.x - p.x, ty = q.y - p.y, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl, lx = -uy, ly = ux;
          const tri = f.type === "cold" || (f.type === "occluded" && i % 2 === 0);
          ctx.beginPath();
          if (tri) { ctx.moveTo(p.x - ux * 6, p.y - uy * 6); ctx.lineTo(p.x + ux * 6, p.y + uy * 6); ctx.lineTo(p.x + lx * 11, p.y + ly * 11); ctx.closePath(); }
          else ctx.arc(p.x, p.y, 6, Math.atan2(ly, lx) - Math.PI / 2, Math.atan2(ly, lx) + Math.PI / 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255,.65)"; ctx.lineWidth = 1.5;
        const run = reduced ? 0 : (t * 0.12) % (1 / 6);
        for (let u = run; u < 1; u += 1 / 6) { const p = at(u), q = at(Math.min(1, u + 0.012)), tx = q.x - p.x, ty = q.y - p.y, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
          ctx.beginPath(); ctx.moveTo(p.x - ux * 5 - uy * 5, p.y - uy * 5 + ux * 5); ctx.lineTo(p.x + ux * 3, p.y + uy * 3); ctx.lineTo(p.x - ux * 5 + uy * 5, p.y - uy * 5 - ux * 5); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      // cyclones: the storm photo turning, sized by outlets
      for (const s of w.swirls.filter((x) => x.storm).slice(0, 3)) { // only real storms (crisis, rising), at most three: the rest would be noise on the plate
        const p = P(s.lon, s.lat); if (!onPlate(p, "world") || nearPainted(p)) continue; // the plate paints three cyclones; live ones go where it has none
        const im = imgs[s.tex]; if (!im.complete || !im.naturalWidth) continue;
        const r = 34 + 52 * Math.sqrt(s.rel);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(reduced ? 0 : -t * 0.18); ctx.globalAlpha = s.storm ? 0.67 : 0.49; ctx.drawImage(im, -r, -r, r * 2, r * 2); ctx.restore();
      }
      // H / L centres
      for (const c of w.centres) {
        const p = P(c.lon, c.lat); if (!onPlate(p, "world")) continue;
        const col = c.kind === "L" ? "#ff6a5a" : "#5ab4ff";
        ctx.beginPath(); ctx.arc(p.x, p.y, 15 * ui, 0, 7); ctx.fillStyle = "rgba(6,12,24,.75)"; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = `700 ${15 * ui}px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(c.kind, p.x, p.y + 1);
        ctx.font = `600 ${10 * ui}px Inter, system-ui, sans-serif`; ctx.fillStyle = col; ctx.fillText(String(c.hpa), p.x, p.y + 25 * ui);
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const redraw = reduced ? setInterval(() => requestAnimationFrame(draw), 1000) : 0; // reduced motion: still, refreshed once a second until the textures load
    return () => { dead = true; cancelAnimationFrame(raf); if (redraw) clearInterval(redraw); };
  }, [w, reduced, ui]);
  return <canvas ref={ref} className="frame-wx" width={PLATE.w} height={PLATE.h} aria-hidden />;
}
