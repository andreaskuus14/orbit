// Task claims: a task runs only after ONE successful conditional update (status → running, claimed_by = this worker).
// The lease is started_at (set by the claim); task budgets end well inside LEASE_MS (8–10 min), so no heartbeat is needed.

/** Same 20 minutes as the task list's "Interrupted" sweep and cancelTask's orphan rule. */
export const LEASE_MS = 20 * 60_000;

export type ClaimRow = { status: string; claimed_by?: string | null; started_at?: string | null };

/** May `worker` claim this row? `handoff`: kickQueue in this process already claimed it from "queued".
 *  Otherwise: a queued row; a running row nobody owns (the caller inserted it as "running"); or a running row whose
 *  lease expired (its process died). Mirrors claimFilter: Postgres applies that filter atomically. */
export function claimable(row: ClaimRow, worker: string, now: number, handoff = false): boolean {
  if (handoff) return row.status === "running" && row.claimed_by === worker;
  if (row.status === "queued") return true;
  if (row.status !== "running") return false;
  return row.claimed_by == null || (!!row.started_at && Date.parse(row.started_at) < now - LEASE_MS);
}

/** A task its creator runs right away (CORE's ask_agent through runTask, a background CORE turn): inserted "running" and unowned, so
 *  kickQueue, which only takes "queued" rows, can't start a second copy first; runTask's own claim (claimable above) still takes it. */
export const inlineTask = <T extends object>(row: T, now: number) => ({ ...row, status: "running" as const, started_at: new Date(now).toISOString() });

/** PostgREST `.or()` filter for a non-handoff claim (same rule as claimable). */
export const claimFilter = (now: number) =>
  `status.eq.queued,and(status.eq.running,claimed_by.is.null),and(status.eq.running,started_at.lt."${new Date(now - LEASE_MS).toISOString()}")`;

/** True when the tasks table has no claimed_by column yet (migration 0021 not applied). */
export const missingOwnerColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /claimed_by/.test(e.message ?? ""));
