"use client";
// ANALYTICS Outcomes / Reliability / Time & cost views (ANA01/03/04/05), time saved (ANA02), experiments (ANA07), weekly queue (ANA08). Logic: lib/analytics-outcomes-pure.ts.
// Every headline number opens its records; unknown stays "unknown".
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { linkToHash } from "@/lib/deeplink-pure";
import { METRICS, outcomeRates, pct, reliability, timeAndCost, units, worstFailure, type MetricId, type Rate, type TaskRow, type UsageCostRow } from "@/lib/analytics-outcomes-pure";
import { EXP_METRICS, MIN_EXP, experimentResult, improvementQueue, isoWeek, timeSaved, type Calibration, type ExpMetric, type Experiment, type Improvement } from "@/lib/analytics-improve-pure";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-pure";

type Data = { rows: TaskRow[]; chains: Set<string>; usage: UsageCostRow[] | null; projects: Map<string, string> };
const COLS = "id, parent_id, project_id, agent, title, status, error, pending, created_at, started_at, finished_at";

export function useOutcomeData(days: number) {
  const sb = useMemo(() => createClient(), []);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setD(null); setErr("");
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    (async () => {
      // shortcut: newest 2000 tasks / 5000 usage rows in the window; page if a window ever holds more.
      const [t, m, u, p] = await Promise.all([
        sb.from("tasks").select(COLS).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
        sb.from("missions").select("chain_id").gte("created_at", since),
        sb.from("usage").select("model, purpose, input_tokens, output_tokens, cost_usd").gte("created_at", since).limit(5000),
        sb.from("projects").select("id, name"),
      ]);
      if (t.error) throw t.error;
      if (live) setD({
        rows: (t.data ?? []) as TaskRow[],
        chains: new Set((m.data ?? []).map((x: { chain_id: string | null }) => x.chain_id).filter(Boolean) as string[]),
        usage: u.error ? null : (u.data as UsageCostRow[]),
        projects: new Map((p.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name])),
      });
    })().catch((e) => { if (live) setErr(e.message ?? "Could not load tasks"); });
    return () => { live = false; };
  }, [sb, days]);
  return { d, err };
}

function Records({ ids, rows }: { ids: string[]; rows: TaskRow[] }) {
  const { t } = useT();
  const by = new Map(rows.map((r) => [r.id, r]));
  return (
    <details><summary className="link text-xs">{t("ana.records", { n: ids.length })}</summary>
      <ul className="mt-1 text-xs space-y-0.5">{ids.slice(0, 50).map((id) => <li key={id}><a className="link" href={linkToHash({ planet: "operations", kind: "task", id })}>{by.get(id)?.title ?? id}</a> <span className="muted">{by.get(id)?.status}</span></li>)}</ul>
    </details>
  );
}

function Def({ id }: { id: MetricId }) {
  const m = METRICS[id];
  return <span title={`${m.formula}\nSource: ${m.source}\nTimezone: ${m.tz} · ${m.cadence}\nExcludes: ${m.exclusions}`} aria-label={m.formula} className="muted cursor-help">ⓘ</span>;
}

function RateCard({ id, r, rows, label }: { id: MetricId; r: Rate; rows: TaskRow[]; label: string }) {
  const { t } = useT();
  const p = pct(r);
  return (
    <div className="card">
      <div className="text-2xl">{p == null ? t("ana.unknown") : `${p}%`}</div>
      <div className="muted text-xs">{label} <Def id={id} /> · {t("ana.of", { n: r.n, of: r.of })}</div>
      {r.of > 0 && <Records ids={r.ids.length ? r.ids : r.all} rows={rows} />}
    </div>
  );
}

const Wrap = ({ d, err, children }: { d: Data | null; err: string; children: (d: Data) => ReactNode }) => {
  const { t } = useT();
  return err ? <p className="error" role="alert">{err}</p> : !d ? <p className="muted" role="status">{t("common.loading")}</p> : <>{children(d)}</>;
};

export function OutcomesView({ days }: { days: number }) {
  const { t } = useT(); const { d, err } = useOutcomeData(days);
  return <Wrap d={d} err={err}>{(d) => { const o = outcomeRates(units(d.rows, d.chains)); return <>
    <p className="muted text-xs">{t("ana.outcomesNote", { finished: o.finished, open: o.open })}</p>
    <div className="grid grid-cols-2 gap-2">
      <RateCard id="accepted" r={o.accepted} rows={d.rows} label={t("ana.accepted")} />
      <RateCard id="autonomous" r={o.autonomous} rows={d.rows} label={t("ana.autonomous")} />
      <RateCard id="intervention" r={o.intervention} rows={d.rows} label={t("ana.intervention")} />
      <RateCard id="rework" r={o.rework} rows={d.rows} label={t("ana.rework")} />
    </div>
    <TimeSaved us={units(d.rows, d.chains)} /></>; }}</Wrap>;
}

const RCOLS = ["success", "recovery", "timeout", "stale", "duplicate", "verifyFail"] as const;
export function ReliabilityView({ days }: { days: number }) {
  const { t } = useT(); const { d, err } = useOutcomeData(days);
  return <Wrap d={d} err={err}>{(d) => { const us = units(d.rows, d.chains), rel = reliability(us), worst = worstFailure(us); return <>
    {worst ? <div className="card"><div className="text-xs muted">{t("ana.worst")}</div><div>{worst.error}</div><Records ids={worst.ids} rows={d.rows} /></div>
      : <p className="muted text-xs">{t("ana.noWorst")}</p>}
    <table className="w-full text-xs" aria-label={t("ana.relTable")}>
      <thead><tr><th className="text-left">{t("ana.type")}</th><th className="text-right">n</th>{RCOLS.map((c) => <th key={c} className="text-right">{t(`ana.r.${c}` as Key)} <Def id={c} /></th>)}</tr></thead>
      <tbody>{rel.map((r) => <tr key={r.type}><td>{t(`ana.wf.${r.type}` as Key)}</td><td className="text-right num">{r.sample}</td>
        {RCOLS.map((c) => { const p = pct(r[c]); return <td key={c} className="text-right num" title={t("ana.of", { n: r[c].n, of: r[c].of })}>
          {p == null ? "–" : <details><summary className="link">{p}% <span className="muted">({r[c].of})</span></summary><Records ids={r[c].ids.length ? r[c].ids : r[c].all} rows={d.rows} /></details>}</td>; })}</tr>)}</tbody>
    </table>
    <p className="muted text-xs">{t("ana.relNote")}</p>
    <Improve us={us} /></>; }}</Wrap>;
}

export function TimeCostView({ days }: { days: number }) {
  const { t } = useT(); const { d, err } = useOutcomeData(days);
  type Sum = { calls: number; tokens: number; usd: number };
  const money = (x: Sum | null, label: string, show: (x: Sum) => string) =>
    <div className="card"><div className="text-2xl">{x ? show(x) : t("ana.unknown")}</div>
      <div className="muted text-xs">{label} <Def id="cost" />{x && ` · ${t("ana.calls", { n: x.calls })}`}</div></div>;
  return <Wrap d={d} err={err}>{(d) => { const c = timeAndCost(units(d.rows, d.chains), d.usage); return <>
    <div className="grid grid-cols-3 gap-2">
      {money(c.metered, t("ana.metered"), (x) => `$${x.usd.toFixed(2)}`)}
      {money(c.subscription, t("ana.subscription"), (x) => t("ana.tokens", { n: x.tokens.toLocaleString() }))}
      <div className="card"><div className="text-2xl">{t("ana.unavailable")}</div><div className="muted text-xs">{t("ana.perProject")} <Def id="cost" /></div></div>
    </div>
    <table className="w-full text-xs" aria-label={t("ana.projTable")}>
      <thead><tr><th className="text-left">{t("ana.project")}</th><th className="text-right">{t("ana.minutes")} <Def id="time" /></th><th className="text-right">{t("ana.acceptedN")}</th><th className="text-right">{t("ana.costCol")}</th></tr></thead>
      <tbody>{c.projects.map((p) => <tr key={p.project ?? "-"}><td>{p.project ? d.projects.get(p.project) ?? p.project : t("ana.noProject")}<Records ids={p.units} rows={d.rows} /></td>
        <td className="text-right num">{p.minutes ?? t("ana.unknown")}{p.untimed.length > 0 && <span className="muted"> ({t("ana.untimed", { n: p.untimed.length })})</span>}</td>
        <td className="text-right num">{p.accepted.length}</td><td className="text-right muted">{t("ana.unavailable")}</td></tr>)}
        {!c.projects.length && <tr><td colSpan={4} className="muted">{t("ana.noTasks")}</td></tr>}</tbody>
    </table>
    <ul className="muted text-xs list-disc pl-4">{c.gaps.map((g) => <li key={g}>{t(g as Key)}</li>)}</ul></>; }}</Wrap>;
}

type Ana = { calibration: Calibration; experiments: Experiment[]; queued: Record<string, string> };
function useAna() {
  const [a, setA] = useState<Ana | null>(null);
  const [err, setErr] = useState("");
  const call = useCallback(async (body?: object) => {
    try {
      const r = await fetch("/api/analytics", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setA(j); setErr("");
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void call(); }, [call]);
  return { a, err, call };
}
type Units = ReturnType<typeof units>;
const WF = ["single", "chain", "goal", "mission"] as const;

/** ANA02: his own minutes per task type and per touch → an estimate, never a measurement. */
function TimeSaved({ us }: { us: Units }) {
  const { t } = useT(); const { a, err, call } = useAna();
  const [f, setF] = useState<Record<string, string> | null>(null);
  if (err) return <p className="error text-xs" role="alert">{err}</p>;
  if (!a) return null;
  const c = a.calibration, r = timeSaved(us, c);
  const form = f ?? { ...Object.fromEntries(WF.map((w) => [w, String(c.manual[w] ?? "")])), touch: String(c.touch ?? "") };
  const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
  return (
    <div className="card space-y-1 text-xs">
      <div className="text-2xl">{r ? t("ana.ts.value", { h: (r.minutes / 60).toFixed(1) }) : t("ana.unknown")}</div>
      <div className="muted">{t("ana.ts.label")}</div>
      {r && <ul>{r.rows.map((x) => <li key={x.type}>{t(`ana.wf.${x.type}` as Key)}: {x.gross === null ? t("ana.ts.noCal") : t("ana.ts.row", { a: x.accepted, m: x.manual ?? 0, g: x.gross, s: x.supervision, k: x.touches })}</li>)}</ul>}
      {r && !!r.uncalibrated.length && <p style={{ color: "#fbbf24" }}>{t("ana.ts.missing", { t: r.uncalibrated.map((w) => t(`ana.wf.${w}` as Key)).join(", ") })}</p>}
      <details><summary className="link">{t("ana.ts.calibrate")}{c.at ? ` · ${c.at.slice(0, 10)}` : ""}</summary>
        <form className="mt-1 grid grid-cols-2 gap-1" onSubmit={(e) => { e.preventDefault(); void call({ action: "calibrate", manual: Object.fromEntries(WF.map((w) => [w, n(form[w])])), touch: n(form.touch) }).then(() => setF(null)); }}>
          {WF.map((w) => <label key={w}>{t("ana.ts.manual", { w: t(`ana.wf.${w}` as Key) })}<input className="field w-full" type="number" min="0" max="1440" value={form[w]} onChange={(e) => setF({ ...form, [w]: e.target.value })} /></label>)}
          <label>{t("ana.ts.touch")}<input className="field w-full" type="number" min="0" max="1440" value={form.touch} onChange={(e) => setF({ ...form, touch: e.target.value })} /></label>
          <button className="btn self-end">{t("habit.save")}</button>
        </form>
      </details>
    </div>
  );
}

/** ANA07 experiments (before/after, not controlled) + ANA08 this week's improvement queue → scoped OPERATIONS proposals. */
function Improve({ us }: { us: Units }) {
  const { t } = useT(); const { a, err, call } = useAna();
  const [f, setF] = useState<{ name: string; change: string; metric: ExpMetric }>({ name: "", change: "", metric: "success" });
  if (err) return <p className="error text-xs" role="alert">{err}</p>;
  if (!a) return null;
  const week = isoWeek(new Date()), queue: Improvement[] = improvementQueue(us, week), now = Date.now();
  return (
    <>
      <div className="card space-y-1 text-xs">
        <b className="text-sm">{t("ana.q.title", { w: week })}</b>
        <p className="muted">{t("ana.q.note")}</p>
        {!queue.length ? <p className="muted">{t("ana.q.none")}</p> : <ul className="space-y-1">{queue.map((i) => (
          <li key={i.key}><b>{i.title}</b><br /><span className="muted">{i.objective} · {t("ana.q.done", { a: i.acceptance })}</span>
            <div>{a.queued[i.key] ? <span className="muted">{t("ana.q.sent", { d: a.queued[i.key].slice(0, 10) })}</span>
              : <button className="chip" onClick={() => void call({ action: "queue", item: i })}>{t("ana.q.send")}</button>}</div></li>
        ))}</ul>}
      </div>
      <div className="card space-y-1 text-xs">
        <b className="text-sm">{t("ana.x.title")}</b>
        <p className="muted">{t("ana.x.note")}</p>
        <form className="grid gap-1" onSubmit={(e) => { e.preventDefault(); void call({ action: "experiment", ...f }).then(() => setF({ ...f, name: "", change: "" })); }}>
          <input className="field" maxLength={80} placeholder={t("ana.x.name")} aria-label={t("ana.x.name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="field" maxLength={300} placeholder={t("ana.x.change")} aria-label={t("ana.x.change")} value={f.change} onChange={(e) => setF({ ...f, change: e.target.value })} />
          <div className="flex gap-1"><select className="field flex-1" aria-label={t("ana.x.metric")} value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as ExpMetric })}>
            {EXP_METRICS.map((m) => <option key={m} value={m}>{METRICS[m].name}</option>)}</select>
            <button className="btn" disabled={!f.name.trim() || !f.change.trim()}>{t("ana.x.start")}</button></div>
        </form>
        <ul className="space-y-1">{a.experiments.map((e) => { const r = experimentResult(e, us, now); return (
          <li key={e.id}><b>{e.name}</b> <span className="muted">· {e.change} · {METRICS[e.metric].name} · {e.start.slice(0, 10)}{e.end ? ` → ${e.end.slice(0, 10)}` : ""}</span><br />
            {t("ana.x.result", { b: r.before.pct ?? "–", bn: r.before.of, a: r.after.pct ?? "–", an: r.after.of, d: r.days })}{" "}
            <span className={r.enough ? "" : "muted"}>{r.enough ? t("ana.x.diff", { d: `${r.diff! > 0 ? "+" : ""}${r.diff}` }) : t("ana.x.few", { n: MIN_EXP })}</span>
            {e.decision ? <span className="muted"> · {t(`ana.x.dec.${e.decision}` as Key)}</span> : (
              <span className="ml-1 inline-flex gap-1">{(["keep", "revert", "inconclusive"] as const).map((dcs) => <button key={dcs} className="chip" onClick={() => void call({ action: "endExperiment", id: e.id, decision: dcs })}>{t(`ana.x.dec.${dcs}` as Key)}</button>)}</span>)}
          </li>); })}</ul>
      </div>
    </>
  );
}
