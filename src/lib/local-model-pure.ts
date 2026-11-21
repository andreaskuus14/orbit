import { parseLimitError } from "./usage-meter-pure.ts";

// "Offline brain": when Claude can't answer, a few lanes fall back to a local model via Ollama on this PC (claude.ts).
// Local file reads (vault intake) use it too, and no journal text ever does, so its URL must stay on this PC.
const DEFAULT_URL = "http://127.0.0.1:11434";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** ORBIT_LOCAL_LLM_URL → its origin when it is plain http on this PC; anything else falls back to the default (never the network). */
export function localLlmUrl(raw: string | undefined): string {
  try {
    const u = new URL((raw ?? "").trim() || DEFAULT_URL);
    return u.protocol === "http:" && LOOPBACK.has(u.hostname) && !u.username && !u.password ? u.origin : DEFAULT_URL;
  } catch { return DEFAULT_URL; }
}
export const OLLAMA_URL = localLlmUrl(process.env.ORBIT_LOCAL_LLM_URL);
/** Ollama "cloud" models (gpt-oss:120b-cloud, …:cloud) forward the text to ollama.com even through the local URL: never local. */
export const isCloudModel = (m: string) => /[:-]cloud$/i.test(m.trim());
/** ORBIT_LOCAL_LLM_MODEL (ORBIT_LOCAL_MODEL is the older name, still read); "" = local brain off (also for a cloud model). */
export const localModelName = (env: Record<string, string | undefined>) => {
  const m = env.ORBIT_LOCAL_LLM_MODEL?.trim() || env.ORBIT_LOCAL_MODEL?.trim() || "";
  return isCloudModel(m) ? "" : m;
};
/** The offline brain's default (tools/ollama/setup.ps1): Qwen3.5 9B, Q4_K_M, 6.6 GB, Apache-2.0, text + image input, tools, 256K context. */
export const DEFAULT_LOCAL_MODEL = "qwen3.5:9b";
/** Automatic smaller sibling (Qwen3.5 4B, 3.3 GB) for when the GPU is shared or VRAM is tight. */
export const SMALL_LOCAL_MODEL = "qwen3.5:4b";
const SMALLER: Record<string, string> = { [DEFAULT_LOCAL_MODEL]: SMALL_LOCAL_MODEL, "qwen3:8b": "qwen3:4b" };
/** Free VRAM below this (MiB) counts as "tight" for the 9B model (6.6 GB of weights + KV cache). */
export const TIGHT_VRAM_MB = 7000;
const same = (a: string, b: string) => a === b || a === `${b}:latest` || b === `${a}:latest`;
/** Models that can't chat (embeddings) or aren't on this PC (cloud) are never a fallback. */
const chatCapable = (m: string) => !!m && !isCloudModel(m) && !/embed|bge-|minilm|rerank|nomic/i.test(m);

/** Appended to the system prompt of every plain local call (no tools). The CORE offline turn has its own prompt with tools (offline-tools-pure.ts). */
export const LOCAL_NOTE = "\n\nOFFLINE MODE: you are a small local model with no tools. Never call or describe tool calls; answer directly in plain text from what is given.";

/** Which calls may run locally: CORE chat ("core") and background summaries (*.summary). Never anything with images or MCP
 *  tools, never a risky turn (auth/money/approvals/sending: Opus floor), and never drafts of outward messages (business.*, call.opener,
 *  clips.engage…): those aren't on the list. */
export function localAllowed(o: { model: string; purpose: string; images: number; mcp: boolean; risky?: boolean }): boolean {
  return !!o.model && !o.images && !o.mcp && !o.risky && (o.purpose === "core" || o.purpose === "core.chat" || /\.summary$/.test(o.purpose));
}

const UNREACHABLE = /Could not start|Claude Code failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|Connection error|network error|overloaded|API Error: (?:5\d\d|529)/i;

/** Did this Claude failure mean "Claude is unreachable or rate-limited" (fall back), not a normal error (rethrow)? */
export function claudeDown(err: string, now = Date.now()): boolean {
  return parseLimitError(err, now) !== null || UNREACHABLE.test(err);
}

/** Ollama /api/chat request body: one system + one user message, no streaming, no tools. numCtx: a bigger context window
 *  (Ollama's default is small) for long text. Qwen3 and Qwen3.5 models think out loud by default: think:false skips that. */
export function ollamaRequest(model: string, system: string, prompt: string, numCtx?: number) {
  return { model, stream: false, messages: [{ role: "system", content: system + LOCAL_NOTE }, { role: "user", content: prompt }],
    ...(/^qwen3/i.test(model) ? { think: false } : {}), ...(numCtx ? { options: { num_ctx: numCtx } } : {}) };
}

/** Ollama /api/chat response → answer text and token counts. Throws on an error or an empty answer. */
export function ollamaAnswer(j: unknown): { text: string; inputTokens: number; outputTokens: number } {
  const o = (j ?? {}) as { error?: unknown; message?: { content?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown };
  if (typeof o.error === "string") throw new Error(`Local model: ${o.error}`);
  const text = typeof o.message?.content === "string" ? o.message.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : ""; // older Ollama inlines thinking
  if (!text) throw new Error("Local model gave no answer");
  const n = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
  return { text, inputTokens: n(o.prompt_eval_count), outputTokens: n(o.eval_count) };
}

/** A message in an Ollama /api/chat tool loop (role "tool" carries one tool's result; tool_name says which). */
export type OllamaMsg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: unknown[]; tool_name?: string };
export type OllamaTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
/** Ollama /api/chat body with native tool calling (offline-tools.ts). No LOCAL_NOTE: this call does get tools. */
export function ollamaToolRequest(model: string, messages: OllamaMsg[], tools: OllamaTool[], numCtx?: number) {
  return { model, stream: false, messages, ...(tools.length ? { tools } : {}),
    ...(/^qwen3/i.test(model) ? { think: false } : {}), ...(numCtx ? { options: { num_ctx: numCtx } } : {}) };
}
export type ToolCall = { name: string; args: Record<string, unknown> };
/** Ollama tool-loop reply → text, tool calls and the raw assistant message to send back. Throws on an error or a reply with nothing. */
export function ollamaToolReply(j: unknown): { text: string; calls: ToolCall[]; raw: OllamaMsg; inputTokens: number; outputTokens: number } {
  const o = (j ?? {}) as { error?: unknown; message?: { content?: unknown; tool_calls?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown };
  if (typeof o.error === "string") throw new Error(`Local model: ${o.error}`);
  const text = typeof o.message?.content === "string" ? o.message.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : "";
  const rawCalls = Array.isArray(o.message?.tool_calls) ? o.message.tool_calls : [];
  const calls: ToolCall[] = [];
  for (const c of rawCalls) {
    const f = (c as { function?: { name?: unknown; arguments?: unknown } })?.function;
    if (typeof f?.name !== "string" || !f.name) continue;
    let args: unknown = f.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    calls.push({ name: f.name.slice(0, 80), args: args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {} });
  }
  if (!text && !calls.length) throw new Error("Local model gave no answer");
  const n = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
  return { text, calls, raw: { role: "assistant", content: text, ...(rawCalls.length ? { tool_calls: rawCalls } : {}) }, inputTokens: n(o.prompt_eval_count), outputTokens: n(o.eval_count) };
}

export type LocalStatus = { state: "off" | "ok" | "fallback" | "missing" | "down"; text: string };

/** Model names in Ollama's /api/tags JSON (empty when it couldn't be reached). */
export const installedModels = (tags: unknown): string[] =>
  ((tags as { models?: { name?: unknown }[] } | null)?.models ?? []).map((m) => String(m?.name ?? "")).filter(Boolean);

export type LocalPick = { model: string; /** why this one, when it isn't simply the configured model */ note?: string; /** doctor hint, e.g. the pull command */ hint?: string };
/** Which installed model answers. configured = ORBIT_LOCAL_LLM_MODEL; tight = the shared GPU lease is held by another job or free VRAM
 *  is below TIGHT_VRAM_MB: a configured model with a smaller sibling (SMALLER) steps down to it when that one is installed.
 *  Configured but not installed: whatever chat model is installed (newest family first), plus a hint with the pull command.
 *  "" when the brain is off or nothing usable is installed (never a cloud model). */
export function pickLocalModel(o: { configured: string; installed: string[]; tight?: boolean }): LocalPick {
  const c = o.configured.trim();
  if (!c) return { model: "" };
  const has = (m: string) => o.installed.find((n) => same(n, m));
  const small = SMALLER[c];
  if (has(c)) {
    const s = o.tight && small ? has(small) : undefined;
    return s ? { model: s, note: `${c} stepped down to ${s} while the GPU is shared` } : { model: has(c)! };
  }
  const hint = `Run: ollama pull ${c}`;
  const order = [...(o.tight ? [SMALL_LOCAL_MODEL] : []), DEFAULT_LOCAL_MODEL, SMALL_LOCAL_MODEL, "qwen3:8b", "qwen3:4b"];
  const found = order.map(has).find(Boolean) ?? o.installed.find(chatCapable);
  return found && chatCapable(found) ? { model: found, note: `"${c}" isn't pulled; using ${found}`, hint } : { model: "", hint };
}

/** Health line for DEV world and the doctor: tags = Ollama's /api/tags JSON, or null when it couldn't be reached.
 *  A configured model that isn't pulled but has an installed stand-in is "fallback" (works, with the pull command as the hint). */
export function localStatus(model: string, tags: unknown): LocalStatus {
  if (!model) return { state: "off", text: "Local brain off (run tools\\ollama\\setup.ps1, or set ORBIT_LOCAL_LLM_MODEL)" };
  if (tags === null) return { state: "down", text: `Local brain: Ollama isn't reachable at ${OLLAMA_URL}` };
  const names = installedModels(tags);
  if (names.some((n) => same(n, model))) return { state: "ok", text: `Local brain ready: ${model}` };
  const p = pickLocalModel({ configured: model, installed: names });
  return p.model ? { state: "fallback", text: `Local brain: "${model}" isn't pulled, answering with ${p.model} for now. ${p.hint}` }
    : { state: "missing", text: `Local brain: Ollama is up but "${model}" isn't pulled (run: ollama pull ${model})` };
}

/* Journal / LIFE text never goes to any model, not even this local one (AGENTS.md rule 6). The earlier opt-in "Reflect" path
 * (ORBIT_LOCAL_PRIVATE=1) was removed: a setting is not a guarantee, a missing code path is. tests/local-llm.test.ts and the LIF07
 * test in tests/life-planning.test.ts fail if any file that reads the journal can reach a model again. */
