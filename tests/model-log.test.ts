import { test } from "node:test";
import assert from "node:assert/strict";
import { runData, summarizeRuns } from "../src/lib/model-log-pure.ts";
import { ledgerIssue } from "../src/lib/ledger-pure.ts";

const NOW = Date.parse("2026-11-11T12:00:00Z");
let n = 0;
const row = (data: object, at = "2026-11-10T12:00:00Z") => ({ id: ++n, created_at: at, type: "model.run", planet: "core", payload: data });

test("runData: valid ledger payload; risk from why; non-token values never get logged", () => {
  const d = runData({ kind: "core", job: "core", model: "opus", why: ["gmail_send", "risk:sending"], down: "sonnet" });
  assert.equal(ledgerIssue("model.run", "core", d), null);
  assert.deepEqual(d, { kind: "core", job: "core", model: "opus", risky: true, why: ["gmail_send", "risk:sending"], down: "sonnet" });
  assert.equal(runData({ kind: "agent", job: "build", model: "sonnet" }).risky, false);
  // message text can't ride along: a sentence or path in any field becomes "unknown"
  const bad = runData({ kind: "agent", job: "pay Mia 500 eur for the trip", model: "my journal says I felt sad", why: ["dear diary today"], down: "C:\\Users\\me\\journal.txt" });
  assert.equal(JSON.stringify(bad).includes(" "), false);
  assert.equal(bad.model, "unknown");
  assert.equal(ledgerIssue("model.run", "core", { kind: "core", job: "core", model: "a sentence with spaces", risky: false }), "data.model is invalid for model.run");
  assert.ok(ledgerIssue("model.run", "core", { ...d, text: "x" }) === null); // unknown fields are dropped by validate, not stored
});

test("summarizeRuns: runs per model, risky list with models, below-Opus flag, 7-day window", () => {
  const rows = [
    row({ kind: "core", job: "core", model: "sonnet", risky: false }),
    row({ kind: "core", job: "core", model: "sonnet", risky: false }),
    row({ kind: "agent", job: "build", model: "haiku", risky: false }),
    row({ kind: "core", job: "core", model: "opus", risky: true, why: ["gmail_send"] }, "2026-11-11T09:00:00Z"),
    row({ kind: "agent", job: "plan", model: "claude-fable-5-1", risky: true, why: ["risk:money"] }, "2026-11-10T09:00:00Z"),
    row({ kind: "core", job: "core", model: "sonnet", risky: true, why: ["risk:sending"], down: "opus" }, "2026-11-09T09:00:00Z"), // limit stepped a hinted turn below Opus
    row({ kind: "core", job: "core", model: "opus", risky: false }, "2026-11-01T09:00:00Z"), // older than 7 days
    { id: 99, created_at: "2026-11-10T00:00:00Z", type: "model.run", planet: "core", payload: { kind: "core", model: "has spaces", job: "core", risky: true } }, // malformed: skipped
    { id: 100, created_at: "2026-11-10T00:00:00Z", type: "tool.call", planet: "core", payload: { tool: "x", ok: true, ms: 1 } },
  ];
  const r = summarizeRuns(rows, NOW);
  assert.equal(r.total, 6);
  assert.deepEqual(r.perModel, [{ model: "sonnet", runs: 3 }, { model: "claude-fable-5-1", runs: 1 }, { model: "haiku", runs: 1 }, { model: "opus", runs: 1 }]);
  assert.deepEqual(r.risky.map((x) => [x.model, x.below]), [["opus", false], ["claude-fable-5-1", false], ["sonnet", true]]); // newest first
  assert.equal(r.risky[2].down, "opus");
  assert.equal(r.below, 1);
});

test("summarizeRuns: nothing logged, and an unknown model id on a risky job counts as below Opus", () => {
  assert.deepEqual(summarizeRuns([], NOW), { total: 0, perModel: [], risky: [], below: 0 });
  assert.equal(summarizeRuns([row({ kind: "agent", job: "bug", model: "opusplan", risky: true, why: ["risk:auth"] })], NOW).below, 1);
  assert.equal(summarizeRuns([row({ kind: "agent", job: "bug", model: "claude-opus-5-5", risky: true, why: ["risk:auth"] })], NOW).below, 0);
});
