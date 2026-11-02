import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_BLOCK, doneGate, exposedTools, mcpCliFiles, mcpEvent, mcpToolList, parseEngine, pickEngine, tokenOk, toolDocs, GATE_CAP } from "../src/lib/core-mcp-pure.ts";

test("engine: Profile choice beats env; json is the default loop's name; junk falls back", () => {
  assert.equal(parseEngine("json"), "cli");
  assert.equal(parseEngine(" MCP "), "mcp");
  assert.equal(parseEngine("gpt"), null);
  assert.equal(pickEngine(null, undefined), "cli");
  assert.equal(pickEngine(null, "sdk"), "sdk");
  assert.equal(pickEngine("mcp", "sdk"), "mcp");
  assert.equal(pickEngine("nope", "nope"), "cli");
});

test("exposed tools: unknown, Stop-all-paused and Autonomy-off tools are never offered", () => {
  const base = { stopAll: false, autonomy: {}, plugins: {} };
  assert.deepEqual(exposedTools(["web_search", "made_up", "ask_agent"], base), ["web_search", "ask_agent"]);
  assert.deepEqual(exposedTools(["web_search", "ask_agent", "create_goal"], { ...base, stopAll: true }), ["web_search"]);
  assert.deepEqual(exposedTools(["save_memory", "fetch_url"], { ...base, autonomy: { memory: "off" } }), ["fetch_url"]);
  const plugins = { plugin__x__a: { mode: "off", tier: "T0" }, plugin__x__b: { mode: "ask", tier: "T0" } } as never;
  assert.deepEqual(exposedTools(["plugin__x__a", "plugin__x__b", "plugin__x__c"], { ...base, plugins }), ["plugin__x__b"]);
});

test("tool docs: each tool's own text from CORE's prompt lines, with its module header; caps and fallbacks", () => {
  const text = `TOOLS:\n- web_search {"query": string}: search the whole web.\n- WORKSPACE (his sites): ws_list {}: list them. ws_write {"workspace": string, "files": [...]}: write files.`;
  const d = toolDocs(text, ["web_search", "ws_list", "ws_write", "ws_read"]);
  assert.equal(d.web_search, 'web_search {"query": string}: search the whole web.');
  assert.equal(d.ws_list, "ws_list {}: list them. (WORKSPACE (his sites))"); // args first, the module header after
  assert.match(d.ws_write, /^ws_write \{"workspace"[^]*\(WORKSPACE \(his sites\)\)$/);
  assert.match(toolDocs(`- ${"H".repeat(300)}: ws_run {"workspace": string}: ${"x".repeat(900)}`, ["ws_run"]).ws_run, /^ws_run \{"workspace": string\}/);
  assert.equal(d.ws_read, "ORBIT tool ws_read.");
  assert.ok(toolDocs(`- web_search {}: ${"x".repeat(2000)}`, ["web_search"]).web_search.length <= 700);
  const [t] = mcpToolList(["web_search"], d), [w] = mcpToolList(["ws_write"], d), [h] = mcpToolList(["higgsfield_draft"], {});
  assert.equal(t.annotations.readOnlyHint, true);
  assert.equal(w.annotations.readOnlyHint, false);
  assert.equal(h.annotations.destructiveHint, true);
  assert.deepEqual((t.inputSchema as { required: string[] }).required, ["query"]); // a real schema for the common tools
  assert.deepEqual(h.inputSchema, { type: "object", additionalProperties: true });
});

test("CLI files on Windows: raw MCP server args (no shell), bash-quoted hook with forward slashes and spaces kept", () => {
  const f = mcpCliFiles("C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\Andreas Kuus\\orbit\\scripts\\orbit-mcp.mjs", "C:\\Users\\AN~1\\AppData\\Local\\Temp\\orbit-mcp-x\\bridge.json", "orbit");
  const srv = f.config.mcpServers.orbit;
  assert.equal(srv.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(srv.args, ["C:/Users/Andreas Kuus/orbit/scripts/orbit-mcp.mjs", "serve", "C:/Users/AN~1/AppData/Local/Temp/orbit-mcp-x/bridge.json"]);
  assert.equal(f.settings.hooks.Stop[0].hooks[0].command, '"C:/Program Files/nodejs/node.exe" "C:/Users/Andreas Kuus/orbit/scripts/orbit-mcp.mjs" stop "C:/Users/AN~1/AppData/Local/Temp/orbit-mcp-x/bridge.json"');
  assert.equal(mcpCliFiles("/usr/bin/node", "/home/a$b/s.mjs", "/tmp/x.json", "orbit").settings.hooks.Stop[0].hooks[0].command, '"/usr/bin/node" "/home/a\\$b/s.mjs" stop "/tmp/x.json"');
});

test("bridge token: exact Bearer match only, short tokens refused", () => {
  const tok = "a".repeat(64);
  assert.equal(tokenOk(`Bearer ${tok}`, tok), true);
  assert.equal(tokenOk(tok, tok), true);
  assert.equal(tokenOk(`Bearer ${tok}x`, tok), false);
  assert.equal(tokenOk(undefined, tok), false);
  assert.equal(tokenOk("Bearer short", "short"), false);
});

test("stream-json: init check, top-level deltas, tool-use starts, result; subagent lines ignored", () => {
  const init = mcpEvent(JSON.stringify({ type: "system", subtype: "init", model: "claude-x", session_id: "s1", tools: ["mcp__orbit__web_search", "mcp__orbit__ws_write", "Other"], mcp_servers: [{ name: "orbit", status: "connected" }] }));
  assert.deepEqual(init, { init: { model: "claude-x", sessionId: "s1", orbit: "connected", tools: 2 } });
  assert.equal(mcpEvent(JSON.stringify({ type: "system", subtype: "init", mcp_servers: [] }))?.init?.orbit, "missing");
  assert.deepEqual(mcpEvent(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } })), { delta: "Hi" });
  assert.equal(mcpEvent(JSON.stringify({ type: "stream_event", parent_tool_use_id: "t1", event: { type: "content_block_delta", delta: { type: "text_delta", text: "sub" } } })), null);
  assert.deepEqual(mcpEvent(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x" }, { type: "tool_use", name: "mcp__orbit__ws_write" }] } })), { toolUse: "mcp__orbit__ws_write" });
  const r = mcpEvent(JSON.stringify({ type: "result", subtype: "success", result: "done", num_turns: 3, usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 9 } }));
  assert.equal(r?.result?.text, "done");
  assert.equal(r?.result?.turns, 3);
  assert.equal(mcpEvent("not json"), null);
});

const lead = (name: string) => ({ tool: "lead_create", input: {}, output: `added "${name}" (id ${name})`, evidence: [] });
test("done-gate: blocks an unmet count or an unchecked site, never a plain ask, at most GATE_CAP times", () => {
  const q = "Add 3 leads: bakeries in Tartu";
  const g = doneGate(q, [lead("a")], 0);
  assert.equal(g.block, true);
  assert.match(g.block ? g.reason : "", /3 leads saved \(got 1\)/);
  assert.match(doneGate(q, [], 0).block ? (doneGate(q, [], 0) as { reason: string }).reason : "", /nothing has been saved or built yet/);
  assert.equal(doneGate(q, [lead("a"), lead("b"), lead("c")], 0).block, false);
  assert.equal(doneGate(q, [lead("a")], GATE_CAP).block, false);
  assert.equal(doneGate("Publish this Short to YouTube now.", [], 0).block, false); // must stop and ask: never pushed on
  assert.equal(doneGate("What's the weather?", [], 0).block, false);
  const site = "Build me a website for a bakery";
  assert.equal(doneGate(site, [{ tool: "ws_write", input: {}, output: "Wrote 1 file", evidence: [{ kind: "file", id: "w", path: "index.html" }] as never }], 0).block, true); // no site check ran
  assert.equal(doneGate(site, [{ tool: "ws_write", input: {}, output: "Wrote 1 file\nCheck: all good", evidence: [{ kind: "file", id: "w", path: "index.html" }] as never }], 0).block, false);
});

test("action block: default to action, persistence, ask only for send/publish/spend or real ambiguity", () => {
  assert.match(ACTION_BLOCK, /<default_to_action>/);
  assert.match(ACTION_BLOCK, /Do not stop early/);
  assert.match(ACTION_BLOCK, /send, publish, upload or spend/);
});
