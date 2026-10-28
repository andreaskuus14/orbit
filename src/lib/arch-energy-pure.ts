// ARCH sun hours + rough heating need per room (pure, tested in tests/arch-energy.test.ts). A study figure, not an energy
// certificate: rooms and windows come from the daylight study's flood fill; direct sun is ray-tested every 10 minutes on the
// winter solstice and the spring equinox; heat loss is H = Σ U·A + ventilation, times Estonian heating degree-days.
import { daylightPlan, windowSees, type Plan, type Room, type Site } from "./arch-daylight-pure.ts";
import { toModel } from "./arch-site-pure.ts";
import { sunDirection } from "./sun-pure.ts";
import type { Part } from "./arch-pure.ts";

/** Teaching values. U in W/m²K: roughly a new Estonian low-energy house. Degree-days: Tallinn normal year, base 17 °C (≈ 4 200 °C·d;
 *  21 °C inside, internal gains cover the last 4 K). Design outdoor −22 °C (Tallinn). Ventilation 0.5 air changes/h, no heat recovery. */
export const ENERGY = { u: { wall: 0.17, window: 0.8, roof: 0.12, floor: 0.15 }, ach: 0.5, inside: 21, design: -22, degreeDays: 4200, stepMin: 10, probe: 0.7 };
export const SOLSTICE = { m: 11, d: 21 }, EQUINOX = { m: 2, d: 20 };

/** Hours of direct sun through any of each room's windows on one day (local solar day, sampled every ENERGY.stepMin). */
export function sunHours(plan: Plan, site: Site, month: number, day: number, north = 0, year = 2025): Record<string, number> {
  const n: Record<string, number> = Object.fromEntries(plan.rooms.map((r) => [r.id, 0])), steps = (24 * 60) / ENERGY.stepMin;
  const start = Date.UTC(year, month, day) - (site.lon / 15) * 3_600_000; // local solar midnight
  for (let k = 0; k < steps; k++) {
    const sun = toModel(sunDirection(site.lat, site.lon, new Date(start + (k + 0.5) * ENERGY.stepMin * 60_000)), north);
    if (sun.y > 0) for (const r of plan.rooms) if (plan.windows.some((w) => w.room === r.id && windowSees(w, sun, plan.boxes))) n[r.id]++;
  }
  return Object.fromEntries(Object.entries(n).map(([id, c]) => [id, Math.round((c * ENERGY.stepMin) / 6) / 10]));
}

const inside = (rooms: Room[], x: number, z: number) => rooms.find((r) => r.rects.some((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1));
/** Length of a room's edge that faces outdoors: probe ENERGY.probe m beyond each 0.1 m of edge; landing in no room of the floor = outside.
 *  shortcut: anything not a room counts as outside (an unheated porch too); fine for a study figure. */
export function exteriorLength(room: Room, floorRooms: Room[]): number {
  const P = ENERGY.probe, s = 0.1;
  let len = 0;
  for (const q of room.rects) {
    const edges: [number, number, number, number, number, number][] = [ // x0, z0, dx, dz (unit along), outward nx, nz
      [q.x0, q.z0, 1, 0, 0, -1], [q.x0, q.z1, 1, 0, 0, 1], [q.x0, q.z0, 0, 1, -1, 0], [q.x1, q.z0, 0, 1, 1, 0]];
    for (const [ex, ez, dx, dz, nx, nz] of edges) {
      const L = dx ? q.x1 - q.x0 : q.z1 - q.z0, n = Math.max(1, Math.round(L / s)), step = L / n;
      for (let i = 0; i < n; i++) { const t = (i + 0.5) * step; if (!inside(floorRooms, ex + dx * t + nx * P, ez + dz * t + nz * P)) len += step; }
    }
  }
  return Math.round(len * 10) / 10;
}

export type EnergyRow = { id: string; name: string; area: number; sunDec: number; sunMar: number; hWK: number; peakW: number; kWh: number; kWhM2: number };

/** Per room: sun hours (Dec 21, Mar 20) and heat loss. Exterior wall = outdoor edge × room height − glazing; roof on the top floor,
 *  ground floor on floor 1 (ground treated like outside air: on the safe side). */
export function energyStudy(parts: Part[], site: Site, north = 0): EnergyRow[] {
  const plan = daylightPlan(parts), top = Math.max(0, ...plan.rooms.map((r) => r.floor)), U = ENERGY.u;
  const dec = sunHours(plan, site, SOLSTICE.m, SOLSTICE.d, north), mar = sunHours(plan, site, EQUINOX.m, EQUINOX.d, north);
  return plan.rooms.map((r) => {
    const wall = Math.max(0, exteriorLength(r, plan.rooms.filter((o) => o.floor === r.floor)) * r.h - r.glazing);
    const H = U.wall * wall + U.window * r.glazing + (r.floor === top ? U.roof * r.area : 0) + (r.floor === 1 ? U.floor * r.area : 0) + 0.33 * ENERGY.ach * r.area * r.h;
    const kWh = Math.round((H * ENERGY.degreeDays * 24) / 1000);
    return { id: r.id, name: r.name, area: r.area, sunDec: dec[r.id], sunMar: mar[r.id], hWK: Math.round(H * 10) / 10,
      peakW: Math.round(H * (ENERGY.inside - ENERGY.design)), kWh, kWhM2: r.area > 0 ? Math.round(kWh / r.area) : 0 };
  });
}
