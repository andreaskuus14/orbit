import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { validatePlugin } from "../src/lib/plugins-pure.ts";

test("authenticated HTTP MCP: discover and call tools without exposing credentials", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-mcp-http-"));
  process.env.ORBIT_DATA_DIR = dir;
  const token = "synthetic-mcp-token-for-test-only";
  process.env.ORBIT_MCP_TEST_TOKEN = token;
  let requests = 0, calls = 0, reject = false;
  const http = createServer(async (req, res) => {
    requests++;
    if (reject || req.headers.authorization !== `Bearer ${token}`) {
      // Even an upstream error that reflects credentials must never reach Activity or the UI.
      res.writeHead(401); res.end(`rejected ${req.headers.authorization ?? "missing token"}`); return;
    }
    const server = new Server({ name: "authenticated-fixture", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
      { name: "read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    ] }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      calls++; return { content: [{ type: "text", text: "verified fixture result" }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  const P = await import("../src/lib/plugins.ts");
  try {
    const plugin = validatePlugin({ name: "remote", url: `http://127.0.0.1:${port}/mcp`, bearerTokenEnv: "ORBIT_MCP_TEST_TOKEN" });
    assert.notEqual(typeof plugin, "string");
    await P.updatePlugins(() => [plugin as Exclude<typeof plugin, string>]);
    assert.deepEqual(await P.testPlugin("remote"), { ok: true, tools: 1 });
    assert.match(await P.runPluginTool("plugin__remote__read", {}, { steps: [], pinned: false }), /verified fixture result/);
    assert.equal(calls, 1);
    delete process.env.ORBIT_MCP_TEST_TOKEN;
    const before = requests;
    const missing = await P.testPlugin("remote");
    assert.equal(missing.ok, false);
    assert.match(missing.error!, /ORBIT_MCP_TEST_TOKEN.*restart/i);
    assert.equal(requests, before, "missing credentials must fail before a network request");
    process.env.ORBIT_MCP_TEST_TOKEN = token;
    reject = true;
    const denied = await P.testPlugin("remote");
    assert.equal(denied.ok, false);
    assert.match(denied.error!, /authentication.*401/i);
    assert.doesNotMatch(denied.error!, new RegExp(token));
    assert.doesNotMatch(JSON.stringify(P.loadPlugins()), new RegExp(token));
    await new Promise((r) => setTimeout(r, 100)); // Activity writes are asynchronous.
    assert.doesNotMatch(await readFile(path.join(dir, "activity.jsonl"), "utf8"), new RegExp(token));
  } finally {
    delete process.env.ORBIT_MCP_TEST_TOKEN;
    await P.closeAllPlugins();
    await new Promise<void>((resolve, reject) => http.close((e) => e ? reject(e) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
