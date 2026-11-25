"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useT } from "./i18n";
import type { WorkSummary } from "@/lib/work-continuation-pure";

export function ContinueWork({ floating = false, onOpenTask, onOpenGoal }: { floating?: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
  const { t } = useT();
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
      if (signal.aborted) return;
      if (r.status === 401 || r.status === 403) {
        setData(null);
        setUpdatedAt(null);
        setError(r.status === 401 ? t("cw.signIn") : t("cw.noAccess"));
        return;
      }
      if (!r.ok) throw new Error(t("cw.loadFail"));
      const next = await r.json() as WorkSummary;
      if (!signal.aborted) { setData(next); setError(""); setUpdatedAt(new Date()); }
    } catch { if (!signal.aborted) setError(navigator.onLine ? t("cw.refreshFail") : t("cw.offline")); }
    finally { if (inFlight.current === signal) { inFlight.current = null; if (!signal.aborted) setLoading(false); } }
  }, [t]);
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
    return <button type="button" className="chip continue-work-chip" onClick={() => tuck(false)} aria-label={t("cw.openL")}>▸ {t("cw.title")}{n ? ` · ${n}` : ""}</button>;
  }
  return <ContinueWorkView data={data} error={error} loading={loading} updatedAt={updatedAt} floating={floating} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal}
    onRefresh={() => { if (controller.current) void load(controller.current.signal); }} onClose={floating ? () => tuck(true) : undefined} />;
}

export function ContinueWorkView({ data, error = "", loading = false, updatedAt = null, floating = false, onOpenTask, onOpenGoal, onRefresh, onClose }: {
  data: WorkSummary | null; error?: string; loading?: boolean; updatedAt?: Date | null; floating?: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void; onRefresh: () => void; onClose?: () => void;
}) {
  const { t } = useT();
  const titleId = useId();
  return <section className={`continue-work${floating ? " continue-work-float" : ""}`} aria-labelledby={titleId}>
    <div className="continue-heading"><h2 id={titleId}>{t("cw.title")}</h2><span className="flex items-center gap-2"><button type="button" className="link" onClick={onRefresh} disabled={loading}>{loading ? t("cw.refreshing") : t("cw.refresh")}</button>{onClose && <button type="button" className="chip" onClick={onClose} aria-label={t("cw.hideL")}>✕</button>}</span></div>
    {!data && !error && <p className="muted" role="status">{t("cw.loading")}</p>}
    {error && <p className="error" role="alert">{error}{data ? ` ${t("cw.stale")}` : ""}</p>}
    {data?.problems.map((p) => <p key={p} className="error">{p}</p>)}
    {data && !error && !data.items.length && !data.problems.length && <p className="muted">{t("cw.caughtUp")}</p>}
    {!!data?.items.length && <ul aria-busy={loading}>{data.items.map((item) => <li key={`${item.kind}:${item.id}`} data-status={item.status}><span><small className="continue-kind">{item.kind === "goal" ? t("cw.goal") : t("cw.task")}{item.status === "awaiting_approval" ? ` · ${t("cw.decide")}` : item.status === "failed" || item.status === "blocked" || item.status === "uncertain" ? ` · ${t("cw.attention")}` : item.status === "running" ? ` · ${t("cw.running")}` : ""}</small><b>{item.title}</b><small>{item.detail}</small>{item.next && <small className="continue-next">→ {item.next}</small>}</span>
      <button type="button" className="chip" aria-label={`${item.action}: ${item.title}`} onClick={() => item.kind === "task" ? onOpenTask(item.id) : onOpenGoal(item.id)}>{item.action}</button></li>)}</ul>}
    {!!data?.more && <p className="muted">{t("cw.more", { n: data.more })}</p>}
    {updatedAt && <p className="continue-updated muted">{t("cw.lastLoaded")} <time dateTime={updatedAt.toISOString()} title={updatedAt.toLocaleString()}>{updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></p>}
  </section>;
}
