// OPS04/OPS03: recovery at the failed step, prerequisites and the one-writer-per-output guard.
// Retrying a step never touches an approved action (its receipt and artifact stay accepted). A failed/uncertain action goes back to
// "pending" with its attempt id; resolvePending re-runs it under the same attemptId(taskId, index), and every approval tool
// (save_memory, create_project, add_task, propose_automation) first looks up the row that attempt already created, so a write that
// landed before the failure is returned as the receipt instead of being written again.
import type { ActionResult } from "./completion-pure";

export type Recovery = "retry_step" | "resume" | "replace_input" | "abandon";
type Act = ActionResult & { tool?: string; input?: Record<string, unknown>; attempt?: string };
type T = { status: string; parent_id: string | null; title: string };

const REDO = ["failed", "uncertain", "rejected"];

/** Which recovery buttons a failed/cancelled task (or chain step) offers. canRetryWhole: nothing resolved anywhere (completion-pure). */
export function recoveryOptions(t: T, actions: Act[], canRetryWhole: boolean): Recovery[] {
  if (t.status !== "failed" && t.status !== "cancelled") return [];
  const out: Recovery[] = [];
  if (actions.some((a) => REDO.includes(a.status))) out.push("retry_step"); // back to approval: he decides again
  if (actions.some((a) => a.status === "failed" || a.status === "uncertain") && !actions.some((a) => a.status === "rejected")) out.push("resume"); // his click approves the same step
  if (canRetryWhole && !t.parent_id && !t.title.startsWith("Team: ")) out.push("replace_input");
  if (t.status === "failed") out.push("abandon");
  return out;
}

/** The task update for "Retry this step": only failed/uncertain/rejected actions go back to pending; receipts and attempt ids stay. */
export function retryStepPatch(pending: Act[]) {
  if (!pending.some((a) => REDO.includes(a.status))) return null;
  return {
    status: "awaiting_approval", error: null, finished_at: null,
    pending: pending.map((a) => (REDO.includes(a.status) ? { ...a, status: "pending", note: a.note ? `Earlier try: ${a.note}`.slice(0, 500) : undefined } : a)),
  };
}

/** "Abandon": stop here, keep the result, receipts, trace and the original error as evidence. */
export const abandonPatch = (error: string | null) => ({ status: "cancelled", error: `Abandoned at the failed step.${error ? ` ${error}` : ""}`.slice(0, 1000) });

/** Replacement input for a rerun: trimmed, 5..4000 chars, else null. */
export const cleanInput = (v: unknown) => (typeof v === "string" && v.trim().length >= 5 ? v.trim().slice(0, 4000) : null);

/** Unfinished prerequisites: sub-tasks / chain steps this task is waiting on. */
export const blockedBy = <C extends { status: string }>(t: { status: string }, children: C[]) =>
  t.status === "awaiting_approval" || t.status === "running" ? children.filter((c) => ["queued", "running", "awaiting_approval"].includes(c.status)) : [];

/** What an action writes, as a comparable key (tool + its target name), or null when it names nothing. */
export function outputKey(a: Act): string | null {
  const i = a.input ?? {};
  const name = String(i.path ?? i.name ?? i.title ?? "").trim().toLowerCase();
  return a.tool && name ? `${a.tool}:${i.project ?? ""}:${name}` : null;
}

/** OPS03 guard: another running task already writing the same output → its id (the approval waits), else null. */
export function outputClash(mine: Act[], others: { id: string; status: string; pending: Act[] | null }[]): string | null {
  const keys = new Set(mine.filter((a) => a.status === "pending" || REDO.includes(a.status)).map(outputKey).filter(Boolean));
  for (const o of others)
    if (o.status === "running" && (o.pending ?? []).some((a) => (a.status === "pending" || a.status === "attempting") && keys.has(outputKey(a)))) return o.id;
  return null;
}
