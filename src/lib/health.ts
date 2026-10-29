import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, emit, FAST_MODEL, recordUsage } from "./claude";
import { readSince } from "./doctor-boot";
import { eventGaps, taintBroken } from "./durable";
import type { Mark } from "./doctor-boot-pure";
import { failedCallsSince, usageHold, usageView } from "./usage-meter";
import { coreStats, rollupScenes } from "./perf-pure";
import { coreTurns, sceneWindows } from "./perf-log";
import { listRuns } from "./perf-runs";
import { compareRuns, previousOf, regressionLines } from "./perf-run-pure";
import { HEALTH_SYSTEM, buildSamples, isoWeek, logSamples, mergeIssues, parseSummary, perfSamples, rollPerf, sortIssues, summaryPrompt, toSummarise, triage,
  type Issue, type PerfSnap, type Sample } from "./health-pure";

// Self-healing collector (rules: health-pure.ts). Run by the night shift's "health" slot: reads logs since its own cursor (separate from the
// boot self-test's), failed jobs, ledger failures, the usage meter and perf, triages, and writes one fast-model note for at most 3 new issues.
// Read-only: it never edits code, files issues or calls outside services. State: <ORBIT data dir>/health.json (redacted text only).

type Store = { server?: Mark | null; launcher?: Mark | null; build?: number; lastRun?: string; issues: Record<string, Issue>; perf: PerfSnap[] };
const file = () => path.join(orbitDataDir(), "health.json");
const DAY = 86_400_000, BUILD_CAP = 256 * 1024;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

async function load(): Promise<Store> {
  try {
    const j = JSON.parse(await readFile(file(), "utf8")) as Partial<Store>;
    return { ...j, issues: j.issues && typeof j.issues === "object" ? j.issues : {}, perf: Array.isArray(j.perf) ? j.perf : [] };
  } catch { return { issues: {}, perf: [] }; }
}
async function save(s: Store) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s));
  await rename(file() + ".tmp", file());
}

/** orbit-build.log is rewritten per build: scanned once whenever its mtime changes (the first run only records it). */
async function buildLog(prev: number | undefined): Promise<{ samples: Sample[]; mtime?: number }> {
  const f = path.join(process.cwd(), "orbit-build.log"), s = await stat(f).catch(() => null);
  if (!s || s.mtimeMs === prev) return { samples: [], mtime: prev };
  if (prev === undefined) return { samples: [], mtime: s.mtimeMs };
  const fh = await open(f, "r");
  try {
    const start = Math.max(0, s.size - BUILD_CAP), buf = Buffer.alloc(s.size - start);
    await fh.read(buf, 0, buf.length, start);
    return { samples: buildSamples(buf.toString("utf8"), new Date(s.mtimeMs).toISOString()), mtime: s.mtimeMs };
  } finally { await fh.close(); }
}

/** Failed clip jobs, AI Stories, agent tasks, deal/niche runs and ledger failures since `since`. Each source is best-effort. */
async function jobSamples(sb: SupabaseClient, userId: string, since: string): Promise<Sample[]> {
  const safe = <T>(p: Promise<T>, fb: T) => p.catch((e) => { console.error("[orbit] health source:", msg(e)); return fb; });
  const [clips, stories, tasks, deals, niche, events] = await Promise.all([
    safe(import("./clips/factory").then((m) => m.listJobs()), []),
    safe(import("./clips/story").then((m) => m.listStories()), []),
    safe(Promise.resolve(sb.from("tasks").select("agent, error, finished_at").eq("user_id", userId).eq("status", "failed").gte("finished_at", since).limit(50)).then((r) => r.data ?? []), []),
    safe(import("./deals").then((m) => m.dealBoard()), null),
    safe(import("./niche").then((m) => m.nicheBoard()), null),
    safe(Promise.resolve(sb.from("events").select("created_at, type, payload").eq("user_id", userId).in("type", ["night.task", "goal.step", "tool.call"]).gte("created_at", since).limit(500)).then((r) => r.data ?? []), []),
  ]);
  const out: Sample[] = [];
  for (const j of clips) if (j.status === "failed" && j.updatedAt > since) out.push({ source: "job", area: "studio", at: j.updatedAt, line: `clip job failed: ${j.error ?? j.step}` });
  for (const s of stories) if (s.status === "failed" && s.updatedAt > since) out.push({ source: "job", area: "studio", at: s.updatedAt, line: `AI Story failed (${s.error?.kind ?? "unknown"}): ${s.error?.message ?? s.step}` });
  for (const t of tasks as { agent: string; error: string | null; finished_at: string }[]) out.push({ source: "job", area: "agents", at: t.finished_at, line: `agent task (${t.agent}) failed: ${t.error ?? "no error text"}` });
  if (deals?.lastError && (deals.lastHunt ?? "") > since) out.push({ source: "job", area: "markets", at: deals.lastHunt!, line: `deal hunt failed: ${deals.lastError}` });
  if (niche?.lastError && (niche.lastAttempt ?? "") > since) out.push({ source: "job", area: "business", at: niche.lastAttempt!, line: `niche scout failed: ${niche.lastError}` });
  for (const e of events as { created_at: string; type: string; payload: Record<string, unknown> }[]) {
    const p = e.payload ?? {}, at = new Date(e.created_at).toISOString();
    if (e.type === "night.task" && p.status === "failed") out.push({ source: "ledger", at, line: `night shift ${String(p.kind)} task failed` });
    else if (e.type === "goal.step" && p.status === "failed") out.push({ source: "ledger", area: "agents", at, line: "goal step failed" });
    else if (e.type === "tool.call" && p.ok === false) out.push({ source: "ledger", area: "core", at, line: `tool ${String(p.tool)} call failed` });
  }
  for (const g of eventGaps()) if ((g.skipped || g.gaveUp) && g.skippedAt && g.skippedAt > since)
    out.push({ source: "job", area: "system", at: g.skippedAt, line: `${g.skipped} events skipped after long downtime, ${g.gaveUp} given up after crashing twice (${g.consumer})` });
  if (taintBroken()) out.push({ source: "job", area: "core", line: "core-taint.json (in the ORBIT data folder) is unreadable: every CORE chat is treated as holding private data, so web search, news and agents stay off in chats. Fix or delete the file and restart" });
  const u = usageView();
  if (u.limit) out.push({ source: "usage", area: "core", line: `Claude usage limit reached: background work paused until ${new Date(u.limit.until).toISOString()}` });
  for (const c of failedCallsSince(Date.parse(since))) out.push({ source: "usage", at: new Date(c.at).toISOString(), line: `Claude call failed (${c.purpose})` });
  return out;
}

/** This week's perf numbers: CORE p95 total per path (ring since the last restart) and galaxy fps per scene (last day of windows). */
function perfNow(now: number): PerfSnap {
  const core = Object.fromEntries(Object.entries(coreStats(coreTurns)).flatMap(([k, v]) => (v.stages.total ? [[k, v.stages.total.p95]] : [])));
  const fps = Object.fromEntries(Object.entries(rollupScenes(sceneWindows, now, DAY)).filter(([, r]) => r.windows >= 3).map(([k, r]) => [k, r.fps]));
  return { week: isoWeek(now), core, fps };
}

/** p95 regressions (>15%) in scripted perf runs (npm run perf:run) saved since the last health pass. */
async function perfRunSamples(since: string): Promise<Sample[]> {
  const runs = await listRuns(60).catch(() => []), from = Date.parse(since);
  return runs.filter((r) => r.at > from && !r.hidden).flatMap((r) => regressionLines(r, compareRuns(previousOf(runs, r), r)).map((line) => ({ source: "perf" as const, area: "system", at: new Date(r.at).toISOString(), line })));
}

/** The night shift's health slot. Returns how many issues are new/regressed and how many model notes were written. */
export async function runHealth(sb: SupabaseClient, userId: string, signal?: AbortSignal): Promise<{ fresh: number; notes: number; open: number }> {
  const st = await load(), now = Date.now(), nowIso = new Date(now).toISOString(), since = st.lastRun ?? new Date(now - DAY).toISOString();
  const [srv, lch, bld, jobs, runs] = await Promise.all([
    readSince(path.join(process.cwd(), "orbit-server.log"), st.server ?? null),
    readSince(path.join(process.cwd(), "orbit-launcher.log"), st.launcher ?? null),
    buildLog(st.build),
    jobSamples(sb, userId, since),
    perfRunSamples(since),
  ]);
  const perf = rollPerf(st.perf, perfNow(now));
  const samples = [...logSamples(srv.text, "server", nowIso), ...logSamples(lch.text, "launcher", nowIso), ...bld.samples, ...jobs, ...perfSamples(perf, nowIso), ...runs];
  const { issues, changed } = mergeIssues(st.issues, triage(samples, nowIso), nowIso);

  let notes = 0;
  for (const i of toSummarise(Object.values(issues))) {
    if (signal?.aborted || usageHold()) break;
    try {
      const r = await askClaude(summaryPrompt(i), HEALTH_SYSTEM, { lane: "background", model: FAST_MODEL, purpose: "health.summary", timeoutMs: 90_000, signal });
      await recordUsage(sb, userId, "health.summary", r, FAST_MODEL);
      const s = parseSummary(r.text);
      if (s) { issues[i.id] = { ...i, summary: s }; notes++; }
    } catch (e) { console.error("[orbit] health note failed:", msg(e)); }
  }
  // Cursors move only after a full pass, so a crash mid-run rescans the same part next night.
  await save({ server: srv.mark, launcher: lch.mark, build: bld.mtime, lastRun: nowIso, issues, perf });
  for (const c of changed.slice(0, 30)) await emit(sb, userId, "health.issue", "core", { issue: c.id, status: c.status }).catch(() => {});
  return { fresh: changed.filter((c) => c.status !== "resolved").length, notes, open: Object.values(issues).filter((i) => i.status !== "resolved").length };
}

/** For the Doctor panel's HEALTH card: issues sorted, everything already redacted. */
export async function healthView() {
  const st = await load();
  return { lastRun: st.lastRun ?? null, issues: sortIssues(Object.values(st.issues)).slice(0, 30) };
}

/** Known issues for the morning brief's health line. */
export const healthIssues = async () => Object.values((await load()).issues);
