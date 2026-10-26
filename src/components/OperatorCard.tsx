"use client";
// Weekly operator report (B7), shown inside the Sunday weekly review card. Suggestions only open Profile → Autonomy: never change a level.
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import type { OperatorReport } from "@/lib/operator-pure";

const hrs = (m: number) => (m < 60 ? `${m}` : `${Math.round(m / 6) / 10}`);

export function OperatorCard({ r }: { r: OperatorReport }) {
  const max = Math.max(1, ...r.did.map((d) => d.minutes)), m = r.money;
  const stats: [string, string][] = ([
    [String(r.did.reduce((a, d) => a + d.count, 0)), "done alone"], [String(r.approvalsPrepared), "for your OK"],
    [m.views.toLocaleString("en"), "views 48 h"], [String(m.replies + m.pilots + m.paying), "biz replies"],
    [m.credits.toLocaleString("en"), "credits spent"], [String(m.dealsFound), "deals found"],
  ] as [string, string][]).filter(([v]) => v !== "0");
  const openAutonomy = () => dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "profile" } }));
  return (
    <div className="mt-3 grid gap-2" aria-label="Operator report">
      <div className="mc-hero" style={{ minHeight: "5.5rem" }}>
        <span className="mc-hero-k">OPERATOR REPORT · TIME SAVED</span>
        <span className="mc-hero-v num">~{hrs(r.savedMinutes)}<small>{r.savedMinutes < 60 ? " min" : " h"} (conservative)</small></span>
        <span className="mc-hero-t">{r.nights ? `${r.nights} night shift${r.nights === 1 ? "" : "s"} · ` : ""}{r.from} → {r.to}</span>
      </div>
      {stats.length > 0 && <div className="grid grid-cols-3 gap-1.5">{stats.map(([v, k]) => (
        <div key={k} className="rounded border border-white/10 px-2 py-1"><div className="num text-base font-semibold">{v}</div><div className="muted text-[10px] uppercase tracking-wider">{k}</div></div>))}</div>}
      {r.did.length > 0 && <ul className="grid gap-1">{r.did.map((d) => (
        <li key={d.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-xs">
          <span>{d.count} {d.label}</span><span className="muted num">{d.minutes} min</span>
          <span className="col-span-2 h-1 rounded bg-white/10"><span className="block h-1 rounded bg-cyan-400/70" style={{ width: `${(d.minutes / max) * 100}%` }} /></span>
        </li>))}</ul>}
      {r.failed.length > 0 && <div className="text-xs"><span className="mc-hero-k">WHAT FAILED</span>
        <ul className="mt-1 grid gap-0.5">{r.failed.map((f) => <li key={f.cite} title={f.cite}>· {f.what}</li>)}</ul></div>}
      {r.suggest.length > 0 && <div className="mc-news"><span className="mc-hero-k">PERMISSIONS I&apos;D LIKE NEXT</span>
        {r.suggest.map((s) => <p key={s.area} className="text-xs" title={s.cites.join(" ")}><b>{s.label}</b>: {s.from} → {s.to}. {s.why}.</p>)}
        <p className="muted text-[11px]">Only a suggestion: nothing changes unless you change it.</p>
        <button className="chip" onClick={openAutonomy}>Open Profile → Autonomy</button></div>}
    </div>
  );
}
