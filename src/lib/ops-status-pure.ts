// One status vocabulary for tasks, chain steps, chains and missions (tested in tests/ops-status.test.ts). Every place that shows
// work status (OPERATIONS, CORE mission control, MISSIONS, Needs you) renders opsStatus(), so the same item reads the same everywhere.
export const OPS_STATUSES = ["queued", "running", "waiting", "blocked", "checking", "complete", "failed", "cancelled"] as const;
export type OpsStatus = (typeof OPS_STATUSES)[number];

const MAP: Record<string, OpsStatus> = {
  queued: "queued", pending: "queued",
  running: "running",
  awaiting_approval: "waiting", waiting: "waiting", "waiting-approval": "waiting",
  "waiting-input": "blocked", blocked: "blocked", paused: "blocked", stopped: "blocked",
  done: "complete", completed: "complete",
  failed: "failed",
  cancelled: "cancelled",
};

/** Whether a raw status is one of the work states above (goal "draft"/"active" are not). */
export const isWorkStatus = (raw: string) => Object.hasOwn(MAP, raw);

/** Raw task / step / chain / mission / work-item status → the shared vocabulary. stopAll: queued or running work is held (Stop-all
 *  is on), so it is "blocked", never shown as running. A running task whose approved action is mid-flight or unconfirmed is
 *  "checking" (its read-back has not landed yet). Unknown raw values read as "queued" rather than claiming progress. */
export function opsStatus(raw: string, o: { stopAll?: boolean; pending?: unknown; hostOffline?: boolean } = {}): OpsStatus {
  const s = isWorkStatus(raw) ? MAP[raw] : "queued";
  if (o.hostOffline && s === "running") return "blocked"; // no live host: nothing is advancing it (interrupted until the host is back)
  if (o.stopAll && (s === "running" || s === "queued")) return "blocked";
  if (s === "running" && Array.isArray(o.pending) && o.pending.some((p) => ["attempting", "uncertain"].includes((p as { status?: string })?.status ?? ""))) return "checking";
  return s;
}

export const OPS_TONE: Record<OpsStatus, string> = {
  queued: "var(--muted)", running: "var(--cyan)", waiting: "#fbbf24", blocked: "#fbbf24", checking: "var(--cyan)",
  complete: "#6ee7b7", failed: "#fb7185", cancelled: "var(--muted)",
};

/** When the item last moved: the latest of the timestamps it has (ISO), or "" when none parse. */
export function lastProgress(...at: (string | null | undefined)[]): string {
  const t = Math.max(...at.map((a) => Date.parse(a ?? "")).filter(Number.isFinite));
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/** The scheduler beats every minute (host-heartbeat.ts); three missed beats = the host is offline. */
export const HOST_STALE_MS = 3 * 60_000;
/** at: last host beat (ISO), null = never beaten, undefined = not known yet (don't claim offline). */
export function hostOffline(at: string | null | undefined, now = Date.now()): boolean {
  if (at === undefined) return false;
  const t = Date.parse(at ?? "");
  return !Number.isFinite(t) || now - t > HOST_STALE_MS;
}
