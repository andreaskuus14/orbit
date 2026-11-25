"use client";
// ANALYTICS planet (design language + MIX look): one calm shell. First screen = one answer ("ORBIT saved you about X h"),
// one real timeline (finished tasks per day + AI tokens, precise ticks), Needs you, then three calm cards (outcomes,
// reliability, AI usage), LIFE counts and recent activity. Details live in sheets from the "…" menu.
// Data: one GET /api/analytics/summary?days=7|30 (totalled on the server). The 7/30 choice drives every block.
// Actions: POST /api/analytics (calibrate, experiments, queue), /api/usage-meter (budget), /api/agent-scorecard (run now).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlanetShell, Section, Button, Chip, Row, Card, Empty, Loading, ErrorState, Sheet, toast, uiSound, type MenuItem } from "@/components/ui";
import type { Key } from "@/lib/i18n-core-pure";
import { eventLabel } from "@/lib/event-label-pure";
import { linkToHash } from "@/lib/deeplink-pure";
import type { Days, Item, RateOut, Summary, UsageGroup } from "@/lib/analytics-summary-pure";
import type { FullSummary } from "@/lib/analytics-summary";
import { EXP_METRICS, MIN_EXP, type ExpMetric } from "@/lib/analytics-improve-pure";
import { AbVerdict } from "./AbVerdict";
import { useT } from "./i18n";
import "@/app/analytics-planet.css";

type Data = FullSummary;
type SheetId = "outcomes" | "reliability" | "cost" | "improve" | "usage" | "scorecard" | "speed";
const WF = ["single", "chain", "goal", "mission"] as const;

/** One summary per period, cached so 7 ↔ 30 flips back instantly; the old numbers stay on screen while the new ones load. */
function useSummary(days: Days) {
  const cache = useRef(new Map<Days, Data>());
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState(false), [busy, setBusy] = useState(false), [n, setN] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    const hit = cache.current.get(days);
    if (hit) setD(hit);
    setBusy(true); setErr(false);
    fetch(`/api/analytics/summary?days=${days}`, { cache: "no-store", signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Data>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => { cache.current.set(days, j); setD(j); setBusy(false); })
      .catch(() => { if (!ac.signal.aborted) { setErr(true); setBusy(false); } });
    return () => ac.abort();
  }, [days, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { d, err, busy, reload };
}

async function post(url: string, body: object) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : String(r.status));
  return j;
}

export function AnalyticsShell({ onClose }: { onClose?: () => void }) {
  const { t, lang } = useT();
  const [days, setDays] = useState<Days>(7);
  const { d, err, busy, reload } = useSummary(days);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const loc = lang === "et" ? "et-EE" : "en-GB";
  const nf = useMemo(() => new Intl.NumberFormat(loc), [loc]);
  const cf = useMemo(() => new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1 }), [loc]);
  const open = (s: SheetId) => { uiSound("sheetOpen"); setSheet(s); };
  const close = () => { uiSound("sheetClose"); setSheet(null); };
  const neededBefore = useRef(-1);

  const needs = useMemo(() => {
    if (!d) return [];
    const out: { key: string; title: string; sub: string; sheet: SheetId }[] = [];
    if (d.models && d.models.below > 0) out.push({ key: "below", title: t("ana.need.below", { n: d.models.below }), sub: t("ana.need.belowSub"), sheet: "speed" });
    if (d.meter?.limit) out.push({ key: "limit", title: t("ana.need.limit"), sub: t("ana.need.limitSub"), sheet: "usage" });
    else if (d.meter?.hold) out.push({ key: "hold", title: t("ana.need.hold", { pct: d.meter.level.pct }), sub: t("ana.need.holdSub"), sheet: "usage" });
    const reg = d.scorecard?.cases.filter((c) => c.regressed) ?? [];
    if (reg.length) out.push({ key: "reg", title: t("ana.need.regressed", { n: reg.length }), sub: reg.map((c) => c.title).slice(0, 3).join(", "), sheet: "scorecard" });
    if (d.worst) out.push({ key: "worst", title: t("ana.need.worst", { n: d.worst.items.length }), sub: d.worst.error, sheet: "reliability" });
    return out;
  }, [d, t]);
  useEffect(() => { if (d && neededBefore.current >= 0 && needs.length > neededBefore.current) uiSound("needs"); if (d) neededBefore.current = needs.length; }, [needs.length, d]);

  const menu: MenuItem[] = [
    { label: t("ana.s.outcomes"), onSelect: () => open("outcomes") },
    { label: t("ana.s.reliability"), onSelect: () => open("reliability") },
    { label: t("ana.s.cost"), onSelect: () => open("cost") },
    { label: t("ana.s.improve"), onSelect: () => open("improve") },
    "separator",
    { label: t("ana.s.usage"), onSelect: () => open("usage") },
    { label: t("ana.s.scorecard"), onSelect: () => open("scorecard") },
    { label: t("ana.s.speed"), onSelect: () => open("speed") },
  ];
  const status = d ? t("ana.status", { n: days, f: nf.format(d.outcomes.finished) }) : err ? t("ana.err.title") : t("ana.statusLoading"); // never "Reading…" beside the error card

  const body = (): ReactNode => {
    if (!d && err) return <ErrorState title={t("ana.err.title")} text={t("ana.err.text")} retryLabel={t("ana.retry")} onRetry={reload} />;
    if (!d) return <div className="ana-stack"><Loading rows={2} label={t("ana.loading")} /><div className="ana-chart-skel" aria-hidden="true" /><Loading rows={3} label={t("ana.loading")} /></div>;
    const s = d.saved, metered = d.cost.metered?.usd ?? null;
    return <div className="ana-stack" aria-busy={busy || undefined}>
      {err && <p className="ana-note" role="alert">{t("ana.err.stale")} <button className="ana-link" onClick={reload}>{t("ana.retry")}</button></p>}
      <div className="ana-hero">
        {s ? <>
          <p className="ana-hero-lead">{t("ana.hero.saved", { n: days })}</p>
          <p className="ana-hero-num pu-num">{t("ana.hero.hours", { h: (s.minutes / 60).toLocaleString(loc, { maximumFractionDigits: 1 }) })}</p>
        </> : <>
          <p className="ana-hero-lead">{t("ana.hero.finished", { n: days })}</p>
          <p className="ana-hero-num pu-num">{nf.format(d.outcomes.finished)}</p>
        </>}
        <p className="ana-hero-sub">
          {s ? t("ana.hero.sub", { f: nf.format(d.outcomes.finished) }) : <button className="ana-link" onClick={() => open("improve")}>{t("ana.hero.calibrate")}</button>}
          {" · "}{metered == null ? t("ana.hero.costUnknown") : metered > 0 ? t("ana.hero.cost", { usd: metered.toFixed(2) }) : t("ana.hero.costFlat")}
        </p>
      </div>
      <Timeline d={d} loc={loc} cf={cf} />
      {needs.length > 0 && <Section title={t("ana.needsYou")} count={needs.length} id="ana-needs">
        <div className="ana-cards">{needs.map((x) => <Card key={x.key} tone="needs" title={x.title} sub={x.sub} actions={<Button size="sm" variant="secondary" onClick={() => open(x.sheet)}>{t("ana.look")}</Button>} />)}</div>
      </Section>}
      <Section title={t("ana.results")} id="ana-results">
        <div className="ana-trio">
          <Stat label={t("ana.c.accepted")} value={pctText(d.outcomes.accepted, t)} sub={t("ana.of", { n: d.outcomes.accepted.n, of: d.outcomes.accepted.of })} onClick={() => open("outcomes")} />
          <Stat label={t("ana.c.success")} value={pctText(overall(d), t)} sub={t("ana.of", { n: overall(d).n, of: overall(d).of })} onClick={() => open("reliability")} />
          <Stat label={t("ana.c.calls")} value={d.usage ? cf.format(d.usage.reduce((a, g) => a + g.calls, 0)) : "–"} sub={d.usage ? t("ana.c.tokens", { n: cf.format(d.usage.reduce((a, g) => a + g.tokens, 0)) }) : t("ana.blockErr")} onClick={() => open("usage")} />
        </div>
        {d.usage ? d.usage.length > 0 && <UsageBars groups={d.usage} cf={cf} /> : null}
      </Section>
      <Section title={t("ana.life")} id="ana-life">
        {!d.life ? <ErrorState title={t("ana.lifeErr")} text={t("ana.safe")} retryLabel={t("ana.retry")} onRetry={reload} />
          : !d.life.habits ? <Empty title={t("ana.lifeEmpty")} text={t("ana.lifeEmptyText")} />
          : <LifeBlock l={d.life} loc={loc} />}
      </Section>
      <Section title={t("ana.recent")} id="ana-recent">
        {!d.eventsOk ? <ErrorState title={t("ana.recentErr")} text={t("ana.safe")} retryLabel={t("ana.retry")} onRetry={reload} />
          : !d.events.length ? <Empty title={t("ana.recentEmpty")} text={t("ana.recentEmptyText")} />
          : <div className="ana-rows">{d.events.map((e) => <Row key={e.id} lead={<span className="ana-dot" />} title={evText(e.type, t)} trail={<span className="pu-num">{when(e.at, loc)}</span>} />)}</div>}
      </Section>
      {d.capped && <p className="ana-note">{t("ana.capped")}</p>}
    </div>;
  };

  const sheetTitle: Record<SheetId, Key> = { outcomes: "ana.s.outcomes", reliability: "ana.s.reliability", cost: "ana.s.cost", improve: "ana.s.improve", usage: "ana.s.usage", scorecard: "ana.s.scorecard", speed: "ana.s.speed" };
  return (
    <PlanetShell planet="analytics" title={t("ana.title")} status={status} menu={menu} menuLabel={t("ana.more")} onClose={onClose} closeLabel={t("ana.close")} closeClassName="world-back" className="ana-shell"
      sheet={<Sheet open={!!sheet} title={sheet ? t(sheetTitle[sheet]) : ""} onClose={close} closeLabel={t("ana.close")}>
        {sheet && (!d ? (err ? <ErrorState title={t("ana.err.title")} text={t("ana.err.text")} retryLabel={t("ana.retry")} onRetry={reload} /> : <Loading label={t("ana.loading")} />)
          : <SheetBody id={sheet} d={d} days={days} reload={reload} nf={nf} cf={cf} loc={loc} />)}
      </Sheet>}>
      <div className="ana-period" role="group" aria-label={t("ana.period")}>
        {([7, 30] as const).map((x) => <Chip key={x} pressed={days === x} onClick={() => setDays(x)}>{t("ana.days", { n: x })}</Chip>)}
        {busy && d && <span className="ana-busy" role="status">{t("ana.updating")}</span>}
      </div>
      {body()}
    </PlanetShell>
  );
}

type T = ReturnType<typeof useT>["t"];
const pctText = (r: { pct: number | null }, t: T) => (r.pct == null ? t("ana.unknown") : `${r.pct}%`);
function overall(d: Summary) { const n = d.reliability.reduce((a, r) => a + r.success.n, 0), of = d.reliability.reduce((a, r) => a + r.success.of, 0); return { n, of, pct: of ? Math.round((100 * n) / of) : null }; }
const evText = (type: string, t: T) => { const k = `ana.ev.${type}`; const v = t(k as Key); return v !== k ? v : eventLabel(type).label; };
function when(iso: string, loc: string) {
  const ms = Date.parse(iso), d = new Date(ms), today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(loc, { day: "numeric", month: "short" });
}
const human = (s: string) => { const c = s.replace(/[-_.]+/g, " ").trim(); return c ? c[0].toUpperCase() + c.slice(1) : s; };

function Stat({ label, value, sub, onClick }: { label: string; value: string; sub: string; onClick: () => void }) {
  return <button type="button" className="ana-stat" onClick={onClick}>
    <span className="ana-stat-label">{label}</span><span className="ana-stat-value pu-num">{value}</span><span className="ana-stat-sub">{sub}</span>
  </button>;
}

function areaText(g: Pick<UsageGroup, "area" | "agent">, t: T) { return g.agent ? t("ana.area.agent", { name: g.agent }) : t(`ana.area.${g.area}` as Key); }
/** Top areas by tokens (models merged), as thin hairline bars. */
function UsageBars({ groups, cf }: { groups: UsageGroup[]; cf: Intl.NumberFormat }) {
  const { t } = useT();
  const by = new Map<string, { label: string; tokens: number; calls: number }>();
  for (const g of groups) { const label = areaText(g, t), x = by.get(label) ?? { label, tokens: 0, calls: 0 }; x.tokens += g.tokens; x.calls += g.calls; by.set(label, x); }
  const top = [...by.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 4), max = Math.max(1, ...top.map((x) => x.tokens));
  return <ul className="ana-bars" aria-label={t("ana.c.byArea")}>{top.map((x) => <li key={x.label}>
    <span className="ana-bars-label">{x.label}</span><span className="ana-bars-num pu-num">{cf.format(x.tokens)}</span>
    <span className="ana-bars-track" aria-hidden="true"><span style={{ transform: `scaleX(${x.tokens / max})` }} /></span>
  </li>)}</ul>;
}

/** The advanced layer: a precise daily timeline. Bars = finished tasks (done, failed stacked), line = AI tokens. */
function Timeline({ d, loc, cf }: { d: Summary; loc: string; cf: Intl.NumberFormat }) {
  const { t } = useT();
  const [hover, setHover] = useState<number | null>(null);
  const pts = d.daily, W = 400, H = 132, L = 28, R = 34, TOP = 10, B = 20, iw = W - L - R, ih = H - TOP - B;
  const maxT = Math.max(1, ...pts.map((p) => p.done + p.failed)), maxK = Math.max(1, ...pts.map((p) => p.tokens));
  const nice = (m: number) => { const s = 10 ** Math.floor(Math.log10(m)), f = m / s; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * s; };
  const yT = nice(maxT), yK = nice(maxK), bw = iw / pts.length;
  const y = (v: number, m: number) => TOP + ih - (v / m) * ih;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${(L + bw * i + bw / 2).toFixed(1)},${y(p.tokens, yK).toFixed(1)}`).join("");
  const day = (k: string, o: Intl.DateTimeFormatOptions) => new Date(`${k}T12:00:00`).toLocaleDateString(loc, o);
  const tot = pts.reduce((a, p) => ({ done: a.done + p.done, failed: a.failed + p.failed, tokens: a.tokens + p.tokens }), { done: 0, failed: 0, tokens: 0 });
  const label = t("ana.chart.aria", { n: pts.length, done: tot.done, failed: tot.failed, tokens: cf.format(tot.tokens) });
  const xTicks = pts.length <= 7 ? pts.map((_, i) => i) : [0, 7, 14, 21, pts.length - 1];
  const h = hover == null ? null : pts[hover];
  return <figure className="ana-chart">
    <figcaption className="ana-chart-head">
      <span>{t("ana.chart.title")}</span>
      <span className="ana-legend" aria-hidden="true"><i className="k-done" />{t("ana.chart.done")}<i className="k-failed" />{t("ana.chart.failed")}<i className="k-tok" />{t("ana.chart.tokens")}</span>
    </figcaption>
    <div className="ana-chart-readout pu-num" aria-live="polite">{h ? t("ana.chart.readout", { day: day(h.date, { weekday: "short", day: "numeric", month: "short" }), done: h.done, failed: h.failed, tokens: cf.format(h.tokens) }) : t("ana.chart.total", { done: tot.done, failed: tot.failed, tokens: cf.format(tot.tokens) })}</div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="ana-svg" onPointerLeave={() => setHover(null)}>
      {[0, 0.5, 1].map((f) => <g key={f}>
        <line x1={L} x2={W - R} y1={y(f * yT, yT)} y2={y(f * yT, yT)} className="ana-grid" />
        <text x={L - 6} y={y(f * yT, yT) + 3} className="ana-tick" textAnchor="end">{Math.round(f * yT)}</text>
        <text x={W - R + 6} y={y(f * yK, yK) + 3} className="ana-tick">{cf.format(f * yK)}</text>
      </g>)}
      {pts.map((p, i) => { const x = L + bw * i + bw * 0.18, w = bw * 0.64, hd = (p.done / yT) * ih, hf = (p.failed / yT) * ih;
        return <g key={p.date} onPointerEnter={() => setHover(i)}>
          <rect x={L + bw * i} y={TOP} width={bw} height={ih} fill="transparent" />
          {hd > 0 && <rect x={x} y={TOP + ih - hd} width={w} height={hd} rx={1.5} className="ana-bar" data-on={hover === i || undefined} />}
          {hf > 0 && <rect x={x} y={TOP + ih - hd - hf} width={w} height={hf} rx={1.5} className="ana-bar-bad" />}
        </g>; })}
      <path d={line} className="ana-line" />
      {xTicks.map((i) => pts[i] && <text key={i} x={L + bw * i + bw / 2} y={H - 5} className="ana-tick" textAnchor="middle">{day(pts[i].date, pts.length <= 7 ? { weekday: "short" } : { day: "numeric", month: "short" })}</text>)}
    </svg>
  </figure>;
}

function LifeBlock({ l, loc }: { l: NonNullable<Data["life"]>; loc: string }) {
  const { t } = useT();
  return <div className="ana-life">
    <div className="ana-life-nums">
      <div><span className="ana-stat-value pu-num">{l.today.done}/{l.today.total}</span><span className="ana-stat-sub">{t("ana.l.today")}</span></div>
      <div><span className="ana-stat-value pu-num">{l.best ? l.best.streak : "–"}</span><span className="ana-stat-sub">{l.best ? t("ana.l.streak", { name: l.best.name }) : t("ana.l.noStreak")}</span></div>
      <div><span className="ana-stat-value pu-num">{l.focus.week}</span><span className="ana-stat-sub">{t("ana.l.focus", { n: l.focus.today })}</span></div>
    </div>
    <div className="ana-life-week" role="img" aria-label={t("ana.l.weekAria", { list: l.week.map((w) => `${new Date(`${w.date}T12:00:00`).toLocaleDateString(loc, { weekday: "long" })} ${w.pct == null ? "–" : `${w.pct}%`}`).join(", ") })}>
      {l.week.map((w) => <span key={w.date} className="ana-life-day"><span className="ana-life-bar"><span style={{ transform: `scaleY(${(w.pct ?? 0) / 100})` }} data-none={w.pct == null || undefined} /></span>
        <span className="ana-life-lbl" aria-hidden="true">{new Date(`${w.date}T12:00:00`).toLocaleDateString(loc, { weekday: "narrow" })}</span></span>)}
    </div>
  </div>;
}

function Records({ items }: { items: Item[] }) {
  const { t } = useT();
  if (!items.length) return null;
  return <details className="ana-records"><summary>{t("ana.records", { n: items.length })}</summary>
    <ul>{items.map((i) => <li key={i.id}><a href={linkToHash({ planet: "operations", kind: "task", id: i.id })}>{i.title || t("ana.untitled")}</a> <span className="ana-muted">{i.status ? t(`ana.st.${i.status}` as Key) : ""}</span></li>)}</ul>
  </details>;
}

function RateLine({ label, r, help }: { label: string; r: RateOut; help: string }) {
  const { t } = useT();
  return <div className="ana-rate">
    <div className="ana-rate-top"><span>{label}</span><b className="pu-num">{pctText(r, t)}</b></div>
    <p className="ana-muted">{help} · {t("ana.of", { n: r.n, of: r.of })}</p>
    <Records items={r.items} />
  </div>;
}

function SheetBody({ id, d, days, reload, nf, cf, loc }: { id: SheetId; d: Data; days: Days; reload: () => void; nf: Intl.NumberFormat; cf: Intl.NumberFormat; loc: string }) {
  const { t } = useT();
  if (id === "outcomes") return <div className="ana-stack">
    <p className="ana-muted">{t("ana.o.note", { f: d.outcomes.finished, open: d.outcomes.open, n: days })}</p>
    <RateLine label={t("ana.o.accepted")} r={d.outcomes.accepted} help={t("ana.o.acceptedHelp")} />
    <RateLine label={t("ana.o.autonomous")} r={d.outcomes.autonomous} help={t("ana.o.autonomousHelp")} />
    <RateLine label={t("ana.o.intervention")} r={d.outcomes.intervention} help={t("ana.o.interventionHelp")} />
    <RateLine label={t("ana.o.rework")} r={d.outcomes.rework} help={t("ana.o.reworkHelp")} />
  </div>;
  if (id === "reliability") {
    const cols = ["success", "recovery", "timeout", "stale", "duplicate", "verifyFail"] as const;
    return <div className="ana-stack">
      {d.worst ? <Card tone="needs" title={t("ana.r.worst")} sub={d.worst.error}><Records items={d.worst.items} /></Card> : <Empty title={t("ana.r.noWorst")} />}
      {d.reliability.filter((r) => r.sample).length === 0 ? <Empty title={t("ana.r.none")} text={t("ana.r.noneText")} /> :
        <table className="ana-table" aria-label={t("ana.s.reliability")}>
          <thead><tr><th>{t("ana.r.type")}</th>{cols.map((c) => <th key={c} className="num">{t(`ana.r.${c}` as Key)}</th>)}</tr></thead>
          <tbody>{d.reliability.filter((r) => r.sample).map((r) => <tr key={r.type}><th scope="row">{t(`ana.wf.${r.type}` as Key)} <span className="ana-muted pu-num">{r.sample}</span></th>
            {cols.map((c) => <td key={c} className="num pu-num" title={t("ana.of", { n: r[c].n, of: r[c].of })}>{r[c].pct == null ? "–" : `${r[c].pct}%`}</td>)}</tr>)}</tbody>
        </table>}
      <p className="ana-muted">{t("ana.r.note")}</p>
    </div>;
  }
  if (id === "cost") return <div className="ana-stack">
    <div className="ana-trio ana-duo">
      <div className="ana-stat"><span className="ana-stat-label">{t("ana.k.metered")}</span><span className="ana-stat-value pu-num">{d.cost.metered ? `$${d.cost.metered.usd.toFixed(2)}` : t("ana.unknown")}</span><span className="ana-stat-sub">{d.cost.metered ? t("ana.calls", { n: nf.format(d.cost.metered.calls) }) : t("ana.blockErr")}</span></div>
      <div className="ana-stat"><span className="ana-stat-label">{t("ana.k.flat")}</span><span className="ana-stat-value pu-num">{d.cost.subscription ? cf.format(d.cost.subscription.tokens) : t("ana.unknown")}</span><span className="ana-stat-sub">{d.cost.subscription ? t("ana.k.flatSub", { n: nf.format(d.cost.subscription.calls) }) : t("ana.blockErr")}</span></div>
    </div>
    {!d.cost.projects.length ? <Empty title={t("ana.k.noTasks")} /> :
      <table className="ana-table" aria-label={t("ana.k.table")}>
        <thead><tr><th>{t("ana.k.project")}</th><th className="num">{t("ana.k.minutes")}</th><th className="num">{t("ana.k.accepted")}</th></tr></thead>
        <tbody>{d.cost.projects.map((p, i) => <tr key={`${p.name}-${i}`}><th scope="row">{p.name ?? t("ana.k.noProject")}</th>
          <td className="num pu-num">{p.minutes == null ? t("ana.unknown") : nf.format(p.minutes)}{p.untimed > 0 && <span className="ana-muted"> · {t("ana.k.untimed", { n: p.untimed })}</span>}</td>
          <td className="num pu-num">{p.accepted}/{p.units}</td></tr>)}</tbody>
      </table>}
    <ul className="ana-gaps">{d.cost.gaps.map((g) => <li key={g}>{t(g.replace("ana.gap", "ana.k.gap") as Key)}</li>)}</ul>
  </div>;
  if (id === "improve") return <Improve d={d} reload={reload} />;
  if (id === "usage") return <UsageSheet d={d} reload={reload} cf={cf} nf={nf} />;
  if (id === "scorecard") return <ScorecardSheet d={d} reload={reload} />;
  return <SpeedSheet d={d} loc={loc} />;
}

function Improve({ d, reload }: { d: Data; reload: () => void }) {
  const { t } = useT();
  const c = d.calibration;
  const [f, setF] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(WF.map((w) => [w, c.manual[w] != null ? String(c.manual[w]) : ""])), touch: c.touch != null ? String(c.touch) : "" }));
  const [x, setX] = useState<{ name: string; change: string; metric: ExpMetric }>({ name: "", change: "", metric: "success" });
  const [busy, setBusy] = useState("");
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const act = async (key: string, body: object, done: string) => {
    setBusy(key);
    try { await post("/api/analytics", body); toast({ text: done, tone: "done" }); uiSound("done"); reload(); }
    catch { toast({ text: t("ana.i.failed"), tone: "error" }); uiSound("error"); }
    finally { setBusy(""); }
  };
  if (!d.anaOk) return <ErrorState title={t("ana.i.err")} text={t("ana.safe")} retryLabel={t("ana.retry")} onRetry={reload} />;
  const s = d.saved;
  return <div className="ana-stack">
    <section aria-labelledby="ana-cal">
      <h4 id="ana-cal" className="ana-h">{t("ana.i.cal")}</h4>
      <p className="ana-muted">{s ? t("ana.i.calNow", { h: (s.minutes / 60).toFixed(1) }) : t("ana.i.calNote")}</p>
      {s && s.uncalibrated.length > 0 && <p className="ana-warn">{t("ana.i.missing", { list: s.uncalibrated.map((w) => t(`ana.wf.${w}` as Key)).join(", ") })}</p>}
      <form className="ana-form" onSubmit={(e) => { e.preventDefault(); void act("cal", { action: "calibrate", manual: Object.fromEntries(WF.map((w) => [w, num(f[w])])), touch: num(f.touch) }, t("ana.i.saved")); }}>
        {WF.map((w) => <label key={w}>{t("ana.i.manual", { w: t(`ana.wf.${w}` as Key) })}<input className="ana-input pu-num" type="number" min={0} max={1440} value={f[w]} onChange={(e) => setF({ ...f, [w]: e.target.value })} /></label>)}
        <label>{t("ana.i.touch")}<input className="ana-input pu-num" type="number" min={0} max={1440} value={f.touch} onChange={(e) => setF({ ...f, touch: e.target.value })} /></label>
        <Button type="submit" variant="primary" size="sm" busy={busy === "cal"}>{t("ana.i.save")}</Button>
      </form>
    </section>
    <section aria-labelledby="ana-q">
      <h4 id="ana-q" className="ana-h">{t("ana.i.queue", { w: d.week })}</h4>
      <p className="ana-muted">{t("ana.i.queueNote")}</p>
      {!d.queue.length ? <Empty title={t("ana.i.queueNone")} /> : <div className="ana-cards">{d.queue.map((i) => <Card key={i.key} title={i.title} sub={`${i.objective} · ${t("ana.i.doneWhen", { a: i.acceptance })}`}
        actions={i.sentAt ? <span className="ana-muted">{t("ana.i.sent", { d: i.sentAt.slice(0, 10) })}</span> : <Button size="sm" variant="secondary" busy={busy === i.key} onClick={() => void act(i.key, { action: "queue", item: i }, t("ana.i.sentToast"))}>{t("ana.i.send")}</Button>} />)}</div>}
    </section>
    <section aria-labelledby="ana-x">
      <h4 id="ana-x" className="ana-h">{t("ana.i.exp")}</h4>
      <p className="ana-muted">{t("ana.i.expNote")}</p>
      <form className="ana-form" onSubmit={(e) => { e.preventDefault(); void act("exp", { action: "experiment", ...x }, t("ana.i.started")).then(() => setX({ ...x, name: "", change: "" })); }}>
        <label>{t("ana.i.name")}<input className="ana-input" maxLength={80} value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} /></label>
        <label>{t("ana.i.change")}<input className="ana-input" maxLength={300} value={x.change} onChange={(e) => setX({ ...x, change: e.target.value })} /></label>
        <label>{t("ana.i.metric")}<select className="ana-input" value={x.metric} onChange={(e) => setX({ ...x, metric: e.target.value as ExpMetric })}>{EXP_METRICS.map((m) => <option key={m} value={m}>{t(`ana.m.${m}` as Key)}</option>)}</select></label>
        <Button type="submit" variant="secondary" size="sm" busy={busy === "exp"} disabled={!x.name.trim() || !x.change.trim()}>{t("ana.i.start")}</Button>
      </form>
      <div className="ana-cards">{d.experiments.map((e) => { const r = e.result; return <Card key={e.id} title={e.name} sub={`${e.change} · ${t(`ana.m.${e.metric}` as Key)} · ${e.start.slice(0, 10)}`}
        actions={e.decision ? <span className="ana-muted">{t(`ana.i.dec.${e.decision}` as Key)}</span> : <>{(["keep", "revert", "inconclusive"] as const).map((k) => <Button key={k} size="sm" variant={k === "keep" ? "secondary" : "ghost"} busy={busy === e.id + k} onClick={() => void act(e.id + k, { action: "endExperiment", id: e.id, decision: k }, t(`ana.i.dec.${k}` as Key))}>{t(`ana.i.dec.${k}` as Key)}</Button>)}</>}>
        <p className="ana-muted pu-num">{t("ana.i.result", { b: r.before.pct ?? "–", bn: r.before.of, a: r.after.pct ?? "–", an: r.after.of, d: r.days })} · {r.enough ? t("ana.i.diff", { d: `${r.diff! > 0 ? "+" : ""}${r.diff}` }) : t("ana.i.few", { n: MIN_EXP })} · <AbVerdict verdict={r.verdict} more={r.more} a={t("ana.i.before")} b={t("ana.i.after")} /></p>
      </Card>; })}</div>
    </section>
  </div>;
}

function UsageSheet({ d, reload, cf, nf }: { d: Data; reload: () => void; cf: Intl.NumberFormat; nf: Intl.NumberFormat }) {
  const { t } = useT();
  const m = d.meter;
  const [f, setF] = useState(() => ({ calls5h: String(m?.settings.calls5h ?? ""), tokens5h: String(m?.settings.tokens5h ?? ""), warnPct: String(m?.settings.warnPct ?? "") }));
  const [busy, setBusy] = useState("");
  const save = async (extra: object = {}, key = "save") => {
    setBusy(key);
    try { await post("/api/usage-meter", { ...m?.settings, calls5h: Number(f.calls5h), tokens5h: Number(f.tokens5h), warnPct: Number(f.warnPct), ...extra }); toast({ text: t("ana.u.saved"), tone: "done" }); reload(); }
    catch { toast({ text: t("ana.u.failed"), tone: "error" }); uiSound("error"); }
    finally { setBusy(""); }
  };
  return <div className="ana-stack">
    {!m ? <ErrorState title={t("ana.u.meterErr")} text={t("ana.safe")} retryLabel={t("ana.retry")} onRetry={reload} /> : <section aria-labelledby="ana-u5">
      <h4 id="ana-u5" className="ana-h">{t("ana.u.h5")}</h4>
      <div className="ana-rate-top"><span className="pu-num">{t("ana.u.h5calls", { n: m.h5.calls, of: m.settings.calls5h })}</span><b className="pu-num" data-tone={m.limit ? "bad" : m.level.heavy ? "warn" : undefined}>{m.level.pct}%</b></div>
      <div className="ana-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, m.level.pct)} aria-label={t("ana.u.h5")} data-tone={m.limit ? "bad" : m.level.heavy ? "warn" : undefined}><span style={{ transform: `scaleX(${Math.min(100, m.level.pct) / 100})` }} /></div>
      <p className="ana-muted pu-num">{t("ana.u.h5sub", { tok: cf.format(m.h5.tokens), calls: nf.format(m.d7.calls), tok7: cf.format(m.d7.tokens) })}</p>
      {m.hold && <p className="ana-warn">{t("ana.u.hold")}</p>}
    </section>}
    <section aria-labelledby="ana-ug">
      <h4 id="ana-ug" className="ana-h">{t("ana.u.byArea", { n: d.days })}</h4>
      {!d.usage ? <ErrorState title={t("ana.u.err")} text={t("ana.safe")} retryLabel={t("ana.retry")} onRetry={reload} />
        : !d.usage.length ? <Empty title={t("ana.u.none")} />
        : <table className="ana-table" aria-label={t("ana.u.byArea", { n: d.days })}>
          <thead><tr><th>{t("ana.u.what")}</th><th className="num">{t("ana.u.calls")}</th><th className="num">{t("ana.u.tokens")}</th></tr></thead>
          <tbody>{d.usage.slice(0, 30).map((g, i) => <tr key={i}><th scope="row">{areaText(g, t)}<span className="ana-sub">{g.model}</span></th><td className="num pu-num">{nf.format(g.calls)}</td><td className="num pu-num">{cf.format(g.tokens)}</td></tr>)}</tbody>
        </table>}
      <p className="ana-muted">{t("ana.u.flat")}</p>
    </section>
    {m && <section aria-labelledby="ana-ub">
      <h4 id="ana-ub" className="ana-h">{t("ana.u.budget")}</h4>
      <p className="ana-muted">{t("ana.u.budgetNote")}</p>
      <form className="ana-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>{t("ana.u.calls5h")}<input className="ana-input pu-num" type="number" min={5} max={10000} value={f.calls5h} onChange={(e) => setF({ ...f, calls5h: e.target.value })} /></label>
        <label>{t("ana.u.tokens5h")}<input className="ana-input pu-num" type="number" min={0} value={f.tokens5h} onChange={(e) => setF({ ...f, tokens5h: e.target.value })} /></label>
        <label>{t("ana.u.warn")}<input className="ana-input pu-num" type="number" min={10} max={100} value={f.warnPct} onChange={(e) => setF({ ...f, warnPct: e.target.value })} /></label>
        <div className="ana-actions">
          {m.limit && <Button type="button" size="sm" variant="ghost" busy={busy === "clear"} onClick={() => void save({ clearLimit: true }, "clear")}>{t("ana.u.reset")}</Button>}
          <Button type="submit" size="sm" variant="primary" busy={busy === "save"}>{t("ana.u.save")}</Button>
        </div>
      </form>
    </section>}
  </div>;
}

function ScorecardSheet({ d, reload }: { d: Data; reload: () => void }) {
  const { t } = useT();
  const v = d.scorecard;
  const [busy, setBusy] = useState(false);
  if (!v) return <ErrorState title={t("ana.sc.err")} text={t("ana.safe")} retryLabel={t("ana.retry")} onRetry={reload} />;
  const l = v.latest, fmt = (n: number | null) => (n == null ? "–" : n.toFixed(2));
  const run = async () => {
    setBusy(true);
    try { await post("/api/agent-scorecard", {}); toast({ text: t("ana.sc.started"), tone: "done" }); reload(); }
    catch (e) { toast({ text: t("ana.sc.cant", { why: (e as Error).message }), tone: "error" }); uiSound("error"); }
    finally { setBusy(false); }
  };
  return <div className="ana-stack">
    {l ? <>
      <div className="ana-rate-top"><span>{t("ana.sc.latest", { m: l.month, j: l.judged, n: v.cases.length })}</span><b className="pu-num">{fmt(l.score)} / 2</b></div>
      {l.prevScore != null && l.score != null && <p className="ana-muted pu-num">{t("ana.sc.vs", { d: `${l.score - l.prevScore >= 0 ? "+" : ""}${(l.score - l.prevScore).toFixed(2)}`, m: l.prevMonth ?? "" })}</p>}
      <div className="ana-spark" role="img" aria-label={t("ana.sc.trend", { list: v.trend.map((x) => `${x.month} ${fmt(x.score)}`).join(", ") })}>
        {v.trend.slice(-12).map((x) => <span key={x.month} title={`${x.month}: ${fmt(x.score)}`} data-on={x.month === l.month || undefined} style={{ transform: `scaleY(${Math.max(0.03, (x.score ?? 0) / 2)})` }} />)}
      </div>
      <table className="ana-table" aria-label={t("ana.sc.cases")}>
        <thead><tr><th>{t("ana.sc.case")}</th><th className="num">{t("ana.sc.before")}</th><th className="num">{t("ana.sc.now")}</th></tr></thead>
        <tbody>{v.cases.map((c) => <tr key={c.id} data-bad={c.regressed || undefined}><th scope="row">{c.title}<span className="ana-sub">{c.reason}</span></th><td className="num pu-num">{fmt(c.before)}</td><td className="num pu-num">{c.score == null ? "–" : fmt(c.score)}{c.regressed ? ` ${t("ana.sc.down")}` : ""}</td></tr>)}</tbody>
      </table>
    </> : <Empty title={t("ana.sc.none")} text={t("ana.sc.noneText")} />}
    <div className="ana-actions">
      {v.running ? <span role="status" className="pu-num">{t("ana.sc.running", { d: v.running.done, n: v.running.total })}</span> : <Button variant="secondary" size="sm" busy={busy} onClick={() => void run()}>{t("ana.sc.run")}</Button>}
    </div>
    <p className="ana-muted">{t("ana.sc.cost", { n: v.estimate.maxCalls })}</p>
  </div>;
}

function SpeedSheet({ d, loc }: { d: Data; loc: string }) {
  const { t } = useT();
  const m = d.models, runs = d.perf, latest = runs?.[0];
  return <div className="ana-stack">
    <section aria-labelledby="ana-m">
      <h4 id="ana-m" className="ana-h">{t("ana.sp.models", { n: d.days })}</h4>
      {!m ? <ErrorState title={t("ana.sp.modelsErr")} text={t("ana.safe")} /> : !m.total ? <Empty title={t("ana.sp.noRuns")} /> : <>
        <div className="ana-rows">{m.perModel.map((x) => <Row key={x.name} title={x.name} trail={<span className="pu-num">{x.runs}</span>} />)}</div>
        <p className={m.below ? "ana-warn" : "ana-muted"} role="status">{m.below ? t("ana.need.below", { n: m.below }) : t("ana.sp.ok")}</p>
        {m.risky.length > 0 && <details className="ana-records"><summary>{t("ana.sp.risky", { n: m.risky.length })}</summary>
          <ul>{m.risky.map((r, i) => <li key={`${r.at}-${i}`} data-bad={r.below || undefined}><span className="pu-num ana-muted">{when(r.at, loc)}</span> {t(`ana.kind.${r.kind}` as Key)} · {human(r.job)} · <b>{r.model}</b></li>)}</ul></details>}
      </>}
    </section>
    <section aria-labelledby="ana-p">
      <h4 id="ana-p" className="ana-h">{t("ana.sp.perf")}</h4>
      {!runs ? <ErrorState title={t("ana.sp.perfErr")} text={t("ana.safe")} /> : !latest ? <Empty title={t("ana.sp.noPerf")} text={t("ana.sp.noPerfText")} /> : <>
        <p className="ana-muted">{latest.label} · {new Date(latest.at).toLocaleString(loc)} · {latest.gpu}{latest.hidden ? ` · ${t("ana.sp.hidden")}` : ""}</p>
        <table className="ana-table" aria-label={t("ana.sp.perf")}>
          <thead><tr><th>{t("ana.sp.seg")}</th><th className="num">{"fps"}</th><th className="num">{t("ana.sp.p95")}</th><th className="num">{t("ana.sp.vs")}</th></tr></thead>
          <tbody>{latest.rows.map((r) => <tr key={r.seg} data-bad={r.regressed || undefined}><th scope="row">{human(r.seg)}</th><td className="num pu-num">{r.fps}</td><td className="num pu-num">{r.p95}</td>
            <td className="num pu-num">{r.renderChanged ? t("ana.sp.changed") : r.pct == null ? "–" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}</td></tr>)}</tbody>
        </table>
      </>}
    </section>
  </div>;
}
