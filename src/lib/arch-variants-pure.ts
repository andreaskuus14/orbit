// ARCH variants (ARC06): named copies of a saved revision, compared side by side with shared inputs (same prices, site, energy inputs).
// Pure: no React, no storage. "Which change caused which difference": each part-level change is applied alone to A and measured.
import { boq, costLines, type Part, type PriceItem, type Scene } from "./arch-pure.ts";
import { energyStudy, type EnergyInputs } from "./arch-energy-pure.ts";

export type Variant = { id: string; name: string; rev: number; at: string; scene: Scene };
export const MAX_VARIANTS = 12;

/** Saved variants from storage → only well-formed ones, newest kept when over the cap. */
export function readVariants(raw: unknown): Variant[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is Variant => !!v && typeof v.id === "string" && typeof v.name === "string" && Number.isInteger(v.rev) && Array.isArray(v.scene?.parts))
    .slice(-MAX_VARIANTS);
}
export function addVariant(list: Variant[], name: string, rev: number, scene: Scene, id: string, at = new Date().toISOString()): Variant[] {
  const n = name.trim().slice(0, 60) || `Variant r${rev}`;
  return [...list, { id, name: n, rev, at, scene: structuredClone(scene) }].slice(-MAX_VARIANTS);
}

export type Metrics = { area: number; cost: number; unknown: number; kWh: number | null; sunDec: number | null };
export type Shared = { prices: PriceItem[]; site: { lat: number; lon: number }; north: number; energy: EnergyInputs | null };
const r1 = (n: number) => Math.round(n * 10) / 10;

/** area = slab area (m², every floor); cost = known-price total + count of lines with an unknown price; energy optional (slow). */
export function metrics(parts: Part[], s: Shared): Metrics {
  const q = boq(parts), c = costLines(q, s.prices, parts);
  const rows = s.energy ? energyStudy(parts, s.site, s.north, s.energy) : null;
  return { area: q.slabM2, cost: c.total, unknown: c.unknown.length, kWh: rows && rows.reduce((t, r) => t + r.kWh, 0), sunDec: rows && r1(rows.reduce((t, r) => t + r.sunDec, 0)) };
}

export type Change = { id: string; name: string; type: "added" | "removed" | "changed"; fields: string[] };
const FIELDS = ["kind", "x", "y", "z", "w", "d", "h", "host", "face", "off", "sill", "name"] as const;
export function diffParts(a: Part[], b: Part[]): Change[] {
  const out: Change[] = [];
  for (const p of a) {
    const q = b.find((x) => x.id === p.id);
    if (!q) out.push({ id: p.id, name: p.name, type: "removed", fields: [] });
    else { const f = FIELDS.filter((k) => p[k] !== q[k]); if (f.length) out.push({ id: p.id, name: q.name, type: "changed", fields: f }); }
  }
  for (const q of b) if (!a.some((p) => p.id === q.id)) out.push({ id: q.id, name: q.name, type: "added", fields: [] });
  return out;
}
/** A's parts with only change `c` taken from B. */
export function applyOne(a: Part[], b: Part[], c: Change): Part[] {
  if (c.type === "removed") return a.filter((p) => p.id !== c.id);
  const q = b.find((x) => x.id === c.id)!;
  return c.type === "added" ? [...a, q] : a.map((p) => (p.id === c.id ? q : p));
}

export type Delta = { area: number; cost: number; unknown: number; kWh: number | null };
const delta = (x: Metrics, y: Metrics): Delta => ({ area: r1(y.area - x.area), cost: y.cost - x.cost, unknown: y.unknown - x.unknown, kWh: x.kWh === null || y.kWh === null ? null : y.kWh - x.kWh });
export type Comparison = { a: Metrics; b: Metrics; total: Delta; changes: (Change & { delta: Delta })[]; rest: Delta };

/** Side-by-side. Per change: its effect alone on A. rest = total − sum of single effects (changes interacting, e.g. a window and its wall). */
export function compare(a: Scene, b: Scene, s: Shared): Comparison {
  const ma = metrics(a.parts, s), mb = metrics(b.parts, s), total = delta(ma, mb);
  const changes = diffParts(a.parts, b.parts).map((c) => ({ ...c, delta: delta(ma, metrics(applyOne(a.parts, b.parts, c), s)) }));
  const sum = (k: keyof Delta) => changes.reduce((t, c) => t + (c.delta[k] ?? 0), 0);
  const rest: Delta = { area: r1(total.area - sum("area")), cost: total.cost - sum("cost"), unknown: total.unknown - sum("unknown"), kWh: total.kWh === null ? null : total.kWh - sum("kWh") };
  return { a: ma, b: mb, total, changes, rest };
}
