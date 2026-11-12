// Which model ran each job (P2): the model.run ledger event and the ANALYTICS 7-day aggregation. Pure; tests/model-log.test.ts.
// Metadata only: a run is a kind, a job kind, a model id and tool-name tokens. No message, request or LIFE text is ever passed in.
import { fromRows, type EventRow } from "./ledger-pure.ts";
import { belowOpus } from "./agent-defs-pure.ts";

export type RunData = { kind: "core" | "agent"; job: string; model: string; risky: boolean; why?: string[]; down?: string };
const TOK = /^[\w.:[\]-]{1,64}$/;
const tok = (s: string) => (TOK.test(s) ? s : "unknown");

/** The model.run payload; anything that isn't a plain token (a sentence, a path) becomes "unknown" rather than being logged. */
export function runData(r: { kind: RunData["kind"]; job: string; model: string; risky?: boolean; why?: string[]; down?: string }): RunData {
  const why = [...new Set((r.why ?? []).map(tok))].slice(0, 8);
  return { kind: r.kind, job: tok(r.job), model: tok(r.model || "unknown"), risky: !!r.risky || why.length > 0, ...(why.length ? { why } : {}), ...(r.down ? { down: tok(r.down) } : {}) };
}

export type RiskyRun = { at: string; kind: RunData["kind"]; job: string; model: string; why: string[]; down?: string; below: boolean };
export type ModelRuns = { total: number; perModel: { model: string; runs: number }[]; risky: RiskyRun[]; below: number };

/** model.run events of the last `days` days: runs per model, every risky job with its model, and how many risky jobs ran below Opus (should be 0). */
export function summarizeRuns(rows: EventRow[], now = Date.now(), days = 7): ModelRuns {
  const since = now - days * 86_400_000;
  const runs = fromRows(rows).flatMap((e) => (e.type === "model.run" && Date.parse(e.at) >= since && Date.parse(e.at) <= now ? [{ at: e.at, ...e.data }] : []));
  const by = new Map<string, number>();
  for (const r of runs) by.set(r.model, (by.get(r.model) ?? 0) + 1);
  const risky = runs.filter((r) => r.risky).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((r): RiskyRun => ({ at: r.at, kind: r.kind, job: r.job, model: r.model, why: r.why ?? [], ...(r.down ? { down: r.down } : {}), below: belowOpus(r.model) }));
  return { total: runs.length, perModel: [...by].map(([model, n]) => ({ model, runs: n })).sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model)), risky, below: risky.filter((r) => r.below).length };
}
