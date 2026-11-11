"use client";
import { useCallback, useEffect, useState } from "react";
import StateNote from "./StateNote";
import { MARKETS_TAB } from "@/lib/brief-pure";
import type { Analysis, getMarkets } from "@/lib/markets";
import { NOTE, sparkPath, type Point, type Strategy } from "@/lib/markets-pure";
import { COST_BPS, journalTally, reviewDue, scenarios, type Leg, type Outcome, type Study } from "@/lib/markets-study-pure";
import DealCards from "./DealCards";
import WorkspaceFrame, { useWorkspaceView } from "./WorkspaceFrame";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-pure";
import { localDay } from "@/lib/morning-pure";

// MARKETS drawer: watchlist, tracked portfolio, research, price alerts, PAPER simulation + rule-based paper bot; deals apart.
// Tracking, education and simulation only — no broker, no real money. All data via /api/markets.

type State = Awaited<ReturnType<typeof getMarkets>>;
type Act = (body: object) => Promise<Record<string, unknown> | null>;
const TABS = ["Watchlist", "Portfolio", "Research", "Alerts", "Simulation", "Journal", "Deals"] as const;
type Tab = (typeof TABS)[number];
type Totals = State["portfolio"]["value"];

async function post(body: object): Promise<Record<string, unknown>> {
  const res = await fetch("/api/markets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const money = (n: number | null) => (n === null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }));
const pct = (n: number | null, frac = false) => (n === null ? "—" : `${(frac ? n * 100 : n) > 0 ? "+" : ""}${(frac ? n * 100 : n).toFixed(2)}%`);
const tone = (n: number | null) => (n === null || n === 0 ? undefined : { color: n > 0 ? "#34d399" : "#fb7185" });
const num = (n: number | null, cur: string) => (n === null ? "—" : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cur}`);
const Note = () => <p className="muted text-xs" role="note">⚠️ {NOTE}</p>;

export default function MarketsPanel() {
  const { t: tr } = useT();
  const views = TABS.map((id) => ({ id, label: tr(`mk.tab.${id}`), secondary: id === "Deals" })); // deals are not simulation: kept apart
  const [tab, setTab] = useWorkspaceView<Tab>("markets", views);
  useEffect(() => { // the morning brief's "Open" on a deal lands on Deals
    try { const t = sessionStorage.getItem(MARKETS_TAB); sessionStorage.removeItem(MARKETS_TAB); if ((TABS as readonly string[]).includes(t ?? "")) setTab(t as Tab); } catch { /* first view */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
    <WorkspaceFrame planet="markets" title={tr("planet.markets")} context={tr("mk.context")} views={views} view={tab} onView={setTab}>
      {err ? <StateNote state="failed" what={err} kept={st ? tr("state.keptScreen") : undefined} action={{ label: tr("state.retry"), run: () => void load() }} />
        : !st && <StateNote state="loading" action={{ label: tr("state.retry"), run: () => void load() }} />}
      {st && (
        <>
          {tab === "Watchlist" && <Watchlist st={st} act={act} />}
          {tab === "Portfolio" && <Portfolio st={st} act={act} />}
          {tab === "Research" && <Explain tickers={st.watchlist.map((w) => w.ticker)} />}
          {tab === "Alerts" && <Alerts st={st} act={act} />}
          {tab === "Simulation" && <><Paper st={st} act={act} /><StudyBox strategy={st.bot.strategy} /></>}
          {tab === "Journal" && <Journal st={st} act={act} />}
          {tab === "Deals" && <DealCards />}
        </>
      )}
    </WorkspaceFrame>
  );
}

/** Per-currency totals; one combined figure only when every currency has an FX rate (none are configured, so usually per currency). */
function TotalsLine({ v, u }: { v: Totals; u: Totals }) {
  const { t: tr } = useT();
  return (
    <>
      {Object.entries(v.byCurrency).map(([c, x]) => <p key={c}>{tr("mk.totalIn", { c, v: num(x, c), u: num(u.byCurrency[c] ?? 0, c) })}</p>)}
      {!!v.missingFx.length && <p className="muted text-xs">{tr("mk.noFx", { c: v.missingFx.join(", ") })}</p>}
    </>
  );
}

function TickerForm({ label, onAdd }: { label: string; onAdd: (t: string) => Promise<unknown> }) {
  const [t, setT] = useState("");
  const { t: tr } = useT();
  return (
    <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (t.trim() && (await onAdd(t.trim()))) setT(""); }}>
      <input className="field min-w-0 flex-1" value={t} onChange={(e) => setT(e.target.value)} placeholder={tr("mk.tickerPh")} aria-label={tr("mk.ticker")} maxLength={15} />
      <button className="btn" disabled={!t.trim()}>{label}</button>
    </form>
  );
}

function Spark({ values, label }: { values: number[]; label: string }) {
  const { t: tr } = useT();
  const d = sparkPath(values, 80, 24);
  if (!d) return <span className="muted text-xs">{tr("mk.noChart")}</span>;
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width="80" height="24" viewBox="-1 -1 82 26" role="img" aria-label={label}>
      <path d={d} fill="none" stroke={up ? "#34d399" : "#fb7185"} strokeWidth="1.5" />
    </svg>
  );
}

function Watchlist({ st, act }: { st: State; act: Act }) {
  const { t: tr } = useT();
  return (
    <>
      <TickerForm label={tr("cf.watch")} onAdd={(t) => act({ action: "watch", ticker: t })} />
      <p className="muted text-xs">{tr("mk.source", { n: st.watchlist.length })} {tr("mk.noSubst")}</p>
      {!st.watchlist.length && <p className="muted text-sm">{tr("mk.emptyWatch")}</p>}
      <ul className="space-y-1.5">
        {st.watchlist.map((w) => (
          <li key={w.ticker} className="card flex items-center gap-2 text-sm">
            <span className="w-28"><b>{w.ticker}</b><br /><span className="muted text-[10px]">{"error" in w.instrument ? tr("mk.unsupported", { e: w.instrument.error })
              : tr("mk.ident", { ex: w.instrument.exchange, cur: w.instrument.currency, type: w.instrument.type, prov: w.instrument.provider, id: w.instrument.providerId })}</span></span>
            <Spark values={w.spark} label={`${w.ticker} ${tr("mk.last30")}: ${w.spark.length ? tr("mk.fromTo", { a: w.spark[0], b: w.spark[w.spark.length - 1] }) : tr("mk.noData")}`} />
            <span className="flex-1 text-right">
              {w.price === null ? <span className="muted">{tr("mk.noPrice")}</span> : num(w.price, "error" in w.instrument ? "?" : w.instrument.currency)}<br />
              <span className="text-xs" style={tone(w.changePct)}>{pct(w.changePct)}</span>
              {w.date && (w.failed || w.stale) && <><br /><span className="muted text-xs">{tr("mk.latestClose", { d: w.date })}{w.failed && ` · ${tr("mk.refreshFailed")}`}{w.stale && ` · ${tr("mk.stale")}`}</span></>}
            </span>
            <button className="chip" aria-label={tr("mk.remove", { t: w.ticker })} onClick={() => act({ action: "unwatch", ticker: w.ticker })}>✕</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Portfolio({ st, act }: { st: State; act: Act }) {
  const { t: tr } = useT();
  const [f, setF] = useState({ ticker: "", shares: "", cost: "" });
  const p = st.portfolio;
  return (
    <>
      <p className="muted text-xs">{tr("mk.trackingOnly")}</p>
      <form className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5" onSubmit={async (e) => {
        e.preventDefault();
        if (await act({ action: "holding", ticker: f.ticker.trim(), shares: Number(f.shares), cost: Number(f.cost) })) setF({ ticker: "", shares: "", cost: "" });
      }}>
        <input className="field min-w-0" placeholder={tr("mk.ticker")} aria-label={tr("mk.ticker")} maxLength={15} value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} />
        <input className="field min-w-0" placeholder={tr("mk.shares")} aria-label={tr("mk.shares")} type="number" step="any" min="0" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} />
        <input className="field min-w-0" placeholder={tr("mk.avgCost")} aria-label={tr("mk.avgCostAria")} type="number" step="any" min="0" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
        <button className="btn" disabled={!f.ticker.trim() || !f.shares || f.cost === ""}>{tr("habit.save")}</button>
      </form>
      {!p.rows.length ? <p className="muted text-sm">{tr("mk.noHoldings")}</p> : (
        <>
          <div className="card space-y-0.5 text-sm">
            <TotalsLine v={p.value} u={p.unrealized} />
            <p className="text-xs">{tr("mk.coverage", { a: p.coverage.priced, b: p.coverage.total })}</p>
            {!!p.coverage.missing.length && <p className="text-xs" style={{ color: "#fbbf24" }}>{tr("mk.unpriced", { t: p.coverage.missing.join(", "), v: Object.entries(p.unpricedBasis.byCurrency).map(([c, x]) => num(x, c)).join(" + ") })}</p>}
            <p className="muted text-xs">{tr("mk.formula")} {tr("mk.method")} {tr("mk.corp")}</p>
          </div>
          <ul className="space-y-1.5">
            {p.rows.map((r) => (
              <li key={r.ticker} className="card flex items-center gap-2 text-sm">
                <span className="flex-1"><b>{r.ticker}</b> <span className="muted text-xs">{r.shares} × {r.price === null ? tr("mk.noPrice") : `${num(r.price, r.currency)} (${r.priceDate})`} · {tr("mk.avgCost")} {num(r.cost, r.currency)}</span><br />
                  {num(r.value, r.currency)} {r.unrealized !== null && <span className="text-xs" style={tone(r.unrealized)}>{num(r.unrealized, r.currency)}</span>}</span>
                <button className="chip" aria-label={tr("mk.remove", { t: r.ticker })} onClick={() => act({ action: "removeHolding", ticker: r.ticker })}>✕</button>
              </li>
            ))}
          </ul>
          <Scenarios rows={p.rows} />
        </>
      )}
    </>
  );
}

/** MKT08: what-if arithmetic per currency (not a forecast). */
function Scenarios({ rows }: { rows: State["portfolio"]["rows"] }) {
  const { t: tr } = useT();
  const s = scenarios(rows);
  return (
    <details className="card text-xs"><summary className="cursor-pointer text-sm">{tr("mk.sc.title")}</summary>
      <p className="muted">{tr("mk.sc.note")}</p>
      <table className="w-full"><tbody>{s.shocks.map((x) => <tr key={x.pct}><th className="pr-2 text-left font-normal">{x.pct > 0 ? "+" : ""}{x.pct}%</th>
        <td>{Object.entries(x.change).map(([c, v]) => <span key={c} style={tone(v)}>{num(v, c)} </span>)}</td></tr>)}</tbody></table>
      {Object.entries(s.biggest).map(([c, b]) => <p key={c}>{tr("mk.sc.biggest", { t: b.ticker, s: Math.round(b.share * 100), v: num(b.change, c) })}</p>)}
      {!!s.unpriced.length && <p style={{ color: "#fbbf24" }}>{tr("mk.sc.unpriced", { t: s.unpriced.join(", ") })}</p>}
    </details>
  );
}

/** MKT07: the bot's rule vs equal-weight buy-and-hold on the same history, costs and dates. */
function StudyBox({ strategy }: { strategy: Strategy }) {
  const { t: tr } = useT();
  const [pick, setPick] = useState<Strategy>(strategy === "off" ? "ma" : strategy);
  const [s, setS] = useState<Study | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setS((await post({ action: "study", strategy: pick })) as Study); } catch (e) { setS({ error: (e as Error).message }); } setBusy(false); };
  const row = (name: string, l: Leg) => <tr key={name}><th className="pr-2 text-left font-normal">{name}</th><td style={tone(l.ret)}>{pct(l.ret, true)}</td>
    <td>-{(l.maxDrawdown * 100).toFixed(1)}%</td><td>{(l.turnover * 100).toFixed(0)}%</td><td>{(l.exposure * 100).toFixed(0)}%</td></tr>;
  const table = (label: string, b: Leg, r: Leg) => (
    <div key={label}><p className="mt-1 font-semibold">{label} <span className="muted font-normal">{tr("mk.window", { a: b.from, b: b.to, n: b.days })}</span></p>
      <table className="w-full"><thead><tr><th /><th className="text-left">{tr("mk.return")}</th><th className="text-left">{tr("mk.drawdown")}</th><th className="text-left">{tr("mk.st.turnover")}</th><th className="text-left">{tr("mk.st.exposure")}</th></tr></thead>
        <tbody>{row(tr("mk.st.baseline"), b)}{row(tr("mk.st.rule"), r)}</tbody></table></div>
  );
  return (
    <div className="card space-y-1 text-xs">
      <p className="text-sm font-semibold">{tr("mk.st.title")}</p>
      <p className="muted">{tr("mk.st.how", { c: COST_BPS })}</p>
      <div className="flex gap-2">
        <select className="field flex-1" aria-label={tr("mk.strategy")} value={pick} onChange={(e) => setPick(e.target.value as Strategy)}>
          <option value="ma">{tr("mk.st.ma")}</option><option value="rebalance">{tr("mk.st.rebalance")}</option>
        </select>
        <button className="btn" disabled={busy} onClick={() => void run()}>{tr(busy ? "mk.thinking" : "mk.st.run")}</button>
      </div>
      {s && ("error" in s ? <p className="error" role="alert">{s.error}</p> : (
        <div aria-live="polite">
          {table(tr("mk.st.early"), s.baseline.early, s.rule.early)}
          {s.baseline.late && s.rule.late && table(tr("mk.st.late"), s.baseline.late, s.rule.late)}
          <ul className="muted mt-1 list-disc pl-4">{s.notes.map((n) => <li key={n}>{tr(n as Key, { c: s.costBps })}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

/** MKT08: decisions with the reason, what would prove them wrong and a review date; reviewed by him, not scored by price. */
function Journal({ st, act }: { st: State; act: Act }) {
  const { t: tr } = useT();
  const blank = { ticker: "", decision: "buy", thesis: "", invalidation: "", reviewOn: "" };
  const [f, setF] = useState(blank);
  const today = localDay(new Date()), tally = journalTally(st.journal);
  return (
    <>
      <p className="muted text-xs">{tr("mk.j.hint")}</p>
      <form className="grid gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "journal", ...f })) setF(blank); }}>
        <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
          <input className="field min-w-0" placeholder={tr("mk.ticker")} aria-label={tr("mk.ticker")} maxLength={15} value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} />
          <select className="field" aria-label={tr("mk.j.decision")} value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}>
            {["buy", "sell", "hold", "watch"].map((a) => <option key={a} value={a}>{tr(`mk.j.a.${a}` as Key)}</option>)}
          </select>
          <input className="field" type="date" aria-label={tr("mk.j.reviewOn")} min={today} value={f.reviewOn} onChange={(e) => setF({ ...f, reviewOn: e.target.value })} />
        </div>
        <textarea className="field" rows={2} placeholder={tr("mk.j.thesis")} aria-label={tr("mk.j.thesis")} maxLength={500} value={f.thesis} onChange={(e) => setF({ ...f, thesis: e.target.value })} />
        <input className="field" placeholder={tr("mk.j.invalid")} aria-label={tr("mk.j.invalid")} maxLength={300} value={f.invalidation} onChange={(e) => setF({ ...f, invalidation: e.target.value })} />
        <button className="btn" disabled={!f.ticker.trim() || !f.thesis.trim() || !f.invalidation.trim() || !f.reviewOn}>{tr("habit.save")}</button>
      </form>
      <p className="muted text-xs">{tr("mk.j.tally", { r: tally.reviewed, o: tally.open, right: tally.by.right, wrong: tally.by.wrong, mixed: tally.by.mixed, unclear: tally.by.unclear })}</p>
      <ul className="space-y-1.5">
        {st.journal.map((j) => (
          <li key={j.id} className="card space-y-0.5 text-xs">
            <p className="text-sm"><b>{j.ticker}</b> · {tr(`mk.j.a.${j.action}` as Key)} <span className="muted">{j.at.slice(0, 10)}{j.priceAt !== null && ` @ ${j.priceAt}`}</span></p>
            <p>{j.thesis}</p>
            <p className="muted">{tr("mk.j.wrongIf", { x: j.invalidation })} · {tr("mk.j.reviewBy", { d: j.reviewOn })}</p>
            {j.review ? <p>{tr("mk.j.reviewed", { o: tr(`mk.j.o.${j.review.outcome}` as Key), d: j.review.at.slice(0, 10), p: j.review.priceAt ?? "—" })}{j.review.note && ` · ${j.review.note}`}</p>
              : reviewDue(j, today) && <ReviewRow onReview={(outcome, note) => act({ action: "review", id: j.id, outcome, note })} />}
          </li>
        ))}
      </ul>
    </>
  );
}
function ReviewRow({ onReview }: { onReview: (o: Outcome, note: string) => Promise<unknown> }) {
  const { t: tr } = useT();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1" style={{ color: "#fbbf24" }}>{tr("mk.j.due")}
      <input className="field min-w-0 flex-1" placeholder={tr("mk.j.note")} aria-label={tr("mk.j.note")} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      {(["right", "wrong", "mixed", "unclear"] as Outcome[]).map((o) => <button key={o} className="chip" onClick={() => void onReview(o, note)}>{tr(`mk.j.o.${o}` as Key)}</button>)}
    </div>
  );
}

function Alerts({ st, act }: { st: State; act: Act }) {
  const { t: tr } = useT();
  const [f, setF] = useState({ ticker: "", kind: "above", value: "" });
  return (
    <>
      <p className="muted text-xs">{tr("mk.alertsHint")} {tr("mk.alertRules")}</p>
      <form className="grid grid-cols-[1fr_auto_1fr_auto] gap-1.5" onSubmit={async (e) => {
        e.preventDefault();
        if (await act({ action: "addAlert", ticker: f.ticker.trim(), kind: f.kind, value: Number(f.value) })) setF({ ...f, ticker: "", value: "" });
      }}>
        <input className="field min-w-0" placeholder={tr("mk.ticker")} aria-label={tr("mk.ticker")} maxLength={15} value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} />
        <select className="field" aria-label={tr("mk.alertType")} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="above">{tr("mk.above")}</option><option value="below">{tr("mk.below")}</option><option value="move">{tr("mk.moves")}</option>
        </select>
        <input className="field min-w-0" placeholder={f.kind === "move" ? "%" : tr("mk.price")} aria-label={tr("mk.value")} type="number" step="any" min="0" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        <button className="btn" disabled={!f.ticker.trim() || !f.value}>{tr("common.add")}</button>
      </form>
      {!st.alerts.length && <p className="muted text-sm">{tr("mk.noAlerts")}</p>}
      <ul className="space-y-1.5">
        {st.alerts.map((a) => (
          <li key={a.id} className="card flex items-center gap-2 text-sm">
            <span className="flex-1">🔔 {a.text}{a.firedOn && <span className="muted text-xs">{tr("mk.lastFired", { d: a.firedOn })}</span>}
              {a.kind !== "move" && a.armed !== undefined && <span className="muted text-xs"> · {tr(a.armed ? "mk.armed" : "mk.disarmed")}</span>}
              <br /><span className="muted text-xs">{tr("mk.preview", { n: a.preview.length })}{a.preview.length ? `: ${a.preview.slice(-5).join(", ")}` : ""}</span>
              {!!a.history?.length && <details className="text-xs"><summary className="cursor-pointer">{tr("mk.alertHist", { n: a.history.length })}</summary>
                <ul>{a.history.map((h) => <li key={h.at}>{new Date(h.at).toLocaleString()}: {h.text}</li>)}</ul></details>}</span>
            <button className="chip" aria-label={tr("mk.removeAlert", { t: a.text })} onClick={() => act({ action: "removeAlert", id: a.id })}>✕</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function StatRow({ label, s, w }: { label: string; s: Analysis["stats30"]; w: Analysis["window30"] }) {
  const { t: tr } = useT();
  return (
    <tr><th className="pr-2 text-left font-normal muted">{label}{w && <><br /><span className="text-[10px]">{tr("mk.window", { a: w.from, b: w.to, n: w.returns })}</span></>}</th>
      {s ? <><td style={tone(s.ret)}>{pct(s.ret, true)}</td><td>{(s.vol * 100).toFixed(1)}%</td><td>-{(s.maxDrawdown * 100).toFixed(1)}%</td></> : <td colSpan={3} className="muted">{tr("ss.light.grey")}</td>}
    </tr>
  );
}
function Explain({ tickers }: { tickers: string[] }) {
  const { t: tr } = useT();
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
        <input className="field min-w-0 flex-1" list="mk-tickers" value={t} onChange={(e) => setT(e.target.value)} placeholder={tr("mk.ticker")} aria-label={tr("mk.explainAria")} maxLength={15} />
        <datalist id="mk-tickers">{tickers.map((x) => <option key={x} value={x} />)}</datalist>
        <button className="btn" disabled={busy || !t.trim()}>{tr(busy ? "mk.thinking" : "mk.explain")}</button>
      </form>
      <Note />
      {err && <p className="error" role="alert">{err}</p>}
      {a && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p className="text-xs font-semibold">{tr("mk.numbers")}</p>
          <p><b>{a.ticker}</b> {a.price !== null && <>· {money(a.price)} <span className="muted text-xs">({a.date})</span></>}</p>
          <table className="w-full text-xs">
            <thead><tr><th /><th className="text-left">{tr("mk.return")}</th><th className="text-left">{tr("mk.vol")}</th><th className="text-left">{tr("mk.drawdown")}</th></tr></thead>
            <tbody><StatRow label={tr("mk.days", { n: 30 })} s={a.stats30} w={a.window30} /><StatRow label={tr("mk.days", { n: 180 })} s={a.stats180} w={a.window180} /></tbody>
          </table>
          {!!a.headlines.length && (
            <div>
              <p className="text-xs font-semibold">{tr("mk.news")}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {a.headlines.map((h) => <li key={h.url}><a href={h.url} target="_blank" rel="noopener noreferrer" className="underline">{h.title}</a><span className="muted"> — {h.source ?? "?"}, {h.published ? h.published.slice(0, 10) : "?"}</span></li>)}
              </ul>
            </div>
          )}
          {a.summary ? (
            <div className="card">
              <p className="mb-1 text-xs font-semibold" style={{ color: "#fbbf24" }}>{tr("mk.hypo", { d: new Date(a.at).toLocaleString() })}</p>
              <p className="whitespace-pre-wrap">{a.summary}</p>
            </div>
          ) : a.error && <p className="error">{a.error}</p>}
        </div>
      )}
    </>
  );
}

/** Return-% lines for you, the bot and SPY (from your account's start) over the union of snapshot dates. */
function Curve({ user, bot }: { user: Point[]; bot: Point[] }) {
  const { t: tr } = useT();
  const dates = [...new Set([...user, ...bot].map((p) => p.d))].sort();
  if (dates.length < 2) return <p className="muted text-xs">{tr("mk.curveWait")}</p>;
  const spy0 = user.find((p) => p.spy)?.spy;
  const lines = [
    { name: tr("mk.you"), color: "#22d3ee", pts: user.map((p) => [p.d, (p.eq / 10_000 - 1) * 100] as const) },
    { name: "Bot", color: "#a78bfa", pts: bot.map((p) => [p.d, (p.eq / 10_000 - 1) * 100] as const) },
    { name: "SPY", color: "#9ca3af", pts: spy0 ? user.filter((p) => p.spy).map((p) => [p.d, (p.spy! / spy0 - 1) * 100] as const) : [] },
  ].filter((l) => l.pts.length);
  const ys = lines.flatMap((l) => l.pts.map((p) => p[1])).concat(0), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const W = 360, H = 110, x = (d: string) => (dates.indexOf(d) / (dates.length - 1)) * W, y = (v: number) => H - ((v - lo) / span) * H;
  const last = (l: (typeof lines)[number]) => l.pts[l.pts.length - 1][1];
  return (
    <figure>
      <svg viewBox={`-2 -4 ${W + 4} ${H + 8}`} className="w-full" role="img" aria-label={`${tr("mk.sinceStart")}: ${lines.map((l) => `${l.name} ${last(l).toFixed(2)}%`).join(", ")}`}>
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
  const { t: tr } = useT();
  const [f, setF] = useState({ ticker: "", qty: "" });
  const p = st.paper, b = st.bot;
  const order = async (side: "buy" | "sell") => { if (await act({ action: "order", ticker: f.ticker.trim(), side, qty: Number(f.qty) })) setF({ ticker: "", qty: "" }); };
  const verdict = p.spy === null ? null : tr(p.ret > p.spy ? "mk.ahead" : p.ret < p.spy ? "mk.behind" : "mk.even");
  return (
    <>
      <Note />
      <div className="card text-sm">
        <p className="muted text-xs">{tr("mk.paperFormula", { c: money(p.cash), p: money(p.report.value.byCurrency.USD ?? 0), t: money(p.cash + (p.report.value.byCurrency.USD ?? 0)) })}</p>
        {!!p.report.coverage.missing.length && <p className="text-xs" style={{ color: "#fbbf24" }}>{tr("mk.unpriced", { t: p.report.coverage.missing.join(", "), v: money(p.report.unpricedBasis.byCurrency.USD ?? 0) })}</p>}
        <p className="text-xs">{tr("mk.realized")} <span style={tone(p.realized)}>{money(p.realized)}</span> · {tr("mk.unrealized")} <span style={tone(p.report.unrealized.byCurrency.USD ?? 0)}>{money(p.report.unrealized.byCurrency.USD ?? 0)}</span> · {tr("mk.fees")} {money(p.fees)} · {p.method}</p>
        <p>{tr("mk.paperEquity")} <b>{money(p.equity)}</b> <span style={tone(p.ret)}>({pct(p.ret, true)})</span> · {tr("mk.cash")} {money(p.cash)}</p>
        <p className="text-xs">{tr("mk.spySince", { d: p.started })} <span style={tone(p.spy)}>{pct(p.spy, true)}</span>{verdict && <> · {tr("mk.beat")} <b>{verdict}</b></>}</p>
      </div>
      <form className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5" onSubmit={(e) => { e.preventDefault(); void order("buy"); }}>
        <input className="field min-w-0" placeholder={tr("mk.ticker")} aria-label={tr("mk.ticker")} maxLength={15} value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} />
        <input className="field min-w-0" placeholder={tr("mk.qty")} aria-label={tr("mk.quantity")} type="number" step="any" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        <button className="btn" disabled={!f.ticker.trim() || !f.qty}>{tr("mk.buy")}</button>
        <button type="button" className="btn danger" disabled={!f.ticker.trim() || !f.qty} onClick={() => void order("sell")}>{tr("mk.sell")}</button>
      </form>
      <p className="muted text-xs">{tr("mk.fillRules")} {tr("mk.seed", { s: p.seed })}. {tr("mk.notBroker")}</p>
      {!!p.report.rows.length && (
        <ul className="space-y-1">
          {p.report.rows.map((r) => (
            <li key={r.ticker} className="flex justify-between text-sm"><span><b>{r.ticker}</b> <span className="muted text-xs">{r.shares} @ {money(r.cost)}</span></span>
              <span>{r.value === null ? <span className="muted">{tr("mk.noPrice")}</span> : money(r.value)} <span className="text-xs" style={tone(r.unrealized)}>{r.unrealized === null ? "" : money(r.unrealized)}</span></span></li>
          ))}
        </ul>
      )}
      <Curve user={p.curve} bot={b.curve} />
      {!!p.trades.length && (
        <details><summary className="cursor-pointer text-sm">{tr("mk.history", { n: p.trades.length })} · {tr("mk.notBroker")}</summary>
          <ul className="mt-1 space-y-0.5 text-xs">
            {p.trades.map((t, i) => <li key={`${t.at}-${i}`}>{new Date(t.at).toLocaleString()} {t.side} {t.qty} {t.ticker} @ {money(t.price)}
              {t.fill && <span className="muted"> ({tr("mk.fillLine", { c: t.fill.close, d: t.fill.quoteDate, sp: t.fill.spreadBps, sl: t.fill.slipBps, p: t.price, f: money(t.fee ?? 0) })}, #{t.fill.n})</span>}</li>)}
          </ul>
        </details>
      )}
      <button className="chip" onClick={() => { if (confirm(tr("mk.resetConfirm"))) void act({ action: "resetPaper" }); }}>{tr("mk.reset")}</button>

      <div className="card space-y-2 text-sm">
        <p className="font-semibold">🤖 {tr("mk.bot")} <span className="muted text-xs font-normal">{tr("mk.botSeparate")}</span></p>
        <p className="muted text-xs">{tr("mk.botHint")}</p>
        <select className="field w-full" aria-label={tr("mk.strategy")} value={b.strategy} onChange={(e) => {
          if (confirm(tr("mk.strategyConfirm"))) void act({ action: "strategy", strategy: e.target.value as Strategy });
        }}>
          {(Object.keys(b.strategies) as Strategy[]).map((k) => <option key={k} value={k}>{k === "off" ? tr("mk.off") : b.strategies[k]}</option>)}
        </select>
        {b.strategy !== "off" && (
          <>
            <p>{tr("mk.botEquity")} <b>{money(b.equity)}</b> <span style={tone(b.ret)}>({pct(b.ret, true)})</span> · {tr("mk.spySame")} <span style={tone(b.spy)}>{pct(b.spy, true)}</span></p>
            <p className="muted text-xs">{tr("auto.lastRun")} {b.lastRun ?? tr("mk.notYet")}</p>
            {!!b.log.length && <ul className="space-y-0.5 text-xs">{b.log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </>
        )}
      </div>
    </>
  );
}
