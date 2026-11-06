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
import {
  cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, renameSync, rmSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { appendAudit, readAudit, verifyAudit } from "./audit.ts";
import {
  DEFAULT_POLICY, afterFailure, countErrors, parseNumstat, policyViolations, probeProblems, redact, releaseBlocked, submissionProblem, utcDay,
  type Day, type Policy, type Probe, type Submission,
} from "./policy.ts";

type Cmd = string[]; // argv; {commit} {stage} {live} are substituted
type Config = {
  repoUrl: string; mainBranch: string; liveDir: string; distDir: string; stageDir: string;
  healthUrl: string; serverLog: string | null;
  commands: { build: Cmd; stop: Cmd; start: Cmd; stopBuilder?: Cmd };
  github: { repo: string; tokenFile: string; checksTimeoutSec: number } | null;
  allowWithoutExternalChecks?: boolean; // drills only: no CI to wait for
  workflowChecks: { name: string; url: string; expect: number }[];
  monitor: { probes: number; intervalSec: number; maxErrors: number; startupTimeoutSec: number };
  dataBackup: { paths: string[]; maxBytes: number };
  keepReleases: number; pollSec: number; policy?: Partial<Policy>;
};
type Step = "accepted" | "fetched" | "approved" | "pushed" | "checked" | "merged" | "built" | "snapshotted" | "backedUp" | "installed" | "retained"
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
};

const cfg: Config = JSON.parse(readFileSync(P.config, "utf8"));
const policy: Policy = { ...DEFAULT_POLICY, ...cfg.policy };
const now = () => new Date().toISOString();
const log = (m: string) => console.log(`${now()} [supervisor] ${redact(m)}`);
const audit = (event: string, data: Record<string, unknown> = {}) => appendAudit(P.audit, event, JSON.parse(redact(JSON.stringify(data))));

function load(): State {
  try { return JSON.parse(readFileSync(P.state, "utf8")) as State; }
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
  if (!existsSync(P.mirror)) must(["git", "clone", "--bare", "--quiet", cfg.repoUrl, P.mirror], { env: gitEnv() });
  git(["fetch", "--quiet", "--prune", "origin", `+refs/heads/${cfg.mainBranch}:refs/heads/${cfg.mainBranch}`]);
  return git(["rev-parse", cfg.mainBranch]);
}

// ---------- artifacts and data ----------
const relDir = (id: string) => path.join(P.releases, id);
const distOf = (dir: string) => path.join(dir, cfg.distDir);
function snapshotDist(from: string, id: string) {
  const to = path.join(relDir(id), "dist");
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (src) => !src.includes(`${path.sep}cache${path.sep}`) && !src.endsWith(`${path.sep}cache`) });
  if (!existsSync(path.join(to, "BUILD_ID"))) throw new Error("artifact has no BUILD_ID");
  return to;
}
function hashTree(dir: string, base = dir, out: Record<string, string> = {}, budget = { bytes: 0 }) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
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
  cfg.dataBackup.paths.forEach((src, i) => {
    const before = hashTree(src);
    const dst = path.join(to, String(i));
    if (existsSync(src)) cpSync(src, dst, { recursive: true, filter: (f) => !f.endsWith(".tmp") });
    const scratch = path.join(HOME, `restore-drill-${randomUUID()}`);
    try {
      if (existsSync(dst)) cpSync(dst, scratch, { recursive: true });
      const restored = hashTree(scratch);
      const diff = Object.keys(before).filter((k) => before[k] !== restored[k]);
      if (diff.length || Object.keys(restored).length !== Object.keys(before).length) throw new Error(`restore check failed for ${src}: ${diff.slice(0, 3).join(", ")}`);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    report.push({ path: src, files: Object.keys(before).length });
  });
  writeFileSync(path.join(relDir(id), "data-manifest.json"), JSON.stringify({ at: now(), paths: cfg.dataBackup.paths }));
  return report;
}

// ---------- install, health ----------
function liveClean() {
  const r = must(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: cfg.liveDir });
  if (r) throw new Error(`the live folder has local changes; not touching it:\n${r.slice(0, 400)}`);
}
function install(commit: string, dist: string) {
  liveClean();
  run(sub(cfg.commands.stop, { live: cfg.liveDir }), { cwd: cfg.liveDir, timeoutSec: 120 });
  must(["git", "fetch", "--quiet", P.mirror, commit], { cwd: cfg.liveDir });
  must(["git", "checkout", "--quiet", "-B", cfg.mainBranch, commit], { cwd: cfg.liveDir });
  const live = distOf(cfg.liveDir);
  rmSync(live, { recursive: true, force: true });
  cpSync(dist, live, { recursive: true });
  // The launcher rebuilds when src/ is newer than BUILD_ID; the checkout just touched src/, so mark the build current.
  const t = new Date(); utimesSync(path.join(live, "BUILD_ID"), t, t);
  must(sub(cfg.commands.start, { live: cfg.liveDir }), { cwd: cfg.liveDir, timeoutSec: 120 });
}

async function health(): Promise<{ ok: boolean; commit: string | null; uptimeSec: number | null }> {
  try {
    const r = await fetch(cfg.healthUrl, { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { ok?: boolean; commit?: string; uptimeSec?: number };
    return { ok: r.ok && j.ok === true, commit: j.commit ?? null, uptimeSec: j.uptimeSec ?? null };
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
  let h = await health();
  while (!h.ok && Date.now() < deadline) { await sleep(2000); h = await health(); }
  if (!h.ok) return ["did not start: health check never passed"];
  let prevUptime: number | null = null;
  for (let i = 0; i < m.probes; i++) {
    if (i) await sleep(m.intervalSec * 1000);
    h = await health();
    const failed: string[] = [];
    for (const w of cfg.workflowChecks) {
      const st = await fetch(w.url, { redirect: "manual", signal: AbortSignal.timeout(15000) }).then((x) => x.status).catch(() => 0);
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
    const s = JSON.parse(readFileSync(file, "utf8"));
    return submissionProblem(s) ?? s;
  } catch (e) { return `unreadable: ${e instanceof Error ? e.message : e}`; }
}

async function advance(s: State) {
  const r = s.current!;
  const id = r.id;
  // Stop holds a release anywhere before the live app is touched; once installed it still finishes monitoring and recovery.
  if (stopped() && !["installed", "failed"].includes(r.step)) return;
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
      const v = policyViolations(changes, policy);
      if (v.length) return reject(s, `release policy: ${v.join("; ")}`);
      mkdirSync(relDir(id), { recursive: true });
      const patch = git(["diff", r.mainBefore!, r.sub.commit]).slice(0, 400_000);
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
      if (cfg.github) {
        const until = Date.now() + cfg.github.checksTimeoutSec * 1000;
        for (;;) {
          const runs = ((await gh("GET", `/commits/${r.sub.commit}/check-runs?per_page=100`)) as { check_runs: { name: string; status: string; conclusion: string | null }[] }).check_runs;
          const bad = runs.filter((c) => c.status === "completed" && !["success", "neutral", "skipped"].includes(c.conclusion ?? ""));
          if (bad.length) return reject(s, `CI failed: ${bad.map((c) => c.name).join(", ")}`);
          if (runs.length && runs.every((c) => c.status === "completed")) break;
          if (Date.now() > until) return reject(s, runs.length ? "CI didn't finish in time" : "CI never started on this commit");
          await sleep(20_000);
        }
      } else if (!cfg.allowWithoutExternalChecks) return reject(s, "no external CI configured; unattended release refused");
      step(s, r, "checked", { externalChecks: cfg.github ? "github check-runs passed on this exact commit" : "none configured (drill)" });
    }
    if (r.step === "checked") {
      const main = mirrorReady();
      if (main !== r.sub.commit) {
        if (main !== r.mainBefore) return reject(s, "main moved while this was being checked; resubmit on the new main");
        git(["push", "--quiet", "origin", `${r.sub.commit}:refs/heads/${cfg.mainBranch}`]); // fast-forward only: a non-FF push is refused
      }
      step(s, r, "merged");
    }
    if (r.step === "merged") {
      const b = run(sub(cfg.commands.build, { commit: r.sub.commit, stage: cfg.stageDir, mirror: P.mirror }), { timeoutSec: 1800 });
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
      if (stopped() || s.paused) return; // last point to hold before the live app is touched
      install(r.sub.commit, path.join(relDir(id), "dist"));
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
    if (["installed", "failed"].includes(r.step)) { r.reason = msg; step(s, r, "failed", { reason: msg }); await recover(s, r); }
    else reject(s, msg, r.step === "merged" || r.step === "built" || r.step === "snapshotted" || r.step === "backedUp");
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
      revertMain(prev.commit, r);
      audit("rollback.verified", { release: r.id, restored: prev.id, commit: prev.commit });
      finish(s, "rolledBack", `restored ${prev.id}; releases halted until the owner clears it`);
      return;
    } catch (e) { audit("rollback.failed", { release: r.id, attempt: r.rollbacks, reason: e instanceof Error ? e.message : String(e) }); }
  }
}

/** Main returns to the restored code too, by a new commit with the old tree (history is kept, nothing is force-pushed). */
function revertMain(goodCommit: string, r: Release) {
  const main = mirrorReady();
  const goodTree = git(["rev-parse", `${goodCommit}^{tree}`]);
  if (git(["rev-parse", `${main}^{tree}`]) === goodTree) return;
  const c = must(["git", "commit-tree", goodTree, "-p", main, "-m", `Revert self-dev release ${r.id} (failed after deploy: ${r.reason?.slice(0, 120)})`],
    { cwd: P.mirror, env: { ...gitEnv(), GIT_AUTHOR_NAME: "ORBIT supervisor", GIT_AUTHOR_EMAIL: "supervisor@orbit.local", GIT_COMMITTER_NAME: "ORBIT supervisor", GIT_COMMITTER_EMAIL: "supervisor@orbit.local" } });
  git(["push", "--quiet", "origin", `${c}:refs/heads/${cfg.mainBranch}`]);
  audit("main.reverted", { release: r.id, commit: c });
}

function reject(s: State, reason: string, merged = false) {
  const r = s.current!;
  r.reason = reason;
  // Merged but never installed: the live app is untouched, but main now differs from what runs, so stop and say so.
  if (merged) s.halted = `${r.id}: merged but not installed (${reason})`;
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
function emergencyStop(why: string) {
  writeFileSync(P.stop, `${now()} ${why}\n`);
  if (cfg.commands.stopBuilder) run(cfg.commands.stopBuilder, { timeoutSec: 60 });
  audit("emergency.stop", { why });
}

async function controls(s: State) {
  if (!existsSync(P.inbox)) return;
  for (const f of readdirSync(P.inbox).filter((n) => n.startsWith("control-") && n.endsWith(".json")).sort()) {
    const file = path.join(P.inbox, f);
    let c: { action?: string; releaseId?: string } = {};
    try { c = JSON.parse(readFileSync(file, "utf8")); } catch { /* ignored below */ }
    rmSync(file, { force: true });
    // Requests from the app can only make things safer: pause, stop, restore an earlier good release.
    if (c.action === "pause") { s.paused = true; save(s); audit("control.pause", { from: "app" }); }
    else if (c.action === "stop") emergencyStop("requested from ORBIT");
    else if (c.action === "restore") await restore(s, c.releaseId);
    else audit("control.ignored", { file: f, action: String(c.action ?? "") });
  }
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
    revertMain(target.commit, { id: `restore-${target.id}`, reason: "owner restore" } as Release);
    s.released = target; s.paused = true; save(s);
    audit("restore.verified", { to: target.id, commit: target.commit });
  } catch (e) { s.halted = `restore to ${target.id} failed: ${e instanceof Error ? e.message : e}`; save(s); audit("restore.failed", { to: target.id, reason: s.halted }); }
}

async function tick(s: State) {
  await controls(s);
  if (s.current) { await advance(s); return; }
  const blocked = releaseBlocked({ ...s, stopped: stopped() }, Date.now(), policy);
  const next = existsSync(P.inbox) ? readdirSync(P.inbox).filter((n) => /^[a-z0-9][a-z0-9._-]*\.json$/i.test(n) && !n.startsWith("control-")).sort()[0] : undefined;
  if (!next) return;
  if (blocked) return; // left in the inbox; shown on the status page
  const sm = readSubmission(path.join(P.inbox, next));
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

/** Status for the app's self-development view: readable by the app, written only here. */
function publish(s: State) {
  mkdirSync(P.pub, { recursive: true });
  const entries = readAudit(P.audit);
  const queued = existsSync(P.inbox) ? readdirSync(P.inbox).filter((n) => n.endsWith(".json") && !n.startsWith("control-")) : [];
  const blocked = releaseBlocked({ ...s, stopped: stopped() }, Date.now(), policy);
  const body = {
    at: now(), stopped: stopped(), paused: s.paused, halted: s.halted, blocked, released: s.released, retained: s.retained,
    current: s.current, history: s.history.slice(0, 30), queued, day: s.day, policy,
    audit: { ok: verifyAudit(entries) === 0, count: entries.length, recent: entries.slice(-40).reverse() },
  };
  writeFileSync(path.join(P.pub, "status.json.tmp"), redact(JSON.stringify(body)));
  renameSync(path.join(P.pub, "status.json.tmp"), path.join(P.pub, "status.json"));
}

function lock() {
  try { const pid = Number(readFileSync(P.lock, "utf8")); if (pid && pid !== process.pid) { try { process.kill(pid, 0); throw new Error(`another supervisor runs (pid ${pid})`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; } } }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  writeFileSync(P.lock, String(process.pid));
}

async function main() {
  for (const d of [P.inbox, P.releases, P.pub]) mkdirSync(d, { recursive: true });
  const [cmd = "status", arg] = process.argv.slice(2);
  const s = load();
  switch (cmd) {
    case "watch": {
      lock(); audit("supervisor.start", { pid: process.pid, resuming: s.current?.id ?? null, step: s.current?.step ?? null });
      for (;;) { try { await tick(s); } catch (e) { log(`tick failed: ${e instanceof Error ? e.message : e}`); } publish(s); await sleep(cfg.pollSec * 1000); }
    }
    case "once": lock(); await tick(s); publish(s); break;
    case "adopt": { // record what runs now as the first good release (snapshot of the live build)
      const h = await health();
      const head = must(["git", "rev-parse", "HEAD"], { cwd: cfg.liveDir });
      if (!h.ok || (h.commit && h.commit !== head)) throw new Error(`live app not healthy on its checkout (health ${h.ok}, running ${h.commit}, checkout ${head})`);
      mirrorReady();
      const id = `adopted-${head.slice(0, 7)}`;
      snapshotDist(distOf(cfg.liveDir), id);
      s.released = { id, commit: head, at: now() }; s.retained = [s.released, ...s.retained.filter((g) => g.id !== id)];
      save(s); audit("release.adopted", { release: id, commit: head }); break;
    }
    case "stop": emergencyStop(arg ?? "owner"); break;
    case "pause": s.paused = true; save(s); audit("control.pause", { from: "owner" }); break;
    case "resume": s.paused = false; save(s); audit("control.resume", { from: "owner" }); break;
    case "clear": rmSync(P.stop, { force: true }); s.halted = null; s.paused = false; save(s); audit("control.clear", { from: "owner" }); break;
    case "restore": await restore(s, arg); break;
    case "verify-audit": { const b = verifyAudit(readAudit(P.audit)); console.log(b ? `BROKEN at line ${b}` : "audit chain intact"); process.exitCode = b ? 1 : 0; break; }
    default: publish(s); console.log(JSON.stringify(JSON.parse(readFileSync(path.join(P.pub, "status.json"), "utf8")), null, 1));
  }
}
main().catch((e) => { log(`fatal: ${e instanceof Error ? e.stack : e}`); process.exit(1); });
