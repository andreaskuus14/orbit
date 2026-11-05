// Daily runs, IO side (rules and states: daily-pure.ts). Reads each workflow's own records — Supabase `briefings`/`job_runs`,
// the STUDIO job files, the business-loop automation and its agent tasks — and sends one label-only digest a day to the phone
// (ntfy). Read-only apart from <data dir>/daily.json (the day the digest went out). Never throws out of the scheduler.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { localDay } from "./morning-pure";
import { rowReceipt } from "./receipt-pure";
import { BUSINESS_LOOP } from "./business-loop-pure";
import { briefState, clipsState, dailyText, digestDue, digestMsg, leadsState, type DailyItem, type DailyView } from "./daily-pure";

const file = () => path.join(orbitDataDir(), "daily.json");
const startOfDay = (now: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const pad = (n: unknown) => String(typeof n === "number" ? n : 0).padStart(2, "0");
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

async function leads(sb: SupabaseClient, userId: string, now: number) {
  const { data: autos, error } = await sb.from("automations").select("id, name, enabled, schedule, prompt").eq("user_id", userId);
  if (error) throw error;
  // matched by the template's name or its first line, so a renamed copy still counts
  const a = (autos ?? []).find((x) => x.name === BUSINESS_LOOP.name || String(x.prompt).startsWith("Daily business loop"));
  if (!a) return leadsState({ automation: null, tasks: [] }, now);
  const s = (a.schedule ?? {}) as { hour?: number; minute?: number };
  const { data: tasks, error: te } = await sb.from("tasks").select("title, request, status, error, pending, trace, created_at")
    .eq("user_id", userId).eq("automation_id", a.id).is("parent_id", null).gte("created_at", startOfDay(now)).order("created_at", { ascending: false }).limit(3);
  if (te) throw te;
  return leadsState({
    automation: { enabled: a.enabled, time: `${pad(s.hour)}:${pad(s.minute)}` },
    tasks: (tasks ?? []).map((t) => ({ status: t.status, created_at: t.created_at, pending: t.pending, receipt: rowReceipt(t)?.status ?? null })),
  }, now);
}

/** Today's three workflows. A workflow whose records can't be read is "uncertain", never skipped. */
export async function dailyRuns(sb: SupabaseClient, userId: string, now = Date.now()): Promise<DailyView> {
  const items = await Promise.all([
    brief(sb, userId, now).catch((e) => failed("brief", e)),
    clips(now).catch((e) => failed("clips", e)),
    leads(sb, userId, now).catch((e) => failed("leads", e)),
  ]);
  return { day: localDay(new Date(now)), items };
}

/** CORE's daily_runs tool (read-only). */
export const runDailyTool = async (sb: SupabaseClient, userId: string) => dailyText(await dailyRuns(sb, userId));

/** Scheduler tick: the phone digest once a day from ORBIT_DAILY_DIGEST (default 10:30, "off" = never). Marked sent only
 *  when ntfy accepted it, so a phone that was unreachable gets it on a later tick. */
export async function maybeDailyDigest(sb: SupabaseClient, userId: string, now = Date.now()): Promise<boolean> {
  try {
    const day = localDay(new Date(now));
    const sent = await readFile(file(), "utf8").then((t) => (JSON.parse(t) as { sent?: string }).sent ?? null, () => null);
    if (!digestDue(process.env.ORBIT_DAILY_DIGEST, sent, day, now)) return false;
    const { ntfyReady, ntfySend } = await import("./ntfy");
    const c = ntfyReady();
    if (!c) return false; // no phone set up: the view still answers in CORE and /api/daily
    const m = digestMsg(await dailyRuns(sb, userId, now));
    if (!(await ntfySend({ ...m, ...(c.open ? { click: `${c.open}/` } : {}) }, now))) return false;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify({ sent: day }));
    await rename(file() + ".tmp", file());
    return true;
  } catch (e) {
    console.error("[daily] digest:", e instanceof Error ? e.message : e);
    return false;
  }
}
