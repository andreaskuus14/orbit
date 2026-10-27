import { parseLimitError } from "./usage-meter-pure.ts";

// "Offline brain": when Claude can't answer, a few lanes fall back to a local model via Ollama on this PC (claude.ts).
export const OLLAMA_URL = "http://127.0.0.1:11434";
/** Appended to the system prompt of every local call: the local model gets no tools. */
export const LOCAL_NOTE = "\n\nOFFLINE MODE: you are a small local model with no tools. Never call or describe tool calls; answer directly in plain text from what is given.";

/** Which calls may run locally: CORE chat ("core") and background summaries (*.summary). Never anything with images or MCP
 *  tools, and never drafts of outward messages (business.*, call.opener, clips.engage…): those aren't on the list. */
export function localAllowed(o: { model: string; purpose: string; images: number; mcp: boolean }): boolean {
  return !!o.model && !o.images && !o.mcp && (o.purpose === "core" || o.purpose === "core.chat" || /\.summary$/.test(o.purpose));
}

const UNREACHABLE = /Could not start|Claude Code failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|Connection error|network error|overloaded|API Error: (?:5\d\d|529)/i;

/** Did this Claude failure mean "Claude is unreachable or rate-limited" (fall back), not a normal error (rethrow)? */
export function claudeDown(err: string, now = Date.now()): boolean {
  return parseLimitError(err, now) !== null || UNREACHABLE.test(err);
}

/** Ollama /api/chat request body: one system + one user message, no streaming, no tools. */
export function ollamaRequest(model: string, system: string, prompt: string) {
  return { model, stream: false, messages: [{ role: "system", content: system + LOCAL_NOTE }, { role: "user", content: prompt }] };
}

/** Ollama /api/chat response → answer text and token counts. Throws on an error or an empty answer. */
export function ollamaAnswer(j: unknown): { text: string; inputTokens: number; outputTokens: number } {
  const o = (j ?? {}) as { error?: unknown; message?: { content?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown };
  if (typeof o.error === "string") throw new Error(`Local model: ${o.error}`);
  const text = typeof o.message?.content === "string" ? o.message.content.trim() : "";
  if (!text) throw new Error("Local model gave no answer");
  const n = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
  return { text, inputTokens: n(o.prompt_eval_count), outputTokens: n(o.eval_count) };
}

export type LocalStatus = { state: "off" | "ok" | "missing" | "down"; text: string };

/** Health line for DEV world: tags = Ollama's /api/tags JSON, or null when it couldn't be reached. */
export function localStatus(model: string, tags: unknown): LocalStatus {
  if (!model) return { state: "off", text: "Local brain off (set ORBIT_LOCAL_MODEL to use Ollama when Claude is unreachable)" };
  if (tags === null) return { state: "down", text: `Local brain: Ollama isn't reachable at ${OLLAMA_URL}` };
  const names = ((tags as { models?: { name?: unknown }[] })?.models ?? []).map((m) => String(m?.name ?? ""));
  const have = names.some((n) => n === model || n === `${model}:latest`);
  return have ? { state: "ok", text: `Local brain ready: ${model}` } : { state: "missing", text: `Local brain: Ollama is up but "${model}" isn't pulled (run: ollama pull ${model})` };
}
