// Nightly real CORE exam. LIFE cases are local-only; every live request is synthetic and tagged for cleanup.
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORBIT_EXAM_TASKS } from "../../evals/orbit-exam.ts";
import { newRunId, gradeRun } from "./eval-core-pure.ts";
import { cleanupEvalRun } from "./eval-run.ts";
import { orbitDataDir } from "./data-dir.ts";
import { readStore, writeStore } from "./safe-file.ts";
import { allows } from "./autonomy.ts";
import { stopAllOn } from "./stop-all.ts";
import { usageHold } from "./usage-meter.ts";
import { logActivity } from "./activity.ts";

type Row = { id: string; planet: string; ok: boolean; fails: string[]; ms: number; localOnly?: boolean };
export type ExamRun = { runId: string; at: string; score: number; total: number; passed: number; rows: Row[] };
const file = () => path.join(orbitDataDir(), "orbit-exam.json");
const g = globalThis as unknown as { __orbitExamRun?: Promise<unknown> };
const load = async (): Promise<ExamRun[]> => {
  try { const x = JSON.parse(await readStore(file())); return Array.isArray(x) ? x.filter((r) => r && typeof r.runId === "string") : []; }
  catch { return []; }
};

/** One Tallinn-local nightly run; no journal/LIFE prompt or result is ever included. */
export function maybeOrbitExam(sb: SupabaseClient, userIds: string[]) {
  if (g.__orbitExamRun || !userIds[0] || stopAllOn() || usageHold() || !allows("operator-build", "background").ok) return;
  const pending = startExam(sb, userIds[0]).finally(() => { g.__orbitExamRun = undefined; });
  g.__orbitExamRun = pending;
  return pending;
}
export const orbitExamRunning = () => !!g.__orbitExamRun;

async function startExam(sb: SupabaseClient, userId: string) {
  const models = await import("./claude.ts").then((c) => [c.MODEL, c.FAST_MODEL, c.DEEP_MODEL]);
  if (models.some((m) => /fable/i.test(m))) { console.warn("[orbit] nightly exam skipped: Fable is not an exam model"); return; }
  const now = new Date(), today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tallinn" }).format(now);
  const latest = (await orbitExamView()).today;
  if (latest?.at && new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tallinn" }).format(Date.parse(latest.at)) === today) return;
  return runExam(sb, userId);
}

async function runExam(sb: SupabaseClient, userId: string) {
  const { coreTurn } = await import("./core-turn.ts");
  const runId = newRunId(new Date(), randomBytes(6).toString("hex"));
  const rows: Row[] = [];
  try {
    for (const task of ORBIT_EXAM_TASKS) {
      if (stopAllOn() || usageHold()) break;
      if (task.gpu) {
        const { gpuNow, pause } = await import("./gpu-lock.ts");
        while (gpuNow().busy && !stopAllOn() && !usageHold()) await pause(60_000);
        if (stopAllOn() || usageHold()) break;
      }
      if (task.localOnly) { rows.push({ id: task.id, planet: task.planet ?? "LIFE", ok: true, fails: [], ms: 0, localOnly: true }); continue; }
      const start = Date.now();
      const res = await coreTurn(new Request("http://127.0.0.1/api/core", { method: "POST" }), sb, userId,
        { message: task.input, requestId: `exam-${task.id}-${start}`, evalRun: runId });
      const body = await res.json().catch(() => ({})) as { answer?: unknown; trace?: unknown; error?: unknown };
      const result = !res.ok ? { ok: false, fails: [`turn failed: ${String(body.error ?? res.status).slice(0, 120)}`] }
        : gradeRun(task, { answer: String(body.answer ?? ""), trace: Array.isArray(body.trace) ? body.trace as never[] : [] });
      rows.push({ id: task.id, planet: task.planet ?? "CORE", ...result, ms: Date.now() - start });
    }
    if (rows.length !== ORBIT_EXAM_TASKS.length) return null;
    const passed = rows.filter((r) => r.ok).length, run: ExamRun = { runId, at: new Date().toISOString(), score: rows.length ? Math.round(100 * passed / rows.length) : 0, total: rows.length, passed, rows };
    const kept = [...await load(), run].slice(-14);
    await writeStore(file(), JSON.stringify(kept));
    logActivity({ area: "system", title: `ORBIT exam: ${run.score}%`, detail: `${run.passed}/${run.total} tasks passed; ${rows.filter((r) => !r.ok).length} failed` });
    return run;
  } finally {
    await cleanupEvalRun(sb, userId, runId).catch((e) => console.error("[orbit] exam cleanup failed:", e instanceof Error ? e.message : e));
  }
}

export async function orbitExamView(now = Date.now()) {
  const runs = await load(), latest = [...runs].reverse().find((r) => r.at.slice(0, 10) === new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tallinn" }).format(now)) ?? runs.at(-1) ?? null;
  const week = runs.filter((r) => Date.parse(r.at) <= now - 6 * 86_400_000).at(-1) ?? null;
  const before = new Map((week?.rows ?? []).map((r) => [r.id, r.ok]));
  const worse = (latest?.rows ?? []).filter((r) => !r.ok && before.get(r.id) === true).map((r) => ({ id: r.id, planet: r.planet }));
  return { today: latest ? { score: latest.score, passed: latest.passed, total: latest.total, at: latest.at } : null,
    lastWeek: week ? { score: week.score, passed: week.passed, total: week.total, at: week.at } : null, worse };
}

