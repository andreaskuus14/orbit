#!/usr/bin/env node
// ORBIT release supervisor. Runs outside the app, under its own account, from its own installed copy:
//   node --experimental-strip-types supervisor.ts <command>
// Commands: watch | once | status | adopt | stop | pause | resume | clear | restore [releaseId] | verify-audit
// It is the only thing that merges to main, installs a build, or rolls one back. The builder only drops a
// submission (JSON + git bundle) into inbox/; the app may drop control requests (pause/stop/restore) there.
// Everything that changes state is journaled in state.json before and after, so a restart resumes the same step
// instead of repeating a finished one. See README.md for the trust boundary.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import {
  cpSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, renameSync, rmSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { appendAudit, readAudit, verifyAudit } from "./audit.ts";
import {
  DEFAULT_POLICY, TEST_KINDS, afterFailure, approvalProblem, approvalTimedOut, checksVerdict, inboxControl, testRequestProblem, modeViolations, orbitStopAllOn, weakenedTests, countErrors, parseNumstat, policyViolations, probeProblems, redact, releaseBlocked, submissionProblem, utcDay,
  type Day, type Policy, type Probe, type Submission,
} from "./policy.ts";

type Cmd = string[]; // argv; {commit} {stage} {live} are substituted
type Config = {
  repoUrl: string; mainBranch: string; liveDir: string; distDir: string; stageDir: string;
  healthUrl: string; serverLog: string | null;
  // install: when set, an owner-context command does the live checkout + swap + restart ({commit} {dist} {live});
  // on Windows the supervisor (SYSTEM) must never run git or scripts in the owner-writable live folder itself.
  commands: { build: Cmd; stop: Cmd; start: Cmd; install?: Cmd; stopBuilder?: Cmd };
  // requiredChecks: CI check-run names that must succeed on the exact commit. GitHub branch protection isn't available on this
  // repo's plan, so this is the only place "CI must pass" is enforced; it holds because only the supervisor can write to main.
  github: { repo: string; tokenFile: string; checksTimeoutSec: number; requiredChecks: string[] } | null;
  allowWithoutExternalChecks?: boolean; // drills only: no CI to wait for
  enabled?: boolean; // unattended releases; off unless set (install.ps1 writes false). Only gates NEW submissions: Pause/STOP hold one in progress
  // The builder's tests run as orbit-test, never as the builder: it drops <id>.json (+ <id>.bundle) in reqDir, this starts `command`
  // ({req} {bundle} {out} {id} {kind}: on Windows trigger-test.ps1, which runs the "ORBIT Test Runner" task) and the result lands in outDir.
  testRunner?: { reqDir: string; outDir: string; command: Cmd };
  approvalTimeoutSec?: number; // a release that passed CI waits this long for the owner's approval (default 3 days), then is rejected
  stopAllFile?: string; // ORBIT's stop-all.json: when on (or unreadable), nothing new is released
  workflowChecks: { name: string; url: string; expect: number }[];
  monitor: { probes: number; intervalSec: number; maxErrors: number; startupTimeoutSec: number };
  dataBackup: { paths: string[]; maxBytes: number };
  keepReleases: number; pollSec: number; policy?: Partial<Policy>;
  buildTimeoutSec?: number; // a fresh npm ci + next build; Windows with antivirus is slow
};
type Step = "accepted" | "fetched" | "approved" | "pushed" | "checked" | "ownerApproved" | "merged" | "built" | "snapshotted" | "backedUp" | "installing" | "installed" | "retained"
  | "failed" | "rolledBack" | "halted" | "rejected";
type Release = {
  id: string; sub: Submission; step: Step; prev: string | null; startedAt: string; updatedAt: string;
  pr?: string; diffStat?: { files: number; lines: number }; reason?: string; rollbacks: number; probes: string[]; mainBefore?: string;
};
type Good = { id: string; commit: string; at: string };
type State = {
  released: Good | null; retained: Good[]; current: Release | null; history: Release[];
  paused: boolean; halted: string | null; day: Day;
};

const HOME = path.resolve(process.env.ORBIT_SUPERVISOR_HOME || path.join(process.env.ProgramData || "/var/lib", "orbit-supervisor"));
const P = {
  config: path.join(HOME, "config.json"), state: path.join(HOME, "state.json"), audit: path.join(HOME, "audit.jsonl"),
  stop: path.join(HOME, "STOP"), lock: path.join(HOME, "supervisor.lock"), inbox: path.join(HOME, "inbox"),
  mirror: path.join(HOME, "mirror.git"), releases: path.join(HOME, "releases"), pub: path.join(HOME, "public"),
  ctl: path.join(HOME, "ctl"), // owner commands (admin-only folder): clear / resume / pause / stop / restore for the running watcher
};

// Windows PowerShell 5.1 writes UTF-8 with a byte-order mark (Set-Content -Encoding UTF8); JSON.parse rejects it.
const readJsonFile = (f: string) => JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const cfg: Config = readJsonFile(P.config);
const policy: Policy = { ...DEFAULT_POLICY, ...cfg.policy };
const now = () => new Date().toISOString();
const log = (m: string) => console.log(`${now()} [supervisor] ${redact(m)}`);
const audit = (event: string, data: Record<string, unknown> = {}) => appendAudit(P.audit, event, JSON.parse(redact(JSON.stringify(data))));

function load(): State {
  try { return readJsonFile(P.state) as State; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // a damaged state file stops the supervisor; it never starts fresh over it
    return { released: null, retained: [], current: null, history: [], paused: false, halted: null, day: { day: utcDay(Date.now()), releases: 0, costUsd: 0 } };
  }
}
function save(s: State) {
  writeFileSync(P.state + ".tmp", JSON.stringify(s, null, 1));
  renameSync(P.state + ".tmp", P.state);
  publish(s);
}
function step(s: State, r: Release, to: Step, data: Record<string, unknown> = {}) {
  r.step = to; r.updatedAt = now();
  save(s);
  audit(`release.${to}`, { release: r.id, commit: r.sub.commit, ...data });
  log(`${r.id}: ${to}${data.reason ? ` (${data.reason})` : ""}`);
}

function run(argv: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutSec?: number; input?: string } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd: opts.cwd, env: { ...process.env, ...opts.env }, encoding: "utf8", timeout: (opts.timeoutSec ?? 600) * 1000, input: opts.input, maxBuffer: 64 << 20, shell: false });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: `${r.stderr ?? ""}${r.error ? ` ${r.error.message}` : ""}`.trim() };
}
function must(argv: string[], opts: Parameters<typeof run>[1] = {}) {
  const r = run(argv, opts);
  if (!r.ok) throw new Error(`${argv.slice(0, 3).join(" ")} failed: ${r.err.slice(-800)}`);
  return r.out;
}
const sub = (argv: Cmd, v: Record<string, string>) => argv.map((a) => a.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m));

// Git credentials: the token goes in through the environment (never argv, never a remote URL on disk).
function gitEnv(): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
  if (cfg.github) {
    const tok = readFileSync(cfg.github.tokenFile, "utf8").trim();
    Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${tok}`).toString("base64")}` });
  }
  return env;
}
const git = (args: string[], cwd = P.mirror) => must(["git", ...args], { cwd, env: gitEnv() });

async function gh(method: string, url: string, body?: unknown) {
  const tok = readFileSync(cfg.github!.tokenFile, "utf8").trim();
  const r = await fetch(`https://api.github.com/repos/${cfg.github!.repo}${url}`, {
    method, headers: { authorization: `Bearer ${tok}`, accept: "application/vnd.github+json", "user-agent": "orbit-supervisor" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${url}: ${r.status}`);
  return r.json();
}

function mirrorReady() {
  // install.ps1 creates the folder empty (so the read grants are inherited); clone into it once.
  if (!existsSync(path.join(P.mirror, "HEAD"))) must(["git", "clone", "--bare", "--quiet", cfg.repoUrl, P.mirror], { env: gitEnv() });
  git(["fetch", "--quiet", "--prune", "origin", `+refs/heads/${cfg.mainBranch}:refs/heads/${cfg.mainBranch}`]);
  return git(["rev-parse", cfg.mainBranch]);
}

// ---------- artifacts and data ----------
const relDir = (id: string) => path.join(P.releases, id);
const distOf = (dir: string) => path.join(dir, cfg.distDir);
function snapshotDist(from: string, id: string) {
  const to = path.join(relDir(id), "dist");
  rmSync(to, { recursive: true, force: true });
  // The build ran as the untrusted build account: never follow a link it left (it could point at the token or another account's files).
  cpSync(from, to, { recursive: true, dereference: false, filter: (src) => !lstatSync(src).isSymbolicLink() && !src.includes(`${path.sep}cache${path.sep}`) && !src.endsWith(`${path.sep}cache`) });
  if (!existsSync(path.join(to, "BUILD_ID"))) throw new Error("artifact has no BUILD_ID");
  return to;
}
function hashTree(dir: string, base = dir, out: Record<string, string> = {}, budget = { bytes: 0 }) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // links and junctions are skipped, never followed (the supervisor reads with more rights than their owner)
    if (e.isDirectory()) hashTree(p, base, out, budget);
    else if (e.isFile() && !e.name.endsWith(".tmp")) {
      budget.bytes += statSync(p).size;
      if (budget.bytes > cfg.dataBackup.maxBytes) throw new Error(`data to back up exceeds ${cfg.dataBackup.maxBytes} bytes`);
      out[path.relative(base, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  }
  return out;
}
/** Copy the data folders, then prove the copy restores: restore into a scratch folder and compare every hash. */
function backupData(id: string) {
  const to = path.join(relDir(id), "data");
  rmSync(to, { recursive: true, force: true });
  const report: { path: string; files: number }[] = [];
  const hashes: Record<string, string>[] = [];
  cfg.dataBackup.paths.forEach((src, i) => {
    const dst = path.join(to, String(i));
    if (existsSync(src)) cpSync(src, dst, { recursive: true, dereference: false, filter: (f) => !f.endsWith(".tmp") && !lstatSync(f).isSymbolicLink() });
    const before = hashTree(dst); // the backup against its own restore: the app may keep writing the source meanwhile
    const scratch = path.join(HOME, `restore-drill-${randomUUID()}`);
    try {
      if (existsSync(dst)) cpSync(dst, scratch, { recursive: true });
      const restored = hashTree(scratch);
      const diff = Object.keys(before).filter((k) => before[k] !== restored[k]);
      if (diff.length || Object.keys(restored).length !== Object.keys(before).length) throw new Error(`restore check failed for ${src}: ${diff.slice(0, 3).join(", ")}`);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    report.push({ path: src, files: Object.keys(before).length });
    hashes.push(before);
  });
  writeFileSync(path.join(relDir(id), "data-manifest.json"), JSON.stringify({ at: now(), paths: cfg.dataBackup.paths, hashes }));
  return report;
}
/** Files in the data folders that differ from the pre-install backup: what the failed release wrote (or the app wrote meanwhile). */
function dataWrittenSince(id: string): string[] {
  try {
    const m = readJsonFile(path.join(relDir(id), "data-manifest.json")) as { paths: string[]; hashes?: Record<string, string>[] };
    const out: string[] = [];
    m.paths.forEach((src, i) => {
      const was = m.hashes?.[i] ?? {}, now_ = hashTree(src);
      for (const k of new Set([...Object.keys(was), ...Object.keys(now_)])) if (was[k] !== now_[k]) out.push(`${path.basename(src)}/${k}${!(k in now_) ? " (deleted)" : !(k in was) ? " (new)" : ""}`);
    });
    return out;
  } catch (e) { return [`unknown (${e instanceof Error ? e.message : e})`]; }
}

// ---------- install, health ----------
// The supervisor's account doesn't own the live folder; git refuses that unless told the folder is trusted.
// Used only when no owner-context install command is configured (drills, same-user setups) and by `adopt`; hooks and fsmonitor off.
const liveGit = (args: string[]) => must(["git", "-c", `safe.directory=${cfg.liveDir.replace(/\\/g, "/")}`, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: cfg.liveDir });
function liveClean() {
  const r = liveGit(["status", "--porcelain", "--untracked-files=no"]);
  if (r) throw new Error(`the live folder has local changes; not touching it:\n${r.slice(0, 400)}`);
}
function install(commit: string, dist: string) {
  if (cfg.commands.install) { must(sub(cfg.commands.install, { commit, dist, live: cfg.liveDir }), { timeoutSec: 600 }); return; }
  liveClean();
  must(sub(cfg.commands.stop, { live: cfg.liveDir }), { cwd: cfg.liveDir, timeoutSec: 120 }); // a server that won't stop fails the install
  liveGit(["fetch", "--quiet", P.mirror, commit]);
  liveGit(["checkout", "--quiet", "-B", cfg.mainBranch, commit]);
  const live = distOf(cfg.liveDir);
  rmSync(live, { recursive: true, force: true });
  cpSync(dist, live, { recursive: true });
  // The launcher rebuilds when src/ is newer than BUILD_ID; the checkout just touched src/, so mark the build current.
  const t = new Date(); utimesSync(path.join(live, "BUILD_ID"), t, t);
  must(sub(cfg.commands.start, { live: cfg.liveDir }), { cwd: cfg.liveDir, timeoutSec: 120 });
}

/** One GET on a fresh connection. Pooled keep-alive connections would keep reaching a server that was just stopped. */
function httpGet(url: string, timeoutMs = 15_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { agent: false, headers: { connection: "close" }, timeout: timeoutMs }, (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (c) => { if (body.length < 1 << 16) body += c; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve({ status: 0, body: "" }));
  });
}
async function health(): Promise<{ ok: boolean; commit: string | null; uptimeSec: number | null }> {
  const r = await httpGet(cfg.healthUrl, 5000);
  try {
    const j = JSON.parse(r.body) as { ok?: boolean; commit?: string; uptimeSec?: number };
    return { ok: r.status === 200 && j.ok === true, commit: j.commit ?? null, uptimeSec: j.uptimeSec ?? null };
  } catch { return { ok: false, commit: null, uptimeSec: null }; }
}
function logSize() { try { return cfg.serverLog ? statSync(cfg.serverLog).size : 0; } catch { return 0; } }
function logSince(offset: number) {
  if (!cfg.serverLog) return "";
  try {
    const size = statSync(cfg.serverLog).size;
    if (size <= offset) return "";
    const fd = openSync(cfg.serverLog, "r"); const buf = Buffer.alloc(Math.min(size - offset, 4 << 20));
    readSync(fd, buf, 0, buf.length, offset); closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Startup, then `probes` checks spaced `intervalSec`: health, commit, restarts, new error lines, workflow pages. */
async function monitor(commit: string, r: Release | null): Promise<string[]> {
  const m = cfg.monitor;
  const offset = logSize();
  const deadline = Date.now() + m.startupTimeoutSec * 1000;
  // Startup = healthy AND serving this commit; anything else answering is still the old server.
  const up = (x: Awaited<ReturnType<typeof health>>) => x.ok && (!x.commit || x.commit === commit);
  let h = await health();
  while (!up(h) && Date.now() < deadline) { await sleep(2000); h = await health(); }
  if (!h.ok) return ["did not start: health check never passed"];
  if (!up(h)) return [`did not start: still serving ${h.commit?.slice(0, 7)}, not ${commit.slice(0, 7)}`];
  let prevUptime: number | null = null;
  for (let i = 0; i < m.probes; i++) {
    if (i) await sleep(m.intervalSec * 1000);
    h = await health();
    const failed: string[] = [];
    for (const w of cfg.workflowChecks) {
      const st = (await httpGet(w.url)).status;
      if (st !== w.expect) failed.push(`${w.name}: HTTP ${st}, expected ${w.expect}`);
    }
    const probe: Probe = { ...h, errors: countErrors(logSince(offset)), failedChecks: failed };
    const problems = probeProblems(probe, commit, prevUptime, m.maxErrors);
    r?.probes.push(`${now()} ${problems.length ? problems.join("; ") : "ok"}`);
    if (problems.length) return problems;
    prevUptime = h.uptimeSec;
  }
  return [];
}

// ---------- the release pipeline ----------
function readSubmission(file: string): Submission | string {
  try {
    const s = readJsonFile(file);
    return submissionProblem(s) ?? s;
  } catch (e) { return `unreadable: ${e instanceof Error ? e.message : e}`; }
}

async function advance(s: State) {
  const r = s.current!;
  const id = r.id;
  // Stop and Pause hold a release anywhere before the live app is touched; once installing it still finishes, monitors and recovers.
  if ((held() || s.paused) && !["installing", "installed", "failed"].includes(r.step)) return;
  try {
    if (r.step === "accepted") {
      const main = mirrorReady();
      if (s.released && git(["rev-parse", `${main}^{tree}`]) !== git(["rev-parse", `${s.released.commit}^{tree}`]))
        throw new Error(`main ${main.slice(0, 7)} doesn't match the released ${s.released.commit.slice(0, 7)}; adopt or restore first`);
      const bundle = path.join(P.inbox, `${id}.bundle`);
      git(["bundle", "verify", "--quiet", bundle]);
      git(["fetch", "--quiet", bundle, `+${r.sub.commit}:refs/selfdev/${id}`]);
      if (git(["merge-base", main, r.sub.commit]) !== main) throw new Error(`not based on the current main ${main.slice(0, 7)}`);
      r.mainBefore = main;
      step(s, r, "fetched");
    }
    if (r.step === "fetched") {
      const changes = parseNumstat(git(["diff", "--numstat", r.mainBefore!, r.sub.commit]));
      r.diffStat = { files: changes.length, lines: changes.reduce((n, c) => n + c.added + c.removed, 0) };
      const fullPatch = git(["diff", r.mainBefore!, r.sub.commit]);
      const v = [...policyViolations(changes, policy), ...modeViolations(git(["diff", "--raw", "--no-renames", r.mainBefore!, r.sub.commit])), ...weakenedTests(changes, fullPatch)];
      if (v.length) return reject(s, `release policy: ${v.join("; ")}`);
      mkdirSync(relDir(id), { recursive: true });
      const patch = fullPatch.slice(0, 400_000);
      writeFileSync(path.join(relDir(id), "diff.patch"), patch);
      mkdirSync(path.join(P.pub, "diffs"), { recursive: true });
      writeFileSync(path.join(P.pub, "diffs", `${id}.patch`), redact(patch));
      step(s, r, "approved", { files: r.diffStat.files, lines: r.diffStat.lines });
    }
    if (r.step === "approved") {
      git(["push", "--quiet", "origin", `${r.sub.commit}:refs/heads/${r.sub.branch}`]);
      if (cfg.github) {
        const owner = cfg.github.repo.split("/")[0];
        const open = (await gh("GET", `/pulls?state=all&head=${owner}:${encodeURIComponent(r.sub.branch)}`)) as { html_url: string }[];
        r.pr = open[0]?.html_url ?? ((await gh("POST", "/pulls", {
          head: r.sub.branch, base: cfg.mainBranch, title: `[self-dev] ${r.sub.title}`,
          body: `**Why:** ${r.sub.why}\n\n**Acceptance:**\n${r.sub.acceptance.map((a) => `- ${a}`).join("\n")}\n\n**Builder checks:** ${r.sub.checks.map((c) => `${c.name} ✓`).join(", ")}\n\nReleased by the ORBIT supervisor after CI passes on this exact commit. Release \`${id}\`.`,
        })) as { html_url: string }).html_url;
      }
      step(s, r, "pushed", { pr: r.pr ?? null });
    }
    if (r.step === "pushed") {
      if (cfg.github && !cfg.github.requiredChecks?.length) return reject(s, "no required CI checks configured (github.requiredChecks)");
      if (cfg.github) {
        const until = Date.now() + cfg.github.checksTimeoutSec * 1000;
        for (;;) {
          const runs = ((await gh("GET", `/commits/${r.sub.commit}/check-runs?per_page=100`)) as { check_runs: { name: string; status: string; conclusion: string | null }[] }).check_runs;
          const v = checksVerdict(cfg.github.requiredChecks, runs);
          if (v.state === "fail") return reject(s, `CI ${v.detail}`);
          if (v.state === "pass") break;
          if (Date.now() > until) return reject(s, `CI didn't pass in time (${v.detail})`);
          await sleep(20_000);
          await controls(s); // a pause or stop sent meanwhile holds the release before merge
          if (held() || s.paused) return;
        }
      } else if (!cfg.allowWithoutExternalChecks) return reject(s, "no external CI configured; unattended release refused");
      step(s, r, "checked", { externalChecks: cfg.github ? `${cfg.github.requiredChecks.join(", ")} passed on this exact commit` : "none configured (drill)" });
    }
    if (r.step === "checked") {
      // Owner approval before anything reaches main or the live app: `supervisor.ts approve <id> <commit>` (ctl/ only; see approve()).
      if (approvalTimedOut(r.updatedAt, Date.now(), cfg.approvalTimeoutSec ?? 3 * 86400)) return reject(s, "no owner approval in time; nothing was merged");
      return;
    }
    if (r.step === "ownerApproved") {
      const main = mirrorReady();
      if (main !== r.sub.commit) {
        if (main !== r.mainBefore) return reject(s, "main moved while this was being checked; resubmit on the new main");
        git(["push", "--quiet", "origin", `${r.sub.commit}:refs/heads/${cfg.mainBranch}`]); // fast-forward only: a non-FF push is refused
        git(["update-ref", `refs/heads/${cfg.mainBranch}`, r.sub.commit]);
      }
      step(s, r, "merged");
    }
    if (r.step === "merged") {
      const b = run(sub(cfg.commands.build, { commit: r.sub.commit, stage: cfg.stageDir, mirror: P.mirror }), { timeoutSec: cfg.buildTimeoutSec ?? 3600 });
      if (!b.ok) return reject(s, `build failed: ${redact(b.err.slice(-600))}`, true);
      step(s, r, "built");
    }
    if (r.step === "built") {
      snapshotDist(distOf(cfg.stageDir), id);
      const built = readFileSync(path.join(relDir(id), "dist", "BUILD_ID"), "utf8").trim();
      step(s, r, "snapshotted", { buildId: built });
    }
    if (r.step === "snapshotted") {
      const report = backupData(id);
      step(s, r, "backedUp", { data: report });
    }
    if (r.step === "backedUp") {
      await controls(s);
      if (held() || s.paused) return; // last point to hold before the live app is touched
      step(s, r, "installing"); // journaled first: a failure or crash from here on recovers instead of rejecting
    }
    if (r.step === "installing") {
      // Stopping the supervisor (Windows task stop) kills the install child first. Wait before recording a failure, so a
      // supervisor that is being stopped dies still journaled "installing" and its restart redoes the install instead of rolling back.
      try { install(r.sub.commit, path.join(relDir(id), "dist")); } catch (e) { await sleep(20_000); throw e; }
      step(s, r, "installed");
    }
    if (r.step === "installed") {
      r.probes = [];
      const problems = await monitor(r.sub.commit, r);
      if (problems.length) { r.reason = problems.join("; "); step(s, r, "failed", { reason: r.reason }); }
      else {
        s.released = { id, commit: r.sub.commit, at: now() };
        s.retained = [s.released, ...s.retained.filter((g) => g.id !== id)];
        finish(s, "retained");
        prune(s);
        return;
      }
    }
    if (r.step === "failed") await recover(s, r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Before install nothing live changed: reject. After, treat it as a failed release and recover.
    if (["installing", "installed", "failed"].includes(r.step)) { r.reason = msg; step(s, r, "failed", { reason: msg }); await recover(s, r); }
    else {
      // A push to main that errored may still have landed: ask the mirror rather than assume.
      let merged = ["merged", "built", "snapshotted", "backedUp"].includes(r.step);
      if (r.step === "ownerApproved") try { merged = mirrorReady() === r.sub.commit; } catch { merged = true; }
      reject(s, msg, merged);
    }
  }
}

/** Restore the previous good release. Counted before each try (a crash mid-rollback still counts); capped. */
async function recover(s: State, r: Release) {
  s.halted = `${r.id}: ${r.reason}`;
  save(s);
  while (true) {
    const prev = s.released;
    if (!prev) { finish(s, "halted", "no previous release to restore"); return; }
    if (afterFailure(r.rollbacks, policy) === "halt") { finish(s, "halted", `rollback failed ${r.rollbacks}×; waiting for the owner`); return; }
    r.rollbacks++;
    save(s);
    audit("rollback.start", { release: r.id, to: prev.id, attempt: r.rollbacks });
    try {
      install(prev.commit, path.join(relDir(prev.id), "dist"));
      const problems = await monitor(prev.commit, null);
      if (problems.length) throw new Error(problems.join("; "));
    } catch (e) { audit("rollback.failed", { release: r.id, attempt: r.rollbacks, reason: e instanceof Error ? e.message : String(e) }); continue; }
    audit("rollback.verified", { release: r.id, restored: prev.id, commit: prev.commit });
    // Data is never rolled back automatically: restoring the backup would drop everything written since. Record what changed.
    const written = dataWrittenSince(r.id);
    audit("rollback.data", { release: r.id, kept: "data folder left as is", changedSinceBackup: written.slice(0, 50), count: written.length, backup: path.join(relDir(r.id), "data") });
    // The live app is restored either way; a failed revert of main is reported, not retried as a rollback.
    let note = "";
    try { revertMain(prev.commit, r); } catch (e) { note = `; main NOT reverted (${e instanceof Error ? e.message : e})`; }
    finish(s, "rolledBack", `restored ${prev.id}; releases halted until the owner clears it${note}; data kept as is (${written.length} file${written.length === 1 ? "" : "s"} changed since the pre-install backup)`);
    return;
  }
}

/** Main returns to the restored code too, by a new commit with the old tree (history is kept, nothing is force-pushed). */
function revertMain(goodCommit: string, r: Release) {
  const main = mirrorReady();
  const goodTree = git(["rev-parse", `${goodCommit}^{tree}`]);
  if (git(["rev-parse", `${main}^{tree}`]) === goodTree) return main;
  const c = must(["git", "commit-tree", goodTree, "-p", main, "-m", `Revert self-dev release ${r.id} (failed after deploy: ${r.reason?.slice(0, 120)})`],
    { cwd: P.mirror, env: { ...gitEnv(), GIT_AUTHOR_NAME: "ORBIT supervisor", GIT_AUTHOR_EMAIL: "supervisor@orbit.local", GIT_COMMITTER_NAME: "ORBIT supervisor", GIT_COMMITTER_EMAIL: "supervisor@orbit.local" } });
  git(["push", "--quiet", "origin", `${c}:refs/heads/${cfg.mainBranch}`]);
  git(["update-ref", `refs/heads/${cfg.mainBranch}`, c]); // the builder reads main from this mirror
  audit("main.reverted", { release: r.id, commit: c });
  return c;
}

function reject(s: State, reason: string, merged = false) {
  const r = s.current!;
  r.reason = reason;
  // Merged but never installed: the live app is untouched, but main now differs from what runs, so stop and say so.
  if (merged) {
    s.halted = `${r.id}: merged but not installed (${reason})`;
    // The live app was never touched: return main to what it runs, so later releases have the right base.
    if (s.released) try { revertMain(s.released.commit, r); } catch (e) { s.halted += `; main NOT reverted (${e instanceof Error ? e.message : e})`; }
  }
  finish(s, merged ? "halted" : "rejected", reason);
}
function finish(s: State, to: Step, reason?: string) {
  const r = s.current!;
  if (reason) r.reason = reason;
  s.history = [r, ...s.history].slice(0, 100);
  s.current = null;
  step(s, r, to, reason ? { reason } : {});
  for (const f of [`${r.id}.json`, `${r.id}.bundle`]) rmSync(path.join(P.inbox, f), { force: true });
}
function prune(s: State) {
  const keep = new Set(s.retained.slice(0, cfg.keepReleases).map((g) => g.id));
  s.retained = s.retained.filter((g) => keep.has(g.id));
  for (const d of existsSync(P.releases) ? readdirSync(P.releases) : []) {
    if (keep.has(d)) continue;
    rmSync(path.join(relDir(d), "dist"), { recursive: true, force: true }); // keep diffs + manifests for the record
  }
  save(s);
}

// ---------- control ----------
const stopped = () => existsSync(P.stop);
function orbitStopAll(): boolean {
  if (!cfg.stopAllFile) return false;
  let raw: string | null | undefined;
  try { raw = lstatSync(cfg.stopAllFile).isFile() ? readFileSync(cfg.stopAllFile, "utf8") : null; }
  catch (e) { raw = (e as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null; }
  return orbitStopAllOn(raw);
}
/** Why nothing new may happen now (emergency stop, ORBIT's Stop-all), or null. Monitoring and rollback still run. */
const held = (): string | null => (stopped() ? "emergency stop is on" : orbitStopAll() ? "ORBIT Stop-all is on" : null);
function emergencyStop(why: string) {
  writeFileSync(P.stop, `${now()} ${why}\n`);
  if (cfg.commands.stopBuilder) run(cfg.commands.stopBuilder, { timeoutSec: 60 });
  audit("emergency.stop", { why });
}

// Inbox files are written in one go (no rename: Windows would need delete rights in the inbox), so a file can be caught
// mid-write. One that doesn't parse yet and is only seconds old is left for the next tick, not rejected.
const young = (file: string) => { try { return Date.now() - statSync(file).mtimeMs < 15_000; } catch { return false; } };
function takeControls(dir: string): { f: string; c: { action?: string; releaseId?: string; commit?: string } }[] {
  if (!existsSync(dir)) return [];
  const out: { f: string; c: { action?: string; releaseId?: string; commit?: string } }[] = [];
  for (const f of readdirSync(dir).filter((n) => n.startsWith("control-") && n.endsWith(".json")).sort()) {
    const file = path.join(dir, f);
    try {
      if (!lstatSync(file).isFile()) { rmSync(file, { recursive: true, force: true }); audit("control.ignored", { file: f, action: "not a plain file" }); continue; }
      let c = {};
      try { c = readJsonFile(file); } catch { if (young(file)) continue; /* still being written: next tick */ }
      rmSync(file, { force: true });
      out.push({ f, c });
    } catch (e) { log(`control ${f} unreadable: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}

async function controls(s: State) {
  // Requests through the inbox (the app, but the builder can create files there too) can only make things safer: pause, stop.
  for (const { f, c } of takeControls(P.inbox)) {
    const a = inboxControl(c.action);
    if (a === "pause") { s.paused = true; save(s); audit("control.pause", { from: "inbox" }); }
    else if (a === "stop") emergencyStop("requested from ORBIT");
    else audit("control.ignored", { file: f, action: String(c.action ?? ""), reason: "only pause and stop are accepted from the inbox; the owner's commands go through ctl/" });
  }
  // The owner's own commands (ctl/, admin-only) arrive here while the watcher runs, so only one process writes state.
  for (const { c } of takeControls(P.ctl)) await ownerCommand(s, String(c.action ?? ""), c.releaseId, c.commit);
}

async function ownerCommand(s: State, cmd: string, arg?: string, commit?: string) {
  if (cmd === "approve") approve(s, arg, commit);
  else if (cmd === "stop") emergencyStop(arg ?? "owner");
  else if (cmd === "pause") { s.paused = true; save(s); audit("control.pause", { from: "owner" }); }
  else if (cmd === "resume") { s.paused = false; save(s); audit("control.resume", { from: "owner" }); }
  else if (cmd === "clear") { rmSync(P.stop, { force: true }); s.halted = null; s.paused = false; save(s); audit("control.clear", { from: "owner" }); }
  else if (cmd === "restore" && !s.current) await restore(s, arg);
  else audit("control.ignored", { from: "owner", action: cmd });
}

/** The owner's approval of the release waiting at "checked", bound to its id and exact commit (rules in approvalProblem). */
function approve(s: State, releaseId?: string, commit?: string) {
  const r = s.current;
  const why = approvalProblem(r ? { id: r.id, commit: r.sub.commit, step: r.step } : null, { releaseId, commit }, s.history.map((h) => h.id));
  if (why || !r) { audit("approval.rejected", { release: String(releaseId ?? ""), commit: String(commit ?? ""), reason: why }); log(`approval rejected: ${why}`); return; }
  step(s, r, "ownerApproved", { by: "owner (ctl)" });
}

async function restore(s: State, releaseId?: string) {
  if (s.current) { audit("restore.refused", { reason: "a release is in progress" }); return; }
  const target = releaseId ? s.retained.find((g) => g.id === releaseId) : s.retained[1] ?? s.retained[0];
  if (!target || !existsSync(path.join(relDir(target.id), "dist"))) { audit("restore.refused", { reason: `no retained artifact for ${releaseId ?? "previous"}` }); return; }
  audit("restore.start", { to: target.id });
  try {
    install(target.commit, path.join(relDir(target.id), "dist"));
    const problems = await monitor(target.commit, null);
    if (problems.length) throw new Error(problems.join("; "));
    s.released = target; s.retained = [target, ...s.retained.filter((g) => g.id !== target.id)]; s.paused = true; save(s);
    audit("restore.verified", { to: target.id, commit: target.commit });
    revertMain(target.commit, { id: `restore-${target.id}`, reason: "owner restore" } as Release);
  } catch (e) { s.halted = `restore to ${target.id} failed: ${e instanceof Error ? e.message : e}`; save(s); audit("restore.failed", { to: target.id, reason: s.halted }); }
}

let mirrorAt = 0;
async function tick(s: State) {
  await controls(s);
  if (s.current) { await advance(s); return; }
  if (cfg.testRunner && !held()) serveTest(cfg.testRunner);
  // Keep the mirror's main current for the builder (it builds on what this mirror says main is).
  if (Date.now() - mirrorAt > 5 * 60_000) { try { mirrorReady(); mirrorAt = Date.now(); } catch (e) { log(`mirror refresh failed: ${e instanceof Error ? e.message : e}`); } }
  const blocked = !cfg.enabled ? "unattended releases are off (config enabled: false)" : held() ?? releaseBlocked({ ...s, stopped: false }, Date.now(), policy);
  const next = existsSync(P.inbox) ? readdirSync(P.inbox).filter((n) => /^[a-z0-9][a-z0-9._-]*\.json$/i.test(n) && !n.startsWith("control-")).sort()[0] : undefined;
  if (!next) return;
  if (blocked) return; // left in the inbox; shown on the status page
  const sm = readSubmission(path.join(P.inbox, next));
  if (typeof sm === "string" && sm.startsWith("unreadable") && young(path.join(P.inbox, next))) return;
  if (typeof sm === "string" || `${sm.id}.json` !== next) {
    audit("submission.rejected", { file: next, reason: typeof sm === "string" ? sm : "file name doesn't match id" });
    rmSync(path.join(P.inbox, next), { force: true });
    return;
  }
  if (s.history.some((h) => h.id === sm.id)) { audit("submission.duplicate", { release: sm.id }); rmSync(path.join(P.inbox, next), { force: true }); return; }
  if (s.day.day !== utcDay(Date.now())) s.day = { day: utcDay(Date.now()), releases: 0, costUsd: 0 };
  s.day.releases++; s.day.costUsd += sm.costUsd;
  s.current = { id: sm.id, sub: sm, step: "accepted", prev: s.released?.id ?? null, startedAt: now(), updatedAt: now(), rollbacks: 0, probes: [] };
  save(s);
  audit("release.accepted", { release: sm.id, task: sm.taskId, title: sm.title, why: sm.why, costUsd: sm.costUsd, commit: sm.commit });
  await advance(s);
}

/** One builder test request, run by the orbit-test runner (supervisor/test-run.ts). Never as SYSTEM, never as the builder. */
function serveTest(T: NonNullable<Config["testRunner"]>) {
  const next = existsSync(T.reqDir) ? readdirSync(T.reqDir).filter((n) => /^[a-z0-9][a-z0-9._-]*\.json$/i.test(n)).sort()[0] : undefined;
  if (!next) return;
  const f = path.join(T.reqDir, next), id = next.slice(0, -5), bundle = path.join(T.reqDir, `${id}.bundle`), out = path.join(T.outDir, `${id}.json`);
  let req: { kind?: keyof typeof TEST_KINDS; commit?: string; id?: string } | null = null;
  try { req = readJsonFile(f); } catch { if (young(f)) return; }
  const problem = testRequestProblem(req) ?? (req!.id !== id ? "file name doesn't match id" : null) ?? (existsSync(out) ? "a result with this id already exists" : null);
  mkdirSync(T.outDir, { recursive: true });
  if (problem) {
    audit("test.refused", { file: next, reason: problem });
    if (!existsSync(out)) writeFileSync(out, JSON.stringify({ id, ok: false, reason: `refused: ${problem}`, steps: [] }));
  } else {
    const r = run(sub(T.command, { req: f, bundle: existsSync(bundle) ? bundle : "-", out, id, kind: req!.kind! }), { timeoutSec: TEST_KINDS[req!.kind!] + 300 });
    if (!existsSync(out)) writeFileSync(out, JSON.stringify({ id, commit: req!.commit, kind: req!.kind, ok: false, reason: `the runner ended without a result: ${redact(r.err.slice(-400))}`, steps: [] }));
    let ok = false; try { ok = readJsonFile(out).ok === true; } catch { /* unreadable = failed */ }
    audit("test.run", { id, kind: req!.kind, commit: req!.commit, ok });
  }
  rmSync(f, { force: true }); rmSync(bundle, { force: true });
}

/** Status for the app's self-development view: readable by the app, written only here. */
function publish(s: State) {
  mkdirSync(P.pub, { recursive: true });
  const entries = readAudit(P.audit);
  const queued = existsSync(P.inbox) ? readdirSync(P.inbox).filter((n) => n.endsWith(".json") && !n.startsWith("control-")) : [];
  const blocked = !cfg.enabled ? "unattended releases are off (config enabled: false)" : held() ?? releaseBlocked({ ...s, stopped: false }, Date.now(), policy);
  const body = {
    at: now(), enabled: !!cfg.enabled, orbitStopAll: orbitStopAll(), stopped: stopped(), paused: s.paused, halted: s.halted, blocked, released: s.released, retained: s.retained,
    awaitingApproval: s.current?.step === "checked" ? { id: s.current.id, commit: s.current.sub.commit, since: s.current.updatedAt } : null,
    current: s.current, history: s.history.slice(0, 30), queued, day: s.day, policy,
    audit: { ok: verifyAudit(entries) === 0, count: entries.length, recent: entries.slice(-40).reverse() },
  };
  writeFileSync(path.join(P.pub, "status.json.tmp"), redact(JSON.stringify(body)));
  renameSync(path.join(P.pub, "status.json.tmp"), path.join(P.pub, "status.json"));
}

function watcherAlive(): boolean {
  try { const pid = Number(readFileSync(P.lock, "utf8")); if (!pid || pid === process.pid) return false; process.kill(pid, 0); return true; }
  catch { return false; }
}
function lock() {
  try { const pid = Number(readFileSync(P.lock, "utf8")); if (pid && pid !== process.pid) { try { process.kill(pid, 0); throw new Error(`another supervisor runs (pid ${pid})`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; } } }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  writeFileSync(P.lock, String(process.pid));
}

async function main() {
  for (const d of [P.inbox, P.releases, P.pub, P.ctl]) mkdirSync(d, { recursive: true });
  const [cmd = "status", arg, arg2] = process.argv.slice(2);
  const s = load();
  switch (cmd) {
    case "watch": {
      lock(); audit("supervisor.start", { pid: process.pid, resuming: s.current?.id ?? null, step: s.current?.step ?? null });
      for (;;) { try { await tick(s); } catch (e) { log(`tick failed: ${e instanceof Error ? e.message : e}`); } publish(s); await sleep(cfg.pollSec * 1000); }
    }
    case "once": lock(); await tick(s); publish(s); break;
    case "adopt": { // record what runs now as the first good release (snapshot of the live build)
      const h = await health();
      const head = liveGit(["rev-parse", "HEAD"]);
      if (!h.ok || (h.commit && h.commit !== head)) throw new Error(`live app not healthy on its checkout (health ${h.ok}, running ${h.commit}, checkout ${head})`);
      mirrorReady();
      const id = `adopted-${head.slice(0, 7)}`;
      snapshotDist(distOf(cfg.liveDir), id);
      s.released = { id, commit: head, at: now() }; s.retained = [s.released, ...s.retained.filter((g) => g.id !== id)];
      save(s); audit("release.adopted", { release: id, commit: head }); break;
    }
    case "stop": case "pause": case "resume": case "clear": case "restore": case "approve":
      if (cmd === "stop") writeFileSync(P.stop, `${now()} owner\n`); // takes effect at once, even if the watcher is busy
      if (watcherAlive()) { // hand it to the running watcher: one writer for state and audit
        const f = path.join(P.ctl, `control-${Date.now()}-${cmd}.json`);
        writeFileSync(f + ".tmp", JSON.stringify({ action: cmd, releaseId: arg, commit: arg2 })); renameSync(f + ".tmp", f);
        console.log(`queued "${cmd}" for the running supervisor`);
      } else { lock(); await ownerCommand(s, cmd, arg, arg2); }
      break;
    case "verify-audit": { const b = verifyAudit(readAudit(P.audit)); console.log(b ? `BROKEN at line ${b}` : "audit chain intact"); process.exitCode = b ? 1 : 0; break; }
    default: publish(s); console.log(JSON.stringify(readJsonFile(path.join(P.pub, "status.json")), null, 1));
  }
}
main().catch((e) => { log(`fatal: ${e instanceof Error ? e.stack : e}`); process.exit(1); });
