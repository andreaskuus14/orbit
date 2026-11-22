import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyTurnOutputs } from "../src/lib/core-verify-pure.ts";
import { fallbackModelFor, isRetryableModelError, routeFast } from "../src/lib/model-routing-pure.ts";
import { dedupeMemories } from "../src/lib/memory-retrieval-pure.ts";

test("verifyTurnOutputs catches Roblox server exploits, broken HTML, and unmentioned sandbox failures", () => {
  // 1. Clean chat with no build tools passes immediately
  assert.equal(verifyTurnOutputs([], "Hello!").ok, true);

  // 2. Exploitable Luau server script written via ws_write is caught before reply
  const badLuau = verifyTurnOutputs(
    [{
      tool: "ws_write",
      input: {
        path: "src/server/Shop.server.luau",
        content: `BuyRemote.OnServerEvent:Connect(function(player, cost)\n  player.leaderstats.Coins.Value -= cost\nend)`,
      },
      output: "- src/server/Shop.server.luau created",
      evidence: [],
    }],
    "Done! Shop script is ready.",
  );
  assert.equal(badLuau.ok, false);
  assert.equal(badLuau.issues[0].kind, "roblox_exploit");
  assert.match(badLuau.fixPrompt, /SILENT VERIFY-BEFORE-REPLY/);

  // 3. Truncated HTML with unclosed <script> is caught
  const badHtml = verifyTurnOutputs(
    [{
      tool: "ws_write",
      input: { path: "index.html", content: "<html><body><h1>Shop</h1><script>console.log(1)" },
      output: "- index.html created",
      evidence: [],
    }],
    "Built your site!",
  );
  assert.equal(badHtml.ok, false);
  assert.ok(badHtml.issues.some((i) => i.kind === "html_broken"));

  // 4. Sandbox failure hidden by optimistic final answer is caught; honest mention passes
  const hiddenFail = verifyTurnOutputs(
    [{ tool: "run_code", input: { code: "1/0" }, output: "Error: ZeroDivisionError (exit code 1)", evidence: [] }],
    "All done, calculation succeeded!",
  );
  assert.equal(hiddenFail.ok, false);
  assert.equal(hiddenFail.issues[0].kind, "sandbox_failed");

  const honestFail = verifyTurnOutputs(
    [{ tool: "run_code", input: { code: "1/0" }, output: "Error: ZeroDivisionError (exit code 1)", evidence: [] }],
    "The script failed with ZeroDivisionError.",
  );
  assert.equal(honestFail.ok, true);
});

test("model failover detects retryable errors, steps down safely, and never downgrades PROTECTED jobs to fast", () => {
  assert.equal(isRetryableModelError("API returned 529 Overloaded"), true);
  assert.equal(isRetryableModelError("429 rate limit exceeded"), true);
  assert.equal(isRetryableModelError("Invalid JSON syntax"), false);

  const opts = { defaultModel: "sonnet", smartModel: "opus", fastModel: "haiku" };
  // Opus -> Sonnet always allowed on overload
  assert.equal(fallbackModelFor("opus", { ...opts, purpose: "core" }), "sonnet");
  // Sonnet -> Haiku allowed on non-protected background jobs
  assert.equal(fallbackModelFor("sonnet", { ...opts, purpose: "memory.summary" }), "haiku");
  // Sonnet -> Haiku REFUSED on PROTECTED jobs (core, security, send, review)
  assert.equal(fallbackModelFor("sonnet", { ...opts, purpose: "core" }), null);
  assert.equal(fallbackModelFor("sonnet", { ...opts, purpose: "business.send" }), null);
  assert.equal(fallbackModelFor("haiku", { ...opts, purpose: "memory.summary" }), null);

  // Existing reviewed FAST_PURPOSES stay intact
  assert.equal(routeFast("clips.suggest"), true);
  assert.equal(routeFast("pulse.morning"), true);
  assert.equal(routeFast("core"), false);
});

test("dedupeMemories removes exact title duplicates and near-identical content while preserving rank order", () => {
  const rows = [
    { id: "1", title: "Roblox Shop Economy Notes", content: "Egg pricing curves and rebirth multipliers for CyberForge Tycoon." },
    { id: "2", title: "roblox shop economy notes", content: "Duplicate copy with slightly different casing." },
    { id: "3", title: "Roblox Shop Economy Notes v2", content: "Egg pricing curves and rebirth multipliers for CyberForge Tycoon!" },
    { id: "4", title: "Tallinn House Energy Target", content: "Estonian nZEB requirement U-value <= 0.16 W/m2K for exterior walls." },
  ];
  const deduped = dedupeMemories(rows, 8);
  assert.deepEqual(deduped.map((r) => r.id), ["1", "4"]);
});
