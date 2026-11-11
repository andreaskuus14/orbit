import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPolish, builderBrief, candidates, parseCallTurns, rankTasks, weeklyLine, type ImproveIn } from "../src/lib/self-improve-pure.ts";
import type { Issue } from "../src/lib/health-pure.ts";

const NOW = Date.parse("2026-10-26T03:00:00Z");
const issue = (o: Partial<Issue>): Issue => ({ id: "h00000001", cls: "unhandled", area: "studio", sig: "sig", title: "Unhandled error (studio): x", excerpt: "TypeError: boom token=abc123secret",
  sources: ["server"], count: 3, first: "2026-10-20T00:00:00Z", last: "2026-10-25T00:00:00Z", severity: 60, status: "new", ...o });
const base: ImproveIn = { now: NOW, health: [], scorecard: [], calls: [], lessons: [], night: [] };

test("parseCallTurns reads [call] turn lines only", () => {
  const t = parseCallTurns("noise\n[call] turn sonnet asr=300ms core=4200ms total=5100ms\n[call] turn: Error x\n[call] turn local total=40ms");
  assert.deepEqual(t, [{ path: "sonnet", ms: { asr: 300, core: 4200, total: 5100 } }, { path: "local", ms: { total: 40 } }]);
});

test("candidates: every source, rules and thresholds", () => {
  const ts = candidates({ ...base,
    health: [issue({}), issue({ id: "h2", severity: 20 }), issue({ id: "h3", status: "resolved", severity: 90 })],
    scorecard: [{ id: "plan-week", title: "Plan a week", area: "planning", score: 0.8, before: 1.6, reason: "missed dates", regressed: true },
      { id: "ok", title: "Fine", area: "research", score: 1.8, before: 1.8, reason: "", regressed: false }],
    calls: parseCallTurns(Array(4).fill("[call] turn sonnet asr=200ms core=5500ms total=6000ms").join("\n") + "\n[call] turn local total=50ms"),
    lessons: [
      { id: "a", text: "He usually rejects long clips", area: "clip.length", planet: "studio", status: "rejected", at: "2026-10-01T00:00:00Z", decidedAt: "2026-10-20T00:00:00Z", evidence: [] },
      { id: "b", text: "He usually rejects talking clips", area: "clip.kind", planet: "studio", status: "rejected", at: "2026-10-01T00:00:00Z", decidedAt: "2026-10-21T00:00:00Z", evidence: [] },
      { id: "c", text: "old", area: "niche", planet: "business", status: "rejected", at: "2026-01-01T00:00:00Z", decidedAt: "2026-01-02T00:00:00Z", evidence: [] },
      { id: "d", text: "He corrected me: “Lisbon, not Porto”", area: "correction", planet: "core", status: "kept", at: "2026-10-22T00:00:00Z", evidence: ["message:m1"] },
      { id: "e", text: "Don't summarise my emails", area: "correction", planet: "core", status: "proposed", at: "2026-10-24T00:00:00Z", evidence: ["message:m2"] },
    ],
    night: [{ kind: "research", failed: 3, total: 4, why: "timeout" }, { kind: "deals", failed: 1, total: 5 }],
  });
  assert.deepEqual(ts.map((t) => t.key).sort(), ["call:sonnet", "correction", "health:h00000001", "lesson:studio", "night:research", "scorecard:plan-week"]);
  const h = ts.find((t) => t.source === "health")!;
  assert.ok(!h.detail.join().includes("abc123secret"), "evidence is redacted");
  assert.deepEqual(ts.find((t) => t.key === "correction")!.evidence, ["message:m1", "message:m2"]);
  assert.match(ts.find((t) => t.key === "call:sonnet")!.problem, /Slowest stage: core/);
  assert.ok(ts.every((t) => t.impact >= 0 && t.impact <= 100));
});

test("rankTasks keeps the top 5 by impact", () => {
  const ts = candidates({ ...base, health: Array.from({ length: 7 }, (_, i) => issue({ id: `h${i}`, severity: 40 + i * 5 })) });
  const r = rankTasks(ts);
  assert.equal(r.length, 5);
  assert.deepEqual(r.map((t) => t.impact), [70, 65, 60, 55, 50]);
});

test("applyPolish uses model text when valid, redacts it, and falls back", () => {
  const ts = candidates({ ...base, health: [issue({})] });
  assert.equal(applyPolish(ts, "not json").used, false);
  assert.equal(applyPolish(ts, "not json").tasks[0].title, ts[0].title);
  const p = applyPolish(ts, `Sure: [{"key":"health:h00000001","title":"Studio crashes on load","goal":"No crash; key sk-ant-api03-AAAAAAAAAAAAAAAA gone"},{"key":"nope","title":"x"}]`); // secret-scan: allow (fake test value)
  assert.equal(p.used, true);
  assert.equal(p.tasks[0].title, "Studio crashes on load");
  assert.ok(!p.tasks[0].goal.includes("sk-ant"));
});

test("builderBrief and weeklyLine", () => {
  const [t] = rankTasks(candidates({ ...base, night: [{ kind: "research", failed: 3, total: 4, why: "timeout" }] }));
  const md = builderBrief(t, 1, "2026-W44");
  assert.match(md, /^## Make ORBIT better #1: Night-shift research tasks keep failing/);
  assert.match(md, /`night:research`/);
  assert.match(md, /AGENTS\.md/);
  assert.match(md, /npm run gate/);
  assert.equal(weeklyLine(null), null);
  assert.equal(weeklyLine({ week: "2026-W44", at: "", model: false, tasks: [] }), null);
  assert.match(weeklyLine({ week: "2026-W44", at: "", model: false, tasks: [t] })!, /^Make ORBIT better: 1 improvement task this week, top: Night-shift/);
});
