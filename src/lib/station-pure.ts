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

/** Emissive colour + strength at time t (s). Always finite and in [0, 2]: Bloom blacks out the screen on NaN/negative/huge. */
export function statusGlow(status: AgentStatus, agentColor: string, t: number, reduced = false): { color: string; intensity: number } {
  const s = Number.isFinite(t) && !reduced ? t : 0;
  let color = agentColor, intensity = 0.2; // idle: dim
  if (status === "working") intensity = 0.9 + 0.6 * Math.sin(s * 3); // pulse 0.3–1.5
  else if (status === "waiting") { color = STATUS_COLOR.waiting; intensity = reduced || Math.floor(s * 2) % 2 === 0 ? 1.6 : 0.2; } // 1 Hz blink
  else if (status === "failed") { color = STATUS_COLOR.failed; intensity = 1.1; }
  return { color, intensity: clamp(intensity, 0, 2) };
}

export const ORBIT_R = [3, 4.1] as const;

/** Where module i of n is at time t: two counter-rotating rings around the hub. Writes into `out` (no per-frame allocation). */
export function orbitPos<V extends { x: number; y: number; z: number }>(i: number, n: number, t: number, out: V): V {
  const s = Number.isFinite(t) ? t : 0, outer = i % 2;
  const a = (i / Math.max(1, n)) * Math.PI * 2 + s * (outer ? -0.12 : 0.18);
  out.x = Math.cos(a) * ORBIT_R[outer];
  out.y = Math.sin(s * 0.8 + i) * 0.18 + (outer ? 0.35 : -0.2);
  out.z = Math.sin(a) * ORBIT_R[outer];
  return out;
}

/** Non-emissive look per status: drone scale, halo opacity, data-beam opacity/speed, approval beacon. All finite and clamped. */
export type StatusVisual = { scale: number; halo: number; beam: number; beamSpeed: number; beacon: number };
export function statusVisual(status: AgentStatus, t: number, reduced = false): StatusVisual {
  const s = Number.isFinite(t) && !reduced ? t : 0;
  let scale = 1, halo = 0.3, beam = 0, beamSpeed = 0, beacon = 0;
  if (status === "working") { const w = 0.5 + 0.5 * Math.sin(s * 3); scale = 1 + 0.12 * w; halo = 0.35 + 0.35 * w; beam = 0.8; beamSpeed = reduced ? 0 : 0.6; }
  else if (status === "waiting") beacon = reduced || Math.floor(s * 2) % 2 === 0 ? 1 : 0.15; // same 1 Hz blink as statusGlow
  else if (status === "idle") { scale = 0.92; halo = 0.12; }
  return { scale: clamp(scale, 0.5, 1.5), halo: clamp(halo, 0, 0.8), beam: clamp(beam, 0, 1), beamSpeed: clamp(beamSpeed, 0, 2), beacon: clamp(beacon, 0, 1) };
}

/** Position in [0, 1) of particle k of `count` along the hub→agent beam at time t. */
export function streamFrac(k: number, count: number, t: number, speed: number): number {
  const v = k / Math.max(1, count) + (Number.isFinite(t) ? t : 0) * (Number.isFinite(speed) ? speed : 0);
  const f = v - Math.floor(v);
  return Number.isFinite(f) ? f : 0;
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
