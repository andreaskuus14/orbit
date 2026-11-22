// Agent tasks (scheduled automation runs and his own, e.g. research) that failed because the internet was down (laptop woke up, Wi-Fi not back yet) go back in the queue by
// themselves once the scheduler sees a network again (it only gets here while online). Rules: net-wait-pure.ts pickNetRetries.
// Same reset as the owner's Retry (tasks/[id] route), same autonomy check as a scheduled start. Activity logs each retry.
// shortcut: retry counts live in memory; after a restart a task gets up to NET_MAX_TRIES more tries inside the 6 h window.
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAction } from "./authority";
import { NET_RETRY_WINDOW_MS, pickNetRetries } from "./net-wait-pure";

const G = globalThis as unknown as { __orbitNetTries?: Map<string, number[]> };
const tries = (G.__orbitNetTries ??= new Map());

export async function retryNetworkFailures(sb: SupabaseClient, userId: string, now = Date.now()): Promise<number> {
  const since = new Date(now - NET_RETRY_WINDOW_MS).toISOString();
  const { data, error } = await sb.from("tasks").select("id, title, error, finished_at, pending, automation_id").eq("user_id", userId).eq("status", "failed")
    .is("parent_id", null).gte("finished_at", since).order("finished_at", { ascending: false }).limit(20);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; title: string; error: string | null; finished_at: string | null; pending: { status: string }[] | null; automation_id: string | null }[];
  if (!rows.length) return 0;
  const { data: kids } = await sb.from("tasks").select("parent_id").eq("user_id", userId).in("parent_id", rows.map((r) => r.id)).limit(200);
  const withKids = new Set((kids ?? []).map((k) => k.parent_id as string));
  let n = 0;
  for (const id of pickNetRetries(rows.map((r) => ({ ...r, children: withKids.has(r.id) ? 1 : 0 })), tries, now)) {
    const t = rows.find((r) => r.id === id)!;
    if (t.automation_id && !(await authorizeAction("automations.start", { entry: "automation", workflow: `automation:${t.automation_id}`, ownerClick: false })).ok) continue; // his own tasks: he already asked for them
    const { data: hit } = await sb.from("tasks").update({ status: "queued", error: null, result: null, trace: [], pending: [], started_at: null, finished_at: null })
      .eq("user_id", userId).eq("id", id).eq("status", "failed").select("id");
    if (!hit?.length) continue;
    tries.set(id, [...(tries.get(id) ?? []), now]);
    n++;
    console.log(`[orbit] "${t.title}" failed without internet; trying it again now`);
    void import("./activity").then((m) => m.logActivity({ area: "system", title: `Tried again after the internet came back: ${t.title.slice(0, 120)}` })).catch(() => {});
  }
  return n;
}
