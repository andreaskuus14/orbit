// GAME DEV DEV07: a deterministic, game-agnostic economy simulator. The owner's table of currency sources, timed rewards and
// sinks (prices, optional upgrade growth/boost) → N seeded players → when each sink is first bought, where currency flows,
// the longest stretch with nothing to do, and how sensitive that is to each input. Everything is SIMULATED in-game currency:
// there are no real-money rows and no revenue or player-count forecasts. Same seed → same result; any one player can be replayed.
// Pure; tested in tests/economy-sim.test.ts. Egg-table balancing stays in economy-pure.ts.
import { rng } from "./economy-pure.ts";

export type Source = { name: string; amount: number; every: number }; // amount per `every` seconds of play
export type Reward = { name: string; amount: number; at: number; repeat: number }; // minutes of play; repeat 0 = once
export type Sink = { name: string; price: number; growth: number; boost: number }; // growth > 1 = rebuyable at price × growth; boost % added to sources
export type Model = { currency: string; sources: Source[]; rewards: Reward[]; sinks: Sink[]; session: number; sessions: number };

export const MAX_MODEL = 6000;
export const SAMPLE_MODEL = `# One row per line, comma separated. Lines starting with # are ignored. In-game currency only.
# currency, <name>
# source, <name>, <amount>, <every seconds>         how players earn while playing
# reward, <name>, <amount>, <at minute>, [repeat]   timed rewards (playtime gift, daily chest)
# sink, <name>, <price>, [growth ×], [boost %]       what they spend on; growth > 1 = buy again at price × growth
# session, <minutes>, <sessions>
currency, Coins
source, Clicking, 2, 1
source, Pet income, 5, 10
reward, Playtime gift, 150, 10, 15
sink, Speed upgrade, 100, 1.6, 15
sink, Forest area, 2500
sink, Golden pet, 8000
sink, Ocean area, 40000
session, 20, 6`;

/** The pasted table, strictly: every bad line is reported with its number and skipped. */
export function parseModel(text: string): { model: Model; errors: string[] } {
  const m: Model = { currency: "Coins", sources: [], rewards: [], sinks: [], session: 20, sessions: 5 }, errors: string[] = [];
  const num = (s: string | undefined) => (s !== undefined && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : NaN);
  text.slice(0, MAX_MODEL).split("\n").forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("#")) return;
    const c = l.split(/\t|,/).map((x) => x.trim()), kind = c[0].toLowerCase(), name = (c[1] ?? "").slice(0, 40), bad = (why: string) => errors.push(`Line ${i + 1}: ${why}`);
    const full = m.sources.length + m.rewards.length + m.sinks.length >= 60;
    if (kind === "currency") m.currency = name || m.currency;
    else if (/robux|revenue|usd|eur|money/.test(kind)) bad("real money and revenue are out of scope: this simulates in-game currency only");
    else if (full && ["source", "reward", "sink"].includes(kind)) bad("at most 60 rows");
    else if (kind === "source") { const a = num(c[2]), e = num(c[3]); if (name && a > 0 && e > 0) m.sources.push({ name, amount: a, every: e }); else bad("source needs a name, amount > 0 and every seconds > 0"); }
    else if (kind === "reward") {
      const a = num(c[2]), at = num(c[3]), rep = c[4] ? num(c[4]) : 0;
      if (name && a > 0 && at >= 0 && rep >= 0) m.rewards.push({ name, amount: a, at, repeat: rep }); else bad("reward needs a name, amount > 0, minute ≥ 0 and repeat ≥ 0");
    } else if (kind === "sink") {
      const p = num(c[2]), g = c[3] ? num(c[3]) : 0, b = c[4] ? num(c[4]) : 0;
      if (!name || !(p > 0) || !(g === 0 || g >= 1) || !(b >= 0)) bad("sink needs a name, price > 0, growth 0 or ≥ 1, boost ≥ 0");
      else if (m.sinks.some((x) => x.name === name)) bad(`sink "${name}" is listed twice`);
      else m.sinks.push({ name, price: p, growth: g, boost: b });
    } else if (kind === "session") {
      const a = num(c[1]), b = num(c[2]);
      if (a >= 1 && a <= 240 && Number.isInteger(b) && b >= 1 && b <= 50) { m.session = a; m.sessions = b; } else bad("session needs minutes 1–240 and sessions 1–50");
    } else bad(`unknown row "${c[0].slice(0, 20)}" (use currency, source, reward, sink or session)`);
  });
  if (!m.sources.length && !m.rewards.length) errors.push("Add at least one source or reward");
  if (!m.sinks.length) errors.push("Add at least one sink");
  return { model: m, errors };
}

// ---- Simulation ---------------------------------------------------------------

export type Event = { min: number; kind: "reward" | "buy"; name: string; balance: number };
export type SimOpts = { players: number; seed: number };
export const SIM_DEFAULTS: SimOpts = { players: 100, seed: 1 };
const STEP = 10; // seconds per tick: plenty for minute-level answers

/** One seeded player. Activity varies 70–130% per player; each tick it buys the cheapest affordable sink (one-offs once, rebuyables at growing prices).
 *  shortcut: a greedy buyer, no saving for a favourite; add a priority column when his game needs one. */
export function playOne(m: Model, seed: number, player: number): { events: Event[]; earned: number; rewarded: number; spent: Record<string, number>; balance: number } {
  const r = rng((seed * 7919 + player * 104729) >>> 0), activity = 0.7 + 0.6 * r();
  const price = m.sinks.map((s) => s.price), bought = m.sinks.map(() => 0), spent: Record<string, number> = {};
  const next = m.rewards.map((x) => x.at * 60), events: Event[] = [];
  let bal = 0, earned = 0, rewarded = 0, boost = 0;
  const end = m.session * m.sessions * 60;
  for (let t = STEP; t <= end; t += STEP) {
    const inc = m.sources.reduce((a, s) => a + (s.amount / s.every) * STEP, 0) * activity * (1 + boost / 100);
    bal += inc; earned += inc;
    m.rewards.forEach((x, i) => {
      if (next[i] > t) return;
      bal += x.amount; rewarded += x.amount; events.push({ min: t / 60, kind: "reward", name: x.name, balance: Math.round(bal) });
      next[i] = x.repeat > 0 ? next[i] + x.repeat * 60 : Infinity;
    });
    for (;;) {
      let k = -1;
      m.sinks.forEach((s, i) => { if ((s.growth >= 1 || !bought[i]) && price[i] <= bal && (k < 0 || price[i] < price[k])) k = i; });
      if (k < 0) break;
      const s = m.sinks[k];
      bal -= price[k]; spent[s.name] = (spent[s.name] ?? 0) + price[k]; bought[k]++; boost += s.boost;
      events.push({ min: t / 60, kind: "buy", name: s.name, balance: Math.round(bal) });
      if (s.growth >= 1) price[k] *= s.growth;
    }
  }
  return { events, earned, rewarded, spent, balance: bal };
}

const q = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

export type SinkStat = { name: string; price: number; reached: number; median: number | null; p90: number | null; buys: number | null; share: number };
export type SimResult = {
  label: "simulated"; seed: number; players: number; minutes: number;
  sinks: SinkStat[]; earned: number; rewarded: number; spent: number; endBalance: number; // medians per player
  gap: { minutes: number; from: number } | null; // median player's longest stretch with no reward and nothing bought
};

const longestGap = (ev: Event[], end: number) => {
  let best = { minutes: 0, from: 0 }, last = 0;
  for (const e of [...ev.map((x) => x.min), end]) { if (e - last > best.minutes) best = { minutes: e - last, from: last }; last = e; }
  return best;
};

export function simulateModel(m: Model, o: SimOpts = SIM_DEFAULTS): SimResult {
  const n = Math.max(1, Math.min(500, Math.floor(o.players))), minutes = m.session * m.sessions;
  const runs = Array.from({ length: n }, (_, i) => playOne(m, o.seed, i));
  const total = (xs: Record<string, number>) => Object.values(xs).reduce((a, b) => a + b, 0);
  const spentAll = runs.reduce((a, x) => a + total(x.spent), 0) || 1;
  const sinks = m.sinks.map((s): SinkStat => {
    const first = runs.flatMap((x) => { const e = x.events.find((v) => v.kind === "buy" && v.name === s.name); return e ? [e.min] : []; });
    return { name: s.name, price: s.price, reached: Math.round((first.length / n) * 100), median: r1(q(first, 0.5)), p90: r1(q(first, 0.9)),
      buys: q(runs.map((x) => x.events.filter((v) => v.kind === "buy" && v.name === s.name).length), 0.5),
      share: Math.round((runs.reduce((a, x) => a + (x.spent[s.name] ?? 0), 0) / spentAll) * 100) };
  });
  const gaps = runs.map((x) => longestGap(x.events, minutes)).sort((a, b) => a.minutes - b.minutes), g = gaps[Math.floor(n / 2)];
  const med = (f: (x: (typeof runs)[number]) => number) => Math.round(q(runs.map(f), 0.5) ?? 0);
  return { label: "simulated", seed: o.seed, players: n, minutes, sinks, earned: med((x) => x.earned), rewarded: med((x) => x.rewarded), spent: med((x) => total(x.spent)),
    endBalance: med((x) => x.balance), gap: g && g.minutes > 0 ? { minutes: r1(g.minutes)!, from: r1(g.from)! } : null };
}

/** Plain findings, codes for gd.sim.f.* (all simulated). */
export type Finding = { code: "unreached" | "pileUp" | "gap"; vars: Record<string, string | number> };
export function findings(r: SimResult): Finding[] {
  const out: Finding[] = [];
  for (const s of r.sinks) if (s.reached < 50) out.push({ code: "unreached", vars: { name: s.name, pct: s.reached } });
  if (r.spent < 0.5 * (r.earned + r.rewarded)) out.push({ code: "pileUp", vars: { pct: Math.round((r.spent / Math.max(1, r.earned + r.rewarded)) * 100) } });
  if (r.gap && r.gap.minutes >= 10) out.push({ code: "gap", vars: { min: r.gap.minutes, from: r.gap.from } });
  return out;
}

// ---- Sensitivity ----------------------------------------------------------------

export type Sens = { input: string; down: number | null; up: number | null }; // Δ minutes to the target sink at ×0.8 / ×1.2
/** Each source/reward amount and sink price alone at ×0.8 and ×1.2, same seed: how far the median minute of the
 *  furthest sink most players reach moves. Sorted by largest effect. */
export function sensitivity(m: Model, o: SimOpts = SIM_DEFAULTS): { target: string | null; rows: Sens[] } {
  const base = simulateModel(m, o), t = [...base.sinks].reverse().find((s) => s.reached >= 50 && s.median !== null);
  if (!t) return { target: null, rows: [] };
  const at = (mm: Model) => { const s = simulateModel(mm, o).sinks.find((x) => x.name === t.name)!; return s.reached >= 50 ? s.median : null; };
  const d = (v: number | null) => (v === null ? null : r1(v - t.median!));
  const vary = (f: (k: number) => Model) => ({ down: d(at(f(0.8))), up: d(at(f(1.2))) });
  const rows: Sens[] = [
    ...m.sources.map((s, i) => ({ input: `source:${s.name}`, ...vary((k) => ({ ...m, sources: m.sources.map((x, j) => (j === i ? { ...x, amount: x.amount * k } : x)) })) })),
    ...m.rewards.map((s, i) => ({ input: `reward:${s.name}`, ...vary((k) => ({ ...m, rewards: m.rewards.map((x, j) => (j === i ? { ...x, amount: x.amount * k } : x)) })) })),
    ...m.sinks.map((s, i) => ({ input: `sink:${s.name}`, ...vary((k) => ({ ...m, sinks: m.sinks.map((x, j) => (j === i ? { ...x, price: x.price * k } : x)) })) })),
  ];
  const size = (s: Sens) => Math.max(Math.abs(s.down ?? 1e9), Math.abs(s.up ?? 1e9));
  return { target: t.name, rows: rows.sort((a, b) => size(b) - size(a)) };
}
