// Dependency-free helpers for streaming CORE answers, unit-tested in tests/streamjson.test.ts.
// Keep this file free of imports and non-erasable TS syntax (it runs under node --experimental-strip-types).

/** Split complete lines off a buffer; `rest` is the trailing partial line to keep for the next chunk. */
export function takeLines(buf: string): { lines: string[]; rest: string } {
  const parts = buf.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.replace(/\r$/, "")).filter((l) => l.trim()), rest };
}

/** cacheWrite/cacheRead, turns, costUsd (the CLI's API-price estimate, a proxy for plan usage) when the CLI reports them. */
export type StreamResult = { text: string; isError: boolean; inputTokens: number; outputTokens: number; cacheWrite?: number; cacheRead?: number; turns?: number; costUsd?: number };

/** One line of `claude -p --output-format stream-json`: a text delta, the final result, or null (anything else). */
export function parseStreamJsonLine(line: string): { delta?: string; result?: StreamResult } | null {
  type Line = {
    type?: string; result?: unknown; is_error?: boolean; num_turns?: number; total_cost_usd?: number;
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
    event?: { type?: string; delta?: { type?: string; text?: unknown } };
  };
  let j: Line;
  try { j = JSON.parse(line); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  if (j.type === "stream_event" && j.event?.type === "content_block_delta" && j.event.delta?.type === "text_delta" && typeof j.event.delta.text === "string") {
    return { delta: j.event.delta.text };
  }
  if (j.type === "result") {
    return { result: {
      text: typeof j.result === "string" ? j.result : "",
      isError: !!j.is_error,
      inputTokens: j.usage?.input_tokens ?? 0,
      outputTokens: j.usage?.output_tokens ?? 0,
      ...(typeof j.usage?.cache_creation_input_tokens === "number" ? { cacheWrite: j.usage.cache_creation_input_tokens } : {}),
      ...(typeof j.usage?.cache_read_input_tokens === "number" ? { cacheRead: j.usage.cache_read_input_tokens } : {}),
      ...(typeof j.num_turns === "number" ? { turns: j.num_turns } : {}),
      ...(typeof j.total_cost_usd === "number" ? { costUsd: j.total_cost_usd } : {}),
    } };
  }
  return null;
}

const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };

/**
 * The part of CORE's answer that can be shown while its reply is still arriving.
 * CORE replies {"thought": ..., "final": "<markdown>"} (or a tool call): return the decoded prefix of "final" so far,
 * the raw text if the reply is plain prose (parseAgentReply's fallback), or null if nothing is showable yet.
 */
export function partialAnswer(raw: string): string | null {
  const t = raw.trimStart();
  if (!t) return null;
  if (t[0] !== "{" && t[0] !== "`") { const k = t.search(/\{\s*"tool"\s*:|<function_calls>|<invoke[\s_>]/); return k < 0 ? t : t.slice(0, k).trimEnd() || null; } // prose: stop before any tool-call JSON
  const m = /(?:^|[^\\])"final"\s*:\s*"/.exec(raw);
  if (!m) return null;
  let out = "";
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') break;
    if (c !== "\\") { out += c; continue; }
    const n = raw[i + 1];
    if (n === undefined) break; // escape split across deltas: wait for the rest
    if (n === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += ESC[n] ?? n;
      i++;
    }
  }
  return out;
}
