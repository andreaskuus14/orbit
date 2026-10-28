// Roblox change impact (roadmap 38), pure: baseline vs proposed egg table through the existing balancer (economy-pure.ts).
// Every number is tagged with where it came from: "calculated" (plain arithmetic), "simulated" (seeded spender personas)
// or "playtest" (what Andreas measured himself). Every result lists the changed inputs it reflects. Tested in tests/economy-impact.test.ts.
import { SIM_DEFAULTS, economyReport, simulate, type Economy, type SimOpts } from "./economy-pure.ts";
import type { Lang } from "./i18n-pure.ts";

export type Source = "calculated" | "simulated" | "playtest";
/** One changed input: key "rate" | "slots" | "egg:<name>" | "pet:<name>". */
export type InputChange = { key: string; label: string };
export type Metric = "firstUpgrade" | "lastEgg" | "coins30";
export type Row = { metric: Metric; source: Source; base: number | null; proposed: number | null; inputs: string[]; note?: string };
export type Playtest = { metric: Metric; side: "base" | "proposed"; value: number; note?: string }; // his own measurement
export type Sensitivity = { input: string; firstUpgrade: number | null; lastEgg: number | null }; // proposed-alone minus baseline, minutes
export type Impact = { changes: InputChange[]; rows: Row[]; bottlenecks: { base: string[]; proposed: string[]; inputs: string[] }; sensitivity: Sensitivity[] };

const T = {
  en: { rate: "base coin rate", slots: "equip slots", egg: "egg", pet: "pet", added: "added", removed: "removed",
    calculated: "Calculated", simulated: "Simulated personas", playtest: "Your playtest",
    firstUpgrade: "Time to first egg (min)", lastEgg: "Free player: time to last reached egg (min)", coins30: "Coins after 30 min",
    none: "No inputs changed", changed: "Changed inputs", calcFirst: "first egg price ÷ base rate", calcCoins: "base rate × 30 min, no pets",
    walls: "Bottlenecks (simulated, free player)", before: "baseline", after: "proposed", sens: "Sensitivity: each change alone (simulated, Δ min first egg / last egg)",
    compare: "Compare", baseline: "Baseline (your saved table)", proposedT: "Proposed table (edit values)", run: "Compare", addPt: "Add measurement", value: "Value",
    intro: "Compare your current table with edited values. Nothing changes in Roblox: you edit prices in Studio yourself." },
  et: { rate: "põhi-mündimäär", slots: "varustuskohad", egg: "muna", pet: "lemmik", added: "lisatud", removed: "eemaldatud",
    calculated: "Arvutatud", simulated: "Simuleeritud personad", playtest: "Sinu mängutest",
    firstUpgrade: "Aeg esimese munani (min)", lastEgg: "Tasuta mängija: aeg viimase munani (min)", coins30: "Münte 30 min pärast",
    none: "Sisendeid ei muudetud", changed: "Muudetud sisendid", calcFirst: "esimese muna hind ÷ põhimäär", calcCoins: "põhimäär × 30 min, lemmikuteta",
    walls: "Kitsaskohad (simuleeritud, tasuta mängija)", before: "praegune", after: "ettepanek", sens: "Tundlikkus: iga muudatus eraldi (simuleeritud, Δ min esimene / viimane muna)",
    compare: "Võrdle", baseline: "Praegune (salvestatud tabel)", proposedT: "Ettepaneku tabel (muuda väärtusi)", run: "Võrdle", addPt: "Lisa mõõtmine", value: "Väärtus",
    intro: "Võrdle praegust tabelit muudetud väärtustega. Robloxis ei muutu midagi: hindu muudad Studios ise." },
} as const;
export const impactText = (lang: Lang) => T[lang];

/** Which inputs differ, named in his words ("egg Forest Egg price 1500 → 900"). */
export function diffInputs(base: Economy, prop: Economy, lang: Lang = "en"): InputChange[] {
  const t = T[lang], out: InputChange[] = [];
  if (base.rate !== prop.rate) out.push({ key: "rate", label: `${t.rate} ${base.rate} → ${prop.rate}` });
  if (base.slots !== prop.slots) out.push({ key: "slots", label: `${t.slots} ${base.slots} → ${prop.slots}` });
  const side = <X extends { name: string }>(kind: "egg" | "pet", a: X[], b: X[], show: (x: X) => string) => {
    for (const x of a) {
      const y = b.find((v) => v.name === x.name);
      if (!y) out.push({ key: `${kind}:${x.name}`, label: `${t[kind]} ${x.name} ${t.removed}` });
      else if (show(x) !== show(y)) out.push({ key: `${kind}:${x.name}`, label: `${t[kind]} ${x.name} ${show(x)} → ${show(y)}` });
    }
    for (const y of b) if (!a.some((x) => x.name === y.name)) out.push({ key: `${kind}:${y.name}`, label: `${t[kind]} ${y.name} ${t.added} (${show(y)})` });
  };
  side("egg", base.eggs, prop.eggs, (g) => String(g.price));
  side("pet", base.pets, prop.pets, (p) => `${p.egg}, ${p.chance}%, ${p.cps}/s`);
  return out;
}

/** Baseline with exactly one input taken from the proposal (for sensitivity). */
export function applyOne(base: Economy, prop: Economy, key: string): Economy {
  if (key === "rate") return { ...base, rate: prop.rate };
  if (key === "slots") return { ...base, slots: prop.slots };
  const [kind, name] = [key.slice(0, 3), key.slice(4)], list = kind === "egg" ? "eggs" : "pets";
  const from = (prop[list] as { name: string }[]).find((x) => x.name === name), cur = base[list] as { name: string }[];
  const next = !from ? cur.filter((x) => x.name !== name) : cur.some((x) => x.name === name) ? cur.map((x) => (x.name === name ? from : x)) : [...cur, from];
  // shortcut: an added egg goes to the end of the unlock order; fine unless he inserts one mid-progression.
  return { ...base, [list]: next };
}

const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const firstUpgradeCalc = (e: Economy) => (e.eggs[0] && e.rate > 0 ? r1(e.eggs[0].price / e.rate / 60) : null);
const freeStats = (e: Economy, o: SimOpts) => {
  const free = simulate(e, o)[0].eggs, last = [...free].reverse().find((x) => x.reached >= 50);
  return { first: free[0]?.median ?? null, last: last?.median ?? null };
};

/** Baseline vs proposed. Playtest rows only appear when he typed a measurement; they are never filled from the simulation. */
export function compareEconomies(base: Economy, prop: Economy, playtests: Playtest[] = [], o: SimOpts = SIM_DEFAULTS, lang: Lang = "en"): Impact {
  const changes = diffInputs(base, prop, lang), inputs = changes.map((c) => c.label);
  const sb = freeStats(base, o), sp = freeStats(prop, o);
  const rows: Row[] = [
    { metric: "firstUpgrade", source: "calculated", base: firstUpgradeCalc(base), proposed: firstUpgradeCalc(prop), inputs, note: T[lang].calcFirst },
    { metric: "coins30", source: "calculated", base: base.rate * 1800, proposed: prop.rate * 1800, inputs, note: T[lang].calcCoins },
    { metric: "firstUpgrade", source: "simulated", base: sb.first, proposed: sp.first, inputs },
    { metric: "lastEgg", source: "simulated", base: sb.last, proposed: sp.last, inputs },
  ];
  for (const m of ["firstUpgrade", "lastEgg", "coins30"] as Metric[]) {
    const b = playtests.find((p) => p.metric === m && p.side === "base"), p = playtests.find((x) => x.metric === m && x.side === "proposed");
    if (b || p) rows.push({ metric: m, source: "playtest", base: b?.value ?? null, proposed: p?.value ?? null, inputs, note: [b?.note, p?.note].filter(Boolean).join("; ") || undefined });
  }
  const walls = (e: Economy) => economyReport(e, o).findings.filter((f) => f.kind !== "easy").map((f) => `${f.egg}: ${f.why}`);
  const d = (a: number | null, b: number | null) => (a === null || b === null ? null : r1(a - b));
  const sensitivity = changes.map((c) => { const s = freeStats(applyOne(base, prop, c.key), o); return { input: c.label, firstUpgrade: d(s.first, sb.first), lastEgg: d(s.last, sb.last) }; });
  return { changes, rows, bottlenecks: { base: walls(base), proposed: walls(prop), inputs }, sensitivity };
}

/** Plain text for the panel or a note: grouped by source so calculated, simulated and playtest never blur. */
export function impactLines(i: Impact, lang: Lang = "en"): string[] {
  const t = T[lang], out = [`${t.changed}: ${i.changes.map((c) => c.label).join("; ") || t.none}`];
  for (const s of ["calculated", "simulated", "playtest"] as Source[]) {
    const rows = i.rows.filter((r) => r.source === s);
    if (rows.length) out.push(`[${t[s]}]`, ...rows.map((r) => `  ${t[r.metric]}: ${r.base ?? "–"} → ${r.proposed ?? "–"}${r.note ? ` (${r.note})` : ""}`));
  }
  out.push(`${t.walls}:`, ...i.bottlenecks.base.map((b) => `  ${t.before}: ${b}`), ...i.bottlenecks.proposed.map((b) => `  ${t.after}: ${b}`));
  if (i.sensitivity.length) out.push(`${t.sens}:`, ...i.sensitivity.map((x) => `  ${x.input}: ${x.firstUpgrade ?? "–"} / ${x.lastEgg ?? "–"}`));
  out.push(`${t.walls}:`, ...i.bottlenecks.base.map((b) => `  ${t.before}: ${b}`), ...i.bottlenecks.proposed.map((b) => `  ${t.after}: ${b}`));
  if (i.sensitivity.length) out.push(`${t.sens}:`, ...i.sensitivity.map((x) => `  ${x.input}: ${x.firstUpgrade ?? "–"} / ${x.lastEgg ?? "–"}`));
  return out;
}
