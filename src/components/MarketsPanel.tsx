"use client";
import { useCallback, useEffect, useState } from "react";
import { MARKETS_TAB } from "@/lib/brief-pure";
import type { Analysis, getMarkets } from "@/lib/markets";
import { NOTE, sparkPath, type Point, type Strategy } from "@/lib/markets-pure";
import DealCards from "./DealCards";

// MARKETS drawer: watchlist, tracked portfolio, price alerts, AI explainer, PAPER trading + rule-based paper bot.
// Tracking, education and simulation only — no broker, no real money. All data via /api/markets.

type State = Awaited<ReturnType<typeof getMarkets>>;
type Act = (body: object) => Promise<Record<string, unknown> | null>;
const TABS = ["Watchlist", "Portfolio", "Alerts", "Analysis", "Paper", "Deals"] as const;
type Tab = (typeof TABS)[number];

async function post(body: object): Promise<Record<string, unknown>> {
  const res = await fetch("/api/markets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const money = (n: number | null) => (n === null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }));
const pct = (n: number | null, frac = false) => (n === null ? "—" : `${(frac ? n * 100 : n) > 0 ? "+" : ""}${(frac ? n * 100 : n).toFixed(2)}%`);
const tone = (n: number | null) => (n === null || n === 0 ? undefined : { color: n > 0 ? "#34d399" : "#fb7185" });
const Note = () => <p className="muted text-xs" role="note">⚠️ {NOTE}</p>;

export default function MarketsPanel() {
  const [tab, setTab] = useState<Tab>(() => { // the morning brief's "Open" on a deal lands on Deals
    try { const t = sessionStorage.getItem(MARKETS_TAB); sessionStorage.removeItem(MARKETS_TAB); return (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "Watchlist"; } catch { return "Watchlist"; }
  });
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/markets");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setSt(json as State); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act: Act = useCallback(async (body) => {
    try { const r = await post(body); setErr(null); await load(); return r; } catch (e) { setErr((e as Error).message); return null; }
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Markets sections">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="chip" style={tab === t ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {!st ? (!err && <p className="muted text-sm">Loading…</p>) : (
        <div role="tabpanel" aria-label={tab} className="space-y-3">
          {tab === "Watchlist" && <Watchlist st={st} act={act} />}
          {tab === "Portfolio" && <Portfolio st={st} act={act} />}
          {tab === "Alerts" && <Alerts st={st} act={act} />}
          {tab === "Analysis" && <Explain tickers={st.watchlist.map((w) => w.ticker)} />}
          {tab === "Paper" && <Paper st={st} act={act} />}
          {tab === "Deals" && <DealCards />}
        </div>
      )}
    </div>
  );
}

function TickerForm({ label, onAdd }: { label: string; onAdd: (t: string) => Promise<unknown> }) {
  const [t, setT] = useState("");
  return (
    <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (t.trim() && (await onAdd(t.trim()))) setT(""); }}>
      <input className="field min-w-0 flex-1" value={t} onChange={(e) => setT(e.target.value)} placeholder="Ticker, e.g. AAPL or SPY" aria-label="Ticker" maxLength={15} />
      <button className="btn" disabled={!t.trim()}>{label}</button>
    </form>
  );
}

function Spark({ values, label }: { values: number[]; label: string }) {
  const d = sparkPath(values, 80, 24);
  if (!d) return <span className="muted text-xs">no chart</span>;
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width="80" height="24" viewBox="-1 -1 82 26" role="img" aria-label={label}>
      <path d={d} fill="none" stroke={up ? "#34d399" : "#fb7185"} strokeWidth="1.5" />
    </svg>
  );
}

function Watchlist({ st, act }: { st: State; act: Act }) {
  return (
    <>
      <TickerForm label="Watch" onAdd={(t) => act({ action: "watch", ticker: t })} />
      <p className="muted text-xs">US stocks/ETFs via Stooq (delayed). {st.watchlist.length}/40 tickers.</p>
      {!st.watchlist.length && <p className="muted text-sm">Your watchlist is empty.</p>}
      <ul className="space-y-1.5">
        {st.watchlist.map((w) => (
          <li key={w.ticker} className="card flex items-center gap-2 text-sm">
            <span className="w-16 font-semibold">{w.ticker}</span>
            <Spark values={w.spark} label={`${w.ticker} last 30 days: ${w.spark.length ? `from ${w.spark[0]} to ${w.spark[w.spark.length - 1]}` : "no data"}`} />
            <span className="flex-1 text-right">
              {w.price === null ? <span className="muted">no price</span> : money(w.price)}<br />
              <span className="text-xs" style={tone(w.changePct)}>{pct(w.changePct)}</span>
            </span>
            <button className="chip" aria-label={`Remove ${w.ticker}`} onClick={() => act({ action: "unwatch", ticker: w.ticker })}>✕</button>
          </li>
        ))}
      </ul>
    </>
  );
}

const COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#60a5fa"];
function Portfolio({ st, act }: { st: State; act: Act }) {
  const [f, setF] = useState({ ticker: "", shares: "", cost: "" });
  const p = st.portfolio;
  return (
    <>
      <p className="muted text-xs">Tracking only: holdings you enter yourself. No account connections.</p>
      <form className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5" onSubmit={async (e) => {
        e.preventDefault();
        if (await act({ action: "holding", ticker: f.ticker.trim(), shares: Number(f.shares), cost: Number(f.cost) })) setF({ ticker: "", shares: "", cost: "" });
      }}>
        <input className="field min-w-0" placeholder="Ticker" aria-label="Ticker" maxLength={15} value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} />
        <input className="field min-w-0" placeholder="Shares" aria-label="Shares" type="number" step="any" min="0" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} />
        <input className="field min-w-0" placeholder="Avg cost" aria-label="Average cost per share" type="number" step="any" min="0" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
        <button className="btn" disabled={!f.ticker.trim() || !f.shares || f.cost === ""}>Save</button>
      </form>
      {!p.rows.length ? <p className="muted text-sm">No holdings yet.</p> : (
        <>
          <div className="card text-sm">
            Value <b>{money(p.value)}</b> · P/L <span style={tone(p.pl)}>{money(p.pl)} ({pct(p.plPct)})</span>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full" role="img" aria-label={`Allocation: ${p.rows.map((r) => `${r.ticker} ${r.weight}%`).join(", ")}`}>
              {p.rows.map((r, i) => <span key={r.ticker} style={{ width: `${r.weight}%`, background: COLORS[i % COLORS.length] }} title={`${r.ticker} ${r.weight}%`} />)}
            </div>
          </div>
          <ul className="space-y-1.5">
            {p.rows.map((r, i) => (
              <li key={r.ticker} className="card flex items-center gap-2 text-sm">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="flex-1"><b>{r.ticker}</b> <span className="muted text-xs">{r.shares} @ {money(r.cost)} · {r.weight}%</span><br />
                  {money(r.value)} <span className="text-xs" style={tone(r.pl)}>{money(r.pl)} ({pct(r.plPct)})</span>{r.price === null && <span className="muted text-xs"> (no price, at cost)</span>}</span>
                <button className="chip" aria-label={`Remove ${r.ticker}`} onClick={() => act({ action: "removeHolding", ticker: r.ticker })}>✕</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Alerts({ st, act }: { st: State; act: Act }) {
  const [f, setF] = useState({ ticker: "", kind: "above", value: "" });
  return (
    <>
      <p className="muted text-xs">Checked every 5 minutes while ORBIT is open; each rule fires at most once a day.</p>
      <form className="grid grid-cols-[1fr_auto_1fr_auto] gap-1.5" onSubmit={async (e) => {
        e.preventDefault();
        if (await act({ action: "addAlert", ticker: f.ticker.trim(), kind: f.kind, value: Number(f.value) })) setF({ ...f, ticker: "", value: "" });
      }}>
        <input className="field min-w-0" placeholder="Ticker" aria-label="Ticker" maxLength={15} value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} />
        <select className="field" aria-label="Alert type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="above">above $</option><option value="below">below $</option><option value="move">moves ±%</option>
        </select>
        <input className="field min-w-0" placeholder={f.kind === "move" ? "%" : "Price"} aria-label="Value" type="number" step="any" min="0" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        <button className="btn" disabled={!f.ticker.trim() || !f.value}>Add</button>
      </form>
      {!st.alerts.length && <p className="muted text-sm">No alerts yet.</p>}
      <ul className="space-y-1.5">
        {st.alerts.map((a) => (
          <li key={a.id} className="card flex items-center gap-2 text-sm">
            <span className="flex-1">🔔 {a.text}{a.firedOn && <span className="muted text-xs"> · last fired {a.firedOn}</span>}</span>
            <button className="chip" aria-label={`Remove alert ${a.text}`} onClick={() => act({ action: "removeAlert", id: a.id })}>✕</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function StatRow({ label, s }: { label: string; s: Analysis["stats30"] }) {
  return (
    <tr><th className="pr-2 text-left font-normal muted">{label}</th>
      {s ? <><td style={tone(s.ret)}>{pct(s.ret, true)}</td><td>{(s.vol * 100).toFixed(1)}%</td><td>-{(s.maxDrawdown * 100).toFixed(1)}%</td></> : <td colSpan={3} className="muted">not enough data</td>}
    </tr>
  );
}
function Explain({ tickers }: { tickers: string[] }) {
  const [t, setT] = useState(tickers[0] ?? "");
  const [a, setA] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setA((await post({ action: "analyze", ticker: t.trim() })) as unknown as Analysis); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input className="field min-w-0 flex-1" list="mk-tickers" value={t} onChange={(e) => setT(e.target.value)} placeholder="Ticker" aria-label="Ticker to explain" maxLength={15} />
        <datalist id="mk-tickers">{tickers.map((x) => <option key={x} value={x} />)}</datalist>
        <button className="btn" disabled={busy || !t.trim()}>{busy ? "Thinking…" : "Explain this stock"}</button>
      </form>
      <Note />
      {err && <p className="error" role="alert">{err}</p>}
      {a && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p><b>{a.ticker}</b> {a.price !== null && <>· {money(a.price)} <span className="muted text-xs">({a.date})</span></>}</p>
          <table className="w-full text-xs">
            <thead><tr><th /><th className="text-left">Return</th><th className="text-left">Volatility (ann.)</th><th className="text-left">Max drawdown</th></tr></thead>
            <tbody><StatRow label="30 days" s={a.stats30} /><StatRow label="180 days" s={a.stats180} /></tbody>
          </table>
          {a.summary ? (
            <div className="card">
              <p className="mb-1 text-xs font-semibold" style={{ color: "#fbbf24" }}>AI summary, not advice</p>
              <p className="whitespace-pre-wrap">{a.summary}</p>
            </div>
          ) : a.error && <p className="error">{a.error}</p>}
          {!!a.headlines.length && (
            <div>
              <p className="muted text-xs">Headlines (Google News)</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {a.headlines.map((h) => <li key={h.url}><a href={h.url} target="_blank" rel="noopener noreferrer" className="underline">{h.title}</a>{h.source && <span className="muted"> — {h.source}</span>}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Return-% lines for you, the bot and SPY (from your account's start) over the union of snapshot dates. */
function Curve({ user, bot }: { user: Point[]; bot: Point[] }) {
  const dates = [...new Set([...user, ...bot].map((p) => p.d))].sort();
  if (dates.length < 2) return <p className="muted text-xs">The equity curve fills in day by day while ORBIT is open.</p>;
  const spy0 = user.find((p) => p.spy)?.spy;
  const lines = [
    { name: "You", color: "#22d3ee", pts: user.map((p) => [p.d, (p.eq / 10_000 - 1) * 100] as const) },
    { name: "Bot", color: "#a78bfa", pts: bot.map((p) => [p.d, (p.eq / 10_000 - 1) * 100] as const) },
    { name: "SPY", color: "#9ca3af", pts: spy0 ? user.filter((p) => p.spy).map((p) => [p.d, (p.spy! / spy0 - 1) * 100] as const) : [] },
  ].filter((l) => l.pts.length);
  const ys = lines.flatMap((l) => l.pts.map((p) => p[1])).concat(0), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const W = 360, H = 110, x = (d: string) => (dates.indexOf(d) / (dates.length - 1)) * W, y = (v: number) => H - ((v - lo) / span) * H;
  const last = (l: (typeof lines)[number]) => l.pts[l.pts.length - 1][1];
  return (
    <figure>
      <svg viewBox={`-2 -4 ${W + 4} ${H + 8}`} className="w-full" role="img" aria-label={`Return since start: ${lines.map((l) => `${l.name} ${last(l).toFixed(2)}%`).join(", ")}`}>
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
        {lines.map((l) => <polyline key={l.name} fill="none" stroke={l.color} strokeWidth="1.8" points={l.pts.map(([d, v]) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />)}
      </svg>
      <figcaption className="flex gap-3 text-xs">
        {lines.map((l) => <span key={l.name}><span style={{ color: l.color }}>●</span> {l.name} {last(l).toFixed(2)}%</span>)}
      </figcaption>
    </figure>
  );
}

function Paper({ st, act }: { st: State; act: Act }) {
  const [f, setF] = useState({ ticker: "", qty: "" });
  const p = st.paper, b = st.bot;
  const order = async (side: "buy" | "sell") => { if (await act({ action: "order", ticker: f.ticker.trim(), side, qty: Number(f.qty) })) setF({ ticker: "", qty: "" }); };
  const verdict = p.spy === null ? null : p.ret > p.spy ? "Yes — you're ahead of the index so far." : p.ret < p.spy ? "Not yet — SPY is ahead." : "Dead even with SPY.";
  return (
    <>
      <Note />
      <div className="card text-sm">
        <p>Paper equity <b>{money(p.equity)}</b> <span style={tone(p.ret)}>({pct(p.ret, true)})</span> · cash {money(p.cash)}</p>
        <p className="text-xs">SPY since {p.started}: <span style={tone(p.spy)}>{pct(p.spy, true)}</span>{verdict && <> · Did you beat the index? <b>{verdict}</b></>}</p>
      </div>
      <form className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5" onSubmit={(e) => { e.preventDefault(); void order("buy"); }}>
        <input className="field min-w-0" placeholder="Ticker" aria-label="Ticker" maxLength={15} value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} />
        <input className="field min-w-0" placeholder="Qty" aria-label="Quantity" type="number" step="any" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        <button className="btn" disabled={!f.ticker.trim() || !f.qty}>Buy</button>
        <button type="button" className="btn danger" disabled={!f.ticker.trim() || !f.qty} onClick={() => void order("sell")}>Sell</button>
      </form>
      <p className="muted text-xs">Virtual market orders fill at the latest cached (delayed) quote.</p>
      {!!p.positions.rows.length && (
        <ul className="space-y-1">
          {p.positions.rows.map((r) => (
            <li key={r.ticker} className="flex justify-between text-sm"><span><b>{r.ticker}</b> <span className="muted text-xs">{r.shares} @ {money(r.cost)}</span></span>
              <span>{money(r.value)} <span className="text-xs" style={tone(r.pl)}>{pct(r.plPct)}</span></span></li>
          ))}
        </ul>
      )}
      <Curve user={p.curve} bot={b.curve} />
      {!!p.trades.length && (
        <details><summary className="cursor-pointer text-sm">Trade history ({p.trades.length})</summary>
          <ul className="mt-1 space-y-0.5 text-xs">
            {p.trades.map((t, i) => <li key={`${t.at}-${i}`}>{new Date(t.at).toLocaleDateString()} {t.side} {t.qty} {t.ticker} @ {money(t.price)}</li>)}
          </ul>
        </details>
      )}
      <button className="chip" onClick={() => { if (confirm("Reset your paper account to $10,000? Trade history is cleared.")) void act({ action: "resetPaper" }); }}>Reset paper account</button>

      <div className="card space-y-2 text-sm">
        <p className="font-semibold">🤖 Paper bot <span className="muted text-xs font-normal">(separate virtual $10,000)</span></p>
        <p className="muted text-xs">Simple transparent rules, not an AI making trades. Runs once a day while ORBIT is open, on your watchlist. Simulation / not financial advice.</p>
        <select className="field w-full" aria-label="Bot strategy" value={b.strategy} onChange={(e) => {
          if (confirm("Changing the strategy restarts the bot's paper account. Continue?")) void act({ action: "strategy", strategy: e.target.value as Strategy });
        }}>
          {(Object.keys(b.strategies) as Strategy[]).map((k) => <option key={k} value={k}>{k === "off" ? "Off" : b.strategies[k]}</option>)}
        </select>
        {b.strategy !== "off" && (
          <>
            <p>Bot equity <b>{money(b.equity)}</b> <span style={tone(b.ret)}>({pct(b.ret, true)})</span> · SPY over the same time <span style={tone(b.spy)}>{pct(b.spy, true)}</span></p>
            <p className="muted text-xs">Last run: {b.lastRun ?? "not yet"}</p>
            {!!b.log.length && <ul className="space-y-0.5 text-xs">{b.log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </>
        )}
      </div>
    </>
  );
}
