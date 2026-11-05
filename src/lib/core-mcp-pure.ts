// CORE's MCP engine (ORBIT_CORE_ENGINE=mcp or Profile → CORE engine): pure parts. Claude Code's own tool loop drives ORBIT's tools through a
// local stdio MCP server (scripts/orbit-mcp.mjs) that forwards every call to this turn's bridge (core-mcp.ts), where the same
// decide() → authorizeTool() → exec() → record() path runs as in the JSON loop. Tests: tests/core-mcp-pure.test.ts.
import { timingSafeEqual } from "node:crypto";
import { APPROVAL_PATHS, TIERS, TOOL_AREA, type PolicyCtx } from "./policy-pure.ts";
import { coreToolRefusal } from "./stop-all-pure.ts";
import { autonomyAllows } from "./autonomy-pure.ts";
import { isPluginTool } from "./plugins-pure.ts";
import { acceptanceOf, coreReceipt } from "./receipt-pure.ts";
import { parseStreamJsonLine, type StreamResult } from "./streamjson.ts";
import type { WriteEvidence } from "./completion-pure.ts";
import { SCHEMAS, type Schema } from "./mcp-schemas-pure.ts";

export type Engine = "cli" | "mcp" | "sdk";
export const ENGINES: readonly Engine[] = ["cli", "mcp", "sdk"];
/** "json" is the owner-facing name of the default engine (CORE's own JSON tool loop over `claude -p`). */
export const parseEngine = (raw: unknown): Engine | null => {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "json" || v === "cli" ? "cli" : v === "mcp" || v === "sdk" ? v : null;
};
/** The owner's Profile choice wins; else ORBIT_CORE_ENGINE; else the JSON loop. */
export const pickEngine = (saved: unknown, env: unknown): Engine => parseEngine(saved) ?? parseEngine(env) ?? "cli";

/** Tools a turn must not even see: unknown ones, ones Stop-all pauses, an Autonomy area set to Off, T3 without an approval path.
 *  Input- and taint-dependent checks stay in decide(), which still gates every call. */
export function exposedTools(names: readonly string[], ctx: Pick<PolicyCtx, "stopAll" | "autonomy" | "plugins">): string[] {
  return names.filter((n) => {
    if (isPluginTool(n)) return !!ctx.plugins?.[n] && ctx.plugins[n].mode !== "off";
    if (!(n in TIERS) || coreToolRefusal(ctx.stopAll, n)) return false;
    if (TIERS[n] === "T3" && !APPROVAL_PATHS[n]) return false;
    const area = TOOL_AREA[n];
    return !area || autonomyAllows(area, "owner", { levels: ctx.autonomy }).ok;
  });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Each tool's own instructions, cut from CORE's prompt text (TOOLS lines and module lines): from its name to the next tool's name,
 *  with the module's header after it. The most-used tools also get a real schema (mcp-schemas-pure.ts). */
export function toolDocs(text: string, names: readonly string[], cap = 700): Record<string, string> {
  const any = new RegExp(`(?<![\\w])(?:${[...names].sort((a, b) => b.length - a.length).map(esc).join("|")})(?=\\s*[{(:])`, "g");
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const hits = [...line.matchAll(any)];
    if (!hits.length) continue;
    const head = line.slice(0, hits[0].index).replace(/^\s*-\s*/, "").replace(/[:\s]+$/, "").slice(0, 200);
    hits.forEach((h, i) => {
      if (out[h[0]]) return;
      const body = line.slice(h.index, hits[i + 1]?.index ?? line.length).trim().replace(/[.;,]\s*$/, ".");
      out[h[0]] = `${body}${head ? ` (${head})` : ""}`.slice(0, cap); // args first: the cap cuts the module header, not the call's shape
    });
  }
  for (const n of names) out[n] ??= `ORBIT tool ${n}.`;
  return out;
}

export type McpTool = { name: string; description: string; inputSchema: Schema | Record<string, unknown>; annotations: { readOnlyHint: boolean; destructiveHint: boolean } };
/** The MCP tools/list payload. Schema'd tools are checked by prepareArgs; the rest are documented in the description and validated by each runner. */
/** `extra`: plugin tools' own schemas (plugins-pure pluginSchemas), listed exactly as their server gave them. */
export const mcpToolList = (names: readonly string[], docs: Record<string, string>, extra: Record<string, Record<string, unknown>> = {}): McpTool[] =>
  names.map((name) => ({
    name, description: docs[name] ?? `ORBIT tool ${name}.`,
    inputSchema: SCHEMAS[name] ?? (extra[name] ? { type: "object", ...extra[name] } : { type: "object", additionalProperties: true }),
    annotations: { readOnlyHint: /^T[01]$/.test(TIERS[name] ?? ""), destructiveHint: TIERS[name] === "T3" },
  }));

/** Per-turn bridge auth: the Bearer token the MCP server and the Stop hook send, compared in constant time. */
export function tokenOk(header: unknown, token: string): boolean {
  const got = Buffer.from(String(header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return token.length >= 32 && got.length === want.length && timingSafeEqual(got, want);
}

/** Appended to CORE's native-tool system prompt (Anthropic's default-to-action and persistence guidance + ORBIT's ask rule). */
export const ACTION_BLOCK = `<default_to_action>
By default, do the work rather than only suggesting it. If the request leaves a detail open, infer the most useful likely reading and proceed, using your tools to discover missing details instead of guessing.
</default_to_action>
<persistence>
Keep working until the request is fully done before you end your turn: its acceptance is met and what you saved or built has been checked. Do not stop early or hand in-scope steps back to the user as options. If a tool refuses or something truly can't be done, say plainly what is missing.
</persistence>
Ask, or end with a "Choices:" line, ONLY when the next step would send, publish, upload or spend, or when two readings of the request lead to materially different results. Otherwise pick the most useful reading, do it, and state the assumption in one line.`;

/** stream-json lines → what the turn needs: answer deltas (top-level only), the init check, tool-use starts and the final result. */
export type McpEvent = { delta?: string; init?: { model: string; sessionId: string; orbit: string; tools: number }; toolUse?: string; result?: StreamResult };
export function mcpEvent(line: string): McpEvent | null {
  let j: { type?: string; subtype?: string; model?: string; session_id?: string; tools?: unknown; mcp_servers?: unknown; parent_tool_use_id?: string | null; message?: { content?: unknown } };
  try { j = JSON.parse(line); } catch { return null; }
  if (!j || typeof j !== "object" || j.parent_tool_use_id) return null; // a subagent's stream is not CORE's answer
  if (j.type === "system" && j.subtype === "init") {
    const servers = Array.isArray(j.mcp_servers) ? j.mcp_servers as { name?: string; status?: string }[] : [];
    const tools = Array.isArray(j.tools) ? (j.tools as unknown[]).filter((t) => typeof t === "string" && t.startsWith("mcp__orbit__")).length : 0;
    return { init: { model: j.model ?? "", sessionId: j.session_id ?? "", orbit: servers.find((s) => s?.name === "orbit")?.status ?? "missing", tools } };
  }
  if (j.type === "assistant" && Array.isArray(j.message?.content)) {
    const use = (j.message.content as { type?: string; name?: string }[]).find((c) => c?.type === "tool_use");
    return use?.name ? { toolUse: use.name } : null;
  }
  const r = parseStreamJsonLine(line);
  return r ? { ...(r.delta !== undefined && { delta: r.delta }), ...(r.result && { result: r.result }) } : null;
}

export const GATE_CAP = 2; // Claude Code also overrides a Stop hook after repeated blocks; ours gives up first
type GateTool = { tool: string; input: Readonly<Record<string, unknown>>; output: string; evidence: readonly WriteEvidence[] };
/** The done-gate: may this turn end? Only asks with a countable or checkable acceptance ("add 5 leads", "build a site") gate;
 *  "writes" asks (incl. "publish this", which must stop and ask) never block. Blocks at most `cap` times per turn. */
export function doneGate(question: string, tools: readonly GateTool[], blocks: number, cap = GATE_CAP): { block: false } | { block: true; reason: string } {
  const acc = acceptanceOf(question);
  if (acc.kind === "writes" || blocks >= cap) return { block: false };
  const r = coreReceipt(question, tools);
  if (r?.status === "verified") return { block: false };
  const need = r ? r.accept : acc.text;
  const failed = r?.failed.length ? ` Still failing: ${r.failed.slice(0, 3).join("; ")}.` : "";
  const open = r?.claimed.length ? ` Not checked yet: ${r.claimed.slice(0, 3).join("; ")}.` : "";
  return { block: true, reason: `ORBIT done-check: the request is not met yet (needs ${need}${r ? "" : "; nothing has been saved or built yet"}).${failed}${open} Keep working with your tools until it is met, then answer. If a tool refused or it truly can't be done, stop and say plainly what is missing; don't offer choices for work you can do yourself.` };
}

/** Per-turn CLI files, the same on Windows: the MCP server entry is spawned by Claude Code without a shell (raw paths, args array);
 *  the Stop hook command runs through bash (also on Windows, as clips/higgsfield.ts), so forward slashes, double quotes, and
 *  bash's specials ($ ` ") escaped. Inputs are path.join results (backslashes on Windows). */
export function mcpCliFiles(node: string, script: string, bridgeFile: string, server: string) {
  const fwd = (p: string) => p.replace(/\\/g, "/");
  const sh = (p: string) => `"${fwd(p).replace(/[$`"]/g, "\\$&")}"`;
  return {
    config: { mcpServers: { [server]: { type: "stdio", command: node, args: [fwd(script), "serve", fwd(bridgeFile)] } } },
    settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: `${sh(node)} ${sh(script)} stop ${sh(bridgeFile)}`, timeout: 30 }] }] } },
  };
}
