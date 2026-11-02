// ORBIT's tools for Claude Code (ORBIT_CORE_ENGINE=mcp or Profile → CORE engine). Started by `claude -p` for one CORE turn:
//   node scripts/orbit-mcp.mjs serve <bridge.json>  stdio MCP server: tools/list and tools/call are forwarded to the turn's bridge
//   node scripts/orbit-mcp.mjs stop <bridge.json>   Stop hook: asks the bridge's done-check whether the turn may end
// bridge.json = {url, token}: a 127.0.0.1 endpoint inside the running ORBIT server and its per-turn token (core-mcp.ts). This file
// holds no tool logic: policy, approvals, privacy, Stop-all, receipts and Activity all run in ORBIT, exactly as in the JSON loop.
import { readFileSync } from "node:fs";

const [mode, file] = process.argv.slice(2);
const bridge = JSON.parse(readFileSync(file, "utf8"));
const post = async (path, body) => {
  const r = await fetch(bridge.url + path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bridge.token}` }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) throw new Error(`ORBIT bridge ${path} answered ${r.status}`);
  return r.json();
};

if (mode === "stop") {
  // Never blocks on its own failure: an unreachable bridge lets the turn end (the post-run check in core-mcp.ts still applies).
  let input = "";
  for await (const c of process.stdin) input += c;
  try { process.stdout.write(JSON.stringify(await post("/stop", JSON.parse(input || "{}")))); } catch { /* allow the stop */ }
} else if (mode === "serve") {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
  const server = new Server({ name: "orbit", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await post("/tools")).tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const r = await post("/call", { name: req.params.name, arguments: req.params.arguments ?? {} });
      return { content: Array.isArray(r.content) ? r.content : [], isError: !!r.isError }; // ORBIT's toolResult(): text clipped, "Error: ..." = isError
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
} else {
  console.error("usage: orbit-mcp.mjs serve|stop <bridge.json>");
  process.exit(2);
}
