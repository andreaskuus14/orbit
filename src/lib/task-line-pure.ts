// How list_tasks / orbit_stats describe a task to an agent: with times and run length, so "what ran in the last 12 h"
// and "how long do tasks take" are answerable (dates alone made both unanswerable on the live PC, 8 Nov).

export type TaskRow = { title: string; agent: string; status: string; created_at: string; started_at?: string | null; finished_at?: string | null; error?: string | null };

const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export function runSeconds(t: Pick<TaskRow, "started_at" | "finished_at">): number | null {
  if (!t.started_at || !t.finished_at) return null;
  const s = (Date.parse(t.finished_at) - Date.parse(t.started_at)) / 1000;
  return Number.isFinite(s) && s >= 0 ? Math.round(s) : null;
}

export const duration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

export function taskLine(t: TaskRow): string {
  const run = runSeconds(t);
  const parts = [t.agent, t.status, `created ${utc(t.created_at)}`];
  if (run !== null) parts.push(`ran ${duration(run)}`);
  else if (t.started_at && !t.finished_at) parts.push(`started ${utc(t.started_at)}`);
  const err = t.status === "failed" && t.error ? ` — error: ${t.error.replace(/\s+/g, " ").slice(0, 120)}` : "";
  return `- ${t.title} (${parts.join(", ")})${err}`;
}

/** Median run time per agent over finished tasks, e.g. "atlas 2m 27s (n=21), forge 43s (n=19)". */
export function medianByAgent(rows: Pick<TaskRow, "agent" | "started_at" | "finished_at">[]): string {
  const by = new Map<string, number[]>();
  for (const r of rows) { const s = runSeconds(r); if (s !== null) by.set(r.agent, [...(by.get(r.agent) ?? []), s]); }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([a, xs]) => { const v = [...xs].sort((x, y) => x - y); return `${a} ${duration(v[Math.floor(v.length / 2)])} (n=${v.length})`; })
    .join(", ") || "none";
}
