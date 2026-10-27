import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHold } from "./usage-meter";
import { parseJson, today, type Goal } from "./goals-pure";
import { PHRASE_SYSTEM, applyPhrasing, applyReplan, burnup, phrasePrompt, sameReplan, setupAutopilot, trackGoal, type Evidence } from "./goal-autopilot-pure";
import type { GoalRow } from "./goals";

// GOAL AUTOPILOT IO: gathers evidence (ledger events, finished tasks, ARCH saves) and handles the owner's three clicks.
// Read-only except those clicks; the one model call (phrasing) runs only on his "Phrase" click.

const LEDGER_TYPES = ["clip.published", "business.stage", "invoice.status", "focus.session"];

/** Evidence since the earliest milestone start of these goals (bounded queries; each source fails soft to nothing). */
export async function loadEvidence(sb: SupabaseClient, userId: string, since: string): Promise<Evidence[]> {
  const from = `${since}T00:00:00Z`;
  const [ev, tasks, arch] = await Promise.all([
    sb.from("events").select("created_at, type, payload").eq("user_id", userId).in("type", LEDGER_TYPES).gte("created_at", from).limit(5000),
    sb.from("tasks").select("id, finished_at").eq("user_id", userId).eq("status", "done").gte("finished_at", from).limit(3000),
    sb.from("memories").select("created_at").eq("user_id", userId).contains("tags", ["arch"]).gte("created_at", from).limit(3000),
  ]);
  return [
    ...(ev.data ?? []).map((r) => ({ at: String(r.created_at), type: String(r.type), data: (r.payload ?? {}) as Record<string, unknown> })),
    ...(tasks.data ?? []).filter((r) => r.finished_at).map((r) => ({ at: String(r.finished_at), type: "task.done", data: { id: r.id } })),
    ...(arch.data ?? []).map((r) => ({ at: String(r.created_at), type: "arch.saved" })),
  ];
}

export type GoalTrack = NonNullable<ReturnType<typeof trackGoal>> & { burnup: ReturnType<typeof burnup> };

/** Track view per goal with milestones (one evidence load for all of them). */
export async function trackGoals(sb: SupabaseClient, userId: string, docs: { id: string; doc: Goal }[], day = today()): Promise<Map<string, GoalTrack>> {
  const out = new Map<string, GoalTrack>();
  const withAp = docs.filter((r) => r.doc.autopilot && r.doc.deadline);
  if (!withAp.length) return out;
  const since = withAp.map((r) => r.doc.autopilot!.start).sort()[0];
  const ev = await loadEvidence(sb, userId, since);
  for (const r of withAp) { const t = trackGoal(r.doc, ev, day); if (t) out.set(r.id, { ...t, burnup: burnup(r.doc, ev, day) }); }
  return out;
}

/** The first at-risk / behind open goal's line for the morning brief (none → null). */
export async function goalRisk(sb: SupabaseClient, userId: string): Promise<{ id: string; title: string; say: string } | null> {
  const { data } = await sb.from("goals").select("id, doc").eq("user_id", userId).in("status", ["approved", "running", "waiting", "paused", "blocked"]).limit(10);
  const tracks = await trackGoals(sb, userId, (data ?? []) as { id: string; doc: Goal }[]);
  for (const [id, t] of tracks) if (t.track === "at-risk" || t.track === "behind") {
    const g = (data ?? []).find((r) => r.id === id)!.doc as Goal;
    return { id, title: `Goal ${t.track}: ${g.title}`.slice(0, 120), say: `Your goal ${g.title.slice(0, 60)} is ${t.track === "behind" ? "behind" : "at risk"}: ${t.actual} of ${g.autopilot!.total} ${t.label}, the plan said ${Math.floor(t.expected)} by now.${t.replan ? " I have a re-plan ready for you." : ""}` };
  }
  return null;
}

type Mutate = (sb: SupabaseClient, id: string, fn: (doc: Goal) => string) => Promise<{ row: GoalRow } | { error: string }>;

/** The owner's clicks: "milestones" (set them up), "replan" (accept the re-plan he saw), "phrase" (one model call to word them). */
export async function autopilotAction(sb: SupabaseClient, userId: string, id: string, action: "milestones" | "replan" | "phrase", body: Record<string, unknown>, mutate: Mutate): Promise<{ row?: GoalRow; error?: string }> {
  if (action === "milestones") { const r = await mutate(sb, id, (d) => setupAutopilot(d, body.evidence, body.total, today())); return "error" in r ? { error: r.error } : { row: r.row }; }
  if (action === "replan") {
    const { data } = await sb.from("goals").select("doc").eq("id", id).maybeSingle();
    const doc = data?.doc as Goal | undefined;
    if (!doc?.autopilot) return { error: "This goal has no milestones" };
    const ev = await loadEvidence(sb, userId, doc.autopilot.start);
    const r = await mutate(sb, id, (d) => { const t = trackGoal(d, ev, today()); return sameReplan(t?.replan ?? null, body.seen) ? applyReplan(d, t!.replan!) : "The numbers moved since you looked; review the re-plan again"; });
    return "error" in r ? { error: r.error } : { row: r.row }; // a catch-up step runs on the goal's next advance (night shift or opening it)
  }
  const held = stopAllOn() ? PAUSED_MSG : usageHold();
  if (held) return { error: held };
  const { data } = await sb.from("goals").select("doc").eq("id", id).maybeSingle();
  const doc = data?.doc as Goal | undefined;
  if (!doc?.autopilot) return { error: "Set milestones first" };
  const res = await askClaude(phrasePrompt(doc), PHRASE_SYSTEM, { purpose: "goals.milestones" });
  await recordUsage(sb, userId, "goal.milestones", res);
  const due = JSON.stringify(doc.autopilot.milestones.map((m) => [m.due, m.target]));
  const r = await mutate(sb, id, (d) => (JSON.stringify(d.autopilot?.milestones.map((m) => [m.due, m.target])) !== due ? "The milestones changed meanwhile" : applyPhrasing(d, parseJson(res.text)) ? "" : "The phrasing wasn't usable; the plain milestones stay"));
  return "error" in r ? { error: r.error } : { row: r.row };
}
