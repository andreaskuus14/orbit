import { evalAnswer, type AnswerEval, type AnswerEvalInput, type AnswerAction, type ToolEvidence } from "./answer-eval-pure.ts";
import type { WriteEvidence } from "./completion-pure.ts";

export type CoreEvalTool = { tool: string; input: Readonly<Record<string, unknown>>; output: string; evidence: readonly WriteEvidence[] };
const READS: Record<string, AnswerAction> = {
  search_memory: "search", web_search: "search", vault_search: "search", fetch_url: "read", read_news: "read",
  vault_read: "read", ws_read: "read", ws_list: "read", life_status: "read", life_journal: "read", calendar_events: "read",
  git_summary: "read", studio_status: "read", learned: "read", business_status: "read", ideas_list: "read", goal_status: "read",
};
const DONE: Record<string, AnswerAction[]> = { life_add_habit: ["create"], life_remind: ["create", "schedule"], life_check: ["update"], create_goal: ["create"] };
const text = (v: unknown) => typeof v === "string" ? v : "";

/** Adapt actual CORE tool results. Write receipts survive partial failure, but only for confirmed artifacts.
 * Agent prose, started scout/scheduling jobs, proposals and duplicate saves never prove a completed write.
 * Numeric facts come only from finite top-level JSON fields; formatted prose is not guessed into facts. */
export function coreToolEvidence({ tool, input, output, evidence }: CoreEvalTool): ToolEvidence[] {
  const ok = !output.startsWith("Error:"), receipts: ToolEvidence[] = [];
  let facts: Record<string, number> | undefined;
  if (ok) {
    try {
      const json = JSON.parse(output);
      if (json && typeof json === "object" && !Array.isArray(json)) facts = Object.fromEntries(Object.entries(json).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
    } catch { /* Most CORE tools return formatted text, not structured numeric facts. */ }
  }
  const target = text(input.path) || text(input.name) || text(input.url) || text(input.title) || text(input.text);
  receipts.push({ tool, ok, action: ok ? READS[tool] : undefined, target: target || undefined, facts, text: output });
  if (ok && output.startsWith("Done:")) for (const action of DONE[tool] ?? []) receipts.push({ tool, ok: true, action, target: target || undefined });
  const workspace = ok && tool === "ws_create" && /^Done: workspace "([^"]+)" created\./.exec(output);
  if (workspace) receipts.push({ tool, ok: true, action: "create", target: workspace[1] });
  for (const e of evidence) {
    if (!e.id || (tool !== "save_memory" && tool !== "ws_write")) continue;
    if (tool === "save_memory" && e.kind === "memory") for (const target of [e.id, text(input.title)].filter(Boolean)) receipts.push({ tool, ok: true, action: "save", target });
    if (tool === "ws_write" && e.kind === "file" && e.path) {
      const line = output.split("\n").find((line) => line.startsWith(`- ${e.path} `));
      const verb = line?.slice(e.path.length + 3).split(" ")[0];
      const actions: AnswerAction[] = ["save", ...(verb === "created" ? ["create" as const] : verb === "updated" ? ["update" as const] : [])];
      for (const action of actions) for (const target of [e.path, `${e.id}/${e.path}`]) receipts.push({ tool, ok: true, action, target });
    }
  }
  return receipts;
}

// Flags are telemetry, never a place for model text, fact labels, tool output or exception messages.
function safeFlag(flag: string): string {
  if (["empty_answer", "truncated_answer", "life_leak", "style:banned_phrase", "style:max_length", "style:no_emoji"].includes(flag)) return flag;
  if (/^unsupported_action:(?:save|send|delete|create|update|schedule|publish|run|search|read)$/.test(flag)) return flag;
  return flag.startsWith("numeric_contradiction:") ? "numeric_contradiction" : "evaluation_issue";
}

/** Advisory metadata only: no answer replacement, I/O, clock, retry or blocking decision. Fail open on errors.
 * Numeric fact labels are deliberately dropped even without <life> tags: labels may themselves be private. */
export function coreAnswerEval(input: Omit<AnswerEvalInput, "toolEvidence"> & { tools?: readonly CoreEvalTool[] }): { evaluation: AnswerEval; log: string | null } {
  let evaluation: AnswerEval;
  try {
    const { tools = [], ...answer } = input;
    const result = evalAnswer({ ...answer, toolEvidence: tools.flatMap(coreToolEvidence) });
    evaluation = { ...result, flags: [...new Set(result.flags.map(safeFlag))].sort() };
  } catch {
    evaluation = { score: 0, flags: ["evaluation_error"], pass: false };
  }
  return { evaluation, log: evaluation.pass ? null : `[core] answer-eval score=${evaluation.score.toFixed(2)} flags=${evaluation.flags.join(",")}` };
}
