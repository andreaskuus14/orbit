// CODE SANDBOX policy (sandbox-pure.ts) + the real Python/JS harnesses when an interpreter with numpy is on this machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { csvTable, cut, endOf, fileRefusal, inName, langOf, limitsFrom, outName, outputsOf, pickFiles, resultText, sandboxEnv, saveTarget, serveHeaders, codeOf, SANDBOX_LEVEL, DEFAULT_LIMITS } from "../src/lib/sandbox-pure.ts";

test("limits are clamped and CPU time follows the wall time", () => {
  assert.deepEqual(limitsFrom({}), DEFAULT_LIMITS);
  assert.deepEqual(limitsFrom({ timeout_sec: 999, memory_mb: 99_999 }), { wallSec: 120, cpuSec: 120, memoryMb: 2048, outMb: 50 });
  assert.deepEqual(limitsFrom({ timeout_sec: 1, memory_mb: 1 }), { wallSec: 5, cpuSec: 5, memoryMb: 256, outMb: 50 });
  assert.equal(limitsFrom({ timeout_sec: "abc" }).wallSec, 60);
});

test("language and code checks", () => {
  assert.equal(langOf(undefined), "python");
  assert.equal(langOf("JavaScript"), "js");
  assert.equal(langOf("ruby"), null);
  assert.ok("error" in codeOf(""));
  assert.ok("error" in codeOf("x".repeat(100_001)));
  assert.ok("code" in codeOf("print(1)"));
});

test("journal / LIFE and ORBIT data files never go in", () => {
  for (const n of ["journal.txt", "my-journal-2026.md", "Diary entries.csv", "päevik.md", "life.json", "LIFE export.csv", "mood_log.csv", "health.csv", "habits.csv", "obsidian-export.zip", ".meta.json", ".index.json", "../x.csv", "a/b.csv"])
    assert.ok(fileRefusal(n), `${n} should be refused`);
  for (const n of ["sales.csv", "lifecycle.csv", "budget 2026.xlsx", "views.csv", "wildlife-counts.csv"]) assert.equal(fileRefusal(n), "", `${n} should be allowed`);
  assert.ok(fileRefusal("notes.txt", "hello ojx1:abc:def"), "sealed journal text is refused by content");
});

test("only attached files or named VAULT files", () => {
  assert.deepEqual(pickFiles(undefined, [], []), { files: [] });
  assert.deepEqual(pickFiles(["a.csv", "b.csv"], ["a.csv"], ["b.csv", "a.csv"]), { files: [{ name: "a.csv", from: "attached" }, { name: "b.csv", from: "vault" }] });
  const miss = pickFiles(["secret.csv"], [], ["x.csv"]);
  assert.ok("error" in miss && /secret\.csv/.test(miss.error));
  assert.ok("error" in pickFiles(["journal.csv"], ["journal.csv"], []), "a journal file is refused even when attached");
  assert.ok("error" in pickFiles("a.csv", [], []));
  assert.ok("files" in pickFiles(["sales-2026.csv"], [], ["sales-2026.csv"], "make a chart of my sales file"), "a word of the name counts as naming it");
  const unnamed = pickFiles(["bank-statement.csv"], [], ["bank-statement.csv"], "summarise this page");
  assert.ok("error" in unnamed && /doesn't name it/.test(unnamed.error), "text from a page can't pull an unnamed VAULT file in");
  assert.ok("files" in pickFiles(["data.csv"], ["data.csv"], [], "chart it"), "attachments need no naming");
  assert.ok("error" in pickFiles(Array.from({ length: 11 }, (_, i) => `f${i}.csv`), [], []));
  assert.equal(inName("main.py"), "input-main.py");
  assert.equal(inName(".hidden"), "_hidden");
});

test("outputs: new or changed files with allowed types, not the code or inputs", () => {
  const t0 = 1000;
  const out = outputsOf([
    { name: "main.py", size: 10, mtimeMs: 2000 }, { name: "chart.png", size: 100, mtimeMs: 2000 }, { name: "sales.csv", size: 50, mtimeMs: 500 },
    { name: "clean.csv", size: 40, mtimeMs: 2000 }, { name: "run.exe", size: 40, mtimeMs: 2000 }, { name: ".limits.json", size: 4, mtimeMs: 2000 }, { name: "empty.txt", size: 0, mtimeMs: 2000 },
  ], t0, ["sales.csv"]);
  assert.deepEqual(out.map((f) => f.name), ["chart.png", "clean.csv"]);
});

test("serving: script-less CSP and nosniff, SVG included", () => {
  const h = serveHeaders("chart.svg");
  assert.equal(h["Content-Type"], "image/svg+xml");
  assert.match(h["Content-Security-Policy"], /sandbox/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.match(serveHeaders("a.xlsx")["Content-Disposition"], /^attachment/);
  assert.equal(outName("../etc.png"), null);
  assert.equal(outName("a.html"), null);
  assert.equal(outName("chart.png"), "chart.png");
});

test("CSV preview becomes a Markdown table", () => {
  const t = csvTable('name,value\n"a, b",1\nc,2\n', 10);
  assert.equal(t.split("\n")[0], "| name | value |");
  assert.match(t, /\| a, b \| 1 \|/);
  assert.match(csvTable("a\tb\n1\t2", 10), /\| 1 \| 2 \|/);
  assert.match(csvTable(Array.from({ length: 30 }, (_, i) => `${i}`).join("\n"), 5), /\(24 more rows\)/);
});

test("exit → plain status; result text links each chart for the chat", () => {
  assert.equal(endOf(0, null, false, false, "", 10).status, "ok");
  assert.equal(endOf(124, null, false, false, "", 10).status, "timeout");
  assert.equal(endOf(1, null, false, false, "MemoryError", 10).status, "memory");
  assert.equal(endOf(null, "SIGKILL", false, true, "", 10).status, "stopped");
  const r = resultText({ id: "sbabc12345", lang: "python", end: { status: "ok", exitCode: 0, ms: 1200 }, stdout: "mean 3", stderr: "", outputs: [{ name: "chart.png", size: 9, mtimeMs: 1 }, { name: "t.csv", size: 9, mtimeMs: 1 }], inputs: ["sales.csv"], previews: { "t.csv": "| a |" }, limits: DEFAULT_LIMITS });
  assert.match(r, /^!\[chart\.png\]\(\/api\/sandbox\/file\?run=sbabc12345&name=chart\.png\)$/m);
  assert.match(r, /no network/);
  assert.match(cut("x".repeat(100), 20), /cut/);
});

test("the child's environment carries nothing of ORBIT's", () => {
  const env = sandboxEnv({ ANTHROPIC_API_KEY: "k", HTTPS_PROXY: "http://p", SUPABASE_SERVICE_ROLE_KEY: "s", SYSTEMROOT: "C:\\Windows" }, "C:\\t\\sb1", true, "C:\\py");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.SYSTEMROOT, "C:\\Windows");
  assert.equal(env.PATH, "C:\\py");
  assert.equal(sandboxEnv({ SYSTEMROOT: "x" }, "/t", false, "/usr/bin").SYSTEMROOT, undefined);
});

test("save target and level", () => {
  assert.deepEqual(saveTarget({ run: "sbabc12345", name: "chart.png", as: "Sales chart" }), { run: "sbabc12345", name: "chart.png", as: "Sales chart.png" });
  assert.ok("error" in saveTarget({ run: "x", name: "chart.png" }));
  assert.ok("error" in saveTarget({ run: "sbabc12345", name: "../a.png" }));
  assert.equal(SANDBOX_LEVEL, 1);
});

// The real harnesses: only where an interpreter is here (CI/dev Linux has python3 + numpy; Windows uses the venv from setup.ps1).
const py = ["/usr/bin/python3", "/usr/local/bin/python3"].find((p) => existsSync(p) && spawnSync(p, ["-I", "-c", "import numpy, pandas, matplotlib"]).status === 0);
const harness = (f: string) => path.join(process.cwd(), "tools", "sandbox", f);
function runIn(code: string, file: string, cmd: (dir: string) => [string, string[]]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orbit-sbtest-"));
  writeFileSync(path.join(dir, file), code);
  writeFileSync(path.join(dir, ".limits.json"), JSON.stringify({ memoryMb: 1024, cpuSec: 20, wallSec: 20 }));
  const [bin, args] = cmd(dir);
  const r = spawnSync(bin, args, { cwd: dir, env: sandboxEnv(process.env, dir, process.platform === "win32", path.dirname(bin)) as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });
  const files = readdirSync(dir);
  rmSync(dir, { recursive: true, force: true });
  return { out: `${r.stdout}${r.stderr}`, code: r.status, files };
}

test("Python harness: pandas + a chart work; network, programs and outside files are refused", { skip: !py && "no python3 with numpy here" }, () => {
  const code = [
    "import pandas as pd, matplotlib.pyplot as plt",
    "df = pd.DataFrame({'x': [1, 2, 3], 'y': [2, 4, 9]}); print('mean', df.y.mean()); df.plot(x='x', y='y')",
    "for bad in ['import socket; socket.create_connection((\"1.1.1.1\", 80))', 'import subprocess; subprocess.run([\"id\"])', 'open(\"/etc/hostname\").read()', 'open(\"/tmp/orbit-sb-escape.txt\", \"w\")', '__import__(\"ctypes\").CDLL(None)', 'import os; os.system(\"id\")']:",
    "    try:\n        exec(bad); print('OPEN', bad)\n    except PermissionError:\n        print('blocked')",
  ].join("\n");
  const r = runIn(code, "main.py", (d) => [py!, ["-I", harness("run.py"), path.join(d, ".limits.json")]]);
  assert.match(r.out, /mean 5\.0/);
  assert.doesNotMatch(r.out, /OPEN/);
  assert.equal((r.out.match(/blocked/g) ?? []).length, 6, r.out);
  assert.ok(r.files.includes("figure-1.png"), "an unsaved figure is saved as figure-1.png");
  assert.equal(existsSync("/tmp/orbit-sb-escape.txt"), false);
});

test("Python harness: the time limit stops a busy loop", { skip: !py && "no python3 with numpy here" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orbit-sbtest-"));
  writeFileSync(path.join(dir, "main.py"), "while True: pass\n");
  writeFileSync(path.join(dir, ".limits.json"), JSON.stringify({ memoryMb: 512, cpuSec: 10, wallSec: 2, preload: [] }));
  const t = Date.now();
  const r = spawnSync(py!, ["-I", harness("run.py"), path.join(dir, ".limits.json")], { cwd: dir, encoding: "utf8", timeout: 30_000 });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 124);
  assert.ok(Date.now() - t < 15_000);
});

const permFlag = process.allowedNodeEnvironmentFlags.has("--permission") ? "--permission" : "--experimental-permission";
test("JS harness: plain JS works; fetch, network modules, child processes and outside files are refused", () => {
  const code = [
    "console.log('sum', [1, 2, 3].reduce((a, b) => a + b, 0));",
    "const t = { fetch: () => fetch('https://example.com'), net: () => require('net'), cp: () => require('child_process'), builtin: () => process.getBuiltinModule('net'),",
    "  read: () => require('fs').readFileSync('/etc/hostname'), write: () => require('fs').writeFileSync('/tmp/orbit-sb-escape-js.txt', 'x'), imp: () => import('node:net') };",
    "for (const [k, f] of Object.entries(t)) { try { await f(); console.log('OPEN', k); } catch { console.log('blocked'); } }",
    "require('fs').writeFileSync('out.csv', 'a,b\\n1,2\\n');",
  ].join("\n");
  const r = runIn(code, "main.js", (d) => [process.execPath, [permFlag, `--allow-fs-read=${d}`, `--allow-fs-read=${harness("run.mjs")}`, `--allow-fs-write=${d}`, "--max-old-space-size=256", harness("run.mjs"), path.join(d, ".limits.json")]]);
  assert.match(r.out, /sum 6/);
  assert.doesNotMatch(r.out, /OPEN/, r.out);
  assert.equal((r.out.match(/blocked/g) ?? []).length, 7, r.out);
  assert.ok(r.files.includes("out.csv"));
  assert.equal(existsSync("/tmp/orbit-sb-escape-js.txt"), false);
});
