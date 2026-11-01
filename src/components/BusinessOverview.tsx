"use client";
// BUSINESS overview strip (business-overview-pure): actuals, expected, invoices, pipeline, follow-ups, delivery blockers and the
// monthly target. Tap a number to see the records behind it; a record opens its client, task or the Money view.
// A source with no data says so (never 0); one served from an earlier read says when it was read.
import { useCallback, useEffect, useState } from "react";
import { METRICS, type MetricId, type Overview, type Rec } from "@/lib/business-overview-pure";
import { euro } from "@/lib/invoices-pure";
import { useT } from "./i18n";

const MONEY: MetricId[] = ["paid", "expected", "outstanding", "overdue"];

export default function BusinessOverview({ onClient, onMoney }: { onClient: (id: string) => void; onMoney: () => void }) {
  const { t } = useT();
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<MetricId | "">("");
  const [edit, setEdit] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/business/overview", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j: Overview) => { setO(j); setErr(false); }, () => setErr(true)), []);
  useEffect(() => { void load(); }, [load]);

  const saveTarget = (e: React.FormEvent) => {
    e.preventDefault();
    fetch("/api/business/money", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", revenueTarget: edit || 0 }) })
      .then((r) => { if (r.ok) { setEdit(null); void load(); } else setErr(true); }, () => setErr(true));
  };
  const go = (r: Rec) => (r.task ? (location.hash = `#o=operations&k=task&id=${encodeURIComponent(r.task)}`) : r.client ? onClient(r.client) : onMoney());
  if (!o) return err ? <p className="muted text-xs" role="status">{t("bov.title")}: {t("bov.noData")}</p> : null;

  const shown = open ? o[open] : null;
  const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="card !p-2 space-y-1.5" aria-label={t("bov.title")}>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {METRICS.map((k) => {
          const m = o[k], money = MONEY.includes(k), notCash = k === "expected";
          return (
            <button key={k} className={`card !p-1.5 text-left ${notCash ? "border-dashed opacity-80" : ""}`} aria-pressed={open === k} onClick={() => setOpen(open === k ? "" : k)}
              title={m.stale && m.at ? t("bov.updated", { t: time(m.at) }) : undefined}>
              <div className="muted text-[9px] uppercase tracking-widest leading-tight">{t(`bov.${k}` as "bov.paid")}</div>
              <div className={`num text-sm font-semibold ${notCash ? "muted" : k === "overdue" && m.n ? "warn" : ""}`}>
                {m.n === null ? <span className="muted text-[10px] font-normal">{t("bov.noData")}</span> : money ? euro(m.cents ?? 0) : m.n}</div>
              {notCash && <div className="muted text-[9px]">{t("biz.split.notCash")}</div>}
              {m.stale && m.at && <div className="muted text-[9px]">{t("bov.updated", { t: time(m.at) })}</div>}
            </button>);
        })}
      </div>
      {o.target && o.target.pct !== null && (
        <div className="text-xs" aria-label={t("bov.target", { p: o.target.pct, x: euro(o.target.cents) })}>
          <div className="mc-bar" aria-hidden><i style={{ width: `${Math.min(100, o.target.pct)}%` }} /></div>
          <span className="muted">{t("bov.target", { p: o.target.pct, x: euro(o.target.cents) })}</span>{" "}
          <button className="link text-xs" onClick={() => setEdit(String(o.target!.cents / 100))}>{t("bov.setTarget")}</button>
        </div>)}
      {!o.target && edit === null && <button className="link text-xs" onClick={() => setEdit("")}>{t("bov.setTarget")}</button>}
      {edit !== null && (
        <form onSubmit={saveTarget} className="flex items-center gap-1 text-xs">
          <input className="field w-24 py-0.5 text-xs" inputMode="numeric" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} aria-label={t("bov.targetLabel")} placeholder={t("bov.targetLabel")} />
          <button className="chip">{t("bov.save")}</button><button type="button" className="link" onClick={() => setEdit(null)}>{t("common.cancel")}</button>
        </form>)}
      {shown && (shown.n === null ? <p className="muted text-xs">{t("bov.noData")}</p>
        : shown.items.length ? <ul className="text-xs space-y-0.5">{shown.items.map((r, k) => (
          <li key={`${r.id}:${k}`}><button className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => go(r)}>
            <span className="min-w-0 truncate">{r.label}</span>{r.cents !== undefined && <span className="num">{euro(r.cents)}</span>}</button></li>))}</ul>
          : <p className="muted text-xs">{t("biz.split.none")}</p>)}
    </section>
  );
}
