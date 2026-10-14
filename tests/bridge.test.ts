import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { askClaude } from "../src/lib/claude.ts";
import { parseCitations } from "../src/lib/pure.ts";

let hasClaude = true;
try { execSync(`"${process.env.ORBIT_CLAUDE_BIN || "claude"}" --version`, { stdio: "ignore" }); } catch { hasClaude = false; }

// Real call through the Claude Code CLI under your login; skipped when the CLI isn't installed.
test("CORE bridge answers from provided memories and cites them", { skip: !hasClaude, timeout: 120_000 }, async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const r = await askClaude(
    `MEMORIES:\n<memory id="${id}" kind="note" title="Pet sim idea">\nAdd a rebirth system.\n</memory>\n\nUSER: What did I note about the pet sim?`,
    "You are CORE. Cite every memory you use inline as [m:<id>] with the exact id. Be concise.",
  );
  assert.ok(r.text.length > 0);
  assert.deepEqual(parseCitations(r.text), [id]);
});

test("missing CLI gives an actionable error", async () => {
  const prev = process.env.ORBIT_CLAUDE_BIN;
  process.env.ORBIT_CLAUDE_BIN = "/nonexistent/claude";
  try {
    const spec = "../src/lib/claude.ts?missing"; // query string forces a fresh module so CLAUDE_BIN is re-read
    const { askClaude: fresh } = await import(spec);
    await assert.rejects(fresh("hi", "x"), /Install Claude Code/);
  } finally {
    if (prev === undefined) delete process.env.ORBIT_CLAUDE_BIN; else process.env.ORBIT_CLAUDE_BIN = prev;
  }
});
