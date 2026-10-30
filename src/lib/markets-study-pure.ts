// MARKETS study tools (MKT07 strategy vs baseline, MKT08 decision journal + scenario sensitivity). Pure; tested in
// tests/markets-study.test.ts. Simulation / education only: no forecasts, no advice, nothing traded.
import { botTargets, type Bar, type Strategy } from "./markets-pure.ts";
import { FILL } from "./markets-depth-pure.ts";

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/* ---------- MKT07: fair strategy comparison ---------- */

/** Cost per unit of one-way turnover: half the spread + average slippage + fee, as in the paper fills. */
export const COST_BPS = FILL.spreadBps / 2 + FILL.maxSlipBps / 2 + FILL.feeBps;
export const MIN_PERIODS = 20;
export type Leg = { from: string; to: string; days: number; ret: number; maxDrawdown: number; turnover: number; exposure: number };
export type StudySide = { full: Leg; early: Leg; late: Leg | null };
export type Study = { strategy: Strategy; baseline: StudySide; rule: StudySide; tickers: string[]; costBps: number; notes: string[] } | { error: string };

type Path = { dates: string[]; rets: number[]; turn: number[]; expo: number[] };

/** Walk forward over the dates every ticker has. The weights held from close d[i] to d[i+1] are decided from bars dated
 *  before d[i] (no lookahead: the rule never sees the close it trades at). Weights drift with prices between rebalances;
 *  turnover is charged COST_BPS. pick(i, visible, held) returns new target weights or null (keep). */
function walk(tickers: string[], hist: Record<string, Bar[]>, pick: (i: number, visible: Record<string, Bar[]>, last?: string) => Record<string, number> | null): Path | string {
  const sets = tickers.map((t) => new Set((hist[t] ?? []).map((b) => b.date)));
  const dates = [...(sets[0] ?? [])].filter((d) => sets.every((s) => s.has(d))).sort();
  if (dates.length < MIN_PERIODS * 2) return `Needs ${MIN_PERIODS * 2}+ shared trading days of history for every ticker (have ${dates.length})`;
  const close = Object.fromEntries(tickers.map((t) => [t, new Map((hist[t] ?? []).map((b) => [b.date, b.close]))]));
  let w: Record<string, number> = {};
  const out: Path = { dates: [], rets: [], turn: [], expo: [] };
  for (let i = 0; i < dates.length - 1; i++) {
    const visible = Object.fromEntries(tickers.map((t) => [t, (hist[t] ?? []).filter((b) => b.date < dates[i])]));
    const next = pick(i, visible, dates[i]);
    let turn = 0;
    if (next) {
      const keys = new Set([...Object.keys(w), ...Object.keys(next)]);
      const nw: Record<string, number> = {};
      for (const k of keys) {
        const have = w[k] ?? 0, want = next[k] ?? 0;
        nw[k] = want > 0 && have > 0 && Math.abs(want - have) < 0.02 ? have : want; // same 2% drift band as the paper bot
        turn += Math.abs(nw[k] - have);
      }
      w = Object.fromEntries(Object.entries(nw).filter(([, v]) => v > 0));
    }
    const d0 = dates[i], d1 = dates[i + 1];
    const gains = Object.fromEntries(Object.keys(w).map((k) => [k, close[k].get(d1)! / close[k].get(d0)! - 1]));
    const expo = Object.values(w).reduce((s, v) => s + v, 0);
    const gross = Object.entries(w).reduce((s, [k, v]) => s + v * gains[k], 0), ret = gross - (turn * COST_BPS) / 1e4;
    out.dates.push(d1); out.rets.push(ret); out.turn.push(turn); out.expo.push(expo);
    w = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, (v * (1 + gains[k])) / (1 + gross)])); // drift (cash earns 0)
  }
  return out;
}

function leg(p: Path, a: number, b: number): Leg {
  let eq = 1, peak = 1, dd = 0;
  for (let i = a; i < b; i++) { eq *= 1 + p.rets[i]; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  const n = b - a, sum = (xs: number[]) => xs.slice(a, b).reduce((s, x) => s + x, 0);
  return { from: p.dates[a], to: p.dates[b - 1], days: n, ret: r4(eq - 1), maxDrawdown: r4(dd), turnover: r4(sum(p.turn)), exposure: r4(sum(p.expo) / n) };
}

/** Same tickers, same dates, same costs: the rule vs equal-weight buy-and-hold. The first period of each side that the rule can
 *  act on starts both sides, so warm-up days don't flatter either. Split into an early and a later window. */
export function compareStrategy(strategy: Strategy, tickers: string[], hist: Record<string, Bar[]>): Study {
  if (strategy === "off") return { error: "Pick a strategy to compare" };
  if (!tickers.length) return { error: "Add tickers to the watchlist first" };
  let lastRebalance: string | undefined;
  const rule = walk(tickers, hist, (_i, vis, day) => {
    const t = botTargets(strategy, tickers, vis, lastRebalance, day!);
    if (t && strategy === "rebalance") lastRebalance = day;
    return t;
  });
  if (typeof rule === "string") return { error: rule };
  const start = firstActive(strategy, tickers, hist, rule.dates);
  const base = walk(tickers, hist, (i) => (i === start ? Object.fromEntries(tickers.map((t) => [t, 1 / tickers.length])) : null));
  if (typeof base === "string") return { error: base };
  const n = rule.rets.length;
  if (n - start < MIN_PERIODS) return { error: `Only ${n - start} days after the rule's warm-up; needs ${MIN_PERIODS}+` };
  const cut = start + Math.floor(((n - start) * 2) / 3);
  const side = (p: Path): StudySide => ({ full: leg(p, start, n), early: leg(p, start, cut), late: n - cut >= MIN_PERIODS ? leg(p, cut, n) : null });
  const notes = ["mk.st.noteSelection", "mk.st.noteSurvivor", "mk.st.noteCosts"];
  if (n - cut < MIN_PERIODS) notes.unshift("mk.st.noteShort");
  return { strategy, tickers, costBps: COST_BPS, baseline: side(base), rule: side(rule), notes };
}
/** Index of the first period where the rule has enough visible history to act (ma: 50 bars before the trade date). */
function firstActive(s: Strategy, tickers: string[], hist: Record<string, Bar[]>, periodEnds: string[]): number {
  const need = s === "ma" ? 50 : 1;
  const ok = (dTrade: string) => tickers.every((t) => (hist[t] ?? []).filter((b) => b.date < dTrade).length >= need);
  // period i trades at the date before periodEnds[i]; periodEnds[i-1] is that date (period 0 trades at the first shared date)
  const i = periodEnds.findIndex((_, k) => k > 0 && ok(periodEnds[k - 1]));
  return Math.max(0, i);
}

/* ---------- MKT08: decision journal ---------- */

export type Outcome = "right" | "wrong" | "mixed" | "unclear";
export type JournalEntry = {
  id: string; at: string; ticker: string; action: "buy" | "sell" | "hold" | "watch"; thesis: string; invalidation: string; reviewOn: string;
  priceAt: number | null; review?: { at: string; outcome: Outcome; note: string; priceAt: number | null };
};
export const MAX_JOURNAL = 200;
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** A new entry: why (thesis), what would prove it wrong (invalidation) and when to look again. No price target: no predictions. */
export function journalEntry(x: Record<string, unknown>, id: string, now: Date, priceAt: number | null): JournalEntry | string {
  const ticker = txt(x.ticker, 15).toUpperCase(), thesis = txt(x.thesis, 500), invalidation = txt(x.invalidation, 300), reviewOn = txt(x.reviewOn, 10);
  const action = ["buy", "sell", "hold", "watch"].includes(x.action as string) ? (x.action as JournalEntry["action"]) : null;
  if (!ticker || !action) return "Ticker and decision are required";
  if (thesis.length < 10) return "Write the reason (10+ characters)";
  if (invalidation.length < 5) return "Write what would prove it wrong";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewOn) || reviewOn <= now.toISOString().slice(0, 10)) return "Review date must be a future date";
  return { id, at: now.toISOString(), ticker, action, thesis, invalidation, reviewOn, priceAt };
}
export function reviewEntry(e: JournalEntry, x: Record<string, unknown>, now: Date, priceAt: number | null): JournalEntry | string {
  const outcome = ["right", "wrong", "mixed", "unclear"].includes(x.outcome as string) ? (x.outcome as Outcome) : null;
  if (!outcome) return "Pick an outcome";
  return { ...e, review: { at: now.toISOString(), outcome, note: txt(x.note, 500), priceAt } };
}
export const reviewDue = (e: JournalEntry, today: string) => !e.review && e.reviewOn <= today;
/** Reviewed decisions by outcome (the only "score": his own judgement, with the count it rests on). */
export function journalTally(es: JournalEntry[]) {
  const done = es.filter((e) => e.review);
  const by = { right: 0, wrong: 0, mixed: 0, unclear: 0 } as Record<Outcome, number>;
  for (const e of done) by[e.review!.outcome]++;
  return { reviewed: done.length, open: es.length - done.length, by };
}

/* ---------- MKT08: scenario sensitivity ---------- */

export const SHOCKS = [-20, -10, -5, 5, 10];
type Row = { ticker: string; currency: string; shares: number; price: number | null };
/** What-if arithmetic, not a forecast: the value change per currency if every priced holding moved by s%, and the
 *  single holding whose -10% would hurt most per currency. Unpriced holdings are listed, never assumed. */
export function scenarios(rows: Row[], shocks = SHOCKS) {
  const priced = rows.filter((r) => r.price !== null);
  const value = (r: Row) => r.shares * r.price!;
  const byCur = (f: (r: Row) => number) => {
    const o: Record<string, number> = {};
    for (const r of priced) o[r.currency] = Math.round(((o[r.currency] ?? 0) + f(r)) * 100) / 100;
    return o;
  };
  const top: Record<string, { ticker: string; change: number; share: number }> = {};
  const total = byCur(value);
  for (const r of priced) {
    const c = -0.1 * value(r);
    if (!top[r.currency] || c < top[r.currency].change) top[r.currency] = { ticker: r.ticker, change: Math.round(c * 100) / 100, share: total[r.currency] ? r4(value(r) / total[r.currency]) : 0 };
  }
  return { shocks: shocks.map((s) => ({ pct: s, change: byCur((r) => (value(r) * s) / 100) })), biggest: top, unpriced: rows.filter((r) => r.price === null).map((r) => r.ticker) };
}
