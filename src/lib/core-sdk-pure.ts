// Agent SDK prototype (ORBIT_CORE_ENGINE=sdk, docs/AGENT-SDK.md): the pure mapping between CORE and @anthropic-ai/claude-agent-sdk.
// No SDK import here, so it loads under node --test without the package.
import { decide, type Decision, type PolicyCtx } from "./policy-pure.ts";
import { skillDenied } from "./skills-pure.ts";
import type { StreamResult } from "./streamjson.ts";
import { streamJsonInput } from "./attach-pure.ts";

export const CORE_ENGINE = process.env.ORBIT_CORE_ENGINE === "sdk" ? "sdk" : "cli";
export const SERVER = "orbit";
/** core.ts's own tools (its TOOLS prompt section and runCoreTool/navigateTool); the rest are module tools (core-modules.ts). */
export const CORE_BUILTINS = ["web_search", "fetch_url", "read_news", "ask_agent", "save_memory", "navigate"] as const;
/** Every tool CORE's default loop can dispatch, in the order the SDK server registers them. */
export const sdkTools = (moduleTools: readonly string[]) => [...new Set([...CORE_BUILTINS, ...moduleTools])];

const PREFIX = `mcp__${SERVER}__`;
export const sdkName = (tool: string) => PREFIX + tool;
/** The ORBIT tool behind an SDK tool name, or null for anything that isn't ours (built-ins, other servers). */
export const orbitName = (name: string) => (name.startsWith(PREFIX) ? name.slice(PREFIX.length) : null);

/** core.ts's step record: decide() reads these for taint (navigate-first, private tools, links), so the format must match. */
export const stepLine = (tool: string, input: Record<string, unknown>, out: string) =>
  `You called ${tool} ${JSON.stringify(input).slice(0, 300)}\nRESULT:\n${out.slice(0, 8000)}`;

/** An ORBIT tool's text as an MCP tool result; "Error: ..." (core.ts's convention) becomes isError. */
export const toolResult = (out: string) => ({ content: [{ type: "text" as const, text: out.slice(0, 8000) }], isError: out.startsWith("Error:") });

/** Every SDK tool call passes skillDenied() and decide() first, exactly as core.ts's loop does; a refusal never runs the tool.
 *  ctx is read per call so a Stop-all flipped mid-turn applies to the next tool. attachBlock: the turn's attachment text (skill limits). */
export async function gated(tool: string, input: Record<string, unknown>, ctx: () => Omit<PolicyCtx, "steps">, steps: string[], run: () => Promise<string>, attachBlock = ""): Promise<{ out: string; verdict: Decision }> {
  const verdict = skillDenied(tool, attachBlock) ?? decide(tool, input, { ...ctx(), steps });
  let out: string;
  try { out = verdict.allow ? await run() : `Error: ${verdict.reason}`; }
  catch (e) { out = `Error: ${e instanceof Error ? e.message : String(e)}`; }
  steps.push(stepLine(tool, input, out));
  return { out, verdict };
}

/** The SDK runs a model's parallel tool calls at once; queued here so each decide() sees the steps before it (taint stays ordered). */
export function serial() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
}

/** CORE's system prompt with the JSON-envelope section swapped for native tool calls (the SDK runs the tool loop). */
export function nativeSystem(system: string): string {
  return system.replace(/HOW YOU ANSWER[\s\S]*?\n\nTOOLS:\n/, "HOW YOU ANSWER: write the answer in Markdown. Call a tool directly when you need one; only the tools offered to you this turn exist.\n\nTOOL NOTES:\n");
}

/** query() options: no built-in tools, no settings/CLAUDE.md/MCP from disk, only our server, and nothing runs unless allowed here. */
export function sdkOptions(o: { model: string; system: string; server: unknown; tools: readonly string[]; maxTurns: number; cwd: string; effort?: string; session?: { id: string; resume: boolean } }) {
  return {
    model: o.model,
    systemPrompt: nativeSystem(o.system),
    tools: [] as string[], // no Bash/Read/Edit/WebFetch...
    mcpServers: { [SERVER]: o.server },
    strictMcpConfig: true,
    settingSources: [] as never[], // isolation: the owner's ~/.claude hooks, plugins and CLAUDE.md stay out
    allowedTools: o.tools.map(sdkName), // our tools need no prompt: decide() inside each handler is the gate
    permissionMode: "dontAsk" as const, // anything else is denied, never classifier-approved
    ...sdkSession(o.session),
    includePartialMessages: true,
    maxTurns: o.maxTurns,
    cwd: o.cwd,
    ...(o.effort ? { effort: o.effort } : {}),
  };
}

/** ORBIT's per-chat CliSession (ORBIT_CORE_SESSION=resume) → query() options: a new chat starts the SDK session under ORBIT's
 *  own UUID, later turns resume it. No session: stateless, nothing written to ~/.claude/projects. */
export const sdkSession = (s?: { id: string; resume: boolean }) =>
  !s ? { persistSession: false } : s.resume ? { resume: s.id, persistSession: true } : { sessionId: s.id, persistSession: true };

/** The turn's prompt with attached images, as the one SDK user message (the same blocks the CLI path sends on stdin). */
export const userMessage = (prompt: string, images: { type: string; data: Uint8Array }[]) =>
  ({ ...JSON.parse(streamJsonInput(prompt, images)), parent_tool_use_id: null }) as { type: "user"; message: { role: "user"; content: unknown[] }; parent_tool_use_id: null };

// SDK assistant error codes → words core-capability-pure's describeFailure already recognises, so the owner gets the same messages.
const ERROR_WORDS: Record<string, string> = {
  rate_limit: "usage limit reached", billing_error: "usage limit reached",
  authentication_failed: "authentication failed", oauth_org_not_allowed: "authentication failed (organization not allowed)", account_on_hold: "authentication failed (account on hold)",
};
/** The Error message for a failed SDK turn: the API error code in plain words, then what the SDK said. */
export const sdkFailure = (code: string | undefined, said: string[]) =>
  [code ? (ERROR_WORDS[code] ?? code) : "", ...said].filter(Boolean).join(": ") || "agent sdk error";

type Msg = {
  type?: string; subtype?: string; result?: unknown; is_error?: boolean; errors?: string[]; num_turns?: number; total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  event?: { type?: string; delta?: { type?: string; text?: unknown } }; parent_tool_use_id?: string | null;
  apiKeySource?: string; model?: string; session_id?: string; error?: string;
};

/** One SDK message → a streamed text delta, the auth seen at start-up, or the turn's result (StreamResult, like the CLI path). */
export function readMessage(m: Msg): { delta?: string; error?: string; init?: { apiKeySource: string; model: string; sessionId: string }; result?: StreamResult & { errors: string[] } } | null {
  if (m.type === "assistant" && m.error) return { error: m.error };
  if (m.type === "stream_event" && !m.parent_tool_use_id && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta" && typeof m.event.delta.text === "string")
    return { delta: m.event.delta.text };
  if (m.type === "system" && m.subtype === "init") return { init: { apiKeySource: m.apiKeySource ?? "", model: m.model ?? "", sessionId: m.session_id ?? "" } };
  if (m.type === "result") {
    const u = m.usage ?? {};
    return { result: {
      text: typeof m.result === "string" ? m.result : "", isError: !!m.is_error || m.subtype !== "success",
      errors: m.subtype === "success" ? [] : [m.subtype ?? "error", ...(m.errors ?? [])],
      inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens,
      turns: m.num_turns, costUsd: m.total_cost_usd,
    } };
  }
  return null;
}

/** "none" = no API key: the bundled CLI used the owner's claude.ai login (subscription). Anything else bills that key. */
export const authMode = (apiKeySource: string) => (apiKeySource === "none" ? "subscription login" : `API key (${apiKeySource})`);
