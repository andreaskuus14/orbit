#!/usr/bin/env node
// ORBIT test runner: runs ONE test request for the builder, as the orbit-test account. That account has no model credential,
// can't open the builder's or the supervisor's folders or ORBIT's data, and has no network but its own loopback (a private
// network namespace on Linux, a per-user firewall rule on Windows). Started only by the supervisor's broker, once per request:
//   node --experimental-strip-types test-run.ts <request.json> <bundle|-> <mirror.git> <work root> <node_modules dir> <result.json>
// Model-written code runs here and nowhere else. Its own result is not trusted for release: the supervisor's policy check, CI on
// the exact commit and the owner's approval decide. This only keeps secrets and spending settings out of its reach.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { TEST_KINDS, redact, testRequestProblem, type TestRequest } from "./policy.ts";

const [reqFile, bundle, mirror, workRoot, modules, out] = process.argv.slice(2);
const win = process.platform === "win32";
type Step = { name: string; ok: boolean; code: number | null; tail: string; failing?: string[] };
const steps: Step[] = [];
const shots: string[] = [];
let req: TestRequest | null = null;

function finish(ok: boolean, reason?: string): never {
  // Written once (wx): an earlier file under this name, or a second write, fails instead of replacing a result.
  writeFileSync(out, JSON.stringify({ id: req?.id ?? null, commit: req?.commit ?? null, kind: req?.kind ?? null, ok, reason: reason ?? null, steps, shots, at: new Date().toISOString(), user: userInfo().username }), { flag: "wx" });
  process.exit(ok ? 0 : 1);
}

try {
  if (!out) throw new Error("usage: test-run.ts <request.json> <bundle|-> <mirror.git> <work root> <node_modules dir> <result.json>");
  const raw = JSON.parse(readFileSync(reqFile, "utf8").replace(/^﻿/, ""));
  const problem = testRequestProblem(raw);
  if (problem) { req = null; finish(false, `request refused: ${problem}`); }
  req = raw as TestRequest;
  const r = req;
  const task = path.join(workRoot, r.task), repo = path.join(task, "repo"), home = path.join(task, "home");
  for (const d of [home, path.join(home, "AppData", "Roaming"), path.join(home, "AppData", "Local"), path.join(home, "tmp"), path.join(task, "data"),
    path.join(home, "AppData", "Local", "Packages", "orbit.test.runner", "AC", "Temp")]) mkdirSync(d, { recursive: true }); // Windows points an AppContainer's TEMP here

  // Built from nothing, never inherited: no model, GitHub, proxy or Supabase variable can reach a test.
  const keep = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "windir", "LANG"];
  const ENV: Record<string, string> = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
  Object.assign(ENV, {
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"),
    TEMP: path.join(home, "tmp"), TMP: path.join(home, "tmp"), TMPDIR: path.join(home, "tmp"), npm_config_cache: path.join(home, "npm-cache"),
    npm_config_offline: "true", npm_config_update_notifier: "false", CI: "1", NEXT_TELEMETRY_DISABLED: "1",
    ORBIT_ISOLATED: "1", ORBIT_DATA_DIR: path.join(task, "data"), ORBIT_CLAUDE_BIN: path.join(task, "no-claude"),
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", NEXT_PUBLIC_SUPABASE_ANON_KEY: "isolated",
  });
  const gitcfg = path.join(task, "gitconfig");
  writeFileSync(gitcfg, `[safe]\n\tdirectory = *\n[core]\n\thooksPath = ${win ? "NUL" : "/dev/null"}\n\tfsmonitor = false\n[protocol]\n\tallow = never\n[protocol "file"]\n\tallow = always\n`);
  const GIT_ENV: Record<string, string> = { ...ENV, GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  const git = (args: string[], cwd = repo) => {
    const g = spawnSync("git", args, { cwd, env: GIT_ENV as NodeJS.ProcessEnv, encoding: "utf8", timeout: 300_000 });
    if (g.status !== 0) throw new Error(`git ${args[0]} failed: ${(g.stderr ?? "").slice(-400)}`);
    return (g.stdout ?? "").trim();
  };

  // A disposable checkout of exactly the requested commit (kept per task only to save the clone; cleaned every time).
  if (!existsSync(path.join(repo, ".git"))) git(["clone", "--quiet", "--no-checkout", mirror, repo], task);
  git(["fetch", "--quiet", mirror, "+refs/heads/*:refs/remotes/mirror/*"]);
  if (bundle !== "-") git(["fetch", "--quiet", bundle, `+refs/selfdev-test/${r.id}:refs/selfdev-test/${r.id}`]);
  git(["checkout", "--quiet", "--force", "--detach", r.commit]);
  git(["clean", "-qfdx", "-e", "/node_modules"]);
  if (git(["rev-parse", "HEAD"]) !== r.commit) finish(false, "checkout doesn't match the requested commit");
  // Dependencies: the builder's installed tree, read-only to this account (no install, no network, no install scripts here).
  if (!existsSync(path.join(repo, "node_modules"))) symlinkSync(modules, path.join(repo, "node_modules"), "junction");

  // Windows: every command runs inside an AppContainer with no capabilities (windows/orbit-sandbox.exe): no network, no loopback
  // to the host's services, no name resolution, files only where granted. Missing sandbox = no tests (fail closed).
  const sandbox = win ? path.join(import.meta.dirname, "windows", "orbit-sandbox.exe") : null;
  if (sandbox && !existsSync(sandbox)) finish(false, "the Windows test sandbox (orbit-sandbox.exe) is missing: run install-test-runner.ps1; no test runs without it");
  if (win && r.kind === "screens") finish(false, "screens isn't available on Windows yet: a browser outside the sandbox can't reach a sandboxed server");
  const boxed = (argv: string[]) => (sandbox ? [sandbox, "--cwd", repo, "--", ...argv] : argv);
  const node = process.execPath;
  const npm = (args: string[]) => (win ? ["cmd.exe", "/d", "/s", "/c", "npm.cmd", ...args] : ["npm", ...args]);
  const cmds: Record<string, string[][]> = {
    // Windows: test files run in one process inside the sandbox (per-file child processes talk over IPC pipes the AppContainer can't open)
    focused: [[node, "--test", ...(win ? [process.allowedNodeEnvironmentFlags.has("--test-isolation") ? "--test-isolation=none" : "--experimental-test-isolation=none"] : []), "--experimental-strip-types", "--import", "./scripts/test-guard.mjs", ...r.files]],
    typecheck: [[node, "node_modules/typescript/bin/tsc", "--noEmit", "-p", "."]],
    test: [npm(["test"])],
    gate: [npm(["run", "gate"])],
    screens: [[node, "node_modules/next/dist/bin/next", "build"]],
  };
  const deadline = Date.now() + TEST_KINDS[r.kind] * 1000;
  for (const argv of cmds[r.kind]) {
    const run = boxed(argv);
    const p = spawnSync(run[0], run.slice(1), { cwd: repo, env: ENV as NodeJS.ProcessEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: Math.max(10_000, deadline - Date.now()), maxBuffer: 256 << 20 });
    const text = `${p.stdout ?? ""}${p.stderr ?? ""}${p.error ? `\n${p.error.message}` : ""}`;
    // the failing test names in full (the tail may cut them off): the builder turns failures on main into tasks
    const failing = [...new Set([...text.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => redact(m[1].trim()).slice(0, 200)))].slice(0, 50);
    steps.push({ name: `${argv.slice(0, 4).map((a) => path.basename(a)).join(" ")}${sandbox ? " (AppContainer)" : ""}`, ok: p.status === 0, code: p.status, tail: redact(text.slice(-4000)), failing });
    if (p.status !== 0) finish(false, p.error ? p.error.message : `exit ${p.status}`);
  }
  if (r.kind === "screens") await screens(r, repo, ENV);
  finish(true);
} catch (e) {
  if ((e as { code?: string }).code === "EEXIST") process.exit(1);
  finish(false, redact(e instanceof Error ? e.message : String(e)));
}

/** The isolated app (dummy Supabase, own data folder) on loopback, public pages only; screenshots next to the result. */
async function screens(r: TestRequest, repo: string, ENV: Record<string, string>) {
  const port = Number(process.env.ORBIT_TEST_PORT || 3320), url = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: repo, env: { ...ENV, NODE_ENV: "production" } as NodeJS.ProcessEnv, stdio: "ignore" });
  try {
    for (let i = 0; i < 60 && !(await fetch(`${url}/api/health`).then((x) => x.ok).catch(() => false)); i++) await new Promise((x) => setTimeout(x, 1000));
    const { chromium } = await import(path.join(repo, "node_modules", "playwright-core", "index.mjs"));
    const b = await chromium.launch({ executablePath: process.env.ORBIT_TEST_CHROME || undefined, headless: true, env: ENV });
    const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs: string[] = [];
    pg.on("pageerror", (e: Error) => errs.push(e.message));
    const seen: string[] = [];
    for (const p of ["/login", "/demo"]) {
      const resp = await pg.goto(url + p, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => null);
      const f = out.replace(/\.json$/, `.${p.slice(1)}.png`);
      await pg.screenshot({ path: f });
      shots.push(f);
      seen.push(`${p} HTTP ${resp?.status() ?? "none"}`);
    }
    await b.close();
    const ok = seen.every((x) => /HTTP 200/.test(x)) && !errs.length;
    steps.push({ name: "browser (isolated instance, public pages only)", ok, code: ok ? 0 : 1, tail: redact(`${seen.join(", ")}${errs.length ? `; page errors: ${errs.slice(0, 3).join(" | ")}` : ""}`) });
    if (!ok) finish(false, "browser check failed");
  } finally { srv.kill(); }
  void r;
}
