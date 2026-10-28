// Weekly self-eval scorecard (roadmap 8 · 1.5 + 8.3), pure; tested in tests/self-eval.test.ts and tests/redteam.test.ts. IO: self-eval.ts.
// The static parts only (0 model calls): the red-team suite against the real guards, and the retrieval fixtures under the same
// "not worse than the frozen baseline" rule as npm run eval:ai. A record per week; the trend compares this week with the last 4.
import { decide } from "./policy-pure.ts";
import { approvalGate } from "./approval-pure.ts";
import { autonomyAllows, autonomyDefaults, setLevel, type Levels } from "./autonomy-pure.ts";
import { rrfMerge } from "./pure.ts";
import { selectCoreMemoryIds } from "./memory-retrieval-pure.ts";
import { RED_TEAM_CASES, type RedTeamCase } from "../../evals/redteam-cases.ts";
import { RETRIEVAL_CASES, type RetrievalCase } from "../../evals/memory-cases.ts";
import { legacyMemoryIds } from "../../evals/legacy-memory-pure.ts";

export type CaseResult = { id: string; category: string; passed: boolean; why: string };
export type Tally = { pass: number; total: number };
export type EvalRecord = { date: string; week: string; cats: Record<string, Tally>; failed: string[]; redTeamFailures: number };

/** One red-team case through the layer that must stop it. passed = refused (or left waiting for the owner's click). */
export async function redTeamCase(c: RedTeamCase): Promise<CaseResult> {
  const k = c.check;
  let why = "";
  if (k.layer === "decide") {
    const d = decide(k.tool, k.input, { stopAll: false, attach: !!k.attach, pins: !!k.pins, question: k.question,
      steps: [`You called ${k.after} {}\nRESULT:\n${c.attack}`] });
    why = d.allow ? "" : d.reason;
  } else if (k.layer === "gate") why = await approvalGate(k.action, k.approved, { text: c.attack });
  else if (k.layer === "level") { const r = setLevel(autonomyDefaults(), k.area, k.level, k.confirm); why = typeof r === "string" ? r : ""; }
  else { const v = autonomyAllows(k.area, k.action, { levels: k.levels as Partial<Levels>, text: c.attack, known: true, doneToday: 0 }); why = v.ok ? "" : v.why; }
  return { id: c.id, category: c.category, passed: !!why, why: why || "ALLOWED" };
}
export const runRedTeam = (cases: RedTeamCase[] = RED_TEAM_CASES) => Promise.all(cases.map(redTeamCase));

/** Same rule as scripts/ai-scorecard.ts: the upgraded ranking may not lose recall@8 or reciprocal rank against the legacy one. */
export function retrievalCase(c: RetrievalCase): CaseResult {
  const m = (ids: string[]) => {
    if (!c.relevant.length) return { r8: ids.length ? 0 : 1, rr: ids.length ? 0 : 1 };
    const first = ids.findIndex((id) => c.relevant.includes(id));
    return { r8: c.relevant.filter((id) => ids.slice(0, 8).includes(id)).length / c.relevant.length, rr: first < 0 ? 0 : 1 / (first + 1) };
  };
  const base = m(legacyMemoryIds(c.fts, c.semantic));
  const up = m(selectCoreMemoryIds(rrfMerge([c.fts, c.semantic]).map((r) => r.id), c.context ?? [], c.query, 8, c.project));
  const passed = up.r8 >= base.r8 && up.rr >= base.rr;
  return { id: c.id, category: "retrieval", passed, why: passed ? "" : "worse than baseline" };
}

export function toRecord(results: CaseResult[], now: number, week: string): EvalRecord {
  const cats: Record<string, Tally> = {};
  for (const r of results) { const t = (cats[r.category] ??= { pass: 0, total: 0 }); t.total++; if (r.passed) t.pass++; }
  const failed = results.filter((r) => !r.passed);
  return { date: new Date(now).toISOString().slice(0, 10), week, cats, failed: failed.map((r) => r.id), redTeamFailures: failed.filter((r) => r.category !== "retrieval").length };
}

/** The whole static scorecard (no model, no IO). */
export const staticEval = async (now: number, week: string) =>
  toRecord([...(await runRedTeam()), ...RETRIEVAL_CASES.map(retrievalCase)], now, week);

/** Newest-last history with this week's record replacing any earlier one for the same week; keeps the last 12 weeks. */
export const addRecord = (runs: EvalRecord[], r: EvalRecord) => [...runs.filter((x) => x.week !== r.week), r].slice(-12);

export type Trend = {
  now: EvalRecord; rows: { cat: string; pct: number; prev: number | null }[]; // prev: mean pass % over the up-to-4 earlier weeks that had the category
  redTeamFailures: number; regressions: string[]; // failing now, not failing in the previous record (a new case that fails counts too)
};
const pct = (t: Tally) => (t.total ? Math.round((100 * t.pass) / t.total) : 100);

export function evalTrend(runs: EvalRecord[]): Trend | null {
  const now = runs.at(-1);
  if (!now) return null;
  const before = runs.slice(-5, -1), last = before.at(-1);
  const rows = Object.keys(now.cats).sort().map((cat) => {
    const p = before.filter((r) => r.cats[cat]).map((r) => pct(r.cats[cat]));
    return { cat, pct: pct(now.cats[cat]), prev: p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length) : null };
  });
  return { now, rows, redTeamFailures: now.redTeamFailures, regressions: last ? now.failed.filter((id) => !last.failed.includes(id)) : [] };
}
