// AGENTS station: pure status → visual rules and the activity feed. No DOM, no three.js — tested in tests/station.test.ts.

export type TaskStatus = "queued" | "running" | "awaiting_approval" | "done" | "failed" | "cancelled";
export type StationTask = {
  id: string; agent: string; title: string; status: TaskStatus;
  created_at: string; started_at: string | null; finished_at: string | null;
};
export type AgentStatus = "idle" | "working" | "waiting" | "failed";

/** Newest first. Active work (waiting > running/queued) wins over the newest finished task. */
export function currentTask<T extends StationTask>(tasks: T[], agent: string): T | null {
  const mine = tasks.filter((t) => t.agent === agent).sort((a, b) => time(b.created_at) - time(a.created_at));
  return mine.find((t) => t.status === "awaiting_approval") ?? mine.find((t) => t.status === "running" || t.status === "queued") ?? mine[0] ?? null;
}

/** running = /api/agents stats.running (it also counts delegated sub-tasks, which /api/tasks doesn't list). */
export function agentStatus(tasks: StationTask[], agent: string, running = 0): AgentStatus {
  const t = currentTask(tasks, agent);
  if (t?.status === "awaiting_approval") return "waiting";
  if (running > 0 || t?.status === "running" || t?.status === "queued") return "working";
  return t?.status === "failed" ? "failed" : "idle";
}

export const STATUS_COLOR: Record<Exclude<AgentStatus, "idle" | "working">, string> = { waiting: "#fbbf24", failed: "#ef4444" };
export const STATUS_LABEL: Record<AgentStatus, string> = { idle: "Idle", working: "Working…", waiting: "Needs your approval", failed: "Last task failed" };

/** Emissive colour + strength at time t (s). Always finite and in [0, 2.5]: Bloom blacks out the screen on NaN/negative. */
export function statusGlow(status: AgentStatus, agentColor: string, t: number, reduced = false): { color: string; intensity: number } {
  const s = Number.isFinite(t) && !reduced ? t : 0;
  let color = agentColor, intensity = 0.12; // idle: dim
  if (status === "working") intensity = 0.9 + 0.6 * Math.sin(s * 3); // pulse 0.3–1.5
  else if (status === "waiting") { color = STATUS_COLOR.waiting; intensity = reduced || Math.floor(s * 2) % 2 === 0 ? 1.6 : 0.2; } // 1 Hz blink
  else if (status === "failed") { color = STATUS_COLOR.failed; intensity = 1.1; }
  return { color, intensity: clamp(intensity, 0, 2.5) };
}

export const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const time = (iso: string | null) => { const n = iso ? Date.parse(iso) : NaN; return Number.isFinite(n) ? n : 0; };

export type FeedEvent = { key: string; at: number; agent: string; text: string; status: TaskStatus | "started" };

/** Latest `limit` events across all agents, newest first (queued, started, finished/awaiting approval per task). */
export function activityFeed(tasks: StationTask[], limit = 10): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const t of tasks) {
    const add = (iso: string | null, status: FeedEvent["status"], verb: string) => {
      const at = time(iso);
      if (at) out.push({ key: `${t.id}:${status}`, at, agent: t.agent, text: `${verb} “${t.title}”`, status });
    };
    add(t.created_at, "queued", "got");
    add(t.started_at, "started", "started");
    if (t.status === "done") add(t.finished_at, "done", "finished");
    else if (t.status === "failed") add(t.finished_at ?? t.started_at, "failed", "failed");
    else if (t.status === "cancelled") add(t.finished_at, "cancelled", "cancelled");
    else if (t.status === "awaiting_approval") add(t.finished_at ?? t.started_at, "awaiting_approval", "needs approval for");
  }
  return out.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key)).slice(0, limit);
}
