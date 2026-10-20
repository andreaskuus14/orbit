"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkSummary } from "@/lib/work-continuation-pure";

export function ContinueWork({ floating = false, onOpenTask, onOpenGoal }: { floating?: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
  const [data, setData] = useState<WorkSummary | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef<AbortSignal | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    if (inFlight.current && !inFlight.current.aborted) return;
    inFlight.current = signal;
    try {
      const r = await fetch("/api/continue", { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!r.ok) throw new Error("Couldn't load your unfinished work.");
      const next = await r.json() as WorkSummary;
      if (!signal.aborted) { setData(next); setError(""); }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : "Couldn't load your work."); }
    finally { if (inFlight.current === signal) inFlight.current = null; }
  }, []);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController(); controller.current = c;
    const refresh = () => { if (!document.hidden) void load(c.signal); };
    refresh();
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { c.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  return <ContinueWorkView data={data} error={error} floating={floating} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal}
    onRefresh={() => { if (controller.current) void load(controller.current.signal); }} />;
}

export function ContinueWorkView({ data, error = "", floating = false, onOpenTask, onOpenGoal, onRefresh }: {
  data: WorkSummary | null; error?: string; floating?: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void; onRefresh: () => void;
}) {
  return <section className={`continue-work${floating ? " continue-work-float" : ""}`} aria-labelledby="continue-work-title">
    <div className="continue-heading"><h2 id="continue-work-title">Continue my work</h2><button type="button" className="link" onClick={onRefresh}>Refresh</button></div>
    {!data && !error && <p className="muted" role="status">Loading your work…</p>}
    {error && <p className="error" role="alert">{error}{data ? " Showing the last loaded results." : ""}</p>}
    {data?.problems.map((p) => <p key={p} className="error">{p}</p>)}
    {data && !data.items.length && !data.problems.length && <p className="muted">You're caught up. Start with a question or a new goal.</p>}
    {!!data?.items.length && <ul>{data.items.map((item) => <li key={`${item.kind}:${item.id}`}><span><b>{item.title}</b><small>{item.detail}</small></span>
      <button type="button" className="chip" onClick={() => item.kind === "task" ? onOpenTask(item.id) : onOpenGoal(item.id)}>{item.action}</button></li>)}</ul>}
    {!!data?.more && <p className="muted">{data.more} more items in Goals and Operations.</p>}
  </section>;
}
