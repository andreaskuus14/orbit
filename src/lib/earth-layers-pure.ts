// INTELLIGENCE, one map: which layer shows at which camera height (km). Orbit = world news hotspots (+ news weather when on),
// country zoom = glowing borders and town pins with local news, close = the real 3D cities. Used by earth-scene.ts; tests/unimap.test.ts.
import { band } from "./earth-pure.ts";

export const LAYER = {
  hotspots: { lo: 2500, hi: 1e9 }, // country halos, rings, story arcs, news weather
  borders: { lo: 90, hi: 1e9 },
  towns: { lo: 50, hi: 2500 },
} as const;

/** 0…1 for each layer at a camera height. Weather has no entry: it follows `hotspots`, but only when the owner switched it on. */
export function layersAt(alt: number) {
  return {
    hotspots: band(alt, LAYER.hotspots.lo, LAYER.hotspots.hi, 0.8),
    borders: borderK(alt),
    towns: band(alt, LAYER.towns.lo, LAYER.towns.hi, 0.8),
  };
}

/** Border glow: faint from orbit (so the world stays calm), full at country zoom, gone in the city close-up. */
export function borderK(alt: number): number {
  const f = band(alt, LAYER.borders.lo, LAYER.borders.hi, 0.9);
  const t = Math.min(1, Math.max(0, (Math.log2(Math.max(alt, 1)) - Math.log2(3500)) / (Math.log2(9000) - Math.log2(3500)))); // 0 below 3,500 km … 1 above 9,000 km
  return f * (1 - 0.85 * t * t * (3 - 2 * t));
}

/** Weather glides toward on/off instead of snapping: one step of `dt` seconds. */
export const glide = (cur: number, on: boolean, dt: number) => (on ? Math.min(1, cur + dt * 2.2) : Math.max(0, cur - dt * 2.2));

/** Country marker radius (degrees of arc) from independent outlets: small and precise, grows with the square root, capped. */
export const markerDeg = (outlets: number) => 0.9 + 0.5 * Math.sqrt(Math.max(0, Math.min(outlets, 30)));

/** News-weather levels as on the legend: how hot a system is against the busiest one. Colours are shared by the swirls and the legend. */
export const LEVELS = [
  { key: "crisis", min: 0.7, color: "#b44bff", tex: "purple" }, { key: "rising", min: 0.4, color: "#ff5a3c", tex: "red" }, { key: "ongoing", min: 0.18, color: "#3aa7ff", tex: "blue" }, { key: "stable", min: 0, color: "#3fd6a0", tex: "blue" },
] as const;
export function stormLevel(outlets: number, max: number): (typeof LEVELS)[number] {
  const r = max > 0 ? outlets / max : 0;
  return LEVELS.find((l) => r >= l.min) ?? LEVELS[LEVELS.length - 1];
}
