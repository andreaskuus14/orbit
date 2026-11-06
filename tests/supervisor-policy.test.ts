import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_POLICY as P, afterFailure, countErrors, parseNumstat, policyViolations, probeProblems, redact, releaseBlocked, submissionProblem, utcDay,
} from "../supervisor/policy.ts";
import { appendAudit, readAudit, verifyAudit } from "../supervisor/audit.ts";

const ch = (path: string, added = 1, removed = 0) => ({ path, added, removed });

test("small changes inside src/tests/docs pass; protected paths never do", () => {
  assert.deepEqual(policyViolations([ch("src/lib/x-pure.ts", 20), ch("tests/x.test.ts", 30)], P), []);
  for (const p of ["supervisor/policy.ts", ".github/workflows/ai-quality.yml", "AGENTS.md", "supabase/migrations/0026_x.sql", "package.json",
    "package-lock.json", "scripts/launch.ps1", "src/app/api/rea/route.ts", "src/middleware.ts", "src/lib/stop-all.ts", "src/lib/authority.ts",
    "src/app/api/selfdev/route.ts", "src/lib/selfdev.ts", "src/instrumentation.ts", ".env.local"])
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
