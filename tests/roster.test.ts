import { test } from "node:test";
import assert from "node:assert/strict";
import { nightBudget, nightCompare, workerCard } from "../src/lib/roster-pure.ts";
import type { DepState } from "../src/lib/capability-pure.ts";

const all = (v: boolean | null) => Object.fromEntries(["claude", "youtube_key", "youtube_oauth", "resend", "calendar", "higgsfield", "ollama", "phone", "ffmpeg", "whisper"].map((d) => [d, v])) as DepState;

test("worker card: tools, domain, approvals, limited only on a known-missing connection", () => {
  const a = { slug: "nova", role: "Executive agent: coordinates", tools: ["search_memory", "delegate", "save_memory"], stats: { done: 3, failed: 1 } };
  const c = workerCard(a, new Set(["save_memory"]), all(null), all(true));
  assert.equal(c.domain, "Executive agent");
  assert.deepEqual(c.tools, [{ name: "search_memory", approval: false }, { name: "save_memory", approval: true }]);
  assert.deepEqual(c.limited, []);
  assert.equal(c.done, 3);
  assert.deepEqual(workerCard(a, new Set(), all(true), { ...all(true), claude: false }).limited, ["claude"]);
  assert.deepEqual(workerCard(a, new Set(), all(false), all(null)).limited, ["claude"]); // not configured, not checked
  assert.deepEqual(workerCard(a, new Set(), all(null), all(null)).limited, []); // unknown never limits
  assert.deepEqual(c.conns, [{ dep: "claude", configured: true, available: true }]); // available implies configured
});

test("night compare: planned vs produced, skipped/failed/not run, ran is not success", () => {
  const planned = [{ kind: "research" as const, ref: "a", label: "A" }, { kind: "goal" as const, ref: "g", label: "G" }, { kind: "health" as const, ref: "h", label: "H" }];
  const at = "2026-10-30T02:00:00Z";
  const r = nightCompare({ planned, stopped: "budget", items: [
    { kind: "research", ref: "a", label: "A", status: "done", at },
    { kind: "goal", ref: "g", label: "G", status: "skipped", why: "The goal is gone", at },
    { kind: "backup", ref: "b", label: "B", status: "failed", at },
  ] });
  assert.deepEqual(r.rows.map((x) => [x.label, x.planned, x.outcome]), [["A", true, "done"], ["G", true, "skipped"], ["H", true, "not_run"], ["B", false, "failed"]]);
  assert.deepEqual([r.planned, r.produced, r.skipped, r.failed, r.notRun, r.success], [3, 1, 1, 1, 1, false]);
  assert.equal(nightCompare({ items: [{ kind: "health", ref: "h", label: "H", status: "skipped", at }] }).success, false);
  assert.equal(nightCompare({ items: [{ kind: "health", ref: "h", label: "H", status: "approval", at }] }).success, true);
});

test("night budget sums the selected jobs", () => {
  assert.deepEqual(nightBudget([{ calls: 2, minutes: 5 }, { calls: 3, minutes: 10 }], { maxCalls: 40, maxMinutes: 150 }), { calls: 5, minutes: 15, maxCalls: 40, maxMinutes: 150 });
});
