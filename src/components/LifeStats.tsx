"use client";
import { useEffect, useState } from "react";
import type { LifeState } from "@/lib/life-pure";
import { bestStreak, todayCount, weekCompletion } from "@/lib/life-stats-pure";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";

// ANALYTICS → LIFE stats: habits today, 7-day completion bars, best streak, focus minutes. Data: GET /api/life.

const day = (k: string, weekday: "narrow" | "long") => new Date(`${k}T12:00:00`).toLocaleDateString("en", { weekday });
const openLife = () => window.dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "life" } }));

export function LifeStats() {
  const [s, setS] = useState<LifeState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/life")
      .then((r) => (r.ok ? (r.json() as Promise<LifeState>) : Promise.reject(r.status)))
      .then((d) => { if (live) setS(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed) return <p className="muted text-xs">LIFE stats unavailable.</p>;
  if (!s) return null;

  if (!s.habits.length)
    return (
      <div className="card flex items-center justify-between gap-2 text-sm">
        <span className="muted">Add habits in LIFE to see stats here</span>
        <button type="button" className="btn" onClick={openLife}>Open LIFE</button>
      </div>
    );

  const t = todayCount(s.habits), best = bestStreak(s.habits), week = weekCompletion(s.habits);
  const label = `Habit completion, last 7 days: ${week.map((d) => `${day(d.date, "long")} ${d.pct == null ? "nothing scheduled" : `${d.pct}%`}`).join(", ")}`;
  const stat = (n: string, l: string) => <div className="card"><div className="text-2xl">{n}</div><div className="muted text-xs">{l}</div></div>;

  return (
    <div className="space-y-2">
      <h3 className="h3">Life</h3>
      <div className="grid grid-cols-2 gap-2">
        {stat(`${t.done}/${t.total}`, "habits done today")}
        {stat(best ? `🔥${best.streak}` : "—", best ? `longest streak · ${best.name}` : "no streak running")}
        {stat(`${s.focus.today} min`, "focus today")}
        {stat(`${s.focus.week} min`, "focus this week")}
      </div>
      <figure className="card m-0">
        <figcaption className="muted mb-1 text-xs">Habits done, last 7 days</figcaption>
        <svg viewBox="0 0 140 48" className="block h-16 w-full" preserveAspectRatio="none" role="img" aria-label={label}>
          <title>{label}</title>
          {week.map((d, i) => {
            const h = d.pct == null ? 0 : Math.max(1, (d.pct / 100) * 46);
            return d.pct == null
              ? <rect key={d.date} x={i * 20 + 4} y={46} width={12} height={2} fill="var(--muted)" opacity={0.35} />
              : <rect key={d.date} x={i * 20 + 4} y={48 - h} width={12} height={h} rx={2} fill="var(--cyan)" opacity={i === 6 ? 1 : 0.7} />;
          })}
        </svg>
        <div className="muted mt-1 grid grid-cols-7 text-center text-[10px]" aria-hidden>
          {week.map((d) => <span key={d.date}>{day(d.date, "narrow")}</span>)}
        </div>
      </figure>
    </div>
  );
}
