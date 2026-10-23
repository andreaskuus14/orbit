"use client";
// Sunday-evening weekly review: shows once on Sunday from 18:00 (and on "weekly review"), read aloud if speech is on.
import { useEffect, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { weeklyDue, type Weekly } from "@/lib/weekly-pure";
import { speakChunk, speechSettings } from "./voice/speak";

const KEY = "orbit.weekly.shown";

export function WeeklyCard({ home }: { home: boolean }) {
  const [w, setW] = useState<Weekly | null>(null);
  const show = async (speak: boolean) => {
    const r = await fetch("/api/weekly", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!r) return;
    setW(r);
    if (speak && speechSettings().speak) for (const s of String(r.spoken).split(/(?<=[.!?])\s+/)) if (s) speakChunk(s);
  };
  useEffect(() => {
    const check = () => {
      let last: string | null = null;
      try { last = localStorage.getItem(KEY); } catch { /* private mode */ }
      const now = new Date();
      if (!weeklyDue(now, last)) return;
      try { localStorage.setItem(KEY, now.toISOString().slice(0, 10)); } catch { /* shown again next tick is fine */ }
      void show(true);
    };
    check();
    const t = setInterval(check, 10 * 60_000);
    const onNav = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.weekly) void show(true); };
    addEventListener(NAV_EVENT, onNav);
    return () => { clearInterval(t); removeEventListener(NAV_EVENT, onNav); };
  }, []);
  if (!w || !home) return null;
  return (
    <section className="glass hud-panel morning-card absolute right-3 top-16 z-20 w-[min(22rem,calc(100vw-1.5rem))] p-4 text-sm" aria-label="Weekly review">
      <div className="mb-2 flex items-center justify-between"><h2 className="hud-title">YOUR WEEK</h2><button className="chip" onClick={() => setW(null)}>Close</button></div>
      {w.best && <div className="mc-hero mb-2"><span className="mc-hero-k">BEST SHORT</span><span className="mc-hero-v num">{w.best.views.toLocaleString()}<small> views</small></span><span className="mc-hero-t">{w.best.title}</span></div>}
      <ul className="grid gap-1.5">{w.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <div className="mc-news mt-3"><span className="mc-hero-k">NEXT WEEK&apos;S EXPERIMENT</span><p>{w.experiment}</p></div>
    </section>
  );
}
