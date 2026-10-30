// ARCH exact editing (ARC03): typed dimensions with units, grid and edge snapping, and the opening-in-host-wall check. Pure.
import { OPENING, isOpening, type Part } from "./arch-pure.ts";

/** "2.4", "-1,5", "240 cm", "2400mm", "2.4 m" → metres (sign kept); null if unreadable. */
export function parseDim(s: string): number | null {
  const m = /^\s*(-?)\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*(mm|cm|m)?\s*$/i.exec(s);
  if (!m) return null;
  const v = Number(m[2].replace(",", ".")) / { mm: 1000, cm: 100, m: 1 }[(m[3] ?? "m").toLowerCase() as "mm" | "cm" | "m"];
  return Number.isFinite(v) ? (m[1] ? -v : v) : null;
}
/** Metres shown with the unit, to the millimetre: 2.4 → "2.400 m". */
export const showDim = (m: number) => `${(Math.round(m * 1000) / 1000).toFixed(3)} m`;

export const snapGrid = (v: number, step: number) => (step > 0 ? Math.round(Math.round(v / step) * step * 1000) / 1000 : v);

/** A centre coordinate (x or z) for `p`: if one of its edges lands within `tol` of another part's edge or centre line, line it up;
 *  otherwise snap to the grid. Returns the value and what it snapped to. */
export function snapCentre(p: Part, axis: "x" | "z", v: number, others: Part[], step: number, tol = 0.15): { v: number; to: string | null } {
  const half = (axis === "x" ? p.w : p.d) / 2;
  let best: { v: number; dist: number; to: string } | null = null;
  for (const o of others) {
    if (o.id === p.id || isOpening(o.kind)) continue;
    const oh = (axis === "x" ? o.w : o.d) / 2, oc = o[axis];
    for (const target of [oc - oh, oc + oh, oc]) for (const mine of [-half, half, 0]) {
      const cand = target - mine, dist = Math.abs(cand - v);
      if (dist <= tol && (!best || dist < best.dist)) best = { v: Math.round(cand * 1000) / 1000, dist, to: o.name };
    }
  }
  return best ? { v: best.v, to: best.to } : { v: snapGrid(v, step), to: null };
}

/** null when the opening sits inside its host wall face (corner margin, lintel), else what is wrong. */
export function openingIssue(o: Part, wall: Part | undefined): string | null {
  if (!wall || wall.kind !== "wall") return "no host wall";
  if (!o.face) return "no wall face";
  const len = o.face === "n" || o.face === "s" ? wall.w : wall.d, usable = len - 2 * OPENING.margin, off = o.off ?? 0, sill = o.kind === "door" ? 0 : o.sill ?? OPENING.windowSill;
  if (o.w > usable + 1e-6 || Math.abs(off) + o.w / 2 > usable / 2 + 1e-6) return `wider than the wall allows (${Math.round(usable * 100) / 100} m clear)`;
  if (sill + o.h > wall.h - OPENING.lintel + 1e-6) return `taller than the wall allows (${Math.round((wall.h - OPENING.lintel) * 100) / 100} m under the lintel)`;
  return null;
}
