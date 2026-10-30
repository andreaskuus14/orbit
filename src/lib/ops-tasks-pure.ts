// OPERATIONS task list: every top-level task, whatever its project or agent, grouped by what it needs from him.
type T = { status: string; created_at: string; pending?: { status: string }[] | null };
export type TaskGroups<X> = { attention: X[]; active: X[]; done: X[] };

export function groupTasks<X extends T>(tasks: X[]): TaskGroups<X> {
  const g: TaskGroups<X> = { attention: [], active: [], done: [] };
  const newest = [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const t of newest) {
    const waiting = (t.pending ?? []).some((p) => p.status === "pending");
    if (t.status === "failed" || t.status === "awaiting_approval" || (waiting && t.status !== "done" && t.status !== "cancelled")) g.attention.push(t);
    else if (t.status === "queued" || t.status === "running") g.active.push(t);
    else g.done.push(t);
  }
  return g;
}
