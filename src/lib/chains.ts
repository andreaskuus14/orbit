import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelTask, getAgent, kickQueue, runTask } from "./agents";
import { CHAIN_TITLE, chainView, composeRequest, nextMove, parseMeta, stepTitle, toMeta, validateChain, type ChainView, type ChildRow } from "./chains-pure";

// AGENT TEAMS runner: the chain lives in the tasks table (see chains-pure.ts), so it survives restarts. drive() walks the steps in order,
// one at a time per chain, and stops at an approval; resumeChains (GET /api/chains, and the scheduler tick if wired) picks it up again.

const MAX_RUNNING = 2; // agents.ts MAX_RUNNING: chain steps share kickQueue's slots
const STALE_MS = 20 * 60_000; // same rule as the tasks list sweep / cancelTask
const KID_COLS = "id, agent, title, request, status, result, error, started_at";
// Same globals agents.ts uses: its queue slots and its live controllers (so cancelTask(chainId) from AGENTS stops a driving chain).
const g = globalThis as unknown as { __orbitChains?: Set<string>; __orbitTaskQueue?: Set<string>; __orbitLiveTasks?: Map<string, AbortController> };
const driving = (g.__orbitChains ??= new Set());
const slots = () => (g.__orbitTaskQueue ??= new Set());
const live = () => (g.__orbitLiveTasks ??= new Map());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Parent = { id: string; status: string; request: string; project_id: string | null };

/** Validated body → new chain id, or an error message. */
export async function createChain(sb: SupabaseClient, userId: string, body: unknown): Promise<{ chainId: string } | { error: string }> {
  const d = validateChain(body);
  if (typeof d === "string") return { error: d };
  for (const st of d.steps) if (!(await getAgent(sb, st.agent, userId))) return { error: `Unknown agent "${st.agent}"` };
  const { data: parent, error } = await sb.from("tasks").insert({
    user_id: userId, agent: "nova", title: `${CHAIN_TITLE}${d.goal}`.slice(0, 200), request: JSON.stringify(toMeta(d)), status: "running",
  }).select("id").single(); // started_at stays null: the stale-task sweep only touches rows with a started_at
  if (error) return { error: error.message };
  driving.add(parent.id); // so a GET poll can't start a driver before the step rows exist
  const { error: kidsErr } = await sb.from("tasks").insert(d.steps.map((st, k) => ({
    user_id: userId, parent_id: parent.id, agent: st.agent, title: stepTitle(k, d.steps.length, st.agent, st.request), request: st.request,
  })));
  driving.delete(parent.id);
  if (kidsErr) {
    await sb.from("tasks").delete().eq("id", parent.id);
    return { error: kidsErr.message };
  }
  void drive(sb, userId, parent.id);
  return { chainId: parent.id };
}

async function loadKids(sb: SupabaseClient, ids: string[]) {
  if (!ids.length) return new Map<string, ChildRow[]>();
  const { data, error } = await sb.from("tasks").select(`parent_id, ${KID_COLS}`).in("parent_id", ids).order("created_at");
  if (error) throw error;
  const m = new Map<string, ChildRow[]>();
  for (const r of (data ?? []) as (ChildRow & { parent_id: string })[]) m.set(r.parent_id, [...(m.get(r.parent_id) ?? []), r]);
  return m;
}

async function views(sb: SupabaseClient, userId: string, parents: Parent[]): Promise<ChainView[]> {
  const ps = parents.flatMap((p) => { const meta = parseMeta(p.request); return meta ? [{ p, meta }] : []; });
  const kids = await loadKids(sb, ps.map((x) => x.p.id));
  for (const { p } of ps) if (p.status === "running") void drive(sb, userId, p.id); // resume after an approval or a restart (no-op if driving)
  return ps.map(({ p, meta }) => chainView(p, meta, kids.get(p.id) ?? []));
}

const PARENT_COLS = "id, status, request, project_id";

export async function getChain(sb: SupabaseClient, userId: string, id: string): Promise<ChainView | null> {
  const { data, error } = await sb.from("tasks").select(PARENT_COLS).eq("id", id).is("parent_id", null).maybeSingle();
  if (error) throw error;
  return data ? (await views(sb, userId, [data as Parent]))[0] ?? null : null;
}

export async function listChains(sb: SupabaseClient, userId: string): Promise<ChainView[]> {
  const { data, error } = await sb.from("tasks").select(PARENT_COLS).is("parent_id", null).like("title", `${CHAIN_TITLE}%`)
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return views(sb, userId, (data ?? []) as Parent[]);
}

/** For a server-side tick: continue this user's running chains. */
export async function resumeChains(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("tasks").select("id, request").eq("user_id", userId).is("parent_id", null).eq("status", "running").like("title", `${CHAIN_TITLE}%`);
  for (const p of data ?? []) if (parseMeta(p.request)) void drive(sb, userId, p.id);
}

/** Cancel the chain, its running step and every step not started yet. False when there's nothing to cancel. */
export async function cancelChain(sb: SupabaseClient, id: string): Promise<boolean> {
  const { data: p } = await sb.from("tasks").select("id, request").eq("id", id).is("parent_id", null).maybeSingle(); // RLS-scoped
  if (!p || !parseMeta(p.request)) return false;
  const { data: hit } = await sb.from("tasks").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "running").select("id");
  if (!hit?.length) return false;
  live().get(id)?.abort(); // stops the step running inside drive()
  await stopKids(sb, (await loadKids(sb, [id])).get(id) ?? []);
  return true;
}

/** Stop a cancelled chain's steps. A step waiting for approval is cancelled too (CAS on status, so it can never run its actions later). */
async function stopKids(sb: SupabaseClient, kids: ChildRow[]) {
  for (const k of kids) {
    if (k.status === "queued" || k.status === "running") await cancelTask(sb, k.id).catch(() => false);
    else if (k.status === "awaiting_approval") {
      await sb.from("tasks").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", k.id).eq("status", "awaiting_approval");
    }
  }
}

async function finish(sb: SupabaseClient, id: string, status: string, result: string | null, error: string | null) {
  await sb.from("tasks").update({ status, result, error, finished_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
}

/** Run the chain's next steps in order until it ends, waits for an approval, or is cancelled. Idempotent: one driver per chain. */
export async function drive(sb: SupabaseClient, userId: string, id: string) {
  if (driving.has(id)) return;
  driving.add(id);
  const ac = new AbortController();
  live().set(id, ac);
  try {
    for (;;) {
      const { data: p } = await sb.from("tasks").select(PARENT_COLS).eq("id", id).maybeSingle();
      const meta = p ? parseMeta(p.request) : null;
      if (!p || !meta || p.status !== "running") return;
      const kids = (await loadKids(sb, [id])).get(id) ?? [];
      if (ac.signal.aborted) { // cancelTask(chainId) from AGENTS/OPERATIONS
        await finish(sb, id, "cancelled", null, null);
        await stopKids(sb, kids);
        return;
      }
      const move = nextMove(meta, kids);
      if (move.do === "wait") return;
      if (move.do === "finish") return void (await finish(sb, id, move.status, move.result, move.error));
      if (move.do === "busy") {
        // Not ours (we await our own steps): an approval executing in resolvePending, or orphaned by a restart.
        if (live().has(move.task.id) || Date.parse(move.task.started_at ?? "") > Date.now() - STALE_MS) return;
        await sb.from("tasks").update({ status: "failed", error: "Interrupted (ORBIT restarted)", finished_at: new Date().toISOString() }).eq("id", move.task.id).eq("status", "running");
        continue;
      }
      // run: wait for a free agent slot (shared with kickQueue), then run the step like any task.
      while (slots().size >= MAX_RUNNING && !ac.signal.aborted) await sleep(3000);
      if (ac.signal.aborted) continue;
      slots().add(move.task.id); // claim the slot before any await, so kickQueue can't take it meanwhile
      try {
        if (move.prev) {
          const own = move.task.request.slice(0, meta.steps[move.k].len);
          await sb.from("tasks").update({ request: composeRequest(own, move.prev.agent, move.prev.result) }).eq("id", move.task.id).eq("status", "queued");
        }
        await runTask(sb, userId, move.task.id, 0, undefined, ac.signal);
      }
      finally { slots().delete(move.task.id); void kickQueue(sb, userId); }
    }
  } catch (e) {
    console.error("[orbit] chain runner failed:", id, e instanceof Error ? e.message : e);
  } finally {
    if (live().get(id) === ac) live().delete(id);
    driving.delete(id);
  }
}
