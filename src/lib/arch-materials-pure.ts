// ARCH materials lab (pure, tested in tests/arch-materials.test.ts): a small library with Estonian prices, thermal data and
// embodied carbon; the owner builds wall/slab/roof layer stacks (two schemes) and this computes cost, kgCO2e and U-values from
// the model's areas (boq in arch-pure). Teaching estimates, not an energy certificate or an LCA.
import type { Boq } from "./arch-pure";

export type Unit = "m3" | "m2";
/** eur and co2 are per unit. m3 items are layers with a thickness (λ in W/mK); m2 items are fixed products (cladding, sheet,
 *  glazing) with no thermal value except glazing's whole-unit u. url + per: a public product page, and how many units its
 *  listed price buys (e.g. a 0.036 m³ block → per 0.036), for "Refresh prices". */
export type Material = {
  id: string; label: string; group: string; unit: Unit; eur: number; priceSource: string; priceDate: string;
  lambda?: number; u?: number; co2: number; carbonSource: string; url?: string; per?: number;
};

const SEED_DATE = "2026-10-26";
const SEED = "seed estimate, typical Estonian builders' merchant price, VAT excl.; not read from a live page";
// ICE v3.0 (Circular Ecology, 2019), cradle-to-gate A1-A3, biogenic carbon not counted: kgCO2e/kg × density.
const ice = (perKg: number, kg: number, what: string) => ({ co2: Math.round(perKg * kg * 100) / 100, carbonSource: `ICE v3.0 ${what}: ${perKg} kgCO2e/kg × ${kg} kg` });
const seed = (eur: number) => ({ eur, priceSource: SEED, priceDate: SEED_DATE });

const wood = ice(0.263, 510, "timber, sawn softwood"), wool = ice(1.28, 30, "mineral wool");
const STUDS = 0.15; // share of a timber-frame layer that is studs; the rest is mineral wool (parallel-path average)

export const MATERIALS: Material[] = [
  { id: "timber", label: "Sawn softwood C24", group: "Timber", unit: "m3", ...seed(420), lambda: 0.13, ...wood },
  { id: "frame", label: `Timber frame + mineral wool (${STUDS * 100}% studs)`, group: "Timber", unit: "m3", ...seed(Math.round(STUDS * 420 + (1 - STUDS) * 50)),
    lambda: Math.round((STUDS * 0.13 + (1 - STUDS) * 0.035) * 1e5) / 1e5, co2: Math.round((STUDS * wood.co2 + (1 - STUDS) * wool.co2) * 100) / 100,
    carbonSource: `${STUDS * 100}% softwood (${wood.co2}/m³) + ${100 - STUDS * 100}% mineral wool (${wool.co2}/m³), ICE v3.0` },
  { id: "clt", label: "CLT panel", group: "Timber", unit: "m3", ...seed(850), lambda: 0.12, ...ice(0.437, 492, "CLT") },
  { id: "brick", label: "Clay brick masonry (solid)", group: "Masonry", unit: "m3", ...seed(380), lambda: 0.77, ...ice(0.213, 1800, "clay brick, general") },
  { id: "aac", label: "Aerated concrete block (400 kg/m³)", group: "Masonry", unit: "m3", ...seed(125), lambda: 0.1, ...ice(0.28, 400, "autoclaved aerated concrete"), per: 0.036 },
  { id: "concrete", label: "Concrete C25/30, reinforced", group: "Concrete", unit: "m3", ...seed(110), lambda: 2.3, ...ice(0.107, 2400, "concrete C25/30") },
  { id: "mwool", label: "Mineral wool slab", group: "Insulation", unit: "m3", ...seed(50), lambda: 0.035, ...wool },
  { id: "eps", label: "EPS 100", group: "Insulation", unit: "m3", ...seed(65), lambda: 0.036, ...ice(3.29, 20, "EPS") },
  { id: "clad", label: "Timber cladding 22 mm (ventilated)", group: "Cladding", unit: "m2", ...seed(14), ...ice(0.263, 11.22, "timber, sawn softwood, 22 mm") },
  { id: "steel", label: "Steel roof sheet + battens", group: "Cladding", unit: "m2", ...seed(28), ...ice(2.76, 5, "steel sheet, galvanised, ~5 kg/m²") },
  { id: "glass3", label: "Triple-glazed window", group: "Glass", unit: "m2", ...seed(245), u: 0.8, ...ice(1.44, 30, "glass, general (panes only, frame not counted)") },
  { id: "glass2", label: "Double-glazed window", group: "Glass", unit: "m2", ...seed(180), u: 1.1, ...ice(1.44, 20, "glass, general (panes only, frame not counted)") },
];

export type Layer = { mat: string; t: number }; // t in metres; ignored for m2 items
export type Scheme = { name: string; wall: Layer[]; slab: Layer[]; roof: Layer[]; window: string };
export const SLOTS = ["wall", "slab", "roof"] as const;
export type Slot = (typeof SLOTS)[number] | "window";

export const SEED_SCHEMES: Scheme[] = [
  { name: "A · Aerated concrete", wall: [{ mat: "aac", t: 0.3 }, { mat: "mwool", t: 0.15 }, { mat: "clad", t: 0 }],
    slab: [{ mat: "concrete", t: 0.1 }, { mat: "eps", t: 0.25 }], roof: [{ mat: "steel", t: 0 }, { mat: "frame", t: 0.2 }, { mat: "mwool", t: 0.2 }], window: "glass3" },
  { name: "B · Timber (CLT)", wall: [{ mat: "clt", t: 0.1 }, { mat: "frame", t: 0.2 }, { mat: "clad", t: 0 }],
    slab: [{ mat: "concrete", t: 0.1 }, { mat: "eps", t: 0.25 }], roof: [{ mat: "steel", t: 0 }, { mat: "clt", t: 0.12 }, { mat: "mwool", t: 0.3 }], window: "glass3" },
];

/** Surface resistances (EN ISO 6946): wall horizontal heat flow, roof upward, slab downward. The ground under the slab is ignored. */
export const RS: Record<(typeof SLOTS)[number], { si: number; se: number }> = { wall: { si: 0.13, se: 0.04 }, roof: { si: 0.1, se: 0.04 }, slab: { si: 0.17, se: 0.04 } };
/** Teaching targets, W/m²K: element values typical of nZEB detached houses in Estonia. The legal nZEB test is the whole-building
 *  energy figure (ETA, Regulation 58 of 2018), not a per-element U, so these are guidance only. */
export const NZEB_U: Record<Slot, number> = { wall: 0.17, roof: 0.12, slab: 0.15, window: 0.8 };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const byId = (mats: Material[]) => new Map(mats.map((m) => [m.id, m]));

/** U = 1 / (Rsi + Σ t/λ + Rse). null when no layer insulates (nothing to compute). */
export function uValue(layers: Layer[], slot: (typeof SLOTS)[number], mats: Material[]): number | null {
  const m = byId(mats);
  let r = 0;
  for (const l of layers) { const x = m.get(l.mat); if (x?.unit === "m3" && x.lambda && l.t > 0) r += l.t / x.lambda; }
  return r > 0 ? r3(1 / (RS[slot].si + r + RS[slot].se)) : null;
}

/** Cost and carbon per m² of a layer stack: m3 items × thickness, m2 items once. */
export function perM2(layers: Layer[], mats: Material[]): { eur: number; co2: number } {
  const m = byId(mats);
  let eur = 0, co2 = 0;
  for (const l of layers) { const x = m.get(l.mat); if (!x) continue; const k = x.unit === "m3" ? Math.max(0, l.t) : 1; eur += k * x.eur; co2 += k * x.co2; }
  return { eur: Math.round(eur * 100) / 100, co2: Math.round(co2 * 100) / 100 };
}

export type SlotRow = { slot: Slot; area: number; eurM2: number; co2M2: number; u: number | null; target: number; cost: number; co2: number };
/** One scheme on the model: areas from boq (net walls, all slabs, pitched roof, glazing). Rounded to whole € and kg. */
export function schemeTotals(s: Scheme, q: Boq, mats: Material[]) {
  const area: Record<Slot, number> = { wall: q.wallM2, slab: q.slabM2, roof: q.roofM2, window: q.windowM2 };
  const rows: SlotRow[] = [...SLOTS, "window" as const].map((slot) => {
    const layers = slot === "window" ? [{ mat: s.window, t: 0 }] : s[slot];
    const p = perM2(layers, mats), win = slot === "window" ? mats.find((m) => m.id === s.window)?.u ?? null : null;
    return { slot, area: area[slot], eurM2: p.eur, co2M2: p.co2, u: slot === "window" ? win : uValue(layers, slot, mats), target: NZEB_U[slot],
      cost: Math.round(area[slot] * p.eur), co2: Math.round(area[slot] * p.co2) };
  });
  return { rows, cost: rows.reduce((a, r) => a + r.cost, 0), co2: rows.reduce((a, r) => a + r.co2, 0) };
}

/* ---- Refresh prices: the route fetches pages read-only; this reads a price out and proposes changes he accepts ---- */

/** First price on a product page: schema.org JSON-LD / microdata / og meta first, then visible "12,34 €" or "€ 12.34". */
export function parsePrice(html: string): number | null {
  const num = (s: string) => { const v = Number(s.replace(/\s/g, "").replace(/,(\d{1,2})$/, ".$1").replace(/,/g, "")); return Number.isFinite(v) && v > 0 && v < 1e6 ? v : null; };
  const pats = [
    /"price"\s*:\s*"?(\d[\d\s]*(?:[.,]\d{1,2})?)"?/i,
    /itemprop=["']price["'][^>]*content=["'](\d[\d\s]*(?:[.,]\d{1,2})?)["']/i,
    /property=["'](?:product|og):price:amount["'][^>]*content=["'](\d[\d\s]*(?:[.,]\d{1,2})?)["']/i,
    /(\d{1,3}(?:[  ]?\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|&euro;|EUR\b)/i,
    /(?:€|&euro;)\s*(\d{1,3}(?:[  ]?\d{3})*(?:[.,]\d{1,2})?)/i,
  ];
  for (const p of pats) { const m = html.match(p); const v = m && num(m[1].replace(/ /g, " ")); if (v) return v; }
  return null;
}

export type PriceChange = { id: string; label: string; unit: Unit; old: number; next: number; url: string };
/** Listed price ÷ per = price per unit. Only real changes (≥ 1 cent) come back; nothing is applied until he accepts. */
export function priceChanges(mats: Material[], found: { id: string; price: number }[]): PriceChange[] {
  const m = byId(mats);
  return found.flatMap(({ id, price }) => {
    const x = m.get(id);
    if (!x?.url || !(price > 0)) return [];
    const next = Math.round((price / (x.per && x.per > 0 ? x.per : 1)) * 100) / 100;
    return Math.abs(next - x.eur) >= 0.01 ? [{ id, label: x.label, unit: x.unit, old: x.eur, next, url: x.url }] : [];
  });
}

/** Stored lab → library + two schemes. Only the owner's own fields (price, its source/date, url, per) are taken from storage;
 *  thermal and carbon data always come from the seed table. Bad or unknown entries fall back to the seeds. */
export function loadLab(raw: unknown): { mats: Material[]; schemes: Scheme[] } {
  const o = raw && typeof raw === "object" ? raw as { mats?: unknown; schemes?: unknown } : {};
  const saved = Array.isArray(o.mats) ? o.mats as Partial<Material>[] : [];
  const mats = MATERIALS.map((d) => {
    const x = saved.find((s) => s && s.id === d.id);
    if (!x) return d;
    return { ...d, ...(typeof x.eur === "number" && x.eur >= 0 && Number.isFinite(x.eur) ? { eur: x.eur, priceSource: String(x.priceSource ?? "").slice(0, 200), priceDate: String(x.priceDate ?? "").slice(0, 10) } : {}),
      url: typeof x.url === "string" && /^https?:\/\//.test(x.url) ? x.url.slice(0, 500) : undefined, per: typeof x.per === "number" && x.per > 0 ? x.per : d.per };
  });
  const ids = new Set(MATERIALS.map((m) => m.id));
  const layers = (v: unknown): Layer[] | null => Array.isArray(v) && v.length <= 8 && v.every((l) => l && ids.has(l.mat) && typeof l.t === "number" && l.t >= 0 && l.t <= 2) ? v.map((l) => ({ mat: l.mat, t: l.t })) : null;
  const schemes = SEED_SCHEMES.map((d, i) => {
    const s = Array.isArray(o.schemes) ? o.schemes[i] : null;
    if (!s || typeof s !== "object") return d;
    const w = layers(s.wall), sl = layers(s.slab), ro = layers(s.roof);
    return { name: typeof s.name === "string" ? s.name.slice(0, 40) : d.name, wall: w ?? d.wall, slab: sl ?? d.slab, roof: ro ?? d.roof, window: ids.has(s.window) ? s.window : d.window };
  });
  return { mats, schemes };
}
