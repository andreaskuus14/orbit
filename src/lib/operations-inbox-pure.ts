// Read-only inbox over the task rows already loaded by OPERATIONS; never a global/history total.
export const INBOX_BUCKETS = ["attention", "failed", "active", "done", "cancelled"] as const;
export type InboxBucket = typeof INBOX_BUCKETS[number];
export type InboxFilter = InboxBucket | "all";
export type InboxSort = "priority" | "recent";
export type InboxTask = {
  id: string; status: string; title: string; agent: string; request?: string; result?: string | null; error?: string | null;
  created_at: string; started_at?: string | null; finished_at?: string | null; pending?: { status: string }[] | null;
};

export function inboxBucket(t: InboxTask): InboxBucket {
  if (t.status === "cancelled") return "cancelled";
  if (t.status === "failed" || t.pending?.some((a) => a.status === "uncertain")) return "failed";
  if (t.status === "done") return "done";
  if (t.status === "awaiting_approval" || t.pending?.some((a) => a.status === "pending")) return "attention";
  return t.status === "running" || t.status === "queued" ? "active" : "attention";
}

const time = (t: InboxTask) => Date.parse(t.finished_at || t.started_at || t.created_at) || 0;

/** Counts follow the text/agent filters, before the selected status filter. Every row belongs to exactly one bucket. */
export function inboxView<T extends InboxTask>(tasks: T[], query: string, agent: string, filter: InboxFilter, sort: InboxSort) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matched = tasks.filter((t) => {
    if (agent && t.agent !== agent) return false;
    const text = [t.title, t.agent, t.request, t.result, t.error].filter(Boolean).join(" ").toLocaleLowerCase();
    return words.every((w) => text.includes(w));
  });
  const counts: Record<InboxBucket, number> = { attention: 0, failed: 0, active: 0, done: 0, cancelled: 0 };
  for (const t of matched) counts[inboxBucket(t)]++;
  const rows = matched.filter((t) => filter === "all" || inboxBucket(t) === filter).sort((a, b) =>
    (sort === "priority" ? INBOX_BUCKETS.indexOf(inboxBucket(a)) - INBOX_BUCKETS.indexOf(inboxBucket(b)) : 0) || time(b) - time(a) || a.id.localeCompare(b.id)
  );
  return { rows, counts, total: matched.length };
}
