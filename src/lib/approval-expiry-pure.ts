// Roadmap: an agent approval nobody answers in 48 h counts as rejected (never approved). Pure; tested in tests/approval-expiry.test.ts;
// IO: approval-expiry.ts (scheduler tick). ORBIT_APPROVAL_EXPIRY_HOURS: empty = 48, 0 = off. Needs you shows the result as "expired".
export const EXPIRED_ERROR = "Expired: no answer in 48 h, so nothing was done.";

/** Expiry window in ms, or 0 when switched off. */
export function expiryMs(env: Record<string, string | undefined>): number {
  const raw = (env.ORBIT_APPROVAL_EXPIRY_HOURS ?? "").trim();
  if (!raw) return 48 * 3600_000;
  const h = Number(raw);
  return Number.isFinite(h) && h > 0 ? Math.max(1, h) * 3600_000 : 0;
}

/** The error line for a window of `ms` (the default reads "48 h"). */
export const expiredError = (ms: number) => EXPIRED_ERROR.replace("48 h", `${Math.round(ms / 3600_000)} h`);
export const isExpiredError = (e: unknown) => typeof e === "string" && /^Expired: no answer in \d+ h/.test(e);

/** Waiting tasks to reject now: still awaiting approval with a pending action, waiting since (started_at, else created_at) ≥ ms ago. */
export function dueExpiries<T extends { id: string; status: string; pending?: unknown; started_at?: string | null; created_at?: string | null }>(rows: T[], now: number, ms: number): T[] {
  if (!ms) return [];
  return rows.filter((t) => t.status === "awaiting_approval" && Array.isArray(t.pending) && t.pending.some((p) => p?.status === "pending")
    && now - (Date.parse(t.started_at ?? t.created_at ?? "") || now) >= ms);
}
