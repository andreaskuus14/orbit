import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, FAST_MODEL, recordUsage } from "./claude";
import { usageHold } from "./usage-meter";
import { isoWeek } from "./health-pure";
import { IMPROVE_SYSTEM, applyPolish, candidates, improvePrompt, parseCallTurns, rankTasks, type Improve, type ImproveIn, type LessonRow, type NightFail } from "./self-improve-pure";

// Weekly self-improvement IO (rules: self-improve-pure.ts). Run from the night shift's health slot; does real work at most once per ISO week,
// with at most one fast-model call (skipped under usage holds; rule text is the fallback). Read-only: no code changes, no GitHub writes.
// State: <ORBIT data dir>/self-improve.json (redacted text only).

const file = () => path.join(orbitDataDir(), "self-improve.json");
const WEEK = 7 * 86_400_000, LOG_TAIL = 1024 * 1024;
const soft = <T>(p: Promise<T>, fb: T, name: string) => p.catch((e) => { console.warn(`[self-improve] ${name} skipped:`, e instanceof Error ? e.message : e); return fb; });

const load = async (): Promise<Improve | null> => { try { return JSON.parse(await readFile(file(), "utf8")) as Improve; } catch { return null; } };

// shortcut: call turns come from the last 1 MB of orbit-server.log (lines carry no date), fine while calls are a few dozen a week.
async function logTail(): Promise<string> {
  const f = path.join(process.cwd(), "orbit-server.log"), s = await stat(f);
  const fh = await open(f, "r");
  try {
    const start = Math.max(0, s.size - LOG_TAIL), buf = Buffer.alloc(s.size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally { await fh.close(); }
}

async function nightFails(sb: SupabaseClient, userId: string, now: number): Promise<NightFail[]> {
  const { data } = await sb.from("events").select("payload").eq("user_id", userId).eq("type", "night.task").gte("created_at", new Date(now - WEEK).toISOString()).limit(500);
  const st = JSON.parse(await readFile(path.join(orbitDataDir(), "night.json"), "utf8").catch(() => "{}")) as { users?: Record<string, { run?: { items?: { kind: string; status: string; why?: string }[] } }> };
  const why = new Map((st.users?.[userId]?.run?.items ?? []).filter((i) => i.status === "failed" && i.why).map((i) => [i.kind, i.why!]));
  const by = new Map<string, NightFail>();
  for (const { payload: p } of (data ?? []) as { payload: { kind?: string; status?: string } }[]) {
    const k = String(p?.kind ?? "unknown"), f = by.get(k) ?? { kind: k, failed: 0, total: 0, why: why.get(k) };
    f.total++; if (p?.status === "failed") f.failed++;
    by.set(k, f);
  }
  return [...by.values()];
}

export async function gatherImprove(sb: SupabaseClient, userId: string, now = Date.now()): Promise<ImproveIn> {
  const [health, score, log, lessons, night] = await Promise.all([
    soft(import("./health").then((m) => m.healthIssues()), [], "health"),
    soft(import("./agent-replay").then((m) => m.scorecardView()), null, "scorecard"),
    soft(logTail(), "", "call log"),
    soft(readFile(path.join(orbitDataDir(), "lessons.json"), "utf8").then((t) => (JSON.parse(t) as { users?: Record<string, { lessons?: LessonRow[] }> }).users?.[userId]?.lessons ?? []), [], "lessons"),
    soft(nightFails(sb, userId, now), [], "night"),
  ]);
  return { now, health, scorecard: score?.cases ?? [], calls: parseCallTurns(log), lessons, night };
}

/** Night-shift hook: builds this week's tasks once (claimed before the model call, so a crash can't call twice). Never throws. */
export async function maybeSelfImprove(sb: SupabaseClient, userId: string, signal?: AbortSignal, now = Date.now()): Promise<number> {
  try {
    const week = isoWeek(now), prev = await load();
    if (prev?.week === week) return 0;
    let tasks = rankTasks(candidates(await gatherImprove(sb, userId, now)));
    const r: Improve = { week, at: new Date(now).toISOString(), model: false, tasks };
    await save(r);
    if (tasks.length && !signal?.aborted && !usageHold()) {
      try {
        const a = await askClaude(improvePrompt(tasks), IMPROVE_SYSTEM, { lane: "background", model: FAST_MODEL, purpose: "self-improve", timeoutMs: 90_000, signal });
        await recordUsage(sb, userId, "self-improve", a, FAST_MODEL);
        const p = applyPolish(tasks, a.text);
        tasks = p.tasks;
        if (p.used) await save({ ...r, tasks, model: true });
      } catch (e) { console.error("[self-improve] model note failed:", e instanceof Error ? e.message : e); }
    }
    return tasks.length;
  } catch (e) { console.error("[self-improve] failed:", e instanceof Error ? e.message : e); return 0; }
}

async function save(r: Improve) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(r));
  await rename(file() + ".tmp", file());
}

/** For the Doctor card and the weekly review: the stored week, or (before the first night run) a live rule-only ranking that isn't saved. */
export async function improveView(sb: SupabaseClient, userId: string): Promise<Improve> {
  const r = await load();
  if (r) return r;
  const now = Date.now();
  return { week: isoWeek(now), at: new Date(now).toISOString(), model: false, tasks: rankTasks(candidates(await gatherImprove(sb, userId, now))) };
}
