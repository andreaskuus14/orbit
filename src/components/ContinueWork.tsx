"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { WorkSummary } from "@/lib/work-continuation-pure";

export function ContinueWork({ floating = false, onOpenTask, onOpenGoal }: { floating?: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
  const [data, setData] = useState<WorkSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const inFlight = useRef<AbortSignal | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    if (inFlight.current && !inFlight.current.aborted) return;
    inFlight.current = signal;
    setLoading(true);
    try {
      const r = await fetch("/api/continue", { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!r.ok) throw new Error("Couldn't load your unfinished work.");
      const next = await r.json() as WorkSummary;
      if (!signal.aborted) { setData(next); setError(""); setUpdatedAt(new Date()); }
    } catch { if (!signal.aborted) setError("Couldn't refresh your work. Try again."); }
    finally { if (inFlight.current === signal) { inFlight.current = null; if (!signal.aborted) setLoading(false); } }
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
  // The floating card over the galaxy can be tucked away into a small chip (remembered), and reopened from it.
  const [tucked, setTucked] = useState(false);
  useEffect(() => { try { setTucked(localStorage.getItem("orbit.continue.tucked") === "1"); } catch { /* private mode */ } }, []);
  const tuck = (v: boolean) => { setTucked(v); try { localStorage.setItem("orbit.continue.tucked", v ? "1" : "0"); } catch { /* private mode */ } };
  if (floating && tucked) {
    const n = data ? data.items.length + data.more : 0;
    return <button type="button" className="chip continue-work-chip" onClick={() => tuck(false)} aria-label="Open Continue my work">▸ Continue my work{n ? ` · ${n}` : ""}</button>;
  }
  return <ContinueWorkView data={data} error={error} loading={loading} updatedAt={updatedAt} floating={floating} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal}
    onRefresh={() => { if (controller.current) void load(controller.current.signal); }} onClose={floating ? () => tuck(true) : undefined} />;
}

export function ContinueWorkView({ data, error = "", loading = false, updatedAt = null, floating = false, onOpenTask, onOpenGoal, onRefresh, onClose }: {
  data: WorkSummary | null; error?: string; loading?: boolean; updatedAt?: Date | null; floating?: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void; onRefresh: () => void; onClose?: () => void;
}) {
  const titleId = useId();
  return <section className={`continue-work${floating ? " continue-work-float" : ""}`} aria-labelledby={titleId}>
    <div className="continue-heading"><h2 id={titleId}>Continue my work</h2><span className="flex items-center gap-2"><button type="button" className="link" onClick={onRefresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>{onClose && <button type="button" className="chip" onClick={onClose} aria-label="Hide Continue my work">✕</button>}</span></div>
    {!data && !error && <p className="muted" role="status">Loading your work…</p>}
    {error && <p className="error" role="alert">{error}{data ? " Showing the last loaded results." : ""}</p>}
    {data?.problems.map((p) => <p key={p} className="error">{p}</p>)}
    {data && !error && !data.items.length && !data.problems.length && <p className="muted">You're caught up. Start with a question or a new goal.</p>}
    {!!data?.items.length && <ul aria-busy={loading}>{data.items.map((item) => <li key={`${item.kind}:${item.id}`} data-status={item.status}><span><small className="continue-kind">{item.kind === "goal" ? "Goal" : "Task"}{item.status === "awaiting_approval" ? " · Your decision" : item.status === "failed" || item.status === "blocked" ? " · Needs attention" : item.status === "running" ? " · In progress" : ""}</small><b>{item.title}</b><small>{item.detail}</small></span>
      <button type="button" className="chip" aria-label={`${item.action}: ${item.title}`} onClick={() => item.kind === "task" ? onOpenTask(item.id) : onOpenGoal(item.id)}>{item.action}</button></li>)}</ul>}
    {!!data?.more && <p className="muted">{data.more} more items in Goals and Operations.</p>}
    {updatedAt && <p className="continue-updated muted">Last loaded <time dateTime={updatedAt.toISOString()} title={updatedAt.toLocaleString()}>{updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></p>}
  </section>;
}
