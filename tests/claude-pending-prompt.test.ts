import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fake `claude` that echoes its stdin as one stream-json answer. Shebang scripts don't run on Windows.
const skip = process.platform === "win32" && "the fake CLI needs a shebang";
const dir = mkdtempSync(join(tmpdir(), "orbit-fake-cli-"));
const bin = join(dir, "claude.mjs");
writeFileSync(bin, `#!/usr/bin/env node
let input = ""; for await (const c of process.stdin) input += c;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: input } } });
out({ type: "result", result: input, is_error: false, usage: { input_tokens: 1, output_tokens: 1 } });
`);
chmodSync(bin, 0o755);
process.env.ORBIT_CLAUDE_BIN = bin;
process.env.ORBIT_DATA_DIR = dir; // the usage meter writes here
const load = () => import("../src/lib/claude.ts");

test("a pending prompt reaches the CLI once it resolves", { skip }, async () => {
  const { askClaudeStream } = await load();
  let streamed = "";
  const r = await askClaudeStream(new Promise<string>((res) => setTimeout(() => res("hello from prep"), 50)), "sys", (d) => (streamed += d), undefined, "foreground");
  assert.equal(r.text, "hello from prep");
  assert.equal(streamed, "hello from prep");
});

test("a prompt that fails to build rejects the call and stops the CLI", { skip }, async () => {
  const { askClaudeStream } = await load();
  await assert.rejects(askClaudeStream(Promise.reject(new Error("prep failed")), "sys", () => {}, undefined, "foreground"), /prep failed/);
});
