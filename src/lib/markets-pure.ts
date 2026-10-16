// MARKETS workspace rules: Stooq CSV parsing, indicators, P/L, alerts, PAPER order validation and the paper bot's
// rule-based strategies. Pure (no I/O) — tested in tests/markets.test.ts. Tracking/education/paper only: no real money.

export const NOTE = "Simulation / education only — not financial advice. No real money is traded.";
export const START_CASH = 10_000;
export const MAX_WATCH = 40, MAX_HOLDINGS = 40, MAX_ALERTS = 60, MAX_TRADES = 200, MAX_CURVE = 400, HISTORY_ROWS = 180;

export type Quote = { symbol: string; date: string; open: number | null; close: number };
export type Bar = { date: string; close: number };
export type Holding = { ticker: string; shares: number; cost: number };
export type AlertKind = "above" | "below" | "move";
export type Alert = { id: string; ticker: string; kind: AlertKind; value: number; firedOn?: string };
export type Position = { shares: number; cost: number };
export type Trade = { at: string; ticker: string; side: "buy" | "sell"; qty: number; price: number; note?: string };
export type Point = { d: string; eq: number; spy: number | null };
export type Account = { cash: number; positions: Record<string, Position>; trades: Trade[]; curve: Point[]; started: string };
export type Strategy = "off" | "ma" | "rebalance";
export const STRATEGIES: Record<Strategy, string> = {
  off: "Off",
  ma: "Trend: hold watchlist tickers whose 20-day average is above their 50-day average, equal weight; checked daily",
  rebalance: "Equal weight: split equity equally across the watchlist, rebalanced once a month",
};

const TICKER = /^[A-Za-z0-9.^-]{1,15}$/;
/** Upper-cased ticker, or null when invalid. */
export const cleanTicker = (v: unknown): string | null => (typeof v === "string" && TICKER.test(v.trim()) ? v.trim().toUpperCase() : null);
/** Stooq symbol: "AAPL" → "aapl.us", "BRK.B" → "brk-b.us"; a 2-letter market suffix ("VOD.UK") or an index ("^SPX") passes through. */
export function stooqSymbol(t: string): string {
  const s = t.toLowerCase();
  if (s.startsWith("^") || /\.[a-z]{2}$/.test(s)) return s;
  return `${s.replace(/\./g, "-")}.us`;
}
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (s: string | undefined) => { const n = Number(s); return s !== undefined && s.trim() !== "" && Number.isFinite(n) ? n : null; };
const round2 = (n: number) => Math.round(n * 100) / 100;
const floor4 = (n: number) => Math.floor(n * 1e4 + 1e-6) / 1e4;

function rows(csv: string): Record<string, string>[] {
  const lines = String(csv ?? "").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => { const c = l.split(","); return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? "").trim()])); });
}
/** Stooq /q/l/ CSV (Symbol,Date,Time,Open,High,Low,Close,Volume). Unknown symbols ("N/D") and broken rows are skipped. */
export function parseQuotes(csv: string): Quote[] {
  return rows(csv).flatMap((r) => {
    const close = num(r.close), open = num(r.open);
    if (!r.symbol || close === null || close <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) return [];
    return [{ symbol: r.symbol.toLowerCase(), date: r.date, open: open !== null && open > 0 ? open : null, close }];
  });
}
/** Stooq /q/d/l/ daily CSV (Date,Open,High,Low,Close,Volume) → the last HISTORY_ROWS valid bars, oldest first. */
export function parseHistory(csv: string): Bar[] {
  const out = rows(csv).flatMap((r) => {
    const close = num(r.close);
    return close !== null && close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "") ? [{ date: r.date, close }] : [];
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-HISTORY_ROWS);
}

/** Day change %: vs the previous close in history (falls back to the day's open), null when unknown. */
export function dayChange(q: Quote, bars: Bar[]): number | null {
  const prev = [...bars].reverse().find((b) => b.date < q.date);
  const base = prev?.close ?? q.open;
  return base ? round2((q.close / base - 1) * 100) : null;
}

export const sma = (closes: number[], n: number): number | null =>
  closes.length >= n && n > 0 ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null;

/** Stats over the last `days` bars: total return, annualised volatility of daily returns, max drawdown (all as fractions). */
export function stats(bars: Bar[], days: number): { days: number; ret: number; vol: number; maxDrawdown: number } | null {
  const c = bars.slice(-(days + 1)).map((b) => b.close);
  if (c.length < 3) return null;
  const r = c.slice(1).map((x, i) => x / c[i] - 1);
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
  let peak = c[0], dd = 0;
  for (const x of c) { peak = Math.max(peak, x); dd = Math.max(dd, 1 - x / peak); }
  return { days: c.length - 1, ret: c[c.length - 1] / c[0] - 1, vol: sd * Math.sqrt(252), maxDrawdown: dd };
}

/** SVG path for a sparkline in a w×h box ("" with fewer than 2 values). */
export function sparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  return values.map((v, i) => `${i ? "L" : "M"}${round2((i / (values.length - 1)) * w)},${round2(h - ((v - lo) / span) * h)}`).join("");
}

/** Holdings valued at the given prices (missing price → valued at cost, flagged). */
export function valueHoldings(hs: Holding[], prices: Record<string, number>) {
  const list = hs.map((h) => {
    const price = prices[h.ticker] ?? null, value = (price ?? h.cost) * h.shares, basis = h.cost * h.shares;
    return { ...h, price, value: round2(value), pl: round2(value - basis), plPct: basis ? round2((value / basis - 1) * 100) : 0 };
  });
  const value = list.reduce((a, r) => a + r.value, 0), basis = hs.reduce((a, h) => a + h.cost * h.shares, 0);
  return {
    rows: list.map((r) => ({ ...r, weight: value ? round2((r.value / value) * 100) : 0 })),
    value: round2(value), pl: round2(value - basis), plPct: basis ? round2((value / basis - 1) * 100) : 0,
  };
}

export const alertText = (a: Pick<Alert, "ticker" | "kind" | "value">) =>
  a.kind === "above" ? `${a.ticker} above ${a.value}` : a.kind === "below" ? `${a.ticker} below ${a.value}` : `${a.ticker} moves ±${a.value}% in a day`;
export function alertError(kind: unknown, value: unknown): string | null {
  if (kind !== "above" && kind !== "below" && kind !== "move") return "Alert type must be above, below or move";
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > (kind === "move" ? 100 : 1e7)) return kind === "move" ? "Move % must be 0–100" : "Price must be a positive number";
  return null;
}
/** Rules that trigger now and haven't fired today (each fires at most once per day). */
export function evaluateAlerts(alerts: Alert[], data: Record<string, { price: number; changePct: number | null }>, today: string) {
  return alerts.flatMap((a) => {
    const d = data[a.ticker];
    if (!d || a.firedOn === today) return [];
    const hit = a.kind === "above" ? d.price >= a.value : a.kind === "below" ? d.price <= a.value : d.changePct !== null && Math.abs(d.changePct) >= a.value;
    if (!hit) return [];
    const now = a.kind === "move" ? `${d.changePct! > 0 ? "+" : ""}${d.changePct}% today` : `now ${d.price}`;
    return [{ id: a.id, ticker: a.ticker, text: `${alertText(a)} — ${now}` }];
  });
}

export const newAccount = (today: string): Account => ({ cash: START_CASH, positions: {}, trades: [], curve: [], started: today });
/** Cash + positions at the given prices (a position without a price counts at cost). */
export const equity = (a: Account, prices: Record<string, number>) =>
  round2(a.cash + Object.entries(a.positions).reduce((s, [t, p]) => s + p.shares * (prices[t] ?? p.cost), 0));

/** Validate and apply a PAPER market order at `price`; returns a new account or an error. Never touches real money. */
export function applyOrder(a: Account, o: { ticker: string; side: unknown; qty: unknown }, price: number, at: string, note?: string): { account: Account; trade: Trade } | { error: string } {
  if (o.side !== "buy" && o.side !== "sell") return { error: "Side must be buy or sell" };
  if (typeof o.qty !== "number" || !Number.isFinite(o.qty) || o.qty <= 0 || o.qty > 1e6) return { error: "Quantity must be a positive number" };
  const qty = floor4(o.qty);
  if (qty <= 0) return { error: "Quantity is too small (min 0.0001)" };
  if (!Number.isFinite(price) || price <= 0) return { error: `No price for ${o.ticker} right now` };
  const acc: Account = structuredClone(a), pos = acc.positions[o.ticker], value = qty * price;
  if (o.side === "buy") {
    if (value > acc.cash + 1e-9) return { error: `Not enough virtual cash (need $${round2(value)}, have $${acc.cash})` };
    const shares = (pos?.shares ?? 0) + qty;
    acc.positions[o.ticker] = { shares: floor4(shares + 1e-9), cost: ((pos?.shares ?? 0) * (pos?.cost ?? 0) + value) / shares };
    acc.cash = Math.max(0, round2(acc.cash - value));
  } else {
    if (!pos || qty > pos.shares + 1e-9) return { error: `You only hold ${pos?.shares ?? 0} ${o.ticker}` };
    const left = floor4(pos.shares - qty + 1e-9);
    if (left <= 0) delete acc.positions[o.ticker]; else pos.shares = left;
    acc.cash = round2(acc.cash + value);
  }
  const trade: Trade = { at, ticker: o.ticker, side: o.side, qty, price, ...(note ? { note } : {}) };
  acc.trades = [trade, ...acc.trades].slice(0, MAX_TRADES);
  return { account: acc, trade };
}

/** True when every held position has a price (otherwise an equity snapshot would show a fake jump). */
export const allPriced = (a: Account, prices: Record<string, number>) => Object.keys(a.positions).every((t) => prices[t] > 0);
/** Headline text for a prompt: no angle brackets (can't close our <headlines> tag), length-capped. */
export const promptSafe = (s: string | null | undefined, max: number) => String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
/** Upsert today's equity point (one per day). */
export function snapshot(a: Account, today: string, eq: number, spy: number | null): Account {
  const curve = a.curve.filter((p) => p.d !== today);
  return { ...a, curve: [...curve, { d: today, eq, spy }].slice(-MAX_CURVE) };
}
/** Account return vs SPY since the account's first point with a SPY price (fractions; null when unknown). */
export function vsIndex(a: Account): { ret: number; spy: number | null } {
  const first = a.curve.find((p) => p.spy), last = a.curve[a.curve.length - 1];
  return { ret: last ? last.eq / START_CASH - 1 : 0, spy: first?.spy && last?.spy ? last.spy / first.spy - 1 : null };
}

/** True when a watchlist ticker lacks the bars the strategy needs (ma: 50, rebalance: 1): the bot must not act on partial data. */
export const historyMissing = (s: Strategy, tickers: string[], hist: Record<string, Bar[]>) =>
  tickers.some((t) => (hist[t] ?? []).length < (s === "ma" ? 50 : 1));
/** Target weights for today, or null when the strategy doesn't act today. Deterministic and rule-based (no AI). */
export function botTargets(s: Strategy, tickers: string[], hist: Record<string, Bar[]>, lastRebalance: string | undefined, today: string): Record<string, number> | null {
  if (s === "off" || historyMissing(s, tickers, hist)) return null;
  let pick: string[];
  if (s === "ma") {
    pick = tickers.filter((t) => {
      const c = (hist[t] ?? []).map((b) => b.close), fast = sma(c, 20), slow = sma(c, 50);
      return fast !== null && slow !== null && fast > slow;
    });
  } else {
    if (lastRebalance?.slice(0, 7) === today.slice(0, 7)) return null;
    pick = tickers.filter((t) => (hist[t] ?? []).length > 0);
  }
  return Object.fromEntries(pick.map((t) => [t, 1 / pick.length]));
}
/** Orders that move the account to the target weights: sells first, then buys. Drift under 2% of equity is ignored
 *  (except full entries/exits) so the bot doesn't churn every day. */
export function rebalanceOrders(a: Account, targets: Record<string, number>, prices: Record<string, number>) {
  const eq = equity(a, prices), orders: { ticker: string; side: "buy" | "sell"; qty: number }[] = [];
  for (const t of [...new Set([...Object.keys(a.positions), ...Object.keys(targets)])].sort()) {
    const p = prices[t];
    if (!p) continue;
    const have = a.positions[t]?.shares ?? 0, want = floor4(((targets[t] ?? 0) * eq * 0.995) / p), delta = want - have; // 0.5% cash buffer
    if (delta === 0 || (want > 0 && (Math.abs(delta) * p < 1 || (have > 0 && Math.abs(delta) * p < eq * 0.02)))) continue; // exits always sell
    orders.push({ ticker: t, side: delta > 0 ? "buy" : "sell", qty: floor4(Math.abs(delta)) });
  }
  return orders.sort((x, y) => (x.side === y.side ? 0 : x.side === "sell" ? -1 : 1));
}
/** Apply the bot's orders in order; a buy is shrunk to the cash left. Returns the new account and a log line per order. */
export function runOrders(a: Account, orders: { ticker: string; side: "buy" | "sell"; qty: number }[], prices: Record<string, number>, at: string, note: string) {
  let acc = a;
  const log: string[] = [];
  for (const o of orders) {
    const qty = o.side === "buy" ? Math.min(o.qty, floor4(acc.cash / prices[o.ticker])) : o.qty;
    const r = applyOrder(acc, { ...o, qty }, prices[o.ticker], at, note);
    if ("error" in r) { log.push(`skip ${o.side} ${o.ticker}: ${r.error}`); continue; }
    acc = r.account;
    log.push(`${o.side} ${r.trade.qty} ${o.ticker} @ ${prices[o.ticker]}`);
  }
  return { account: acc, log };
}
