// Background CORE turns that survive a restart, IO side (rules: bg-resume-pure.ts). One file per turn in <ORBIT data dir>/bg-turns/,
// atomic tmp + rename; a job-log lease (renewed every minute while the turn runs) keeps two ORBIT processes off the same turn.
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir.ts";
import { releaseLease, takeLease } from "./job-log";
import { parseBgTurn, resumeContext, resumeHistory, resumePlan, type BgTurn } from "./bg-resume-pure";

const LEASE_MS = 3 * 60_000, RENEW_MS = 60_000; // a dead process's lease frees within 3 minutes
const g = globalThis as unknown as { __orbitBgTurns?: Set<string> };
const active = (g.__orbitBgTurns ??= new Set()); // turns this process runs (its own lease would look free to it)
const dir = () => path.join(orbitDataDir(), "bg-turns");
const file = (taskId: string) => path.join(dir(), `${taskId.replace(/[^\w-]/g, "_")}.json`);
const lease = (taskId: string) => `bgturn:${taskId}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function save(r: BgTurn) {
  await mkdir(dir(), { recursive: true });
  await writeFile(file(r.taskId) + ".tmp", JSON.stringify(r));
  await rename(file(r.taskId) + ".tmp", file(r.taskId));
}

/** Keep `r` on disk and leased while its turn runs here. The returned stop() is called once it reached a resting state (done or
 *  failed with its message in the chat): the record goes. A crash never calls it, so the boot sweep finds the record. */
export async function trackTurn(r: BgTurn): Promise<() => Promise<void>> {
  active.add(r.taskId);
  await save(r).catch((e) => console.error("[orbit] background turn record:", msg(e))); // without it the turn still runs, just not resumable
  await takeLease(lease(r.taskId), LEASE_MS).catch(() => false);
  const t = setInterval(() => void takeLease(lease(r.taskId), LEASE_MS).catch(() => false), RENEW_MS);
  t.unref?.();
  return async () => {
    clearInterval(t);
    await unlink(file(r.taskId)).catch(() => {});
    await releaseLease(lease(r.taskId)).catch(() => {});
    active.delete(r.taskId);
  };
}

/** Scheduler tick (after Stop-all / usage checks): resume this user's background turns a previous ORBIT process left behind. Never throws. */
export async function resumeBackgroundTurns(sb: SupabaseClient, userId: string) {
  try {
    const names = await readdir(dir()).catch(() => [] as string[]);
    for (const n of names.filter((x) => x.endsWith(".json"))) {
      const r = parseBgTurn(await readFile(path.join(dir(), n), "utf8").then((t) => JSON.parse(t), () => null));
      if (!r || r.userId !== userId || active.has(r.taskId)) continue;
      if (!(await takeLease(lease(r.taskId), LEASE_MS).catch(() => false))) continue; // another live ORBIT runs it
      active.add(r.taskId);
      void resumeOne(sb, r).catch((e) => console.error("[orbit] background turn resume:", msg(e)));
    }
  } catch (e) { console.error("[orbit] background turn sweep:", msg(e)); }
}

async function resumeOne(sb: SupabaseClient, r: BgTurn) {
  const { finishBackground } = await import("./core-turn");
  const plan = resumePlan(r, Date.now());
  const stop = await trackTurn(r); // renews the lease taken above
  if (plan.do === "fail") return finishBackground(sb, r.userId, r.chatId, r.taskId, r.title, () => Promise.reject(Object.assign(new Error(plan.reason), { orbitReason: plan.reason })), stop);
  await sb.from("tasks").update({ status: "running", started_at: new Date().toISOString(), finished_at: null, error: null }).eq("user_id", r.userId).eq("id", r.taskId);
  const [{ runCoreFor }, { BACKGROUND_TURN_MS }, { chatProjectContext }, { coreSessionStore }, { parseLang }] = await Promise.all([import("./core"), import("./long-work-pure"), import("./core-chats"), import("./durable"), import("./i18n-pure")]);
  if (r.sessionId && !coreSessionStore.get(r.chatId)) coreSessionStore.set(r.chatId, { id: r.sessionId, resume: true });
  const run = async (signal: AbortSignal) => {
    for (;;) { // each try is counted on disk before it runs, so a crash mid-resume counts too
      r.attempts++;
      await save(r).catch(() => {});
      try {
        const { data, error } = await sb.from("messages").select("role, content").eq("conversation_id", r.chatId).order("created_at", { ascending: true }).limit(200);
        if (error) throw error;
        const history = resumeHistory((data ?? []) as { role: "user" | "assistant"; content: string }[], r.request).slice(-60);
        if (!history.length) throw new Error("the request is no longer in the chat");
        const project = await chatProjectContext(r.userId, r.chatId);
        return await runCoreFor(BACKGROUND_TURN_MS, true, sb, r.userId, history, undefined, signal, undefined, false, undefined, undefined, undefined, resumeContext(r) + project.text, project.tainted, project.memoryProject ?? "", r.chatId, parseLang(r.lang));
      } catch (e) {
        r.lastError = msg(e).slice(0, 300);
        const next = resumePlan(r, Date.now());
        if (next.do === "fail") throw Object.assign(new Error(next.reason), { orbitReason: next.reason });
      }
    }
  };
  return finishBackground(sb, r.userId, r.chatId, r.taskId, r.title, run, stop);
}
