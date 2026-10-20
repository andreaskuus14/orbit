export type WorkItem = { kind: "task" | "goal"; id: string; title: string; status: string; detail: string; action: string };
export type WorkSummary = { items: WorkItem[]; more: number; problems: string[] };
export type WorkTask = { id: string; title: string; status: string; created_at: string };
export type WorkGoal = { id: string; updated_at: string; doc: { title: string; status: string; waitingFor?: string; blocker?: string; steps: { status: string; taskId?: string }[] } };
const text = (x: unknown, fallback: string) => typeof x === "string" && x.trim() ? x.trim().slice(0, 200) : fallback;

/** Build a small inbox from existing records. Linked goal tasks appear once, as the goal's next step. */
export function continueWork(tasks: WorkTask[], goals: WorkGoal[], problems: string[] = []): WorkSummary {
  const rows: { item: WorkItem; rank: number; at: number }[] = [];
  const linked = new Set<string>();
  for (const g of goals) {
    const d = g.doc;
    if (!d || ["done", "stopped"].includes(d.status)) continue;
    if (!["draft", "approved", "running", "waiting", "paused", "blocked"].includes(d.status)) continue;
    const steps = Array.isArray(d.steps) ? d.steps : [];
    const step = steps.find((s) => s && s.status !== "done");
    // A task awaiting approval must open the actual approval screen.
    const task = tasks.find((t) => t.id === step?.taskId);
    for (const s of steps) if (s?.taskId) linked.add(s.taskId);
    const needsTask = task?.status === "awaiting_approval";
    const detail = needsTask ? "This goal's task needs your approval"
      : d.status === "draft" ? "Review the proposed plan"
      : d.status === "blocked" ? text(d.blocker, "Review the blocker")
      : d.status === "waiting" ? text(d.waitingFor, "Review what this goal is waiting for")
      : d.status === "paused" ? "Paused by you"
      : `${steps.filter((s) => s?.status === "done").length}/${steps.length} steps finished`;
    rows.push({ item: { kind: needsTask ? "task" : "goal", id: needsTask ? task.id : g.id, title: text(d.title, "Untitled goal"), status: needsTask ? task.status : d.status, detail,
      action: needsTask ? "Review approval" : d.status === "draft" ? "Review plan" : d.status === "running" ? "View progress" : "Open goal" },
      rank: needsTask ? 0 : d.status === "waiting" || d.status === "draft" ? 1 : d.status === "blocked" ? 2 : d.status === "running" ? 4 : 3,
      at: Date.parse(g.updated_at) || 0 });
  }
  for (const t of tasks) {
    if (linked.has(t.id) || !["queued", "running", "awaiting_approval", "failed"].includes(t.status)) continue;
    rows.push({ item: { kind: "task", id: t.id, title: text(t.title, "Untitled task"), status: t.status,
      detail: t.status === "awaiting_approval" ? "Actions are waiting for your decision" : t.status === "failed" ? "Incomplete — inspect the result before retrying" : t.status === "queued" ? "Waiting for an agent slot" : "Agent is working",
      action: t.status === "awaiting_approval" ? "Review approval" : t.status === "failed" ? "Review issue" : "View progress" },
      rank: t.status === "awaiting_approval" ? 0 : t.status === "failed" ? 2 : 4, at: Date.parse(t.created_at) || 0 });
  }
  rows.sort((a, b) => a.rank - b.rank || b.at - a.at || a.item.id.localeCompare(b.item.id));
  return { items: rows.slice(0, 6).map((r) => r.item), more: Math.max(0, rows.length - 6), problems };
}
