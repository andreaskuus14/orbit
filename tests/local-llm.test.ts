import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { autostartView, DISABLE_CMD, ENABLE_CMD } from "../src/lib/autostart-pure.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const imports = (code: string) => [...code.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });

test("local-llm.ts never imports claude.ts, and no journal text can reach any model, local included (AGENTS.md rule 6)", () => {
  const llm = src("src/lib/local-llm.ts"), pure = src("src/lib/local-model-pure.ts");
  for (const i of imports(llm)) assert.ok(!/(^|\/)claude(\.ts)?$|anthropic|claude-agent-sdk/.test(i), `local-llm.ts imports ${i}`);
  assert.match(llm, /OLLAMA_URL/); // the only address it talks to (loopback, localLlmUrl)
  assert.ok(!/journal|getLife|\/life\b/i.test(llm.replace(/^\/\/.*$/gm, "")), "local-llm.ts mentions the journal or LIFE");
  assert.ok(!/ORBIT_LOCAL_PRIVATE|reflectJournal|journalReflect|privateBlocked|PRIVATE_LABEL/.test(llm + pure.replace(/\/\*[\s\S]*?\*\//g, "")), "the private-journal path is back");
  assert.ok(!existsSync(new URL("../src/app/api/life/reflect/route.ts", import.meta.url)), "the reflect route is back");
  // the only importers of local-llm are claude.ts (fallback), vault intake and the health route: none reads the journal
  const root = fileURLToPath(new URL("../src", import.meta.url));
  for (const f of walk(root)) {
    const code = readFileSync(f, "utf8");
    if (!imports(code).some((i) => /local-llm(\.ts)?$/.test(i))) continue;
    assert.ok(!/\b(getLife|exportLife)\b|\.journal\b|from ["'][^"']*\/life(-pure)?(\.ts)?["']/.test(code), `${relative(root, f)} imports local-llm and reads LIFE`);
  }
});

test("the owner-facing text no longer offers journal reflection and says the journal never reaches a model", () => {
  const panel = src("src/components/LifePanel.tsx");
  assert.ok(!/\/api\/life\/reflect|localReflect/.test(panel));
  assert.match(src("src/lib/i18n-pure.ts"), /life\.journalPrivate": "Private: journal text is never sent to any AI model\./);
  assert.ok(!/ORBIT_LOCAL_PRIVATE/.test(src(".env.example")));
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
