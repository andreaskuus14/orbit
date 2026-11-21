// Night-shift self-repair, IO side (rules and why: night-repair-pure.ts; protected paths: night-repair-protect-pure.ts; git and processes:
// night-repair-git.ts). Started from the scheduler tick; one run per night, at most 3 patches and ORBIT_NIGHT_REPAIR_CALLS agent calls.
// Stop-all aborts it (stop-all-run.ts), the usage pacer (usageHold) is checked before every agent call. Nothing merges or deploys here:
// approveRepair() runs only from the owner's tap (/api/night-repair, the phone's approval card).
// State: <ORBIT data dir>/night-repair.json; worktrees: <data dir>/night-repair/wt/ (outside the repo, removed after each patch).
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { readStore, writeStore } from "./safe-file";
import { stopAllOn } from "./stop-all";
import { usageHold, lastCoreCallAt } from "./usage-meter";
import { allows } from "./autonomy";
import { logActivity } from "./activity";
import { takeLease, releaseLease } from "./job-log";
import { inWindow, nightKey } from "./night-pure";
import { checkPatch } from "./night-repair-protect-pure";
import * as G from "./night-repair-git";
import {
  AGENT_TOOLS, REPAIR_SYSTEM, agentPermissions, branchName, budgetStop, collectSignals, effectLine, failedTests, gateEnv, isWaiting, parseAgentReply,
  parseMetric, parseRepair, patchCard, patchSeen, prBody, rankSignals, repairBlock, repairConfig, repairModel, repairPrompt, retryPrompt, tail, trimState,
  type Effect, type Night, type Patch, type RepairState, type SelfTest, type Signal, type Smoke,
} from "./night-repair-pure";

const file = () => path.join(orbitDataDir(), "night-repair.json");
const home = () => path.join(orbitDataDir(), "night-repair");
const repo = () => process.cwd(); // the live checkout scripts/launch.ps1 runs (its supervisor pulls and builds this folder)
const WIN = process.platform === "win32";
const NPM = WIN ? "npm.cmd" : "npm";
const JOB = "night-repair", LEASE = 90 * 60_000;
const g = globalThis as unknown as { __orbitRepair?: { ac: AbortController | null; write: Promise<unknown> } };
const R = (g.__orbitRepair ??= { ac: null, write: Promise.resolve() });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);

const load = async (): Promise<RepairState> => parseRepair(await readStore(file()));
function update<T>(fn: (s: RepairState) => T): Promise<T> {
  const p = R.write.catch(() => {}).then(async () => { const s = await load(), out = fn(s); await mkdir(orbitDataDir(), { recursive: true }); await writeStore(file(), JSON.stringify(trimState(s))); return out; });
  R.write = p;
  return p;
}
const savePatch = (p: Patch) => update((s) => { const i = s.patches.findIndex((x) => x.id === p.id); if (i >= 0) s.patches[i] = structuredClone(p); else s.patches.push(structuredClone(p)); });
const saveNight = (n: Night) => update((s) => { const i = s.nights.findIndex((x) => x.key === n.key); if (i >= 0) s.nights[i] = structuredClone(n); else s.nights.push(structuredClone(n)); });

/** Stop-all: abort the running repair (its agent call, gate and git steps are killed; worktrees are cleaned up). */
export function abortNightRepair() { R.ac?.abort(); }
export const repairRunning = () => !!R.ac;

async function nightSettings() { return (await import("./night")).lastNightRun("").then((x) => x.settings); }
const repoProblem = () => (existsSync(path.join(repo(), ".git")) ? "" : "the ORBIT folder isn't a git checkout");

async function blockNow(now = Date.now()) {
  const s = await nightSettings(), key = nightKey(now, s), st = await load();
  const a = allows("night-shift", "background");
  return { key, why: repairBlock({ cfg: repairConfig(process.env), inWindow: s.enabled && inWindow(now, s), stopAll: stopAllOn(), hold: usageHold() ?? "", ranTonight: st.nights.some((n) => n.key === key),
    idle: now - lastCoreCallAt() >= s.idleMin * 60_000, autonomy: a.ok ? "" : a.why, repo: repoProblem(), running: !!R.ac }) };
}

/** Scheduler tick: maybe start tonight's repair (not awaited: a run takes hours). Never throws. */
export async function maybeNightRepair(sb: SupabaseClient, userIds: string[]) {
  try {
    const id = userIds[0];
    if (!id) return;
    const { key, why } = await blockNow();
    if (why) return;
    if (!(await takeLease(JOB, LEASE).catch(() => false))) return; // another ORBIT process on this data dir
    R.ac = new AbortController();
    void runRepair(sb, key, R.ac).catch((e) => console.error("[orbit] night repair failed:", msg(e))).finally(() => { R.ac = null; void releaseLease(JOB).catch(() => {}); });
  } catch (e) { console.error("[orbit] night repair check failed:", msg(e)); }
}

async function runRepair(sb: SupabaseClient, key: string, ac: AbortController) {
  const cfg = repairConfig(process.env), night: Night = { key, startedAt: new Date().toISOString(), calls: 0 };
  await saveNight(night);
  console.log("[orbit] night repair starting");
  const base = await G.fetchMain(repo(), ac.signal).catch((e) => { night.note = `git fetch failed: ${msg(e)}`; return ""; });
  const baseDir = path.join(home(), "wt", `base-${key}`);
  try {
    if (!base) return;
    await G.removeWorktree(repo(), baseDir); // a crashed earlier run
    await G.addDetached(repo(), baseDir, base);
    await G.linkModules(baseDir, path.join(repo(), "node_modules"));
    night.selftest = await selfTest(sb, baseDir, ac.signal);
    await saveNight(night);
    const issues = await import("./health").then((h) => h.healthIssues()).catch(() => []); // logs, failed jobs, failed tool calls, perf: redacted, no journal rows
    const st = await load();
    const ranked = rankSignals(collectSignals({ issues, doctor: night.selftest.doctor.map((c) => ({ ...c, label: c.id })), selftest: night.selftest }), st.patches.map((p) => ({ signal: p.signal, at: p.at })), Date.now(), cfg.maxPatches);
    night.ranked = ranked.map((s) => ({ id: s.id, title: s.title }));
    await saveNight(night);
    let patches = 0;
    for (const s of ranked) {
      const stop = ac.signal.aborted ? "stop-all" : budgetStop(cfg, { patches, calls: night.calls }, stopAllOn(), usageHold() ?? "");
      if (stop) { night.stopped = stop; break; }
      if (!inWindow(Date.now(), await nightSettings())) { night.stopped = "window"; break; }
      await takeLease(JOB, LEASE).catch(() => false);
      patches++;
      await attempt(s, key, base, baseDir, night, cfg, ac.signal).catch((e) => console.error("[orbit] night repair attempt:", msg(e)));
      await saveNight(night);
    }
  } finally {
    await G.removeWorktree(repo(), baseDir);
    night.endedAt = new Date().toISOString();
    if (ac.signal.aborted) night.stopped = "stop-all";
    await saveNight(night);
    const ready = (await load()).patches.filter((p) => p.night === key && isWaiting(p));
    logActivity({ area: "system", title: `Night repair: ${ready.length} fix${ready.length === 1 ? "" : "es"} ready to approve`, detail: night.stopped ? `stopped: ${night.stopped}` : night.note });
    if (ready.length) void import("./remote-push").then((m) => { if (m.canNotify()) void m.deliver({ title: `Night repair: ${ready.length} fix${ready.length === 1 ? "" : "es"} to approve`, body: "Code patches that passed the gate. Nothing merges without you.", url: "/remote#r-appr", tag: "night" }); }).catch(() => {});
    console.log(`[orbit] night repair done: ${ready.length} ready, ${night.calls} agent call(s)${night.stopped ? `, stopped (${night.stopped})` : ""}`);
  }
}

// ---- nightly self-test: doctor + `npm test` on origin/main + two cheap smoke checks ----

async function selfTest(sb: SupabaseClient, baseDir: string, signal: AbortSignal): Promise<SelfTest> {
  const t0 = Date.now();
  const doctor = await import("./doctor").then((d) => d.runDoctor(sb)).then((r) => r.checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail.slice(0, 400) })), () => []);
  const doctorMs = Date.now() - t0;
  await gpuIdle(signal);
  const data = await mkdtemp(path.join(tmpdir(), "orbit-selftest-"));
  const r = await G.run(process.execPath, ["--test", "--test-reporter=tap", "--experimental-strip-types", "tests/*.test.ts"], { cwd: baseDir, env: gateEnv(process.env, data), timeoutMs: 25 * 60_000, signal, max: 3_000_000 });
  await rm(data, { recursive: true, force: true }).catch(() => {});
  const smoke: Smoke[] = [{ name: "doctor", ok: doctorMs < 30_000, ms: doctorMs, ...(doctorMs >= 30_000 ? { detail: `slow: the doctor took ${Math.round(doctorMs / 1000)} s` } : {}) }];
  const h0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const hm = Date.now() - h0;
  if (res) smoke.push({ name: "api/health", ok: res.ok && hm < 2000, ms: hm, ...(!res.ok ? { detail: `answered ${res.status}` } : hm >= 2000 ? { detail: `slow: ${hm} ms` } : {}) });
  const failed = r.code === 0 ? [] : failedTests(r.out);
  return { at: new Date().toISOString(), doctor, smoke, tests: { ok: r.code === 0, ran: r.code !== -1, failed, ms: r.ms, ...(r.code === -1 ? { note: r.timedOut ? "timed out" : "stopped" } : r.code && !failed.length ? { note: tail(r.out, 6) } : {}) } };
}

// ---- one problem → one patch ----

async function agentCall(prompt: string, dir: string, cfg: ReturnType<typeof repairConfig>, signal: AbortSignal) {
  const tmp = await mkdtemp(path.join(tmpdir(), "orbit-repair-"));
  try {
    const settings = path.join(tmp, "settings.json"), mcp = path.join(tmp, "mcp.json");
    const perms = agentPermissions(dir);
    await writeFile(settings, JSON.stringify({ permissions: perms }));
    await writeFile(mcp, JSON.stringify({ mcpServers: {} })); // --strict-mcp-config with nothing: no MCP connectors, no user settings
    const { askClaude } = await import("./claude");
    return await askClaude(prompt, REPAIR_SYSTEM, { lane: "background", model: repairModel(process.env.ORBIT_NIGHT_REPAIR_MODEL), purpose: "night-repair", timeoutMs: cfg.agentMinutes * 60_000, signal,
      mcp: { allow: perms.allow, settings, config: mcp, tools: [...AGENT_TOOLS], cwd: dir } });
  } finally { await rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

/** Heavy CPU/RAM work (npm test, the gate's next build) waits while a GPU job (render, pictures, 3D) holds the lease, up to 30 min. */
async function gpuIdle(signal: AbortSignal) {
  const { gpuNow, pause } = await import("./gpu-lock");
  for (let i = 0; i < 30 && gpuNow().busy && !signal.aborted; i++) await pause(60_000, signal).catch(() => {});
}

async function runGate(dir: string, logName: string, cfg: ReturnType<typeof repairConfig>, signal: AbortSignal) {
  await gpuIdle(signal);
  const data = await mkdtemp(path.join(tmpdir(), "orbit-gate-"));
  try {
    const r = await G.run(NPM, ["run", "gate"], { cwd: dir, env: gateEnv(process.env, data), timeoutMs: cfg.gateMinutes * 60_000, signal, max: 2_000_000 });
    await mkdir(path.join(home(), "logs"), { recursive: true });
    await writeFile(path.join(home(), "logs", `${logName}.log`), r.out.slice(-1_000_000)).catch(() => {});
    return { ok: r.code === 0, ms: r.ms, tail: tail(r.out) };
  } finally { await rm(data, { recursive: true, force: true }).catch(() => {}); }
}

async function attempt(s: Signal, key: string, base: string, baseDir: string, night: Night, cfg: ReturnType<typeof repairConfig>, signal: AbortSignal) {
  const branch = branchName(key, s.title, await G.nightBranches(repo()));
  const dir = path.join(home(), "wt", branch.slice("night/".length));
  const p: Patch = { id: randomUUID(), night: key, signal: s.id, kind: s.kind, title: s.title.replace(/^(Failing test|Doctor|Smoke check):?\s*/i, "").slice(0, 120), problem: s.title, branch, base, status: "failed", calls: 0, at: new Date().toISOString() };
  const done = (status: Patch["status"], reason?: string) => { p.status = status; if (reason) p.reason = reason.slice(0, 600); return savePatch(p); };
  await savePatch(p);
  let keepBranch = false;
  try {
    await G.removeWorktree(repo(), dir);
    await G.addWorktree(repo(), dir, branch, base);
    let prompt = repairPrompt(s);
    for (let round = 0; round < 2; round++) {
      const hold = usageHold();
      if (hold) return void (await done("discarded", `usage pacer: ${hold}`));
      if (signal.aborted) return void (await done("discarded", "Stop-all"));
      night.calls++; p.calls++;
      await rm(path.join(dir, "node_modules"), { force: true }).catch(() => {}); // the agent never sees the live node_modules junction
      const a = await agentCall(prompt, dir, cfg, signal);
      const reply = parseAgentReply(a.text);
      if (round === 0) { p.summary = reply.summary || undefined; p.test = reply.test || undefined; }
      const stray = await G.strayIgnored(dir);
      if (stray.length) return void (await done("discarded", `left ignored files the build would read: ${stray.slice(0, 5).join(", ")}`));
      const head = await G.commitAll(dir, `night repair: ${p.title}\n\n${reply.summary || reply.noFix || ""}`.slice(0, 2000));
      if (!head && round === 0) return void (await done("discarded", reply.noFix ? `agent: ${reply.noFix}` : "the agent changed nothing"));
      if (!head) return void (await done("failed", "npm run gate failed and the retry changed nothing"));
      p.commit = await G.revParse(dir, "HEAD");
      const d = await G.diffOf(dir, base, p.commit);
      const problems = checkPatch(d);
      p.files = (await import("./night-repair-protect-pure")).parseNumstat(d.numstat);
      if (problems.length) return void (await done("discarded", `rejected whole (protected paths / checks): ${problems.join("; ")}`));
      await G.linkModules(dir, path.join(repo(), "node_modules"));
      p.gate = await runGate(dir, branch.replace(/\//g, "_"), cfg, signal);
      await savePatch(p);
      if (p.gate.ok) break;
      if (signal.aborted || round === 1 || night.calls >= cfg.maxCalls) return void (await done("failed", "npm run gate failed"));
      prompt = retryPrompt(s, p.gate.tail);
    }
    p.effect = effectLine(await measure(s, p.files ?? [], dir, baseDir, signal));
    await publish(p, signal);
    keepBranch = true;
    await done("waiting");
    logActivity({ area: "system", title: `Night repair prepared: ${p.title}`, detail: `${p.branch}${p.pr ? ` · PR #${p.pr.number}` : " · local branch"} · waits for your approve` });
    if (p.commit) void import("./time-machine").then((m) => m.recordBranch(p.branch, p.commit!, `Night repair: ${p.title.slice(0, 120)}`)).catch(() => {}); // TIME MACHINE: Undo puts the branch away (approve then refuses), Undo again brings it back
  } catch (e) {
    await done(signal.aborted ? "discarded" : "failed", signal.aborted ? "Stop-all" : msg(e));
  } finally {
    await G.removeWorktree(repo(), dir);
    if (!keepBranch) await G.deleteBranch(repo(), branch).catch(() => null);
  }
}

/** The metric that motivated the patch, before (origin/main) and after (the patch), on this machine. */
async function measure(s: Signal, files: { path: string }[], dir: string, baseDir: string, signal: AbortSignal): Promise<Effect> {
  const env = gateEnv(process.env, path.join(tmpdir(), "orbit-measure")), node = (cwd: string, args: string[]) => G.run(process.execPath, ["--experimental-strip-types", ...args], { cwd, env, timeoutMs: 5 * 60_000, signal });
  const bench = files.map((f) => f.path).find((f) => /^tests\/bench\/[\w.-]+\.bench\.ts$/.test(f));
  if (bench) {
    await mkdir(path.dirname(path.join(baseDir, bench)), { recursive: true });
    await copyFile(path.join(dir, bench), path.join(baseDir, bench));
    const [b, a] = [await node(baseDir, [bench]), await node(dir, [bench])];
    await rm(path.join(baseDir, bench), { force: true }).catch(() => {});
    const mb = parseMetric(b.out), ma = parseMetric(a.out);
    if (b.code === 0 && a.code === 0 && mb && ma && mb.name === ma.name) return { kind: "bench", before: mb, after: ma };
    return { kind: "none", why: "the bench script didn't report the same METRIC on main and on the patch" };
  }
  const test = s.kind === "test" ? s.files?.[0] : undefined;
  if (test && /^tests\/[\w.-]+\.test\.ts$/.test(test)) {
    const [b, a] = [await node(baseDir, ["--test", test]), await node(dir, ["--test", test])];
    return { kind: "test", file: test, before: b.code === 0 ? "pass" : "fail", after: a.code === 0 ? "pass" : "fail" };
  }
  return { kind: "none", why: s.kind === "perf" ? "no bench script came with the patch" : "the problem needs live traffic to re-measure; the new test covers it" };
}

// ---- GitHub (only when a token / gh is configured on this PC; otherwise the branch stays local) ----

async function ghToken(): Promise<string> {
  const env = process.env.ORBIT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env?.trim()) return env.trim();
  const r = await G.run(WIN ? "gh.exe" : "gh", ["auth", "token"], { timeoutMs: 10_000 });
  return r.code === 0 ? r.out.trim().split(/\s+/)[0] ?? "" : "";
}
async function ghRepo(): Promise<string> {
  const env = process.env.ORBIT_GITHUB_REPO?.trim();
  if (env && /^[\w.-]+\/[\w.-]+$/.test(env)) return env;
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(await G.remoteUrl(repo()).catch(() => ""));
  return m?.[1] ?? "";
}
async function gh(method: string, url: string, token: string, body?: unknown) {
  const r = await fetch(`https://api.github.com${url}`, { method, headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "orbit-night-repair", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`GitHub ${method} ${url.split("?")[0]}: ${r.status} ${String(j.message ?? "").slice(0, 200)}`);
  return j;
}

async function publish(p: Patch, signal: AbortSignal) {
  const [token, slug] = await Promise.all([ghToken(), ghRepo()]);
  if (!token || !slug) { p.local = true; return; }
  try {
    await G.pushBranch(repo(), p.branch, signal);
    const pr = await gh("POST", `/repos/${slug}/pulls`, token, { title: `Night repair: ${p.title}`.slice(0, 120), head: p.branch, base: "main", body: prBody(p), draft: false });
    p.pr = { number: Number(pr.number), url: String(pr.html_url ?? "") };
  } catch (e) { p.local = true; p.reason = `kept local: ${msg(e)}`; }
}

// ---- the owner's decision ----

export type Decision = { ok: true; message: string } | { ok: false; error: string; status: number };
const no = (error: string, status = 409): Decision => ({ ok: false, error, status });

/** Approve = merge (GitHub API when there is a PR, else fast-forward the local main) then the existing self-update. Only for the exact
 *  version the owner saw (seen), only while Stop-all is off, and only when the real diff still passes the protected-path checks. */
export async function approveRepair(id: string, seen: string): Promise<Decision> {
  if (stopAllOn()) return no("Stop-all is on: nothing is merged or deployed until you resume");
  const p = (await load()).patches.find((x) => x.id === id);
  if (!p || !isWaiting(p)) return no("That patch is no longer waiting: reload");
  if (patchSeen(p) !== seen) return no("That patch changed since you saw it: reload");
  try {
    const head = await G.revParse(repo(), `refs/heads/${p.branch}`);
    if (head !== p.commit) return no("The branch moved since the gate passed: reject it");
    const problems = checkPatch(await G.diffOf(repo(), p.base, p.commit!));
    if (problems.length) return no(`Refused: ${problems.join("; ").slice(0, 300)}`);
    let how: string;
    const token = p.pr ? await ghToken() : "", slug = p.pr ? await ghRepo() : "";
    if (p.pr && token && slug) {
      const pr = await gh("GET", `/repos/${slug}/pulls/${p.pr.number}`, token);
      if (pr.state !== "open" || (pr.head as { sha?: string } | undefined)?.sha !== p.commit) return no("The pull request changed or was closed on GitHub: check it there");
      await gh("PUT", `/repos/${slug}/pulls/${p.pr.number}/merge`, token, { sha: p.commit, merge_method: "squash", commit_title: `Night repair: ${p.title} (#${p.pr.number})`.slice(0, 200) });
      how = `merged PR #${p.pr.number} on GitHub`;
    } else {
      await G.fastForwardMain(repo(), p.commit!);
      how = "fast-forwarded the local main";
    }
    const queued = await (await import("./self-update")).requestUpdate(!(p.pr && token && slug)); // local ff: HEAD already moved, so ask for a rebuild
    p.deployed = queued ? new Date().toISOString() : undefined;
    p.status = "merged"; p.decidedAt = new Date().toISOString();
    await savePatch(p);
    await G.deleteBranch(repo(), p.branch).catch(() => null);
    logActivity({ area: "system", title: `Night repair approved: ${p.title}`, detail: `${how}; ${queued ? "self-update requested (build, swap, rollback if unhealthy)" : "not the production server: restart ORBIT to use it"}` });
    return { ok: true, message: queued ? "Merged: ORBIT is updating itself" : "Merged: restart ORBIT to use it" };
  } catch (e) { return no(`Not merged: ${msg(e)}`, 502); }
}

export async function rejectRepair(id: string, seen: string): Promise<Decision> {
  const p = (await load()).patches.find((x) => x.id === id);
  if (!p || !isWaiting(p)) return no("That patch is no longer waiting: reload");
  if (patchSeen(p) !== seen) return no("That patch changed since you saw it: reload");
  p.status = "rejected"; p.decidedAt = new Date().toISOString();
  await savePatch(p);
  await G.deleteBranch(repo(), p.branch).catch(() => null);
  if (p.pr) void (async () => { const [t, s] = await Promise.all([ghToken(), ghRepo()]); if (t && s) await gh("PATCH", `/repos/${s}/pulls/${p.pr!.number}`, t, { state: "closed" }); })().catch((e) => console.error("[orbit] close PR:", msg(e)));
  logActivity({ area: "system", title: `Night repair rejected: ${p.title}`, detail: p.branch });
  return { ok: true, message: "Rejected: nothing changed" };
}

// ---- views ----

/** Waiting patches as approval items (remote.ts pendingApprovals → the phone and Needs you). */
export async function repairApprovals() {
  const st = await load().catch(() => ({ patches: [] as Patch[] }));
  return st.patches.filter(isWaiting).map((p) => ({ key: `patch:${p.id}`, seen: patchSeen(p), ...patchCard(p) }));
}
export async function repairView() {
  const st = await load(), b = await blockNow().catch((e) => ({ key: "", why: msg(e) }));
  return { config: repairConfig(process.env), running: !!R.ac, next: b.why || "starts with tonight's night window",
    nights: st.nights.slice(-5).reverse().map(({ selftest, ...n }) => ({ ...n, selftest: selftest && { at: selftest.at, tests: { ok: selftest.tests.ok, failed: selftest.tests.failed.length, ms: selftest.tests.ms }, smoke: selftest.smoke } })),
    patches: st.patches.slice(-20).reverse().map((p) => ({ ...p, seen: patchSeen(p), card: patchCard(p) })) };
}
export async function repairBriefLine(now = Date.now()) {
  const { repairBrief } = await import("./night-repair-pure");
  return repairBrief(await load(), nightKey(now, await nightSettings()));
}
