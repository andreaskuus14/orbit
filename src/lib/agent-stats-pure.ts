// Per-agent performance from the tasks table, the pure part. No I/O — tested in tests/agent-stats.test.ts.

export type TaskRow = { agent: string; status: string; created_at: string; started_at: string | null; finished_at: string | null };
export type AgentStats = { done: number; failed: number; running: number; awaiting: number; avgMs: number | null; last7: number[]; savedMin: number };
export type StatsResult = { agents: Record<string, AgentStats>; star: string | null };

/** Rough minutes a person would spend on one finished task of this agent. */
export const MINUTES_SAVED: Record<string, number> = { atlas: 30, forge: 25, vector: 20, pulse: 15, flow: 15, nova: 10, echo: 10, sentinel: 10, qa: 10 };
export const minutesSaved = (slug: string) => MINUTES_SAVED[slug] ?? 10;

/** A valid IANA zone, or "UTC". */
export function safeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

/** "YYYY-MM-DD" of the instant in that zone (Intl does the DST work). */
export const dayKey = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The n day keys ending today, oldest first. Steps on calendar dates (UTC math on Y-M-D), so 23/25 h days can't skip or repeat. */
export function lastDays(now: Date, tz: string, n = 7): string[] {
  const [y, m, d] = dayKey(now, tz).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d - (n - 1 - i))).toISOString().slice(0, 10));
}

export function aggregateStats(rows: TaskRow[], now: Date, tz: string): StatsResult {
  const days = lastDays(now, tz);
  const agents: Record<string, AgentStats> = {};
  const durs: Record<string, number[]> = {};
  for (const r of rows) {
    const s = (agents[r.agent] ??= { done: 0, failed: 0, running: 0, awaiting: 0, avgMs: null, last7: days.map(() => 0), savedMin: 0 });
    if (r.status === "failed") s.failed++;
    else if (r.status === "running") s.running++;
    else if (r.status === "awaiting_approval") s.awaiting++;
    else if (r.status === "done") {
      s.done++;
      const end = r.finished_at ?? r.created_at;
      const i = days.indexOf(dayKey(new Date(end), tz));
      if (i >= 0) s.last7[i]++;
      const ms = r.started_at && r.finished_at ? Date.parse(r.finished_at) - Date.parse(r.started_at) : NaN;
      if (ms >= 0) (durs[r.agent] ??= []).push(ms);
    }
  }
  let star: string | null = null;
  let best = { done: 0, failed: Infinity };
  for (const slug of Object.keys(agents).sort()) {
    const s = agents[slug];
    const d = durs[slug];
    s.avgMs = d?.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
    s.savedMin = s.done * minutesSaved(slug);
    const week = s.last7.reduce((a, b) => a + b, 0);
    if (week > best.done || (week === best.done && week > 0 && s.failed < best.failed)) { star = slug; best = { done: week, failed: s.failed }; }
  }
  return { agents, star };
}
