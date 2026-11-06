// Background CORE turns that survive a restart, IO side (rules: bg-resume-pure.ts). One file per turn in <ORBIT data dir>/bg-turns/,
// atomic tmp + rename; a job-log lease (renewed every minute while the turn runs) keeps two ORBIT processes off the same turn.
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir.ts";
import { releaseLease, takeLease } from "./job-log.ts";
import { registerSource } from "./execution.ts";
import { parseBgTurn, resumeContext, resumeHistory, resumePlan, type BgTurn } from "./bg-resume-pure.ts";

const LEASE_MS = 3 * 60_000, RENEW_MS = 60_000; // a dead process's lease frees within 3 minutes
const g = globalThis as unknown as { __orbitBgTurns?: Set<string>; __orbitBgGaveUp?: Set<string> };
const active = (g.__orbitBgTurns ??= new Set()); // turns this process runs (its own lease would look free to it)
registerSource("bg-turns", (taskId) => active.has(taskId)); // execution evidence: a background CORE turn runs it here now
// finished here, but the record couldn't be deleted (Windows lock, read-only file): don't resume it again every tick
const gaveUp = (g.__orbitBgGaveUp ??= new Set());
const dir = () => path.join(orbitDataDir(), "bg-turns");
const file = (taskId: string) => path.join(dir(), `${taskId.replace(/[^\w-]/g, "_")}.json`);
const lease = (taskId: string) => `bgturn:${taskId}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Task ids with a background-turn record on disk: running here or waiting for the boot sweep to resume them. The interrupted-task
 *  sweeps leave these rows "running" (bg-resume finishes them), so a Retry can't start a second copy as a plain agent task. */
export async function bgTurnIds(): Promise<Set<string>> {
  const names = await readdir(dir()).catch((e) => { if ((e as NodeJS.ErrnoException).code === "ENOENT") return [] as string[]; throw e; });
  return new Set([...active, ...names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5))]);
}

/** The chat up to the resumed request, newest 60 messages, in time order. Reads the NEWEST 200: ascending + limit gave the oldest
 *  200, so a long chat resumed without its latest instructions (or lost the request entirely). Exported for tests/bg-resume-io. */
export async function resumeRows(sb: SupabaseClient, chatId: string, request: string) {
  const { data, error } = await sb.from("messages").select("role, content").eq("conversation_id", chatId).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return resumeHistory(((data ?? []) as { role: "user" | "assistant"; content: string }[]).reverse(), request).slice(-60);
}

async function save(r: BgTurn) {
  await mkdir(dir(), { recursive: true });
  await writeFile(file(r.taskId) + ".tmp", JSON.stringify(r));
  await rename(file(r.taskId) + ".tmp", file(r.taskId));
}

export type TurnStop = (() => Promise<void>) & { lost: AbortSignal; confirm: () => Promise<boolean> };

/** Keep `r` on disk and leased while its turn runs here. The returned stop() is called once it reached a resting state (done or
 *  failed with its message in the chat): the record goes. A crash never calls it, so the boot sweep finds the record.
 *  stop.lost aborts when this process no longer owns the turn: a renewal was refused (another ORBIT holds the lease), or, once
 *  the lease was ours, renewals kept failing until it could lapse. Then the turn stops and writes nothing; the record stays for
 *  the new owner. A lease that was never confirmed (unwritable data dir) never aborts a turn on errors: nobody else can own it.
 *  stop.confirm() renews right before the final writes, so a process that stalled past its lease can't write a stale answer. */
export async function trackTurn(r: BgTurn): Promise<TurnStop> {
  active.add(r.taskId);
  await save(r).catch((e) => console.error("[orbit] background turn record:", msg(e))); // a fresh turn still runs, just not resumable
  const lost = new AbortController();
  let confirmed = false, lastOk = 0; // lastOk: start time of the last successful renewal (the lease's `until` counts from then)
  const lose = (why: string) => { if (!lost.signal.aborted) { console.error(`[orbit] background turn ${r.taskId}: ${why}; stopping it here`); lost.abort(new Error(why)); } };
  const renew = async (): Promise<boolean> => {
    if (lost.signal.aborted) return false;
    const at = Date.now();
    try {
      if (await takeLease(lease(r.taskId), LEASE_MS)) { confirmed = true; lastOk = at; return true; }
      lose("another ORBIT process took it over");
      return false;
    } catch (e) {
      if (confirmed && Date.now() - lastOk >= LEASE_MS - RENEW_MS) { lose(`its lease couldn't be renewed (${msg(e)})`); return false; }
      return true; // still within our lease, or never confirmed (no one else can have it)
    }
  };
  await renew();
  const t = setInterval(() => void renew(), RENEW_MS);
  t.unref?.();
  return Object.assign(async () => {
    clearInterval(t);
    if (!lost.signal.aborted) { // the new owner needs the record and holds the lease
      await unlink(file(r.taskId)).catch((e) => { if ((e as NodeJS.ErrnoException).code !== "ENOENT") { gaveUp.add(r.taskId); console.error("[orbit] background turn record stays:", msg(e)); } });
      await releaseLease(lease(r.taskId)).catch(() => {});
    }
    active.delete(r.taskId);
  }, { lost: lost.signal, confirm: renew });
}

/** Scheduler tick (after Stop-all / usage checks): resume this user's background turns a previous ORBIT process left behind. Never throws. */
export async function resumeBackgroundTurns(sb: SupabaseClient, userId: string, load: () => Promise<ResumeDeps> = loadDeps) {
  try {
    const names = await readdir(dir()).catch(() => [] as string[]);
    for (const n of names.filter((x) => x.endsWith(".json"))) {
      const r = parseBgTurn(await readFile(path.join(dir(), n), "utf8").then((t) => JSON.parse(t), () => null));
      if (!r || r.userId !== userId || active.has(r.taskId) || gaveUp.has(r.taskId)) continue;
      if (!(await takeLease(lease(r.taskId), LEASE_MS).catch(() => false))) continue; // another live ORBIT runs it
      active.add(r.taskId);
      void resumeOne(sb, r, load).catch((e) => console.error("[orbit] background turn resume:", msg(e)));
    }
  } catch (e) { console.error("[orbit] background turn sweep:", msg(e)); }
}

// What a resume needs from the rest of ORBIT, loaded lazily (core.ts is heavy); tests/bg-resume-io passes fakes.
type ResumeDeps = {
  finishBackground: typeof import("./core-turn").finishBackground; runCoreFor: typeof import("./core").runCoreFor; BACKGROUND_TURN_MS: number;
  chatProjectContext: typeof import("./core-chats").chatProjectContext; coreSessionStore: typeof import("./durable").coreSessionStore; parseLang: typeof import("./i18n-pure").parseLang;
};
const loadDeps = async (): Promise<ResumeDeps> => {
  const [{ finishBackground }, { runCoreFor }, { BACKGROUND_TURN_MS }, { chatProjectContext }, { coreSessionStore }, { parseLang }] = await Promise.all([import("./core-turn"), import("./core"), import("./long-work-pure"), import("./core-chats"), import("./durable"), import("./i18n-pure")]);
  return { finishBackground, runCoreFor, BACKGROUND_TURN_MS, chatProjectContext, coreSessionStore, parseLang };
};

export const SAVE_FAILED = "ORBIT couldn't save this task's progress, so it stopped instead of running without a record. Ask again to restart it.";

async function resumeOne(sb: SupabaseClient, r: BgTurn, load: () => Promise<ResumeDeps>) {
  const { finishBackground, runCoreFor, BACKGROUND_TURN_MS, chatProjectContext, coreSessionStore, parseLang } = await load();
  const plan = resumePlan(r, Date.now());
  // Resume only a row still "running": cancelled, retried (queued, or claimed by kickQueue) or finished means someone else decided.
  const { data: mine, error: rowError } = await sb.from("tasks").update({ started_at: new Date().toISOString(), finished_at: null, error: null }).eq("user_id", r.userId).eq("id", r.taskId).eq("status", "running").select("id");
  if (rowError) { active.delete(r.taskId); await releaseLease(lease(r.taskId)).catch(() => {}); throw rowError; } // the record stays; the next sweep tries again
  const stop = await trackTurn(r); // renews the lease taken above
  if (!mine?.length) { await stop(); return null; } // the record goes: this turn is no longer ORBIT's to resume
  if (plan.do === "fail") return finishBackground(sb, r.userId, r.chatId, r.taskId, r.title, () => Promise.reject(Object.assign(new Error(plan.reason), { orbitReason: plan.reason })), stop);
  if (r.sessionId && !coreSessionStore.get(r.chatId)) coreSessionStore.set(r.chatId, { id: r.sessionId, resume: true });
  const run = async (signal: AbortSignal) => {
    for (;;) { // each try is counted on disk before it runs, so a crash mid-resume counts too
      signal.throwIfAborted(); // ownership lost: never write the new owner's record
      r.attempts++;
      // the count is what stops a crash loop (MAX_RESUMES): a try that can't be recorded doesn't run
      try { await save(r); } catch (e) { console.error("[orbit] background turn record:", msg(e)); throw Object.assign(new Error(SAVE_FAILED), { orbitReason: SAVE_FAILED }); }
      try {
        const history = await resumeRows(sb, r.chatId, r.request);
        if (!history.length) throw new Error("the request is no longer in the chat");
        const project = await chatProjectContext(r.userId, r.chatId);
        return await runCoreFor(BACKGROUND_TURN_MS, true, sb, r.userId, history, undefined, signal, undefined, false, undefined, undefined, undefined, resumeContext(r) + project.text, project.tainted, project.memoryProject ?? "", r.chatId, parseLang(r.lang));
      } catch (e) {
        if (signal.aborted) throw e; // ownership lost: don't retry here
        r.lastError = msg(e).slice(0, 300);
        const next = resumePlan(r, Date.now());
        if (next.do === "fail") throw Object.assign(new Error(next.reason), { orbitReason: next.reason });
      }
    }
  };
  return finishBackground(sb, r.userId, r.chatId, r.taskId, r.title, run, stop);
}
