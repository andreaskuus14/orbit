import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_POLICY as P, afterFailure, checksVerdict, modeViolations, orbitStopAllOn, weakenedTests, countErrors, parseNumstat, policyViolations, probeProblems, redact, releaseBlocked, submissionProblem, utcDay,
} from "../supervisor/policy.ts";
import { appendAudit, readAudit, verifyAudit } from "../supervisor/audit.ts";

const ch = (path: string, added = 1, removed = 0) => ({ path, added, removed });

test("small changes inside src/tests/docs pass; protected paths never do", () => {
  assert.deepEqual(policyViolations([ch("src/lib/x-pure.ts", 20), ch("tests/x.test.ts", 30)], P), []);
  for (const p of ["supervisor/policy.ts", ".github/workflows/ai-quality.yml", "AGENTS.md", "supabase/migrations/0026_x.sql", "package.json",
    "package-lock.json", "scripts/launch.ps1", "src/app/api/rea/route.ts", "src/middleware.ts", "src/lib/stop-all.ts", "src/lib/authority.ts",
    "src/app/api/selfdev/route.ts", "src/lib/selfdev.ts", "src/instrumentation.ts", ".env.local", "src/app/api/health/route.ts", "selfdev/builder.ts"])
    assert.ok(policyViolations([ch(p)], P).some((v) => v.includes("protected")), p);
  assert.ok(policyViolations([ch("tools/x.ps1")], P)[0].includes("outside the allowed"));
  assert.ok(policyViolations([ch("src/../supervisor/x.ts")], P)[0].includes("outside the repository"));
  assert.deepEqual(policyViolations([], P), ["empty change"]);
});

test("size limits", () => {
  assert.ok(policyViolations(Array.from({ length: 9 }, (_, i) => ch(`src/a${i}.ts`)), P).some((v) => v.includes("files")));
  assert.ok(policyViolations([ch("src/a.ts", 200, 101)], P).some((v) => v.includes("changed lines")));
});

test("numstat: binaries count as large, renames check both sides", () => {
  const c = parseNumstat("3\t1\tsrc/a.ts\n-\t-\tpublic/x.png\n0\t0\tsrc/{old => ../supervisor}/f.ts\n2\t0\tsrc/a.ts => supervisor/b.ts\n");
  assert.deepEqual(c.map((x) => x.path), ["src/a.ts", "public/x.png", "src/old/f.ts", "src/../supervisor/f.ts", "src/a.ts", "supervisor/b.ts"]);
  assert.equal(c[1].added, 1000);
  const v = policyViolations(c, P);
  assert.ok(v.some((x) => x.includes("supervisor/b.ts")) && v.some((x) => x.includes("outside the repository")));
});

test("stop, halt and pause block releases; daily limits reset each UTC day", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const base = { halted: null, paused: false, stopped: false, day: { day: utcDay(now), releases: 0, costUsd: 0 } };
  assert.equal(releaseBlocked(base, now, P), null);
  assert.match(releaseBlocked({ ...base, stopped: true, halted: "x" }, now, P)!, /emergency/);
  assert.match(releaseBlocked({ ...base, halted: "r1: health" }, now, P)!, /halted/);
  assert.match(releaseBlocked({ ...base, paused: true }, now, P)!, /paused/);
  assert.match(releaseBlocked({ ...base, day: { ...base.day, releases: 3 } }, now, P)!, /release limit/);
  assert.match(releaseBlocked({ ...base, day: { ...base.day, costUsd: 5 } }, now, P)!, /spend/);
  assert.equal(releaseBlocked({ ...base, day: { day: "2026-11-05", releases: 9, costUsd: 99 } }, now, P), null);
});

test("probes: failed health, wrong commit, restarts, error lines and workflow checks all fail a release", () => {
  const ok = { ok: true, commit: "a".repeat(40), uptimeSec: 50, errors: 0, failedChecks: [] };
  assert.deepEqual(probeProblems(ok, "a".repeat(40), 40, 0), []);
  assert.deepEqual(probeProblems({ ...ok, ok: false }, "a".repeat(40), null, 0), ["health check failed"]);
  assert.match(probeProblems({ ...ok, commit: "b".repeat(40) }, "a".repeat(40), null, 0)[0], /not the released/);
  assert.match(probeProblems({ ...ok, uptimeSec: 5 }, "a".repeat(40), 40, 0)[0], /restarted/);
  assert.match(probeProblems({ ...ok, errors: 2 }, "a".repeat(40), null, 1)[0], /error lines/);
  assert.deepEqual(probeProblems({ ...ok, failedChecks: ["login: HTTP 500"] }, "a".repeat(40), null, 0), ["login: HTTP 500"]);
});

test("rollback is bounded: no oscillation", () => {
  assert.equal(afterFailure(0, P), "rollback");
  assert.equal(afterFailure(1, P), "rollback");
  assert.equal(afterFailure(2, P), "halt");
});

test("error counting and redaction", () => {
  assert.equal(countErrors("ok\n[orbit] error: boom\nUnhandled rejection\n[orbit] isolated instance: no scheduler"), 2);
  const r = redact("key=sk-ant-api03-abcdefghijkl token: ghp_abcdefghijklmnopqrstuvwx mail a@b.ee Authorization: Bearer xyz123456");
  assert.ok(!/sk-ant|ghp_|a@b\.ee|xyz123456/.test(r), r);
});

test("submissions from the builder are shape-checked and must carry passing checks", () => {
  const s = { id: "t1-a", taskId: "t1", branch: "selfdev/t1", source: "x", commit: "a".repeat(40), base: "b".repeat(40), title: "t", why: "w", acceptance: [], checks: [{ name: "gate", ok: true }], costUsd: 0.4 };
  assert.equal(submissionProblem(s), null);
  assert.match(submissionProblem({ ...s, branch: "main" })!, /selfdev/);
  assert.match(submissionProblem({ ...s, id: "../x" })!, /bad id/);
  assert.match(submissionProblem({ ...s, commit: "HEAD" })!, /SHA/);
  assert.match(submissionProblem({ ...s, checks: [{ name: "gate", ok: false }] })!, /did not all pass/);
  assert.match(submissionProblem({ ...s, checks: [] })!, /did not all pass/);
  assert.match(submissionProblem({ ...s, costUsd: -1 })!, /costUsd/);
});

test("audit chain detects edits, deletions and reordering", () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "audit-")), "a.jsonl");
  for (const e of ["a", "b", "c"]) appendAudit(f, e, { n: e });
  assert.equal(verifyAudit(readAudit(f)), 0);
  const lines = readFileSync(f, "utf8").trim().split("\n");
  writeFileSync(f, lines[0] + "\n" + lines[1].replace('"b"', '"x"') + "\n" + lines[2] + "\n");
  assert.equal(verifyAudit(readAudit(f)), 2);
  writeFileSync(f, lines[0] + "\n" + lines[2] + "\n");
  assert.equal(verifyAudit(readAudit(f)), 2);
  const e = appendAudit(f, "d", {});
  assert.equal(e.data.auditChainBrokenAt, 2); // a broken chain is recorded in the next entry, never silently continued
});

test("links, submodules, mode changes and git metadata files never ship unattended", () => {
  const z = "0".repeat(40), a = "a".repeat(40);
  assert.deepEqual(modeViolations(`:100644 100644 ${a} ${a} M\tsrc/a.ts\n:000000 100755 ${z} ${a} A\ttests/x.sh`), []);
  const v = modeViolations([`:000000 120000 ${z} ${a} A\tsrc/link`, `:000000 160000 ${z} ${a} A\tsrc/sub`, `:100644 100644 ${a} ${a} M\tsrc/.gitattributes`].join("\n"));
  assert.equal(v.length, 3);
  assert.match(v[0], /120000/); assert.match(v[1], /160000/); assert.match(v[2], /git metadata/);
});

test("ORBIT's Stop-all holds releases the way the app reads it: missing = off, unreadable or damaged = on", () => {
  assert.equal(orbitStopAllOn(undefined), false);
  assert.equal(orbitStopAllOn('{"on":false,"at":""}'), false);
  assert.equal(orbitStopAllOn('{"on":true,"at":"x"}'), true);
  assert.equal(orbitStopAllOn(null), true); // locked / unreadable
  assert.equal(orbitStopAllOn(""), true); // empty after a power cut
  assert.equal(orbitStopAllOn('{"on":"no"}'), true);
});

test("CI: every required check must succeed on the commit; others failing also fail it", () => {
  const ok = (name: string) => ({ name, status: "completed", conclusion: "success" });
  assert.equal(checksVerdict(["check"], [ok("check")]).state, "pass");
  assert.equal(checksVerdict(["check"], [ok("other")]).state, "pending"); // a different check passing isn't enough
  assert.equal(checksVerdict(["check"], []).state, "pending");
  assert.equal(checksVerdict(["check"], [{ name: "check", status: "in_progress", conclusion: null }]).state, "pending");
  assert.equal(checksVerdict(["check"], [ok("check"), { name: "x", status: "completed", conclusion: "failure" }]).state, "fail");
  assert.equal(checksVerdict(["check"], [{ name: "check", status: "completed", conclusion: "skipped" }]).state, "pending"); // skipped isn't passed
});

test("model-written tests may not end the run early or spawn commands (enforced by the supervisor on the real diff)", () => {
  const d = (l: string) => `diff --git a/tests/a.test.ts b/tests/a.test.ts\n--- a/tests/a.test.ts\n+++ b/tests/a.test.ts\n@@ -1 +1 @@\n${l}\n`;
  assert.match(weakenedTests([], d("+process.exit(0);"))[0], /exits the process/);
  assert.match(weakenedTests([], d('+import { execSync } from "node:child_process";'))[0], /spawns commands/);
  assert.deepEqual(weakenedTests([], d("+assert.equal(f(), 1);")), []);
});
