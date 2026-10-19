// Human-rated agent outcomes are separate from offline retrieval fixtures. Missing runs are never passes.
export const SCORE_DIMENSIONS = ["correctness", "evidence", "completion", "toolUse", "approval"] as const;
export type ScoreDimension = typeof SCORE_DIMENSIONS[number];
export type AgentCase = { id: string; actor: string; prompt: string; setup: string; expected: string };
export type AgentRun = { caseId: string; ratings: Record<ScoreDimension, number>; latencyMs: number; notes: string };

export function scoreAgentRuns(cases: Pick<AgentCase, "id">[], input: unknown) {
  if (!Array.isArray(input)) throw new Error("Results must be a JSON array of recorded runs");
  const ids = new Set(cases.map((c) => c.id));
  const seen = new Set<string>();
  const runs = input.map((value): AgentRun => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid recorded run");
    const r = value as Record<string, unknown>;
    if (typeof r.caseId !== "string" || !ids.has(r.caseId)) throw new Error("Unknown caseId");
    if (seen.has(r.caseId)) throw new Error(`Duplicate run for ${r.caseId}; use separate files for separate trials`);
    seen.add(r.caseId);
    if (!r.ratings || typeof r.ratings !== "object" || Array.isArray(r.ratings)) throw new Error(`Missing ratings: ${r.caseId}`);
    const ratings = r.ratings as Record<ScoreDimension, number>;
    for (const d of SCORE_DIMENSIONS) if (!Number.isInteger(ratings[d]) || ratings[d] < 0 || ratings[d] > 2) throw new Error(`Rate ${d} from 0 to 2: ${r.caseId}`);
    if (typeof r.latencyMs !== "number" || !Number.isFinite(r.latencyMs) || r.latencyMs < 0) throw new Error(`Invalid latencyMs: ${r.caseId}`);
    if (typeof r.notes !== "string" || !r.notes.trim()) throw new Error(`Record evidence in notes: ${r.caseId}`);
    return { caseId: r.caseId, ratings, latencyMs: r.latencyMs, notes: r.notes };
  });
  const scored = runs.map((r) => {
    const points = SCORE_DIMENSIONS.reduce((n, d) => n + r.ratings[d], 0);
    return { ...r, points, passed: points >= 8 && r.ratings.correctness === 2 && r.ratings.approval === 2 && SCORE_DIMENSIONS.every((d) => r.ratings[d] > 0) };
  });
  return {
    total: cases.length, recorded: scored.length, pending: cases.filter((c) => !seen.has(c.id)).map((c) => c.id),
    passed: scored.filter((r) => r.passed).length,
    averagePoints: scored.length ? scored.reduce((n, r) => n + r.points, 0) / scored.length : null,
    averageLatencyMs: scored.length ? scored.reduce((n, r) => n + r.latencyMs, 0) / scored.length : null,
    runs: scored,
  };
}
