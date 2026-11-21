// The night-repair git/worktree flow, simulated on a throwaway repo (Linux/macOS CI; the laptop runs the same commands with Git for Windows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as G from "../src/lib/night-repair-git.ts";
import { checkPatch } from "../src/lib/night-repair-protect-pure.ts";
import { gateEnv } from "../src/lib/night-repair-pure.ts";

const sh = async (cwd: string, ...args: string[]) => { const r = await G.git(cwd, args); assert.equal(r.code, 0, r.out); return r.out.trim(); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")); // a child node --test must not think it's our subtest
const ID = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];

test("worktree → agent edit → commit → real diff checks → gate → push → fast-forward, and cleanup never follows the node_modules link", { skip: process.platform === "win32" && "covered on the laptop" }, async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "orbit-nr-"));
  try {
    const origin = path.join(tmp, "origin.git"), seed = path.join(tmp, "seed"), live = path.join(tmp, "live"), home = path.join(tmp, "data");
    mkdirSync(seed);
    await sh(tmp, "init", "-q", "--bare", "-b", "main", origin);
    await sh(seed, "init", "-q", "-b", "main");
    mkdirSync(path.join(seed, "src/lib"), { recursive: true }); mkdirSync(path.join(seed, "tests")); mkdirSync(path.join(seed, "scripts"));
    writeFileSync(path.join(seed, "src/lib/a-pure.ts"), "export const add = (a: number, b: number) => a - b;\n");
    writeFileSync(path.join(seed, "tests/a.test.ts"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/lib/a-pure.ts";\ntest("adds", () => { assert.equal(add(1, 1), 0); });\n');
    writeFileSync(path.join(seed, "scripts/launch.ps1"), "# supervisor\n");
    writeFileSync(path.join(seed, "package.json"), JSON.stringify({ name: "t", private: true, scripts: { gate: "node --test --experimental-strip-types tests/a.test.ts" } }));
    writeFileSync(path.join(seed, ".gitignore"), "node_modules\n.env.local\n");
    await sh(seed, "add", "-A"); await sh(seed, ...ID, "commit", "-q", "-m", "seed");
    await sh(seed, "remote", "add", "origin", origin); await sh(seed, "push", "-q", "origin", "main");
    await sh(tmp, "clone", "-q", origin, live);
    mkdirSync(path.join(live, "node_modules")); writeFileSync(path.join(live, "node_modules", "MARKER"), "live");

    const base = await G.fetchMain(live);
    assert.match(base, /^[0-9a-f]{40}$/);

    // base worktree (self-test + "before" measurements), with the live node_modules linked in
    const baseDir = path.join(home, "wt", "base-2026-11-21");
    await G.addDetached(live, baseDir, base);
    await G.linkModules(baseDir, path.join(live, "node_modules"));
    assert.equal(readFileSync(path.join(baseDir, "node_modules", "MARKER"), "utf8"), "live");
    assert.equal(await G.removeWorktree(live, baseDir), true);
    assert.ok(!existsSync(baseDir));
    assert.ok(existsSync(path.join(live, "node_modules", "MARKER")), "removing a worktree must not delete through the junction");

    // patch worktree on a night branch; the "agent" fixes the bug and adds a test
    const branch = "night/2026-11-21-adds", wt = path.join(home, "wt", "2026-11-21-adds");
    await G.addWorktree(live, wt, branch, base);
    await assert.rejects(G.addWorktree(live, path.join(home, "wt", "dup"), branch, base), /worktree add/); // a branch is never reused
    writeFileSync(path.join(wt, "src/lib/a-pure.ts"), "export const add = (a: number, b: number) => a + b;\n");
    writeFileSync(path.join(wt, "tests/a.test.ts"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/lib/a-pure.ts";\ntest("adds", () => { assert.equal(add(1, 1), 2); });\ntest("adds negatives", () => { assert.equal(add(-1, -1), -2); });\n');
    writeFileSync(path.join(wt, ".env.local"), "X=1\n");
    assert.deepEqual(await G.strayIgnored(wt), [".env.local"]); // an ignored file the build would read: the patch is discarded
    rmSync(path.join(wt, ".env.local"));
    assert.deepEqual(await G.strayIgnored(wt), []);
    const head = await G.commitAll(wt, "night repair: adds");
    assert.match(head!, /^[0-9a-f]{40}$/);
    assert.equal(await G.commitAll(wt, "nothing"), null);
    assert.deepEqual(await G.nightBranches(live), [branch]);
    const d = await G.diffOf(wt, base, head!);
    assert.deepEqual(checkPatch(d), []);

    // the gate runs in the worktree with the scrubbed environment
    await G.linkModules(wt, path.join(live, "node_modules"));
    const data = path.join(tmp, "gate-data");
    const gate = await G.run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "gate"], { cwd: wt, env: { ...gateEnv(process.env, data), ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}) }, timeoutMs: 120_000 });
    assert.equal(gate.code, 0, gate.out);
    const before = await G.run(process.execPath, ["--experimental-strip-types", "--test", "tests/a.test.ts"], { cwd: live, env: cleanEnv(), timeoutMs: 60_000 });
    assert.equal(before.code, 0, before.out); // main's own (buggy) test passes on main …
    // … and the patched test fails on main: that's the "failing before, passing after" measurement
    const failing = path.join(live, "tests/a.test.ts");
    writeFileSync(failing, readFileSync(path.join(wt, "tests/a.test.ts"), "utf8"));
    assert.notEqual((await G.run(process.execPath, ["--experimental-strip-types", "--test", "tests/a.test.ts"], { cwd: live, env: cleanEnv(), timeoutMs: 60_000 })).code, 0);
    await sh(live, "checkout", "--", "tests/a.test.ts");

    // a second patch that touches the supervisor is rejected whole on the real diff
    const wt2 = path.join(home, "wt", "2026-11-21-bad");
    await G.addWorktree(live, wt2, "night/2026-11-21-bad", base);
    writeFileSync(path.join(wt2, "src/lib/a-pure.ts"), "export const add = (a: number, b: number) => a + b;\n");
    writeFileSync(path.join(wt2, "tests/a.test.ts"), readFileSync(path.join(wt, "tests/a.test.ts"), "utf8"));
    writeFileSync(path.join(wt2, "scripts/launch.ps1"), "# supervisor, loosened\n");
    const bad = await G.commitAll(wt2, "bad");
    assert.ok(checkPatch(await G.diffOf(wt2, base, bad!)).some((w) => /scripts\/launch\.ps1: protected/.test(w)));
    await G.removeWorktree(live, wt2); await G.deleteBranch(live, "night/2026-11-21-bad");
    assert.deepEqual(await G.nightBranches(live), [branch]);

    // push (the PR step needs a token; here only the branch) and the owner's Approve: fast-forward main
    assert.equal(await G.removeWorktree(live, wt), true);
    assert.ok(existsSync(path.join(live, "node_modules", "MARKER")));
    await G.pushBranch(live, branch);
    assert.equal(await sh(origin, "rev-parse", `refs/heads/${branch}`), head);
    assert.equal(await G.revParse(live, `refs/heads/${branch}`), head);
    await G.fastForwardMain(live, head!);
    assert.equal(await G.revParse(live, "HEAD"), head);
    assert.match(readFileSync(path.join(live, "src/lib/a-pure.ts"), "utf8"), /a \+ b/);

    // main moved meanwhile → no fast-forward
    await sh(live, ...ID, "commit", "-q", "--allow-empty", "-m", "owner work");
    await assert.rejects(G.fastForwardMain(live, head!), /main moved|not main|merge/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("run(): timeouts kill the process, a missing program doesn't throw", async () => {
  const r = await G.run(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 300 });
  assert.equal(r.code, -1); assert.equal(r.timedOut, true); assert.ok(r.ms < 5000);
  assert.equal((await G.run("definitely-not-a-program-xyz", [])).code, -1);
  const ac = new AbortController(); setTimeout(() => ac.abort(), 200);
  assert.equal((await G.run(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { signal: ac.signal, timeoutMs: 10_000 })).code, -1);
});

test("gitEnv strips inherited GIT_* and never prompts", () => {
  const e = G.gitEnv({ GIT_DIR: "/evil", GIT_WORK_TREE: "/x", PATH: "/bin" });
  assert.equal(e.GIT_DIR, undefined); assert.equal(e.GIT_WORK_TREE, undefined);
  assert.equal(e.GIT_TERMINAL_PROMPT, "0"); assert.equal(e.GCM_INTERACTIVE, "never"); assert.equal(e.PATH, "/bin");
});
