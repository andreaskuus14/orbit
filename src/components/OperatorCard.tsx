"use client";
// Weekly operator report (B7), shown inside the Sunday weekly review card. Suggestions only open Profile → Autonomy: never change a level.
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import type { OperatorReport } from "@/lib/operator-pure";
import { useT } from "./i18n";

const hrs = (m: number) => (m < 60 ? `${m}` : `${Math.round(m / 6) / 10}`);

export function OperatorCard({ r }: { r: OperatorReport }) {
  const { t } = useT();
  const max = Math.max(1, ...r.did.map((d) => d.minutes)), m = r.money;
  const stats: [string, Parameters<typeof t>[0]][] = ([
    [String(r.did.reduce((a, d) => a + d.count, 0)), "oper.alone"], [String(r.approvalsPrepared), "oper.forOk"],
    [m.views.toLocaleString("en"), "oper.views"], [String(m.replies + m.pilots + m.paying), "oper.biz"],
    [m.credits.toLocaleString("en"), "oper.credits"], [String(m.dealsFound), "oper.deals"],
  ] as [string, Parameters<typeof t>[0]][]).filter(([v]) => v !== "0");
  const openAutonomy = () => dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "profile" } }));
  return (
    <div className="mt-3 grid gap-2" aria-label={t("oper.title")}>
      <div className="mc-hero" style={{ minHeight: "5.5rem" }}>
        <span className="mc-hero-k uppercase">{t("oper.hero")}</span>
        <span className="mc-hero-v num">~{hrs(r.savedMinutes)}<small>{r.savedMinutes < 60 ? " min" : " h"} {t("oper.conservative")}</small></span>
        <span className="mc-hero-t">{r.nights ? `${r.nights === 1 ? t("oper.night1") : t("oper.nights", { n: r.nights })} · ` : ""}{r.from} → {r.to}</span>
      </div>
      {stats.length > 0 && <div className="grid grid-cols-3 gap-1.5">{stats.map(([v, k]) => (
        <div key={k} className="rounded border border-white/10 px-2 py-1"><div className="num text-base font-semibold">{v}</div><div className="muted text-[12px]">{t(k)}</div></div>))}</div>}
      {r.did.length > 0 && <ul className="grid gap-1">{r.did.map((d) => (
        <li key={d.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-xs">
          <span>{d.label} <b className="num">{d.count}</b></span><span className="muted num">{d.minutes} min</span>
          <span className="col-span-2 h-1 rounded bg-white/10"><span className="block h-1 rounded bg-cyan-400/70" style={{ width: `${(d.minutes / max) * 100}%` }} /></span>
        </li>))}</ul>}
      {r.failed.length > 0 && <div className="text-xs"><span className="mc-hero-k uppercase">{t("oper.failed")}</span>
        <ul className="mt-1 grid gap-0.5">{r.failed.map((f) => <li key={f.cite} title={f.cite}>· {f.what}</li>)}</ul></div>}
      {r.suggest.length > 0 && <div className="mc-news"><span className="mc-hero-k uppercase">{t("oper.perms")}</span>
        {r.suggest.map((s) => <p key={s.area} className="text-xs" title={s.cites.join(" ")}><b>{s.label}</b>: {s.from} → {s.to}. {s.why}.</p>)}
        <p className="muted text-[11px]">{t("oper.onlySuggest")}</p>
        <button className="chip" onClick={openAutonomy}>{t("oper.openAuto")}</button></div>}
    </div>
  );
}
