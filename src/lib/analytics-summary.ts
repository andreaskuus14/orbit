// ANALYTICS: everything the planet shows, read and totalled on the server (GET /api/analytics/summary?days=7|30).
// The rows stay here; the browser gets a few KB. Each block is read on its own, so one failing source shows its own
// error and the rest still load. LIFE: counts only (getLifeLite: never journal text or notes), reduced again to numbers.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSummary, type Days } from "./analytics-summary-pure";
import type { TaskRow, UsageCostRow } from "./analytics-outcomes-pure";
import type { EventRow } from "./ledger-pure";
import { readAna } from "./analytics-store";
import { getLifeLite } from "./life";
import { bestStreak, todayCount, weekCompletion } from "./life-stats-pure";
import { usageView } from "./usage-meter";
import { scorecardView } from "./agent-replay";
import { listRuns } from "./perf-runs";
import { compareRuns, previousOf } from "./perf-run-pure";

const COLS = "id, parent_id, project_id, agent, title, status, error, pending, created_at, started_at, finished_at";
const PAGE = 1000, MAX_TASKS = 20_000, MAX_USAGE = 60_000;

async function pages<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, max: number): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}
const safe = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch (e) { console.error("[orbit] analytics block failed", e); return null; } };

export async function loadSummary(sb: SupabaseClient, days: Days, now = Date.now()) {
  const since = new Date(now - days * 86_400_000).toISOString();
  const [tasks, missions, usage, projects, events, runs, memories, messages, ana, life, scorecard, perf] = await Promise.all([
    pages<TaskRow>((a, b) => sb.from("tasks").select(COLS).gte("created_at", since).order("created_at", { ascending: false }).range(a, b), MAX_TASKS),
    safe(async () => (await pages<{ chain_id: string | null }>((a, b) => sb.from("missions").select("chain_id").gte("created_at", since).range(a, b), MAX_TASKS)).rows),
    safe(async () => (await pages<UsageCostRow & { created_at: string }>((a, b) => sb.from("usage").select("model, purpose, input_tokens, output_tokens, cost_usd, created_at").gte("created_at", since).order("id").range(a, b), MAX_USAGE)).rows),
    safe(async () => { const r = await sb.from("projects").select("id, name"); if (r.error) throw r.error; return r.data as { id: string; name: string }[]; }),
    safe(async () => { const r = await sb.from("events").select("id, type, created_at").neq("type", "model.run").order("created_at", { ascending: false }).limit(8); if (r.error) throw r.error; return r.data as { id: number; type: string; created_at: string }[]; }),
    safe(async () => (await pages<EventRow>((a, b) => sb.from("events").select("id, created_at, type, planet, payload").eq("type", "model.run").gte("created_at", since).order("created_at", { ascending: false }).range(a, b), 20_000)).rows),
    safe(async () => (await sb.from("memories").select("id", { count: "estimated", head: true })).count ?? null),
    safe(async () => (await sb.from("messages").select("id", { count: "estimated", head: true })).count ?? null),
    safe(readAna),
    safe(async () => {
      const l = await getLifeLite();
      const today = todayCount(l.habits), best = bestStreak(l.habits);
      return { habits: l.habits.length, today, best: best ? { name: best.name, streak: best.streak } : null, week: weekCompletion(l.habits), focus: { today: l.focus.today, week: l.focus.week } };
    }),
    safe(scorecardView),
    safe(async () => { const all = await listRuns(30); return all.slice(-8).reverse().map((r) => ({ at: r.at, label: r.label, gpu: r.gpu, hidden: r.hidden, rows: compareRuns(previousOf(all, r), r) })); }),
  ]);
  const base = buildSummary({
    days, now, tasks: tasks.rows, tasksCapped: tasks.capped,
    chains: new Set((missions ?? []).map((m) => m.chain_id).filter((x): x is string => !!x)),
    usage, projects: new Map((projects ?? []).map((p) => [p.id, p.name])),
    calibration: ana?.calibration ?? { manual: {}, touch: null }, experiments: ana?.experiments ?? [], queued: ana?.queued ?? {},
    events: events ?? [], modelRunRows: runs, counts: { memories, messages },
  });
  const meter = (() => { try { return usageView(); } catch { return null; } })();
  return { ...base, anaOk: !!ana, eventsOk: !!events, life, meter, scorecard, perf };
}
export type FullSummary = Awaited<ReturnType<typeof loadSummary>>;
