import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { checkPatch, modeViolations, parseNumstat, protectedPath, windowsAlias } from "../src/lib/night-repair-protect-pure.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("every hard-protected path from the spec is refused", () => {
  for (const p of [
    "scripts/launch.ps1", "scripts/stop.ps1", "scripts/night/orbit-night.ps1", "restart-orbit.cmd", // supervisor, stop, watchdog (launch.ps1 -Watchdog)
    "src/lib/approval-pure.ts", "src/lib/approval-bind.ts", "src/lib/policy-pure.ts", "src/lib/autonomy-pure.ts", "src/lib/stop-all.ts", "src/lib/remote-act.ts",
    "src/lib/remote-web-pure.ts", "src/lib/csrf.ts", "src/lib/allow.ts", "src/lib/usage-pace-pure.ts", "src/lib/agent-defs-pure.ts", "package.json", "tests/route-guards.test.ts",
    "src/lib/life.ts", "src/lib/life-pure.ts", "src/lib/core-life.ts", "tests/journal-privacy-audit.test.ts", "tests/journal-embed-io.test.ts", "src/lib/private-pure.ts", "tests/journal-guard.test.ts", "src/lib/youtube-privacy.ts", "tests/memory-scope-guard.test.ts",
    "src/lib/supabase/server.ts", "src/middleware.ts", "src/lib/yt-oauth.ts", "src/lib/remote-pure.ts", "src/app/api/remote/route.ts",
    ".env", ".env.local", "src/.env.production", "src/lib/secret-store.ts", "certs/x.pem",
    "src/lib/business-send.ts", "src/lib/invoices.ts", "src/lib/stripe-pure.ts", "src/lib/remote-push.ts", "src/lib/clips/publish.ts", "src/lib/negotiator.ts",
    "src/lib/night-repair-protect-pure.ts", "tests/night-repair-protect.test.ts", "src/lib/night-repair.ts", "src/app/api/night-repair/route.ts",
    ".github/workflows/ai-quality.yml", "AGENTS.md", "src/lib/self-update.ts", "src/lib/self-improve-patch-pure.ts", "supabase/migrations/0001.sql", "evals/memory-cases.ts",
  ]) assert.notEqual(protectedPath(p), "", p);
});

test("ordinary source and test files may change", () => {
  for (const p of ["src/lib/pagewatch-pure.ts", "tests/pagewatch.test.ts", "src/components/NeedsYou.tsx", "docs/notes.md", "tests/bench/core.bench.ts"]) assert.equal(protectedPath(p), "", p);
});

test("Windows spellings of a protected file are caught (case, backslashes, 8.3, trailing dot, streams, devices)", () => {
  for (const p of ["Scripts/Launch.ps1", "scripts\\stop.ps1", "SRC/lib/Stop-All.ts", "PACKAGE.JSON", "src/lib/STOPAL~1.TS", "src/lib/x-pure.ts.", "src/lib/a.ts:evil", "src/lib/nul.ts", "src/lib/x ", "../x.ts", "/etc/passwd", "C:/x.ts"])
    assert.notEqual(protectedPath(p), "", p);
  assert.equal(windowsAlias("src/lib/plain-pure.ts"), "");
});

test("outside src/, tests/ and docs/ nothing may change", () => {
  for (const p of ["next.config.ts", "tsconfig.json", "public/x.js", "tools/x.py", "skills/orbit/x.md", "services/x.ts"]) assert.notEqual(protectedPath(p), "", p);
});

test("every file npm run eval:ai loads (the gate's eval) is protected", () => {
  const seen = new Set<string>(), todo = ["scripts/ai-scorecard.ts"];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+\.ts)["']/g)) {
      const n = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (existsSync(path.join(ROOT, n))) todo.push(n);
    }
  }
  assert.ok(seen.size > 3);
  for (const f of seen) assert.notEqual(protectedPath(f), "", `${f} is loaded by eval:ai but a night patch could change it`);
});

test("parseNumstat: renames give both paths, binaries count as large", () => {
  assert.deepEqual(parseNumstat("3\t1\tsrc/lib/a.ts\n-\t-\tpublic/x.png\n2\t0\tsrc/{a => b}/c.ts\n"), [
    { path: "src/lib/a.ts", added: 3, removed: 1 }, { path: "public/x.png", added: 1000, removed: 1000 },
    { path: "src/a/c.ts", added: 2, removed: 0 }, { path: "src/b/c.ts", added: 2, removed: 0 }]);
});

test("modeViolations: symlinks and submodules are refused", () => {
  assert.equal(modeViolations(":000000 100644 0000000 abc1234 A\tsrc/lib/a.ts").length, 0);
  assert.match(modeViolations(":000000 120000 0000000 abc1234 A\tsrc/lib/link.ts")[0], /mode 120000/);
  assert.match(modeViolations(":100644 100644 aaa bbb M\ttests/fixtures/x.json")[0], /fixture/);
});

const good = `diff --git a/src/lib/pagewatch-pure.ts b/src/lib/pagewatch-pure.ts
--- a/src/lib/pagewatch-pure.ts
+++ b/src/lib/pagewatch-pure.ts
@@ -1,1 +1,1 @@
-export const x = 1;
+export const x = 2;
diff --git a/tests/pagewatch.test.ts b/tests/pagewatch.test.ts
--- a/tests/pagewatch.test.ts
+++ b/tests/pagewatch.test.ts
@@ -1,0 +1,2 @@
+test("x is two", () => { assert.equal(x, 2); });
+
`;
const numGood = "1\t1\tsrc/lib/pagewatch-pure.ts\n2\t0\ttests/pagewatch.test.ts\n";

test("checkPatch accepts a small fix with a test", () => {
  assert.deepEqual(checkPatch({ numstat: numGood, raw: "", patch: good }), []);
});

test("checkPatch rejects the WHOLE patch when one protected file is touched", () => {
  const patch = good + `diff --git a/scripts/launch.ps1 b/scripts/launch.ps1
--- a/scripts/launch.ps1
+++ b/scripts/launch.ps1
@@ -1,1 +1,1 @@
-$a = 1
+$a = 2
`;
  const why = checkPatch({ numstat: numGood + "1\t1\tscripts/launch.ps1\n", raw: "", patch });
  assert.ok(why.some((w) => /scripts\/launch\.ps1: protected/.test(w)), why.join("; "));
});

test("checkPatch rejects weakened tests, test processes/network, credential reads and no test at all", () => {
  const weak = `diff --git a/tests/a.test.ts b/tests/a.test.ts
--- a/tests/a.test.ts
+++ b/tests/a.test.ts
@@ -1,2 +1,1 @@
-test("a", () => { assert.equal(1, 1); });
-test("b", () => { assert.equal(2, 2); });
+test("a", () => { assert.equal(1, 1); });
`;
  assert.ok(checkPatch({ numstat: "1\t2\ttests/a.test.ts\n", raw: "", patch: weak }).some((w) => /assertion|test case/.test(w)));
  const spawny = good.replace('+test("x is two"', '+import { execSync } from "node:child_process"; execSync("whoami");\n+test("x is two"');
  assert.ok(checkPatch({ numstat: numGood, raw: "", patch: spawny }).some((w) => /spawns processes/.test(w)));
  const net = good.replace('+test("x is two"', '+await fetch("https://example.com");\n+test("x is two"');
  assert.ok(checkPatch({ numstat: numGood, raw: "", patch: net }).some((w) => /network/.test(w)));
  const creds = good.replace("+export const x = 2;", '+export const x = readFileSync(homedir() + "/.claude/.credentials.json");');
  assert.ok(checkPatch({ numstat: numGood, raw: "", patch: creds }).some((w) => /credential/.test(w)));
  const noTest = good.split("diff --git a/tests")[0];
  assert.ok(checkPatch({ numstat: "1\t1\tsrc/lib/pagewatch-pure.ts\n", raw: "", patch: noTest }).some((w) => /no test assertion/.test(w)));
  assert.deepEqual(checkPatch({ numstat: "", raw: "", patch: "" }), ["the agent changed nothing"]);
});

test("checkPatch enforces the size limits", () => {
  const many = Array.from({ length: 9 }, (_, i) => `1\t0\tsrc/lib/f${i}-pure.ts`).join("\n");
  assert.ok(checkPatch({ numstat: many, raw: "", patch: good }).some((w) => /9 files/.test(w)));
  assert.ok(checkPatch({ numstat: "500\t0\tsrc/lib/big-pure.ts\n", raw: "", patch: good }).some((w) => /changed lines/.test(w)));
});
