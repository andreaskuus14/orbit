// BUSINESS what-if simulator (roadmap 3): Monte Carlo over one niche's monthly margin model. Pure, seeded, no model calls.
// Tested in tests/whatif.test.ts. Runs in src/components/whatif.worker.ts; UI: src/components/WhatIf.tsx.
import type { Margin } from "./niche-pure.ts";
import { rng } from "./forecast-pure.ts";

export type Key = "traffic" | "cr" | "aov" | "cpc" | "returns" | "cost";
export type Range = { lo: number; hi: number };
/** Each month draws every input from its range (triangular, peak in the middle); fees and fixed costs are plain numbers. */
export type Scenario = Record<Key, Range> & { feePct: number; fixed: number; price: number }; // price: the niche's, sets the € slider scale

export const SPEC: Record<Key, { label: string; unit: "" | "%" | "€"; step: number; max: (s: Scenario) => number }> = {
  traffic: { label: "Ad clicks / month", unit: "", step: 50, max: () => 20000 },
  cr: { label: "Conversion rate", unit: "%", step: 0.001, max: () => 0.1 },
  aov: { label: "Order value", unit: "€", step: 0.5, max: (s) => Math.max(50, Math.ceil((s.price || 0) * 3)) },
  cpc: { label: "Ad cost per click", unit: "€", step: 0.01, max: () => 3 },
  returns: { label: "Returns", unit: "%", step: 0.005, max: () => 0.3 },
  cost: { label: "Product + shipping / order", unit: "€", step: 0.5, max: (s) => Math.max(50, Math.ceil((s.price || 0) * 2)) },
};
export const KEYS = Object.keys(SPEC) as Key[];

const r2 = (n: number) => Math.round(n * 100) / 100;
const mid = (r: Range) => (r.lo + r.hi) / 2;

/** Starting ranges from a niche's per-order margin; ad cost per click comes from its cost per order at a 2 % conversion rate. */
export function scenarioFrom(m: Margin): Scenario {
  const cpc = Math.max(0.05, m.cac * 0.02), cost = m.cogs + m.shipping;
  return {
    traffic: { lo: 500, hi: 1500 }, cr: { lo: 0.01, hi: 0.03 },
    aov: { lo: r2(m.price * 0.9), hi: r2(m.price * 1.1) }, cpc: { lo: r2(cpc * 0.6), hi: r2(cpc * 1.4) },
    returns: { lo: 0.02, hi: 0.08 }, cost: { lo: r2(cost * 0.9), hi: r2(cost * 1.15) },
    feePct: m.feePct, fixed: 30, price: m.price,
  };
}

/** Clamp everything into sane bounds and swap a reversed range (input from sliders and number boxes). */
export function fixScenario(s: Scenario): Scenario {
  const out = { ...s, feePct: Math.min(0.3, Math.max(0, s.feePct || 0)), fixed: Math.max(0, s.fixed || 0) };
  for (const k of KEYS) {
    const max = SPEC[k].max(s), c = (v: number) => Math.min(max, Math.max(0, Number.isFinite(v) ? v : 0));
    const a = c(s[k].lo), b = c(s[k].hi);
    out[k] = { lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  return out;
}

/** One month's profit: kept revenue after returns and fees, minus product + shipping on every order (returns aren't resold), ads and fixed costs. */
export function profitOf(v: Record<Key, number>, feePct: number, fixed: number): number {
  const orders = v.traffic * v.cr;
  return orders * (v.aov * (1 - v.returns) * (1 - feePct) - v.cost) - v.traffic * v.cpc - fixed;
}
/** The most an ad click may cost before the month loses money. */
const breakEvenCpc = (v: Record<Key, number>, feePct: number, fixed: number) =>
  v.cr * (v.aov * (1 - v.returns) * (1 - feePct) - v.cost) - (v.traffic > 0 ? fixed / v.traffic : 0);

const tri = (r: Range, u: number) => r.lo + (r.hi - r.lo) * (u < 0.5 ? Math.sqrt(u / 2) : 1 - Math.sqrt((1 - u) / 2));
const q = (sorted: Float64Array, p: number) => sorted[Math.round(p * (sorted.length - 1))];
const mids = (s: Scenario) => Object.fromEntries(KEYS.map((k) => [k, mid(s[k])])) as Record<Key, number>;

export type Swing = { key: Key; atLo: number; atHi: number; swing: number; breakEven: number | null };
export type Result = {
  profits: Float64Array; // sorted ascending, for the histogram
  mean: number; p5: number; p25: number; p50: number; p75: number; p95: number; pLoss: number;
  beCpc: number; beSpend: number; // medians over the runs
  tornado: Swing[]; // biggest swing first
};

/** The value of `k` where profit crosses zero with every other input at its middle, if that happens inside its range. */
function zeroAt(s: Scenario, k: Key): number | null {
  const v = mids(s), f = (x: number) => profitOf({ ...v, [k]: x }, s.feePct, s.fixed);
  let a = s[k].lo, b = s[k].hi, fa = f(a);
  if (a === b || Math.sign(fa) === Math.sign(f(b)) || fa === 0) return fa === 0 ? a : null;
  for (let i = 0; i < 50; i++) { const m = (a + b) / 2, fm = f(m); if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m; }
  return (a + b) / 2;
}

/** Monte Carlo: `runs` months, same seed → same answer. */
export function simulate(input: Scenario, seed = 1, runs = 10_000): Result {
  const s = fixScenario(input), next = rng(seed);
  const profits = new Float64Array(runs), cpcs = new Float64Array(runs), spends = new Float64Array(runs);
  const v = {} as Record<Key, number>;
  let sum = 0, losses = 0;
  for (let i = 0; i < runs; i++) {
    for (const k of KEYS) v[k] = tri(s[k], next());
    const p = profitOf(v, s.feePct, s.fixed);
    profits[i] = p; sum += p; if (p < 0) losses++;
    cpcs[i] = breakEvenCpc(v, s.feePct, s.fixed); spends[i] = cpcs[i] * v.traffic;
  }
  profits.sort(); cpcs.sort(); spends.sort();
  const base = mids(s);
  const tornado = KEYS.map((key) => {
    const atLo = profitOf({ ...base, [key]: s[key].lo }, s.feePct, s.fixed), atHi = profitOf({ ...base, [key]: s[key].hi }, s.feePct, s.fixed);
    return { key, atLo, atHi, swing: Math.abs(atHi - atLo), breakEven: zeroAt(s, key) };
  }).sort((a, b) => b.swing - a.swing);
  return { profits, mean: sum / runs, p5: q(profits, 0.05), p25: q(profits, 0.25), p50: q(profits, 0.5), p75: q(profits, 0.75), p95: q(profits, 0.95),
    pLoss: losses / runs, beCpc: q(cpcs, 0.5), beSpend: q(spends, 0.5), tornado };
}

/** Counts per bin over [lo, hi]; values outside land in the end bins. Shared bounds let two scenarios sit on one axis. */
export function histogram(sorted: Float64Array, lo: number, hi: number, bins = 24): number[] {
  const out = new Array(bins).fill(0), w = (hi - lo) / bins || 1;
  for (const x of sorted) out[Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / w)))]++;
  return out;
}

export const eur = (n: number) => `${n < 0 ? "−" : ""}€${Math.abs(n) >= 100 ? Math.round(Math.abs(n)).toLocaleString("en-US") : Math.abs(n).toFixed(2)}`;
export const fmt = (k: Key, x: number) => SPEC[k].unit === "%" ? `${r2(x * 100)}%` : SPEC[k].unit === "€" ? eur(x) : Math.round(x).toLocaleString("en-US");

/** "About 1 in 4 months", "3 in 10 months", "almost never". */
export function oneIn(p: number): string {
  if (p < 0.005) return "Almost no month";
  if (p > 0.995) return "Practically every month";
  if (p <= 0.5) return `About 1 in ${Math.round(1 / p)} months`;
  return `About ${Math.round(p * 10)} in 10 months`;
}

/** Plain-English takeaways, most important first. */
export function takeaways(s: Scenario, r: Result): string[] {
  const top = r.tornado[0], out = [`A typical month makes ${eur(r.p50)} (half of months land between ${eur(r.p25)} and ${eur(r.p75)}).`];
  let loss = `${oneIn(r.pLoss)} ${r.pLoss < 0.005 ? "loses" : "lose"} money`;
  if (r.pLoss >= 0.005 && r.pLoss <= 0.995 && top.breakEven !== null)
    loss += ` unless ${SPEC[top.key].label.toLowerCase()} stays ${top.atHi > top.atLo ? "above" : "below"} ${fmt(top.key, top.breakEven)} (others at their middle)`;
  out.push(`${loss}.`);
  out.push(r.beCpc > 0
    ? `Ads pay off up to ${eur(r.beCpc)} per click, about ${eur(r.beSpend)} of ad spend a month at these clicks; you plan ${fmt("cpc", s.cpc.lo)}–${fmt("cpc", s.cpc.hi)}.`
    : "No ad price works: a typical order loses money before ads are even paid.");
  if (top.swing > 0) out.push(`${SPEC[top.key].label} matters most: across its range profit swings by ${eur(top.swing)} a month.`);
  return out;
}
