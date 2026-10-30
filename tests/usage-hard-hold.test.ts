import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyMeter, hardHoldReason, holdReason, type Call } from "../src/lib/usage-meter-pure.ts";
import { pastBudget, usageHardHold, usageHold, usageHoldFor } from "../src/lib/usage-meter.ts";

const NOW = Date.now();
const heavy = () => { // 179 calls of 150 = 119%, like the live bug
  const m = emptyMeter();
  m.calls = Array.from({ length: 179 }, (_, i): Call => ({ at: NOW - i * 1000, purpose: "core", model: "sonnet", inTok: 1, outTok: 1, ms: 1, ok: true }));
  return m;
};

test("soft budget holds background only; the provider limit holds both", () => {
  const m = heavy();
  assert.match(holdReason(m, NOW), /Heavy use: 119%/);
  assert.equal(hardHoldReason(m, NOW), "");
  m.limit = { until: NOW + 60_000, at: NOW, text: "limit" };
  assert.match(hardHoldReason(m, NOW), /usage limit reached/);
  assert.match(holdReason(m, NOW), /usage limit reached/);
});

test("at 119% an owner click (BUSINESS Find) proceeds with a note; background lanes stay held", () => {
  (globalThis as { __orbitMeter?: unknown }).__orbitMeter = heavy();
  assert.equal(usageHardHold(), "");
  assert.equal(usageHoldFor("foreground"), "");
  assert.match(usageHoldFor("background"), /Heavy use/);
  assert.match(usageHold(), /Heavy use/);
  assert.equal(pastBudget(), true);
  // the find route gates on the hard hold only and reports the soft budget as a note
  const route = readFileSync(new URL("../src/app/api/business/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /usageHold\(\)/);
  assert.match(route, /pastBudget: pastBudget\(\)/);
  delete (globalThis as { __orbitMeter?: unknown }).__orbitMeter;
});
