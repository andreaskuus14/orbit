// Agent SDK prototype (ORBIT_CORE_ENGINE=sdk, docs/AGENT-SDK.md): the pure mapping between CORE and @anthropic-ai/claude-agent-sdk.
// No SDK import here, so it loads under node --test without the package.
import { decide, type Decision, type PolicyCtx } from "./policy-pure.ts";
import { skillDenied } from "./skills-pure.ts";
import type { StreamResult } from "./streamjson.ts";

export const CORE_ENGINE = process.env.ORBIT_CORE_ENGINE === "sdk" ? "sdk" : "cli";
export const SERVER = "orbit";
/** The prototype's tools: read-only (T0/T1). shortcut: 3 of CORE's tools, add the rest once the SDK path is chosen. */
export const SDK_TOOLS = ["fetch_url", "read_news", "goal_status"] as const;
export type SdkTool = (typeof SDK_TOOLS)[number];

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
export function sdkOptions(o: { model: string; system: string; server: unknown; maxTurns: number; cwd: string; effort?: string }) {
  return {
    model: o.model,
    systemPrompt: nativeSystem(o.system),
    tools: [] as string[], // no Bash/Read/Edit/WebFetch...
    mcpServers: { [SERVER]: o.server },
    strictMcpConfig: true,
    settingSources: [] as never[], // isolation: the owner's ~/.claude hooks, plugins and CLAUDE.md stay out
    allowedTools: SDK_TOOLS.map(sdkName), // our tools need no prompt: decide() inside each handler is the gate
    permissionMode: "dontAsk" as const, // anything else is denied, never classifier-approved
    persistSession: false, // stateless like the CLI path; resume is evaluated in docs/AGENT-SDK.md
    includePartialMessages: true,
    maxTurns: o.maxTurns,
    cwd: o.cwd,
    ...(o.effort ? { effort: o.effort } : {}),
  };
}

type Msg = {
  type?: string; subtype?: string; result?: unknown; is_error?: boolean; errors?: string[]; num_turns?: number; total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  event?: { type?: string; delta?: { type?: string; text?: unknown } }; parent_tool_use_id?: string | null;
  apiKeySource?: string; model?: string; session_id?: string; error?: string;
};

/** One SDK message → a streamed text delta, the auth seen at start-up, or the turn's result (StreamResult, like the CLI path). */
export function readMessage(m: Msg): { delta?: string; init?: { apiKeySource: string; model: string; sessionId: string }; result?: StreamResult & { errors: string[] } } | null {
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
