"use client";
import { useEffect, useState } from "react";
import type { ShortResult } from "@/lib/clips/learn-pure";

export function ShortsStrip({ shorts }: { shorts: ShortResult[] }) {
  return (
    <section className="my-3 text-xs" aria-label="Last Shorts">
      <h3 className="hud-title studio-title !text-[0.65rem]">Last Shorts</h3>
      <p className="muted mt-1">48h snapshots · compared with your channel&apos;s 48h median</p>
      {shorts.length ? <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {shorts.map((s) => <li key={s.videoId} className="card w-44 shrink-0 !p-2">
          <a className="line-clamp-2 underline" href={`https://youtube.com/shorts/${s.videoId}`} target="_blank" rel="noreferrer">{s.title}</a>
          <p className="num mt-1">{s.views48.toLocaleString()} views at 48h</p>
          <p className={s.verdict === "worked" ? "ok" : s.verdict === "flopped" ? "error" : "muted"}>
            {s.changePct === null ? "Waiting for a channel baseline" : `${s.changePct > 0 ? "↑" : s.changePct < 0 ? "↓" : "="} ${Math.abs(s.changePct)}% vs median · ${s.verdict}`}
          </p>
          {s.avgViewPct !== undefined && <p className="muted">{s.avgViewPct}% average viewed</p>}
        </li>)}
      </ul> : <p className="muted mt-2">Results appear after a published Short reaches 48 hours.</p>}
      <p className="muted mt-1">Captured between 48–54h; missed snapshots stay empty. Analytics may lag. Viewed vs swiped away isn&apos;t available from the API.</p>
    </section>
  );
}

export default function LastShorts() {
  const [shorts, setShorts] = useState<ShortResult[] | null>(null);
  const [err, setErr] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await fetch("/api/studio/analytics?results=1", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Couldn't load Short results");
        if (active) { setShorts(j.shorts); setWarnings(j.warnings ?? []); setErr(""); }
      } catch (e) { if (active) setErr(e instanceof Error ? e.message : "Couldn't load Short results"); }
    };
    void load();
    const timer = setInterval(() => void load(), 15 * 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <>
    {shorts && <ShortsStrip shorts={shorts} />}
    {!shorts && !err && <p className="muted text-xs" role="status">Loading Last Shorts…</p>}
    {err && <p className="error text-xs" role="alert">{err}</p>}
    {!!warnings.length && <p className="muted text-xs">{warnings.join(" · ")}</p>}
  </>;
}
