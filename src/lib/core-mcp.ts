// MCP engine (ORBIT_CORE_ENGINE=mcp or Profile → CORE engine): one CORE turn on Claude Code's native tool loop.
// `claude -p` gets only ORBIT's tools (a per-turn --mcp-config, --strict-mcp-config, built-ins off, dontAsk); every call comes back here
// through a 127.0.0.1 bridge with a per-turn token and runs core.ts's own decide() → authorizeTool() → exec() → record() path.
// A Stop hook asks the same bridge for the done-check (core-mcp-pure doneGate). Pure parts: core-mcp-pure.ts.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { askClaude, emit, recordUsage } from "./claude";
import { MODULE_PROMPT, MODULE_TOOLS } from "./core-modules";
import { pluginPromptNow, pluginSchemasNow, pluginToolNames } from "./plugins";
import { authorizeTool } from "./authority";
import { policyEvent } from "./policy-pure";
import { stopAllOn } from "./stop-all";
import type { WriteEvidence } from "./completion-pure";
import type { CoreEvalTool } from "./core-answer-eval-pure";
import { gated, nativeSystem, sdkTools, serial, toolResult, SERVER } from "./core-sdk-pure";
import { verifierContinue } from "./verifier-pure";
import { fixHint, prepareArgs } from "./mcp-schemas-pure";
import { ACTION_BLOCK, doneGate, mcpCliFiles, exposedTools, mcpEvent, mcpToolList, toolDocs, tokenOk } from "./core-mcp-pure";
import type { Turn } from "./core-sdk";
import { boostTurn } from "./core-mcp-boost";
import { needsOpus, stripSkills } from "./core-mcp-boost-pure";

type McpTurn = Turn & { question: string; tools: CoreEvalTool[] };
type Handlers = { tools: () => unknown; call: (name: string, args: Record<string, unknown>) => Promise<unknown>; stop: (body: Record<string, unknown>) => unknown; pre?: (body: Record<string, unknown>) => unknown };

const MAX_BODY = 1_000_000;
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = "";
  for await (const c of req) { s += c; if (s.length > MAX_BODY) throw new Error("body too large"); }
  const j = s ? JSON.parse(s) : {};
  return j && typeof j === "object" && !Array.isArray(j) ? j : {};
}

/** The turn's bridge: 127.0.0.1 only, random port, every request needs the turn's token. Closed when the turn ends. */
async function openBridge(token: string, h: Handlers): Promise<{ url: string; close: () => void }> {
  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.method !== "POST" || !tokenOk(req.headers.authorization, token)) return send(401, { error: "unauthorized" });
    try {
      const b = await body(req);
      if (req.url === "/tools") return send(200, { tools: h.tools() });
      if (req.url === "/call") return send(200, await h.call(String(b.name ?? ""), b.arguments && typeof b.arguments === "object" ? b.arguments as Record<string, unknown> : {}));
      if (req.url === "/stop") return send(200, await h.stop(b));
      if (req.url === "/pre" && h.pre) return send(200, h.pre(b)); // PreToolUse hook (core-mcp-boost.ts)
      send(404, { error: "not found" });
    } catch (e) { send(400, { error: e instanceof Error ? e.message : "bad request" }); }
  });
  await new Promise<void>((ok, bad) => { srv.once("error", bad); srv.listen(0, "127.0.0.1", ok); });
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => { srv.closeAllConnections?.(); srv.close(); } };
}

// web_search and ask_agent can take minutes; the CLI's default MCP tool timeout would cut them off. MCP_TIMEOUT = server startup.
const MCP_ENV = { MCP_TOOL_TIMEOUT: "180000", MCP_TIMEOUT: "30000" };
const TURN_CAP_MS = 280_000; // the turn's own deadline (core.ts runCoreFor) aborts first; this only bounds a stuck CLI

/** Runs the turn; same contract as core-sdk.ts sdkTurn (escalated: the fast model reached for a tool, core.ts redoes it on the main model). */
export async function mcpTurn(t: McpTurn): Promise<{ text: string; sessionId: string; escalated?: boolean; opus?: boolean }> {
  const ac = new AbortController();
  const signal = t.signal ? AbortSignal.any([t.signal, ac.signal]) : ac.signal;
  let escalated = false, opus = false, blocks = 0, hookSeen = false;
  const one = serial(); // parallel tool calls run one at a time, so each decide() sees the steps before it (as the SDK engine)
  const names = exposedTools(sdkTools([...MODULE_TOOLS, ...pluginToolNames()]), t.policy());
  // every tool is listed natively with its own description here, so the JSON loop's MODULE TOOLS pointer doesn't apply
  const native = nativeSystem(t.system).replace(/their instructions come in the request's MODULE TOOLS block[^;]*; call only tools described there or above/, "each one's input and rules are in its tool description; call only the tools offered to you");
  const b = await boostTurn({ ...t, system: `${native}\n\n${ACTION_BLOCK}` }); // model route, skills, native files, cache order
  const list = mcpToolList(names, toolDocs(stripSkills(`${t.system}\n${MODULE_PROMPT}\n${pluginPromptNow()}`), names), pluginSchemasNow());
  const call = (name: string, raw: Record<string, unknown>) => one(async () => {
    if (!names.includes(name)) return toolResult(`Error: unknown tool "${name.slice(0, 60)}"; call only the tools listed for this turn`);
    opus = !b.route.risky && needsOpus(name, b.route.model); // a usage-limit step-down below Opus counts too
    if ((t.escalate && b.route.tier === "fast") || opus) { escalated = true; ac.abort(); return toolResult("Error: stopped"); }
    const prepared = prepareArgs(name, raw); // JSON-string arrays → arrays, required props checked with a how-to-call error
    if ("error" in prepared) return toolResult(prepared.error);
    const input = prepared.args;
    t.onReset?.(); t.onStep?.(name, input); // text before a tool call is not the answer (as in core.ts)
    const at = Date.now(), evidence: WriteEvidence[] = [];
    const { out, verdict, operated } = await gated(name, input, t.policy, t.steps, (op) => t.exec(name, input, evidence, op), t.attachBlock, authorizeTool);
    const row = policyEvent(name, verdict);
    if (row) void emit(t.sb, t.userId, "policy.decision", "core", { ...row, turn: t.turnId });
    t.record(name, input, out, evidence, Date.now() - at, operated);
    if (!verdict.allow && t.turnId) t.trace.at(-1)!.policy = { verdict: "refuse", turn: t.turnId };
    return toolResult(fixHint(name, out));
  });
  const gate = () => (signal.aborted || stopAllOn() ? { block: false as const } : doneGate(t.question, t.tools, blocks));
  const stop = async () => {
    hookSeen = true;
    const open = await b.beforeGate(); // native edits → ORBIT's site check first
    const d = gate();
    if (!d.block) return {};
    blocks++; t.onReset?.();
    t.trace.push({ step: "done_gate", detail: `blocked the stop (${blocks}): ${d.reason.slice(0, 160)}`, ms: 0, ok: false });
    return { decision: "block", reason: d.reason + open };
  };

  const token = randomBytes(32).toString("hex");
  const bridge = await openBridge(token, { tools: () => list, call, stop, pre: b.pre });
  const dir = await mkdtemp(join(tmpdir(), "orbit-mcp-"));
  try {
    const file = join(dir, "bridge.json"), config = join(dir, "mcp.json"), settings = join(dir, "settings.json");
    await writeFile(file, JSON.stringify({ url: bridge.url, token }), { mode: 0o600 });
    const cli = mcpCliFiles(process.execPath, join(process.cwd(), "scripts", "orbit-mcp.mjs"), file, SERVER);
    await writeFile(config, JSON.stringify(cli.config));
    const node = process.execPath.replace(/\\/g, "/");
    await writeFile(settings, JSON.stringify(b.settings(cli.settings, node, file)));
    const system = b.system;
    const started = Date.now();
    let result: ReturnType<typeof mcpEvent> = null;
    const run = (prompt: string, session = t.session) => b.run((model, effort) => askClaude(prompt, system, {
      lane: "foreground", signal, model, images: t.images, effort, timeoutMs: TURN_CAP_MS, purpose: "core",
      mcp: b.access({ allow: [`mcp__${SERVER}__*`], settings, config, env: MCP_ENV }), session,
      onLine: (line) => {
        const ev = mcpEvent(line);
        if (ev?.delta) t.onDelta?.(ev.delta);
        if (ev?.result) result = ev;
        if (ev?.init) t.trace.push({ step: "mcp", detail: `claude -p · ${ev.init.model} · orbit ${ev.init.orbit} · ${ev.init.tools} tools`, ms: Date.now() - started, ok: ev.init.orbit === "connected" });
      },
    }));
    let r;
    try { r = await run(b.prompt); }
    catch (e) { if (escalated && !t.signal?.aborted) return { text: "", sessionId: t.session?.id ?? "", escalated, opus }; throw e; }
    // No Stop hook ran (hooks off in this CLI): the same check after the run, with one automatic continue.
    const open = !hookSeen && !escalated ? await b.beforeGate() : "";
    const after = !hookSeen && !escalated ? gate() : { block: false as const };
    if (after.block) {
      blocks++; t.onReset?.();
      t.trace.push({ step: "done_gate", detail: `auto-continue: ${after.reason.slice(0, 160)}`, ms: 0, ok: false });
      const again = t.session ? after.reason + open : `${b.prompt}\n\nYOUR TOOL RESULTS SO FAR:\n${t.steps.join("\n\n")}\n\nYOUR PREVIOUS REPLY:\n${r.text}\n\n${after.reason}${open}`;
      r = await run(again, t.session && { id: t.session.id, resume: true });
    }
    // Independent verifier (verifier.ts): a "not verified" gets one more continue with its reason, then the final verdict.
    const v = escalated || signal.aborted || stopAllOn() ? null : await t.verify?.(r.text);
    if (v && !v.ok) { // once per turn, on top of the done-gate's own cap
      blocks++; t.onReset?.();
      t.trace.push({ step: "done_gate", detail: `verifier continue: ${v.reason.slice(0, 160)}`, ms: 0, ok: false });
      const again = t.session ? verifierContinue(v) : `${b.prompt}\n\nYOUR TOOL RESULTS SO FAR:\n${t.steps.join("\n\n")}\n\nYOUR PREVIOUS REPLY:\n${r.text}\n\n${verifierContinue(v)}`;
      r = await run(again, t.session && { id: t.session.id, resume: true });
      await t.verify?.(r.text);
    }
    await recordUsage(t.sb, t.userId, "core.chat", r, b.route.model);
    const res = (result as ReturnType<typeof mcpEvent>)?.result;
    t.trace.push({ step: "think", detail: `${b.route.model} · mcp · ${res?.turns ?? 0} turns · cache read ${res?.cacheRead ?? 0} tok`, ms: Date.now() - started, ok: true });
    return { text: r.text, sessionId: t.session?.id ?? "" };
  } finally {
    bridge.close();
    rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}
