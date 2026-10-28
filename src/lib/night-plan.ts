// Night shift 2.0 IO (logic: night-plan-pure.ts): the planner's signals and the before/after counts for the morning diff.
// Reads only: the last open-loops scan (no rescan), standing rules, and row counts. Journal memories are not counted.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Signals, Snap } from "./night-plan-pure";

const soft = <T>(p: PromiseLike<T>, empty: T) => Promise.resolve(p).then((x) => x, () => empty);

export async function nightSignals(sb: SupabaseClient, userId: string): Promise<Signals> {
  const [loops, rules] = await Promise.all([
    soft(import("./loops").then((m) => m.loopsView(sb, userId)).then((v) => v.open), []),
    soft(import("./rules").then((m) => m.listRules()), []),
  ]);
  return { loops, rules };
}

/** The counts the morning diff compares; a count that can't be read is NaN (and then never shown as a change). */
export async function snapshot(sb: SupabaseClient, userId: string): Promise<Snap> {
  const n = (q: PromiseLike<{ count: number | null; error: unknown }>) => soft(q.then((r) => (r.error ? NaN : r.count ?? 0)), NaN);
  const tasks = () => sb.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId);
  const [drafts, done, memories, steps, loops] = await Promise.all([
    n(tasks().eq("status", "awaiting_approval")),
    n(tasks().eq("status", "done")),
    n(sb.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).neq("kind", "journal")),
    soft(import("./goals").then((m) => m.listGoals(sb, userId)).then((gs) => gs.reduce((k, g) => k + g.doc.steps.filter((s) => s.status === "done").length, 0)), NaN),
    soft(import("./loops").then((m) => m.loopsView(sb, userId)).then((v) => v.open.length), NaN),
  ]);
  return { drafts, tasks: done, steps, memories, loops };
}
