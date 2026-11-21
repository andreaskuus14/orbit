import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPAIR_SYSTEM, agentPermissions, branchName, budgetStop, collectSignals, effectLine, failedTests, gateEnv, isWaiting, parseAgentReply, parseMetric, parseRepair,
  patchCard, patchSeen, prBody, rankSignals, repairBlock, repairBrief, repairConfig, repairExamBlock, repairExamVerdict, repairModel, repairPrompt, validBranch, type IssueIn, type Patch, type Signal,
} from "../src/lib/night-repair-pure.ts";

const NOW = Date.parse("2026-11-21T02:00:00Z");
const cfg = repairConfig({});

test("config: on by default, ORBIT_NIGHT_REPAIR=0 turns it off, patches capped at 3, calls configurable", () => {
  assert.deepEqual([cfg.on, cfg.maxPatches, cfg.maxCalls], [true, 3, 6]);
  assert.equal(repairConfig({ ORBIT_NIGHT_REPAIR: "0" }).on, false);
  assert.equal(repairConfig({ ORBIT_NIGHT_REPAIR_PATCHES: "9" }).maxPatches, 3);
  assert.equal(repairConfig({ ORBIT_NIGHT_REPAIR_CALLS: "2" }).maxCalls, 2);
  assert.equal(repairConfig({ ORBIT_NIGHT_REPAIR_CALLS: "x" }).maxCalls, 6);
});

test("the agent always runs on Opus, never Fable", () => {
  assert.equal(repairModel(), "opus");
  assert.equal(repairModel("claude-fable-5-1"), "opus");
  assert.equal(repairModel("fable"), "opus");
  assert.equal(repairModel("sonnet"), "opus");
  assert.equal(repairModel("claude-opus-5-5"), "claude-opus-5-5");
});

const open = { cfg, inWindow: true, stopAll: false, hold: "", ranTonight: false, idle: true, autonomy: "", repo: "", running: false };
test("repairBlock: off switch, Stop-all, window, once a night, usage pacer, owner active", () => {
  assert.equal(repairBlock(open), "");
  assert.match(repairBlock({ ...open, cfg: { ...cfg, on: false } }), /ORBIT_NIGHT_REPAIR=0/);
  assert.match(repairBlock({ ...open, stopAll: true }), /Stop-all/);
  assert.match(repairBlock({ ...open, inWindow: false }), /window/);
  assert.match(repairBlock({ ...open, ranTonight: true }), /already ran/);
  assert.match(repairBlock({ ...open, hold: "Keeping your window fresh until 07:30" }), /usage pacer/);
  assert.match(repairBlock({ ...open, idle: false }), /using ORBIT/);
  assert.match(repairBlock({ ...open, autonomy: "Night shift is Off in Profile → Autonomy" }), /Off/);
});

test("night repair allows an unmeasured candidate but blocks a lower score or a score for another commit", () => {
  assert.equal(repairExamVerdict(undefined, "abc"), "unmeasured");
  assert.equal(repairExamBlock(undefined, "abc"), "");
  assert.equal(repairExamBlock({ baseScore: 80, candidateScore: 80, candidateCommit: "abc", runId: "ev-20261121-aaaa" }, "abc"), "");
  assert.equal(repairExamVerdict({ baseScore: 80, candidateScore: 79, candidateCommit: "abc", runId: "ev-20261121-aaaa" }, "abc"), "regressed");
  assert.match(repairExamBlock({ baseScore: 80, candidateScore: 79, candidateCommit: "abc", runId: "ev-20261121-aaaa" }, "abc"), /lower/);
  assert.equal(repairExamVerdict({ baseScore: 80, candidateScore: 80, candidateCommit: "abc", runId: "ev-20261121-aaaa" }, "abc"), "passed");
  assert.equal(repairExamVerdict({ baseScore: 80, candidateScore: 82, candidateCommit: "other", runId: "ev-20261121-aaaa" }, "abc"), "mismatched");
  assert.match(repairExamBlock({ baseScore: 80, candidateScore: 82, candidateCommit: "other", runId: "ev-20261121-aaaa" }, "abc"), /another commit/);
  assert.equal(repairExamVerdict({ baseScore: 80, candidateScore: 101, candidateCommit: "abc", runId: "ev-20261121-aaaa" }, "abc"), "unmeasured");
});

test("budgetStop: max 3 patches, max N calls, Stop-all and a low quota stop the night", () => {
  assert.equal(budgetStop(cfg, { patches: 0, calls: 0 }, false, ""), "");
  assert.equal(budgetStop(cfg, { patches: 3, calls: 0 }, false, ""), "patches");
  assert.equal(budgetStop({ ...cfg, maxPatches: 9 }, { patches: 3, calls: 0 }, false, ""), "patches");
  assert.equal(budgetStop(cfg, { patches: 1, calls: 6 }, false, ""), "calls");
  assert.equal(budgetStop(cfg, { patches: 0, calls: 0 }, true, ""), "stop-all");
  assert.equal(budgetStop(cfg, { patches: 0, calls: 0 }, false, "quota"), "usage");
});

const issue = (o: Partial<IssueIn>): IssueIn => ({ id: "i", cls: "error", area: "core", sig: "s", title: "t", excerpt: "e", sources: ["server"], count: 1, severity: 2, status: "ongoing", last: "2026-11-20T23:00:00Z", ...o });

test("collectSignals: failed tool calls, crashes, failing self-tests; drops external, usage-only, resolved and journal/LIFE", () => {
  const xs = collectSignals({
    issues: [
      issue({ id: "a", sig: "tool web_fetch call failed", title: "tool web_fetch call failed", sources: ["ledger"], count: 7 }),
      issue({ id: "b", cls: "crash", sig: "TypeError x of undefined", title: "Crash in pulse", excerpt: "TypeError at src/lib/pulse.ts:12" }),
      issue({ id: "c", cls: "external", sig: "ECONNRESET" }),
      issue({ id: "d", sources: ["usage"], sig: "Claude call failed (core)" }),
      issue({ id: "e", status: "resolved", sig: "old" }),
      issue({ id: "f", area: "life", sig: "journal write failed", title: "journal entry PLANTED-JOURNAL failed" }),
      issue({ id: "g", sig: "fetch failed ENOTFOUND api.example.com" }),
    ],
    doctor: [{ id: "ytkey", label: "YouTube API key", status: "warn", detail: "not configured", fix: "Add YOUTUBE_API_KEY to .env.local" }, { id: "jobs", label: "Jobs", status: "fail", detail: "3 stuck job rows" }],
    selftest: { at: "", doctor: [], smoke: [{ name: "api/health", ok: false, ms: 3100, detail: "slow: 3100 ms" }], tests: { ok: false, ran: true, ms: 1, failed: [{ file: "tests/pagewatch.test.ts", name: "parses attrs", error: "2 !== 3" }] } },
  });
  assert.deepEqual(xs.map((s) => s.kind).sort(), ["crash", "doctor", "perf", "test", "tool"]);
  assert.ok(!JSON.stringify(xs).includes("PLANTED-JOURNAL"));
  assert.deepEqual(xs.find((s) => s.kind === "crash")!.files, ["src/lib/pulse.ts"]);
});

test("rankSignals: top 3 by kind/severity/count, skips anything tried in the last 7 days, deterministic", () => {
  const s = (id: string, kind: Signal["kind"], severity = 2, count = 1): Signal => ({ id, kind, title: id, evidence: [], count, severity });
  const xs = [s("job:1", "job"), s("test:1", "test", 5), s("tool:1", "tool", 2, 9), s("perf:1", "perf"), s("doctor:1", "doctor"), s("tool:1", "tool", 2, 9)];
  assert.deepEqual(rankSignals(xs, [], NOW).map((x) => x.id), ["test:1", "tool:1", "perf:1"]);
  assert.deepEqual(rankSignals(xs, [{ signal: "test:1", at: "2026-11-19T00:00:00Z" }], NOW).map((x) => x.id), ["tool:1", "perf:1", "job:1"]);
  assert.deepEqual(rankSignals(xs, [{ signal: "test:1", at: "2026-11-01T00:00:00Z" }], NOW)[0].id, "test:1"); // older than a week: may try again
  assert.equal(rankSignals(xs, [], NOW, 1).length, 1);
});

test("branch names: night/<date>-<slug>, unique, validated", () => {
  const b = branchName("2026-11-21", "Failing test: parses attrs (tests/pagewatch.test.ts)", []);
  assert.equal(b, "night/2026-11-21-failing-test-parses-attrs-tests-pagewatc");
  assert.ok(validBranch(b));
  assert.equal(branchName("2026-11-21", "x", ["night/2026-11-21-x"]), "night/2026-11-21-x-2");
  assert.throws(() => branchName("2026-11-21; rm -rf", "x", []));
  assert.equal(validBranch("night/2026-11-21-x;rm"), false);
});

test("the agent's prompt: problem as data, protected paths named, Opus file tools only, no shell", () => {
  const p = repairPrompt({ id: "t", kind: "test", title: "Failing test: x", evidence: ["2 !== 3"], count: 1, severity: 5, files: ["tests/x.test.ts"] });
  assert.match(p, /Failing test: x/); assert.match(p, /tests\/x\.test\.ts/);
  assert.match(REPAIR_SYSTEM, /DATA/); assert.match(REPAIR_SYSTEM, /scripts\//); assert.match(REPAIR_SYSTEM, /cannot run anything/);
  const perms = agentPermissions("C:\\Users\\a\\orbit-data\\night-repair\\wt\\x");
  assert.deepEqual(perms.allow, ["Read(//c/Users/a/orbit-data/night-repair/wt/x/**)", "Edit(//c/Users/a/orbit-data/night-repair/wt/x/**)"]);
  for (const d of ["Bash", "WebFetch", "Edit(//c/Users/a/orbit-data/night-repair/wt/x/node_modules/**)", "Read(//c/Users/a/orbit-data/night-repair/wt/x/**/.env*)"]) assert.ok(perms.deny.includes(d), d);
});

test("parseAgentReply", () => {
  assert.deepEqual(parseAgentReply("done\nSUMMARY: The cache key ignored case.\nIt now lowercases.\nTEST: tests/x.test.ts proves it"), { summary: "The cache key ignored case. It now lowercases.", test: "tests/x.test.ts proves it" });
  assert.equal(parseAgentReply("NO_FIX: needs a YouTube key").noFix, "needs a YouTube key");
});

test("gateEnv: model-written tests get no secrets and a throwaway data folder", () => {
  const e = gateEnv({ PATH: "/bin", Path: "C:\\bin", SystemRoot: "C:\\Windows", SUPABASE_SECRET_KEY: "s", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t", GITHUB_TOKEN: "g",
    HTTPS_PROXY: "http://p", ORBIT_DATA_DIR: "C:\\real", NODE_OPTIONS: "--require evil.js", LOCALAPPDATA: "C:\\L" }, "/tmp/x");
  assert.equal(e.ORBIT_DATA_DIR, "/tmp/x");
  for (const k of ["SUPABASE_SECRET_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GITHUB_TOKEN", "HTTPS_PROXY", "NODE_OPTIONS"]) assert.equal(e[k], undefined, k);
  assert.equal(e.PATH, "/bin"); assert.equal(e.SystemRoot, "C:\\Windows"); assert.equal(e.ORBIT_NIGHT_REPAIR, "0");
  assert.equal(gateEnv({ NODE_OPTIONS: "--max-old-space-size=4096" }, "/t").NODE_OPTIONS, "--max-old-space-size=4096");
});

const TAP = `TAP version 13
# Subtest: adds
not ok 1 - adds
  ---
  location: 'C:\\\\Users\\\\a\\\\orbit\\\\tests\\\\a.test.ts:2:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
  ...
ok 2 - ok one
# Subtest: group
    not ok 1 - inner fails
      ---
      location: '/x/tests/b.test.ts:4:38'
      error: 'boom inner'
      ...
not ok 3 - group
  ---
  location: '/x/tests/b.test.ts:4:1'
  failureType: 'subtestsFailed'
  error: '1 subtest failed'
  ...
`;
test("failedTests reads node --test TAP (Windows paths too), skipping 'subtests failed' parents", () => {
  assert.deepEqual(failedTests(TAP), [
    { file: "tests/a.test.ts", name: "adds", error: "Expected values to be strictly equal:" },
    { file: "tests/b.test.ts", name: "inner fails", error: "boom inner" }]);
});

test("measured effect: only numbers that were measured", () => {
  assert.deepEqual(parseMetric("warm\nMETRIC parse_ms 412.5 ms\nMETRIC parse_ms 120 ms\n"), { name: "parse_ms", value: 120, unit: "ms" });
  assert.equal(parseMetric("took about 3 ms"), null);
  assert.match(effectLine({ kind: "bench", before: { name: "p", value: 400, unit: "ms" }, after: { name: "p", value: 100, unit: "ms" } }), /400 ms on main → 100 ms.*75% lower/);
  assert.match(effectLine({ kind: "test", file: "tests/a.test.ts", before: "fail", after: "pass" }), /failed on main, passes/);
  assert.match(effectLine({ kind: "none", why: "needs live traffic" }), /^Not measured/);
});

const patch = (o: Partial<Patch> = {}): Patch => ({ id: "p1", night: "2026-11-21", signal: "test:1", kind: "test", title: "parses attrs", problem: "Failing test: parses attrs", branch: "night/2026-11-21-parses-attrs",
  base: "a".repeat(40), commit: "b".repeat(40), status: "waiting", summary: "Selector split on spaces.", test: "tests/pagewatch.test.ts", files: [{ path: "src/lib/pagewatch-pure.ts", added: 4, removed: 1 }, { path: "tests/pagewatch.test.ts", added: 6, removed: 0 }],
  gate: { ok: true, ms: 14 * 60_000, tail: "" }, effect: "Measured: tests/pagewatch.test.ts failed on main, passes with the patch", calls: 1, at: "2026-11-21T02:10:00Z", ...o });

test("the card and the PR: problem, diff summary, gate result, measured effect; nothing waits without a passing gate", () => {
  const c = patchCard(patch());
  assert.match(c.title, /^Night fix: parses attrs/);
  for (const re of [/Problem: Failing test/, /Diff: 2 files, \+10\/[−-]1/, /Gate: passed/, /Measured:/, /ORBIT exam: not measured by the exam yet/, /Approve merges/]) assert.match(c.message, re);
  assert.match(c.detail, /local branch/);
  assert.match(patchCard(patch({ pr: { number: 7, url: "u" } })).detail, /PR #7/);
  assert.match(prBody(patch()), /Not merged/);
  assert.ok(isWaiting(patch()));
  assert.ok(!isWaiting(patch({ gate: { ok: false, ms: 1, tail: "" } })));
  assert.ok(!isWaiting(patch({ commit: undefined })));
  assert.notEqual(patchSeen(patch()), patchSeen(patch({ commit: "c".repeat(40) })), "a different commit is a different card");
});

test("the 07:30 brief line lists what was prepared", () => {
  const s = { nights: [], patches: [patch(), patch({ id: "p2", title: "tool fix", status: "failed", gate: { ok: false, ms: 1, tail: "" } }), patch({ id: "p3", night: "2026-11-20" })] };
  const b = repairBrief(s, "2026-11-21")!;
  assert.equal(b.title, "Night repair: 1 fix ready to approve");
  assert.match(b.say, /one code fix/); assert.match(b.detail, /parses attrs · 1 discarded/);
  assert.equal(repairBrief(s, "2026-11-19"), null);
  assert.match(repairBrief({ nights: [], patches: [patch({ status: "failed" })] }, "2026-11-21")!.say, /none passed/);
});

test("parseRepair tolerates damage", () => {
  assert.deepEqual(parseRepair("{"), { nights: [], patches: [] });
  assert.equal(parseRepair(JSON.stringify({ nights: [], patches: [patch(), { nope: 1 }] })).patches.length, 1);
});
