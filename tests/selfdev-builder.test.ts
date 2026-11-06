import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, errorSignals, failingTests, missingRegressionTest, normalizeError, select, weakenedTests } from "../selfdev/builder-pure.ts";

test("errors with different ids, numbers and paths group into one signature", () => {
  const a = normalizeError("2026-11-06T10:00:01Z [orbit] task 3f2a9c1e-1111-2222-3333-444455556666 failed after 1200 ms at C:\\orbit\\src\\lib\\x.ts:12:4");
  const b = normalizeError("2026-11-06T11:00:09Z [orbit] task 9a2a9c1e-1111-2222-3333-444455556666 failed after 37 ms at C:\\orbit\\src\\lib\\x.ts:99:1");
  assert.equal(a, b);
  const sig = errorSignals("ok\n[orbit] boom error 1\n[orbit] boom error 2\n[orbit] isolated instance: no scheduler\nfetch failed ECONNREFUSED 127.0.0.1:9\n");
  assert.deepEqual(sig.map((s) => s.count), [2]);
});

test("failing test names from node --test output", () => {
  assert.deepEqual(failingTests("ok 1 - a\nnot ok 2 - b breaks\n  not ok 3 - c\nnot ok 2 - b breaks\n"), ["b breaks", "c"]);
});

test("selection: failing tests first, repeated failures demoted then blocked, nothing below the bar", () => {
  const c = candidates({ failing: ["t1"], errors: [{ sig: "e", count: 3, sample: "e" }], perf: [{ metric: "lcp", value: 3000, budget: 2500, unit: "ms" }], backlog: [{ id: "b", title: "B", priority: "low" }, { id: "d", title: "D", done: true }] });
  assert.deepEqual(c.map((x) => x.key), ["test:t1", "error:e", "perf:lcp", "backlog:b"]);
  assert.equal(select(c, {}, 3).pick!.key, "test:t1");
  const blocked = select(c, { "test:t1": { tries: 3, last: "x" } }, 3);
  assert.equal(blocked.pick!.key, "error:e");
  assert.match(blocked.skipped[0], /blocked after 3/);
  assert.equal(select(c, { "test:t1": { tries: 1, last: "x", blocker: "rolled back" } }, 3).pick!.key, "error:e");
  const low = select(candidates({ failing: [], errors: [], perf: [], backlog: [{ id: "b", title: "B", priority: "low" }] }), {}, 3);
  assert.equal(low.pick, null);
  assert.match(low.why, /not worth a change/);
  assert.match(select([], {}, 3).why, /no errors/);
});

const diff = (name: string, lines: string, extra = "") => `diff --git a/${name} b/${name}\n${extra}--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${lines}\n`;

test("weakened tests are caught: deleted files, fewer assertions, skips, test script changes", () => {
  assert.deepEqual(weakenedTests([], diff("tests/a.test.ts", "-  assert.equal(x, 1);\n+  assert.equal(x, 2);")), []);
  assert.match(weakenedTests([], diff("tests/a.test.ts", "-  assert.equal(x, 1);\n-  assert.ok(y);\n+  assert.ok(x);"))[0], /1 fewer/);
  assert.match(weakenedTests([], diff("tests/a.test.ts", "-x", "deleted file mode 100644\n"))[0], /deleted/);
  assert.match(weakenedTests([], diff("tests/a.test.ts", "+test.skip(\"x\", () => {});"))[0], /skip/);
  assert.match(weakenedTests([{ path: "package.json", added: 1, removed: 1 }], "")[0], /package\.json/);
  assert.deepEqual(weakenedTests([], diff("src/a.ts", "-assert(x)")), []); // only test files count
});

test("the weekly self-improve ranking feeds the builder, scored by impact", () => {
  const c = candidates({ failing: [], errors: [], perf: [], backlog: [], improve: [{ key: "night:clips", source: "night", title: "Fix clip runs", problem: "4 of 7 failed", goal: "clip runs succeed", evidence: ["ev1"], detail: [], impact: 80 }] });
  assert.equal(c[0].key, "improve:night:clips");
  assert.equal(c[0].score, 72);
  assert.deepEqual(c[0].acceptance, ["clip runs succeed", "covered by a test", "the gate passes"]);
});

test("bug fixes need a test change; backlog features don't", () => {
  assert.equal(missingRegressionTest("error", [{ path: "src/a.ts" }]), true);
  assert.equal(missingRegressionTest("failing-test", [{ path: "src/a.ts" }, { path: "tests/a.test.ts" }]), false);
  assert.equal(missingRegressionTest("backlog", [{ path: "src/a.ts" }]), false);
});
