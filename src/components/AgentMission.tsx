"use client";
import { useWorldPaused } from "./world-paused";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "./AgentsPanels";
import { AgentStatsCard } from "./AgentStatsCard";
import { OpsStatus } from "./OpsStatus";
import { isWorkStatus } from "@/lib/ops-status-pure";
import { CHAIN_TITLE } from "@/lib/chains-pure";
import { excerpt, timeAgo, traceLines } from "@/lib/mission-pure";
import { linkToHash } from "@/lib/deeplink-pure";
import { useT } from "./i18n";
import { STATUS_LABEL, agentStatus, currentTask, type AgentStatus } from "@/lib/station-pure";

// MISSION CONTROL: one agent's live view in the station panel. Data: /api/tasks?agent= (3 s), /api/tasks/:id for the live trace + approvals.
// Task text, results and traces are untrusted: rendered as React text only.

type Detail = { task: Task; children: Task[] };
export type MissionAgent = { slug: string; name: string; color: string; role?: string };

export const STATUS_DOT: Record<AgentStatus, string> = { idle: "var(--muted)", working: "var(--cyan)", waiting: "#fbbf24", failed: "#fb7185" };
const LIVE = new Set<Task["status"]>(["queued", "running", "awaiting_approval"]);

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

/** Visible-tab polling: runs fn now and every ms while enabled. */
export function usePoll(fn: () => void, ms: number, enabled: boolean) {
  const paused = useWorldPaused(); // a kept-but-hidden world stops polling; it polls (and refreshes) again on return
  useEffect(() => {
    if (!enabled || paused) return;
    const tick = () => { if (!document.hidden) fn(); }; // hidden tab: skip; refresh on return
    fn();
    const h = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(h); document.removeEventListener("visibilitychange", tick); };
  }, [fn, ms, enabled, paused]);
}

export function StatusPill({ status }: { status: string }) {
  if (isWorkStatus(status)) return <span className="pill inline-flex shrink-0"><OpsStatus raw={status} /></span>; // shared vocabulary for tasks, steps, chains
  const cls = status === "done" ? "pill ok" : status === "failed" || status === "cancelled" ? "pill bad" : "pill";
  const color = status === "running" || status === "queued" ? "var(--cyan)" : status === "awaiting_approval" || status === "waiting" ? "#fbbf24" : undefined;
  return <span className={`${cls} inline-flex shrink-0`} style={color ? { color } : undefined}>{status.replace("_", " ")}</span>;
}

export default function AgentMission({ agent, onClose, status: given, visible = true, onOpenTask }: {
  agent: MissionAgent; onClose: () => void; status?: AgentStatus; visible?: boolean; onOpenTask?: (id: string) => void; onChanged?: () => void;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const { t } = useT();
  // AGT06: AGENTS configures; running, approving and cancelling a task happens in OPERATIONS on the same record (deep link).
  const ops = (id?: string) => linkToHash(id ? { planet: "operations", kind: "task", id } : { planet: "operations" });
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);

  const loadTasks = useCallback(() => {
    api<{ tasks: Task[] }>(`/api/tasks?agent=${encodeURIComponent(agent.slug)}`)
      .then((r) => { setTasks(r.tasks.filter((t) => !t.title.startsWith(CHAIN_TITLE))); setNow(Date.now()); setErr(""); }) // team runs live in 👥 Teams
      .catch((e) => setErr(e.message));
  }, [agent.slug]);
  usePoll(loadTasks, 3_000, visible);

  const mine = tasks ?? [];
  const cur = currentTask(mine, agent.slug);
  const live = !!cur && LIVE.has(cur.status);
  const curId = live ? cur.id : null;
  const loadDetail = useCallback(() => {
    if (!curId) { setDetail(null); return; }
    api<Detail>(`/api/tasks/${curId}`).then(setDetail).catch((e) => setErr(e.message));
  }, [curId]);
  usePoll(loadDetail, 3_000, visible && !!curId);

  const status = given ?? agentStatus(mine, agent.slug);
  const d = detail && detail.task.id === curId ? detail : null;
  // Approve the task that actually holds the pending actions: a parent waiting on a delegated sub-task has none itself.
  const holder = d ? [d.task, ...d.children].find((t) => t.pending.some((p) => p.status === "pending")) : undefined;
  const pend = holder ? holder.pending.filter((p) => p.status === "pending") : [];
  const log = d ? [
    ...traceLines(d.task.trace).map((l) => ({ ...l, who: "" })),
    ...d.children.flatMap((c) => traceLines(c.trace).map((l) => ({ ...l, key: `${c.id}-${l.key}`, who: c.agent }))),
  ] : [];
  const recent = mine.filter((t) => !LIVE.has(t.status) && t.id !== curId).slice(0, 5);

  return (
    <div className="space-y-3">
      <button className="chip" onClick={onClose}>← All agents</button>
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="hud-title">MISSION CONTROL</div>
          <h2 ref={title} tabIndex={-1} className="text-lg font-semibold outline-none" style={{ color: agent.color }}>{agent.name}</h2>
          {agent.role && <p className="muted text-xs">{agent.role}</p>}
        </div>
        <p className="shrink-0 text-xs" style={{ color: STATUS_DOT[status] }} role="status">● {STATUS_LABEL[status]}</p>
      </header>

      <AgentStatsCard agent={agent.slug} />

      {live && cur ? (
        <section className="card space-y-2" aria-label="Current task">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="hud-title text-[0.7rem]">CURRENT</div>
              <p className="text-sm font-medium break-words">{cur.title}</p>
              <p className="muted text-xs">{cur.started_at ? `started ${timeAgo(cur.started_at, now)}` : `queued ${timeAgo(cur.created_at, now)}`}</p>
            </div>
            <StatusPill status={cur.status} />
          </div>

          {holder && (
            <div className="space-y-2 rounded-lg border p-2 text-xs" style={{ borderColor: "rgba(251,191,36,0.4)" }} aria-label="Pending approvals">
              <div className="hud-title text-[0.7rem]" style={{ color: "#fbbf24" }}>NEEDS YOUR APPROVAL</div>
              {pend.map((p, i) => (
                <p key={i} className="break-words"><b>{p.tool.replace(/_/g, " ")}</b>{holder.agent !== agent.slug ? <span className="muted"> · via {holder.agent}</span> : null}: {String(p.input.title ?? p.input.name ?? p.input.query ?? "").slice(0, 200)}</p>
              ))}
              <a className="link" href={ops(holder.id)}>{t("agt.approveOps")}</a>
            </div>
          )}
          {!holder && d && cur.status === "awaiting_approval" && onOpenTask && (
            <button className="link text-xs" style={{ color: "#fbbf24" }} onClick={() => onOpenTask(cur.id)}>Waiting on a nested sub-task: open in Operations to approve →</button>
          )}

          <ol className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[0.7rem]" aria-label="Live step log" aria-live="polite">
            {log.map((l) => <li key={l.key} className="break-words"><span style={{ color: l.ok ? "var(--mint)" : "var(--rose)" }} aria-label={l.ok ? "ok" : "failed"}>{l.ok ? "✓" : "✗"}</span> {l.who && <b>{l.who} · </b>}{l.text}</li>)}
            {!log.length && <li className="muted">{d ? "No steps yet." : "Loading trace…"}</li>}
          </ol>
          <div className="flex flex-wrap gap-2">
            {(cur.status === "queued" || cur.status === "running") && <a className="chip" href={ops(cur.id)}>{t("agt.cancelOps")}</a>}
            {onOpenTask && <button className="link text-xs" onClick={() => onOpenTask(cur.id)}>Open in Operations →</button>}
          </div>
        </section>
      ) : tasks && <p className="muted text-sm">{agent.name} is free.</p>}

      <a className="btn inline-block" href={ops()}>{t("agt.giveTask", { name: agent.name })}</a>

      <section aria-label="Recent results">
        <div className="hud-title">RECENT RESULTS</div>
        {!tasks ? <p className="muted text-xs">Loading…</p> : !recent.length ? <p className="muted text-xs">No finished tasks yet.</p> : (
          <ul className="mt-1 space-y-2 text-xs">
            {recent.map((t) => (
              <li key={t.id} className="card space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words font-medium">{t.title}</p>
                  <StatusPill status={t.status} />
                </div>
                <p className="muted">{timeAgo(t.finished_at ?? t.created_at, now)}</p>
                {(t.result || t.error) && <p className={`break-words ${t.error && !t.result ? "error" : ""}`}>{excerpt(t.result || t.error)}</p>}
                {onOpenTask && <button className="link" onClick={() => onOpenTask(t.id)} aria-label={`Open “${t.title.slice(0, 60)}” in Operations`}>Open in Operations →</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
