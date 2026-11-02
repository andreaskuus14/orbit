import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autostartView, DISABLE_CMD, ENABLE_CMD } from "../src/lib/autostart-pure.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const imports = (code: string) => [...code.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);

test("private journal text has no path to Claude: the reflect route and local-llm.ts never import claude.ts", () => {
  const route = src("src/app/api/life/reflect/route.ts"), llm = src("src/lib/local-llm.ts");
  for (const [name, code] of [["reflect route", route], ["local-llm.ts", llm]] as const) {
    for (const i of imports(code)) assert.ok(!/(^|\/)claude(\.ts)?$|anthropic|claude-agent-sdk/.test(i), `${name} imports ${i}`);
    assert.ok(!/askClaude|runClaudeStream|withLocal/.test(code), `${name} mentions a Claude call`);
  }
  assert.deepEqual(imports(route).sort(), ["@/lib/life", "@/lib/local-llm", "@/lib/supabase/server"]);
  assert.match(llm, /privateBlocked\(/); // the opt-in is checked before any journal text is sent
  assert.match(llm, /OLLAMA_URL/); // the only address it talks to (loopback, localLlmUrl)
});

test("the existing cloud guards are intact: CORE's journal tool and the sleep loop still never read journal text", () => {
  assert.match(src("src/lib/core-life.ts"), /case "life_journal": \{[^}]*return JOURNAL_PRIVATE;/);
  assert.match(src("src/lib/sleep.ts"), /not\("kind", "in", "\(conversation,journal,episode\)"\)/);
  assert.match(src("src/lib/local-model-pure.ts"), /purpose === "core" \|\| o.purpose === "core.chat" \|\| \/\\.summary\$\/\.test/); // fallback lanes unchanged
});

test("autostartView: task, older shortcut, off, not Windows", () => {
  assert.deepEqual([autostartView(true, true).on, autostartView(true, true).how, autostartView(true, false).command], [true, "task", DISABLE_CMD]);
  assert.deepEqual([autostartView(false, true).on, autostartView(false, true).how], [true, "shortcut"]);
  assert.deepEqual([autostartView(false, false).on, autostartView(false, false).command], [false, ENABLE_CMD]);
  assert.equal(autostartView(null, false).on, null);
});
