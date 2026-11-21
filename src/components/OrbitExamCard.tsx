"use client";
import { useEffect, useState } from "react";
import { useT } from "./i18n";

type View = { today: { score: number; passed: number; total: number } | null; lastWeek: { score: number; passed: number; total: number } | null; worse: { id: string; planet: string }[] };
const COPY = {
  en: { title: "ORBIT exam", today: "Today", week: "Last week", loading: "Loading score…", missing: "No completed nightly run yet.", worse: "Tasks that got worse", clear: "No tasks got worse." },
  et: { title: "ORBITi eksam", today: "Täna", week: "Eelmisel nädalal", loading: "Laadin tulemust…", missing: "Lõpetatud öist käivitust veel pole.", worse: "Halvemaks läinud ülesanded", clear: "Ükski ülesanne pole halvemaks läinud." },
};

export function OrbitExamCard() {
  const { lang } = useT(), text = COPY[lang];
  const [view, setView] = useState<View | null>(null);
  useEffect(() => { let alive = true; fetch("/api/core/eval", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((x) => { if (alive && x) setView(x); }).catch(() => {}); return () => { alive = false; }; }, []);
  return <section className="card space-y-2" aria-label={text.title}>
    <h3 className="h3">{text.title}</h3>
    {!view ? <p className="muted text-xs">{text.loading}</p> : <>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {([text.today, text.week] as const).map((label, i) => { const r = i ? view.lastWeek : view.today; return <div key={label} className="rounded-lg border border-white/10 p-2"><span className="muted">{label}</span><strong className="num block text-xl">{r ? `${r.score}%` : "—"}</strong>{r && <span className="muted">{r.passed}/{r.total}</span>}</div>; })}
      </div>
      {!view.today && <p className="muted text-xs">{text.missing}</p>}
      <div className="text-xs"><strong>{text.worse}</strong>{view.worse.length ? <ul className="mt-1 list-inside list-disc">{view.worse.slice(0, 8).map((r) => <li key={r.id}>{r.planet}: {r.id}</li>)}</ul> : <p className="muted mt-1">{text.clear}</p>}</div>
    </>}
  </section>;
}
