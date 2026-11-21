import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendCapped, cleanEnv, cleanOutput, coreResult, deactivateEnv, isSecretEnv, modelOutput, nextEnv, parseState, snapshotPlan, undoPlan, wrap, type Run,
} from "../src/lib/shell-session-pure.ts";
import { normPath } from "../src/lib/command-policy-pure.ts";

const run = (o: Partial<Run> = {}): Run => ({ id: "r1", session: "s1", command: "npm test", source: "core", level: 1, what: "run the tests", reason: "", private: false, status: "done", exit: 0,
  startedAt: "2026-11-21T10:00:00Z", endedAt: "2026-11-21T10:00:05Z", createdAt: "2026-11-21T10:00:00Z", output: "ok", outLen: 2, timeoutS: 600, ...o });
const S = { name: "main", shell: "powershell" as const, cwd: "C:\\p" };

test("cleanEnv drops ORBIT's keys and logins, keeps PATH, adds no-prompt settings", () => {
  const e = cleanEnv({ PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", GITHUB_TOKEN: "x", ORBIT_DATA_DIR: "x", NEXT_PUBLIC_X: "x", DB_PASSWORD: "x", KAGGLE_KEY: "x", NODE_OPTIONS: "--x", npm_config_registry: "x" });
  assert.deepEqual(Object.keys(e).filter((k) => !["GIT_TERMINAL_PROMPT", "GIT_PAGER", "PAGER", "NO_COLOR", "FORCE_COLOR", "PYTHONUNBUFFERED", "PIP_NO_INPUT", "npm_config_yes", "DEBIAN_FRONTEND"].includes(k)), ["PATH", "HOME"]);
  assert.equal(e.GIT_TERMINAL_PROMPT, "0");
  assert.ok(isSecretEnv("MY_API_KEY") && isSecretEnv("SESSION_SECRET") && !isSecretEnv("VIRTUAL_ENV") && !isSecretEnv("PATH"));
  assert.deepEqual(nextEnv({ A: "1", OPENAI_API_KEY: "x", B: 2, "bad name": "x" }), { A: "1" });
});

test("deactivateEnv removes the venv from PATH (Windows and POSIX)", () => {
  assert.deepEqual(deactivateEnv({ VIRTUAL_ENV: "C:\\p\\.venv", Path: "C:\\p\\.venv\\Scripts;C:\\Windows" }), { Path: "C:\\Windows" });
  assert.deepEqual(deactivateEnv({ VIRTUAL_ENV: "/p/.venv", VIRTUAL_ENV_PROMPT: "x", PATH: "/p/.venv/bin:/usr/bin" }), { PATH: "/usr/bin" });
  assert.deepEqual(deactivateEnv({ PATH: "/usr/bin" }), { PATH: "/usr/bin" });
});

test("output: ANSI and progress-bar redraws cleaned; buffer capped keeping head and tail", () => {
  assert.equal(cleanOutput("\x1b[32mok\x1b[0m\r\n10%\r50%\r100%\n"), "ok\n100%\n");
  let b = "";
  for (let i = 0; i < 2000; i++) b = appendCapped(b, `line ${i}\n`, 4000);
  assert.ok(b.length <= 4000 && b.startsWith("line 0\n") && b.endsWith("line 1999\n") && b.includes("older output cut"));
});

test("modelOutput: private runs never show output; long output is cut; secrets go through the redactor", () => {
  assert.match(modelOutput(run({ private: true, output: "journal text" }), (s) => s), /hidden/);
  assert.ok(!modelOutput(run({ private: true, output: "dear diary XYZ" }), (s) => s).includes("XYZ"));
  const long = modelOutput(run({ output: "a".repeat(10_000) + "END" }), (s) => s, 1000);
  assert.ok(long.length < 1200 && long.endsWith("END") && long.includes("characters cut"));
  assert.equal(modelOutput(run({ output: "key sk-123" }), (s) => s.replace(/sk-\d+/, "<x>")), "key <x>");
});

test("coreResult: plain words per status", () => {
  assert.match(coreResult(run(), S, (s) => s), /Done after 5 s/);
  assert.match(coreResult(run({ status: "waiting", level: 3, reason: "deletes files" }), S, (s) => s), /needs the owner's OK \(deletes files\).*Don't retry/s);
  assert.match(coreResult(run({ status: "failed", exit: 2 }), S, (s) => s), /Failed \(exit code 2\)/);
  assert.match(coreResult(run({ status: "running", endedAt: null }), S, (s) => s, Date.parse("2026-11-21T10:01:00Z")), /Still running after 60 s/);
  assert.match(coreResult(run({ snapshot: "tabc1234", level: 2 }), S, (s) => s), /Undo/);
  assert.ok(!coreResult(run({ private: true, output: "dear diary" }), S, (s) => s).includes("diary"));
});

test("snapshotPlan: whole connected folder for scripts, named files otherwise, null across folders", () => {
  const F = ["C:\\Games", "C:\\Games\\pet", "D:\\R"];
  assert.deepEqual(snapshotPlan(["*"], "C:\\Games\\pet\\src", F, normPath), { root: "C:\\Games\\pet", whole: true, rels: [] });
  assert.deepEqual(snapshotPlan(["c:/games/pet/src/a.lua", "c:/games/pet/b.txt"], "C:\\Games\\pet", F, normPath), { root: "C:\\Games\\pet", whole: false, rels: ["src/a.lua", "b.txt"] });
  assert.equal(snapshotPlan(["d:/r/x"], "C:\\Games\\pet", F, normPath), null);
  assert.equal(snapshotPlan(["*"], "C:\\Elsewhere", F, normPath), null);
});

test("undoPlan: restores every snapshotted file, moves new ones away (never deletes)", () => {
  const m = { id: "t1", at: "", root: "/p", whole: true, command: "x", missing: [], files: [{ rel: "a", size: 1, mtime: 1 }] };
  assert.deepEqual(undoPlan(m, [{ rel: "a", size: 2, mtime: 2 }, { rel: "new.txt", size: 1, mtime: 1 }]), { restore: ["a"], moveAway: ["new.txt"] });
  const n = { ...m, whole: false, missing: ["out/new"], files: [] };
  assert.deepEqual(undoPlan(n, [{ rel: "out/New", size: 1, mtime: 1 }]), { restore: [], moveAway: ["out/new"] });
});

test("parseState: PowerShell JSON, cmd lines, bash NUL-separated", () => {
  assert.deepEqual(parseState("powershell", "\uFEFFC:\\p\\src\r\n", '{"A":"1","GITHUB_TOKEN":"x"}'), { cwd: "C:\\p\\src", env: { A: "1" } });
  assert.deepEqual(parseState("cmd", "C:\\p\r\n", "A=1\r\nB=x=y\r\n__ORBIT_EC=0\r\n"), { cwd: "C:\\p", env: { A: "1", B: "x=y" } });
  assert.deepEqual(parseState("bash", "/p\n", "A=1\0PWD=/p\0B=two\nlines\0"), { cwd: "/p", env: { A: "1", B: "two\nlines" } });
  assert.deepEqual(parseState("bash", null, null), { cwd: null, env: null });
});

test("bash wrapper keeps cd and export between commands (real bash)", { skip: process.platform === "win32" || !existsSync("/bin/bash") }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "orbit-term-")), st = path.join(dir, "st");
  let cwd = dir, env: Record<string, string> = cleanEnv(process.env);
  const step = (cmd: string) => {
    const w = wrap("bash", cmd, cwd, st, false);
    let out = "", code = 0;
    try { out = execFileSync(w.file, w.args, { cwd, env: env as unknown as NodeJS.ProcessEnv, encoding: "utf8" }); } catch (e) { code = (e as { status: number }).status; out = String((e as { stdout: string }).stdout); }
    const s = parseState("bash", readFileSync(st + ".cwd", "utf8"), readFileSync(st + ".env", "utf8"));
    if (s.cwd) cwd = s.cwd; if (s.env) env = s.env;
    return { out, code };
  };
  execFileSync("mkdir", [path.join(dir, "sub")]);
  step("cd sub");
  assert.equal(cwd, path.join(dir, "sub"));
  step("export TERM_TEST_X=hello");
  assert.equal(step("printenv TERM_TEST_X").out.trim(), "hello");
  assert.equal(step("false").code, 1);
  assert.equal(step("pwd").out.trim(), path.join(dir, "sub"));
});

test("PowerShell and cmd wrappers: encoded script and a batch file with call", () => {
  const p = wrap("powershell", "git status", "C:\\it's", "C:\\t\\r1", true);
  assert.equal(p.file, "powershell.exe");
  const script = Buffer.from(p.args.at(-1)!, "base64").toString("utf16le");
  assert.match(script, /Set-Location -LiteralPath 'C:\\it''s'\ngit status\n/);
  assert.ok(p.args.includes("-NonInteractive") && p.args.includes("-NoProfile"));
  const c = wrap("cmd", "npm test", "C:\\p", "C:\\t\\r1", true);
  assert.match(c.batch!, /cd \/d "C:\\p" \|\| exit \/b 97\r\ncall npm test\r\n/);
});
