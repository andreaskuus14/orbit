import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fake `claude` that echoes its stdin as one stream-json answer. Shebang scripts don't run on Windows.
const skip = process.platform === "win32" && "the fake CLI needs a shebang";
const dir = mkdtempSync(join(tmpdir(), "orbit-fake-cli-"));
const bin = join(dir, "claude.mjs");
writeFileSync(bin, `#!/usr/bin/env node
import { writeFileSync as w } from "node:fs"; w(${JSON.stringify(join(dir, "argv.txt"))}, process.argv.slice(2).join(" "));
let input = ""; for await (const c of process.stdin) input += c;
// Like the real CLI: with --input-format stream-json the prompt arrives as one JSON user message.
if (process.argv.includes("stream-json") && process.argv[process.argv.indexOf("--input-format") + 1] === "stream-json") input = JSON.parse(input).message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
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

test("a pending prompt is sent as stream-json, which waits (plain -p gives up on stdin after 3 s)", { skip }, async () => {
  const { askClaudeStream } = await load();
  await askClaudeStream(new Promise<string>((res) => setTimeout(() => res("slow prep"), 50)), "sys", () => {}, undefined, "foreground");
  const argv = readFileSync(join(dir, "argv.txt"), "utf8");
  assert.match(argv, /--input-format stream-json/);
});

test("a prompt that fails to build rejects the call and stops the CLI", { skip }, async () => {
  const { askClaudeStream } = await load();
  await assert.rejects(askClaudeStream(Promise.reject(new Error("prep failed")), "sys", () => {}, undefined, "foreground"), /prep failed/);
});
