import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Live 18 Nov: Profile → CORE engine saved the switch but the route answered 400 {"error":"mcp"}, because the engine name is a string.
test("setCoreEngine returns the engine on success and an error object only for bad input", async () => {
  process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "orbit-engine-"));
  const { setCoreEngine, coreEngine } = await import("../src/lib/core-engine.ts");
  assert.equal(await setCoreEngine("mcp"), "mcp");
  assert.equal(coreEngine(), "mcp");
  assert.equal(await setCoreEngine("json"), "cli");
  assert.deepEqual(await setCoreEngine("turbo"), { error: "engine must be json, mcp or sdk" });
  assert.equal(coreEngine(), "cli"); // a refused value changes nothing
  assert.equal(typeof (await setCoreEngine(null)), "string");
});
