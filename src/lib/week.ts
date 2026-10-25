// Ask-my-week IO: gathers the week (RLS-scoped, stored data only, all in parallel) for week-pure.ts. A failing source counts as
// nothing rather than failing the answer. Journal entries: only the ledger's "journal.saved" events are read, never memory text.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromRows, type EventRow } from "./ledger-pure";
import { BUFFER_TARGET } from "./clips/autopilot-pure";
import { citeWeek, weekAnswer, weekFacts, weekToolText, weekWindow, type Week, type WeekClip, type WeekCite, type WeekIntent } from "./week-pure";

const DAY = 86_400_000;
const TYPES = ["goal.step", "clip.outcome48h", "morning.done", "morning.click", "morning.thumb", "focus.session", "journal.saved"];

export async function gatherWeekFacts(sb: SupabaseClient, userId: string, weeksAgo = 0, now = Date.now()): Promise<Week> {
  const w = weekWindow(now, weeksAgo), since = new Date(w.start).toISOString(), until = new Date(w.end).toISOString();
  const rows = <T>(p: PromiseLike<{ data: T[] | null }>) => Promise.resolve(p).then((r) => r.data ?? [], () => [] as T[]);
  const [events, goals, tasks, jobs, memories, life] = await Promise.all([
    // 14 days back for streaks that started before Monday
    rows<EventRow>(sb.from("events").select("id, created_at, type, planet, payload, caused_by").eq("user_id", userId).in("type", TYPES)
      .gte("created_at", new Date(w.start - 14 * DAY).toISOString()).lt("created_at", until).order("created_at").limit(3000)),
    import("./goals").then((g) => g.listGoals(sb, userId), () => []),
    rows<{ id: string; title: string; status: string; created_at: string; finished_at: string | null }>(sb.from("tasks").select("id, title, status, created_at, finished_at")
      .eq("user_id", userId).is("parent_id", null).or(`created_at.gte.${since},finished_at.gte.${since},status.eq.awaiting_approval`).lt("created_at", until).limit(400)),
    import("./clips/factory").then((f) => f.listJobs(), () => []),
    rows<{ id: string; title: string; created_at: string }>(sb.from("memories").select("id, title, created_at").eq("user_id", userId).neq("kind", "journal")
      .gte("created_at", since).lt("created_at", until).order("created_at", { ascending: false }).limit(50)),
    import("./life").then((l) => l.getLife(), () => null),
  ]);
  const clips: WeekClip[] = jobs.flatMap((j) => j.clips.map((c) => ({
    job: j.id, id: c.id, title: c.publish?.title ?? c.title, status: c.status,
    ...(c.publish ? { publish: { status: c.publish.status, at: c.publish.at, ...(c.publish.scheduledFor ? { scheduledFor: c.publish.scheduledFor } : {}) } } : {}),
    approvedAt: j.feedback?.filter((f) => f.clipId === c.id && f.action === "approved").at(-1)?.at,
  })));
  return weekFacts({
    now, weeksAgo, events: fromRows(events), tasks, clips, memories, shortsTarget: BUFFER_TARGET, // a Short a day (autopilot's 7-Short buffer)
    goals: goals.map((r) => ({ id: r.id, title: r.doc.title, status: r.doc.status, deadline: r.doc.deadline, updatedAt: r.updated_at, steps: r.doc.steps.map((s) => ({ id: s.id, what: s.what, status: s.status, taskId: s.taskId })) })),
    habits: (life?.habits ?? []).map((h) => ({ name: h.name, streak: h.streak })),
  });
}

/** CORE's week_review tool: the facts, each with its [w:...] citation marker. */
export async function runWeekTool(sb: SupabaseClient, userId: string, input: Record<string, unknown>): Promise<string> {
  try { return weekToolText(await gatherWeekFacts(sb, userId, input.week === "last" ? 1 : 0)); }
  catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
}

/** The reflex: the common week questions answered from facts alone, no model call. */
export async function weekReflex(sb: SupabaseClient, userId: string, intent: WeekIntent, weeksAgo: number) {
  const t = Date.now(), wk = await gatherWeekFacts(sb, userId, weeksAgo);
  const known = new Map(wk.facts.flatMap((f) => (f.cite ? [[f.cite, f.text.slice(0, 90)] as [string, string]] : [])));
  const { text, cites } = citeWeek(weekAnswer(wk, intent, weeksAgo), known);
  return { text, citations: cites as WeekCite[], trace: [{ step: "reflex", detail: `week:${intent} · answered from ORBIT's own data (${wk.facts.length} facts)`, ms: Date.now() - t, ok: true }], model: "fast" as const };
}
