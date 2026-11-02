// Agent SDK engine: one CORE turn through @anthropic-ai/claude-agent-sdk instead of the `claude -p` JSON loop.
// Only loaded when ORBIT_CORE_ENGINE=sdk (core.ts). Mapping and the decide() gate live in core-sdk-pure.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MODULE_TOOLS } from "./core-modules";
import { pluginToolNames } from "./plugins";
import { emit, recordUsage, type CliSession, type PromptImage } from "./claude";
import { authorizeTool } from "./authority";
import { policyEvent, TIERS, type PolicyCtx } from "./policy-pure";
import type { WriteEvidence } from "./completion-pure";
import { authMode, gated, readMessage, sdkFailure, sdkOptions, sdkTools, serial, toolResult, userMessage, SERVER } from "./core-sdk-pure";
import type { TraceStep } from "./core";
import type { StepDone } from "./core-live-pure";

export type Turn = {
  sb: SupabaseClient; userId: string; system: string; prompt: string; model: string; effort?: string; maxTurns: number;
  policy: () => Omit<PolicyCtx, "steps">; attachBlock: string; images?: PromptImage[]; steps: string[]; trace: TraceStep[]; signal?: AbortSignal; turnId?: string;
  session?: CliSession; escalate?: boolean; // escalate: the fast model reached for a tool → stop, core.ts redoes the turn on the main model
  /** core.ts's dispatch for an allowed call (navigate / module / runCoreTool) and its eval/trace/activity record, shared with the CLI loop. */
  exec: (tool: string, input: Record<string, unknown>, evidence: WriteEvidence[], operator?: boolean) => Promise<string>;
  record: (tool: string, input: Record<string, unknown>, out: string, evidence: WriteEvidence[], ms: number, operator?: boolean) => void;
  onDelta?: (d: string) => void; onReset?: () => void; onStep?: (tool: string, input: Record<string, unknown>, done?: StepDone) => void;
  /** core.ts's independent verifier (verifier.ts): null = not run; the MCP engine continues once on "not verified". */
  verify?: (answer: string) => Promise<{ ok: boolean; reason: string } | null>;
};

/** Runs the turn; returns the answer and the SDK session id (escalated: nothing answered, redo on the main model).
 *  Throws on an SDK error (core-turn.ts's describeFailure names it). */
export async function sdkTurn(t: Turn): Promise<{ text: string; sessionId: string; escalated?: boolean }> {
  const { query, tool, createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");
  const abortController = new AbortController();
  let escalated = false;
  const one = serial();
  const handler = (name: string) => (input: Record<string, unknown>) => one(async () => {
    if (t.escalate) { escalated = true; abortController.abort(); return toolResult("Error: stopped"); }
    t.onReset?.(); t.onStep?.(name, input); // text before a tool call is not the answer (as in core.ts)
    const at = Date.now(), evidence: WriteEvidence[] = [];
    const { out, verdict, operated } = await gated(name, input, t.policy, t.steps, (op) => t.exec(name, input, evidence, op), t.attachBlock, authorizeTool);
    const row = policyEvent(name, verdict);
    if (row) void emit(t.sb, t.userId, "policy.decision", "core", { ...row, turn: t.turnId });
    t.record(name, input, out, evidence, Date.now() - at, operated);
    if (!verdict.allow && t.turnId) t.trace.at(-1)!.policy = { verdict: "refuse", turn: t.turnId };
    return toolResult(out);
  });
  const names = sdkTools([...MODULE_TOOLS, ...pluginToolNames()]); // + his MCP plugins, each still behind decide()
  const server = createSdkMcpServer({
    name: SERVER, version: "0.2.0",
    // Inputs are documented in the prompt (TOOL NOTES / MODULE TOOLS) and checked by each runner, so the schema passes them through.
    tools: names.map((n) => tool(n, `ORBIT tool ${n}: its input and rules are in TOOL NOTES or MODULE TOOLS.`, z.looseObject({}) as unknown as z.ZodRawShape, handler(n), { annotations: { readOnlyHint: /^T[01]$/.test(TIERS[n] ?? "") } })),
  });
  const cwd = join(tmpdir(), "orbit-core-sdk"); // empty folder: no project CLAUDE.md or .claude/ is picked up; fixed, so sessions resume
  await mkdir(cwd, { recursive: true });
  t.signal?.addEventListener("abort", () => abortController.abort(), { once: true });
  if (t.signal?.aborted) abortController.abort(); // aborted (Stop or turn deadline) during the import/mkdir above: never start the query
  const started = Date.now();
  const prompt = t.images?.length ? (async function* () { yield userMessage(t.prompt, t.images!); })() : t.prompt;
  let answer = "", sessionId = "", apiError: string | undefined;
  try {
    for await (const m of query({ prompt: prompt as never, options: { ...sdkOptions({ model: t.model, system: t.system, server, tools: names, maxTurns: t.maxTurns, cwd, effort: t.effort, session: t.session }), abortController } as never })) {
      const r = readMessage(m as never);
      if (r?.delta) t.onDelta?.(r.delta);
      if (r?.error) apiError = r.error;
      if (r?.init) { sessionId = r.init.sessionId; t.trace.push({ step: "sdk", detail: `agent sdk · ${r.init.model} · ${authMode(r.init.apiKeySource)}`, ms: Date.now() - started, ok: true }); }
      if (r?.result) {
        await recordUsage(t.sb, t.userId, "core.chat", { ...r.result, ms: Date.now() - started }, t.model);
        if (r.result.isError) throw new Error(sdkFailure(apiError, [...r.result.errors, r.result.text]));
        t.trace.push({ step: "think", detail: `${t.model} · sdk · ${r.result.turns ?? 0} turns · cache read ${r.result.cacheRead ?? 0} tok`, ms: Date.now() - started, ok: true });
        answer = r.result.text;
      }
    }
  } catch (e) {
    if (!escalated || t.signal?.aborted) throw e;
  }
  return escalated ? { text: "", sessionId, escalated } : { text: answer, sessionId };
}
