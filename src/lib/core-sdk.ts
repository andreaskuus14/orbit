// Agent SDK prototype: one CORE turn through @anthropic-ai/claude-agent-sdk instead of the `claude -p` JSON loop.
// Only loaded when ORBIT_CORE_ENGINE=sdk (core.ts). Mapping and the decide() gate live in core-sdk-pure.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { TOOLS } from "./agents";
import { runModuleTool } from "./core-modules";
import { emit, recordUsage } from "./claude";
import { policyEvent, type PolicyCtx } from "./policy-pure";
import { authMode, gated, readMessage, sdkOptions, serial, toolResult, SDK_TOOLS, SERVER, type SdkTool } from "./core-sdk-pure";
import type { TraceStep } from "./core";

type Turn = {
  sb: SupabaseClient; userId: string; system: string; prompt: string; question: string; model: string; effort?: string; maxTurns: number;
  policy: () => Omit<PolicyCtx, "steps">; attachBlock: string; steps: string[]; trace: TraceStep[]; signal?: AbortSignal;
  onDelta?: (d: string) => void; onReset?: () => void; onStep?: (tool: string, input: Record<string, unknown>) => void;
};

/** Runs the turn and returns the answer text; throws on an SDK error result (core-turn.ts's describeFailure names it). */
export async function sdkTurn(t: Turn): Promise<string> {
  const { query, tool, createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");
  const ctx = { sb: t.sb, userId: t.userId, task: { id: "", agent: "core", title: "", request: "", parent_id: null, project_id: null }, depth: 1, pending: [], trace: [], pages: new Map() };
  const runs: Record<SdkTool, (i: Record<string, unknown>) => Promise<string>> = {
    fetch_url: (i) => TOOLS.fetch_url.run(ctx, i),
    read_news: (i) => TOOLS.read_news.run(ctx, i),
    goal_status: (i) => runModuleTool("goal_status", i, { sb: t.sb, userId: t.userId, question: t.question, tainted: t.steps.length > 0 || !!t.attachBlock || t.policy().pins, pinned: !!t.attachBlock || t.policy().pins, steps: t.steps, onEvidence: () => {} }),
  };
  const shapes: Record<SdkTool, z.ZodRawShape> = {
    fetch_url: { url: z.string() },
    read_news: { query: z.string(), hours: z.number().optional(), country: z.string().optional() },
    goal_status: {},
  };
  const one = serial();
  const handler = (name: SdkTool) => (input: Record<string, unknown>) => one(async () => {
    t.onReset?.(); t.onStep?.(name, input); // text before a tool call is not the answer (as in core.ts)
    const at = Date.now();
    const { out, verdict } = await gated(name, input, t.policy, t.steps, () => runs[name](input), t.attachBlock);
    const row = policyEvent(name, verdict);
    if (row) void emit(t.sb, t.userId, "policy.decision", "core", row);
    t.trace.push({ step: name, detail: `${JSON.stringify(input).slice(0, 140)} → ${out.slice(0, 140)}`, ms: Date.now() - at, ok: !out.startsWith("Error:") });
    return toolResult(out);
  });
  const server = createSdkMcpServer({
    name: SERVER, version: "0.1.0",
    tools: SDK_TOOLS.map((n) => tool(n, TOOLS[n]?.description ?? "The user's goals with status, steps done, metric and what each waits for.", shapes[n], handler(n), { annotations: { readOnlyHint: true } })),
  });
  const cwd = join(tmpdir(), "orbit-core-sdk"); // empty folder: no project CLAUDE.md or .claude/ is picked up
  await mkdir(cwd, { recursive: true });
  const abortController = new AbortController();
  t.signal?.addEventListener("abort", () => abortController.abort(), { once: true });
  const started = Date.now();
  let answer = "";
  for await (const m of query({ prompt: t.prompt, options: { ...sdkOptions({ model: t.model, system: t.system, server, maxTurns: t.maxTurns, cwd, effort: t.effort }), abortController } as never })) {
    const r = readMessage(m as never);
    if (r?.delta) t.onDelta?.(r.delta);
    if (r?.init) t.trace.push({ step: "sdk", detail: `agent sdk · ${r.init.model} · ${authMode(r.init.apiKeySource)}`, ms: Date.now() - started, ok: true });
    if (r?.result) {
      await recordUsage(t.sb, t.userId, "core.chat", { ...r.result, ms: Date.now() - started }, t.model);
      if (r.result.isError) throw new Error(r.result.errors.join(": ") || r.result.text || "agent sdk error");
      t.trace.push({ step: "think", detail: `${t.model} · sdk · ${r.result.turns ?? 0} turns · cache read ${r.result.cacheRead ?? 0} tok`, ms: Date.now() - started, ok: true });
      answer = r.result.text;
    }
  }
  return answer;
}
