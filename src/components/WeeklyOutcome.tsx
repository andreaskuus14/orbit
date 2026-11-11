"use client";
// BUSINESS weekly outcome (outcome-week-pure): views, leads, replies, revenue for the last 7 days, read only. Each number names its
// source and links to it; a source that is not connected says so (never 0, never an estimate).
import { useEffect, useState } from "react";
import { euro } from "@/lib/invoices-pure";
import type { Week, WeekMetric } from "@/lib/outcome-week-pure";
import { useT } from "./i18n";

const KEYS = ["views", "leads", "replies", "revenueCents"] as const;
const LABEL = { views: "wk.views", leads: "wk.leads", replies: "wk.replies", revenueCents: "wk.revenue" } as const;

export default function WeeklyOutcome() {
  const { t } = useT();
  const [w, setW] = useState<Week | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { fetch("/api/business/week", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject()), () => Promise.reject()).then(setW, () => setFailed(true)); }, []);
  if (!w) return failed ? <p className="muted text-xs" role="status">{t("wk.title")}: {t("wk.notConnected")}</p> : null;
  const show = (k: (typeof KEYS)[number], m: WeekMetric) => m.value === null ? null : k === "revenueCents" ? euro(m.value) : m.value;
  return (
    <section className="card !p-2 space-y-1.5" aria-label={t("wk.title")}>
      <div className="muted text-[10px] uppercase tracking-widest">{t("wk.title")} · {t("wk.window", { a: w.start, b: w.end })}</div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {KEYS.map((k) => {
          const m = w[k], v = show(k, m);
          return (
            <div key={k} className="card !p-1.5">
              <div className="muted text-[9px] uppercase tracking-widest leading-tight">{t(LABEL[k])}</div>
              <div className="num text-sm font-semibold">{v === null ? <span className="muted text-[10px] font-normal">{t("wk.notConnected")}</span> : v}</div>
              {"of" in m && m.of && <div className="muted text-[9px]">{m.of}</div>}
              <a className="link text-[9px]" href={m.source.link}>{t("wk.source")}: {m.source.label}</a>
            </div>);
        })}
      </div>
    </section>
  );
}
