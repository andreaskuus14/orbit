// Daily runs, IO side (rules and states: daily-pure.ts). Reads each workflow's own records — Supabase `briefings`/`job_runs`,
// the STUDIO job files, the business-loop automation and its agent tasks — and sends one label-only digest a day to the phone
// (ntfy). Read-only apart from <data dir>/daily.json (the day the digest went out). Never throws out of the scheduler.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir.ts";
import { localDay } from "./morning-pure.ts";
import { rowReceipt } from "./receipt-pure.ts";
import { BUSINESS_LOOP } from "./business-loop-pure.ts";
import { briefState, clipsState, dailyText, digestDue, digestMsg, leadsState, slotAt, type DailyItem, type DailyView, type DigestState, statusDue, statusOf } from "./daily-pure.ts";
import { describeTrigger, lastDue, type Schedule } from "./pure.ts";

const file = () => path.join(orbitDataDir(), "daily.json");
const startOfDay = (now: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const failed = (wf: DailyItem["wf"], e: unknown): DailyItem => ({ wf, state: "uncertain", verified: false, evidence: `couldn't read its records: ${e instanceof Error ? e.message.slice(0, 120) : "error"}` });

async function brief(sb: SupabaseClient, userId: string, now: number) {
  const since = startOfDay(now);
  const [b, r] = await Promise.all([
    sb.from("briefings").select("kind, created_at, article_count").eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }),
    sb.from("job_runs").select("status, detail, started_at").eq("user_id", userId).eq("job", "pulse").gte("started_at", since).order("started_at", { ascending: false }),
  ]);
  if (b.error) throw b.error;
  if (r.error) throw r.error;
  return briefState({ briefings: b.data ?? [], runs: r.data ?? [] }, now);
}

async function clips(now: number) {
  const { listJobs } = await import("./clips/factory");
  return clipsState(await listJobs(), now);
}

async function leads(sb: SupabaseClient, userId: string, now: number, exec: Exec) {
  const { data: autos, error } = await sb.from("automations").select("id, name, enabled, trigger, schedule, prompt, created_at").eq("user_id", userId);
  if (error) throw error;
  // matched by the template's name or its first line, so a renamed copy still counts; an enabled scheduled copy wins over a paused one
  const all = (autos ?? []).filter((x) => x.name === BUSINESS_LOOP.name || String(x.prompt).startsWith("Daily business loop"));
  const a = all.find((x) => x.enabled && x.trigger === "schedule" && x.schedule) ?? all[0];
  if (!a) return leadsState({ automation: null, tasks: [] }, now);
  if (a.trigger !== "schedule" || !a.schedule) return a.enabled ? { wf: "leads" as const, state: "idle" as const, verified: false, evidence: "the business loop runs when its event happens, not on a schedule" } : leadsState({ automation: { enabled: false, slot: 0, next: null, grace: 0, label: "" }, tasks: [] }, now);
  const s = a.schedule as Schedule;
  const slot = lastDue(s, new Date(now)).getTime();
  const later = s.every === "hour" ? null : lastDue(s, new Date(slotAt(now, "23:59"))).getTime(); // its slot today, if any
  const next = later !== null && later > now ? later : null;
  const since = next !== null ? startOfDay(now) : new Date(slot).toISOString(); // a run still due today: earlier runs don't count
  const { data: tasks, error: te } = await sb.from("tasks").select("id, title, request, status, error, pending, trace, created_at, started_at")
    .eq("user_id", userId).eq("automation_id", a.id).is("parent_id", null).gte("created_at", since).order("created_at", { ascending: false }).limit(3);
  if (te) throw te;
  return leadsState({
    automation: { enabled: a.enabled, slot, next, grace: (s.every === "hour" ? 0.5 : 3) * 3600_000, label: describeTrigger({ trigger: "schedule", schedule: s, event: null, kind_filter: null }), createdAt: a.created_at }, // grace: automations.ts automationDue
    tasks: (tasks ?? []).map((t) => ({ status: t.status, created_at: t.created_at, started_at: t.started_at, error: t.error, pending: t.pending, receipt: rowReceipt(t)?.status ?? null,
      ...(t.status === "running" ? { exec: exec(t.id, t.started_at) } : {}) })),
  }, now);
}

type Exec = (id: string, startedAt: string | null | undefined) => "active" | "restart" | "unknown" | "unchecked";
/** Today's three workflows. A workflow whose records can't be read is "uncertain", never skipped. `exec`: execution evidence
 *  for running tasks (agents.ts taskExecution; tests pass their own). */
export async function dailyRuns(sb: SupabaseClient, userId: string, now = Date.now(), exec?: Exec): Promise<DailyView> {
  const ev: Exec = exec ?? (await import("./agents").then((m) => m.taskExecution, () => () => "unchecked" as const)); // no evidence ≠ evidence of nothing
  const items = await Promise.all([
    brief(sb, userId, now).catch((e) => failed("brief", e)),
    clips(now).catch((e) => failed("clips", e)),
    leads(sb, userId, now, ev).catch((e) => failed("leads", e)),
  ]);
  return { day: localDay(new Date(now)), items };
}

/** CORE's daily_runs tool (read-only). */
export const runDailyTool = async (sb: SupabaseClient, userId: string) => dailyText(await dailyRuns(sb, userId));

/** Scheduler tick: the phone digest once a day from ORBIT_DAILY_DIGEST (default 10:30, "off" = never). The try is saved before
 *  sending (no save, no send), so a failed "sent" mark or a down ntfy server means one retry per 30 min, not one per tick.
 *  Quiet hours and Stop-all hold it before any records are read. */
type Phone = { ready: () => { open: string } | null; allowed: (kind: string, now: number) => boolean; send: (m: ReturnType<typeof digestMsg>, now: number) => Promise<"sent" | "refused" | "unknown"> };
const phone = async (): Promise<Phone> => {
  const [{ ntfyReady, ntfyPublish, quietHours }, { ntfyAllowed }, { stopAllOn }] = await Promise.all([import("./ntfy"), import("./ntfy-pure"), import("./stop-all")]);
  return { ready: ntfyReady, allowed: (k, n) => ntfyAllowed(k, n, quietHours(), stopAllOn()), send: async (m, n) => { const r = await ntfyPublish(m, n); return r === "held" ? "refused" : r; } };
};

export async function maybeDailyDigest(sb: SupabaseClient, userId: string, now = Date.now(), load: () => Promise<Phone> = phone): Promise<boolean> {
  try {
    const day = localDay(new Date(now));
    const st = await readFile(file(), "utf8").then((t) => JSON.parse(t) as DigestState, () => ({}) as DigestState);
    if (!digestDue(process.env.ORBIT_DAILY_DIGEST, st, day, now)) return false;
    const ph = await load(), c = ph.ready();
    if (!c || !ph.allowed("daily", now)) return false; // no phone set up, quiet hours, or Stop-all
    await writeState({ tried: new Date(now).toISOString() }); // no save, no send
    const m = digestMsg(await dailyRuns(sb, userId, now));
    const r = await ph.send({ ...m, ...(c.open ? { click: `${c.open}/` } : {}) }, now);
    // "unknown" (timeout, dropped connection) may have reached the phone: counted as sent, like the saved try if this write fails
    await writeState(r === "refused" ? { tried: new Date(now).toISOString(), failed: true } : { sent: day });
    return r === "sent";
  } catch (e) {
    console.error("[daily] digest:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function writeState(st: DigestState) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(st));
  await rename(file() + ".tmp", file());
}

/** Scheduler tick, after briefings: one "daily.status" event a day (brief / clips / leads: done, needs-you or running), what the
 *  phone digest shows. The day is saved before emitting (no save, no emit), so it never goes out twice. Never throws. */
export async function maybeDailyStatus(sb: SupabaseClient, userId: string, now = Date.now(), emit?: (data: Record<string, unknown>) => Promise<unknown>): Promise<boolean> {
  try {
    const day = localDay(new Date(now)), f = path.join(orbitDataDir(), "daily-status.json");
    const st = await readFile(f, "utf8").then((t) => JSON.parse(t) as { day?: string }, () => ({}) as { day?: string });
    if (!statusDue(process.env.ORBIT_DAILY_DIGEST, st.day, day, now)) return false;
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f + ".tmp", JSON.stringify({ day }));
    await rename(f + ".tmp", f);
    const data = { day, ...statusOf(await dailyRuns(sb, userId, now)) };
    await (emit ?? ((d) => import("./claude").then((m) => m.emit(sb, userId, "daily.status", "core", d))))(data);
    return true;
  } catch (e) {
    console.error("[daily] status:", e instanceof Error ? e.message : e);
    return false;
  }
}
