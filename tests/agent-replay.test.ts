import { test } from "node:test";
import assert from "node:assert/strict";
import { REPLAY_CASES } from "../evals/agent-replay-cases.ts";
import { AREAS, addRun, estimateCalls, judgePrompt, parseJudge, parseState, scorecardDue, shuffle, summarize, validateCases, type ReplayCase, type ReplayRun } from "../src/lib/agent-replay-pure.ts";

const AGENTS = ["nova", "atlas", "pulse", "echo", "forge", "vector", "sentinel", "flow", "qa"]; // BUILTIN_AGENTS slugs (agents.ts pulls in IO)
const c: ReplayCase = { id: "x", title: "X", area: "studio", agent: "forge", calls: 3, request: "Do X", rubric: [{ name: "a", zero: "bad a", two: "good a" }, { name: "b", zero: "bad b", two: "good b" }] };
const seq = (...xs: number[]) => () => xs.shift() ?? 0;

test("fixtures: 10 valid cases across every area, fictional data only", () => {
  validateCases(REPLAY_CASES, AGENTS);
  assert.equal(REPLAY_CASES.length, 10);
  for (const a of AREAS) assert.ok(REPLAY_CASES.some((x) => x.area === a), a);
  for (const x of REPLAY_CASES) assert.doesNotMatch(x.request, /\b(journal|LIFE|habit|vault|passport|password)\b/i, x.id);
  assert.equal(estimateCalls(REPLAY_CASES), REPLAY_CASES.reduce((n, x) => n + x.calls, 0) + 10);
  assert.throws(() => validateCases([c, c], AGENTS));
  assert.throws(() => validateCases([{ ...c, agent: "ghost" }], AGENTS));
  assert.throws(() => validateCases([{ ...c, rubric: [c.rubric[0]] }], AGENTS));
});

test("judge prompt is rubric-anchored, order-randomized and blind to which run is newer", () => {
  const now = { text: "NEW ANSWER", status: "done", actions: ["save_memory"] }, old = { text: "OLD ANSWER", status: "done", actions: [] };
  const a = judgePrompt(c, [now, old], seq(0)); // swap: newest shown second
  const b = judgePrompt(c, [now, old], seq(0.99)); // keep
  assert.deepEqual(a.order, [1, 0]);
  assert.deepEqual(b.order, [0, 1]);
  assert.ok(a.prompt.indexOf("OLD ANSWER") < a.prompt.indexOf("NEW ANSWER"));
  assert.ok(b.prompt.indexOf("NEW ANSWER") < b.prompt.indexOf("OLD ANSWER"));
  for (const p of [a.prompt, b.prompt]) {
    assert.match(p, /0 = bad a; 2 = good a/);
    assert.doesNotMatch(p, /\b(new|newer|old|older|previous|last month|current)\b(?! ANSWER)/i);
  }
  assert.match(a.prompt, /approval: save_memory/);
});

test("judge parsing maps letters back to answers and rejects out-of-rubric scores", () => {
  const order = [1, 0]; // A = answer 1, B = answer 0
  const [mine, theirs] = parseJudge('ok {"A": {"scores": [2, 2], "reason": "fine"}, "B": {"scores": [0, 1], "reason": " weak\\n b "}}', 2, order);
  assert.deepEqual(mine, { scores: [0, 1], reason: "weak b" });
  assert.deepEqual(theirs, { scores: [2, 2], reason: "fine" });
  assert.deepEqual(parseJudge('{"A": {"scores": [3, 2]}}', 2, [0]), [null]);
  assert.deepEqual(parseJudge('{"A": {"scores": [2]}}', 2, [0]), [null]);
  assert.deepEqual(parseJudge("not json", 2, [0, 1]), [null, null]);
  assert.equal(new Set(shuffle(5, Math.random)).size, 5);
});

const run = (id: string, month: string, cases: ReplayRun["cases"], complete = true): ReplayRun => ({ id, month, at: id, trigger: "monthly", complete, calls: 40, cases });
const res = (id: string, score: number | null, extra = {}) => ({ id, status: "done", calls: 3, scores: null, score, reason: `${id} reason`, ...extra });
const cases = [{ id: "p", title: "P", area: "memory" as const }, { id: "q", title: "Q", area: "studio" as const }];

test("summary: trend per month, worst case with reason, regressions vs last month, unjudged never averaged", () => {
  let s = addRun({ runs: [] }, run("1", "2026-09", [res("p", 2), res("q", 1.5)]));
  s = addRun(s, run("2", "2026-10", [res("p", 1, { prevScore: 2 }), res("q", null, { status: "cancelled" })], false));
  const v = summarize(s, cases);
  assert.deepEqual(v.trend, [{ month: "2026-09", score: 1.75 }, { month: "2026-10", score: 1 }]);
  assert.equal(v.latest?.score, 1);
  assert.equal(v.latest?.prevScore, 1.75);
  assert.equal(v.worst?.id, "p");
  assert.equal(v.worst?.reason, "p reason");
  assert.deepEqual(v.regressions, ["p"]);
  assert.equal(v.cases[1].status, "cancelled");
  // paired blind re-score wins over last month's stored score (judge drift can't fake a regression)
  const drift = summarize(addRun(s, run("3", "2026-10", [res("p", 1, { prevScore: 1.33 }), res("q", 1.5)])), cases);
  assert.deepEqual(drift.regressions, []);
  assert.equal(drift.trend.at(-1)?.score, 1.25);
  assert.deepEqual(summarize({ runs: [] }, cases).regressions, []);
});

test("monthly due: once per calendar month, claimed or run", () => {
  const oct = new Date(2026, 9, 25);
  assert.equal(scorecardDue(oct, { runs: [] }), true);
  assert.equal(scorecardDue(oct, { claimedMonth: "2026-10", runs: [] }), false);
  assert.equal(scorecardDue(oct, { runs: [run("1", "2026-10", [])] }), false);
  assert.equal(scorecardDue(new Date(2026, 10, 1), { claimedMonth: "2026-10", runs: [] }), true);
  assert.deepEqual(parseState("garbage"), { runs: [] });
});
