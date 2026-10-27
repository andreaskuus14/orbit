import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDiff, forbiddenPath, handoffText, parseDiff, parsePatchReply, patchFile, pickFiles, slug } from "../src/lib/self-improve-patch-pure.ts";
import type { Task } from "../src/lib/self-improve-pure.ts";

const file = (p: string, minus: string[], plus: string[], o: { from?: string; to?: string } = {}) => [
  `diff --git a/${p} b/${p}`, `--- ${o.from ?? `a/${p}`}`, `+++ ${o.to ?? `b/${p}`}`,
  `@@ -1,${minus.length + 1} +1,${plus.length + 1} @@`, " ctx", ...minus.map((l) => `-${l}`), ...plus.map((l) => `+${l}`)].join("\n");
const goodTest = file("tests/lessons.test.ts", [], ['test("new case", () => { assert.equal(f(1), 2); });']);
const ok = (...parts: string[]) => [...parts, goodTest].join("\n") + "\n";

test("a small fix with a new test passes", () => {
  assert.deepEqual(checkDiff(ok(file("src/lib/lessons-pure.ts", ["  return x;"], ["  return x + 1;"]))), []);
});

test("forbidden paths are refused, old or new side", () => {
  for (const p of ["AGENTS.md", "docs/CLAUDE.md", ".env.local", ".env.example", "src/lib/policy-pure.ts", "src/lib/approval-pure.ts", "src/lib/autonomy.ts",
    "src/lib/stop-all.ts", "tests/stop-all.test.ts", "src/app/api/rea/route.ts", "src/app/rea/page.tsx", "src/lib/core-rea.ts", "vendor/rea/x.py", "REA-CHANGES.md",
    "src/lib/self-improve-patch-pure.ts", ".github/workflows/ci.yml", "/etc/passwd", "src/../AGENTS.md", "C:/x.ts"])
    assert.ok(forbiddenPath(p), p);
  for (const p of ["src/lib/lessons-pure.ts", "src/lib/area-pure.ts", "src/lib/reader.ts", "tests/create.test.ts"]) assert.equal(forbiddenPath(p), "", p);
  const r = checkDiff(ok(file("AGENTS.md", ["1. Never commit to main."], []), file("src/lib/x.ts", [], ["y"], { to: "b/.env.local" })));
  assert.ok(r.some((w) => w.includes("AGENTS.md")) && r.some((w) => w.includes(".env")), r.join("; "));
  assert.ok(checkDiff(ok(["diff --git a/src/lib/a.ts b/src/lib/stop-all.ts", "rename from src/lib/a.ts", "rename to src/lib/stop-all.ts"].join("\n"))).some((w) => w.includes("Stop-all")));
  assert.ok(checkDiff(ok(file("src/lib/policy-pure.ts", [], ["x"], { from: "/dev/null" }))).some((w) => w.includes("policy")), "new forbidden file");
});

test("a content line can't pose as a header to hide a forbidden path", () => {
  const sneaky = ["diff --git a/AGENTS.md b/AGENTS.md", "--- /dev/null", "+++ b/AGENTS.md", "@@ -0,0 +1,2 @@", "+++ b/tests/ok.test.ts", "+anything"].join("\n");
  assert.ok(checkDiff(ok(sneaky)).some((w) => w.includes("AGENTS.md")));
  assert.deepEqual(parseDiff(sneaky)[0].added, ["++ b/tests/ok.test.ts", "anything"]);
});

test("miscounted hunks: stray lines are still checked", () => {
  const d = ["diff --git a/src/lib/x.ts b/src/lib/x.ts", "--- a/src/lib/x.ts", "+++ b/src/lib/x.ts", "@@ -1,1 +1,1 @@", "-a", "+b", "+const o = { permissionMode: 'bypassPermissions' };", "-  if (stopAllOn()) return;"].join("\n");
  const r = checkDiff(ok(d));
  assert.ok(r.some((w) => w.includes("permission prompts")), r.join("; "));
  assert.ok(r.some((w) => w.includes("stopAllOn")), r.join("; "));
});

test("weakened tests are refused", () => {
  const t = "tests/health.test.ts";
  assert.ok(checkDiff(ok(file(t, ["  assert.equal(a, 1);", "  assert.ok(b);"], ["  assert.ok(true);"]))).some((w) => w.includes("removes 2 assertion")));
  assert.ok(checkDiff(ok(file(t, ['test("x", () => {});'], []))).some((w) => w.includes("test case")));
  assert.ok(checkDiff(ok(file(t, ["x"], [], { to: "/dev/null" }))).some((w) => w.includes("deletes test file")));
  assert.ok(checkDiff(ok(file(t, ['test("x", () => {'], ['test.skip("x", () => {']))).some((w) => w.includes("skips")));
  assert.ok(checkDiff(ok(file(t, [], ['test("x", { skip: true }, () => {});']))).some((w) => w.includes("skips")));
  assert.ok(checkDiff(ok(file("evals/agent-replay-cases.ts", ["  expect(r).toBe(2);"], []))).some((w) => w.includes("assertion")));
  assert.deepEqual(checkDiff(ok(file(t, ["  assert.equal(a, 1);"], ["  assert.equal(a, 2);"]))), [], "rewriting an assertion is fine");
});

test("permission-weakening patterns are refused", () => {
  const src = "src/app/api/x/route.ts";
  for (const [minus, plus, word] of [
    [["  const { res } = await requireUser();"], [], "requireUser"],
    [["  if (crossSiteBlocked(m, p, h)) return no;"], [], "crossSiteBlocked"],
    [["  if (usageHold()) return;"], ["  // usage ok"], "usageHold"],
    [["  text: redact(t),"], ["  text: t,"], "redact"],
    [[], ["spawn('claude', ['--dangerously-skip-permissions'])"], "permission prompts"],
    [[], ["process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';"], "TLS"],
    [[], ["execSync('git push origin main');"], "git writes"],
    [[], ["eval(code);"], "dynamic code"],
  ] as [string[], string[], string][]) assert.ok(checkDiff(ok(file(src, minus, plus))).some((w) => w.includes(word)), word);
  assert.deepEqual(checkDiff(ok(file(src, ["  const { res } = await requireUser();"], ["  const { user, res } = await requireUser();"]))), [], "moving a guard is fine");
});

test("needs a diff and a test assertion; binary refused", () => {
  assert.deepEqual(checkDiff("just prose"), ["no unified diff found"]);
  assert.ok(checkDiff(file("src/lib/x.ts", ["a"], ["b"])).includes("adds no test assertion"));
  assert.ok(checkDiff(ok("diff --git a/x.png b/x.png\nGIT binary patch\nliteral 1")).includes("contains a binary patch"));
});

const task: Task = { key: "lesson:health", source: "lesson", area: "lessons", title: "ORBIT keeps misreading you", problem: "p", goal: "The lesson miner (lessons-pure.ts) stops; see src/lib/policy-pure.ts",
  detail: [], evidence: ["l1"], impact: 50, impactWhy: "w" };

test("pickFiles: named files first, area module + its test, never forbidden, max 4", () => {
  const repo = ["src/lib/lessons-pure.ts", "src/lib/lessons.ts", "tests/lessons.test.ts", "src/lib/policy-pure.ts", "src/lib/other.ts", "README.md"];
  assert.deepEqual(pickFiles(task, repo), ["src/lib/lessons-pure.ts", "src/lib/lessons.ts", "tests/lessons.test.ts"]);
  assert.deepEqual(pickFiles({ ...task, area: "../x", goal: "" }, repo), []);
});

test("parsePatchReply, patch file and handoff", () => {
  const reply = `Sure.\nRATIONALE: The miner counts\nrejected lessons twice. token=abc123secret\nTEST: node --test tests/lessons.test.ts\n\`\`\`diff\n${goodTest}\n\`\`\`\nDone.`;
  const d = parsePatchReply(reply)!;
  assert.equal(d.diff, goodTest + "\n");
  assert.equal(d.test, "node --test tests/lessons.test.ts");
  assert.match(d.rationale, /^The miner counts rejected lessons twice\./);
  assert.doesNotMatch(d.rationale, /abc123secret/);
  assert.equal(parsePatchReply("RATIONALE: x\n```diff\nnot a diff\n```"), null);
  assert.equal(parsePatchReply("no block"), null);
  const pf = patchFile(task, d, "2026-W44");
  assert.match(pf, /NOT APPLIED/);
  assert.ok(pf.endsWith(d.diff));
  const h = handoffText(task, d, "/data/self-improve-patches/x.patch");
  assert.match(h, /\/data\/self-improve-patches\/x\.patch/);
  assert.match(h, /AGENTS\.md/);
  assert.match(h, /never `main`/);
  assert.equal(slug("lesson:Health/Foo"), "lesson-health-foo");
});
