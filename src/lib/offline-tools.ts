// CORE's offline turn with tools (IO side of offline-tools-pure.ts). core.ts calls it when Claude is unreachable, rate-limited or on
// the usage hold. CORE tools go through core-sdk-pure gated(): the same decide() → authorizeTool() → exec() → record() path as the
// other engines. No journal or LIFE text is read here or put in the prompt (AGENTS.md rule 6; tests/offline-tools.test.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatLocalTools, resolveLocalModel } from "./local-llm.ts";
import { gated } from "./core-sdk-pure.ts";
import { exposedTools } from "./core-mcp-pure.ts";
import { policyEvent, type PolicyCtx } from "./policy-pure.ts";
import { prepareArgs } from "./mcp-schemas-pure.ts";
import { retrieveMemories } from "./memory-search.ts";
import { isCurrent } from "./memory-types-pure.ts";
import { PRIVATE_KIND_LIST } from "./private-pure.ts";
import type { WriteEvidence } from "./completion-pure.ts";
import { OFFLINE_CORE_TOOLS, OFFLINE_LIMITS, OFFLINE_OWN_TOOLS, dropJournalRows, memoryText, offlineFooter, offlineLoop, offlineRunner, offlineSystem, offlineToolList, offlineUser, type MemRow } from "./offline-tools-pure.ts";

const COLS = "id, kind, title, content, tags, created_at, updated_at, source";

/** Keyword (full-text) memory search only: the query never goes to an embedder or reranker. Journal rows are dropped twice. */
async function memorySearch(sb: SupabaseClient, userId: string, query: string, chat?: string): Promise<MemRow[]> {
  const { results } = await retrieveMemories(sb, query, 6, userId, async () => null, { chatId: chat });
  return dropJournalRows((results ?? []) as MemRow[]).filter((m) => isCurrent(m as never, { now: Date.now(), chat }));
}
async function recentMemories(sb: SupabaseClient, userId: string): Promise<MemRow[]> {
  const { data } = await sb.from("memories").select(COLS).eq("user_id", userId).not("kind", "in", PRIVATE_KIND_LIST).order("created_at", { ascending: false }).limit(4);
  return dropJournalRows((data ?? []) as MemRow[]);
}

export type OfflineTurn = {
  sb: SupabaseClient; userId: string; question: string; history: { role: string; content: string }[]; chat?: string; now: string; langRule?: string;
  policy: () => Omit<PolicyCtx, "steps">; steps: string[]; attachBlock: string; attachments: boolean; turnId?: string;
  exec: (tool: string, input: Record<string, unknown>, evidence: WriteEvidence[], operator: boolean) => Promise<string>;
  record: (tool: string, input: Record<string, unknown>, out: string, evidence: WriteEvidence[], ms: number, operator?: boolean) => void;
  authorize: (tool: string, d: import("./policy-pure.ts").Decision) => import("./policy-pure.ts").Decision;
  emit?: (kind: string, payload: Record<string, unknown>) => void;
  onStep?: (tool: string, input: Record<string, unknown>) => void;
  signal?: AbortSignal; budgetMs?: number;
};

/** One offline CORE answer. Same result shape as claude.ts askClaude (local: true), so core.ts treats it as the local brain's answer. */
export async function offlineTurn(t: OfflineTurn) {
  const t0 = Date.now();
  const pick = await resolveLocalModel();
  if (!pick.model) throw new Error(`Local model isn't available${pick.hint ? `. ${pick.hint}` : ""}`);
  const ctx = t.policy(); // Stop-all / Autonomy hide what they hide elsewhere; pc_files only while pc_act is offered (it runs through it)
  const offered = [...exposedTools([...OFFLINE_CORE_TOOLS], ctx), ...OFFLINE_OWN_TOOLS.filter((n) => n !== "pc_files" || exposedTools(["pc_act"], ctx).length)];
  const runner = offlineRunner({
    question: t.question, steps: t.steps, userId: t.userId, offered, privateTools: t.policy().privateTools ?? [],
    stopAll: () => t.policy().stopAll,
    memory: (q) => memorySearch(t.sb, t.userId, q, t.chat),
    queue: async (row) => {
      const { data, error } = await t.sb.from("tasks").insert(row).select("id").single();
      if (error) throw error;
      return String(data.id);
    },
    start: t.onStep, record: (tool, input, out, ms) => t.record(tool, input, out, [], ms),
    core: async (name, raw, filter) => {
      const prepared = prepareArgs(name, raw);
      if ("error" in prepared) return prepared.error;
      const input = prepared.args;
      t.onStep?.(name, input);
      const at = Date.now(), evidence: WriteEvidence[] = [];
      const { out, verdict, operated } = await gated(name, input, t.policy, t.steps, (op) => t.exec(name, input, evidence, op).then(filter), t.attachBlock, t.authorize);
      const row = policyEvent(name, verdict);
      if (row) t.emit?.("policy.decision", { ...row, turn: t.turnId, offline: true });
      t.record(name, input, out, evidence, Date.now() - at, operated);
      return out;
    },
  });
  const seed = await memorySearch(t.sb, t.userId, t.question, t.chat).then((r) => (r.length ? r : recentMemories(t.sb, t.userId))).catch(() => []);
  let noTools = false;
  const out = await offlineLoop({
    system: offlineSystem({ now: t.now, langRule: t.langRule }),
    user: offlineUser(t.question, t.history, memoryText(seed.slice(0, 4), 500), t.attachments),
    tools: offlineToolList(offered),
    // a model without tool support (Ollama: "does not support tools") still answers, with no tools for the rest of the turn
    chat: (messages, tools, timeoutMs) => chatLocalTools(pick.model, messages, noTools ? [] : tools, { signal: t.signal, timeoutMs, numCtx: OFFLINE_LIMITS.ctx })
      .catch((e) => { if (noTools || !tools.length || !/support tools/i.test(String(e))) throw e; noTools = true; return chatLocalTools(pick.model, messages, [], { signal: t.signal, timeoutMs, numCtx: OFFLINE_LIMITS.ctx }); }),
    run: runner.run, signal: t.signal, limits: t.budgetMs ? { ms: Math.max(20_000, Math.min(OFFLINE_LIMITS.ms, t.budgetMs)) } : undefined,
  });
  return { text: out.text + offlineFooter(out, runner.queued()), inputTokens: out.inputTokens, outputTokens: out.outputTokens, ms: Date.now() - t0, local: true as const, model: pick.model, offline: { calls: out.calls, stop: out.stop, queued: runner.queued() } };
}
