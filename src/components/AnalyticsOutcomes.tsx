"use client";
// ANALYTICS Outcomes / Reliability / Time & cost views (ANA01/03/04/05). Logic: lib/analytics-outcomes-pure.ts.
// Every headline number opens its records; unknown stays "unknown".
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { linkToHash } from "@/lib/deeplink-pure";
import { METRICS, outcomeRates, pct, reliability, timeAndCost, units, worstFailure, type MetricId, type Rate, type TaskRow, type UsageCostRow } from "@/lib/analytics-outcomes-pure";
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
    </div></>; }}</Wrap>;
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
    <p className="muted text-xs">{t("ana.relNote")}</p></>; }}</Wrap>;
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
