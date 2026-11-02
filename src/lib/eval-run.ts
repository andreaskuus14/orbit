// Eval isolation (pure parts: eval-core-pure.ts). A CORE turn started by `npm run eval` carries a run id (body.evalRun); it is kept in
// an AsyncLocalStorage for the turn, and the writers that create records tag them with it: chat title, memory tags, lead notes,
// goal doc, a workspace marker file. cleanupEvalRun deletes only rows/workspaces with that tag.
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evalTag, evalTagged } from "./eval-core-pure.ts";

const g = globalThis as unknown as { __orbitEvalRun?: AsyncLocalStorage<string> };
const store = (g.__orbitEvalRun ??= new AsyncLocalStorage<string>());
/** The eval run this code runs under, if any. */
export const evalRunId = (): string | undefined => store.getStore();
export const inEvalRun = <T>(run: string | null, fn: () => T): T => (run ? store.run(run, fn) : fn());
/** Memory tags plus the run's tag while an eval runs. */
export const withEvalTag = (tags: string[]) => { const r = evalRunId(); return r ? [...tags, evalTag(r)] : tags; };

/** Deletes one run's (or every run's, run = "all") tagged chats, memories, leads, goals and workspaces. Counts what went. */
export async function cleanupEvalRun(sb: SupabaseClient, userId: string, run: string): Promise<Record<string, number>> {
  const like = run === "all" ? "[eval ev-%" : `[eval ${run}]%`;
  const del = async (table: string, ids: string[]) => {
    if (!ids.length) return 0;
    const { error } = await sb.from(table).delete().eq("user_id", userId).in("id", ids);
    if (error) throw new Error(`${table}: ${error.message}`);
    return ids.length;
  };
  const pick = (rows: Record<string, unknown>[] | null, f: (r: Record<string, unknown>) => unknown) => (rows ?? []).filter((r) => evalTagged(f(r), run)).map((r) => String(r.id));
  const [chats, mems, leads, goals, tasks] = await Promise.all([
    sb.from("conversations").select("id,title").eq("user_id", userId).like("title", like).limit(1000),
    sb.from("memories").select("id,tags").eq("user_id", userId).not("tags", "is", null).limit(5000),
    sb.from("prospects").select("id,notes").eq("user_id", userId).like("notes", "%[eval ev-%").limit(1000),
    sb.from("goals").select("id,doc").eq("user_id", userId).not("doc->>eval", "is", null).limit(500),
    sb.from("tasks").select("id,title").eq("user_id", userId).like("title", "CORE: [eval ev-%").limit(1000),
  ]);
  for (const r of [chats, mems, leads, goals, tasks]) if (r.error) throw new Error(r.error.message);
  const n = {
    chats: await del("conversations", pick(chats.data, (r) => r.title)), // messages go with them (on delete cascade)
    memories: await del("memories", pick(mems.data, (r) => (Array.isArray(r.tags) ? (r.tags as string[]).find((t) => evalTagged(t, run)) : null))),
    leads: await del("prospects", pick(leads.data, (r) => r.notes)),
    goals: await del("goals", pick(goals.data, (r) => `eval:${(r.doc as { eval?: string })?.eval}`)),
    tasks: await del("tasks", pick(tasks.data, (r) => r.title)),
    workspaces: await import("./workspace").then((m) => m.deleteEvalWorkspaces(userId, (v) => evalTagged(v, run))),
  };
  return n;
}
/** Lead notes plus the run's mark while an eval runs (notes are capped at 2000 chars). */
export const withEvalNote = (notes: string) => { const r = evalRunId(); return r ? `${notes.slice(0, 1960)}\n[eval ${r}]` : notes; };
