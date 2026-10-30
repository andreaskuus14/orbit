// MARKETS depth rules (MKT02–06): instrument identity, currency-safe totals, portfolio accounting, alert crossing
// semantics, research windows and deterministic PAPER fills. Pure — tested in tests/markets-depth.test.ts.
// Simulation / education only: nothing here talks to a broker or moves real money.
import { isStale, type Bar, type Holding, type Trade } from "./markets-pure.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- MKT02: instrument identity ---------- */

export type Instrument = { ticker: string; exchange: string; currency: string; type: "equity/ETF" | "index"; provider: "Stooq"; providerId: string };
/** Stooq market suffix → [exchange, quote currency]. UK prices are quoted in pence (GBX), not pounds. */
const MARKETS: Record<string, [string, string]> = {
  us: ["NYSE/Nasdaq", "USD"], uk: ["LSE", "GBX"], de: ["Xetra", "EUR"], jp: ["TSE", "JPY"], hk: ["HKEX", "HKD"], hu: ["BSE", "HUF"], pl: ["GPW", "PLN"],
};
/** Who the ticker is at the price provider, or why it's unsupported. Never maps to a different symbol than the user typed
 *  (only the provider's own spelling: BRK.B → brk-b.us); a quote is accepted only when its symbol equals providerId. */
export function instrument(ticker: string): Instrument | { ticker: string; error: string } {
  const t = ticker.toUpperCase();
  if (t.startsWith("^")) return /^\^[A-Z0-9]{1,10}$/.test(t) ? { ticker: t, exchange: "Index", currency: "pts", type: "index", provider: "Stooq", providerId: t.toLowerCase() }
    : { ticker: t, error: `${t}: index symbols are ^ plus letters/digits` };
  const m = /^([A-Z0-9-]+?)(?:\.([A-Z]{2}))?$/.exec(t.replace(/\.([A-Z])$/, "-$1")); // class shares: BRK.B → BRK-B
  if (!m) return { ticker: t, error: `${t}: not a symbol the price provider understands` };
  if (/-/.test(ticker) && !/\.[A-Z]$/i.test(ticker)) return { ticker: t, error: `${t}: crypto/FX pairs aren't supported (stocks, ETFs and indices only); write share classes as BRK.B` };
  const sfx = (m[2] ?? "US").toLowerCase(), mk = MARKETS[sfx];
  if (!mk) return { ticker: t, error: `${t}: market .${sfx.toUpperCase()} isn't supported (supported: ${Object.keys(MARKETS).map((k) => "." + k.toUpperCase()).join(" ")})` };
  return { ticker: t, exchange: mk[0], currency: mk[1], type: "equity/ETF", provider: "Stooq", providerId: `${m[1].toLowerCase()}.${sfx}` };
}
export const currencyOf = (t: string) => { const i = instrument(t); return "error" in i ? null : i.currency; };

export type Fx = { rate: number; at: string; source: string }; // 1 unit of `from` = rate units of the base currency
/** Sum values per currency. A combined total exists only when every foreign currency has an identified FX rate + time. */
export function totalsByCurrency(rows: { currency: string; value: number }[], base = "USD", fx: Record<string, Fx> = {}) {
  const by: Record<string, number> = {};
  for (const r of rows) by[r.currency] = r2((by[r.currency] ?? 0) + r.value);
  const missingFx = Object.keys(by).filter((c) => c !== base && !fx[c]);
  const combined = missingFx.length ? null : r2(Object.entries(by).reduce((s, [c, v]) => s + (c === base ? v : v * fx[c].rate), 0));
  return { byCurrency: by, base, combined, missingFx, fxUsed: Object.keys(by).filter((c) => c !== base && fx[c]).map((c) => ({ currency: c, ...fx[c] })) };
}

/* ---------- MKT03: portfolio accounting ---------- */

export const COST_METHOD = "average cost";
type Px = Record<string, { close: number; date: string } | undefined>;

/** Tracked holdings: a missing price is "unpriced", never zero and never silently valued at cost. Totals per currency, from the
 *  shown rows only (value = Σ shares × price over priced rows), so anyone can re-add them. */
export function portfolioReport(hs: Holding[], px: Px) {
  const rows = hs.map((h) => {
    const q = px[h.ticker], cur = currencyOf(h.ticker) ?? "?", basis = r2(h.shares * h.cost);
    const value = q ? r2(h.shares * q.close) : null;
    return { ...h, currency: cur, basis, price: q?.close ?? null, priceDate: q?.date ?? null, value, unrealized: value === null ? null : r2(value - basis) };
  });
  const priced = rows.filter((r) => r.value !== null);
  return {
    rows, method: COST_METHOD, coverage: { priced: priced.length, total: rows.length, missing: rows.filter((r) => r.value === null).map((r) => r.ticker) },
    value: totalsByCurrency(priced.map((r) => ({ currency: r.currency, value: r.value! }))),
    unrealized: totalsByCurrency(priced.map((r) => ({ currency: r.currency, value: r.unrealized! }))),
    unpricedBasis: totalsByCurrency(rows.filter((r) => r.value === null).map((r) => ({ currency: r.currency, value: r.basis }))),
  };
}

/** Replay paper trades (newest-first as stored) with average cost: realized P/L excludes fees; fees are summed apart. */
export function ledger(trades: Trade[]) {
  const pos: Record<string, { shares: number; cost: number }> = {};
  let realized = 0, fees = 0;
  for (const t of [...trades].reverse()) {
    fees += t.fee ?? 0;
    const p = (pos[t.ticker] ??= { shares: 0, cost: 0 });
    if (t.side === "buy") { p.cost = (p.shares * p.cost + t.qty * t.price) / (p.shares + t.qty); p.shares += t.qty; }
    else { realized += (t.price - p.cost) * Math.min(t.qty, p.shares); p.shares = Math.max(0, p.shares - t.qty); }
  }
  return { realized: r2(realized), fees: r2(fees), method: COST_METHOD };
}

/* ---------- MKT04: alerts ---------- */

export type AlertFire = { at: string; session: string; price: number; text: string };
export type AlertRule = { kind: "above" | "below" | "move"; value: number; armed?: boolean; lastAt?: string; lastSession?: string; history?: AlertFire[] };
export const ALERT_BAND = 0.005, ALERT_COOLDOWN_MS = 6 * 3600_000, ALERT_HISTORY = 20;

/** One evaluation step. Crossing semantics: the first observation only records the side (no fire); a fire needs a cross from the
 *  armed side; re-arming needs the price back beyond the level by ALERT_BAND, so hovering around a threshold can't storm. */
export function stepAlert<A extends AlertRule>(a: A, o: { price: number; changePct: number | null; session: string }, today: string, nowMs: number):
  { alert: A; fired: AlertFire | null; skipped: "stale" | "cooldown" | null } {
  if (isStale(o.session, today)) return { alert: a, fired: null, skipped: "stale" };
  const next: A = { ...a };
  let hit: boolean;
  if (a.kind === "move") {
    hit = o.changePct !== null && Math.abs(o.changePct) >= a.value && a.lastSession !== o.session;
  } else {
    const beyond = a.kind === "above" ? o.price >= a.value : o.price <= a.value;
    const rearm = a.kind === "above" ? o.price < a.value * (1 - ALERT_BAND) : o.price > a.value * (1 + ALERT_BAND);
    if (a.armed === undefined) { next.armed = !beyond; return { alert: next, fired: null, skipped: null }; }
    if (!a.armed) { if (rearm) next.armed = true; return { alert: next, fired: null, skipped: null }; }
    hit = beyond;
  }
  if (!hit) return { alert: next, fired: null, skipped: null };
  if (a.lastAt && nowMs - Date.parse(a.lastAt) < ALERT_COOLDOWN_MS) return { alert: next, fired: null, skipped: "cooldown" };
  const at = new Date(nowMs).toISOString();
  const what = a.kind === "move" ? `${o.changePct! > 0 ? "+" : ""}${o.changePct}% in session ${o.session}` : `crossed ${a.kind} ${a.value} at ${o.price} (session ${o.session})`;
  const fired = { at, session: o.session, price: o.price, text: what };
  if (a.kind !== "move") next.armed = false;
  return { alert: { ...next, lastAt: at, lastSession: o.session, history: [fired, ...(a.history ?? [])].slice(0, ALERT_HISTORY) }, fired, skipped: null };
}
/** Preview: replay the rule over daily closes (one step per bar at that day's close) → sessions it would have fired on. */
export function previewAlert(a: AlertRule, bars: Bar[]): string[] {
  let s: AlertRule = { kind: a.kind, value: a.value };
  const out: string[] = [];
  bars.forEach((b, i) => {
    const chg = i ? r2((b.close / bars[i - 1].close - 1) * 100) : null;
    const r = stepAlert(s, { price: b.close, changePct: chg, session: b.date }, b.date, Date.parse(`${b.date}T21:00:00Z`));
    s = r.alert;
    if (r.fired) out.push(b.date);
  });
  return out;
}

/* ---------- MKT05: research windows ---------- */

/** The exact bars a "last N days" stat covers: first and last date and count (null without data). */
export function statWindow(bars: Bar[], days: number) {
  const c = bars.slice(-(days + 1));
  return c.length < 3 ? null : { from: c[0].date, to: c[c.length - 1].date, returns: c.length - 1 };
}

/* ---------- MKT06: deterministic paper fills ---------- */

export const FILL = { spreadBps: 10, maxSlipBps: 5, feeBps: 5, minFee: 1 } as const;
/** FNV-1a → mulberry32: a reproducible number in [0,1) for (seed, n). */
export function seeded(seed: string, n: number): number {
  let h = 2166136261;
  for (const ch of `${seed}#${n}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let x = (h += 0x6d2b79f5);
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
export type Fill = { close: number; quoteDate: string; spreadBps: number; slipBps: number; price: number; fee: number; n: number };
/** Fill n of an account: buys pay up, sells receive less. */
export function simFill(side: "buy" | "sell", qty: number, close: number, quoteDate: string, seed: string, n: number): Fill {
  const slipBps = r2(seeded(seed, n) * FILL.maxSlipBps), dir = side === "buy" ? 1 : -1;
  const price = Math.round(close * (1 + (dir * (FILL.spreadBps / 2 + slipBps)) / 1e4) * 1e4) / 1e4;
  return { close, quoteDate, spreadBps: FILL.spreadBps, slipBps, price, fee: r2(Math.max(FILL.minFee, (qty * price * FILL.feeBps) / 1e4)), n };
}
/** Replay a list of order inputs from a seed: the check that the same seed gives the same fills. */
export const replayFills = (seed: string, orders: { side: "buy" | "sell"; qty: number; close: number; quoteDate: string }[]) =>
  orders.map((o, n) => simFill(o.side, o.qty, o.close, o.quoteDate, seed, n));
