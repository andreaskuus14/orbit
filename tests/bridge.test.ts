import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCitations } from "../src/lib/pure.ts";

const dir = mkdtempSync(join(tmpdir(), "orbit-bridge-"));
process.env.ORBIT_DATA_DIR = dir; // the usage meter records these calls: never into the real data dir

// The default run uses a fake `claude` so it never depends on a model's speed or mood (a real call timed out under load).
// It answers like the CLI: one stream-json result that cites the memory id it finds in the prompt. Shebang scripts don't run on Windows.
const skipFake = process.platform === "win32" && "the fake CLI needs a shebang";
const fake = join(dir, "claude.mjs");
writeFileSync(fake, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("fake"); process.exit(0); }
let input = ""; for await (const c of process.stdin) input += c;
const id = /<memory id="([^"]+)"/.exec(input)?.[1] ?? "none";
const text = "You noted a rebirth system for the pet sim. [m:" + id + "]";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
out({ type: "result", result: text, is_error: false, usage: { input_tokens: 1, output_tokens: 1 } });
`);
chmodSync(fake, 0o755);

const id = "11111111-1111-4111-8111-111111111111";
const prompt = `MEMORIES:\n<memory id="${id}" kind="note" title="Pet sim idea">\nAdd a rebirth system.\n</memory>\n\nUSER: What did I note about the pet sim?`;
const system = "You are CORE. Cite every memory you use inline as [m:<id>] with the exact id. Be concise.";

test("CORE bridge passes memories to the CLI and returns its cited answer", { skip: skipFake }, async () => {
  process.env.ORBIT_CLAUDE_BIN = fake;
  const spec = "../src/lib/claude.ts?fake"; // query string forces a fresh module so CLAUDE_BIN is re-read
  const { askClaude } = await import(spec);
  const r = await askClaude(prompt, system);
  assert.ok(r.text.length > 0);
  assert.deepEqual(parseCitations(r.text), [id]);
});

// Opt-in (ORBIT_LIVE_CLAUDE=1): the real CLI under your login. A model call's duration is not ours to bound, so it is not in the default run.
let hasClaude = process.env.ORBIT_LIVE_CLAUDE === "1";
if (hasClaude) try { execSync(`"${"claude"}" --version`, { stdio: "ignore" }); } catch { hasClaude = false; }
test("CORE bridge answers from provided memories and cites them (live CLI)", { skip: !hasClaude && "set ORBIT_LIVE_CLAUDE=1 with the claude CLI installed", timeout: 300_000 }, async () => {
  process.env.ORBIT_CLAUDE_BIN = "claude";
  const spec = "../src/lib/claude.ts?live";
  const { askClaude } = await import(spec);
  const r = await askClaude(prompt, system, { timeoutMs: 280_000 });
  assert.deepEqual(parseCitations(r.text), [id]);
});

test("missing CLI gives an actionable error", async () => {
  const prev = process.env.ORBIT_CLAUDE_BIN;
  process.env.ORBIT_CLAUDE_BIN = "/nonexistent/claude";
  try {
    const spec = "../src/lib/claude.ts?missing";
    const { askClaude: fresh } = await import(spec);
    await assert.rejects(fresh("hi", "x"), /Install Claude Code/);
  } finally {
    if (prev === undefined) delete process.env.ORBIT_CLAUDE_BIN; else process.env.ORBIT_CLAUDE_BIN = prev;
  }
});
