import { foreground } from "./foreground-pure";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelTask, getAgent, kickQueue, runTask } from "./agents";
import { stopAllOn } from "./stop-all";
import { createBudget, emit } from "./claude";
import { interruptedPatch } from "./completion-pure";
import { COMPANY_PREFIX, resolvedStep, roleOf, stepStatus } from "./company-pure";
import { CHAIN_TITLE, byStep, chainView, composeRequest, nextMove, parseMeta, stepTitle, toMeta, validateChain, type ChainView, type ChildRow } from "./chains-pure";

// AGENT TEAMS runner: the chain lives in the tasks table (see chains-pure.ts), so it survives restarts. drive() walks the steps in order,
// one at a time per chain, and stops at an approval; resumeChains (the scheduler tick) picks it up again. Reads never drive
// (OPS08: proven by tests/mission-scenario.test.ts "chain runs to the end from scheduler ticks alone").

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
// start false: only create the rows (the night shift then drives it step by step within its budget). company: an AGENTS company chain.
export async function createChain(sb: SupabaseClient, userId: string, body: unknown, prefix = CHAIN_TITLE, start = true, company = false): Promise<{ chainId: string } | { error: string }> {
  const d = validateChain(body);
  if (typeof d === "string") return { error: d };
  for (const st of d.steps) if (!(await getAgent(sb, st.agent, userId))) return { error: `Unknown agent "${st.agent}"` };
  const { data: parent, error } = await sb.from("tasks").insert({
    user_id: userId, agent: "nova", title: `${prefix}${d.goal}`.slice(0, 200), request: JSON.stringify(toMeta(d, company)), status: "running",
  }).select("id").single(); // started_at stays null: the stale-task sweep only touches rows with a started_at
  if (error) return { error: error.message };
  driving.add(parent.id); // so a scheduler resume can't start a driver before the step rows exist
  const { error: kidsErr } = await sb.from("tasks").insert(d.steps.map((st, k) => ({
    user_id: userId, parent_id: parent.id, agent: st.agent, title: stepTitle(k, d.steps.length, st.agent, st.request), request: st.request,
  })));
  driving.delete(parent.id);
  if (kidsErr) {
    await sb.from("tasks").delete().eq("id", parent.id);
    return { error: kidsErr.message };
  }
  if (start) void drive(sb, userId, parent.id);
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

async function views(sb: SupabaseClient, parents: Parent[]): Promise<ChainView[]> {
  const ps = parents.flatMap((p) => { const meta = parseMeta(p.request); return meta ? [{ p, meta }] : []; });
  const kids = await loadKids(sb, ps.map((x) => x.p.id));
  return ps.map(({ p, meta }) => chainView(p, meta, kids.get(p.id) ?? []));
}

const PARENT_COLS = "id, status, request, project_id";

export async function getChain(sb: SupabaseClient, _userId: string, id: string): Promise<ChainView | null> {
  const { data, error } = await sb.from("tasks").select(PARENT_COLS).eq("id", id).is("parent_id", null).maybeSingle();
  if (error) throw error;
  return data ? (await views(sb, [data as Parent]))[0] ?? null : null;
}

export async function listChains(sb: SupabaseClient, _userId: string): Promise<ChainView[]> {
  const { data, error } = await sb.from("tasks").select(PARENT_COLS).is("parent_id", null).like("title", `${CHAIN_TITLE}%`)
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return views(sb, (data ?? []) as Parent[]);
}

/** For a server-side tick: continue this user's running chains. skipCompany: in the night window, company chains are the night shift's (its budget). */
export async function resumeChains(sb: SupabaseClient, userId: string, skipCompany = false) {
  const { data } = await sb.from("tasks").select("id, request").eq("user_id", userId).is("parent_id", null).eq("status", "running").like("title", `${CHAIN_TITLE}%`);
  for (const p of data ?? []) { const m = parseMeta(p.request); if (m && !(skipCompany && m.company)) void drive(sb, userId, p.id); }
}

/** Running company chains with each step's status and call cap, for the night shift's planner (night-pure companySteps). Never drives. */
export async function openCompanyChains(sb: SupabaseClient, userId: string) {
  const { data, error } = await sb.from("tasks").select("id, request").eq("user_id", userId).is("parent_id", null).eq("status", "running")
    .like("title", `${CHAIN_TITLE}${COMPANY_PREFIX}%`).limit(10);
  if (error) throw error;
  const ps = (data ?? []).flatMap((p) => { const meta = parseMeta(p.request); return meta?.company ? [{ id: p.id as string, meta }] : []; });
  const kids = await loadKids(sb, ps.map((p) => p.id));
  return ps.map(({ id, meta }) => ({ id, goal: meta.goal,
    steps: byStep(meta, kids.get(id) ?? []).map((c, k) => ({ status: c?.status ?? "failed", calls: meta.steps[k].calls })) }));
}

/** agents.ts resolvePending → the company.step event for a chain step whose approval was just resolved (no-op for other tasks). */
export async function stepResolved(sb: SupabaseClient, userId: string, chainId: string, agent: string, status: string, approved: boolean) {
  const { data: p } = await sb.from("tasks").select("request").eq("id", chainId).maybeSingle();
  const ev = resolvedStep(p?.request ?? null, agent, status, approved);
  if (ev) await emit(sb, userId, "company.step", "agents", { chain: chainId, ...ev });
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

/** Wait for one of kickQueue's agent slots, run fn holding it, then free it. False (fn not run) when `signal` aborts first.
 *  Shared by team chains and goal steps (src/lib/goals.ts), so neither can push past MAX_RUNNING. */
// ready: re-checked once the slot is ours, right before fn (a pause/cancel during the wait must not start the step).
export async function withSlot(sb: SupabaseClient, userId: string, taskId: string, signal: AbortSignal, fn: () => Promise<unknown>, ready?: () => Promise<boolean>): Promise<boolean> {
  while (slots().size >= MAX_RUNNING && !signal.aborted) await sleep(3000);
  if (signal.aborted || stopAllOn()) return false; // Stop-all while waiting for capacity: the step stays queued; resumeChains runs it after Resume
  slots().add(taskId); // claim the slot before any await, so kickQueue can't take it meanwhile
  try { if (ready && !(await ready())) return false; await fn(); return true; }
  finally { slots().delete(taskId); void kickQueue(sb, userId); }
}

/** Run the chain's next steps in order until it ends, waits for an approval, is cancelled, or has run maxSteps steps (the night shift: 1).
 *  gate: MISSIONS pause, checked before each step.
 *  Idempotent: one driver per chain. Returns the last step it ran and runTask's status, or null when it ran none. */
export async function drive(sb: SupabaseClient, userId: string, id: string, gate?: () => Promise<boolean>, maxSteps = Infinity): Promise<{ taskId: string; status: string } | null> {
  let last: { taskId: string; status: string } | null = null, ran = 0, blocked = false;
  if (driving.has(id) || stopAllOn()) return last; // Stop-all: no driver; the chain row stays "running" and resumeChains drives it after Resume
  driving.add(id);
  const ac = new AbortController();
  live().set(id, ac);
  try {
    for (;;) {
      if (gate) await foreground.idle(); // missions (gated drives) let a live CORE turn go first, then continue at this step
      if (stopAllOn()) return last; // Stop-all (maybe set by another process): no next step; the chain stays "running" for resumeChains
      const { data: p } = await sb.from("tasks").select(PARENT_COLS).eq("id", id).maybeSingle();
      const meta = p ? parseMeta(p.request) : null;
      if (!p || !meta || p.status !== "running") return last;
      const kids = (await loadKids(sb, [id])).get(id) ?? [];
      if (ac.signal.aborted) { // cancelTask(chainId) from AGENTS/OPERATIONS
        await finish(sb, id, "cancelled", null, null);
        await stopKids(sb, kids);
        return last;
      }
      const move = nextMove(meta, kids);
      if (move.do === "wait") return last;
      if (move.do === "finish") { await finish(sb, id, move.status, move.result, move.error); return last; }
      if (move.do === "busy") {
        // Not ours (we await our own steps): an approval executing in resolvePending, or orphaned by a restart.
        if (live().has(move.task.id) || Date.parse(move.task.started_at ?? "") > Date.now() - STALE_MS) return last;
        const { data: t } = await sb.from("tasks").select("pending").eq("id", move.task.id).maybeSingle();
        await sb.from("tasks").update(interruptedPatch(t?.pending, "Interrupted (ORBIT restarted)")).eq("id", move.task.id).eq("status", "running");
        continue;
      }
      if (gate && !(await gate())) return last;
      if (ran >= maxSteps) return last;
      ran++;
      // run: wait for a free agent slot (shared with kickQueue), then run the step like any task.
      const ready = async () => { // state may have changed while waiting for the slot: chain cancelled/finished, step taken, mission paused
        const { data: now } = await sb.from("tasks").select("id, status").in("id", [id, move.task.id]);
        const st = new Map((now ?? []).map((r) => [r.id, r.status]));
        return st.get(id) === "running" && st.get(move.task.id) === "queued" && (!gate || (await gate()));
      };
      const started = await withSlot(sb, userId, move.task.id, ac.signal, async () => {
        if (move.prev) {
          const own = move.task.request.slice(0, meta.steps[move.k].len);
          await sb.from("tasks").update({ request: composeRequest(own, move.prev.agent, move.prev.result) }).eq("id", move.task.id).eq("status", "queued");
        }
        const st = meta.steps[move.k], role = meta.company ? roleOf(st.agent) : null; // company runs log ids/roles only to the ledger
        if (role) await emit(sb, userId, "company.step", "agents", { chain: id, role, status: "started" });
        const r = await runTask(sb, userId, move.task.id, 0, st.calls || st.minutes ? createBudget(st.minutes ? st.minutes * 60_000 : undefined, st.calls) : undefined, ac.signal, { tools: st.tools, priv: st.priv });
        last = { taskId: move.task.id, status: r.status };
        if (r.status === "blocked") { blocked = true; return; } // 0021 missing: the step stays queued, the drive stops (not failed)
        if (role) await emit(sb, userId, "company.step", "agents", { chain: id, role, status: stepStatus(r.status) });
      }, ready);
      if ((!started && !ac.signal.aborted) || blocked) return last;
    }
  } catch (e) {
    console.error("[orbit] chain runner failed:", id, e instanceof Error ? e.message : e);
    return last;
  } finally {
    if (live().get(id) === ac) live().delete(id);
    driving.delete(id);
  }
}
