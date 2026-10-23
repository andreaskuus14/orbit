"use client";
import { useEffect, useState } from "react";
import { useWorldPaused } from "./world-paused";
import type { ShortResult } from "@/lib/clips/learn-pure";

export function ShortsStrip({ shorts, onRestore, restoring }: { shorts: ShortResult[]; onRestore?: (s: ShortResult) => void; restoring?: string }) {
  return (
    <section className="my-3 text-xs" aria-label="Last Shorts">
      <h3 className="hud-title studio-title !text-[0.65rem]">Last Shorts</h3>
      <p className="muted mt-1">24h flop checks · 48h snapshots compared with your channel&apos;s median</p>
      {shorts.length ? <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {shorts.map((s) => <li key={s.videoId} className="card w-44 shrink-0 !p-2">
          <a className="line-clamp-2 underline" href={`https://youtube.com/shorts/${s.videoId}`} target="_blank" rel="noreferrer">{s.title}</a>
          {s.views24 !== undefined && <p className="num mt-1">{s.views24.toLocaleString()} views at 24h{s.flopped24 ? " · flopped (24h)" : ""}</p>}
          {s.views48 !== null ? <p className="num mt-1">{s.views48.toLocaleString()} views at 48h</p> : <p className="muted">48h results pending</p>}
          <p className={s.verdict === "worked" ? "ok" : s.verdict === "flopped" ? "error" : "muted"}>
            {s.changePct === null ? "Waiting for a channel baseline" : `${s.changePct > 0 ? "↑" : s.changePct < 0 ? "↓" : "="} ${Math.abs(s.changePct)}% vs median · ${s.verdict}`}
          </p>
          {s.avgViewPct !== undefined && <p className="muted">{s.avgViewPct}% average viewed</p>}
          {s.retryState && <p>{s.retryState}</p>}
          {s.retryError && <p className="error">{s.retryError} {s.retryError.includes("Reconnect YouTube") && <a className="underline" href="/api/studio/oauth/start">Reconnect YouTube</a>}</p>}
          {s.canRestore && <button className="chip mt-1" disabled={!onRestore || !!restoring} title="Set the original Short public again" onClick={() => onRestore?.(s)}>{restoring === s.videoId ? "Restoring…" : "Restore"}</button>}
        </li>)}
      </ul> : <p className="muted mt-2">Results appear after a published Short reaches 24 hours.</p>}
      <p className="muted mt-1">Captured at 24–30h / 48–54h; missed snapshots stay empty. Analytics may lag. Viewed vs swiped away isn&apos;t available from the API.</p>
    </section>
  );
}

export default function LastShorts() {
  const [shorts, setShorts] = useState<ShortResult[] | null>(null);
  const [err, setErr] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [restoring, setRestoring] = useState("");
  const restore = async (s: ShortResult) => {
    setRestoring(s.videoId); setErr("");
    try {
      const r = await fetch(`/api/studio/clips/${encodeURIComponent(s.jobId!)}/${encodeURIComponent(s.clipId!)}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId: s.videoId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't restore the original");
      setRefresh((n) => n + 1);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't restore the original"); }
    finally { setRestoring(""); }
  };
  const paused = useWorldPaused();
  useEffect(() => {
    if (paused) return; // STUDIO kept but hidden: no 15-min poll; returning refreshes
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
  }, [refresh, paused]);
  return <>
    {shorts && <ShortsStrip shorts={shorts} onRestore={(s) => void restore(s)} restoring={restoring} />}
    {!shorts && !err && <p className="muted text-xs" role="status">Loading Last Shorts…</p>}
    {err && <p className="error text-xs" role="alert">{err}</p>}
    {!!warnings.length && <p className="muted text-xs">{warnings.join(" · ")}</p>}
  </>;
}
